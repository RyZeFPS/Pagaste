import type { ClaimStatus } from '../types';

export type GroupableClaimPerson = {
  id: string;
  user_id: string | null;
  display_name: string;
  avatar_path: string | null;
};

export type GroupableOutstandingClaim = {
  id: string;
  expense_id: string;
  amount_cents: number;
  status: ClaimStatus;
  created_at: string;
  debtor: GroupableClaimPerson | null;
  creditor: GroupableClaimPerson | null;
  expense: {
    title: string;
    merchant_name: string | null;
    occurred_at: string;
    currency: string;
    group: { name: string } | null;
  } | null;
  disputes: { status: 'open' | 'resolved' | 'dismissed' }[];
};

export type OutstandingClaimGroupItem = {
  claimId: string;
  expenseId: string;
  expenseTitle: string;
  merchantName: string | null;
  groupName: string | null;
  occurredAt: string;
  amountCents: number;
};

export type OutstandingClaimGroup = {
  key: string;
  personId: string;
  personUserId: string | null;
  personName: string;
  avatarPath: string | null;
  currency: string;
  totalCents: number;
  claimCount: number;
  expenseCount: number;
  items: OutstandingClaimGroupItem[];
};

function stablePersonKey(person: GroupableClaimPerson): string {
  return person.user_id ? `user:${person.user_id}` : `participant:${person.id}`;
}

function isOpenOutstandingClaim(claim: GroupableOutstandingClaim): boolean {
  return (
    (claim.status === 'pending' || claim.status === 'reminder_sent') &&
    !claim.disputes.some((dispute) => dispute.status === 'open') &&
    Number.isSafeInteger(claim.amount_cents) &&
    claim.amount_cents > 0
  );
}

/**
 * Builds a read-only projection of money still owed to the current user.
 *
 * A group never combines different currencies or guesses that two guests with
 * the same display name are the same person. It is intentionally informational:
 * every claim keeps its own lifecycle and can still be closed independently.
 */
export function groupOutstandingClaimsByPerson(
  claims: readonly GroupableOutstandingClaim[],
  currentUserId: string | null | undefined,
): OutstandingClaimGroup[] {
  if (!currentUserId) return [];

  const grouped = new Map<
    string,
    Omit<OutstandingClaimGroup, 'totalCents' | 'claimCount' | 'expenseCount'> & {
      expenseIds: Set<string>;
      total: bigint;
    }
  >();

  for (const claim of claims) {
    if (!isOpenOutstandingClaim(claim)) continue;
    if (claim.creditor?.user_id !== currentUserId || claim.debtor?.user_id === currentUserId) {
      continue;
    }

    const person = claim.debtor;
    if (!person) continue;
    const currency = claim.expense?.currency.trim().toUpperCase() || 'EUR';
    const personKey = stablePersonKey(person);
    const key = `${personKey}|${currency}`;
    const current = grouped.get(key) ?? {
      key,
      personId: person.id,
      personUserId: person.user_id,
      personName: person.display_name.trim() || person.id,
      avatarPath: person.avatar_path,
      currency,
      items: [],
      expenseIds: new Set<string>(),
      total: 0n,
    };

    current.total += BigInt(claim.amount_cents);
    current.expenseIds.add(claim.expense_id);
    current.items.push({
      claimId: claim.id,
      expenseId: claim.expense_id,
      expenseTitle: claim.expense?.title.trim() || claim.expense_id,
      merchantName: claim.expense?.merchant_name?.trim() || null,
      groupName: claim.expense?.group?.name.trim() || null,
      occurredAt: claim.expense?.occurred_at ?? claim.created_at,
      amountCents: claim.amount_cents,
    });
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .filter((group) => group.expenseIds.size >= 2 && group.items.length >= 2)
    .map((group) => {
      if (group.total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      return {
        key: group.key,
        personId: group.personId,
        personUserId: group.personUserId,
        personName: group.personName,
        avatarPath: group.avatarPath,
        currency: group.currency,
        totalCents: Number(group.total),
        claimCount: group.items.length,
        expenseCount: group.expenseIds.size,
        items: [...group.items].sort((left, right) =>
          right.occurredAt.localeCompare(left.occurredAt),
        ),
      } satisfies OutstandingClaimGroup;
    })
    .filter((group): group is OutstandingClaimGroup => group !== null)
    .sort(
      (left, right) =>
        right.totalCents - left.totalCents || left.personName.localeCompare(right.personName),
    );
}

export type OutstandingClaimSummaryLabels = {
  title: (name: string) => string;
  total: (amount: string, expenseCount: number) => string;
  movements: string;
  item: (date: string, title: string, amount: string) => string;
  context: (merchant: string | null, group: string | null) => string | null;
  footer: string;
  formatMoney: (cents: number, currency?: string) => string;
  formatDate: (iso: string) => string;
};

export function buildOutstandingClaimGroupSummary(
  group: OutstandingClaimGroup,
  labels: OutstandingClaimSummaryLabels,
): string {
  const lines = group.items.flatMap((item) => {
    const primary = labels.item(
      labels.formatDate(item.occurredAt),
      item.expenseTitle,
      labels.formatMoney(item.amountCents, group.currency),
    );
    const context = labels.context(item.merchantName, item.groupName);
    return context ? [`• ${primary}`, `  ${context}`] : [`• ${primary}`];
  });

  return [
    labels.title(group.personName),
    labels.total(labels.formatMoney(group.totalCents, group.currency), group.expenseCount),
    '',
    labels.movements,
    ...lines,
    '',
    labels.footer,
  ].join('\n');
}
