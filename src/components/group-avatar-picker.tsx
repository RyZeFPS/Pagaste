import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Camera, Trash2 } from 'lucide-react-native';
import { AppButton, AppText, Avatar, BottomSheet } from '@/components/ui';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

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
  const [menuVisible, setMenuVisible] = useState(false);
  const changeLabel = uri ? 'Editar foto del grupo' : 'Añadir foto del grupo';

  const pickPhoto = () => {
    setMenuVisible(false);
    onPick();
  };

  const removePhoto = () => {
    setMenuVisible(false);
    onRemove?.();
  };

  return (
    <>
      <View style={styles.picker}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={changeLabel}
          accessibilityHint="Abre las opciones de la foto del grupo"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={() => setMenuVisible(true)}
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
      </View>

      <BottomSheet
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        title="Foto del grupo"
      >
        <View style={styles.sheetActions}>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            Elige una foto que ayude a reconocer el grupo.
          </AppText>
          <AppButton
            title={uri ? 'Cambiar foto' : 'Añadir foto'}
            fullWidth
            leftIcon={<Camera color={palette.white} size={19} strokeWidth={2} />}
            onPress={pickPhoto}
          />
          {uri && onRemove ? (
            <AppButton
              title="Quitar foto"
              variant="danger"
              fullWidth
              leftIcon={<Trash2 color={palette.white} size={18} strokeWidth={2} />}
              onPress={removePhoto}
            />
          ) : null}
        </View>
      </BottomSheet>
    </>
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
  sheetActions: {
    gap: spacing.lg,
  },
});
