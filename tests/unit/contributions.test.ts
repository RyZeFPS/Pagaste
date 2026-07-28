import { describe, expect, it } from 'vitest';
import {
  calculateParticipantBalances,
  calculateSettlementTransfers,
  DomainValidationError,
  sumCents,
} from '../../src/domain';

describe('multiple payer settlements', () => {
  it('keeps the existing single-payer flow as the default', () => {
    const transfers = calculateSettlementTransfers([
      { participantId: 'david', shareCents: 2_000, paidCents: 4_000, sortOrder: 0 },
      { participantId: 'marta', shareCents: 1_000, paidCents: 0, sortOrder: 1 },
      { participantId: 'ferran', shareCents: 1_000, paidCents: 0, sortOrder: 2 },
    ]);

    expect(transfers).toEqual([
      {
        debtorParticipantId: 'marta',
        creditorParticipantId: 'david',
        amountCents: 1_000,
      },
      {
        debtorParticipantId: 'ferran',
        creditorParticipantId: 'david',
        amountCents: 1_000,
      },
    ]);
  });

  it('nets partial contributions across several creditors deterministically', () => {
    const participants = [
      { participantId: 'david', shareCents: 1_000, paidCents: 4_000, sortOrder: 0 },
      { participantId: 'marta', shareCents: 1_000, paidCents: 1_500, sortOrder: 1 },
      { participantId: 'ferran', shareCents: 4_000, paidCents: 500, sortOrder: 2 },
      { participantId: 'lucia', shareCents: 2_000, paidCents: 2_000, sortOrder: 3 },
    ];

    expect(calculateSettlementTransfers(participants)).toEqual([
      {
        debtorParticipantId: 'ferran',
        creditorParticipantId: 'david',
        amountCents: 3_000,
      },
      {
        debtorParticipantId: 'ferran',
        creditorParticipantId: 'marta',
        amountCents: 500,
      },
    ]);
  });

  it('conserves every cent for odd totals and more than one debtor and creditor', () => {
    const participants = [
      { participantId: 'a', shareCents: 334, paidCents: 999, sortOrder: 0 },
      { participantId: 'b', shareCents: 333, paidCents: 1, sortOrder: 1 },
      { participantId: 'c', shareCents: 333, paidCents: 0, sortOrder: 2 },
      { participantId: 'd', shareCents: 0, paidCents: 0, sortOrder: 3 },
    ];
    const balances = calculateParticipantBalances(participants);
    const transfers = calculateSettlementTransfers(participants);

    expect(sumCents(balances.map(({ netCents }) => netCents))).toBe(0);
    expect(sumCents(transfers.map(({ amountCents }) => amountCents))).toBe(665);
    expect(transfers).toEqual([
      { debtorParticipantId: 'b', creditorParticipantId: 'a', amountCents: 332 },
      { debtorParticipantId: 'c', creditorParticipantId: 'a', amountCents: 333 },
    ]);
  });

  it('returns no claims when every participant already paid exactly their share', () => {
    expect(
      calculateSettlementTransfers([
        { participantId: 'a', shareCents: 500, paidCents: 500 },
        { participantId: 'b', shareCents: 500, paidCents: 500 },
      ]),
    ).toEqual([]);
  });

  it('rejects duplicate participants and contribution totals that do not match', () => {
    expect(() =>
      calculateSettlementTransfers([
        { participantId: 'same', shareCents: 500, paidCents: 1_000 },
        { participantId: 'same', shareCents: 500, paidCents: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'duplicate_participant' }));

    expect(() =>
      calculateSettlementTransfers([
        { participantId: 'a', shareCents: 500, paidCents: 400 },
        { participantId: 'b', shareCents: 500, paidCents: 500 },
      ]),
    ).toThrow(DomainValidationError);
  });
});
