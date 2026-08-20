import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

export function digestSecret(value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex');
}

export function digestPayload(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newInviteCode(): string {
  return `bkp_${randomBytes(18).toString('base64url')}`;
}

export function newAccessToken(): string {
  return `bmp_${randomBytes(32).toString('base64url')}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
