/**
 * Monetary values cross the React Native/Supabase boundary as JavaScript
 * numbers, always expressed in minor units (called cents throughout the app).
 * They must be integers in the inclusive range
 * `[-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]`. Calculations that
 * multiply or divide amounts are performed with bigint in the domain layer.
 *
 * The model deliberately does not perform currency conversion. A value is
 * meaningful only together with its ISO 4217 currency code.
 */
export type Cents = number;

export type CurrencyCode = string;

export interface MemberAmount {
  memberId: string;
  amountCents: Cents;
}

export interface AllocationTarget {
  memberId: string;
  /** Lower values receive deterministic remainder cents first. */
  selectionOrder?: number;
}

export interface ShareAllocationTarget extends AllocationTarget {
  shares: number;
}

export interface UnitAllocationTarget extends AllocationTarget {
  units: number;
}

export interface PercentageAllocationTarget extends AllocationTarget {
  /** Decimal percentages are accepted as a number or a decimal string. */
  percentage: number | string;
}

export interface CustomAllocationTarget extends AllocationTarget {
  amountCents: Cents;
}

export interface RemainderAllocation extends MemberAmount {
  selectionOrder?: number;
}
