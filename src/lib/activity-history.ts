import type { ClaimStatus } from '@/lib/models';

type ActivityPerson = {
  id: string;
  user_id: string | null;
  display_name: string;
  avatar_path: string | null;
};

export type ActivityHistoryRecord = {
  id: string;
  expense_id: string;
  amount_cents: number;
  status: ClaimStatus;
  sent_at: string | null;
  created_at: string;
  debtor: ActivityPerson | null;
  creditor: ActivityPerson | null;
  expense: {
    id: string;
    title: string;
    merchant_name: string | null;
    occurred_at: string;
    currency: string;
    group_id: string | null;
    group: { id: string; name: string } | null;
    items: { id: string; name: string }[];
  } | null;
  disputes: { status: 'open' | 'resolved' | 'dismissed' }[];
  events: { event_type: string; created_at: string }[];
};

export type ActivityFilterStatus =
  'all' | 'pending' | 'received' | 'reminder_sent' | 'disputed' | 'cancelled';

export type ActivityHistoryFilters = {
  query: string;
  status: ActivityFilterStatus;
  person: string;
  merchant: string;
  group: string;
  product: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
};

export const emptyActivityFilters: ActivityHistoryFilters = {
  query: '',
  status: 'all',
  person: '',
  merchant: '',
  group: '',
  product: '',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
};

export function normalizeHistoryText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase();
}

export function parseFilterAmountToCents(value: string): number | null {
  let normalized = value.trim().replace(/\s/g, '');
  if (!normalized) return null;
  if (!/^\d+(?:[.,]\d+)*(?:[.,]\d{1,2})?$/.test(normalized)) return null;

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  const digitsAfterSeparator =
    decimalIndex >= 0 ? normalized.length - decimalIndex - 1 : Number.POSITIVE_INFINITY;

  let whole = normalized;
  let fraction = '';
  if (decimalIndex >= 0 && digitsAfterSeparator <= 2) {
    whole = normalized.slice(0, decimalIndex);
    fraction = normalized.slice(decimalIndex + 1);
  }
  whole = whole.replace(/[.,]/g, '');
  fraction = fraction.replace(/[.,]/g, '');
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return null;

  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export function activityCounterparty(record: ActivityHistoryRecord, userId?: string | null) {
  const incoming = Boolean(userId && record.debtor?.user_id === userId);
  return {
    incoming,
    person: incoming ? record.creditor : record.debtor,
  };
}

export function activityCounterpartyKey(
  record: ActivityHistoryRecord,
  userId?: string | null,
): string {
  const { person } = activityCounterparty(record, userId);
  return person?.user_id ? `user:${person.user_id}` : `participant:${person?.id ?? record.id}`;
}

function hasOpenIncident(record: ActivityHistoryRecord): boolean {
  return record.status === 'disputed' || record.disputes.some((item) => item.status === 'open');
}

function matchesStatus(record: ActivityHistoryRecord, status: ActivityFilterStatus): boolean {
  if (status === 'all') return true;
  if (status === 'pending') {
    return record.status === 'pending' || record.status === 'reminder_sent';
  }
  if (status === 'disputed') return hasOpenIncident(record);
  return record.status === status;
}

function validIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed
    ? null
    : trimmed;
}

export function isValidActivityFilterDate(value: string): boolean {
  return !value.trim() || validIsoDate(value) !== null;
}

export function isValidActivityFilterAmount(value: string): boolean {
  return !value.trim() || parseFilterAmountToCents(value) !== null;
}

function includesFilter(value: string | null | undefined, filter: string): boolean {
  const needle = normalizeHistoryText(filter);
  return !needle || normalizeHistoryText(value).includes(needle);
}

export function filterActivityHistory(
  records: readonly ActivityHistoryRecord[],
  filters: ActivityHistoryFilters,
  userId?: string | null,
): ActivityHistoryRecord[] {
  const query = normalizeHistoryText(filters.query);
  const dateFrom = validIsoDate(filters.dateFrom);
  const dateTo = validIsoDate(filters.dateTo);
  const amountMin = parseFilterAmountToCents(filters.amountMin);
  const amountMax = parseFilterAmountToCents(filters.amountMax);

  return records.filter((record) => {
    const { person } = activityCounterparty(record, userId);
    const expense = record.expense;
    const productNames = expense?.items.map((item) => item.name) ?? [];
    const occurredDate = expense?.occurred_at.slice(0, 10) ?? record.created_at.slice(0, 10);
    const queryHaystack = normalizeHistoryText(
      [
        person?.display_name,
        expense?.title,
        expense?.merchant_name,
        expense?.group?.name,
        ...productNames,
        record.status,
      ]
        .filter(Boolean)
        .join(' '),
    );

    if (query && !query.split(/\s+/).every((token) => queryHaystack.includes(token))) return false;
    if (!matchesStatus(record, filters.status)) return false;
    if (!includesFilter(person?.display_name, filters.person)) return false;
    if (!includesFilter(expense?.merchant_name, filters.merchant)) return false;
    if (!includesFilter(expense?.group?.name, filters.group)) return false;
    if (
      normalizeHistoryText(filters.product) &&
      !productNames.some((name) => includesFilter(name, filters.product))
    ) {
      return false;
    }
    if (dateFrom && occurredDate < dateFrom) return false;
    if (dateTo && occurredDate > dateTo) return false;
    if (amountMin !== null && record.amount_cents < amountMin) return false;
    if (amountMax !== null && record.amount_cents > amountMax) return false;
    return true;
  });
}

