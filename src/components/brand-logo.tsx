import { Image } from 'expo-image';
import type { ImageStyle, StyleProp } from 'react-native';
import pagasteMark from '../../assets/images/pagaste-mark.png';
import pagasteWordmark from '../../assets/images/pagaste-wordmark.png';

type BrandLogoProps = {
  variant?: 'mark' | 'horizontal';
  width?: number;
  height?: number;
  accessibilityLabel?: string;
  decorative?: boolean;
  style?: StyleProp<ImageStyle>;
  testID?: string;
};

const aspectRatios = {
  mark: 419 / 512,
  horizontal: 1460 / 404,
} as const;

export function BrandLogo({
  variant = 'horizontal',
  width,
  height,
  accessibilityLabel = 'Pagaste',
  decorative = false,
  style,
  testID,
}: BrandLogoProps) {
  const aspectRatio = aspectRatios[variant];
  const resolvedWidth = width ?? (height ? height * aspectRatio : variant === 'mark' ? 52 : 190);
  const resolvedHeight = height ?? resolvedWidth / aspectRatio;

  return (
    <Image
      source={variant === 'mark' ? pagasteMark : pagasteWordmark}
      contentFit="contain"
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      testID={testID}
      style={[{ width: resolvedWidth, height: resolvedHeight }, style]}
    />
  );
}
