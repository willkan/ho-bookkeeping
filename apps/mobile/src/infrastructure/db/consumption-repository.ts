import type { CandidateRecord } from '@bookkeeping/contracts';
import type { ConsumptionRecord, LifecycleStatus, TagSource } from '../../domain/types';
import { mapConsumption, type ConsumptionRow } from './mappers';
import { TagModeRepository } from './tag-mode-repository';
import type { WeChatCsvRecord } from '../../application/wechat-csv';

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export class ConsumptionRepository extends TagModeRepository {
  /** One atomic posting of a locally validated, already classified CSV. */
  importWeChatCsv(input: {
    fileHash: string;
    rows: WeChatCsvRecord[];
    now: string;
    importLocalDate: string;
  }): number {
    return this.db.withTransaction(() => {
      const rawId = (index: number) => `ri_wc_${input.fileHash}_${index}`;
      const existing = input.rows.reduce(
        (count, _, index) =>
          count +
          Number(
            Boolean(
              this.db.get<{ id: string }>('SELECT id FROM raw_inputs WHERE id = ?', [rawId(index)]),
            ),
          ),
        0,
      );
      if (existing === input.rows.length) return 0;
      if (existing !== 0) throw new Error('此文件曾部分导入，账本未改动');
      const dates = input.rows.map((row) => row.localDate).sort();
      const overlap =
        this.db.get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM consumption_records
         WHERE deleted_at IS NULL AND local_date BETWEEN ? AND ?`,
          [dates[0], dates[dates.length - 1]],
        )?.count ?? 0;
      if (overlap > 0) throw new Error('导入日期范围已有账单，请先核对重复记录');

      input.rows.forEach((row, index) => {
        const id = rawId(index);
        const recordId = `cr_wc_${input.fileHash}_${index}`;
        const tag = this.ensureTag({
          id: this.ids.createId('tag'),
          type: 'category',
          name: row.category,
          now: input.now,
        });
        this.db.run(
          `INSERT INTO raw_inputs (
            id, raw_text, submitted_at, timezone, local_date, lifecycle_status, confirm_mode,
            mode_id_snapshot, mode_name_snapshot, default_tags_snapshot_json,
            include_in_mode_stats, parse_error_category, parse_error_message,
            candidates_json, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, 'Asia/Shanghai', ?, 'posted', 'auto_post',
            NULL, NULL, '[]', 0, NULL, NULL, NULL, ?, ?, NULL)`,
          [id, row.sourceText, input.now, input.importLocalDate, input.now, input.now],
        );
        this.db.run(
          `INSERT INTO consumption_records (
            id, raw_input_id, source_sequence, direction, merchant, note, occurred_at,
            timezone, local_date, currency, list_price_minor, actual_cost_minor,
            discount_minor, mode_id, include_in_mode_stats, manually_edited,
            created_at, updated_at, deleted_at
          ) VALUES (?, ?, 0, 'expense', NULL, ?, ?, 'Asia/Shanghai', ?, 'CNY',
            ?, ?, 0, NULL, 0, 1, ?, ?, NULL)`,
          [
            recordId,
            id,
            row.note,
            row.occurredAt,
            row.localDate,
            row.amountMinor,
            row.amountMinor,
            input.now,
            input.now,
          ],
        );
        this.db.run(
          `INSERT INTO consumption_record_tags (consumption_record_id, tag_id, source)
           VALUES (?, ?, 'manual')`,
          [recordId, tag.id],
        );
      });
      return input.rows.length;
    });
  }

  listEffectiveConsumptionRecords(): ConsumptionRecord[] {
    return this.db
      .all<ConsumptionRow>(
        `SELECT * FROM consumption_records
         WHERE deleted_at IS NULL
         ORDER BY local_date DESC, occurred_at DESC, raw_input_id DESC, source_sequence ASC, id ASC`,
      )
      .map((row) => this.hydrateConsumption(row));
  }

  listWithdrawnConsumptionRecords(): ConsumptionRecord[] {
    return this.db
      .all<ConsumptionRow>(
        `SELECT * FROM consumption_records
         WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC, occurred_at DESC, source_sequence ASC, id ASC`,
      )
      .map((row) => this.hydrateConsumption(row));
  }

  searchEffectiveConsumptionRecords(keyword: string): ConsumptionRecord[] {
    const normalized = keyword.trim();
    if (!normalized) return [];
    const pattern = `%${escapeLikePattern(normalized)}%`;
    return this.db
      .all<ConsumptionRow>(
        `SELECT records.*
         FROM consumption_records AS records
         LEFT JOIN raw_inputs AS raw ON raw.id = records.raw_input_id
         WHERE records.deleted_at IS NULL
           AND (
             COALESCE(records.merchant, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR COALESCE(records.note, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR COALESCE(raw.raw_text, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR EXISTS (
               SELECT 1
               FROM consumption_record_tags AS record_tags
               JOIN tags ON tags.id = record_tags.tag_id
               WHERE record_tags.consumption_record_id = records.id
                 AND tags.deleted_at IS NULL
                 AND tags.merged_into_tag_id IS NULL
                 AND (
                   tags.name LIKE ? ESCAPE '\\' COLLATE NOCASE
                   OR EXISTS (
                     SELECT 1
                     FROM json_each(tags.aliases_json) AS aliases
                     WHERE aliases.value LIKE ? ESCAPE '\\' COLLATE NOCASE
                   )
                 )
             )
           )
         ORDER BY records.local_date DESC, records.occurred_at DESC,
                  records.raw_input_id DESC, records.source_sequence ASC, records.id ASC`,
        [pattern, pattern, pattern, pattern, pattern],
      )
      .map((row) => this.hydrateConsumption(row));
  }

  listConsumptionByRawInput(rawInputId: string): ConsumptionRecord[] {
    return this.db
      .all<ConsumptionRow>(
        `SELECT * FROM consumption_records
         WHERE raw_input_id = ? AND deleted_at IS NULL
         ORDER BY occurred_at ASC, source_sequence ASC, id ASC`,
        [rawInputId],
      )
      .map((row) => this.hydrateConsumption(row));
  }

  getConsumptionRecord(id: string): ConsumptionRecord | undefined {
    const row = this.db.get<ConsumptionRow>(`SELECT * FROM consumption_records WHERE id = ?`, [id]);
    return row ? this.hydrateConsumption(row) : undefined;
  }

  private hydrateConsumption(row: ConsumptionRow): ConsumptionRecord {
    const tags = this.db.all<{ tag_id: string; source: TagSource }>(
      `SELECT tag_id, source FROM consumption_record_tags WHERE consumption_record_id = ?`,
      [row.id],
    );
    return mapConsumption(row, tags);
  }

  /** Atomically post the whole flat proposal list or none. */
  postCandidateList(input: {
    rawInputId: string;
    records: CandidateRecord[];
    now: string;
    lifecycle: LifecycleStatus;
  }): ConsumptionRecord[] {
    return this.db.withTransaction(() => {
      const raw = this.getRawInput(input.rawInputId);
      if (!raw) throw new Error('raw input missing');
      if (raw.deletedAt) return [];
      const existing = this.listConsumptionByRawInput(input.rawInputId);
      if (raw.lifecycleStatus === 'posted' && existing.length > 0) return existing;

      const created: ConsumptionRecord[] = [];
      for (const [sourceSequence, candidate] of input.records.entries()) {
        const recordId = this.ids.createId('cr');
        this.db.run(
          `INSERT INTO consumption_records (
            id, raw_input_id, source_sequence, direction, merchant, note, occurred_at, timezone,
            local_date, currency, list_price_minor, actual_cost_minor, discount_minor,
            mode_id, include_in_mode_stats, manually_edited, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
          [
            recordId,
            input.rawInputId,
            sourceSequence,
            candidate.direction,
            candidate.merchant,
            candidate.note,
            candidate.occurred_at,
            candidate.timezone,
            candidate.local_date,
            candidate.list_price_minor,
            candidate.actual_cost_minor,
            candidate.discount_minor,
            raw.modeIdSnapshot,
            raw.includeInModeStats ? 1 : 0,
            input.now,
            input.now,
          ],
        );

        for (const snap of raw.defaultTagsSnapshot) {
          const tagId =
            snap.tagId ??
            this.ensureTag({
              id: this.ids.createId('tag'),
              type: snap.type,
              name: snap.name,
              now: input.now,
            }).id;
          this.db.run(
            `INSERT OR IGNORE INTO consumption_record_tags
             (consumption_record_id, tag_id, source) VALUES (?, ?, 'mode_default')`,
            [recordId, tagId],
          );
        }
        for (const candidateTag of candidate.tags) {
          let tagId = candidateTag.existing_tag_id ?? null;
          if (tagId) {
            const tag = this.getTag(tagId);
            if (!tag || tag.deletedAt || tag.mergedIntoTagId) tagId = null;
          }
          tagId ??= this.ensureTag({
            id: this.ids.createId('tag'),
            type: candidateTag.type,
            name: candidateTag.name,
            now: input.now,
          }).id;
          this.db.run(
            `INSERT OR IGNORE INTO consumption_record_tags
             (consumption_record_id, tag_id, source) VALUES (?, ?, 'ai')`,
            [recordId, tagId],
          );
        }
        const record = this.getConsumptionRecord(recordId);
        if (record) created.push(record);
      }

      this.db.run(
        `UPDATE raw_inputs
         SET lifecycle_status = ?, candidates_json = ?, parse_error_category = NULL,
             parse_error_message = NULL, updated_at = ?
         WHERE id = ?`,
        [input.lifecycle, JSON.stringify(input.records), input.now, input.rawInputId],
      );
      return created;
    });
  }

  softDeleteConsumption(id: string, now: string): void {
    this.db.run(
      `UPDATE consumption_records SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
  }

  restoreConsumption(id: string, now: string): void {
    this.db.run(
      `UPDATE consumption_records SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NOT NULL`,
      [now, id],
    );
  }

  updateConsumptionRecord(input: {
    id: string;
    direction: import('../../domain/types').Direction;
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
    now: string;
  }): ConsumptionRecord {
    return this.db.withTransaction(() => {
      const before = this.getConsumptionRecord(input.id);
      if (!before || before.deletedAt) throw new Error('record not found');
      this.db.run(
        `UPDATE consumption_records SET
           direction = ?, merchant = ?, note = ?, occurred_at = ?, timezone = ?, local_date = ?,
           list_price_minor = ?, actual_cost_minor = ?, discount_minor = ?, mode_id = ?,
           include_in_mode_stats = ?, manually_edited = 1, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          input.direction,
          input.merchant,
          input.note,
          input.occurredAt,
          input.timezone,
          input.localDate,
          input.listPriceMinor,
          input.actualCostMinor,
          input.discountMinor,
          input.modeId,
          input.includeInModeStats ? 1 : 0,
          input.now,
          input.id,
        ],
      );
      this.db.run(`DELETE FROM consumption_record_tags WHERE consumption_record_id = ?`, [
        input.id,
      ]);
      for (const tagId of input.tagIds) {
        this.db.run(
          `INSERT INTO consumption_record_tags (consumption_record_id, tag_id, source)
           VALUES (?, ?, 'manual')`,
          [input.id, tagId],
        );
      }
      const record = this.getConsumptionRecord(input.id);
      if (!record) throw new Error('update consumption failed');
      return record;
    });
  }
}
