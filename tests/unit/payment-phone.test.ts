import { describe, expect, it } from 'vitest';
import {
  isValidPaymentPhoneE164,
  normalizePaymentPhoneE164,
  validatePaymentPhone,
} from '@/domain/payment-phone';

describe('payment phone consent', () => {
  it('normalizes common visual separators before storing an E.164 number', () => {
    expect(normalizePaymentPhoneE164(' +34 600-111-222 ')).toBe('+34600111222');
    expect(isValidPaymentPhoneE164('+34 600 111 222')).toBe(true);
  });

  it('rejects local or malformed phone numbers', () => {
    expect(isValidPaymentPhoneE164('600111222')).toBe(false);
    expect(isValidPaymentPhoneE164('+034600111222')).toBe(false);
    expect(validatePaymentPhone('600111222', false)).toMatch(/formato internacional/i);
  });

  it('requires a valid number before consent can be enabled', () => {
    expect(validatePaymentPhone('', false)).toBeUndefined();
    expect(validatePaymentPhone('', true)).toMatch(/añade un teléfono/i);
    expect(validatePaymentPhone('+34600111222', true)).toBeUndefined();
  });
});
