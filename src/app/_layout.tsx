import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router, Stack } from 'expo-router';
import type { NotificationResponse, Subscription } from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProviders } from '@/providers/app-providers';
import { useAuth } from '@/providers/auth-provider';
import { getSafeNotificationRedirect } from '@/lib/navigation';
import { loadNativeNotifications, nativeNotificationsAvailable } from '@/lib/native-notifications';

if (Platform.OS !== 'web') void SplashScreen.preventAutoHideAsync();

if (nativeNotificationsAvailable) {
  void loadNativeNotifications().then((Notifications) => {
    Notifications?.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  });
}

function openNotification(response: NotificationResponse): void {
  const route = getSafeNotificationRedirect(response.notification.request.content.data?.route);
  if (!route) return;
  router.push(route);
  void loadNativeNotifications().then((Notifications) =>
    Notifications?.clearLastNotificationResponse(),
  );
}

function RootNavigator() {
  const auth = useAuth();

  useEffect(() => {
    if (Platform.OS !== 'web' && !auth.loading) void SplashScreen.hideAsync();
  }, [auth.loading]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="auth/confirm" options={{ animation: 'fade' }} />
        <Stack.Screen name="c/[token]" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (!nativeNotificationsAvailable) return;
    let active = true;
    let subscription: Subscription | undefined;
    void loadNativeNotifications().then((Notifications) => {
      if (!active || !Notifications) return;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (active && response) openNotification(response);
      });
      subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    });
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return (
    <SafeAreaProvider>
      <AppProviders>
        <RootNavigator />
      </AppProviders>
    </SafeAreaProvider>
  );
}
