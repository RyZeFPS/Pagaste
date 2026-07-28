import { describe, expect, it } from 'vitest';
import {
  RepeatAllocationError,
  rescaleRepeatedAllocations,
  type RepeatAllocation,
} from '../../src/domain/repeat-expense';

function allocation(
  participantId: string,
  amountCents: number,
  overrides: Partial<RepeatAllocation> = {},
): RepeatAllocation {
  return {
    participant_id: participantId,
    method: 'custom',
    shares: null,
    percentage: null,
    units: null,
    amount_cents: amountCents,
    ...overrides,
  };
}

describe('repeated expense allocation rescaling', () => {
  it('keeps custom assignments and redistributes the new price exactly', () => {
    const result = rescaleRepeatedAllocations(1_500, [
      allocation('alex', 350),
      allocation('ferran', 300),
      allocation('david', 350),
      allocation('marta', 200),
    ]);

    expect(result.map(({ participant_id, method }) => [participant_id, method])).toEqual([
      ['alex', 'custom'],
      ['ferran', 'custom'],
      ['david', 'custom'],
      ['marta', 'custom'],
    ]);
    expect(result.reduce((total, value) => total + value.amount_cents, 0)).toBe(1_500);
    expect(result.map(({ amount_cents }) => amount_cents)).toEqual([438, 375, 437, 250]);
  });

  it('preserves equal, percentage and units metadata', () => {
    const equal = rescaleRepeatedAllocations(1_001, [
      allocation('a', 500, { method: 'equal' }),
      allocation('b', 500, { method: 'equal' }),
    ]);
    expect(equal.map(({ amount_cents }) => amount_cents)).toEqual([501, 500]);
    expect(equal.every(({ method }) => method === 'equal')).toBe(true);

    const percentage = rescaleRepeatedAllocations(2_000, [
      allocation('a', 250, { method: 'percentage', percentage: 25 }),
      allocation('b', 750, { method: 'percentage', percentage: 75 }),
    ]);
    expect(percentage.map(({ amount_cents }) => amount_cents)).toEqual([500, 1_500]);
    expect(percentage.map(({ percentage: value }) => value)).toEqual([25, 75]);

    const units = rescaleRepeatedAllocations(1_200, [
      allocation('a', 200, { method: 'units', units: 1 }),
      allocation('b', 400, { method: 'units', units: 2 }),
    ]);
    expect(units.map(({ amount_cents }) => amount_cents)).toEqual([400, 800]);
    expect(units.map(({ units: value }) => value)).toEqual([1, 2]);
  });

  it('supports negative shared adjustments without changing their assignment', () => {
    const result = rescaleRepeatedAllocations(-300, [allocation('a', -100), allocation('b', -200)]);
    expect(result.map(({ amount_cents }) => amount_cents)).toEqual([-100, -200]);
  });

  it('drops mathematically zero assignments and normalizes the remaining split', () => {
    const result = rescaleRepeatedAllocations(1, [
      allocation('a', 100, { method: 'equal' }),
      allocation('b', 100, { method: 'equal' }),
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        participant_id: 'a',
        amount_cents: 1,
        method: 'custom',
        shares: null,
      }),
    ]);
  });

  it('rejects zero prices, empty splits and a sign change', () => {
    expect(() => rescaleRepeatedAllocations(0, [allocation('a', 100)])).toThrow(
      new RepeatAllocationError('REPEAT_AMOUNT_ZERO'),
    );
    expect(() => rescaleRepeatedAllocations(100, [])).toThrow(
      new RepeatAllocationError('REPEAT_ALLOCATION_MISSING'),
    );
    expect(() => rescaleRepeatedAllocations(-100, [allocation('a', 100)])).toThrow(
      new RepeatAllocationError('REPEAT_ALLOCATION_SIGN'),
    );
  });
});
