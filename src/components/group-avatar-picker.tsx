import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Camera, Trash2 } from 'lucide-react-native';
import { AppText, Avatar } from '@/components/ui';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing, touchTarget } from '@/theme';

export function GroupAvatarPicker({
  name,
  uri,
  size = 76,
  busy = false,
  onPick,
  onRemove,
}: {
  name: string;
  uri?: string | null;
  size?: number;
  busy?: boolean;
  onPick: () => void;
  onRemove?: () => void;
}) {
  const palette = useAppColors();
  const changeLabel = uri ? 'Cambiar foto del grupo' : 'Añadir foto del grupo';

  return (
    <View style={styles.picker}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={changeLabel}
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onPick}
        style={({ pressed }) => [
          styles.avatarButton,
          { width: size, height: size, opacity: pressed || busy ? 0.72 : 1 },
        ]}
      >
        <Avatar name={name} uri={uri} size={size} />
        <View
          pointerEvents="none"
          style={[
            styles.cameraBadge,
            { backgroundColor: palette.primary, borderColor: palette.surface },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={palette.white} size="small" />
          ) : (
            <Camera color={palette.white} size={16} strokeWidth={2.2} />
          )}
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={changeLabel}
          disabled={busy}
          onPress={onPick}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <AppText variant="caption" color={palette.primary}>
            {uri ? 'Cambiar' : 'Añadir foto'}
          </AppText>
        </Pressable>
        {uri && onRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quitar foto del grupo"
            disabled={busy}
            onPress={onRemove}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Trash2 color={palette.dangerInk} size={14} strokeWidth={2} />
            <AppText variant="caption" color={palette.dangerInk}>
              Quitar
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  avatarButton: {
    position: 'relative',
    borderRadius: radii.pill,
  },
  cameraBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  action: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  pressed: {
    opacity: 0.62,
  },
});
