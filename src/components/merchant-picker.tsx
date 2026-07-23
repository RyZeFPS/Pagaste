import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react-native';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { AppInput, AppText } from '@/components/ui';
import { MerchantLogo } from '@/components/merchant-logo';
import { MERCHANT_BRANDS, searchMerchantBrands, type MerchantBrand } from '@/lib/merchant-brand';
import { useAppColors } from '@/providers/app-providers';
import { radii, shadows, spacing } from '@/theme';

export type MerchantPickerProps = {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  placeholder?: string;
  testID?: string;
};

export function MerchantPicker({
  value,
  onChangeText,
  label = 'Comercio (opcional)',
  placeholder = 'Pizzería Bella Napoli',
  testID = 'expense-merchant',
}: MerchantPickerProps) {
  const palette = useAppColors();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focused, setFocused] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState<string>();
  const suggestions = useMemo(() => searchMerchantBrands(value), [value]);
  const selectedBrand = useMemo(
    () => MERCHANT_BRANDS.find(({ id }) => id === selectedBrandId),
    [selectedBrandId],
  );
  const showSuggestions = focused && !selectedBrand && suggestions.length > 0;

  const cancelBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
  };

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  const selectBrand = (brand: MerchantBrand) => {
    cancelBlur();
    setSelectedBrandId(brand.id);
    setFocused(false);
    onChangeText(brand.displayName);
    Keyboard.dismiss();
  };

  return (
    <View>
      <AppInput
        testID={testID}
        label={label}
        placeholder={placeholder}
        value={value}
        autoCorrect={false}
        autoCapitalize="words"
        onChangeText={(nextValue) => {
          setSelectedBrandId(undefined);
          onChangeText(nextValue);
        }}
        onFocus={() => {
          cancelBlur();
          setFocused(true);
        }}
        onBlur={() => {
          cancelBlur();
          blurTimer.current = setTimeout(() => setFocused(false), 140);
        }}
      />

      {showSuggestions ? (
        <View
          accessibilityLabel="Sugerencias de comercios"
          style={[
            styles.suggestions,
            shadows.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <AppText variant="caption" color={palette.textSecondary} style={styles.heading}>
            Comercios conocidos
          </AppText>
          {suggestions.map((brand, index) => (
            <Pressable
              key={brand.id}
              testID={`merchant-suggestion-${brand.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Seleccionar ${brand.displayName}, ${brand.category}`}
              onPressIn={cancelBlur}
              onPress={() => selectBrand(brand)}
              style={({ pressed }) => [
                styles.suggestion,
                index > 0 && { borderTopColor: palette.divider, borderTopWidth: 1 },
                pressed && { backgroundColor: palette.primaryLight },
              ]}
            >
              <MerchantLogo merchantName={brand.displayName} size={38} />
              <View style={styles.textColumn}>
                <AppText variant="label">{brand.displayName}</AppText>
                <AppText variant="caption" color={palette.textSecondary}>
                  {brand.category}
                </AppText>
              </View>
              <ChevronRight color={palette.textMuted} size={18} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {selectedBrand ? (
        <View
          testID="merchant-selected-brand"
          style={[styles.selected, { backgroundColor: palette.primaryLight }]}
        >
          <MerchantLogo merchantName={selectedBrand.displayName} size={30} />
          <View style={styles.textColumn}>
            <AppText variant="caption" color={palette.primaryDark}>
              {selectedBrand.displayName} · {selectedBrand.category}
            </AppText>
          </View>
          <Check color={palette.primary} size={17} strokeWidth={2.5} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  suggestions: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  heading: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  suggestion: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  textColumn: { flex: 1 },
  selected: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
});
