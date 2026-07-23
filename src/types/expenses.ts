import type { Cents, CurrencyCode, MemberAmount } from './money';

export type AllocationMode = 'single' | 'equal' | 'units' | 'custom' | 'percentages';

export type ExpenseAdjustmentKind = 'tip' | 'discount' | 'tax' | 'fee' | 'difference' | 'other';

export interface ExpenseLineAllocation {
  id: string;
  name: string;
  lineTotalCents: Cents;
  allocations: readonly MemberAmount[];
  allocationMode?: AllocationMode;
  currency?: CurrencyCode;
}

export interface ExpenseAdjustment {
  id: string;
  name: string;
  kind: ExpenseAdjustmentKind;
  amountCents: Cents;
  allocations: readonly MemberAmount[];
  currency?: CurrencyCode;
}

export interface MemberLineTotal {
  lineId: string;
  lineName: string;
  amountCents: Cents;
  kind: 'line' | ExpenseAdjustmentKind;
}

export interface MemberTotal {
  memberId: string;
  totalCents: Cents;
  breakdown: readonly MemberLineTotal[];
}

export interface ExpenseTotalsInput {
  currency: CurrencyCode;
  totalCents: Cents;
  payerId: string;
  lines: readonly ExpenseLineAllocation[];
  adjustments?: readonly ExpenseAdjustment[];
  /** When supplied, references outside this set are rejected. */
  participantIds?: readonly string[];
  /** Existing/generated claims can be checked against calculated debt. */
  claimAmounts?: readonly MemberAmount[];
}

export type ExpenseValidationErrorCode =
  | 'invalid_currency'
  | 'invalid_amount'
  | 'invalid_id'
  | 'invalid_name'
  | 'empty_lines'
  | 'empty_allocations'
  | 'invalid_allocation_direction'
  | 'invalid_adjustment_direction'
  | 'negative_member_total'
  | 'duplicate_participant'
  | 'payer_not_participant'
  | 'duplicate_line'
  | 'duplicate_adjustment'
  | 'duplicate_allocation'
  | 'unknown_participant'
  | 'currency_mismatch'
  | 'line_unassigned'
  | 'line_overallocated'
  | 'adjustment_unassigned'
  | 'adjustment_overallocated'
  | 'expense_total_mismatch'
  | 'claim_for_payer'
  | 'duplicate_claim'
  | 'claim_total_mismatch'
  | 'claim_member_mismatch';

export interface ExpenseValidationError {
  code: ExpenseValidationErrorCode;
  message: string;
  path?: string;
  differenceCents?: Cents;
  memberId?: string;
  lineId?: string;
}

export interface ExpenseValidationResult {
  valid: boolean;
  errors: readonly ExpenseValidationError[];
  lineTotalCents: Cents;
  adjustmentTotalCents: Cents;
  calculatedTotalCents: Cents;
  differenceCents: Cents;
  memberTotals: readonly MemberTotal[];
  recoverableAmountCents: Cents;
  claimTotalCents: Cents | null;
}
