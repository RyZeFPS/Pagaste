import { describe, expect, it } from 'vitest';
import { formatCentsExact } from '../../src/lib/money-format';

const visibleSpaces = (value: string) => value.replace(/[\u00A0\u202F]/g, ' ');

describe('exact localized money formatting', () => {
  it('formats Spanish and British separators without converting cents to a float', () => {
    expect(visibleSpaces(formatCentsExact(123_456, 'EUR', 'es-ES'))).toBe('1.234,56 €');
    expect(visibleSpaces(formatCentsExact(123_456, 'EUR', 'en-GB'))).toBe('€1,234.56');
  });

  it('keeps negative and zero amounts with exactly two decimal places', () => {
    expect(visibleSpaces(formatCentsExact(-123_456, 'EUR', 'es-ES'))).toBe('-1.234,56 €');
    expect(visibleSpaces(formatCentsExact(-123_456, 'EUR', 'en-GB'))).toBe('-€1,234.56');
    expect(visibleSpaces(formatCentsExact(0, 'EUR', 'es-ES'))).toBe('0,00 €');
    expect(visibleSpaces(formatCentsExact(0, 'EUR', 'en-GB'))).toBe('€0.00');
  });

  it('renders Number.MAX_SAFE_INTEGER exactly and never uses exponential notation', () => {
    const spanish = visibleSpaces(formatCentsExact(Number.MAX_SAFE_INTEGER, 'EUR', 'es-ES'));
    const british = visibleSpaces(formatCentsExact(Number.MAX_SAFE_INTEGER, 'EUR', 'en-GB'));

    expect(spanish).toBe('90.071.992.547.409,91 €');
    expect(british).toBe('€90,071,992,547,409.91');
    expect(spanish).not.toMatch(/[eE][+-]?\d/);
    expect(british).not.toMatch(/[eE][+-]?\d/);
    expect(spanish).toMatch(/,\d{2} €/);
    expect(british).toMatch(/\.\d{2}$/);
  });
});
