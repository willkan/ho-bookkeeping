import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('expo-background-task parse seam', () => {
  // Positive: task module defines one named OS task and uses ParseJobRunner path
  it('background task source wires ParseJobRunner and encrypted openAppDatabase', () => {
    const src = readFileSync(join(__dirname, 'background-parse-task.ts'), 'utf8');
    expect(src).toMatch(/PARSE_BACKGROUND_TASK_NAME/);
    expect(src).toMatch(/expo-background-task/);
    expect(src).toMatch(/expo-task-manager/);
    expect(src).toMatch(/ParseJobRunner/);
    expect(src).toMatch(/openAppDatabase/);
    expect(src).toMatch(/OpenAiCompatibleParseTransport/);
    expect(src).toMatch(/SecureProviderConfigRepository/);
    expect(src).toMatch(/SelectedAiParseTransport/);
    expect(src).toMatch(/SecureManagedPilotRepository/);
    expect(src.includes('FakeAiParseTransport')).toBe(false);
    expect(src.includes('demoRecordsFromText')).toBe(false);
    expect(src).toMatch(/setSharedParseJobRunner/);
    expect(src).toMatch(/registerParseBackgroundTask/);
    expect(src).toMatch(/minimumInterval/);
  });

  // Positive: shared coordination export names are present
  it('exports single-process coordination symbols by name', () => {
    const src = readFileSync(join(__dirname, 'background-parse-task.ts'), 'utf8');
    expect(src).toMatch(/export function setSharedParseJobRunner/);
    expect(src).toMatch(/export function getSharedParseJobRunner/);
    expect(src).toMatch(/export async function runBackgroundParseJobs/);
    expect(src).toMatch(/export async function registerParseBackgroundTask/);
    expect(src).toMatch(/bookkeeping-parse-jobs/);
    expect(src).toMatch(/ExpoCryptoIdGenerator/);
    expect(src).toMatch(/BackgroundSchedulingRegistration/);
    expect(src).toMatch(/status: 'degraded'/);
  });
});
