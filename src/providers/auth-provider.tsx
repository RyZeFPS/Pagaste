import type { Session, User } from '@supabase/supabase-js';
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

export function AuthProvider({ children }: PropsWithChildren) {
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
        const directPath = pendingNext
          ? `/onboarding?next=${encodeURIComponent(pendingNext)}`
          : '/onboarding';
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: buildAuthEmailRedirect({
              appUrl,
              path: directPath,
            }),
            data: {
              locale: 'es-ES',
              timezone: 'Europe/Madrid',
              ...(pendingNext ? { pending_next: pendingNext } : undefined),
            },
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
            path: '/reset-password',
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
        locale = 'es-ES',
        paymentPhoneE164,
        sharePaymentPhone,
      }) => {
        if (!session) throw new Error('AUTH_REQUIRED');
        const saved = await repository.saveProfile(session.user.id, {
          display_name: displayName,
          locale,
          ...(paymentPhoneE164 !== undefined
            ? { payment_phone_e164: paymentPhoneE164 }
            : undefined),
          ...(sharePaymentPhone !== undefined
            ? { share_payment_phone: sharePaymentPhone }
            : undefined),
        });
        setProfile(saved);
      },
      completeOnboarding: async (displayName) => {
        if (!session) throw new Error('AUTH_REQUIRED');
        const saved = await repository.saveProfile(session.user.id, {
          display_name: displayName,
          onboarding_completed: true,
        });
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
    [completePasswordRecovery, loading, passwordRecovery, profile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
