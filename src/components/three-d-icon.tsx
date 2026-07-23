import { Image, type ImageProps } from 'expo-image';

const threeDAssets = {
  receiptScan: require('../../assets/images/3d/receipt-scan-v3.webp'),
  manualExpense: require('../../assets/images/3d/manual-expense-v2.webp'),
  groupStreak: require('../../assets/images/3d/group-streak.webp'),
  reputationShield: require('../../assets/images/3d/reputation-shield.webp'),
  groupPeople: require('../../assets/images/3d/group-people.webp'),
  coinsRecovered: require('../../assets/images/3d/coins-recovered.webp'),
  walletReceivable: require('../../assets/images/3d/wallet-receivable.webp'),
  pendingClock: require('../../assets/images/3d/pending-clock.webp'),
  paidCheck: require('../../assets/images/3d/paid-check.webp'),
  foodPizza: require('../../assets/images/3d/food-pizza.png'),
  foodSoda: require('../../assets/images/3d/food-soda.png'),
  foodFries: require('../../assets/images/3d/food-fries.png'),
  foodSalad: require('../../assets/images/3d/food-salad.png'),
  foodCake: require('../../assets/images/3d/food-cake.png'),
  foodCoffee: require('../../assets/images/3d/food-coffee.png'),
  foodBurger: require('../../assets/images/3d/food-burger.png'),
  foodGeneric: require('../../assets/images/3d/food-generic.png'),
} as const;

export type ThreeDAsset = keyof typeof threeDAssets;

export function ThreeDIcon({
  name,
  size = 40,
  style,
  accessibilityLabel,
  testID,
}: {
  name: ThreeDAsset;
  size?: number;
  style?: ImageProps['style'];
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <Image
      testID={testID}
      source={threeDAssets[name]}
      contentFit="contain"
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityIgnoresInvertColors
      style={[{ width: size, height: size }, style]}
    />
  );
}
