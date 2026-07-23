import { describe, expect, it } from 'vitest';
import type { ExpenseTotalsInput } from '../../src/types';
import {
  calculateMemberTotals,
  calculateRecoverableAmount,
  memberTotalsToRecord,
  validateExpenseTotals,
} from '../../src/domain';

function validExpense(overrides: Partial<ExpenseTotalsInput> = {}): ExpenseTotalsInput {
  return {
    currency: 'eur',
    totalCents: 1_000,
    payerId: 'payer',
    participantIds: ['payer', 'guest'],
    lines: [
      {
        id: 'meal',
        name: 'Comida',
        lineTotalCents: 900,
        currency: 'EUR',
        allocations: [
          { memberId: 'payer', amountCents: 400 },
          { memberId: 'guest', amountCents: 500 },
        ],
      },
    ],
    adjustments: [
      {
        id: 'tip',
        name: 'Propina',
        kind: 'tip',
        amountCents: 100,
        allocations: [
          { memberId: 'payer', amountCents: 50 },
          { memberId: 'guest', amountCents: 50 },
        ],
      },
    ],
    claimAmounts: [{ memberId: 'guest', amountCents: 550 }],
    ...overrides,
  };
}

describe('expense totals', () => {
  it("validates lines, adjustments, claims and the payer's own share", () => {
    const result = validateExpenseTotals(validExpense());
    expect(result).toMatchObject({
      valid: true,
      errors: [],
      lineTotalCents: 900,
      adjustmentTotalCents: 100,
      calculatedTotalCents: 1_000,
      differenceCents: 0,
      recoverableAmountCents: 550,
      claimTotalCents: 550,
    });
    expect(memberTotalsToRecord(result.memberTotals)).toEqual({ payer: 450, guest: 550 });
  });

  it('includes zero-total participants and a transparent breakdown', () => {
    const totals = calculateMemberTotals(validExpense().lines, ['payer', 'guest', 'observer']);
    expect(totals).toEqual([
      {
        memberId: 'payer',
        totalCents: 400,
        breakdown: [{ lineId: 'meal', lineName: 'Comida', amountCents: 400, kind: 'line' }],
      },
      {
        memberId: 'guest',
        totalCents: 500,
        breakdown: [{ lineId: 'meal', lineName: 'Comida', amountCents: 500, kind: 'line' }],
      },
      { memberId: 'observer', totalCents: 0, breakdown: [] },
    ]);
    expect(calculateRecoverableAmount(totals, ' payer ')).toBe(500);
  });

  it('handles a negative discount without losing exactness', () => {
    const result = validateExpenseTotals(
      validExpense({
        totalCents: 800,
        adjustments: [
          {
            id: 'discount',
            name: 'Descuento',
            kind: 'discount',
            amountCents: -100,
            allocations: [
              { memberId: 'payer', amountCents: -50 },
              { memberId: 'guest', amountCents: -50 },
            ],
          },
        ],
        claimAmounts: [{ memberId: 'guest', amountCents: 450 }],
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.recoverableAmountCents).toBe(450);
  });

  it('reports underallocation, total mismatch and claim mismatch', () => {
    const input = validExpense({
      totalCents: 1_100,
      lines: [
        {
          id: 'meal',
          name: 'Comida',
          lineTotalCents: 900,
          allocations: [{ memberId: 'guest', amountCents: 800 }],
        },
      ],
      claimAmounts: [{ memberId: 'guest', amountCents: 500 }],
    });
    const result = validateExpenseTotals(input);
    expect(result.valid).toBe(false);
    expect(result.errors.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'line_unassigned',
        'expense_total_mismatch',
        'claim_total_mismatch',
        'claim_member_mismatch',
      ]),
    );
  });

  it('rejects duplicate, unknown and self-claim references', () => {
    const result = validateExpenseTotals(
      validExpense({
        participantIds: ['payer', 'guest', ' guest '],
        claimAmounts: [
          { memberId: 'payer', amountCents: 10 },
          { memberId: 'missing', amountCents: 540 },
        ],
      }),
    );
    expect(result.errors.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['duplicate_participant', 'claim_for_payer', 'unknown_participant']),
    );
  });

  it('rejects wrong adjustment and allocation signs', () => {
    const result = validateExpenseTotals(
      validExpense({
        totalCents: 1_000,
        adjustments: [
          {
            id: 'discount',
            name: 'Descuento',
            kind: 'discount',
            amountCents: 100,
            allocations: [
              { memberId: 'payer', amountCents: -20 },
              { memberId: 'guest', amountCents: 120 },
            ],
          },
        ],
      }),
    );
    expect(result.errors.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['invalid_adjustment_direction', 'invalid_allocation_direction']),
    );
  });
});
