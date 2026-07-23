import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  distributeRemainderCents,
  splitByCustomAmounts,
  splitByPercentages,
  splitByShares,
  splitByUnits,
  splitEvenly,
  sumCents,
} from '../../src/domain';

describe('money allocation', () => {
  it('splits equally and conserves every cent', () => {
    expect(splitEvenly(1_000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(-1_000, 3)).toEqual([-334, -333, -333]);

    for (let total = -100; total <= 100; total += 1) {
      for (let members = 1; members <= 9; members += 1) {
        const result = splitEvenly(total, members);
        expect(sumCents(result)).toBe(total);
        expect(Math.max(...result) - Math.min(...result)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('assigns remainder by selection order and then stable member id', () => {
    expect(
      splitEvenly(1_000, [
        { memberId: 'z', selectionOrder: 1 },
        { memberId: 'b', selectionOrder: 0 },
        { memberId: 'a', selectionOrder: 0 },
      ]),
    ).toEqual([
      { memberId: 'z', amountCents: 333 },
      { memberId: 'b', amountCents: 333 },
      { memberId: 'a', amountCents: 334 },
    ]);
  });

  it('uses largest remainders for shares, units and exact percentages', () => {
    expect(splitByShares(100, [1, 2])).toEqual([33, 67]);
    expect(splitByUnits(100, [0, 3, 1])).toEqual([0, 75, 25]);
    expect(splitByPercentages(101, ['33.333333', '66.666667'])).toEqual([34, 67]);
    expect(
      splitByShares(7, {
        alice: 1,
        bob: 1,
        carol: 1,
      }),
    ).toEqual([
      { memberId: 'alice', amountCents: 3 },
      { memberId: 'bob', amountCents: 2 },
      { memberId: 'carol', amountCents: 2 },
    ]);
  });

  it('validates exact custom allocations and their direction', () => {
    expect(splitByCustomAmounts(500, [125, 375])).toEqual([125, 375]);
    expect(splitByCustomAmounts(-100, [-40, -60])).toEqual([-40, -60]);
    expect(() => splitByCustomAmounts(500, [100, 399])).toThrowError(
      expect.objectContaining({ code: 'custom_total' }),
    );
    expect(() => splitByCustomAmounts(500, [600, -100])).toThrowError(
      expect.objectContaining({ code: 'invalid_custom_amount' }),
    );
    expect(() => splitByCustomAmounts(0, [10, -10])).toThrowError(
      expect.objectContaining({ code: 'invalid_custom_amount' }),
    );
  });

  it('distributes an arbitrary remainder deterministically', () => {
    expect(distributeRemainderCents([10, 10, 10], 32)).toEqual([11, 11, 10]);
    expect(
      distributeRemainderCents(8, [
        { memberId: 'second', amountCents: 2, selectionOrder: 1 },
        { memberId: 'first', amountCents: 2, selectionOrder: 0 },
      ]),
    ).toEqual([
      { memberId: 'second', amountCents: 4 },
      { memberId: 'first', amountCents: 4 },
    ]);
  });

  it('rejects malformed inputs and unsafe sums', () => {
    expect(() => splitEvenly(100, 0)).toThrow(DomainValidationError);
    expect(() => splitEvenly(100, ['alice', ' alice '])).toThrowError(
      expect.objectContaining({ code: 'duplicate_member' }),
    );
    expect(() => splitByShares(100, [1, 0])).toThrowError(
      expect.objectContaining({ code: 'invalid_shares' }),
    );
    expect(() => splitByUnits(100, [0, 0])).toThrowError(
      expect.objectContaining({ code: 'invalid_weight' }),
    );
    expect(() => splitByPercentages(100, [40, 50])).toThrowError(
      expect.objectContaining({ code: 'percentage_total' }),
    );
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrowError(
      expect.objectContaining({ code: 'unsafe_cents' }),
    );
  });
});
