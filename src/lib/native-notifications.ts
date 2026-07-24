import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const isExpoGo = Constants.appOwnership === 'expo';
export const nativeNotificationsAvailable = Platform.OS !== 'web' && !isExpoGo;

export async function loadNativeNotifications() {
  if (!nativeNotificationsAvailable) return null;
  return import('expo-notifications');
}
