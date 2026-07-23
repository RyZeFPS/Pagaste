import { assertSafeCents } from '@/domain/money';

const numericPartTypes = new Set(['integer', 'group', 'decimal', 'fraction']);

/** Formats integer minor units without converting the monetary value to floating point. */
export function formatCentsExact(cents: number, currency = 'EUR', locale = 'es-ES'): string {
  assertSafeCents(cents, 'cents');
  const absolute = BigInt(cents < 0 ? -cents : cents);
  const integer = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  const integerText = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(integer);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const parts = formatter.formatToParts(cents < 0 ? -1.01 : 1.01);
  const firstNumeric = parts.findIndex((part) => numericPartTypes.has(part.type));
  let lastNumeric = firstNumeric;
  for (let index = firstNumeric; index < parts.length; index += 1)
    if (numericPartTypes.has(parts[index].type)) lastNumeric = index;
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? ',';
  const prefix = parts
    .slice(0, firstNumeric)
    .map((part) => part.value)
    .join('');
  const suffix = parts
    .slice(lastNumeric + 1)
    .map((part) => part.value)
    .join('');
  return `${prefix}${integerText}${decimal}${fraction}${suffix}`;
}
