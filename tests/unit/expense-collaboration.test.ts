import { describe, expect, it } from 'vitest';
import {
  canApplyCollaboration,
  collaborationSelectionTotal,
  pendingCollaborationGuests,
  toggleCollaborationItem,
} from '@/domain/expense-collaboration';
import { encodeQrCode } from '@/domain/qr-code';
import type { ExpenseCollaborationOwnerPayload, PublicExpenseCollaboration } from '@/lib/models';

const publicPayload: PublicExpenseCollaboration = {
  expenseId: 'expense',
  title: 'Cena',
  merchantName: null,
  currency: 'EUR',
  totalCents: 2_000,
  expiresAt: '2026-07-27T12:00:00.000Z',
  items: [
    { id: 'pizza', name: 'Pizza', quantity: 1, lineTotalCents: 1_500 },
    { id: 'water', name: 'Agua', quantity: 2, lineTotalCents: 500 },
  ],
};

describe('expense collaboration', () => {
  it('toggles item ids without mutating the previous selection', () => {
    const before = ['pizza'];
    expect(toggleCollaborationItem(before, 'water')).toEqual(['pizza', 'water']);
    expect(before).toEqual(['pizza']);
    expect(toggleCollaborationItem(before, 'pizza')).toEqual([]);
  });

  it('calculates the selected total in integer cents', () => {
    expect(collaborationSelectionTotal(publicPayload, ['water'])).toBe(500);
    expect(collaborationSelectionTotal(publicPayload, ['pizza', 'water'])).toBe(2_000);
    expect(collaborationSelectionTotal(publicPayload, ['unknown'])).toBe(0);
  });

  it('only applies pending, non-empty guest selections from an active session', () => {
    const payload: ExpenseCollaborationOwnerPayload = {
      session: {
        id: 'session',
        expenseId: 'expense',
        status: 'active',
        expiresAt: '2026-07-27T12:00:00.000Z',
        expired: false,
        createdAt: '2026-07-26T12:00:00.000Z',
      },
      guests: [
        {
          id: 'guest',
          displayName: 'Ferran',
          status: 'submitted',
          submittedAt: '2026-07-26T12:05:00.000Z',
          items: [{ id: 'pizza', name: 'Pizza', lineTotalCents: 1_500 }],
        },
        {
          id: 'old',
          displayName: 'Marta',
          status: 'applied',
          submittedAt: '2026-07-26T12:00:00.000Z',
          items: [{ id: 'water', name: 'Agua', lineTotalCents: 500 }],
        },
      ],
    };
    expect(pendingCollaborationGuests(payload).map((guest) => guest.id)).toEqual(['guest']);
    expect(canApplyCollaboration(payload)).toBe(true);
    expect(
      canApplyCollaboration({
        ...payload,
        session: payload.session && { ...payload.session, status: 'revoked' },
      }),
    ).toBe(false);
  });
});

describe('collaboration QR encoder', () => {
  it('creates a deterministic Version 6 matrix with finder patterns', () => {
    const url = 'https://pagaste.app/join/0123456789012345678901234567890123456789012?lang=es';
    const matrix = encodeQrCode(url);
    expect(matrix).toHaveLength(41);
    expect(matrix.every((row) => row.length === 41)).toBe(true);
    expect(matrix).toEqual(encodeQrCode(url));
    expect(matrix[0]?.slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
    expect(matrix[6]?.slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
    expect(matrix[3]?.slice(0, 7)).toEqual([true, false, true, true, true, false, true]);
  });

  it('rejects payloads beyond the fixed symbol capacity', () => {
    expect(() => encodeQrCode('x'.repeat(135))).toThrow('QR_PAYLOAD_TOO_LONG');
  });
});
