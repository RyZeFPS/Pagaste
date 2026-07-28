import { describe, expect, it } from 'vitest';
import {
  allowedClaimTransitions,
  assertClaimTransition,
  canTransitionClaim,
  sanitizePublicClaimDto,
  sanitizePublicClaimResponseDto,
  transitionClaimStatus,
} from '../../src/domain';

describe('claim state machine', () => {
  it('allows only the receiver, reminder and dispute transitions', () => {
    expect(canTransitionClaim('pending', 'reminder_sent', 'owner')).toBe(true);
    expect(canTransitionClaim('pending', 'received', 'owner')).toBe(true);
    expect(canTransitionClaim('pending', 'disputed', 'debtor')).toBe(true);
    expect(transitionClaimStatus('reminder_sent', 'received', 'owner')).toBe('received');
    expect(canTransitionClaim('received', 'pending', 'owner')).toBe(false);
    expect(canTransitionClaim('pending', 'received', 'debtor')).toBe(false);
    expect(() => assertClaimTransition('cancelled', 'pending', 'owner')).toThrowError(
      expect.objectContaining({ code: 'invalid_claim_transition' }),
    );
  });

  it('keeps received and cancelled terminal', () => {
    expect(allowedClaimTransitions('pending', 'owner')).toEqual([
      'received',
      'reminder_sent',
      'cancelled',
    ]);
    expect(allowedClaimTransitions('received')).toEqual([]);
    expect(allowedClaimTransitions('cancelled')).toEqual([]);
  });
});

describe('public claim projection', () => {
  const source = {
    id: 'internal-claim-id',
    public_token_hash: 'must-not-leak',
    debtorEmail: 'private@example.com',
    creditorDisplayName: '  David\u0000  ',
    creditorAvatarUrl: null,
    creditorPhoneE164: '+34600111222',
    expenseTitle: ' Cena   viernes ',
    merchantName: 'Pizzería',
    occurredAt: '2026-07-22T12:00:00+02:00',
    currency: 'eur',
    amountCents: 850,
    originalAmountCents: 850,
    offsetAmountCents: 0,
    status: 'pending',
    paymentProgress: {
      totalCents: 2_050,
      settledCents: 1_200,
      pendingCents: 850,
      completed: false,
      payers: [
        {
          internalParticipantId: 'must-not-leak',
          displayName: ' Ferran ',
          amountCents: 850,
          settledCents: 0,
          status: 'pending',
          isCurrent: true,
        },
        {
          displayName: ' Marta ',
          amountCents: 1_200,
          settledCents: 1_200,
          status: 'received',
          isCurrent: false,
        },
      ],
    },
    items: [
      {
        id: 'internal-item-id',
        name: ' Pizza ',
        originalLineTotalCents: 1_200,
        assignedAmountCents: 850,
        allocationLabel: 'Reparto igual',
      },
    ],
  };

  it('whitelists, normalizes and derives dispute capability', () => {
    const dto = sanitizePublicClaimDto(source);
    expect(dto).toEqual({
      creditorDisplayName: 'David',
      creditorAvatarUrl: null,
      creditorPhoneE164: '+34600111222',
      expenseTitle: 'Cena viernes',
      merchantName: 'Pizzería',
      occurredAt: '2026-07-22T10:00:00.000Z',
      currency: 'EUR',
      amountCents: 850,
      originalAmountCents: 850,
      offsetAmountCents: 0,
      status: 'pending',
      paymentProgress: {
        totalCents: 2_050,
        settledCents: 1_200,
        pendingCents: 850,
        completed: false,
        payers: [
          {
            displayName: 'Ferran',
            amountCents: 850,
            settledCents: 0,
            status: 'pending',
            isCurrent: true,
          },
          {
            displayName: 'Marta',
            amountCents: 1_200,
            settledCents: 1_200,
            status: 'received',
            isCurrent: false,
          },
        ],
      },
      canDispute: true,
      items: [
        {
          name: 'Pizza',
          originalLineTotalCents: 1_200,
          assignedAmountCents: 850,
          allocationLabel: 'Reparto igual',
        },
      ],
    });
    expect(dto).not.toHaveProperty('id');
    expect(dto).not.toHaveProperty('paymentConcept');
    expect(dto).not.toHaveProperty('canMarkPaid');
    expect(dto.items[0]).not.toHaveProperty('id');
    expect(dto.paymentProgress.payers[0]).not.toHaveProperty('internalParticipantId');
  });

  it('accepts a withheld phone and rejects legacy or unsafe payloads', () => {
    expect(
      sanitizePublicClaimDto({ ...source, creditorPhoneE164: null }).creditorPhoneE164,
    ).toBeNull();
    expect(() => sanitizePublicClaimDto({ ...source, status: 'marked_paid' })).toThrow();
    expect(() =>
      sanitizePublicClaimDto({ ...source, amountCents: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
    expect(() =>
      sanitizePublicClaimDto({ ...source, creditorAvatarUrl: 'javascript:x' }),
    ).toThrow();
  });

  it('preserves signed discounts so the net breakdown remains auditable', () => {
    const dto = sanitizePublicClaimDto({
      ...source,
      amountCents: 1_800,
      internalExpenseId: 'must-not-leak',
      items: [
        {
          name: 'Menú',
          originalLineTotalCents: 2_000,
          assignedAmountCents: 2_000,
          allocationLabel: 'Una persona',
        },
        {
          name: 'Descuento',
          originalLineTotalCents: -200,
          assignedAmountCents: -200,
          allocationLabel: 'Ajuste individual',
        },
      ],
    });

    expect(dto.items[1]?.assignedAmountCents).toBe(-200);
    expect(dto.items.reduce((sum, item) => sum + item.assignedAmountCents, 0)).toBe(
      dto.amountCents,
    );
    expect(dto).not.toHaveProperty('internalExpenseId');
  });

  it('accepts only a minimal terminal confirmation after the full link is revoked', () => {
    const dto = sanitizePublicClaimResponseDto({
      terminal: true,
      status: 'received',
      completed: true,
      recipientLocale: 'es-ES',
      creditorDisplayName: 'must-not-leak',
      amountCents: 8_500,
      items: [{ name: 'must-not-leak' }],
    });

    expect(dto).toEqual({
      terminal: true,
      status: 'received',
      completed: true,
      recipientLocale: 'es-ES',
    });
    expect(dto).not.toHaveProperty('creditorDisplayName');
    expect(dto).not.toHaveProperty('amountCents');
    expect(dto).not.toHaveProperty('items');
  });
});
