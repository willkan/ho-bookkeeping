import { CandidateRecordSchema, type CandidateRecord } from '@bookkeeping/contracts';
import { assertMoneyMinor } from './money';

export type ValidationIssue = {
  code: string;
  message: string;
  recordIndex?: number;
};

export type ValidationResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

function validateMoneyRelations(
  listPriceMinor: number,
  actualCostMinor: number,
  discountMinor: number,
  recordIndex?: number,
): ValidationIssue[] {
  for (const amount of [listPriceMinor, actualCostMinor, discountMinor]) {
    try {
      assertMoneyMinor(amount);
    } catch {
      return [
        {
          code: 'non_integer_money',
          message: 'Money must be non-negative integer minor units',
          recordIndex,
        },
      ];
    }
  }
  if (listPriceMinor !== actualCostMinor + discountMinor) {
    return [
      {
        code: 'list_price_mismatch',
        message: `list price ${listPriceMinor} != paid amount ${actualCostMinor} + coupon discount ${discountMinor}`,
        recordIndex,
      },
    ];
  }
  return [];
}

/** Domain money integrity for one untrusted AI proposal record. */
export function validateCandidateRecord(
  record: CandidateRecord,
  recordIndex?: number,
  expectedTimezone?: string,
): ValidationResult {
  const schemaResult = CandidateRecordSchema.safeParse(record);
  const issues: ValidationIssue[] = schemaResult.success
    ? []
    : schemaResult.error.issues.map((issue) => ({
        code: 'invalid_record_schema',
        message: issue.message,
        recordIndex,
      }));
  if (expectedTimezone !== undefined && record.timezone !== expectedTimezone) {
    issues.push({
      code: 'timezone_mismatch',
      message: 'Record timezone must match the raw input timezone',
      recordIndex,
    });
  }
  issues.push(
    ...validateMoneyRelations(
      record.list_price_minor,
      record.actual_cost_minor,
      record.discount_minor,
      recordIndex,
    ),
  );
  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

/** Whole-list validation: one invalid candidate blocks automatic partial posting. */
export function validateCandidateList(
  records: readonly CandidateRecord[],
  expectedTimezone?: string,
): ValidationResult {
  const issues = records.flatMap((record, index) => {
    const result = validateCandidateRecord(record, index, expectedTimezone);
    return result.ok ? [] : result.issues;
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

export function validateAmountsForEdit(
  listPriceMinor: number,
  actualCostMinor: number,
  discountMinor: number,
): ValidationResult {
  const issues = validateMoneyRelations(listPriceMinor, actualCostMinor, discountMinor);
  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}
