import type { TagType } from '@bookkeeping/contracts';
import type { Mode, Tag, TagSource } from '../../domain/types';
import { mapMode, mapTag, type TagRow } from './mappers';
import { SettingsJobsRepository } from './settings-jobs-repository';

/** Tags and modes over the single SQLite fact path. */
export class TagModeRepository extends SettingsJobsRepository {
  ensureTag(input: { id: string; type: TagType; name: string; now: string }): Tag {
    const existing = this.db.get<TagRow>(
      `SELECT * FROM tags
       WHERE type = ? AND name = ? AND deleted_at IS NULL AND merged_into_tag_id IS NULL`,
      [input.type, input.name],
    );
    if (existing) return mapTag(existing);
    this.db.run(
      `INSERT INTO tags (id, type, name, aliases_json, merged_into_tag_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, '[]', NULL, ?, ?, NULL)`,
      [input.id, input.type, input.name, input.now, input.now],
    );
    const created = this.getTag(input.id);
    if (!created) throw new Error('tag insert failed');
    return created;
  }

  getTag(id: string): Tag | undefined {
    const row = this.db.get<TagRow>('SELECT * FROM tags WHERE id = ?', [id]);
    return row ? mapTag(row) : undefined;
  }

  listTags(): Tag[] {
    return this.db
      .all<TagRow>(
        `SELECT * FROM tags
         WHERE deleted_at IS NULL AND merged_into_tag_id IS NULL
         ORDER BY name COLLATE NOCASE`,
      )
      .map(mapTag);
  }

  updateTagIdentity(id: string, type: TagType, name: string, now: string): void {
    this.db.run(
      `UPDATE tags SET type = ?, name = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL AND merged_into_tag_id IS NULL`,
      [type, name, now, id],
    );
  }

  setTagAliases(id: string, aliases: string[], now: string): void {
    this.db.run(
      `UPDATE tags SET aliases_json = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [JSON.stringify(aliases), now, id],
    );
  }

  getTagUsage(id: string): { recordCount: number; modeCount: number } {
    const recordCount =
      this.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM consumption_record_tags WHERE tag_id = ?`,
        [id],
      )?.count ?? 0;
    const modeCount =
      this.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM mode_default_tags WHERE tag_id = ?`,
        [id],
      )?.count ?? 0;
    return { recordCount, modeCount };
  }

  softDeleteTag(id: string, now: string): void {
    this.db.withTransaction(() => {
      const tag = this.getTag(id);
      if (!tag || tag.deletedAt || tag.mergedIntoTagId) throw new Error('标签不存在');
      const usage = this.getTagUsage(id);
      if (usage.recordCount > 0 || usage.modeCount > 0) {
        throw new Error('这个标签仍被账目或模式使用，请先合并标签或移除模式引用');
      }
      this.db.run(`DELETE FROM exclusive_stat_group_tags WHERE tag_id = ?`, [id]);
      this.db.run(
        `UPDATE tags SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL AND merged_into_tag_id IS NULL`,
        [now, now, id],
      );
    });
  }

  mergeTags(sourceId: string, targetId: string, now: string): void {
    if (sourceId === targetId) return;
    this.db.withTransaction(() => {
      const links = this.db.all<{ consumption_record_id: string; source: TagSource }>(
        `SELECT consumption_record_id, source FROM consumption_record_tags WHERE tag_id = ?`,
        [sourceId],
      );
      for (const link of links) {
        const exists = this.db.get(
          `SELECT 1 AS ok FROM consumption_record_tags
           WHERE consumption_record_id = ? AND tag_id = ?`,
          [link.consumption_record_id, targetId],
        );
        if (exists) {
          this.db.run(
            `DELETE FROM consumption_record_tags
             WHERE consumption_record_id = ? AND tag_id = ?`,
            [link.consumption_record_id, sourceId],
          );
        } else {
          this.db.run(
            `UPDATE consumption_record_tags SET tag_id = ?
             WHERE consumption_record_id = ? AND tag_id = ?`,
            [targetId, link.consumption_record_id, sourceId],
          );
        }
      }
      this.db.run(`UPDATE tags SET merged_into_tag_id = ?, updated_at = ? WHERE id = ?`, [
        targetId,
        now,
        sourceId,
      ]);
    });
  }

  listModes(): Mode[] {
    const rows = this.db.all<{
      id: string;
      name: string;
      is_active: number;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    }>(`SELECT * FROM modes WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`);
    return rows.map((row) => {
      const tags = this.db
        .all<{
          tag_id: string;
        }>(`SELECT tag_id FROM mode_default_tags WHERE mode_id = ? ORDER BY position ASC`, [row.id])
        .map((t) => t.tag_id);
      return mapMode(row, tags);
    });
  }

  getActiveMode(): Mode | undefined {
    return this.listModes().find((m) => m.isActive);
  }

  upsertMode(input: { id: string; name: string; defaultTagIds: string[]; now: string }): Mode {
    const existing = this.db.get(`SELECT id FROM modes WHERE id = ?`, [input.id]);
    if (existing) {
      this.db.run(`UPDATE modes SET name = ?, updated_at = ? WHERE id = ?`, [
        input.name,
        input.now,
        input.id,
      ]);
    } else {
      this.db.run(
        `INSERT INTO modes (id, name, is_active, created_at, updated_at, deleted_at)
         VALUES (?, ?, 0, ?, ?, NULL)`,
        [input.id, input.name, input.now, input.now],
      );
    }
    this.db.run(`DELETE FROM mode_default_tags WHERE mode_id = ?`, [input.id]);
    input.defaultTagIds.forEach((tagId, index) => {
      this.db.run(`INSERT INTO mode_default_tags (mode_id, tag_id, position) VALUES (?, ?, ?)`, [
        input.id,
        tagId,
        index,
      ]);
    });
    const mode = this.listModes().find((m) => m.id === input.id);
    if (!mode) throw new Error('mode upsert failed');
    return mode;
  }

  activateMode(modeId: string | null, now: string): void {
    this.db.run(`UPDATE modes SET is_active = 0, updated_at = ? WHERE deleted_at IS NULL`, [now]);
    if (modeId) {
      this.db.run(`UPDATE modes SET is_active = 1, updated_at = ? WHERE id = ?`, [now, modeId]);
    }
  }
}
