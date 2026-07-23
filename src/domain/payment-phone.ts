const E164_PATTERN = /^\+[1-9]\d{7,14}$/u;

export function normalizePaymentPhoneE164(value: string): string {
  return value.trim().replace(/[\s().-]/gu, '');
}

export function isValidPaymentPhoneE164(value: string): boolean {
  return E164_PATTERN.test(normalizePaymentPhoneE164(value));
}

export function validatePaymentPhone(
  value: string,
  sharePaymentPhone: boolean,
): string | undefined {
  const normalized = normalizePaymentPhoneE164(value);
  if (!normalized) {
    return sharePaymentPhone ? 'Añade un teléfono antes de autorizar que se muestre.' : undefined;
  }
  if (!E164_PATTERN.test(normalized)) {
    return 'Usa formato internacional, por ejemplo +34600111222.';
  }
  return undefined;
}
