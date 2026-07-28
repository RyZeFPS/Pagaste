import { describe, expect, it } from 'vitest';
import { normalizeLocale, supportedLocales, toIntlLocale, translate } from '../../src/i18n/core';
import { en, es, translations } from '../../src/i18n/translations';
import { formatCentsExact } from '../../src/lib/money-format';

describe('supported languages', () => {
  it('only exposes Spanish and English', () => {
    expect(supportedLocales).toEqual(['es', 'en']);
    expect(Object.keys(translations)).toEqual(['es', 'en']);
    expect('ca' in translations).toBe(false);
  });

  it('normalizes regional and unsupported device languages safely', () => {
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('en_GB')).toBe('en');
    expect(normalizeLocale('es-MX')).toBe('es');
    expect(normalizeLocale('ca-ES')).toBe('es');
    expect(normalizeLocale(undefined)).toBe('es');
  });

  it('ships a strict English value for every Spanish translation key', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    expect(en['claim.paymentDisclaimer']).toBe(
      'Pagaste does not process, execute or verify payments.',
    );
    expect(en['terms.title']).toBe('Terms of use');
  });
});

describe('localized copy and formatting', () => {
  it('interpolates values in both languages', () => {
    expect(translate('es', 'home.greeting', { name: 'Alex' })).toBe('Hola, Alex');
    expect(translate('en', 'home.greeting', { name: 'Alex' })).toBe('Hi, Alex');
  });

  it('maps app locales to the correct Intl locale for dates and money', () => {
    expect(toIntlLocale('es')).toBe('es-ES');
    expect(toIntlLocale('en')).toBe('en-GB');
    expect(formatCentsExact(123_456, 'EUR', toIntlLocale('es'))).toContain('1.234,56');
    expect(formatCentsExact(123_456, 'EUR', toIntlLocale('en'))).toContain('1,234.56');

    const date = new Date('2026-07-24T12:00:00.000Z');
    const spanish = new Intl.DateTimeFormat(toIntlLocale('es'), {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
    const english = new Intl.DateTimeFormat(toIntlLocale('en'), {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);

    expect(spanish.toLocaleLowerCase()).toContain('julio');
    expect(english.toLocaleLowerCase()).toContain('july');
  });
});
