import { describe, expect, it } from 'vitest';
import { toSecureStoreKey } from '@/lib/secure-store-key';

describe('toSecureStoreKey', () => {
  it('only emits characters accepted by Expo SecureStore', () => {
    const key = toSecureStoreKey('sb-project-auth-token:claim-links/user@example.com');

    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('keeps distinct source keys distinct', () => {
    expect(toSecureStoreKey(':')).not.toBe(toSecureStoreKey('.003a'));
    expect(toSecureStoreKey('push-token:user-1')).not.toBe(toSecureStoreKey('push.token:user-1'));
  });

  it('returns a valid non-empty key for an empty source key', () => {
    expect(toSecureStoreKey('')).toBe('pagaste.');
  });
});
