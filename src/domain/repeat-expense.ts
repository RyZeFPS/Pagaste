import {
  assertSafeCents,
  splitByPercentages,
  splitByShares,
  splitByUnits,
  splitEvenly,
} from './money';

export type RepeatAllocationMethod = 'equal' | 'shares' | 'percentage' | 'units' | 'custom';

export type RepeatAllocation = Readonly<{
  participant_id: string;
  method: RepeatAllocationMethod;
  shares: number | null;
  percentage: number | null;
  units: number | null;
  amount_cents: number;
}>;

export type RepeatAllocationErrorCode =
  | 'REPEAT_AMOUNT_ZERO'
  | 'REPEAT_ALLOCATION_MISSING'
  | 'REPEAT_ALLOCATION_SIGN'
  | 'REPEAT_ALLOCATION_ZERO';

export class RepeatAllocationError extends Error {
  constructor(public readonly code: RepeatAllocationErrorCode) {
    super(code);
    this.name = 'RepeatAllocationError';
  }
}

function proportionalAmounts(
  totalCents: number,
  allocations: readonly RepeatAllocation[],
): { memberId: string; amountCents: number }[] {
  return splitByShares(
    totalCents,
    allocations.map((allocation, selectionOrder) => ({
      memberId: allocation.participant_id,
      shares: Math.abs(allocation.amount_cents),
      selectionOrder,
    })),
  );
}

/**
 * Recalculates only the cents of a repeated line while retaining every
 * participant and the original split metadata.
 */
export function rescaleRepeatedAllocations(
  totalCents: number,
  allocations: readonly RepeatAllocation[],
): RepeatAllocation[] {
  assertSafeCents(totalCents, 'totalCents');
  if (totalCents === 0) throw new RepeatAllocationError('REPEAT_AMOUNT_ZERO');
  if (!allocations.length) throw new RepeatAllocationError('REPEAT_ALLOCATION_MISSING');
  if (
    allocations.some(
      (allocation) =>
        !allocation.participant_id.trim() ||
        allocation.amount_cents === 0 ||
        Math.sign(allocation.amount_cents) !== Math.sign(totalCents),
    )
  )
    throw new RepeatAllocationError('REPEAT_ALLOCATION_SIGN');

  const participantIds = allocations.map((allocation) => allocation.participant_id);
  const methods = new Set(allocations.map((allocation) => allocation.method));
  const method = methods.size === 1 ? allocations[0].method : 'custom';
  let amounts: { memberId: string; amountCents: number }[];

  if (method === 'equal') {
    amounts = splitEvenly(totalCents, participantIds);
  } else if (
    method === 'units' &&
    allocations.every(
      (allocation) =>
        allocation.units !== null &&
        Number.isSafeInteger(allocation.units) &&
        allocation.units >= 0,
    )
  ) {
    amounts = splitByUnits(
      totalCents,
      allocations.map((allocation, selectionOrder) => ({
        memberId: allocation.participant_id,
        units: allocation.units!,
        selectionOrder,
      })),
    );
  } else if (
    method === 'percentage' &&
    allocations.every((allocation) => allocation.percentage !== null && allocation.percentage >= 0)
  ) {
    amounts = splitByPercentages(
      totalCents,
      allocations.map((allocation, selectionOrder) => ({
        memberId: allocation.participant_id,
        percentage: allocation.percentage!,
        selectionOrder,
      })),
    );
  } else {
    // Custom amounts and legacy share rows are scaled by their actual previous
    // cents. This keeps assignments stable and avoids changing the saved split
    // method/metadata merely because the repeated price changed.
    amounts = proportionalAmounts(totalCents, allocations);
  }

  const byParticipant = new Map(
    amounts.map((amount) => [amount.memberId, amount.amountCents] as const),
  );
  const result = allocations.map((allocation) => ({
    ...allocation,
    amount_cents: byParticipant.get(allocation.participant_id) ?? 0,
  }));
  const nonZero = result.filter((allocation) => allocation.amount_cents !== 0);
  if (!nonZero.length) throw new RepeatAllocationError('REPEAT_ALLOCATION_ZERO');
  if (nonZero.length === result.length) return result;

  // Postgres intentionally rejects zero-value allocation rows. When a very
  // small price leaves somebody at zero cents, keep only real assignments and
  // normalize them to custom so the remaining metadata stays internally valid.
  return nonZero.map((allocation) => ({
    ...allocation,
    method: 'custom',
    shares: null,
    percentage: null,
    units: null,
  }));
}
