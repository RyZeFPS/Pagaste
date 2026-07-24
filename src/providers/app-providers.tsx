import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type PropsWithChildren } from 'react';
import { AppState, Platform, View } from 'react-native';
import { I18nProvider } from '@/i18n';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { useFinanceLiveRefresh } from '@/hooks/use-home-live-refresh';
import { NotificationCenterProvider } from '@/providers/notification-center-provider';
import { ThemeContext } from '@/providers/theme-context';
import { colors } from '@/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 },
  },
});

function NativeQueryFocusBridge() {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    focusManager.setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

  return null;
}

function FinanceRealtimeBridge({ children }: PropsWithChildren) {
  const auth = useAuth();
  useFinanceLiveRefresh(auth.user?.id);
  return (
    <NotificationCenterProvider userId={auth.user?.id} palette={colors.light}>
      <View style={{ flex: 1 }}>{children}</View>
    </NotificationCenterProvider>
  );
}

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <NativeQueryFocusBridge />
      <I18nProvider>
        <ThemeContext.Provider value={colors.light}>
          <AuthProvider>
            <FinanceRealtimeBridge>{children}</FinanceRealtimeBridge>
          </AuthProvider>
        </ThemeContext.Provider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export { useAppColors } from '@/providers/theme-context';
