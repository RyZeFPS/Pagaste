import type { AppNotification } from '@/lib/models';

export function getNotificationPresentation(item: AppNotification) {
  const claim = item.claim;
  const expense = claim?.expense;
  const groupName = expense?.group?.name;
  if (item.kind === 'payment_check_requested') {
    return {
      title: `${claim?.debtor?.display_name ?? 'Una persona'} te pide revisar el ingreso`,
      body: `${expense?.title ?? 'Gasto compartido'}${groupName ? ` · ${groupName}` : ''}`,
      person: claim?.debtor?.display_name ?? 'Pagaste',
      avatar: claim?.debtor?.avatar_path,
      detailRoute: claim?.expense_id
        ? (`/expense/${claim.expense_id}/status` as const)
        : ('/activity' as const),
    };
  }
  return {
    title: `${claim?.creditor?.display_name ?? 'Una persona'} te ha solicitado un pago`,
    body: `${expense?.title ?? 'Gasto compartido'}${groupName ? ` · ${groupName}` : ''}`,
    person: claim?.creditor?.display_name ?? 'Pagaste',
    avatar: claim?.creditor?.avatar_path,
    detailRoute: '/activity' as const,
  };
}

export function formatNotificationMoney(item: AppNotification) {
  if (item.claim?.amount_cents === undefined) return '';
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: item.claim.expense?.currency ?? 'EUR',
    minimumFractionDigits: 2,
  }).format(item.claim.amount_cents / 100);
}
