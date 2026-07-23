import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

async function runNativeHaptic(action: () => Promise<void>): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await action();
  } catch {
    // Haptics are an enhancement: unsupported hardware must never block the action.
  }
}

export function successHaptic(): Promise<void> {
  return runNativeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function lightHaptic(): Promise<void> {
  return runNativeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
