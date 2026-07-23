import { getLocales } from 'expo-localization';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { translations, type Locale, type TranslationKey } from './translations';
import { formatCentsExact } from '@/lib/money-format';

type Values = Record<string, string | number>;
type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Values) => string;
  formatMoney: (cents: number, currency?: string) => string;
  formatDate: (iso: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): Locale {
  const code = getLocales()[0]?.languageCode;
  return code === 'ca' || code === 'en' ? code : 'es';
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const intlLocale = locale === 'ca' ? 'ca-ES' : locale === 'en' ? 'en-GB' : 'es-ES';
  const t = useCallback(
    (key: TranslationKey, values?: Values) => {
      const template = translations[locale][key] ?? translations.es[key];
      return Object.entries(values ?? {}).reduce(
        (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
        template,
      );
    },
    [locale],
  );
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
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
