import type { PilotConfig } from './config';
import type { PilotDatabase } from './database';
import { PilotError } from './errors';
import { digestSecret, newAccessToken, newId, newInviteCode } from './secrets';

type EntitlementView = {
  subject_id: string;
  invite_id: string;
  expires_at: number;
  total_limit: number;
  daily_limit: number;
  consumed_total: number;
};

export type AuthenticatedSubject = {
  subjectId: string;
  inviteId: string;
};

export type IssuedInvite = {
  inviteId: string;
  inviteCode: string;
  recipientLabel: string;
  createdAt: number;
  entitlementDays: number;
  totalLimit: number;
  dailyLimit: number;
};

export type InviteEntitlementLimits = {
  entitlementDays: number;
  totalLimit: number;
  dailyLimit: number;
};

export type AdminInviteSummary = {
  inviteId: string;
  recipientLabel: string | null;
  subjectId: string | null;
  createdAt: number;
  activatedAt: number | null;
  revokedAt: number | null;
  entitlementExpiresAt: number | null;
  consumedTotal: number;
  totalLimit: number | null;
  dailyLimit: number | null;
  entitlementDays: number;
  successfulRequests: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
  willingness: PilotWillingness | null;
  feedbackUpdatedAt: number | null;
};

export const PILOT_WILLINGNESS = ['willing', 'unsure', 'not_willing'] as const;
export type PilotWillingness = (typeof PILOT_WILLINGNESS)[number];

export type PilotFeedback = {
  willingness: PilotWillingness;
  createdAt: number;
  updatedAt: number;
};

export type AdminUsageRequest = {
  inviteId: string;
  subjectId: string;
  requestId: string;
  status: string;
  contractVersion: string;
  model: string;
  providerHost: string;
  createdAt: number;
  completedAt: number | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
  errorCategory: string | null;
};

export type ActivationResult = {
  subjectId: string;
  inviteId: string;
  accessToken: string;
  tokenExpiresAt: number;
  entitlementExpiresAt: number;
  totalLimit: number;
  dailyLimit: number;
  consumedTotal: number;
};

export type UsageMeta = {
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
};

export class PilotStore {
  constructor(
    private readonly db: PilotDatabase,
    private readonly config: PilotConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.db
      .prepare(
        `UPDATE invites SET entitlement_days = ?, entitlement_total_limit = ?, entitlement_daily_limit = ?
         WHERE entitlement_days IS NULL OR entitlement_total_limit IS NULL OR entitlement_daily_limit IS NULL`,
      )
      .run(this.config.entitlementDays, this.config.entitlementTotal, this.config.entitlementDaily);
  }

