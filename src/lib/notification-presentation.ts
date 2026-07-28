import type { AppNotification } from '@/lib/models';
import { toIntlLocale, translate } from '@/i18n/core';
import type { Locale } from '@/i18n/translations';
import { formatCentsExact } from '@/lib/money-format';

export function getNotificationPresentation(item: AppNotification, locale: Locale = 'es') {
  const claim = item.claim;
  const expense = claim?.expense;
  const groupName = expense?.group?.name;
  if (item.kind === 'payment_check_requested') {
    const name = claim?.debtor?.display_name ?? translate(locale, 'common.person');
    return {
      title: translate(locale, 'notifications.paymentCheckTitle', { name }),
      body: `${expense?.title ?? translate(locale, 'common.sharedExpense')}${groupName ? ` · ${groupName}` : ''}`,
      person: claim?.debtor?.display_name ?? translate(locale, 'app.name'),
      avatar: claim?.debtor?.avatar_path,
      detailRoute: claim?.expense_id
        ? (`/expense/${claim.expense_id}/status` as const)
        : ('/activity' as const),
    };
  }
  const name = claim?.creditor?.display_name ?? translate(locale, 'common.person');
  return {
    title: translate(locale, 'notifications.claimTitle', { name }),
    body: `${expense?.title ?? translate(locale, 'common.sharedExpense')}${groupName ? ` · ${groupName}` : ''}`,
    person: claim?.creditor?.display_name ?? translate(locale, 'app.name'),
    avatar: claim?.creditor?.avatar_path,
    detailRoute: '/activity' as const,
  };
}

export function formatNotificationMoney(item: AppNotification, locale: Locale = 'es') {
  if (item.claim?.amount_cents === undefined) return '';
  return formatCentsExact(
    item.claim.amount_cents,
    item.claim.expense?.currency ?? 'EUR',
    toIntlLocale(locale),
  );
}
