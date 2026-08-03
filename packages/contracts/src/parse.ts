import { z } from 'zod';

/**
 * Versioned AI parse request / proposal contract.
 * Built on device; provider output is validated against this shape locally.
 * Not a domain entity, SQLite row, or deployment gateway DTO.
 */
export const CONTRACT_VERSION = '2.1.0' as const;

export const TagTypeSchema = z.enum([
  'category',
  'trip',
  'place',
  'merchant',
  'channel',
  'person',
  'purpose',
  'other',
]);
export type TagType = z.infer<typeof TagTypeSchema>;

/** Integer minor units only — never floating point money on the wire. */
export const MoneyMinorSchema = z.number().int();

const localDateFormatters = new Map<string, Intl.DateTimeFormat>();

function localDateForInstant(instant: string, timezone: string): string | null {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  try {
    let formatter = localDateFormatters.get(timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      localDateFormatters.set(timezone, formatter);
    }
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

export const CandidateTagSchema = z.object({
  name: z.string().min(1).max(64),
  type: TagTypeSchema,
  /** When AI is confident this maps to an existing local tag. */
  existing_tag_id: z.string().min(1).nullable().optional(),
});
export type CandidateTag = z.infer<typeof CandidateTagSchema>;

export const CandidateRecordSchema = z
  .object({
    direction: z.enum(['expense', 'income', 'transfer']),
    merchant: z.string().max(200).nullable(),
    note: z.string().max(500).nullable(),
    /** ISO-8601 instant when the consumption occurred. */
    occurred_at: z.string().min(1),
    timezone: z.string().min(1),
    /** Local calendar date YYYY-MM-DD for user-facing day grouping. */
    local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.literal('CNY'),
    /** 商品原价 */
    list_price_minor: MoneyMinorSchema.nonnegative(),
    /** 本次实付 */
    actual_cost_minor: MoneyMinorSchema.nonnegative(),
    /** 本次账单明确使用的优惠券抵扣 */
    discount_minor: MoneyMinorSchema.nonnegative(),
    tags: z.array(CandidateTagSchema),
  })
  .superRefine((record, context) => {
    const derivedLocalDate = localDateForInstant(record.occurred_at, record.timezone);
    if (!derivedLocalDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['occurred_at'],
        message: 'occurred_at must be a valid instant in a valid timezone',
      });
      return;
    }
    if (derivedLocalDate !== record.local_date) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['local_date'],
        message: 'local_date must match occurred_at in timezone',
      });
    }
  });
export type CandidateRecord = z.infer<typeof CandidateRecordSchema>;

export const TagCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: TagTypeSchema,
  aliases: z.array(z.string()),
});
export type TagCandidate = z.infer<typeof TagCandidateSchema>;

export const ModeSnapshotSchema = z.object({
  mode_id: z.string().min(1).nullable(),
  mode_name: z.string().min(1).nullable(),
  default_tags: z.array(
    z.object({
      tag_id: z.string().min(1).nullable(),
      name: z.string().min(1),
      type: TagTypeSchema,
    }),
  ),
  include_in_mode_stats: z.boolean(),
});
export type ModeSnapshot = z.infer<typeof ModeSnapshotSchema>;

export const ParseRequestSchema = z.object({
  contract_version: z.literal(CONTRACT_VERSION),
  request_id: z.string().min(1).max(128),
  raw_text: z.string().min(1).max(4000),
  submitted_at: z.string().min(1),
  timezone: z.string().min(1),
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode_snapshot: ModeSnapshotSchema,
  /** Restricted local tag catalog for normalization suggestions — never the full ledger. */
  tag_candidates: z.array(TagCandidateSchema).max(200),
});
export type ParseRequest = z.infer<typeof ParseRequestSchema>;

export const ParseSuccessResponseSchema = z.object({
  contract_version: z.literal(CONTRACT_VERSION),
  request_id: z.string().min(1),
  status: z.literal('ok'),
  /** Flat peer consumption candidates. Empty list is valid (zero records). */
  records: z.array(CandidateRecordSchema),
});
export type ParseSuccessResponse = z.infer<typeof ParseSuccessResponseSchema>;

export const ParseErrorResponseSchema = z.object({
  contract_version: z.literal(CONTRACT_VERSION),
  request_id: z.string().min(1),
  status: z.literal('error'),
  error_category: z.enum([
    'invalid_request',
    'unsupported_contract_version',
    'provider_error',
    'model_output_invalid',
    'rate_limited',
    'timeout',
  ]),
  message: z.string().min(1).max(500),
});
export type ParseErrorResponse = z.infer<typeof ParseErrorResponseSchema>;

export const ParseResponseSchema = z.discriminatedUnion('status', [
  ParseSuccessResponseSchema,
  ParseErrorResponseSchema,
]);
export type ParseResponse = z.infer<typeof ParseResponseSchema>;
