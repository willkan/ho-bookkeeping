import type { TagType } from '@bookkeeping/contracts';
import type {
  ConfirmMode,
  ConsumptionRecord,
  LifecycleStatus,
  Mode,
  ModeTagSnapshot,
  ParseJob,
  ParseJobStatus,
  RawInput,
  Tag,
  TagSource,
} from '../../domain/types';

export type RawInputRow = {
  id: string;
  raw_text: string;
  submitted_at: string;
  timezone: string;
  local_date: string;
  lifecycle_status: LifecycleStatus;
  confirm_mode: ConfirmMode;
  mode_id_snapshot: string | null;
  mode_name_snapshot: string | null;
  default_tags_snapshot_json: string;
  include_in_mode_stats: number;
  parse_error_category: string | null;
  parse_error_message: string | null;
  candidates_json: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ParseJobRow = {
  id: string;
  raw_input_id: string;
  status: ParseJobStatus;
  attempts: number;
  max_attempts: number;
  next_eligible_at: string;
  last_error_category: string | null;
  last_error_message: string | null;
  client_request_id: string;
  idempotency_key: string;
  model_version: string | null;
  provider_host: string | null;
  config_revision: number | null;
  contract_version: string;
  created_at: string;
  updated_at: string;
};

export type ConsumptionRow = {
  id: string;
  raw_input_id: string | null;
  source_sequence: number;
  direction: ConsumptionRecord['direction'];
  merchant: string | null;
  note: string | null;
  occurred_at: string;
  timezone: string;
  local_date: string;
  currency: 'CNY';
  list_price_minor: number;
  actual_cost_minor: number;
  discount_minor: number;
  mode_id: string | null;
  include_in_mode_stats: number;
  manually_edited: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type TagRow = {
  id: string;
  type: TagType;
  name: string;
  aliases_json: string;
  merged_into_tag_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function mapRawInput(row: RawInputRow): RawInput {
  return {
    id: row.id,
    rawText: row.raw_text,
    submittedAt: row.submitted_at,
    timezone: row.timezone,
    localDate: row.local_date,
    lifecycleStatus: row.lifecycle_status,
    confirmMode: row.confirm_mode,
    modeIdSnapshot: row.mode_id_snapshot,
    modeNameSnapshot: row.mode_name_snapshot,
    defaultTagsSnapshot: JSON.parse(row.default_tags_snapshot_json) as ModeTagSnapshot[],
    includeInModeStats: row.include_in_mode_stats === 1,
    parseErrorCategory: row.parse_error_category,
    parseErrorMessage: row.parse_error_message,
    candidatesJson: row.candidates_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapParseJob(row: ParseJobRow): ParseJob {
  return {
    id: row.id,
    rawInputId: row.raw_input_id,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextEligibleAt: row.next_eligible_at,
    lastErrorCategory: row.last_error_category,
    lastErrorMessage: row.last_error_message,
    clientRequestId: row.client_request_id,
    idempotencyKey: row.idempotency_key,
    modelVersion: row.model_version,
    providerHost: row.provider_host ?? null,
    configRevision: row.config_revision ?? null,
    contractVersion: row.contract_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTag(row: TagRow): Tag {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    aliases: JSON.parse(row.aliases_json) as string[],
    mergedIntoTagId: row.merged_into_tag_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapConsumption(
  row: ConsumptionRow,
  tags: { tag_id: string; source: TagSource }[],
): ConsumptionRecord {
  return {
    id: row.id,
    rawInputId: row.raw_input_id,
    sourceSequence: row.source_sequence,
    direction: row.direction,
    merchant: row.merchant,
    note: row.note,
    occurredAt: row.occurred_at,
    timezone: row.timezone,
    localDate: row.local_date,
    currency: row.currency,
    listPriceMinor: row.list_price_minor,
    actualCostMinor: row.actual_cost_minor,
    discountMinor: row.discount_minor,
    tags: tags.map((t) => ({ tagId: t.tag_id, source: t.source })),
    modeId: row.mode_id,
    includeInModeStats: row.include_in_mode_stats === 1,
    manuallyEdited: row.manually_edited === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function mapMode(
  row: {
    id: string;
    name: string;
    is_active: number;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  },
  defaultTagIds: string[],
): Mode {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
    defaultTagIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
