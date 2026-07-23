import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { merchantVisual, resolveMerchantBrand } from '@/lib/merchant-brand';
import { MERCHANT_VECTOR_PATHS } from '@/lib/merchant-icon-data';
import { MERCHANT_LOGO_ASSETS } from '@/lib/merchant-logo-assets';

export type MerchantLogoProps = {
  merchantName?: string | null;
  fallbackLabel?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  decorative?: boolean;
};

export function MerchantLogo({
  merchantName,
  fallbackLabel = 'Comercio',
  size = 44,
  style,
  decorative = true,
}: MerchantLogoProps) {
  const brand = resolveMerchantBrand(merchantName);
  const visual = merchantVisual(merchantName, fallbackLabel);
  const asset = brand ? MERCHANT_LOGO_ASSETS[brand.id] : undefined;
  const vectorPath = brand ? MERCHANT_VECTOR_PATHS[brand.id] : undefined;
  const mark = visual.monogram;
  const markLength = Array.from(mark).length;
  const fallbackFontSize = Math.max(
    8,
    Math.round(
      size * (markLength >= 4 ? 0.25 : markLength === 3 ? 0.29 : markLength === 2 ? 0.34 : 0.44),
    ),
  );
  const accentSize = Math.max(4, Math.round(size * 0.16));

  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : `Comercio ${visual.displayName}`}
      testID={brand ? `merchant-logo-${brand.id}` : 'merchant-logo-fallback'}
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: Math.max(7, Math.round(size * 0.29)),
          backgroundColor: visual.backgroundColor,
        },
        style,
      ]}
    >
      {asset ? (
        asset.cropLeft ? (
          <Image
            pointerEvents="none"
            source={asset.source}
            contentFit="fill"
            style={[
              styles.croppedLogo,
              {
                width: size * 3.13,
                height: size * 0.74,
                top: size * 0.13,
              },
            ]}
          />
        ) : (
          <Image
            pointerEvents="none"
            source={asset.source}
            contentFit="contain"
            style={{
              width: size - (asset.inset ?? 0) * 2,
              height: size - (asset.inset ?? 0) * 2,
            }}
          />
        )
      ) : vectorPath ? (
        <Svg
          pointerEvents="none"
          width={Math.round(size * 0.68)}
          height={Math.round(size * 0.68)}
          viewBox="0 0 24 24"
        >
          <Path d={vectorPath} fill={visual.foregroundColor} />
        </Svg>
      ) : (
        <Text
          allowFontScaling
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.25}
          minimumFontScale={0.55}
          numberOfLines={1}
          style={[
            styles.mark,
            styles.fallbackMark,
            {
              color: visual.foregroundColor,
              fontSize: fallbackFontSize,
              lineHeight: Math.max(8, Math.round(fallbackFontSize * 1.2)),
            },
          ]}
        >
          {mark}
        </Text>
      )}
      {!brand && visual.accentColor ? (
        <View
          pointerEvents="none"
          style={[
            styles.accent,
            {
              width: accentSize,
              height: accentSize,
              borderRadius: accentSize / 2,
              backgroundColor: visual.accentColor,
              right: Math.max(3, Math.round(size * 0.1)),
              bottom: Math.max(3, Math.round(size * 0.1)),
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17, 24, 39, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mark: {
    maxWidth: '86%',
    textAlign: 'center',
  },
  fallbackMark: {
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  accent: {
    position: 'absolute',
  },
  croppedLogo: {
    position: 'absolute',
    left: 0,
  },
});
