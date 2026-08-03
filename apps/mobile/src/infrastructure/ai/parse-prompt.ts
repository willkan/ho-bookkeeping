import type { ParseRequest } from '@bookkeeping/contracts';

/**
 * System instructions for Chat Completions JSON mode (not Responses structured helpers).
 * Providers that require response_format=json_object typically need the word "JSON" and
 * an explicit example shape in the prompt. Keep one production path for all BYOK hosts.
 */
export const PARSE_SYSTEM_PROMPT = [
  'You extract flat peer consumption records from diary-like Chinese expense notes.',
  'Respond with a single JSON object only (no markdown fences).',
  'The JSON object must have shape: {"records":[...]} where records is an array of flat peer records.',
  'Return zero, one, or many records. Never nest children or shopping groups.',
  'Money fields are integer minor units (fen). Never use floating point.',
  'list_price_minor must equal actual_cost_minor + discount_minor.',
  'actual_cost_minor means the amount paid at this checkout.',
  'discount_minor means only the coupon deduction explicitly stated for this checkout.',
  'Chinese 花了/付了/实付 X means actual_cost_minor=X unless the text explicitly calls X 原价/账单金额.',
  'If actual paid is X and coupon deduction is Y, list_price_minor=X+Y.',
  'If original price is X and coupon deduction is Y, actual_cost_minor=X-Y.',
  'If no coupon deduction is explicitly stated, discount_minor=0 and list_price_minor=actual_cost_minor.',
  'Do not create, identify, match, or track coupon assets or coupon purchases.',
  'Copy timezone from the request onto every record. Never invent or change the timezone.',
  'Treat request submitted_at interpreted in request timezone as the only reference clock.',
  'Resolve explicit relative dates (for example 昨天, 前天, 上周五) and specific calendar dates from that reference.',
  'Never use the provider current time, request execution time, or response time for date resolution.',
  'If the note has no explicit event date or time, set occurred_at to request submitted_at and local_date to request local_date.',
  'If the note specifies a date but no clock time, retain the submitted_at local clock time on that resolved date.',
  'Derive local_date from occurred_at in timezone; these fields must describe the same local calendar date.',
  'Prefer existing tag_candidates when confident; otherwise create new tag names with a valid type',
  '(category|trip|place|merchant|channel|person|purpose|other).',
  'Treat 旅游 as a category for travel-related spending.',
  'Treat specifically named trip contexts such as 江西旅游 as trip.',
  'Do not use a trip tag instead of a category tag; attach both when both meanings are present.',
  'Each record fields: direction, merchant, note, occurred_at, timezone, local_date, currency (CNY),',
  'list_price_minor, actual_cost_minor, discount_minor, tags.',
  '',
  'EXAMPLE INPUT:',
  'raw_text: 午饭花了25元',
  'submitted_at: 2026-07-16T04:00:00.000Z',
  'timezone: Asia/Shanghai',
  'local_date: 2026-07-16',
  '',
  'EXAMPLE JSON OUTPUT:',
  JSON.stringify({
    records: [
      {
        direction: 'expense',
        merchant: null,
        note: '午饭',
        occurred_at: '2026-07-16T04:00:00.000Z',
        timezone: 'Asia/Shanghai',
        local_date: '2026-07-16',
        currency: 'CNY',
        list_price_minor: 2500,
        actual_cost_minor: 2500,
        discount_minor: 0,
        tags: [{ name: '餐饮', type: 'category' }],
      },
    ],
  }),
  '',
  'RELATIVE DATE EXAMPLE INPUT:',
  'raw_text: 昨天买菜花了30元',
  'submitted_at: 2026-07-16T04:00:00.000Z',
  'timezone: Asia/Shanghai',
  'local_date: 2026-07-16',
  '',
  'RELATIVE DATE EXAMPLE JSON OUTPUT:',
  JSON.stringify({
    records: [
      {
        direction: 'expense',
        merchant: null,
        note: '买菜',
        occurred_at: '2026-07-15T04:00:00.000Z',
        timezone: 'Asia/Shanghai',
        local_date: '2026-07-15',
        currency: 'CNY',
        list_price_minor: 3000,
        actual_cost_minor: 3000,
        discount_minor: 0,
        tags: [{ name: '买菜', type: 'category' }],
      },
    ],
  }),
  '',
  'COUPON DISCOUNT EXAMPLE INPUT:',
  'raw_text: 买菜实付300元，优惠券抵扣20元',
  '',
  'COUPON DISCOUNT JSON OUTPUT:',
  JSON.stringify({
    records: [
      {
        direction: 'expense',
        merchant: null,
        note: '买菜',
        occurred_at: '2026-07-16T04:00:00.000Z',
        timezone: 'Asia/Shanghai',
        local_date: '2026-07-16',
        currency: 'CNY',
        list_price_minor: 32000,
        actual_cost_minor: 30000,
        discount_minor: 2000,
        tags: [{ name: '买菜', type: 'category' }],
      },
    ],
  }),
].join('\n');

export function buildParseUserContent(request: ParseRequest): string {
  return JSON.stringify({
    raw_text: request.raw_text,
    submitted_at: request.submitted_at,
    timezone: request.timezone,
    local_date: request.local_date,
    mode_snapshot: request.mode_snapshot,
    tag_candidates: request.tag_candidates,
  });
}
