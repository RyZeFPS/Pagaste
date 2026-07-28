import { describe, expect, it } from 'vitest';
import {
  buildOutstandingClaimGroupSummary,
  groupOutstandingClaimsByPerson,
  type GroupableOutstandingClaim,
} from '../../src/domain/grouped-claims';

const currentUserId = 'user-owner';

function claim(
  overrides: Partial<GroupableOutstandingClaim> & Pick<GroupableOutstandingClaim, 'id'>,
): GroupableOutstandingClaim {
  return {
    expense_id: `expense-${overrides.id}`,
    amount_cents: 850,
    status: 'pending',
    created_at: '2026-07-25T12:00:00.000Z',
    debtor: {
      id: 'participant-ferran',
      user_id: 'user-ferran',
      display_name: 'Ferran',
      avatar_path: null,
    },
    creditor: {
      id: 'participant-owner',
      user_id: currentUserId,
      display_name: 'RyZe',
      avatar_path: null,
    },
    expense: {
      title: `Gasto ${overrides.id}`,
      merchant_name: 'Mercadona',
      occurred_at: '2026-07-25T12:00:00.000Z',
      currency: 'EUR',
      group: { name: 'Piso' },
    },
    disputes: [],
    ...overrides,
  };
}

describe('groupOutstandingClaimsByPerson', () => {
  it('groups open outgoing claims for the same stable person and currency', () => {
    const groups = groupOutstandingClaimsByPerson(
      [
        claim({ id: 'weekly', amount_cents: 850 }),
        claim({
          id: 'tickets',
          amount_cents: 600,
          status: 'reminder_sent',
          expense: {
            title: 'Entradas',
            merchant_name: null,
            occurred_at: '2026-07-26T12:00:00.000Z',
            currency: 'eur',
            group: { name: 'Amigos' },
          },
        }),
      ],
      currentUserId,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'user:user-ferran|EUR',
      personName: 'Ferran',
      totalCents: 1_450,
      claimCount: 2,
      expenseCount: 2,
      currency: 'EUR',
    });
    expect(groups[0].items.map((item) => item.expenseTitle)).toEqual(['Entradas', 'Gasto weekly']);
  });

  it('never guesses identities, mixes currencies or includes incoming and disputed claims', () => {
    const sameNameOtherGuest = claim({
      id: 'guest-two',
      debtor: {
        id: 'participant-other-ferran',
        user_id: null,
        display_name: 'Ferran',
        avatar_path: null,
      },
    });
    const records = [
      claim({
        id: 'guest-one',
        debtor: {
          id: 'participant-first-ferran',
          user_id: null,
          display_name: 'Ferran',
          avatar_path: null,
        },
      }),
      sameNameOtherGuest,
      claim({
        id: 'dollars',
        expense: {
          title: 'Taxi',
          merchant_name: null,
          occurred_at: '2026-07-26T12:00:00.000Z',
          currency: 'USD',
          group: null,
        },
      }),
      claim({ id: 'disputed', status: 'disputed' }),
      claim({ id: 'incident', disputes: [{ status: 'open' }] }),
      claim({
        id: 'incoming',
        debtor: {
          id: 'participant-owner',
          user_id: currentUserId,
          display_name: 'RyZe',
          avatar_path: null,
        },
        creditor: {
          id: 'participant-ferran-creditor',
          user_id: 'user-ferran',
          display_name: 'Ferran',
          avatar_path: null,
        },
      }),
    ];

    expect(groupOutstandingClaimsByPerson(records, currentUserId)).toEqual([]);
    expect(groupOutstandingClaimsByPerson(records, undefined)).toEqual([]);
  });
});

describe('buildOutstandingClaimGroupSummary', () => {
  it('builds one shareable summary while stating that claims stay independent', () => {
    const [group] = groupOutstandingClaimsByPerson(
      [claim({ id: 'weekly', amount_cents: 850 }), claim({ id: 'tickets', amount_cents: 600 })],
      currentUserId,
    );
    const summary = buildOutstandingClaimGroupSummary(group, {
      title: (name) => `Pendiente de ${name}`,
      total: (amount, count) => `${amount} en ${count} gastos`,
      movements: 'Desglose',
      item: (date, title, amount) => `${date} · ${title} · ${amount}`,
      context: (merchant, groupName) => [merchant, groupName].filter(Boolean).join(' · ') || null,
      footer: 'Cada cobro conserva su estado independiente.',
      formatMoney: (cents, currency) => `${cents} ${currency}`,
      formatDate: (iso) => iso.slice(0, 10),
    });

    expect(summary).toContain('Pendiente de Ferran');
    expect(summary).toContain('1450 EUR en 2 gastos');
    expect(summary).toContain('Gasto weekly');
    expect(summary).toContain('Mercadona · Piso');
    expect(summary).toContain('Cada cobro conserva su estado independiente.');
  });
});
