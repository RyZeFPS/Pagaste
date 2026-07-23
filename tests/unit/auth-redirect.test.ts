import { describe, expect, it } from 'vitest';
import { buildAuthEmailRedirect } from '@/lib/supabase/auth-redirect';

describe('auth email redirects', () => {
  it('keeps callbacks on the trusted Pagaste origin', () => {
    expect(
      buildAuthEmailRedirect({
        appUrl: 'https://pagaste-nu.vercel.app',
        path: '/reset-password',
      }),
    ).toBe('https://pagaste-nu.vercel.app/reset-password');
  });

  it('preserves safe same-origin paths and query parameters', () => {
    expect(
      buildAuthEmailRedirect({
        appUrl: 'https://pagaste-nu.vercel.app',
        path: '/onboarding?next=%2Fgroups%2Fknown',
      }),
    ).toBe('https://pagaste-nu.vercel.app/onboarding?next=%2Fgroups%2Fknown');
  });

  it('allows localhost HTTP for automated and local web tests', () => {
    expect(
      buildAuthEmailRedirect({
        appUrl: 'http://127.0.0.1:8081',
        path: '/reset-password',
      }),
    ).toBe('http://127.0.0.1:8081/reset-password');
  });

  it('rejects cross-origin, fragment and insecure production redirects', () => {
    expect(() =>
      buildAuthEmailRedirect({
        appUrl: 'https://pagaste-nu.vercel.app',
        path: '//evil.example/reset-password',
      }),
    ).toThrow('INVALID_AUTH_REDIRECT_PATH');
    expect(() =>
      buildAuthEmailRedirect({
        appUrl: 'https://pagaste-nu.vercel.app',
        path: '/reset-password#access_token=secret',
      }),
    ).toThrow('INVALID_AUTH_REDIRECT_PATH');
    expect(() =>
      buildAuthEmailRedirect({
        appUrl: 'http://pagaste.example',
        path: '/reset-password',
      }),
    ).toThrow('INVALID_APP_URL');
  });
});
