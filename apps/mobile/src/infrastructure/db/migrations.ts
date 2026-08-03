import type { SqliteDatabase } from './sqlite-database';

export interface Migration {
  version: number;
  sql: string;
}

/**
 * Forward-only migrations. Never mutate a released version.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  merged_into_tag_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT NULL
);

CREATE TABLE modes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT NULL
);

CREATE TABLE mode_default_tags (
  mode_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mode_id, tag_id),
  FOREIGN KEY (mode_id) REFERENCES modes(id),
  FOREIGN KEY (tag_id) REFERENCES tags(id)
);

CREATE TABLE raw_inputs (
  id TEXT PRIMARY KEY NOT NULL,
  raw_text TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  local_date TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  confirm_mode TEXT NOT NULL,
  mode_id_snapshot TEXT NULL,
  mode_name_snapshot TEXT NULL,
  default_tags_snapshot_json TEXT NOT NULL,
  include_in_mode_stats INTEGER NOT NULL,
  parse_error_category TEXT NULL,
  parse_error_message TEXT NULL,
  candidates_json TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT NULL
);

CREATE TABLE parse_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  raw_input_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_eligible_at TEXT NOT NULL,
  last_error_category TEXT NULL,
  last_error_message TEXT NULL,
  client_request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  model_version TEXT NULL,
  contract_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (raw_input_id) REFERENCES raw_inputs(id)
);

CREATE TABLE consumption_records (
  id TEXT PRIMARY KEY NOT NULL,
  raw_input_id TEXT NULL,
  direction TEXT NOT NULL,
  merchant TEXT NULL,
  note TEXT NULL,
  occurred_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  local_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  list_price_minor INTEGER NOT NULL,
  actual_cost_minor INTEGER NOT NULL,
  cash_outflow_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL,
  payment_parts_json TEXT NOT NULL,
  mode_id TEXT NULL,
  include_in_mode_stats INTEGER NOT NULL DEFAULT 0,
  manually_edited INTEGER NOT NULL DEFAULT 0,
  is_coupon_purchase INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT NULL,
  FOREIGN KEY (raw_input_id) REFERENCES raw_inputs(id)
);

CREATE TABLE consumption_record_tags (
  consumption_record_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (consumption_record_id, tag_id),
  FOREIGN KEY (consumption_record_id) REFERENCES consumption_records(id),
  FOREIGN KEY (tag_id) REFERENCES tags(id)
);

CREATE TABLE coupons (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_record_id TEXT NULL,
  cost_minor INTEGER NOT NULL,
  face_value_minor INTEGER NOT NULL,
  remaining_cost_minor INTEGER NOT NULL,
  remaining_face_value_minor INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT NULL
);

CREATE TABLE fund_flows (
  id TEXT PRIMARY KEY NOT NULL,
  consumption_record_id TEXT NULL,
  kind TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  occurred_at TEXT NOT NULL,
  note TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT NULL
);

CREATE TABLE exclusive_stat_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT NULL
);

CREATE TABLE exclusive_stat_group_tags (
  group_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (group_id, tag_id),
  FOREIGN KEY (group_id) REFERENCES exclusive_stat_groups(id),
  FOREIGN KEY (tag_id) REFERENCES tags(id)
);

CREATE INDEX idx_raw_inputs_local_date ON raw_inputs(local_date);
CREATE INDEX idx_raw_inputs_lifecycle ON raw_inputs(lifecycle_status);
CREATE INDEX idx_parse_jobs_status_eligible ON parse_jobs(status, next_eligible_at);
CREATE INDEX idx_consumption_local_date ON consumption_records(local_date);
CREATE INDEX idx_consumption_deleted ON consumption_records(deleted_at);
CREATE INDEX idx_consumption_mode ON consumption_records(mode_id, include_in_mode_stats);
`,
  },
  {
    version: 2,
    sql: `
-- Non-secret BYOK execution diagnostics on jobs (never API key).
ALTER TABLE parse_jobs ADD COLUMN provider_host TEXT NULL;
ALTER TABLE parse_jobs ADD COLUMN config_revision INTEGER NULL;
`,
  },
  {
    version: 3,
    sql: `
ALTER TABLE consumption_records ADD COLUMN source_sequence INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_consumption_source_order
  ON consumption_records(raw_input_id, occurred_at, source_sequence);
`,
  },
  {
    version: 4,
    sql: `
-- The built-in category group is schema truth, not a query-time repair.
INSERT INTO exclusive_stat_groups (id, name, created_at, updated_at, deleted_at)
SELECT 'esg_category', '消费类目', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
WHERE NOT EXISTS (
  SELECT 1 FROM exclusive_stat_groups WHERE name = '消费类目' AND deleted_at IS NULL
);

INSERT OR IGNORE INTO exclusive_stat_group_tags (group_id, tag_id)
SELECT groups.id, tags.id
FROM exclusive_stat_groups AS groups
JOIN tags
  ON tags.type = 'category'
 AND tags.deleted_at IS NULL
 AND tags.merged_into_tag_id IS NULL
WHERE groups.name = '消费类目' AND groups.deleted_at IS NULL;

CREATE TRIGGER sync_consumption_category_tag_after_insert
AFTER INSERT ON tags
WHEN NEW.type = 'category' AND NEW.deleted_at IS NULL AND NEW.merged_into_tag_id IS NULL
BEGIN
  INSERT OR IGNORE INTO exclusive_stat_group_tags (group_id, tag_id)
  SELECT id, NEW.id
  FROM exclusive_stat_groups
  WHERE name = '消费类目' AND deleted_at IS NULL;
END;

CREATE TRIGGER sync_consumption_category_tag_after_update
AFTER UPDATE OF type, deleted_at, merged_into_tag_id ON tags
BEGIN
  DELETE FROM exclusive_stat_group_tags
  WHERE tag_id = NEW.id
    AND group_id IN (SELECT id FROM exclusive_stat_groups WHERE name = '消费类目');

  INSERT OR IGNORE INTO exclusive_stat_group_tags (group_id, tag_id)
  SELECT id, NEW.id
  FROM exclusive_stat_groups
  WHERE name = '消费类目'
    AND deleted_at IS NULL
    AND NEW.type = 'category'
    AND NEW.deleted_at IS NULL
    AND NEW.merged_into_tag_id IS NULL;
END;
`,
  },
  {
    version: 5,
    sql: `
WITH preset_tags (id, type, name, aliases_json) AS (
  VALUES
    ('preset_category_dining', 'category', '餐饮', '["吃饭","外卖"]'),
    ('preset_category_groceries', 'category', '买菜', '["生鲜","菜市场"]'),
    ('preset_category_shopping', 'category', '购物', '["网购"]'),
    ('preset_category_transport', 'category', '交通', '["打车","公交","地铁","火车","机票"]'),
    ('preset_category_lodging', 'category', '住宿', '["酒店","民宿"]'),
    ('preset_category_entertainment', 'category', '娱乐', '["电影","游戏"]'),
    ('preset_category_healthcare', 'category', '医疗健康', '["看病","买药","体检"]'),
    ('preset_category_housing', 'category', '居住缴费', '["房租","水电","物业"]'),
    ('preset_category_communications', 'category', '通讯网络', '["话费","宽带"]'),
    ('preset_category_life_services', 'category', '生活服务', '["理发","洗衣","维修"]'),
    ('preset_category_education', 'category', '教育学习', '["课程","书籍"]'),
    ('preset_category_social', 'category', '人情往来', '["红包","礼金"]'),
    ('preset_category_pets', 'category', '宠物', '[]'),
    ('preset_category_other', 'category', '其他', '[]'),
    ('preset_trip_travel', 'trip', '旅游', '["旅行","出游"]')
)
INSERT INTO tags (
  id, type, name, aliases_json, merged_into_tag_id,
  created_at, updated_at, deleted_at
)
SELECT
  preset_tags.id,
  preset_tags.type,
  preset_tags.name,
  preset_tags.aliases_json,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
FROM preset_tags
WHERE NOT EXISTS (
  SELECT 1
  FROM tags
  WHERE tags.type = preset_tags.type
    AND tags.name = preset_tags.name
    AND tags.deleted_at IS NULL
    AND tags.merged_into_tag_id IS NULL
);
`,
  },
  {
    version: 6,
    sql: `
-- Contract 2.0 removes coupon assets and records only checkout paid amount + coupon discount.
UPDATE consumption_records
SET deleted_at = COALESCE(deleted_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_coupon_purchase = 1;

UPDATE consumption_records
SET actual_cost_minor = cash_outflow_minor,
    discount_minor = list_price_minor - cash_outflow_minor,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE is_coupon_purchase = 0
  AND cash_outflow_minor BETWEEN 0 AND list_price_minor;

UPDATE raw_inputs
SET lifecycle_status = 'parse_failed',
    candidates_json = NULL,
    parse_error_category = 'unsupported_contract_version',
    parse_error_message = '请按新版金额规则重新整理',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE lifecycle_status = 'pending_confirm';

UPDATE parse_jobs
SET contract_version = '2.0.0',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status != 'succeeded';

DROP TABLE coupons;
DROP TABLE fund_flows;
ALTER TABLE consumption_records DROP COLUMN cash_outflow_minor;
ALTER TABLE consumption_records DROP COLUMN payment_parts_json;
ALTER TABLE consumption_records DROP COLUMN is_coupon_purchase;
`,
  },
  {
    version: 7,
    sql: `
-- Contract 2.1 makes occurred_at/timezone/local_date one consistent event-time fact.
-- Unconfirmed 2.0 proposals cannot be trusted under the stricter date semantics.
UPDATE parse_jobs
SET contract_version = '2.1.0',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status != 'succeeded'
   OR raw_input_id IN (
     SELECT id FROM raw_inputs WHERE lifecycle_status = 'pending_confirm'
   );

UPDATE raw_inputs
SET lifecycle_status = 'parse_failed',
    candidates_json = NULL,
    parse_error_category = 'unsupported_contract_version',
    parse_error_message = '请按新版日期规则重新整理',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE lifecycle_status = 'pending_confirm';
`,
  },
];

export function migrate(db: SqliteDatabase): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);
`);
  const applied = new Set(
    db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version),
  );
  const now = new Date().toISOString();
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN');
    try {
      // Migration SQL may recreate schema_migrations; use only domain tables after bootstrap.
      const sql =
        migration.version === 1
          ? migration.sql.replace(/CREATE TABLE schema_migrations \([\s\S]*?\);\s*/m, '')
          : migration.sql;
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        migration.version,
        now,
      ]);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function seedDefaults(db: SqliteDatabase): void {
  const confirm = db.get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'confirm_mode'",
  );
  if (!confirm) {
    db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', ['confirm_mode', 'auto_post']);
  }
  // BYOK provider config lives in expo-secure-store only — never seed keys or endpoints here.
}
