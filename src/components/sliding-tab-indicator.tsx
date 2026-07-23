import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useAppColors } from '@/providers/app-providers';
import { tabIndexFromPath } from '@/lib/tab-navigation';

const TAB_COUNT = 4;

export function SlidingTabIndicator() {
  const pathname = usePathname();
  const palette = useAppColors();
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const translateX = useSharedValue(0);
  const slotWidth = width / TAB_COUNT;
  const indicatorWidth = Math.max(0, Math.min(86, slotWidth - 8));
  const target = tabIndexFromPath(pathname) * slotWidth + (slotWidth - indicatorWidth) / 2;

  useEffect(() => {
    if (!width) return;
    translateX.set(
      reduceMotion
        ? target
        : withSpring(target, {
            mass: 0.72,
            damping: 19,
            stiffness: 220,
            overshootClamping: true,
            reduceMotion: ReduceMotion.System,
          }),
    );
  }, [reduceMotion, target, translateX, width]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {indicatorWidth ? (
        <Animated.View
          testID="tab-selection-indicator"
          style={[
            styles.indicator,
            {
              width: indicatorWidth,
              backgroundColor: palette.primaryLight,
              borderColor: palette.primarySoft,
              shadowColor: palette.primary,
            },
            indicatorStyle,
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 17,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
});
