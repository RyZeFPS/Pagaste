import { describe, expect, it } from 'vitest';
import {
  calculateMemberTotals,
  calculateRecoverableAmount,
  sanitizePublicClaimDto,
  splitByCustomAmounts,
  transitionClaimStatus,
  validateExpenseTotals,
} from '../../src/domain';
import type { ExpenseLineAllocation, MemberAmount } from '../../src/types';

const participants = ['alex', 'ferran', 'david', 'marta'] as const;

function line(
  id: string,
  name: string,
  totalCents: number,
  amounts: Readonly<Record<(typeof participants)[number], number>>,
): ExpenseLineAllocation {
  const allocations = splitByCustomAmounts(totalCents, amounts) as MemberAmount[];
  return { id, name, lineTotalCents: totalCents, currency: 'EUR', allocations };
}

function demoLines(): ExpenseLineAllocation[] {
  return [
    line('pizza', 'Pizza', 1_200, { alex: 1_170, ferran: 30, david: 0, marta: 0 }),
    line('drinks', 'Refrescos', 700, { alex: 300, ferran: 400, david: 0, marta: 0 }),
    line('fries', 'Patatas', 420, { alex: 0, ferran: 420, david: 0, marta: 0 }),
    line('salad', 'Ensalada', 680, { alex: 0, ferran: 0, david: 680, marta: 0 }),
    line('dessert', 'Tiramisú', 550, { alex: 0, ferran: 0, david: 0, marta: 550 }),
    line('coffee', 'Café', 450, { alex: 30, ferran: 0, david: 420, marta: 0 }),
  ];
}

describe('manual expense to public claim lifecycle', () => {
  it('conserves the demo expense, creates only external claims and exposes a limited DTO', () => {
    const lines = demoLines();
    const memberTotals = calculateMemberTotals(lines, participants);
    const claims = memberTotals
      .filter(({ memberId }) => memberId !== 'alex')
      .map(({ memberId, totalCents }) => ({ memberId, amountCents: totalCents }));

    expect(memberTotals.map(({ memberId, totalCents }) => [memberId, totalCents])).toEqual([
      ['alex', 1_500],
      ['ferran', 850],
      ['david', 1_100],
      ['marta', 550],
    ]);
    expect(calculateRecoverableAmount(memberTotals, 'alex')).toBe(2_500);

    const validation = validateExpenseTotals({
      currency: 'EUR',
      totalCents: 4_000,
      payerId: 'alex',
      participantIds: participants,
      lines,
      claimAmounts: claims,
    });
    expect(validation).toMatchObject({
      valid: true,
      differenceCents: 0,
      recoverableAmountCents: 2_500,
      claimTotalCents: 2_500,
    });

    const ferran = memberTotals.find(({ memberId }) => memberId === 'ferran');
    expect(ferran).toBeDefined();
    const publicClaim = sanitizePublicClaimDto({
      claimId: 'must-not-leak',
      publicTokenHash: 'must-not-leak',
      debtorEmail: 'must-not-leak@example.com',
      creditorDisplayName: 'Alex',
      creditorAvatarUrl: null,
      creditorPhoneE164: '+34600111222',
      expenseTitle: 'Cena del viernes',
      merchantName: 'Pizzería Bella Napoli',
      occurredAt: '2026-07-18T21:00:00.000Z',
      currency: 'EUR',
      amountCents: ferran!.totalCents,
      originalAmountCents: ferran!.totalCents,
      offsetAmountCents: 0,
      status: 'pending',
      paymentProgress: {
        totalCents: 2_500,
        settledCents: 0,
        pendingCents: 2_500,
        completed: false,
        payers: claims.map((claim) => ({
          displayName: claim.memberId,
          amountCents: claim.amountCents,
          settledCents: 0,
          status: 'pending',
          isCurrent: claim.memberId === 'ferran',
        })),
      },
      items: ferran!.breakdown
        .filter(({ amountCents }) => amountCents !== 0)
        .map((item) => {
          const original = lines.find(({ id }) => id === item.lineId)!;
          return {
            internalItemId: original.id,
            name: item.lineName,
            originalLineTotalCents: original.lineTotalCents,
            assignedAmountCents: item.amountCents,
            allocationLabel: 'Cantidad personalizada',
          };
        }),
    });

    expect(publicClaim.amountCents).toBe(850);
    expect(publicClaim.items.map(({ assignedAmountCents }) => assignedAmountCents)).toEqual([
      30, 400, 420,
    ]);
    expect(publicClaim).not.toHaveProperty('claimId');
    expect(publicClaim).not.toHaveProperty('publicTokenHash');
    expect(publicClaim).not.toHaveProperty('debtorEmail');
    expect(publicClaim.items[0]).not.toHaveProperty('internalItemId');
  });

  it('supports receiver-recorded and debtor-dispute branches without payer confirmation', () => {
    let receivedStatus = transitionClaimStatus('pending', 'reminder_sent', 'owner');
    receivedStatus = transitionClaimStatus(receivedStatus, 'received', 'owner');
    expect(receivedStatus).toBe('received');

    let disputedStatus = transitionClaimStatus('pending', 'disputed', 'debtor');
    disputedStatus = transitionClaimStatus(disputedStatus, 'pending', 'owner');
    expect(disputedStatus).toBe('pending');
  });
});
