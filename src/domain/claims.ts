import type { ClaimActor, ClaimStatus, ClaimTransition } from '../types';
import { DomainValidationError } from './errors';

/**
 * The transition table is deliberately explicit: claim state is security-
 * sensitive and must not be inferred from a numeric ordering of statuses.
 */
export const CLAIM_TRANSITIONS: readonly ClaimTransition[] = [
  { from: 'pending', to: 'received', actor: 'owner' },
  { from: 'pending', to: 'reminder_sent', actor: 'owner' },
  { from: 'pending', to: 'disputed', actor: 'debtor' },
  { from: 'pending', to: 'cancelled', actor: 'owner' },
  { from: 'reminder_sent', to: 'received', actor: 'owner' },
  { from: 'reminder_sent', to: 'disputed', actor: 'debtor' },
  { from: 'reminder_sent', to: 'cancelled', actor: 'owner' },
  { from: 'disputed', to: 'pending', actor: 'owner' },
  { from: 'disputed', to: 'reminder_sent', actor: 'owner' },
  { from: 'disputed', to: 'cancelled', actor: 'owner' },
] as const;

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus, actor: ClaimActor): boolean {
  return CLAIM_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to && transition.actor === actor,
  );
}

export const isClaimTransitionAllowed = canTransitionClaim;

export function assertClaimTransition(
  from: ClaimStatus,
  to: ClaimStatus,
  actor: ClaimActor,
): ClaimTransition {
  if (!canTransitionClaim(from, to, actor)) {
    throw new DomainValidationError(
      'invalid_claim_transition',
      `${actor} cannot transition a claim from ${from} to ${to}`,
    );
  }
  return { from, to, actor };
}

export function transitionClaimStatus(
  from: ClaimStatus,
  to: ClaimStatus,
  actor: ClaimActor,
): ClaimStatus {
  assertClaimTransition(from, to, actor);
  return to;
}

export function allowedClaimTransitions(from: ClaimStatus, actor?: ClaimActor): ClaimStatus[] {
  const statuses = new Set<ClaimStatus>();
  for (const transition of CLAIM_TRANSITIONS) {
    if (transition.from === from && (actor === undefined || transition.actor === actor)) {
      statuses.add(transition.to);
    }
  }
  return Array.from(statuses);
}
