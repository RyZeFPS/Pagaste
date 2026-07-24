import { splitEvenly } from './money';

export const MANUAL_REMAINDER_CATEGORY = 'manual_remainder';
export const MANUAL_REMAINDER_NAME = 'Resto sin detallar';

export type EqualAllocationValue = Readonly<{
  participant_id: string;
  method: 'equal';
  shares: null;
  percentage: null;
  units: null;
  amount_cents: number;
}>;

export function equalAllocationValues(
  totalCents: number,
  participantIds: readonly string[],
): EqualAllocationValue[] {
  return splitEvenly(totalCents, participantIds)
    .filter(({ amountCents }) => amountCents !== 0)
    .map(({ memberId, amountCents }) => ({
      participant_id: memberId,
      method: 'equal',
      shares: null,
      percentage: null,
      units: null,
      amount_cents: amountCents,
    }));
}

export function isManualRemainder(category: string | null | undefined): boolean {
  return category === MANUAL_REMAINDER_CATEGORY;
}