export function countActiveActivityFilters(filters: ActivityHistoryFilters): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    (filters.status !== 'all' ? 1 : 0) +
    (filters.person.trim() ? 1 : 0) +
    (filters.merchant.trim() ? 1 : 0) +
    (filters.group.trim() ? 1 : 0) +
    (filters.product.trim() ? 1 : 0) +
    (filters.dateFrom.trim() ? 1 : 0) +
    (filters.dateTo.trim() ? 1 : 0) +
    (filters.amountMin.trim() ? 1 : 0) +
    (filters.amountMax.trim() ? 1 : 0)
  );
}

export type ActivityCounterpartyOption = {
  key: string;
  name: string;
  recordCount: number;
};

export function listActivityCounterparties(
  records: readonly ActivityHistoryRecord[],
  userId?: string | null,
): ActivityCounterpartyOption[] {
  const people = new Map<string, ActivityCounterpartyOption>();
  for (const record of records) {
    const key = activityCounterpartyKey(record, userId);
    const name = activityCounterparty(record, userId).person?.display_name?.trim();
    if (!name) continue;
    const current = people.get(key);
    people.set(key, {
      key,
      name,
      recordCount: (current?.recordCount ?? 0) + 1,
    });
  }
  return [...people.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function exactDecimal(cents: number): string {
  const negative = cents < 0;
  const absolute = BigInt(negative ? -cents : cents);
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function csvCell(value: string, delimiter: string): string {
  const escaped = value.replace(/"/g, '""');
  return escaped.includes(delimiter) || /["\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export type ActivityExportLabels = {
  date: string;
  person: string;
  direction: string;
  expense: string;
  merchant: string;
  group: string;
  products: string;
  status: string;
  amount: string;
  currency: string;
  incoming: string;
  outgoing: string;
  notAvailable: string;
  statusLabel: (status: ClaimStatus) => string;
  formatDate: (iso: string) => string;
};

export function buildActivityCsv(
  records: readonly ActivityHistoryRecord[],
  userId: string | null | undefined,
  labels: ActivityExportLabels,
  delimiter = ',',
): string {
  const headers = [
    labels.date,
    labels.person,
    labels.direction,
    labels.expense,
    labels.merchant,
    labels.group,
    labels.products,
    labels.status,
    labels.amount,
    labels.currency,
  ];
  const rows = records.map((record) => {
    const { incoming, person } = activityCounterparty(record, userId);
    const expense = record.expense;
    return [
      labels.formatDate(expense?.occurred_at ?? record.created_at),
      person?.display_name ?? labels.notAvailable,
      incoming ? labels.incoming : labels.outgoing,
      expense?.title ?? labels.notAvailable,
      expense?.merchant_name ?? labels.notAvailable,
      expense?.group?.name ?? labels.notAvailable,
      expense?.items.map((item) => item.name).join(' | ') || labels.notAvailable,
      labels.statusLabel(record.status),
      exactDecimal(record.amount_cents),
      expense?.currency ?? 'EUR',
    ];
  });
  return `\uFEFF${[headers, ...rows]
    .map((row) => row.map((value) => csvCell(value, delimiter)).join(delimiter))
    .join('\r\n')}`;
}

export type ActivitySummaryLabels = {
  title: (name: string) => string;
  owedToYou: (amount: string) => string;
  youOwe: (amount: string) => string;
  received: (amount: string) => string;
  issues: (amount: string) => string;
  movements: string;
  incoming: string;
  outgoing: string;
  notAvailable: string;
  statusLabel: (status: ClaimStatus) => string;
  formatMoney: (cents: number, currency?: string) => string;
  formatDate: (iso: string) => string;
};

export function buildParticipantSummary(
  records: readonly ActivityHistoryRecord[],
  participantKey: string,
  userId: string | null | undefined,
  labels: ActivitySummaryLabels,
): string | null {
  const selected = records.filter(
    (record) => activityCounterpartyKey(record, userId) === participantKey,
  );
  if (!selected.length) return null;

  const personName =
    activityCounterparty(selected[0], userId).person?.display_name ?? labels.notAvailable;
  const currency = selected[0].expense?.currency ?? 'EUR';
  let owedToYou = 0;
  let youOwe = 0;
  let received = 0;
  let issues = 0;

  for (const record of selected) {
    const { incoming } = activityCounterparty(record, userId);
    if (record.status === 'received') received += record.amount_cents;
    else if (hasOpenIncident(record)) issues += record.amount_cents;
    else if (record.status === 'pending' || record.status === 'reminder_sent') {
      if (incoming) youOwe += record.amount_cents;
      else owedToYou += record.amount_cents;
    }
  }

  const lines = selected.map((record) => {
    const { incoming } = activityCounterparty(record, userId);
    const expense = record.expense;
    return [
      labels.formatDate(expense?.occurred_at ?? record.created_at),
      incoming ? labels.incoming : labels.outgoing,
      expense?.title ?? labels.notAvailable,
      labels.formatMoney(record.amount_cents, expense?.currency ?? currency),
      labels.statusLabel(record.status),
    ].join(' · ');
  });

  return [
    labels.title(personName),
    '',
    labels.owedToYou(labels.formatMoney(owedToYou, currency)),
    labels.youOwe(labels.formatMoney(youOwe, currency)),
    labels.received(labels.formatMoney(received, currency)),
    labels.issues(labels.formatMoney(issues, currency)),
    '',
    labels.movements,
    ...lines.map((line) => `• ${line}`),
  ].join('\n');
}
