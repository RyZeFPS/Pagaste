import { DomainValidationError } from './errors';
import { assertSafeCents, sumCents } from './money';

export type ContributionMethod = 'card' | 'cash' | 'reservation' | 'other';

export type ParticipantSettlementInput = {
  participantId: string;
  shareCents: number;
  paidCents: number;
  sortOrder?: number;
};

export type ParticipantNetBalance = ParticipantSettlementInput & {
  netCents: number;
};

export type SettlementTransfer = {
  debtorParticipantId: string;
  creditorParticipantId: string;
  amountCents: number;
};

function normalizeParticipant(
  participant: ParticipantSettlementInput,
  index: number,
): ParticipantSettlementInput {
  const participantId = participant.participantId.trim();
  if (!participantId) {
    throw new DomainValidationError(
      'invalid_participant',
      `participants[${index}].participantId must not be empty`,
    );
  }
  assertSafeCents(participant.shareCents, `participants[${index}].shareCents`);
  assertSafeCents(participant.paidCents, `participants[${index}].paidCents`);
  if (participant.shareCents < 0 || participant.paidCents < 0) {
    throw new DomainValidationError(
      'invalid_settlement_amount',
      'Participant shares and contributions cannot be negative',
    );
  }
  const sortOrder = participant.sortOrder ?? index;
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) {
    throw new DomainValidationError(
      'invalid_selection_order',
      `participants[${index}].sortOrder must be a non-negative safe integer`,
    );
  }
  return { ...participant, participantId, sortOrder };
}

function stableBalanceOrder(left: ParticipantNetBalance, right: ParticipantNetBalance): number {
  return (
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
    left.participantId.localeCompare(right.participantId)
  );
}

/**
 * Calculates the net balance of every participant. A positive balance means
 * that the participant advanced more than their share; a negative balance
 * means they need to reimburse someone.
 */
export function calculateParticipantBalances(
  participants: readonly ParticipantSettlementInput[],
): ParticipantNetBalance[] {
  if (!participants.length) {
    throw new DomainValidationError('empty_participants', 'At least one participant is required');
  }

  const normalized = participants.map(normalizeParticipant);
  const ids = new Set<string>();
  for (const participant of normalized) {
    if (ids.has(participant.participantId)) {
      throw new DomainValidationError(
        'duplicate_participant',
        `Participant ${participant.participantId} appears more than once`,
      );
    }
    ids.add(participant.participantId);
  }

  const totalShares = sumCents(
    normalized.map(({ shareCents }) => shareCents),
    'participant shares',
  );
  const totalPaid = sumCents(
    normalized.map(({ paidCents }) => paidCents),
    'participant contributions',
  );
  if (totalShares !== totalPaid) {
    throw new DomainValidationError(
      'contributions_total',
      'Participant contributions must equal the allocated expense total exactly',
    );
  }

  return normalized.map((participant) => ({
    ...participant,
    netCents: sumCents(
      [participant.paidCents, -participant.shareCents],
      `net balance for ${participant.participantId}`,
    ),
  }));
}

/**
 * Produces a deterministic minimal settlement ledger. Debtors and creditors
 * are matched in stable participant order, so the same expense always creates
 * the same claims and no remainder cent can disappear.
 */
export function calculateSettlementTransfers(
  participants: readonly ParticipantSettlementInput[],
): SettlementTransfer[] {
  const balances = calculateParticipantBalances(participants);
  const creditors = balances
    .filter(({ netCents }) => netCents > 0)
    .sort(stableBalanceOrder)
    .map((participant) => ({ ...participant, remainingCents: participant.netCents }));
  const debtors = balances
    .filter(({ netCents }) => netCents < 0)
    .sort(stableBalanceOrder)
    .map((participant) => ({ ...participant, remainingCents: -participant.netCents }));

  const transfers: SettlementTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.remainingCents, creditor.remainingCents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new DomainValidationError('invalid_settlement', 'Settlement amount must be positive');
    }

    transfers.push({
      debtorParticipantId: debtor.participantId,
      creditorParticipantId: creditor.participantId,
      amountCents,
    });
    debtor.remainingCents -= amountCents;
    creditor.remainingCents -= amountCents;
    if (debtor.remainingCents === 0) debtorIndex += 1;
    if (creditor.remainingCents === 0) creditorIndex += 1;
  }

  if (
    debtors.some(({ remainingCents }) => remainingCents !== 0) ||
    creditors.some(({ remainingCents }) => remainingCents !== 0)
  ) {
    throw new DomainValidationError('unbalanced_settlement', 'Settlement ledger is not balanced');
  }
  return transfers;
}
