import { ParseRequestSchema } from '@bookkeeping/contracts';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import { createAdminHttpHandler } from './admin-http';
import type { PilotConfig } from './config';
import { PilotError } from './errors';
import { FixedWindowLimiter } from './rate-limit';
import { digestPayload } from './secrets';
import { PILOT_WILLINGNESS, type PilotStore } from './store';
import type { ParseUpstream } from './upstream';

const ActivationSchema = z
  .object({
    invite_code: z.string().min(16).max(128),
    activation_id: z.string().min(16).max(128),
  })
  .strict();

const FeedbackSchema = z.object({ willingness: z.enum(PILOT_WILLINGNESS) }).strict();

export function createPilotHttpServer(
  config: PilotConfig,
  store: PilotStore,
  upstream: ParseUpstream,
  logger: Logger,
): Server {
  const activationLimiter = new FixedWindowLimiter(config.activateRatePerMinute);
  const feedbackLimiter = new FixedWindowLimiter(config.feedbackRatePerMinute);
  const handleAdmin = createAdminHttpHandler(config, store, logger);
  return createServer(async (request, response) => {
    const started = Date.now();
    const correlationId = safeRequestId(request.headers['x-request-id']) ?? `srv_${randomUUID()}`;
    let logRequestId = correlationId;
    let logSubject: string | undefined;
    let logInvite: string | undefined;
    let logContract: string | undefined;
    try {
      if (await handleAdmin(request, response, correlationId)) return;
      if (request.method === 'GET' && request.url === '/health') {
        return json(response, 200, { status: 'ok' });
      }
      if (request.method === 'POST' && request.url === '/activate') {
        activationLimiter.take(clientAddress(request));
        requireJson(request);
        const body = ActivationSchema.parse(await readJson(request, config.maxBodyBytes));
        const result = store.activate(body.invite_code, body.activation_id);
        logger.info({
          request_id: correlationId,
          anonymous_subject: result.subjectId,
          invite_id: result.inviteId,
          status: 'ok',
          latency_ms: Date.now() - started,
        });
        return json(response, 200, {
          request_id: correlationId,
          subject_id: result.subjectId,
          access_token: result.accessToken,
          access_token_expires_at: new Date(result.tokenExpiresAt).toISOString(),
          entitlement: {
            expires_at: new Date(result.entitlementExpiresAt).toISOString(),
            total_limit: result.totalLimit,
            daily_limit: result.dailyLimit,
            consumed_total: result.consumedTotal,
          },
        });
      }
      if (request.method === 'POST' && request.url === '/parse') {
        requireJson(request);
        const principal = store.authenticate(bearerToken(request));
        const { subjectId, inviteId } = principal;
        logSubject = subjectId;
        logInvite = inviteId;
        const rawBody = await readJson(request, config.maxBodyBytes);
        const parsed = ParseRequestSchema.safeParse(rawBody);
        const requestId = parsed.success ? parsed.data.request_id : correlationId;
        logRequestId = requestId;
        if (!parsed.success) throw new PilotError('invalid_request', 400, 'invalid parse request');
        logContract = parsed.data.contract_version;
        const canonical = JSON.stringify(parsed.data);
        store.reserve(
          subjectId,
          parsed.data.request_id,
          digestPayload(canonical),
          parsed.data.contract_version,
        );
        try {
          const result = await upstream.parse(parsed.data, subjectId);
          store.succeed(subjectId, parsed.data.request_id, result.usage);
          logger.info({
            request_id: requestId,
            anonymous_subject: subjectId,
            invite_id: inviteId,
            contract_version: parsed.data.contract_version,
            model: config.upstreamModel,
            provider_host: config.upstreamHost,
            latency_ms: result.usage.latencyMs,
            prompt_tokens: result.usage.promptTokens,
            completion_tokens: result.usage.completionTokens,
            total_tokens: result.usage.totalTokens,
            prompt_cache_hit_tokens: result.usage.promptCacheHitTokens,
            prompt_cache_miss_tokens: result.usage.promptCacheMissTokens,
            status: 'ok',
          });
          return json(response, 200, result.response);
        } catch (error) {
          const classified = asPilotError(error);
          store.fail(subjectId, parsed.data.request_id, classified.category, Date.now() - started);
          throw classified;
        }
      }
      if ((request.method === 'GET' || request.method === 'PUT') && request.url === '/feedback') {
        const { subjectId, inviteId } = store.authenticate(bearerToken(request));
        logSubject = subjectId;
        logInvite = inviteId;
        if (request.method === 'GET') {
          const feedback = store.getFeedback(subjectId);
          logger.info({
            request_id: correlationId,
            anonymous_subject: subjectId,
            invite_id: inviteId,
            feedback_action: 'read',
            status: 'ok',
            latency_ms: Date.now() - started,
          });
          return json(response, 200, feedbackResponse(correlationId, feedback));
        }
        feedbackLimiter.take(subjectId);
        requireJson(request);
        const body = FeedbackSchema.parse(await readJson(request, config.maxBodyBytes));
        const feedback = store.upsertFeedback(subjectId, body.willingness);
        logger.info({
          request_id: correlationId,
          anonymous_subject: subjectId,
          invite_id: inviteId,
          feedback_action: 'update',
          status: 'ok',
          latency_ms: Date.now() - started,
        });
        return json(response, 200, feedbackResponse(correlationId, feedback));
      }
      throw new PilotError('invalid_request', 404, 'not found');
    } catch (error) {
      const classified = asPilotError(error);
      logger.info({
        request_id: logRequestId,
        ...(logSubject ? { anonymous_subject: logSubject } : {}),
        ...(logInvite ? { invite_id: logInvite } : {}),
        ...(logContract
          ? {
              contract_version: logContract,
              model: config.upstreamModel,
              provider_host: config.upstreamHost,
            }
          : {}),
        status: 'error',
        error_category: classified.category,
        latency_ms: Date.now() - started,
      });
      return json(response, classified.httpStatus, {
        request_id: logRequestId,
        status: 'error',
        error_category: classified.category,
        message: classified.message,
      });
    }
  });
}

function feedbackResponse(
  requestId: string,
  feedback: ReturnType<PilotStore['getFeedback']>,
): Record<string, unknown> {
  return {
    request_id: requestId,
    willingness: feedback?.willingness ?? null,
    updated_at: feedback ? new Date(feedback.updatedAt).toISOString() : null,
  };
}

function safeRequestId(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9_.:-]{1,128}$/.test(candidate) ? candidate : null;
}

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || request.socket.remoteAddress || 'unknown';
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(authorization ?? '');
  if (!match?.[1]) throw new PilotError('unauthorized', 401, 'missing access credential');
  return match[1];
}

function requireJson(request: IncomingMessage): void {
  const type = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json')
    throw new PilotError('invalid_request', 415, 'content type must be application/json');
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const length = Number(request.headers['content-length'] ?? 0);
  if (length > maxBytes) throw new PilotError('invalid_request', 413, 'request body too large');
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

function json(response: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(encoded);
}

function asPilotError(error: unknown): PilotError {
  if (error instanceof PilotError) return error;
  if (error instanceof z.ZodError) return new PilotError('invalid_request', 400, 'invalid request');
  return new PilotError('provider_error', 500, 'internal service error');
}
