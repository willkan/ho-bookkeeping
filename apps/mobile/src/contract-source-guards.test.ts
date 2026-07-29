import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = join(__dirname, '..');

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (
      name === 'node_modules' ||
      name === 'dist' ||
      name === 'dist-ios' ||
      name === 'dist-android'
    ) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (
      /\.(ts|tsx|js|jsx)$/.test(name) &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('app source contract guards', () => {
  // Negative: no Math.random in app source outside tests/node_modules
  it('app production source has no Math.random', () => {
    const files = collectSourceFiles(join(APP_ROOT, 'src')).concat(
      collectSourceFiles(join(APP_ROOT, 'app')),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (src.includes('Math.random')) {
        offenders.push(file.replace(APP_ROOT + '/', ''));
      }
    }
    expect(offenders).toEqual([]);
  });

  // Negative: open-app-database has no optional/compat SQLite branches
  it('open-app-database uses sole expo-sqlite sync path without optional fallbacks', () => {
    const src = readFileSync(join(APP_ROOT, 'src/infrastructure/db/open-app-database.ts'), 'utf8');
    expect(src).toMatch(/execSync/);
    expect(src).toMatch(/withTransactionSync/);
    expect(src).toMatch(/runSync/);
    expect(src.includes('execSync?')).toBe(false);
    expect(src.includes('withTransactionSync?')).toBe(false);
    expect(src.includes("runSync('BEGIN')")).toBe(false);
    expect(src.includes('.split(')).toBe(false);
    // No optional presence checks on sync APIs
    expect(src).not.toMatch(/if \(anyDb\.execSync\)/);
    expect(src).not.toMatch(/if \(anyDb\.withTransactionSync\)/);
  });

  // Positive: domain no longer exports createId fallback module
  it('domain layer does not ship ids helper with Date.now/Math.random', async () => {
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(APP_ROOT, 'src/domain/ids.ts'))).toBe(false);
    const index = readFileSync(join(APP_ROOT, 'src/domain/index.ts'), 'utf8');
    expect(index.includes("from './ids'")).toBe(false);
  });

  // Negative: API keys must never be logged, exported, or written to SQLite SQL
  it('forbids logging/export/SQLite persistence of provider api keys', () => {
    const files = collectSourceFiles(join(APP_ROOT, 'src')).concat(
      collectSourceFiles(join(APP_ROOT, 'app')),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.replace(APP_ROOT + '/', '');
      const src = readFileSync(file, 'utf8');
      // Logging apiKey property values
      if (/console\.(log|info|warn|error|debug)\([^)]*apiKey/.test(src)) {
        offenders.push(`${rel}: console.*apiKey`);
      }
      // SQLite bind of api key field names
      if (/INSERT INTO[\s\S]{0,200}api[_-]?key/i.test(src) && !rel.includes('secure-provider')) {
        offenders.push(`${rel}: SQL api_key`);
      }
      // Export packages should not mention apiKey
      if (rel.includes('infrastructure/export') && /apiKey|api_key|OPENAI_API_KEY/i.test(src)) {
        offenders.push(`${rel}: export api key`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Negative: no gateway HTTP production path remains
  it('retires gateway-only production symbols', () => {
    const files = collectSourceFiles(join(APP_ROOT, 'src')).concat(
      collectSourceFiles(join(APP_ROOT, 'app')),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.replace(APP_ROOT + '/', '');
      const src = readFileSync(file, 'utf8');
      if (src.includes('HttpAiParseTransport') || src.includes('EXPO_PUBLIC_AI_GATEWAY_URL')) {
        offenders.push(rel);
      }
      if (src.includes('resolveProductionGatewayUrl') || src.includes('MissingGatewayUrlError')) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
