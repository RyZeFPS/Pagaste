import { describe, expect, it } from 'vitest';
import { getSafeInviteRedirect, getSafeNotificationRedirect } from '../../src/lib/navigation';

const inviteToken = `${'A'.repeat(20)}_${'b'.repeat(21)}-`;
const invitePath = `/invite/${inviteToken}`;

describe('safe post-auth navigation', () => {
  it('accepts only an internal invite route with a valid base64url token', () => {
    expect(inviteToken).toHaveLength(43);
    expect(getSafeInviteRedirect(invitePath)).toBe(invitePath);
  });

  it.each([
    undefined,
    null,
    42,
    {},
    [],
    [invitePath],
    '/',
    '/(tabs)',
    `https://evil.example${invitePath}`,
    `//evil.example${invitePath}`,
    `/invite/${'A'.repeat(42)}`,
    `/invite/${'A'.repeat(44)}`,
    `${invitePath}/extra`,
    `${invitePath}?next=https://evil.example`,
    `${invitePath}#fragment`,
    `/invite/${'A'.repeat(40)}%2F`,
    `${invitePath}\n`,
  ])('rejects an unsafe or malformed destination: %j', (destination) => {
    expect(getSafeInviteRedirect(destination)).toBeUndefined();
  });
});

describe('safe notification navigation', () => {
  const uuid = '018f86ec-f14c-7830-ba31-666def626eb2';
  const publicClaimPath = `/c/${inviteToken}`;

  it.each([
    [`/expense/${uuid}/status`, `/expense/${uuid}/status`],
    [`/group/${uuid}`, `/group/${uuid}`],
    [invitePath, invitePath],
    [publicClaimPath, publicClaimPath],
    ['/activity', '/activity'],
    ['/settings/notifications', '/settings/notifications'],
  ])('accepts the internal route %s', (route, expected) => {
    expect(getSafeNotificationRedirect(route)).toBe(expected);
  });

  it.each([
    `https://evil.example/expense/${uuid}/status`,
    `//evil.example/group/${uuid}`,
    `/expense/${uuid}/review`,
    `/expense/not-a-uuid/status`,
    `/group/${uuid}?redirect=https://evil.example`,
    '/settings/account',
    `/c/${'A'.repeat(42)}`,
    `${publicClaimPath}?next=https://evil.example`,
    null,
    { route: `/group/${uuid}` },
  ])('rejects an unsafe notification route: %j', (route) => {
    expect(getSafeNotificationRedirect(route)).toBeUndefined();
  });
});
