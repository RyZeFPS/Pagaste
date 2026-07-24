import { describe, expect, it } from 'vitest';
import {
  formatNotificationMoney,
  getNotificationPresentation,
} from '../../src/lib/notification-presentation';
import type { AppNotification } from '../../src/lib/models';

function notification(kind: AppNotification['kind']): AppNotification {
  return {
    id: 'notification-id',
    user_id: 'recipient-id',
    kind,
    claim_id: 'claim-id',
    read_at: null,
    created_at: '2026-07-24T10:00:00.000Z',
    claim: {
      id: 'claim-id',
      expense_id: '018f86ec-f14c-7830-ba31-666def626eb2',
      amount_cents: 850,
      status: 'pending',
      debtor: {
        id: 'debtor-id',
        user_id: 'debtor-user-id',
        display_name: 'Ferran',
        avatar_path: null,
      },
      creditor: {
        id: 'creditor-id',
        user_id: 'creditor-user-id',
        display_name: 'David',
        avatar_path: null,
      },
      expense: {
        id: '018f86ec-f14c-7830-ba31-666def626eb2',
        title: 'Cena',
        currency: 'EUR',
        group_id: 'group-id',
        group: { id: 'group-id', name: 'Monos' },
      },
    },
  };
}

describe('notification presentation', () => {
  it('describes a payment request with its group context', () => {
    const item = notification('claim_requested');
    expect(getNotificationPresentation(item)).toMatchObject({
      title: 'David te ha solicitado un pago',
      body: 'Cena · Monos',
      detailRoute: '/activity',
    });
    expect(formatNotificationMoney(item)).toContain('8,50');
  });

  it('routes a bank-check request to the receiver status screen', () => {
    const item = notification('payment_check_requested');
    expect(getNotificationPresentation(item)).toMatchObject({
      title: 'Ferran te pide revisar el ingreso',
      detailRoute: '/expense/018f86ec-f14c-7830-ba31-666def626eb2/status',
    });
  });
});
