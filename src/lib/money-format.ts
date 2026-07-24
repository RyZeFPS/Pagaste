import { assertSafeCents } from '@/domain/money';

/** Formats integer minor units without converting the monetary value to floating point. */
export function formatCentsExact(cents: number, currency = 'EUR', locale = 'es-ES'): string {
  assertSafeCents(cents, 'cents');
  const absolute = cents < 0 ? -cents : cents;
  const integer = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  const integerText = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(integer);
  const numberFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const numericSample = numberFormatter.format(1.01);
  const currencySample = currencyFormatter.format(1.01);
  const numericIndex = currencySample.indexOf(numericSample);
  const decimal =
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
    })
      .format(1.1)
      .match(/[.,]/)?.[0] ?? '.';
  const exactNumber = `${integerText}${decimal}${fraction}`;

  if (numericIndex < 0) {
    return `${cents < 0 ? '-' : ''}${exactNumber} ${currency}`;
  }

  const prefix = currencySample.slice(0, numericIndex);
  const suffix = currencySample.slice(numericIndex + numericSample.length);
  return `${cents < 0 ? '-' : ''}${prefix}${exactNumber}${suffix}`;
}
