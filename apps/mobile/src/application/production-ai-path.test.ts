import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('production AI path contract (BYOK)', () => {
  // Negative: AppProvider must not import FakeAiParseTransport or demoRecordsFromText
  it('app-context has no demo/fake production fallback', () => {
    const src = readFileSync(join(__dirname, 'app-context.tsx'), 'utf8');
    expect(src).not.toMatch(/FakeAiParseTransport/);
    expect(src).not.toMatch(/demoRecordsFromText/);
    expect(src).toMatch(/OpenAiCompatibleParseTransport/);
    expect(src).toMatch(/SecureProviderConfigRepository/);
    expect(src).not.toMatch(/EXPO_PUBLIC_AI_GATEWAY_URL/);
    expect(src).not.toMatch(/HttpAiParseTransport/);
  });

  // Negative: background task uses the same secure config path
  it('background task resolves SecureProviderConfigRepository', () => {
    const src = readFileSync(
      join(__dirname, '../infrastructure/jobs/background-parse-task.ts'),
      'utf8',
    );
    expect(src).toMatch(/SecureProviderConfigRepository/);
    expect(src).toMatch(/OpenAiCompatibleParseTransport/);
    expect(src).not.toMatch(/EXPO_PUBLIC_AI_GATEWAY_URL/);
    expect(src).not.toMatch(/HttpAiParseTransport/);
  });
});