  issueInvite(
    recipientLabel: string,
    limits: InviteEntitlementLimits = {
      entitlementDays: this.config.entitlementDays,
      totalLimit: this.config.entitlementTotal,
      dailyLimit: this.config.entitlementDaily,
    },
  ): IssuedInvite {
    const normalizedLabel = recipientLabel.trim();
    if (normalizedLabel.length < 1 || normalizedLabel.length > 80) {
      throw new PilotError('invalid_request', 400, 'invalid recipient label');
    }
    validateInviteLimits(limits);
    const inviteCode = newInviteCode();
    const inviteId = newId('inv');
    const createdAt = this.now();
    this.db
      .prepare(
        `INSERT INTO invites(id, code_hash, recipient_label, created_at,
          entitlement_days, entitlement_total_limit, entitlement_daily_limit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        inviteId,
        digestSecret(inviteCode, this.config.inviteHashPepper),
        normalizedLabel,
        createdAt,
        limits.entitlementDays,
        limits.totalLimit,
        limits.dailyLimit,
      );
    return { inviteId, inviteCode, recipientLabel: normalizedLabel, createdAt, ...limits };
  }

  activate(inviteCode: string, activationId: string): ActivationResult {
    const now = this.now();
    const codeHash = digestSecret(inviteCode, this.config.inviteHashPepper);
    const activationHash = digestSecret(activationId, this.config.inviteHashPepper);
    const entitlement = this.db
      .transaction(() => {
        const invite = this.db
          .prepare(
            `SELECT id, subject_id, activation_id_hash, revoked_at,
              entitlement_days, entitlement_total_limit, entitlement_daily_limit
             FROM invites WHERE code_hash = ?`,
          )
          .get(codeHash) as
          | {
              id: string;
              subject_id: string | null;
              activation_id_hash: string | null;
              revoked_at: number | null;
              entitlement_days: number;
              entitlement_total_limit: number;
              entitlement_daily_limit: number;
            }
          | undefined;
        if (!invite || invite.revoked_at)
          throw new PilotError('invite_unavailable', 403, 'invite unavailable');
        let subjectId = invite.subject_id;
        if (!subjectId) {
          subjectId = newId('sub');
          const expiresAt = now + invite.entitlement_days * 86_400_000;
          this.db.prepare('INSERT INTO subjects(id, created_at) VALUES (?, ?)').run(subjectId, now);
          this.db
            .prepare(
              `INSERT INTO entitlements(subject_id, invite_id, starts_at, expires_at, total_limit, daily_limit, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              subjectId,
              invite.id,
              now,
              expiresAt,
              invite.entitlement_total_limit,
              invite.entitlement_daily_limit,
              now,
              now,
            );
          this.db
            .prepare(
              'UPDATE invites SET subject_id = ?, activation_id_hash = ?, activated_at = ? WHERE id = ?',
            )
            .run(subjectId, activationHash, now, invite.id);
        } else if (invite.activation_id_hash !== activationHash) {
          throw new PilotError('invite_unavailable', 409, 'invite already activated');
        }
        const row = this.db
          .prepare(
            `SELECT e.subject_id, e.invite_id, e.expires_at, e.total_limit, e.daily_limit, e.consumed_total
           FROM entitlements e JOIN subjects s ON s.id = e.subject_id
           WHERE e.subject_id = ? AND e.revoked_at IS NULL AND s.revoked_at IS NULL`,
          )
          .get(subjectId) as EntitlementView | undefined;
        if (!row || row.expires_at <= now) {
          throw new PilotError('entitlement_unavailable', 403, 'entitlement unavailable');
        }
        return row;
      })
      .immediate();
    const accessToken = newAccessToken();
    const tokenExpiresAt = Math.min(
      entitlement.expires_at,
      now + this.config.accessTokenTtlSeconds * 1000,
    );
    this.db
      .prepare(
        'INSERT INTO access_tokens(token_hash, subject_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(
        digestSecret(accessToken, this.config.inviteHashPepper),
        entitlement.subject_id,
        now,
        tokenExpiresAt,
      );
    return {
      subjectId: entitlement.subject_id,
      inviteId: entitlement.invite_id,
      accessToken,
      tokenExpiresAt,
      entitlementExpiresAt: entitlement.expires_at,
      totalLimit: entitlement.total_limit,
      dailyLimit: entitlement.daily_limit,
      consumedTotal: entitlement.consumed_total,
    };
  }

  authenticate(token: string): AuthenticatedSubject {
    const row = this.db
      .prepare(
        `SELECT t.subject_id, e.invite_id FROM access_tokens t
         JOIN subjects s ON s.id = t.subject_id
         JOIN entitlements e ON e.subject_id = t.subject_id
         WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ?
           AND s.revoked_at IS NULL AND e.revoked_at IS NULL AND e.expires_at > ?`,
      )
      .get(digestSecret(token, this.config.inviteHashPepper), this.now(), this.now()) as
      | { subject_id: string; invite_id: string }
      | undefined;
    if (!row) throw new PilotError('unauthorized', 401, 'invalid access credential');
    return { subjectId: row.subject_id, inviteId: row.invite_id };
  }

  reserve(subjectId: string, requestId: string, digest: string, contractVersion: string): void {
    const now = this.now();
    const usageDate = localDate(now, this.config.quotaTimezone);
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `UPDATE usage_requests SET status = 'failed', completed_at = ?, error_category = 'reservation_expired'
           WHERE status = 'reserved' AND reserved_until <= ?`,
          )
          .run(now, now);
        const existing = this.db
          .prepare(
            'SELECT request_digest, status FROM usage_requests WHERE subject_id = ? AND request_id = ?',
          )
          .get(subjectId, requestId) as { request_digest: string; status: string } | undefined;
        if (existing) {
          if (existing.request_digest !== digest) {
            throw new PilotError(
              'replay_detected',
              409,
              'request id reused with different content',
            );
          }
          throw new PilotError('already_processed', 409, `request already ${existing.status}`);
        }
        const entitlement = this.db
          .prepare(
            `SELECT expires_at, total_limit, daily_limit, consumed_total FROM entitlements
           WHERE subject_id = ? AND revoked_at IS NULL`,
          )
          .get(subjectId) as
          | { expires_at: number; total_limit: number; daily_limit: number; consumed_total: number }
          | undefined;
        if (!entitlement || entitlement.expires_at <= now) {
          throw new PilotError('entitlement_unavailable', 403, 'entitlement unavailable');
        }
        const oneMinuteAgo = now - 60_000;
        const globalRecent = count(
          this.db,
          'SELECT COUNT(*) n FROM usage_requests WHERE created_at > ?',
          oneMinuteAgo,
        );
        const userRecent = count(
          this.db,
          'SELECT COUNT(*) n FROM usage_requests WHERE subject_id = ? AND created_at > ?',
          subjectId,
          oneMinuteAgo,
        );
        if (
          globalRecent >= this.config.globalRatePerMinute ||
          userRecent >= this.config.userRatePerMinute
        ) {
          throw new PilotError('rate_limited', 429, 'request rate exceeded');
        }
        const globalActive = count(
          this.db,
          "SELECT COUNT(*) n FROM usage_requests WHERE status = 'reserved'",
        );
        const userActive = count(
          this.db,
          "SELECT COUNT(*) n FROM usage_requests WHERE subject_id = ? AND status = 'reserved'",
          subjectId,
        );
        if (
          globalActive >= this.config.globalConcurrency ||
          userActive >= this.config.userConcurrency
        ) {
          throw new PilotError('concurrency_limited', 429, 'concurrent request limit exceeded');
        }
        const userReserved = userActive;
        const dailyUsed = count(
          this.db,
          "SELECT COUNT(*) n FROM usage_requests WHERE subject_id = ? AND usage_date = ? AND status = 'succeeded'",
          subjectId,
          usageDate,
        );
        const dailyReserved = count(
          this.db,
          "SELECT COUNT(*) n FROM usage_requests WHERE subject_id = ? AND usage_date = ? AND status = 'reserved'",
          subjectId,
          usageDate,
        );
        if (
          entitlement.consumed_total + userReserved >= entitlement.total_limit ||
          dailyUsed + dailyReserved >= entitlement.daily_limit
        ) {
          throw new PilotError('quota_exhausted', 429, 'entitlement quota exhausted');
        }
        this.db
          .prepare(
            `INSERT INTO usage_requests(subject_id, request_id, request_digest, status, contract_version, model,
            provider_host, usage_date, created_at, reserved_until)
           VALUES (?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            subjectId,
            requestId,
            digest,
            contractVersion,
            this.config.upstreamModel,
            this.config.upstreamHost,
            usageDate,
            now,
            now + this.config.reservationTtlSeconds * 1000,
          );
      })
      .immediate();
  }

  succeed(subjectId: string, requestId: string, meta: UsageMeta): void {
    const now = this.now();
    this.db
      .transaction(() => {
        const result = this.db
          .prepare(
            `UPDATE usage_requests SET status = 'succeeded', completed_at = ?, latency_ms = ?,
           prompt_tokens = ?, completion_tokens = ?, total_tokens = ?,
           prompt_cache_hit_tokens = ?, prompt_cache_miss_tokens = ?
           WHERE subject_id = ? AND request_id = ? AND status = 'reserved'`,
          )
          .run(
            now,
            meta.latencyMs,
            meta.promptTokens,
            meta.completionTokens,
            meta.totalTokens,
            meta.promptCacheHitTokens,
            meta.promptCacheMissTokens,
            subjectId,
            requestId,
          );
        if (result.changes !== 1)
          throw new PilotError('already_processed', 409, 'request not reserved');
        this.db
          .prepare(
            'UPDATE entitlements SET consumed_total = consumed_total + 1, updated_at = ? WHERE subject_id = ?',
          )
          .run(now, subjectId);
      })
      .immediate();
  }

  fail(subjectId: string, requestId: string, category: string, latencyMs: number): void {
    this.db
      .prepare(
        `UPDATE usage_requests SET status = 'failed', completed_at = ?, latency_ms = ?, error_category = ?
         WHERE subject_id = ? AND request_id = ? AND status = 'reserved'`,
      )
      .run(this.now(), latencyMs, category, subjectId, requestId);
  }

  getFeedback(subjectId: string): PilotFeedback | null {
    const row = this.db
      .prepare(
        `SELECT willingness, created_at createdAt, updated_at updatedAt
         FROM pilot_feedback WHERE subject_id = ?`,
      )
      .get(subjectId) as PilotFeedback | undefined;
    return row ?? null;
  }

  upsertFeedback(subjectId: string, willingness: PilotWillingness): PilotFeedback {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO pilot_feedback(subject_id, willingness, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(subject_id) DO UPDATE SET
           willingness = excluded.willingness,
           updated_at = excluded.updated_at`,
      )
      .run(subjectId, willingness, now, now);
    return this.getFeedback(subjectId)!;
  }

  revokeInvite(inviteCode: string): void {
    const codeHash = digestSecret(inviteCode, this.config.inviteHashPepper);
    const row = this.db
      .prepare('SELECT id, subject_id FROM invites WHERE code_hash = ?')
      .get(codeHash) as { id: string; subject_id: string | null } | undefined;
    if (!row) throw new Error('invite not found');
    this.revokeInviteRecord(row.id, row.subject_id);
  }

  revokeInviteById(inviteId: string): void {
    const row = this.db.prepare('SELECT subject_id FROM invites WHERE id = ?').get(inviteId) as
      | { subject_id: string | null }
      | undefined;
    if (!row) throw new PilotError('invalid_request', 404, 'invite not found');
    this.revokeInviteRecord(inviteId, row.subject_id);
  }

  listAdminInvites(): AdminInviteSummary[] {
    return this.db
      .prepare(
        `SELECT i.id inviteId, i.recipient_label recipientLabel, i.subject_id subjectId,
          i.created_at createdAt, i.activated_at activatedAt, i.revoked_at revokedAt,
          e.expires_at entitlementExpiresAt, COALESCE(e.consumed_total, 0) consumedTotal,
          COALESCE(e.total_limit, i.entitlement_total_limit) totalLimit,
          COALESCE(e.daily_limit, i.entitlement_daily_limit) dailyLimit,
          i.entitlement_days entitlementDays,
          COUNT(CASE WHEN u.status = 'succeeded' THEN 1 END) successfulRequests,
          SUM(CASE WHEN u.status = 'succeeded' THEN u.prompt_tokens END) promptTokens,
          SUM(CASE WHEN u.status = 'succeeded' THEN u.completion_tokens END) completionTokens,
          SUM(CASE WHEN u.status = 'succeeded' THEN u.total_tokens END) totalTokens,
          SUM(CASE WHEN u.status = 'succeeded' THEN u.prompt_cache_hit_tokens END) promptCacheHitTokens,
          SUM(CASE WHEN u.status = 'succeeded' THEN u.prompt_cache_miss_tokens END) promptCacheMissTokens,
          f.willingness willingness, f.updated_at feedbackUpdatedAt
        FROM invites i
        LEFT JOIN entitlements e ON e.invite_id = i.id
        LEFT JOIN usage_requests u ON u.subject_id = i.subject_id
        LEFT JOIN pilot_feedback f ON f.subject_id = i.subject_id
        GROUP BY i.id
        ORDER BY i.created_at DESC`,
      )
      .all() as AdminInviteSummary[];
  }

  listAdminUsageRequests(limit = 200): AdminUsageRequest[] {
    return this.db
      .prepare(
        `SELECT e.invite_id inviteId, u.subject_id subjectId, u.request_id requestId,
          u.status, u.contract_version contractVersion, u.model, u.provider_host providerHost,
          u.created_at createdAt, u.completed_at completedAt, u.latency_ms latencyMs,
          u.prompt_tokens promptTokens, u.completion_tokens completionTokens,
          u.total_tokens totalTokens, u.prompt_cache_hit_tokens promptCacheHitTokens,
          u.prompt_cache_miss_tokens promptCacheMissTokens, u.error_category errorCategory
        FROM usage_requests u
        JOIN entitlements e ON e.subject_id = u.subject_id
        ORDER BY u.created_at DESC
        LIMIT ?`,
      )
      .all(limit) as AdminUsageRequest[];
  }

  private revokeInviteRecord(inviteId: string, subjectId: string | null): void {
    const now = this.now();
    this.db.transaction(() => {
      this.db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ?').run(now, inviteId);
      if (subjectId) {
        this.db.prepare('UPDATE subjects SET revoked_at = ? WHERE id = ?').run(now, subjectId);
        this.db
          .prepare('UPDATE entitlements SET revoked_at = ?, updated_at = ? WHERE subject_id = ?')
          .run(now, now, subjectId);
        this.db
          .prepare(
            'UPDATE access_tokens SET revoked_at = ? WHERE subject_id = ? AND revoked_at IS NULL',
          )
          .run(now, subjectId);
      }
    })();
  }
}

function count(db: PilotDatabase, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function localDate(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function validateInviteLimits(limits: InviteEntitlementLimits): void {
  const values = [limits.entitlementDays, limits.totalLimit, limits.dailyLimit];
  if (values.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new PilotError('invalid_request', 400, 'invalid invite entitlement limits');
  }
  if (limits.entitlementDays > 365 || limits.totalLimit > 100_000 || limits.dailyLimit > 10_000) {
    throw new PilotError('invalid_request', 400, 'invite entitlement limits too large');
  }
  if (limits.dailyLimit > limits.totalLimit) {
    throw new PilotError('invalid_request', 400, 'daily limit exceeds total limit');
  }
}
