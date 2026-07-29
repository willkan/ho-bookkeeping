import type { TagType } from '@bookkeeping/contracts';
import type { MoneyMinor } from './money';

export type LifecycleStatus = 'pending_parse' | 'pending_confirm' | 'posted' | 'parse_failed';

export type ConfirmMode = 'auto_post' | 'confirm_before_post';

export type ParseJobStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed_retryable'
  | 'failed_terminal';

export type Direction = 'expense' | 'income' | 'transfer';

export type TagSource = 'mode_default' | 'ai' | 'manual';

export type TagMatchMode = 'and' | 'or';

export type TrendGranularity = 'day' | 'week' | 'month';

export interface Tag {
  id: string;
  type: TagType;
  name: string;
  aliases: string[];
  mergedIntoTagId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Mode {
  id: string;
  name: string;
  isActive: boolean;
  defaultTagIds: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ModeTagSnapshot {
  tagId: string | null;
  name: string;
  type: TagType;
}

export interface RawInput {
  id: string;
  rawText: string;
  submittedAt: string;
  timezone: string;
  localDate: string;
  lifecycleStatus: LifecycleStatus;
  confirmMode: ConfirmMode;
  modeIdSnapshot: string | null;
  modeNameSnapshot: string | null;
  defaultTagsSnapshot: ModeTagSnapshot[];
  includeInModeStats: boolean;
  parseErrorCategory: string | null;
  parseErrorMessage: string | null;
  candidatesJson: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ParseJob {
  id: string;
  rawInputId: string;
  status: ParseJobStatus;
  attempts: number;
  maxAttempts: number;
  nextEligibleAt: string;
  lastErrorCategory: string | null;
  lastErrorMessage: string | null;
  clientRequestId: string;
  idempotencyKey: string;
  modelVersion: string | null;
  /** Non-secret provider host/origin from the config used for this attempt. */
  providerHost: string | null;
  /** Secure-config revision used for this attempt (never includes API key). */
  configRevision: number | null;
  contractVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordTag {
  tagId: string;
  source: TagSource;
}

export interface ConsumptionRecord {
  id: string;
  rawInputId: string | null;
  /** Stable zero-based order among peer records from the same raw input. */
  sourceSequence: number;
  direction: Direction;
  merchant: string | null;
  note: string | null;
  occurredAt: string;
  timezone: string;
  localDate: string;
  currency: 'CNY';
  listPriceMinor: MoneyMinor;
  /** Amount actually paid at this checkout. */
  actualCostMinor: MoneyMinor;
  /** Coupon deduction explicitly stated for this checkout. */
  discountMinor: MoneyMinor;
  tags: RecordTag[];
  modeId: string | null;
  includeInModeStats: boolean;
  manuallyEdited: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ExclusiveStatGroup {
  id: string;
  name: string;
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AppSettings {
  confirmMode: ConfirmMode;
}

export interface StatFilter {
  range:
    | { kind: 'time'; startLocalDate: string; endLocalDate: string }
    | { kind: 'mode'; modeId: string; startLocalDate?: string; endLocalDate?: string };
  tagIds: string[];
  tagMatch: TagMatchMode;
}

export interface BreakdownBucket {
  key: string;
  label: string;
  amountMinor: MoneyMinor;
  share: number;
  isUnclassified: boolean;
}

export interface BreakdownResult {
  totalMinor: MoneyMinor;
  buckets: BreakdownBucket[];
  metric: 'actual_cost';
}

export interface TrendBucket {
  key: string;
  label: string;
  amountMinor: MoneyMinor;
}

export interface TrendResult {
  totalMinor: MoneyMinor;
  granularity: TrendGranularity;
  buckets: TrendBucket[];
  metric: 'actual_cost';
}
