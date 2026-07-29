import type { ExclusiveStatGroup, RawInput, ConsumptionRecord } from '../../domain/types';
import { mapRawInput, type RawInputRow } from './mappers';
import { ConsumptionRepository } from './consumption-repository';

/** Exclusive groups and export queries over the single SQLite fact path. */
export class CatalogExportRepository extends ConsumptionRepository {
  listExclusiveGroups(): ExclusiveStatGroup[] {
    const groups = this.db.all<{
      id: string;
      name: string;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    }>(`SELECT * FROM exclusive_stat_groups WHERE deleted_at IS NULL`);
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      tagIds: this.db
        .all<{
          tag_id: string;
        }>(`SELECT tag_id FROM exclusive_stat_group_tags WHERE group_id = ?`, [g.id])
        .map((t) => t.tag_id),
      createdAt: g.created_at,
      updatedAt: g.updated_at,
      deletedAt: g.deleted_at,
    }));
  }

  listAllRawInputsForExport(): RawInput[] {
    return this.db
      .all<RawInputRow>(
        `SELECT * FROM raw_inputs WHERE deleted_at IS NULL ORDER BY submitted_at ASC`,
      )
      .map(mapRawInput);
  }

  listAllConsumptionForExport(): ConsumptionRecord[] {
    return this.listEffectiveConsumptionRecords().slice().reverse();
  }
}
