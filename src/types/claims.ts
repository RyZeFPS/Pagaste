import type { Cents, CurrencyCode } from './money';

export type ClaimStatus = 'pending' | 'received' | 'reminder_sent' | 'disputed' | 'cancelled';

export type PublicClaimStatus = ClaimStatus;

export type ClaimActor = 'owner' | 'debtor' | 'system';

export interface ClaimTransition {
  from: ClaimStatus;
  to: ClaimStatus;
  actor: ClaimActor;
}

export interface PublicClaimItemDto {
  name: string;
  originalLineTotalCents: Cents;
  assignedAmountCents: Cents;
  allocationLabel: string;
}

export interface PublicClaimPaymentProgressPayerDto {
  displayName: string;
  amountCents: Cents;
  settledCents: Cents;
  status: PublicClaimStatus;
  isCurrent: boolean;
}

export interface PublicClaimPaymentProgressDto {
  totalCents: Cents;
  settledCents: Cents;
  pendingCents: Cents;
  completed: boolean;
  payers: readonly PublicClaimPaymentProgressPayerDto[];
}

export interface PublicClaimDto {
  creditorDisplayName: string;
  creditorAvatarUrl: string | null;
  /**
   * Present only when the creditor explicitly allowed their payment phone to
   * be included in this private claim link.
   */
  creditorPhoneE164: string | null;
  expenseTitle: string;
  merchantName: string | null;
  occurredAt: string;
  currency: CurrencyCode;
  amountCents: Cents;
  originalAmountCents: Cents;
  offsetAmountCents: Cents;
  status: PublicClaimStatus;
  recipientLocale?: string;
  linkExpiresAt?: string | null;
  items: readonly PublicClaimItemDto[];
  paymentProgress: PublicClaimPaymentProgressDto;
  canDispute: boolean;
}

export interface PublicClaimCompletionDto {
  terminal: true;
  status: 'received';
  completed: true;
  recipientLocale?: string;
}

export type PublicClaimResponseDto = PublicClaimDto | PublicClaimCompletionDto;

export type ClaimDisputeReason =
  'did_not_consume' | 'incorrect_amount' | 'already_paid' | 'unknown_expense' | 'other';
