import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { PilotConfig } from './config';
import { PilotError } from './errors';
import { FixedWindowLimiter } from './rate-limit';
import type { PilotStore } from './store';
import { adminPage } from './admin-page';

const IssueInviteSchema = z
  .object({
    recipient_label: z.string().trim().min(1).max(80),
    entitlement_days: z.number().int().min(1).max(365),
    total_limit: z.number().int().min(1).max(100_000),
    daily_limit: z.number().int().min(1).max(10_000),
  })
  .strict()
  .refine((value) => value.daily_limit <= value.total_limit);
const InviteIdSchema = z.string().regex(/^inv_[0-9a-f-]{36}$/);

export function createAdminHttpHandler(config: PilotConfig, store: PilotStore, logger: Logger) {
  const limiter = new FixedWindowLimiter(config.adminRatePerMinute);
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
  ): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://pilot.local');
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return false;
    let action = 'admin_request';
    try {
      limiter.take(clientAddress(request));
      requireAdmin(request, config);
      if (request.method === 'GET' && url.pathname === '/admin') {
        action = 'view_admin';
        const nonce = randomBytes(18).toString('base64');
        sendHtml(
          response,
          adminPage(nonce, {
            entitlementDays: config.entitlementDays,
            totalLimit: config.entitlementTotal,
            dailyLimit: config.entitlementDaily,
          }),
          nonce,
        );
      } else if (request.method === 'GET' && url.pathname === '/admin/api/overview') {
        action = 'view_usage';
        sendJson(response, 200, {
          invites: store.listAdminInvites(),
          requests: store.listAdminUsageRequests(),
        });
      } else if (request.method === 'POST' && url.pathname === '/admin/api/invites') {
        action = 'issue_invite';
        requireSameOrigin(request, config);
        requireJson(request);
        const input = IssueInviteSchema.parse(await readJson(request, 8192));
        const issued = store.issueInvite(input.recipient_label, {
          entitlementDays: input.entitlement_days,
          totalLimit: input.total_limit,
          dailyLimit: input.daily_limit,
        });
        logger.info({
          request_id: requestId,
          admin_action: action,
          invite_id: issued.inviteId,
          status: 'ok',
        });
        sendJson(response, 201, issued);
        return true;
      } else {
        const match = /^\/admin\/api\/invites\/(inv_[0-9a-f-]{36})\/revoke$/.exec(url.pathname);
        if (request.method !== 'POST' || !match?.[1]) {
          throw new PilotError('invalid_request', 404, 'not found');
        }
        action = 'revoke_invite';
        requireSameOrigin(request, config);
        requireJson(request);
        z.object({})
          .strict()
          .parse(await readJson(request, 8192));
        const inviteId = InviteIdSchema.parse(match[1]);
        store.revokeInviteById(inviteId);
        logger.info({
          request_id: requestId,
          admin_action: action,
          invite_id: inviteId,
          status: 'ok',
        });
        sendJson(response, 200, { status: 'revoked', inviteId });
        return true;
      }
      logger.info({ request_id: requestId, admin_action: action, status: 'ok' });
    } catch (error) {
      const classified = classify(error);
      logger.info({
        request_id: requestId,
        admin_action: action,
        status: 'error',
        error_category: classified.category,
      });
      sendJson(
        response,
        classified.httpStatus,
        { status: 'error', error_category: classified.category, message: classified.message },
        classified.httpStatus === 401
          ? { 'www-authenticate': 'Basic realm="Bookkeeping Pilot Admin", charset="UTF-8"' }
          : undefined,
      );
    }
    return true;
  };
}

function requireAdmin(request: IncomingMessage, config: PilotConfig): void {
  const expected = `Basic ${Buffer.from(`${config.adminUsername}:${config.adminPassword}`).toString('base64')}`;
  if (!constantEqual(request.headers.authorization ?? '', expected)) {
    throw new PilotError('unauthorized', 401, 'administrator authentication required');
  }
}

function constantEqual(actual: string, expected: string): boolean {
  const left = createHash('sha256').update(actual).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function requireSameOrigin(request: IncomingMessage, config: PilotConfig): void {
  if (request.headers.origin !== config.publicOrigin) {
    throw new PilotError('unauthorized', 403, 'cross-origin mutation rejected');
  }
}

function requireJson(request: IncomingMessage): void {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new PilotError('invalid_request', 415, 'content type must be application/json');
  }
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new PilotError('invalid_request', 413, 'request body too large');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new PilotError('invalid_request', 400, 'invalid JSON');
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  response.end(encoded);
}

function sendHtml(response: ServerResponse, body: string, nonce: string): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  return (
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ||
    request.socket.remoteAddress ||
    'unknown'
  );
}

function classify(error: unknown): PilotError {
  if (error instanceof PilotError) return error;
  if (error instanceof z.ZodError) return new PilotError('invalid_request', 400, 'invalid request');
  return new PilotError('provider_error', 500, 'internal service error');
}
