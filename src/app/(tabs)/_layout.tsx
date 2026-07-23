import { Tabs } from 'expo-router';
import { Activity, ReceiptText, UserRound, UsersRound } from 'lucide-react-native';
import { Animated as RNAnimated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { RequireAuth } from '@/components/app-shell';
import { AnimatedTabIcon } from '@/components/animated-tab-icon';
import { SlidingTabIndicator } from '@/components/sliding-tab-indicator';
import { useAppColors } from '@/providers/app-providers';

export default function TabsLayout() {
  const palette = useAppColors();
  const reduceMotion = useReducedMotion();
  return (
    <RequireAuth>
      <View style={[styles.tabsRoot, { backgroundColor: palette.background }]}>
        <Tabs
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: palette.background },
            tabBarActiveTintColor: palette.primary,
            tabBarInactiveTintColor: palette.textSecondary,
            tabBarHideOnKeyboard: true,
            animation: reduceMotion ? 'none' : 'shift',
            transitionSpec: {
              animation: 'timing',
              config: {
                duration: reduceMotion ? 0 : 235,
                easing: Easing.bezier(0.22, 1, 0.36, 1),
              },
            },
            sceneStyleInterpolator: ({ current }) => ({
              sceneStyle: {
                opacity: current.progress.interpolate({
                  inputRange: [-1, 0, 1],
                  outputRange: [0.92, 1, 0.92],
                }),
                transform: [
                  {
                    translateX: current.progress.interpolate({
                      inputRange: [-1, 0, 1],
                      outputRange: [-16, 0, 16],
                    }),
                  },
                ] as RNAnimated.WithAnimatedValue<never>,
              },
            }),
            tabBarStyle: [
              styles.tabBar,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                shadowColor: palette.text,
              },
            ],
            tabBarItemStyle: styles.tabBarItem,
            tabBarLabelStyle: styles.tabBarLabel,
            tabBarBackground: () => <SlidingTabIndicator />,
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Nuevo gasto',
              tabBarAccessibilityLabel: 'Crear un nuevo gasto',
              tabBarIcon: ({ color, focused }) => (
                <AnimatedTabIcon focused={focused}>
                  <ReceiptText color={color} size={24} strokeWidth={1.9} />
                </AnimatedTabIcon>
              ),
            }}
          />
          <Tabs.Screen
            name="groups"
            options={{
              title: 'Grupos',
              tabBarIcon: ({ color, focused }) => (
                <AnimatedTabIcon focused={focused}>
                  <UsersRound color={color} size={24} strokeWidth={1.9} />
                </AnimatedTabIcon>
              ),
            }}
          />
          <Tabs.Screen
            name="activity"
            options={{
              title: 'Actividad',
              tabBarIcon: ({ color, focused }) => (
                <AnimatedTabIcon focused={focused}>
                  <Activity color={color} size={24} strokeWidth={1.9} />
                </AnimatedTabIcon>
              ),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: 'Perfil',
              tabBarAccessibilityLabel: 'Abrir perfil',
              tabBarIcon: ({ color, focused }) => (
                <AnimatedTabIcon focused={focused}>
                  <UserRound color={color} size={24} strokeWidth={1.9} />
                </AnimatedTabIcon>
              ),
            }}
          />
        </Tabs>
      </View>
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  tabsRoot: {
    flex: 1,
  },
  tabBar: {
    position: 'absolute',
    bottom: 12,
    maxWidth: 480,
    ...(Platform.select({
      web: {
        left: '4%',
        right: '4%',
        width: 'auto',
        marginHorizontal: 'auto',
      },
      default: {
        width: '92%',
        alignSelf: 'center',
      },
    }) ?? {}),
    minHeight: 74,
    marginBottom: 0,
    paddingTop: 6,
    paddingBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    zIndex: 20,
  },
  tabBarItem: {
    minHeight: 56,
    paddingTop: 2,
  },
  tabBarLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});
