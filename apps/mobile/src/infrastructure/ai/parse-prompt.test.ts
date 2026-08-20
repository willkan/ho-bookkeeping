import {
  CandidateRecordSchema,
  ParseSuccessResponseSchema,
  CONTRACT_VERSION,
} from '@bookkeeping/contracts';
import { describe, expect, it } from 'vitest';
import { buildParseUserContent, PARSE_SYSTEM_PROMPT } from '@bookkeeping/ai-parse-prompt';

/** Extract the first fenced or bare JSON object after EXAMPLE JSON OUTPUT. */
function extractExampleJsonOutput(prompt: string): unknown {
  const marker = /EXAMPLE JSON OUTPUT/i;
  const idx = prompt.search(marker);
  expect(idx).toBeGreaterThanOrEqual(0);
  const after = prompt.slice(idx);
  const jsonStart = after.indexOf('{');
  expect(jsonStart).toBeGreaterThanOrEqual(0);
  // Brace-match the first object after the marker.
  let depth = 0;
  let end = -1;
  for (let i = jsonStart; i < after.length; i += 1) {
    const ch = after[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end).toBeGreaterThan(jsonStart);
  return JSON.parse(after.slice(jsonStart, end + 1));
}

describe('PARSE_SYSTEM_PROMPT for Chat Completions JSON mode', () => {
  it('anchors relative dates to submitted_at and timezone instead of provider execution time', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/relative date/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/昨天/);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/前天/);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/submitted_at.*timezone/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/never use.*current/i);
  });
  it('uses submitted_at only when the note contains no event date or time', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/no explicit event date or time/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/occurred_at.*submitted_at/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/local_date.*request local_date/i);
  });

  it('distinguishes the travel consumption category from other trip context', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/旅游.*category/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/江西旅游.*other/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/do not use.*other.*instead of.*category/i);
  });

  it('treats coupon use as checkout discount without coupon identity or purchase tracking', () => {
    expect(PARSE_SYSTEM_PROMPT).toContain('"actual_cost_minor":30000');
    expect(PARSE_SYSTEM_PROMPT).toContain('"discount_minor":2000');
    expect(PARSE_SYSTEM_PROMPT).not.toMatch(/coupon_id|available_coupons|coupon_purchase/i);
    expect(PARSE_SYSTEM_PROMPT).not.toMatch(/COUPON ACQUISITION/i);
  });

  it('attributes a discounted voucher cost to the current consumption', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/face value.*purchase cost|purchase cost.*face value/i);
    expect(PARSE_SYSTEM_PROMPT).toContain('raw_text: 661买菜。用了412抵500的券。');
    expect(PARSE_SYSTEM_PROMPT).toContain('"list_price_minor":66100');
    expect(PARSE_SYSTEM_PROMPT).toContain('"actual_cost_minor":57300');
    expect(PARSE_SYSTEM_PROMPT).toContain('"discount_minor":8800');
  });

  it('sends no coupon catalog or ledger history', () => {
    const content = buildParseUserContent({
      contract_version: CONTRACT_VERSION,
      request_id: 'req_1',
      raw_text: '买菜用券',
      submitted_at: '2026-07-16T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
      local_date: '2026-07-16',
      mode_snapshot: {
        mode_id: null,
        mode_name: null,
        default_tags: [],
        include_in_mode_stats: false,
      },
      tag_candidates: [],
    });
    expect(content).not.toContain('"available_coupons"');
    expect(content).not.toContain('coupon_id');
    expect(content).not.toContain('purchase_record_id');
    expect(content).not.toContain('raw_inputs');
  });

  // Positive: prompt mentions JSON (required by many OpenAI-compatible providers for json_object)
  it('includes the word JSON and response shape guidance', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/JSON/);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/"records"/);
  });

  // Positive: complete EXAMPLE INPUT / EXAMPLE JSON OUTPUT for a simple Chinese expense
  it('contains EXAMPLE INPUT and a complete EXAMPLE JSON OUTPUT', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/EXAMPLE INPUT/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/EXAMPLE JSON OUTPUT/i);
  });

  // Positive: example output satisfies CandidateRecordSchema and arithmetic invariants
  it('example JSON output validates against CandidateRecordSchema with money invariants', () => {
    const example = extractExampleJsonOutput(PARSE_SYSTEM_PROMPT) as {
      records: Record<string, unknown>[];
    };
    expect(Array.isArray(example.records)).toBe(true);
    expect(example.records.length).toBeGreaterThanOrEqual(1);

    for (const record of example.records) {
      const parsed = CandidateRecordSchema.safeParse(record);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      const r = parsed.data;
      expect(r.list_price_minor).toBe(r.actual_cost_minor + r.discount_minor);
      expect(r.currency).toBe('CNY');
      expect(Number.isInteger(r.list_price_minor)).toBe(true);
      expect(r.local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.occurred_at.length).toBeGreaterThan(0);
      expect(r.timezone.length).toBeGreaterThan(0);
      if (r.tags.length > 0) {
        for (const t of r.tags) {
          expect(t.name.length).toBeGreaterThan(0);
          expect(['category', 'other']).toContain(t.type);
        }
      }
    }

    // Also acceptable as success envelope records array
    const asSuccess = ParseSuccessResponseSchema.safeParse({
      contract_version: CONTRACT_VERSION,
      request_id: 'example',
      status: 'ok',
      records: example.records,
    });
    expect(asSuccess.success).toBe(true);
  });

  // Positive: prompt keeps request timezone and derives a consistent occurred/local date pair.
  it('keeps request timezone and derives local_date from occurred_at', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/timezone/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/local_date/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/submitted_at/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/occurred_at/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/derive local_date/i);
  });

  // Positive: example is a simple Chinese expense (not nested groups)
  it('example describes flat peer records without shopping groups', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/flat|peer|不嵌套|Never nest/i);
    const example = extractExampleJsonOutput(PARSE_SYSTEM_PROMPT) as {
      records: Record<string, unknown>[];
    };
    for (const record of example.records) {
      expect(record).not.toHaveProperty('children');
      expect(record).not.toHaveProperty('shopping_group');
    }
  });
});
