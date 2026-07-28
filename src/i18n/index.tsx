import { getLocales } from 'expo-localization';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { Locale, TranslationKey } from './translations';
import { normalizeLocale, toIntlLocale, translate, type TranslationValues } from './core';
import { formatCentsExact } from '@/lib/money-format';

type I18nContextValue = {
  locale: Locale;
  intlLocale: string;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatMoney: (cents: number, currency?: string) => string;
  formatDate: (iso: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): Locale {
  return normalizeLocale(getLocales()[0]?.languageCode);
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const intlLocale = toIntlLocale(locale);
  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values),
    [locale],
  );
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      intlLocale,
      setLocale,
      t,
      formatMoney: (cents, currency = 'EUR') => formatCentsExact(cents, currency, intlLocale),
      formatDate: (iso) =>
        new Intl.DateTimeFormat(intlLocale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).format(new Date(iso)),
    }),
    [intlLocale, locale, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}

export { normalizeLocale, supportedLocales, toIntlLocale, translate } from './core';
export type { Locale, TranslationKey } from './translations';
