import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  ParseRequestSchema,
  ParseResponseSchema,
  CandidateRecordSchema,
} from './parse';

const baseRequest = {
  contract_version: CONTRACT_VERSION,
  request_id: 'req_1',
  raw_text: '买xx花了100，买yy花了200，买zz花了20',
  submitted_at: '2026-07-16T10:18:00.000Z',
  timezone: 'Asia/Shanghai',
  local_date: '2026-07-16',
  mode_snapshot: {
    mode_id: 'mode_1',
    mode_name: '江西旅游',
    default_tags: [
      { tag_id: 'tag_trip', name: '江西旅游', type: 'other' as const },
      { tag_id: 'tag_place', name: '景德镇', type: 'other' as const },
    ],
    include_in_mode_stats: true,
  },
  tag_candidates: [{ id: 'tag_trip', name: '江西旅游', type: 'other' as const, aliases: [] }],
};

const simpleExpense = {
  direction: 'expense' as const,
  merchant: 'XX',
  note: null,
  occurred_at: '2026-07-16T10:18:00.000Z',
  timezone: 'Asia/Shanghai',
  local_date: '2026-07-16',
  currency: 'CNY' as const,
  list_price_minor: 10000,
  actual_cost_minor: 10000,
  discount_minor: 0,
  tags: [{ name: '江西旅游', type: 'other' as const, existing_tag_id: 'tag_trip' }],
};

describe('transport contract skeletons and cases', () => {
  it('accepts an occurred instant whose local calendar date matches its timezone', () => {
    expect(
      CandidateRecordSchema.safeParse({
        ...simpleExpense,
        occurred_at: '2026-07-15T16:30:00.000Z',
        timezone: 'Asia/Shanghai',
        local_date: '2026-07-16',
      }).success,
    ).toBe(true);
  });

  it('rejects an invalid occurred_at instant', () => {
    expect(
      CandidateRecordSchema.safeParse({
        ...simpleExpense,
        occurred_at: 'yesterday sometime',
      }).success,
    ).toBe(false);
  });
  it('rejects a local_date that disagrees with occurred_at in the record timezone', () => {
    expect(
      CandidateRecordSchema.safeParse({
        ...simpleExpense,
        occurred_at: '2026-07-16T16:30:00.000Z',
        timezone: 'Asia/Shanghai',
        local_date: '2026-07-16',
      }).success,
    ).toBe(false);
  });

  // Positive: valid multi-record parse response
  it('accepts a flat list of three peer consumption candidates', () => {
    const response = {
      contract_version: CONTRACT_VERSION,
      request_id: 'req_1',
      status: 'ok' as const,
      records: [
        {
          ...simpleExpense,
          merchant: 'XX',
          list_price_minor: 10000,
          actual_cost_minor: 10000,
        },
        {
          ...simpleExpense,
          merchant: 'YY',
          list_price_minor: 20000,
          actual_cost_minor: 20000,
        },
        {
          ...simpleExpense,
          merchant: 'ZZ',
          list_price_minor: 2000,
          actual_cost_minor: 2000,
        },
      ],
    };
    expect(ParseResponseSchema.parse(response).status).toBe('ok');
    if (response.status === 'ok') {
      expect(response.records).toHaveLength(3);
    }
  });

  // Positive: zero records is valid
  it('accepts an empty flat record list', () => {
    const response = {
      contract_version: CONTRACT_VERSION,
      request_id: 'req_1',
      status: 'ok' as const,
      records: [],
    };
    expect(ParseResponseSchema.safeParse(response).success).toBe(true);
  });

  // Positive: coupon use is only a discount amount, with no coupon identity.
  it('accepts checkout amount and coupon discount without coupon identity', () => {
    const couponUse = {
      ...simpleExpense,
      list_price_minor: 32000,
      actual_cost_minor: 30000,
      discount_minor: 2000,
    };
    const parsed = CandidateRecordSchema.safeParse(couponUse);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('coupon_purchase');
      expect(parsed.data).not.toHaveProperty('payment_parts');
      expect(parsed.data).not.toHaveProperty('cash_outflow_minor');
    }
  });

  it('accepts discounted voucher economics without adding coupon fields', () => {
    const voucherUse = {
      ...simpleExpense,
      list_price_minor: 66100,
      actual_cost_minor: 57300,
      discount_minor: 8800,
    };
    const parsed = CandidateRecordSchema.safeParse(voucherUse);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('coupon_cost_minor');
      expect(parsed.data).not.toHaveProperty('coupon_face_value_minor');
    }
  });

  // Positive: valid parse request with mode snapshot and tag candidates
  it('accepts a minimal parse request', () => {
    expect(ParseRequestSchema.safeParse(baseRequest).success).toBe(true);
  });

  it('accepts only category and other tag types', () => {
    expect(
      CandidateRecordSchema.safeParse({
        ...simpleExpense,
        tags: [{ name: '景德镇', type: 'other' }],
      }).success,
    ).toBe(true);
    expect(
      CandidateRecordSchema.safeParse({
        ...simpleExpense,
        tags: [{ name: '景德镇', type: 'place' }],
      }).success,
    ).toBe(false);
  });

  // Negative: floating-point money rejected
  it('rejects floating-point money on candidates', () => {
    const bad = { ...simpleExpense, actual_cost_minor: 10.5 };
    expect(CandidateRecordSchema.safeParse(bad).success).toBe(false);
  });

  // Negative: wrong contract version
  it('rejects unsupported contract_version on request', () => {
    const bad = { ...baseRequest, contract_version: '0.0.1' };
    expect(ParseRequestSchema.safeParse(bad).success).toBe(false);
  });

  // Negative: missing request_id
  it('rejects response without request_id', () => {
    const bad = {
      contract_version: CONTRACT_VERSION,
      status: 'ok',
      records: [],
    };
    expect(ParseResponseSchema.safeParse(bad).success).toBe(false);
  });

  // Negative: nested shopping-group shape is not a valid transport record
  it('rejects unknown nested group fields as part of candidate record', () => {
    const withGroup = {
      ...simpleExpense,
      children: [{ amount: 1 }],
    };
    // Zod strips unknown by default; ensure our schema has no children field
    // and still describes one flat record.
    const parsed = CandidateRecordSchema.safeParse(withGroup);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('children' in parsed.data).toBe(false);
    }
  });

  // Negative: error response shape
  it('accepts typed parse error responses', () => {
    const err = {
      contract_version: CONTRACT_VERSION,
      request_id: 'req_1',
      status: 'error' as const,
      error_category: 'model_output_invalid' as const,
      message: 'structured output failed schema',
    };
    expect(ParseResponseSchema.safeParse(err).success).toBe(true);
  });
});
