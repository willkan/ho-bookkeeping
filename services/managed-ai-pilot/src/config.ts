import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();

const EnvSchema = z.object({
  PILOT_HOST: z.string().default('127.0.0.1'),
  PILOT_PORT: z.coerce.number().int().min(1).max(65535).default(18084),
  PILOT_DATABASE_PATH: z.string().min(1).default('./data/pilot.sqlite'),
  PILOT_INVITE_HASH_PEPPER: z.string().min(32),
  PILOT_UPSTREAM_API_KEY: z.string().min(1),
  PILOT_UPSTREAM_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  PILOT_UPSTREAM_MODEL: z.string().min(1),
  PILOT_PUBLIC_ORIGIN: z.string().url().default('https://bookkeeping.holic.work'),
  PILOT_ADMIN_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .default('admin'),
  PILOT_ADMIN_PASSWORD: z.string().min(24),
  PILOT_ADMIN_RATE_PER_MINUTE: positiveInt.default(60),
  PILOT_ENTITLEMENT_DAYS: positiveInt.default(30),
  PILOT_ENTITLEMENT_TOTAL: positiveInt.default(200),
  PILOT_ENTITLEMENT_DAILY: positiveInt.default(20),
  PILOT_ACCESS_TOKEN_TTL_SECONDS: positiveInt.default(86400),
  PILOT_USER_RATE_PER_MINUTE: positiveInt.default(10),
  PILOT_GLOBAL_RATE_PER_MINUTE: positiveInt.default(100),
  PILOT_USER_CONCURRENCY: positiveInt.default(1),
  PILOT_GLOBAL_CONCURRENCY: positiveInt.default(8),
  PILOT_ACTIVATE_RATE_PER_MINUTE: positiveInt.default(10),
  PILOT_FEEDBACK_RATE_PER_MINUTE: positiveInt.default(10),
  PILOT_RESERVATION_TTL_SECONDS: positiveInt.default(90),
  PILOT_UPSTREAM_TIMEOUT_MS: positiveInt.default(45000),
  PILOT_MAX_COMPLETION_TOKENS: positiveInt.default(4096),
  PILOT_MAX_BODY_BYTES: positiveInt.default(65536),
  PILOT_QUOTA_TIMEZONE: z.string().default('Asia/Shanghai'),
  PILOT_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type PilotConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.parse(env);
  const upstream = new URL(parsed.PILOT_UPSTREAM_BASE_URL);
  if (upstream.protocol !== 'https:') throw new Error('PILOT_UPSTREAM_BASE_URL must use HTTPS');
  const publicOrigin = new URL(parsed.PILOT_PUBLIC_ORIGIN);
  if (publicOrigin.protocol !== 'https:' || publicOrigin.pathname !== '/') {
    throw new Error('PILOT_PUBLIC_ORIGIN must be an HTTPS origin without a path');
  }
  new Intl.DateTimeFormat('en-CA', { timeZone: parsed.PILOT_QUOTA_TIMEZONE }).format(new Date());
  return {
    host: parsed.PILOT_HOST,
    port: parsed.PILOT_PORT,
    databasePath: parsed.PILOT_DATABASE_PATH,
    inviteHashPepper: parsed.PILOT_INVITE_HASH_PEPPER,
    upstreamApiKey: parsed.PILOT_UPSTREAM_API_KEY,
    upstreamBaseUrl: upstream.toString().replace(/\/$/, ''),
    upstreamHost: upstream.host,
    upstreamModel: parsed.PILOT_UPSTREAM_MODEL,
    publicOrigin: publicOrigin.origin,
    adminUsername: parsed.PILOT_ADMIN_USERNAME,
    adminPassword: parsed.PILOT_ADMIN_PASSWORD,
    adminRatePerMinute: parsed.PILOT_ADMIN_RATE_PER_MINUTE,
    entitlementDays: parsed.PILOT_ENTITLEMENT_DAYS,
    entitlementTotal: parsed.PILOT_ENTITLEMENT_TOTAL,
    entitlementDaily: parsed.PILOT_ENTITLEMENT_DAILY,
    accessTokenTtlSeconds: parsed.PILOT_ACCESS_TOKEN_TTL_SECONDS,
    userRatePerMinute: parsed.PILOT_USER_RATE_PER_MINUTE,
    globalRatePerMinute: parsed.PILOT_GLOBAL_RATE_PER_MINUTE,
    userConcurrency: parsed.PILOT_USER_CONCURRENCY,
    globalConcurrency: parsed.PILOT_GLOBAL_CONCURRENCY,
    activateRatePerMinute: parsed.PILOT_ACTIVATE_RATE_PER_MINUTE,
    feedbackRatePerMinute: parsed.PILOT_FEEDBACK_RATE_PER_MINUTE,
    reservationTtlSeconds: parsed.PILOT_RESERVATION_TTL_SECONDS,
    upstreamTimeoutMs: parsed.PILOT_UPSTREAM_TIMEOUT_MS,
    maxCompletionTokens: parsed.PILOT_MAX_COMPLETION_TOKENS,
    maxBodyBytes: parsed.PILOT_MAX_BODY_BYTES,
    quotaTimezone: parsed.PILOT_QUOTA_TIMEZONE,
    logLevel: parsed.PILOT_LOG_LEVEL,
  };
}
