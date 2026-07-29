import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('export write path API contract', () => {
  // Positive: module uses modern File/Paths, not main-entry writeAsStringAsync
  it('write-export-file imports File and Paths from expo-file-system', () => {
    const src = readFileSync(join(__dirname, 'write-export-file.ts'), 'utf8');
    expect(src).toMatch(/from 'expo-file-system'/);
    expect(src).toMatch(/\bFile\b/);
    expect(src).toMatch(/\bPaths\b/);
    expect(src).not.toMatch(/writeAsStringAsync/);
    expect(src).not.toMatch(/expo-file-system\/legacy/);
  });

  // Negative: export screen must not call deprecated main-entry writeAsStringAsync
  it('export screen does not call writeAsStringAsync from main entry', () => {
    const src = readFileSync(join(__dirname, '../../../app/export.tsx'), 'utf8');
    expect(src).not.toMatch(/writeAsStringAsync/);
    expect(src).toMatch(/writeExportFile/);
  });
});
