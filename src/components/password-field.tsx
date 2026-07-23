import { forwardRef, useId, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { AppText } from '@/components/ui';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing, touchTarget } from '@/theme';

type PasswordFieldProps = Omit<TextInputProps, 'secureTextEntry'> & {
  label: string;
  error?: string;
  hint?: string;
};

export const PasswordField = forwardRef<TextInput, PasswordFieldProps>(function PasswordField(
  { label, error, hint, style, onFocus, onBlur, testID, ...props },
  ref,
) {
  const palette = useAppColors();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const generatedId = useId().replace(/:/gu, '');
  const fieldId = testID ?? `password-${generatedId}`;
  const labelId = `${fieldId}-label`;
  const descriptionId = `${fieldId}-${error ? 'error' : 'hint'}`;

  return (
    <View style={styles.field}>
      <AppText nativeID={labelId} variant="label">
        {label}
      </AppText>
      <View
        style={[
          styles.inputFrame,
          {
            backgroundColor: palette.surface,
            borderColor: error ? palette.danger : focused ? palette.primary : palette.border,
          },
          focused && styles.focused,
        ]}
      >
        <TextInput
          ref={ref}
          testID={testID}
          accessibilityLabel={props.accessibilityLabel ?? label}
          accessibilityHint={error ?? hint}
          aria-labelledby={labelId}
          aria-describedby={error || hint ? descriptionId : undefined}
          aria-invalid={Boolean(error)}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          maxLength={128}
          placeholderTextColor={palette.textMuted}
          {...props}
          secureTextEntry={!visible}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, { color: palette.textPrimary }, style]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          accessibilityState={{ expanded: visible }}
          hitSlop={6}
          onPress={() => setVisible((current) => !current)}
          style={({ pressed }) => [
            styles.toggle,
            pressed && { backgroundColor: palette.primaryLight },
          ]}
        >
          {visible ? (
            <EyeOff color={palette.textSecondary} size={21} />
          ) : (
            <Eye color={palette.textSecondary} size={21} />
          )}
        </Pressable>
      </View>
      {error ? (
        <AppText
          nativeID={descriptionId}
          accessibilityLiveRegion="polite"
          variant="caption"
          color={palette.dangerInk}
        >
          {error}
        </AppText>
      ) : hint ? (
        <AppText nativeID={descriptionId} variant="caption" color={palette.textSecondary}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { gap: 6 },
  inputFrame: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radii.control,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  focused: { borderWidth: 1.5 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    paddingLeft: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  toggle: {
    width: touchTarget,
    minHeight: touchTarget,
    marginRight: 4,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
