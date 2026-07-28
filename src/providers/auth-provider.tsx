import type { Session, User } from '@supabase/supabase-js';
import { getCalendars } from 'expo-localization';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { repository } from '@/lib/repository';
import { appUrl, supabase, supabaseConfigured } from '@/lib/supabase/client';
import { buildAuthEmailRedirect } from '@/lib/supabase/auth-redirect';
import { getSafeInviteRedirect } from '@/lib/navigation';
import { buildAuthUserMetadata, normalizeAuthTimeZone } from '@/lib/auth-metadata';
import { normalizeLocale, toIntlLocale, useI18n } from '@/i18n';
import type { Profile } from '@/lib/models';

type SaveProfileValues = {
  displayName: string;
  locale?: string;
  paymentPhoneE164?: string | null;
  sharePaymentPhone?: boolean;
};

type AuthValue = {
  configured: boolean;
  loading: boolean;
  passwordRecovery: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (
    email: string,
    password: string,
    options?: { next?: string },
  ) => Promise<{ confirmationRequired: boolean }>;
  requestPasswordReset: (email: string) => Promise<void>;
  completePasswordRecovery: (input: { code?: string; tokenHash?: string }) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  saveProfile: (values: SaveProfileValues) => Promise<void>;
  completeOnboarding: (displayName: string) => Promise<void>;
  uploadProfileAvatar: (uri: string) => Promise<void>;
  removeProfileAvatar: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function deviceTimeZone(): string | undefined {
  let calendarTimeZone: string | null | undefined;
  try {
    calendarTimeZone = getCalendars()[0]?.timeZone;
  } catch {
    calendarTimeZone = undefined;
  }

  const fromCalendar = normalizeAuthTimeZone(calendarTimeZone);
  if (fromCalendar) return fromCalendar;

  try {
    return normalizeAuthTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const { locale: activeLocale } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [loading, setLoading] = useState(supabaseConfigured);

  const loadProfile = async (userId: string) => setProfile(await repository.profile(userId));

  const completePasswordRecovery = useCallback(
    async ({ code, tokenHash }: { code?: string; tokenHash?: string }) => {
      if (!supabase || Boolean(code) === Boolean(tokenHash)) {
        throw new Error('INVALID_RECOVERY_CALLBACK');
      }

      const result = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.verifyOtp({
            token_hash: tokenHash!,
            type: 'recovery',
          });

      if (result.error || !result.data.session) {
        throw result.error ?? new Error('INVALID_RECOVERY_SESSION');
      }

      setSession(result.data.session);
      setPasswordRecovery(true);
    },
    [],
  );

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    let revision = 0;
    let observedAuthEvent = false;
    let pendingUserId: string | null = null;
    let resolvedUserId: string | null = null;

    const syncSession = async (nextSession: Session | null) => {
      if (!mounted) return;

      const userId = nextSession?.user.id ?? null;
      setSession(nextSession);

      if (!userId) {
        revision += 1;
        pendingUserId = null;
        resolvedUserId = null;
        setProfile(null);
        setLoading(false);
        return;
      }

      if (resolvedUserId === userId) {
        setLoading(false);
        return;
      }

      if (pendingUserId === userId) {
        setLoading(true);
        return;
      }

      const requestRevision = ++revision;
      pendingUserId = userId;
      setProfile(null);
      setLoading(true);

      try {
        const nextProfile = await repository.profile(userId);
        if (!mounted || requestRevision !== revision) return;
        resolvedUserId = userId;
        setProfile(nextProfile);
      } catch {
        if (!mounted || requestRevision !== revision) return;
        resolvedUserId = userId;
        setProfile(null);
      } finally {
        if (mounted && requestRevision === revision) {
          pendingUserId = null;
          setLoading(false);
        }
      }
    };

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      observedAuthEvent = true;
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setPasswordRecovery(false);
      void syncSession(nextSession);
    });

    void supabase.auth
      .getSession()
      .then(({ data: sessionData }) => {
        if (!mounted || observedAuthEvent) return;
        void syncSession(sessionData.session);
      })
      .catch(() => {
        if (!mounted || observedAuthEvent) return;
        void syncSession(null);
      });

    return () => {
      mounted = false;
      revision += 1;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      configured: supabaseConfigured,
      loading,
      passwordRecovery,
      session,
      user: session?.user ?? null,
      profile,
      refreshProfile: async () => {
        if (session) await loadProfile(session.user.id);
      },
      signInWithPassword: async (email, password) => {
        if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signUpWithPassword: async (email, password, options) => {
        if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
        const pendingNext = getSafeInviteRedirect(options?.next);
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: buildAuthEmailRedirect({
              appUrl,
              path: '/auth/confirm',
            }),
            data: buildAuthUserMetadata({
              locale: activeLocale,
              timezone: deviceTimeZone(),
              pendingNext,
            }),
          },
        });
        if (error) throw error;
        return { confirmationRequired: data.session == null };
      },
      requestPasswordReset: async (email) => {
        if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: buildAuthEmailRedirect({
            appUrl,
            path: '/auth/confirm',
          }),
        });
        if (error) throw error;
      },
      completePasswordRecovery,
      updatePassword: async (password) => {
        if (!supabase || !session || !passwordRecovery) throw new Error('RECOVERY_REQUIRED');
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPasswordRecovery(false);
      },
      saveProfile: async ({
        displayName,
        locale: profileLocale = toIntlLocale(activeLocale),
        paymentPhoneE164,
        sharePaymentPhone,
      }) => {
        if (!session) throw new Error('AUTH_REQUIRED');
        const saved = await repository.saveProfile(session.user.id, {
          display_name: displayName,
          locale: profileLocale,
          ...(paymentPhoneE164 !== undefined
            ? { payment_phone_e164: paymentPhoneE164 }
            : undefined),
          ...(sharePaymentPhone !== undefined
            ? { share_payment_phone: sharePaymentPhone }
            : undefined),
        });
        if (supabase) {
          const { error } = await supabase.auth.updateUser({
            data: buildAuthUserMetadata({
              locale: normalizeLocale(profileLocale),
              timezone: deviceTimeZone(),
            }),
          });
          if (error) throw error;
        }
        setProfile(saved);
      },
      completeOnboarding: async (displayName) => {
        if (!session) throw new Error('AUTH_REQUIRED');
        const saved = await repository.saveProfile(session.user.id, {
          display_name: displayName,
          locale: toIntlLocale(activeLocale),
          onboarding_completed: true,
        });
        if (supabase) {
          const { error } = await supabase.auth.updateUser({
            data: buildAuthUserMetadata({
              locale: activeLocale,
              timezone: deviceTimeZone(),
            }),
          });
          if (error) throw error;
        }
        setProfile(saved);
      },
      uploadProfileAvatar: async (uri) => {
        if (!session) throw new Error('AUTH_REQUIRED');
        setProfile(await repository.uploadProfileAvatar(session.user.id, uri));
      },
      removeProfileAvatar: async () => {
        if (!session) throw new Error('AUTH_REQUIRED');
        setProfile(await repository.removeProfileAvatar(session.user.id));
      },
      signOut: async () => {
        setPasswordRecovery(false);
        if (supabase) await supabase.auth.signOut();
      },
    }),
    [activeLocale, completePasswordRecovery, loading, passwordRecovery, profile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
