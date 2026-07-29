import type { IdGenerator } from '../../application/ports/id-generator';
import { CatalogExportRepository } from './catalog-export-repository';
import type { SqliteDatabase } from './sqlite-database';

/**
 * Single SQLite fact-path repository surface.
 * Implementation is split across cohesive modules via inheritance; no second DB abstraction.
 * IdGenerator is injected — no default ID strategy on the repository.
 */
export class LedgerRepository extends CatalogExportRepository {
  // Explicit constructor documents required IdGenerator injection (no default).
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- documents injection contract
  constructor(db: SqliteDatabase, ids: IdGenerator) {
    super(db, ids);
  }
}
