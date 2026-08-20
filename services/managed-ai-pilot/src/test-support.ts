import { CONTRACT_VERSION, type ParseRequest } from '@bookkeeping/contracts';
import type { PilotConfig } from './config';

export function testConfig(overrides: Partial<PilotConfig> = {}): PilotConfig {
  return {
    host: '127.0.0.1',
    port: 18084,
    databasePath: ':memory:',
    inviteHashPepper: 'test-pepper-at-least-thirty-two-characters',
    upstreamApiKey: 'test-upstream-key',
    upstreamBaseUrl: 'https://api.deepseek.com',
    upstreamHost: 'api.deepseek.com',
    upstreamModel: 'deepseek-chat',
    publicOrigin: 'https://bookkeeping.holic.work',
    adminUsername: 'admin',
    adminPassword: 'test-admin-password-at-least-24-characters',
    adminRatePerMinute: 60,
    entitlementDays: 30,
    entitlementTotal: 200,
    entitlementDaily: 20,
    accessTokenTtlSeconds: 3600,
    userRatePerMinute: 10,
    globalRatePerMinute: 100,
    userConcurrency: 1,
    globalConcurrency: 8,
    activateRatePerMinute: 10,
    feedbackRatePerMinute: 10,
    reservationTtlSeconds: 90,
    upstreamTimeoutMs: 45000,
    maxCompletionTokens: 4096,
    maxBodyBytes: 65536,
    quotaTimezone: 'Asia/Shanghai',
    logLevel: 'info',
    ...overrides,
  };
}

export function parseRequest(requestId = 'req_1'): ParseRequest {
  return {
    contract_version: CONTRACT_VERSION,
    request_id: requestId,
    raw_text: '午饭花了25元',
    submitted_at: '2026-08-20T04:00:00.000Z',
    timezone: 'Asia/Shanghai',
    local_date: '2026-08-20',
    mode_snapshot: {
      mode_id: null,
      mode_name: null,
      default_tags: [],
      include_in_mode_stats: false,
    },
    tag_candidates: [],
  };
}
