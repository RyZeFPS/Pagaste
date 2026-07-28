import { describe, expect, it } from 'vitest';
import {
  activityCounterpartyKey,
  buildActivityCsv,
  buildParticipantSummary,
  emptyActivityFilters,
  filterActivityHistory,
  isValidActivityFilterAmount,
  isValidActivityFilterDate,
  parseFilterAmountToCents,
  type ActivityHistoryRecord,
} from '../../src/lib/activity-history';

const currentUserId = 'current-user';

function record(
  overrides: Partial<ActivityHistoryRecord> & {
    id: string;
    amount_cents: number;
    status: ActivityHistoryRecord['status'];
  },
): ActivityHistoryRecord {
  return {
    expense_id: `expense-${overrides.id}`,
    sent_at: '2026-07-23T09:00:00.000Z',
    created_at: '2026-07-23T09:00:00.000Z',
    debtor: {
      id: 'participant-ferran',
      user_id: 'user-ferran',
      display_name: 'Ferrán',
      avatar_path: null,
    },
    creditor: {
      id: 'participant-current',
      user_id: currentUserId,
      display_name: 'RyZe',
      avatar_path: null,
    },
    expense: {
      id: `expense-${overrides.id}`,
      title: 'Compra semanal',
      merchant_name: 'Mercadona',
      occurred_at: '2026-07-23T09:00:00.000Z',
      currency: 'EUR',
      group_id: 'group-flat',
      group: { id: 'group-flat', name: 'Piso Centro' },
      items: [
        { id: 'item-cola', name: 'Coca Cola' },
        { id: 'item-bread', name: 'Pan' },
      ],
    },
    disputes: [],
    events: [],
    ...overrides,
  };
}

const pending = record({ id: 'pending', amount_cents: 850, status: 'pending' });
const incident = record({
  id: 'incident',
  amount_cents: 2_000,
  status: 'pending',
  debtor: {
    id: 'participant-current-2',
    user_id: currentUserId,
    display_name: 'RyZe',
    avatar_path: null,
  },
  creditor: {
    id: 'participant-ferran-2',
    user_id: 'user-ferran',
    display_name: 'Ferrán',
    avatar_path: null,
  },
  expense: {
    ...record({ id: 'base', amount_cents: 1, status: 'pending' }).expense!,
    id: 'expense-incident',
    title: 'Cena, viernes',
    merchant_name: 'La Pizzería',
    occurred_at: '2026-07-24T20:00:00.000Z',
    group_id: 'group-friends',
    group: { id: 'group-friends', name: 'Amigos' },
    items: [{ id: 'item-pizza', name: 'Pizza barbacoa' }],
  },
  disputes: [{ status: 'open' }],
});
const received = record({
  id: 'received',
  amount_cents: 1_000,
  status: 'received',
  expense: {
    ...record({ id: 'base-2', amount_cents: 1, status: 'pending' }).expense!,
    id: 'expense-received',
    occurred_at: '2026-07-20T12:00:00.000Z',
  },
});
const records = [pending, incident, received];

describe('activity history filters', () => {
  it('normalizes accents and searches person, merchant, group and product fields', () => {
    expect(
      filterActivityHistory(records, { ...emptyActivityFilters, person: 'ferran' }, currentUserId),
    ).toHaveLength(3);
    expect(
      filterActivityHistory(
        records,
        { ...emptyActivityFilters, merchant: 'pizzeria' },
        currentUserId,
      ).map((item) => item.id),
    ).toEqual(['incident']);
    expect(
      filterActivityHistory(
        records,
        { ...emptyActivityFilters, group: 'amigos', product: 'barbacoa' },
        currentUserId,
      ).map((item) => item.id),
    ).toEqual(['incident']);
    expect(
      filterActivityHistory(
        records,
        { ...emptyActivityFilters, query: 'coca cola' },
        currentUserId,
      ).map((item) => item.id),
    ).toEqual(['pending', 'received']);
  });

  it('filters pending claims, open incidents, date range and exact minor-unit amounts', () => {
    expect(
      filterActivityHistory(
        records,
        { ...emptyActivityFilters, status: 'pending' },
        currentUserId,
      ).map((item) => item.id),
    ).toEqual(['pending', 'incident']);
    expect(
      filterActivityHistory(
        records,
        { ...emptyActivityFilters, status: 'disputed' },
        currentUserId,
      ).map((item) => item.id),
    ).toEqual(['incident']);
    expect(
      filterActivityHistory(
        records,
        {
          ...emptyActivityFilters,
          dateFrom: '2026-07-23',
          dateTo: '2026-07-23',
          amountMin: '8,50',
          amountMax: '8.50',
        },
        currentUserId,
      ).map((item) => item.id),
    ).toEqual(['pending']);
  });

  it('validates localized amounts and ISO dates without floating-point conversion', () => {
    expect(parseFilterAmountToCents('8,50')).toBe(850);
    expect(parseFilterAmountToCents('1.234,56')).toBe(123_456);
    expect(parseFilterAmountToCents('12.345')).toBe(1_234_500);
    expect(isValidActivityFilterAmount('12,99 EUR')).toBe(false);
    expect(isValidActivityFilterDate('2026-02-29')).toBe(false);
    expect(isValidActivityFilterDate('2026-07-24')).toBe(true);
  });
});

describe('activity exports', () => {
  const labels = {
    date: 'Fecha',
    person: 'Persona',
    direction: 'Dirección',
    expense: 'Gasto',
    merchant: 'Comercio',
    group: 'Grupo',
    products: 'Productos',
    status: 'Estado',
    amount: 'Importe',
    currency: 'Moneda',
    incoming: 'Debes',
    outgoing: 'Te deben',
    notAvailable: 'Sin datos',
    statusLabel: (status: ActivityHistoryRecord['status']) => status,
    formatDate: (iso: string) => iso.slice(0, 10),
  };

  it('creates a UTF-8 CSV with exact decimal values and escaped cells', () => {
    const csv = buildActivityCsv([incident], currentUserId, labels, ';');
    expect(csv.startsWith('\uFEFFFecha;')).toBe(true);
    expect(csv).toContain(';Cena, viernes;');
    expect(csv).toContain('Pizza barbacoa');
    expect(csv).toContain(';20.00;EUR');
    expect(csv).toContain(';Debes;');
  });

  it('builds a direction-aware individual summary from the visible records', () => {
    const participantKey = activityCounterpartyKey(pending, currentUserId);
    const summary = buildParticipantSummary(records, participantKey, currentUserId, {
      title: (name) => `Resumen · ${name}`,
      owedToYou: (amount) => `A favor: ${amount}`,
      youOwe: (amount) => `Por pagar: ${amount}`,
      received: (amount) => `Recibido: ${amount}`,
      issues: (amount) => `Incidencias: ${amount}`,
      movements: 'Movimientos',
      incoming: 'Debes',
      outgoing: 'Te deben',
      notAvailable: 'Sin datos',
      statusLabel: (status) => status,
      formatMoney: (cents) => `${cents}c`,
      formatDate: (iso) => iso.slice(0, 10),
    });

    expect(summary).toContain('Resumen · Ferrán');
    expect(summary).toContain('A favor: 850c');
    expect(summary).toContain('Por pagar: 0c');
    expect(summary).toContain('Recibido: 1000c');
    expect(summary).toContain('Movimientos');
  });
});
