import type {
  ExpenseCollaborationGuest,
  ExpenseCollaborationOwnerPayload,
  PublicExpenseCollaboration,
} from '@/lib/models';

export function toggleCollaborationItem(selected: readonly string[], itemId: string): string[] {
  return selected.includes(itemId) ? selected.filter((id) => id !== itemId) : [...selected, itemId];
}

export function collaborationSelectionTotal(
  collaboration: Pick<PublicExpenseCollaboration, 'items'>,
  selected: readonly string[],
): number {
  const selectedIds = new Set(selected);
  return collaboration.items.reduce(
    (total, item) => total + (selectedIds.has(item.id) ? item.lineTotalCents : 0),
    0,
  );
}

export function pendingCollaborationGuests(
  payload: ExpenseCollaborationOwnerPayload | undefined,
): ExpenseCollaborationGuest[] {
  return payload?.guests.filter((guest) => guest.status === 'submitted') ?? [];
}

export function canApplyCollaboration(
  payload: ExpenseCollaborationOwnerPayload | undefined,
): boolean {
  return (
    payload?.session?.status === 'active' &&
    !payload.session.expired &&
    pendingCollaborationGuests(payload).some((guest) => guest.items.length > 0)
  );
}
