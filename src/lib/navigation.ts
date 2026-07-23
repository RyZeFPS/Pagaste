export type InviteRedirect = `/invite/${string}`;
export type NotificationRedirect =
  InviteRedirect | `/expense/${string}/status` | `/group/${string}`;

const INVITE_PREFIX = '/invite/';
const INVITE_TOKEN_LENGTH = 43;
const INVALID_BASE64URL_CHARACTER = /[^A-Za-z0-9_-]/u;

/**
 * Returns a post-auth destination only when it is one of Pagaste's internal
 * invite routes. Treat URL/search params as untrusted input at this boundary.
 */
export function getSafeInviteRedirect(value: unknown): InviteRedirect | undefined {
  if (typeof value !== 'string' || !value.startsWith(INVITE_PREFIX)) return undefined;

  const token = value.slice(INVITE_PREFIX.length);
  if (token.length !== INVITE_TOKEN_LENGTH || INVALID_BASE64URL_CHARACTER.test(token)) {
    return undefined;
  }

  return value as InviteRedirect;
}

const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const EXPENSE_STATUS_ROUTE = new RegExp(`^/expense/${UUID}/status$`, 'u');
const GROUP_ROUTE = new RegExp(`^/group/${UUID}$`, 'u');

export function getSafeNotificationRedirect(value: unknown): NotificationRedirect | undefined {
  const invite = getSafeInviteRedirect(value);
  if (invite) return invite;
  if (typeof value !== 'string') return undefined;
  if (!EXPENSE_STATUS_ROUTE.test(value) && !GROUP_ROUTE.test(value)) return undefined;
  return value as NotificationRedirect;
}
