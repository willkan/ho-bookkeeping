import { CONTRACT_VERSION, type CandidateRecord, type ParseRequest } from '@bookkeeping/contracts';
import { validateAmountsForEdit, validateCandidateList } from '../domain/record-validation';
import {
  computeExclusiveBreakdown,
  computeTrend,
  filterBreakdownBucketRecords,
  filterRecords,
} from '../domain/statistics';
import type {
  BreakdownResult,
  ConfirmMode,
  ConsumptionRecord,
  ExclusiveStatGroup,
  Mode,
  ModeTagSnapshot,
  ParseJob,
  RawInput,
  StatFilter,
  Tag,
  TrendGranularity,
  TrendResult,
} from '../domain/types';
import type {
  AiParseTransport,
  AiParseTransportWithMeta,
  ParseExecutionMeta,
} from '../infrastructure/ai/transport';
import type { LedgerRepository } from '../infrastructure/db/repositories';
import type { IdGenerator } from './ports/id-generator';

export type SubmitRawInputCommand = {
  rawText: string;
  timezone: string;
  localDate: string;
  submittedAt?: string;
  /** Override default tags for this entry only (after user toggles). */
  defaultTagsSnapshot?: ModeTagSnapshot[];
  /** false when user uses “本笔跳出模式”. */
  includeInModeStats?: boolean;
  confirmModeOverride?: ConfirmMode;
};

export type TodayTimelineItem =
  | { kind: 'record'; record: ConsumptionRecord }
  | {
      kind: 'raw';
      raw: RawInput;
      viewStatus: 'pending_parse' | 'pending_confirm' | 'parse_failed' | 'withdrawn';
    };

function jobMetaFrom(meta: ParseExecutionMeta | null): {
  modelVersion: string | null;
  providerHost: string | null;
  configRevision: number | null;
} {
  return {
    modelVersion: meta?.model ?? null,
    providerHost: meta?.providerHost ?? null,
    configRevision: meta?.configRevision ?? null,
  };
}

export class LedgerService {
  constructor(
    private readonly repo: LedgerRepository,
    private readonly transport: AiParseTransport,
    private readonly ids: IdGenerator,
  ) {}

  getSettings() {
    return this.repo.getSettings();
  }

  setConfirmMode(mode: ConfirmMode) {
    this.repo.setConfirmMode(mode);
  }

  /**
   * Local atomic save of raw text + unique parse job. Does not wait for AI.
   */
  async submitRawInput(command: SubmitRawInputCommand): Promise<{
    rawInput: RawInput;
    job: ParseJob;
  }> {
    const text = command.rawText.trim();
    if (!text) {
      throw new Error('raw text is required');
    }
    const settings = this.repo.getSettings();
    const activeMode = this.repo.getActiveMode();
    const now = command.submittedAt ?? new Date().toISOString();
    const defaultTags: ModeTagSnapshot[] =
      command.defaultTagsSnapshot ??
      (activeMode
        ? activeMode.defaultTagIds.map((tagId) => {
            const tag = this.repo.getTag(tagId);
            return {
              tagId,
              name: tag?.name ?? tagId,
              type: tag?.type ?? 'other',
            };
          })
        : []);
    const includeInModeStats = command.includeInModeStats ?? Boolean(activeMode);
    return this.repo.submitRawInput({
      id: this.ids.createId('ri'),
      rawText: text,
      submittedAt: now,
      timezone: command.timezone,
      localDate: command.localDate,
      confirmMode: command.confirmModeOverride ?? settings.confirmMode,
      modeIdSnapshot: activeMode?.id ?? null,
      modeNameSnapshot: activeMode?.name ?? null,
      defaultTagsSnapshot: defaultTags,
      includeInModeStats,
      jobId: this.ids.createId('job'),
      clientRequestId: this.ids.createId('req'),
    });
  }

