import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export function AnimatedTabIcon({ focused, children }: { focused: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    const next = focused ? 1 : 0;
    progress.set(
      reduceMotion
        ? next
        : withTiming(next, {
            duration: 190,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.System,
          }),
    );
  }, [focused, progress, reduceMotion]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * -1 }, { scale: 1 + progress.value * 0.05 }],
  }));

  return (
    <View style={styles.frame}>
      <Animated.View style={iconStyle}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
