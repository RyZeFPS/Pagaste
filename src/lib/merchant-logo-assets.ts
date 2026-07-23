import type { ImageProps } from 'expo-image';
import mercadonaLogo from '../../assets/merchants/mercadona.png';
import alcampoLogo from '../../assets/merchants/alcampo.png';
import diaLogo from '../../assets/merchants/dia.svg';
import lidlLogo from '../../assets/merchants/lidl.svg';
import froizLogo from '../../assets/merchants/froiz.png';
import repsolLogo from '../../assets/merchants/repsol.png';

export type MerchantLogoAsset = Readonly<{
  source: ImageProps['source'];
  inset?: number;
  cropLeft?: boolean;
}>;

export const MERCHANT_LOGO_ASSETS: Readonly<Record<string, MerchantLogoAsset>> = Object.freeze({
  mercadona: { source: mercadonaLogo, inset: 2 },
  alcampo: { source: alcampoLogo, inset: 2 },
  dia: { source: diaLogo, inset: 3 },
  lidl: { source: lidlLogo, inset: 1 },
  froiz: { source: froizLogo, inset: 3 },
  repsol: { source: repsolLogo, cropLeft: true },
});
