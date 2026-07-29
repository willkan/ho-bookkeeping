import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SequenceIdGenerator } from './sequence-id-generator';

describe('IdGenerator port and adapters', () => {
  // Positive: test generator is explicit and deterministic
  it('SequenceIdGenerator yields stable sequential ids', () => {
    const ids = new SequenceIdGenerator();
    expect(ids.createId('ri')).toBe('ri_test_1');
    expect(ids.createId('job')).toBe('job_test_2');
  });

  // Positive: production adapter uses expo-crypto.randomUUID only
  it('ExpoCryptoIdGenerator uses Crypto.randomUUID without fallbacks', async () => {
    vi.resetModules();
    vi.doMock('expo-crypto', () => ({
      randomUUID: () => '11111111-2222-3333-4444-555555555555',
    }));
    const { ExpoCryptoIdGenerator } = await import('./expo-crypto-id-generator');
    const gen = new ExpoCryptoIdGenerator();
    expect(gen.createId('ri')).toBe('ri_11111111-2222-3333-4444-555555555555');
    vi.doUnmock('expo-crypto');
    vi.resetModules();
  });

  // Negative: production adapter throws when crypto fails (no Date.now/Math.random)
  it('ExpoCryptoIdGenerator throws when randomUUID fails', async () => {
    vi.resetModules();
    vi.doMock('expo-crypto', () => ({
      randomUUID: () => {
        throw new Error('native missing');
      },
    }));
    const { ExpoCryptoIdGenerator } = await import('./expo-crypto-id-generator');
    const gen = new ExpoCryptoIdGenerator();
    expect(() => gen.createId('ri')).toThrow(/randomUUID unavailable|native missing/);
    vi.doUnmock('expo-crypto');
    vi.resetModules();
  });

  // Negative: obsolete domain/ids.ts is gone
  it('domain/ids.ts is removed', async () => {
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(__dirname, '../../domain/ids.ts'))).toBe(false);
  });

  // Source: production adapter has no Math.random / Date.now
  it('expo-crypto-id-generator source has no Math.random or Date.now fallback', () => {
    const src = readFileSync(join(__dirname, 'expo-crypto-id-generator.ts'), 'utf8');
    expect(src.includes('Math.random')).toBe(false);
    expect(src.includes('Date.now')).toBe(false);
    expect(src).toMatch(/randomUUID/);
  });
});
