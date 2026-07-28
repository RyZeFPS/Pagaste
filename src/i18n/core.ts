import { translations, type Locale, type TranslationKey } from './translations';

export type TranslationValues = Record<string, string | number>;

export const supportedLocales = ['es', 'en'] as const satisfies readonly Locale[];

const intlLocales: Record<Locale, string> = {
  es: 'es-ES',
  en: 'en-GB',
};

export function normalizeLocale(value: string | null | undefined): Locale {
  const language = value?.trim().toLowerCase().split(/[-_]/u)[0];
  return language === 'en' ? 'en' : 'es';
}

export function toIntlLocale(locale: Locale): string {
  return intlLocales[locale];
}

export function translate(locale: Locale, key: TranslationKey, values?: TranslationValues): string {
  const template = translations[locale][key];
  return Object.entries(values ?? {}).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template,
  );
}