  /**
   * Process one eligible job: claim → transport → validate list → post all-or-none / pending confirm.
   * Late responses cannot attach to another raw input (bound by job.rawInputId + request_id).
   */
  async processJob(jobId: string, nowIso = new Date().toISOString()): Promise<void> {
    const claimed = this.repo.claimJob(jobId, nowIso);
    if (!claimed) return;

    const raw = this.repo.getRawInput(claimed.rawInputId);
    if (!raw) {
      this.repo.markJobFailed(jobId, nowIso, 'invalid_request', 'raw input missing', false);
      return;
    }

    if (raw.lifecycleStatus === 'posted') {
      this.repo.markJobSucceeded(jobId, nowIso);
      return;
    }

    const tags = this.repo.listTags();
    const request: ParseRequest = {
      contract_version: CONTRACT_VERSION,
      request_id: claimed.clientRequestId,
      raw_text: raw.rawText,
      submitted_at: raw.submittedAt,
      timezone: raw.timezone,
      local_date: raw.localDate,
      mode_snapshot: {
        mode_id: raw.modeIdSnapshot,
        mode_name: raw.modeNameSnapshot,
        default_tags: raw.defaultTagsSnapshot.map((t) => ({
          tag_id: t.tagId,
          name: t.name,
          type: t.type,
        })),
        include_in_mode_stats: raw.includeInModeStats,
      },
      tag_candidates: tags.slice(0, 200).map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        aliases: t.aliases,
      })),
    };

    let response;
    try {
      response = await this.transport.parse(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'transport failure';
      this.persistTransportMeta(jobId, nowIso);
      this.repo.markJobFailed(jobId, nowIso, 'provider_error', message, true);
      this.repo.updateRawInputLifecycle(raw.id, 'parse_failed', nowIso, {
        parseErrorCategory: 'provider_error',
        parseErrorMessage: message,
      });
      return;
    }

    const execMeta = this.persistTransportMeta(jobId, nowIso);

    // Reject mismatched request_id (out-of-order / wrong attachment).
    if (response.request_id !== claimed.clientRequestId) {
      this.repo.markJobFailed(
        jobId,
        nowIso,
        'model_output_invalid',
        'response request_id mismatch',
        false,
      );
      this.repo.updateRawInputLifecycle(raw.id, 'parse_failed', nowIso, {
        parseErrorCategory: 'model_output_invalid',
        parseErrorMessage: 'response request_id mismatch',
      });
      return;
    }

    if (response.status === 'error') {
      const retryable = ['provider_error', 'rate_limited', 'timeout'].includes(
        response.error_category,
      );
      this.repo.markJobFailed(jobId, nowIso, response.error_category, response.message, retryable);
      this.repo.updateRawInputLifecycle(raw.id, 'parse_failed', nowIso, {
        parseErrorCategory: response.error_category,
        parseErrorMessage: response.message,
      });
      return;
    }

    const validation = validateCandidateList(response.records);
    if (!validation.ok) {
      this.repo.markJobFailed(
        jobId,
        nowIso,
        'model_output_invalid',
        validation.issues.map((i) => i.message).join('; '),
        false,
      );
      this.repo.updateRawInputLifecycle(raw.id, 'parse_failed', nowIso, {
        parseErrorCategory: 'model_output_invalid',
        parseErrorMessage: validation.issues.map((i) => i.message).join('; '),
        candidatesJson: JSON.stringify(response.records),
      });
      return;
    }

    if (raw.confirmMode === 'confirm_before_post') {
      this.repo.updateRawInputLifecycle(raw.id, 'pending_confirm', nowIso, {
        candidatesJson: JSON.stringify(response.records),
      });
      this.repo.markJobSucceeded(jobId, nowIso, jobMetaFrom(execMeta));
      return;
    }

    this.repo.postCandidateList({
      rawInputId: raw.id,
      records: response.records,
      now: nowIso,
      lifecycle: 'posted',
    });
    this.repo.markJobSucceeded(jobId, nowIso, jobMetaFrom(execMeta));
  }

  private persistTransportMeta(jobId: string, nowIso: string): ParseExecutionMeta | null {
    const transport = this.transport as AiParseTransportWithMeta;
    if (typeof transport.getLastExecutionMeta !== 'function') {
      return null;
    }
    const meta = transport.getLastExecutionMeta();
    if (!meta) return null;
    this.repo.recordJobExecutionMeta(jobId, nowIso, {
      modelVersion: meta.model,
      providerHost: meta.providerHost,
      configRevision: meta.configRevision,
    });
    return meta;
  }

  /** Resume all eligible jobs (startup / foreground). */
  async processEligibleJobs(nowIso = new Date().toISOString()): Promise<number> {
    // Any running job older than 2 minutes is treated as orphaned after force-quit.
    const staleBefore = new Date(Date.parse(nowIso) - 2 * 60_000).toISOString();
    this.repo.reclaimStaleRunningJobs(nowIso, staleBefore);
    const jobs = this.repo.listEligibleJobs(nowIso);
    for (const job of jobs) {
      await this.processJob(job.id, nowIso);
    }
    return jobs.length;
  }

  async confirmPending(rawInputId: string, records?: CandidateRecord[]): Promise<void> {
    const raw = this.repo.getRawInput(rawInputId);
    if (!raw || raw.lifecycleStatus !== 'pending_confirm') {
      throw new Error('raw input is not pending confirmation');
    }
    const candidates: CandidateRecord[] = records
      ? records
      : raw.candidatesJson
        ? (JSON.parse(raw.candidatesJson) as CandidateRecord[])
        : [];
    const validation = validateCandidateList(candidates);
    if (!validation.ok) {
      throw new Error(validation.issues.map((i) => i.message).join('; '));
    }
    const now = new Date().toISOString();
    this.repo.postCandidateList({
      rawInputId,
      records: candidates,
      now,
      lifecycle: 'posted',
    });
  }

  rejectPending(rawInputId: string): void {
    const now = new Date().toISOString();
    this.repo.updateRawInputLifecycle(rawInputId, 'parse_failed', now, {
      parseErrorCategory: 'user_rejected',
      parseErrorMessage: '用户拒绝了这次整理结果',
    });
  }

  retryParse(rawInputId: string): void {
    const job = this.repo.getParseJobByRawInputId(rawInputId);
    if (!job) throw new Error('parse job not found');
    const now = new Date().toISOString();
    this.repo.resetJobForUserRetry(job.id, now);
    this.repo.updateRawInputLifecycle(rawInputId, 'pending_parse', now, {
      parseErrorCategory: null,
      parseErrorMessage: null,
    });
  }

  listToday(localDate: string): {
    rawInputs: RawInput[];
    records: ConsumptionRecord[];
  } {
    return {
      rawInputs: this.repo.listRawInputsForDate(localDate),
      records: this.repo.listConsumptionForLocalDate(localDate),
    };
  }

  listTodayTimeline(localDate: string): TodayTimelineItem[] {
    const { rawInputs, records } = this.listToday(localDate);
    const activeRawIds = new Set(records.map((record) => record.rawInputId));
    return [
      ...records.map((record) => ({ kind: 'record' as const, record })),
      ...rawInputs.flatMap((raw): TodayTimelineItem[] => {
        if (raw.lifecycleStatus === 'posted' && activeRawIds.has(raw.id)) return [];
        return [
          {
            kind: 'raw',
            raw,
            viewStatus: raw.lifecycleStatus === 'posted' ? 'withdrawn' : raw.lifecycleStatus,
          },
        ];
      }),
    ];
  }

  getConsumption(id: string): ConsumptionRecord | undefined {
    return this.repo.getConsumptionRecord(id);
  }

  getRawInput(id: string): RawInput | undefined {
    return this.repo.getRawInput(id);
  }

  editConsumption(input: {
    id: string;
    direction: import('../domain/types').Direction;
    merchant: string | null;
    note: string | null;
    occurredAt: string;
    timezone: string;
    localDate: string;
    listPriceMinor: number;
    actualCostMinor: number;
    discountMinor: number;
    tagIds: string[];
    modeId: string | null;
    includeInModeStats: boolean;
  }): ConsumptionRecord {
    const existing = this.repo.getConsumptionRecord(input.id);
    if (!existing || existing.deletedAt) {
      throw new Error('record not found');
    }
    const validation = validateAmountsForEdit(
      input.listPriceMinor,
      input.actualCostMinor,
      input.discountMinor,
    );
    if (!validation.ok) {
      throw new Error(validation.issues.map((i) => i.message).join('; '));
    }
    return this.repo.updateConsumptionRecord({
      ...input,
      now: new Date().toISOString(),
    });
  }

  softDeleteConsumption(id: string): void {
    this.repo.softDeleteConsumption(id, new Date().toISOString());
  }

  undoSoftDelete(id: string): void {
    this.repo.undoSoftDeleteConsumption(id, new Date().toISOString());
  }

  listModes(): Mode[] {
    return this.repo.listModes();
  }

  getActiveMode(): Mode | undefined {
    return this.repo.getActiveMode();
  }

  saveMode(input: { id?: string; name: string; defaultTagIds: string[] }): Mode {
    return this.repo.upsertMode({
      id: input.id ?? this.ids.createId('mode'),
      name: input.name,
      defaultTagIds: input.defaultTagIds,
      now: new Date().toISOString(),
    });
  }

  activateMode(modeId: string | null): void {
    this.repo.activateMode(modeId, new Date().toISOString());
  }

  listTags(): Tag[] {
    return this.repo.listTags();
  }

  createTag(type: Tag['type'], name: string): Tag {
    return this.repo.ensureTag({
      id: this.ids.createId('tag'),
      type,
      name,
      now: new Date().toISOString(),
    });
  }

  updateTagIdentity(id: string, type: Tag['type'], name: string): void {
    this.repo.updateTagIdentity(id, type, name, new Date().toISOString());
  }

  mergeTags(sourceId: string, targetId: string): void {
    this.repo.mergeTags(sourceId, targetId, new Date().toISOString());
  }

  deleteTag(id: string): void {
    this.repo.softDeleteTag(id, new Date().toISOString());
  }

  listExclusiveGroups(): ExclusiveStatGroup[] {
    return this.repo.listExclusiveGroups();
  }

  breakdown(filter: StatFilter, groupId: string): BreakdownResult {
    const group = this.repo.listExclusiveGroups().find((g) => g.id === groupId);
    if (!group) throw new Error('exclusive group not found');
    const tagsById = new Map(this.repo.listTags().map((t) => [t.id, t]));
    return computeExclusiveBreakdown(
      this.repo.listEffectiveConsumptionRecords(),
      filter,
      group,
      tagsById,
    );
  }

  trend(filter: StatFilter, granularity: TrendGranularity): TrendResult {
    return computeTrend(this.repo.listEffectiveConsumptionRecords(), filter, granularity);
  }

  filterRecords(filter: StatFilter): ConsumptionRecord[] {
    return filterRecords(this.repo.listEffectiveConsumptionRecords(), filter);
  }

  breakdownRecords(filter: StatFilter, groupId: string, bucketKey: string): ConsumptionRecord[] {
    const group = this.repo.listExclusiveGroups().find((item) => item.id === groupId);
    if (!group) throw new Error('找不到这个分类方式');
    return filterBreakdownBucketRecords(
      this.repo.listEffectiveConsumptionRecords(),
      filter,
      group,
      bucketKey,
    );
  }

  exportSnapshot() {
    return {
      rawInputs: this.repo.listAllRawInputsForExport(),
      records: this.repo.listAllConsumptionForExport(),
      tags: this.repo.listTags(),
      modes: this.repo.listModes(),
    };
  }
}
