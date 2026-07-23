import { z } from 'zod';
import type { ClaimStatus, PublicClaimDto } from '../types';

function normalizePublicText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function publicText(maxLength: number) {
  return z.string().transform(normalizePublicText).pipe(z.string().min(1).max(maxLength));
}

function nullablePublicText(maxLength: number) {
  return z
    .string()
    .transform(normalizePublicText)
    .pipe(z.string().min(1).max(maxLength))
    .nullable();
}

const centsSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

const avatarUrlSchema = z
  .string()
  .trim()
  .max(2_048)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  }, 'Avatar URL must use HTTP or HTTPS')
  .nullable();

const occurredAtSchema = z
  .string()
  .trim()
  .refine((value) => Number.isFinite(Date.parse(value)), 'Invalid occurrence timestamp')
  .transform((value) => new Date(value).toISOString());

const optionalPaymentPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Payment phone must use E.164 format')
  .nullable();

export const publicClaimItemSchema = z
  .object({
    name: publicText(200),
    // Signed values are intentional: discounts and other negative adjustments
    // must remain visible so the public breakdown reconciles to the net claim.
    originalLineTotalCents: centsSchema,
    assignedAmountCents: centsSchema,
    allocationLabel: publicText(100),
  })
  .strip();

const publicClaimStatusSchema = z.enum([
  'pending',
  'received',
  'reminder_sent',
  'disputed',
  'cancelled',
]);

const publicClaimSourceSchema = z
  .object({
    creditorDisplayName: publicText(100),
    creditorAvatarUrl: avatarUrlSchema,
    creditorPhoneE164: optionalPaymentPhoneSchema,
    expenseTitle: publicText(200),
    merchantName: nullablePublicText(200),
    occurredAt: occurredAtSchema,
    currency: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{3}$/)),
    amountCents: centsSchema.positive(),
    status: publicClaimStatusSchema,
    items: z.array(publicClaimItemSchema).max(250),
  })
  .strip();

export const publicClaimDtoSchema = publicClaimSourceSchema.extend({
  canDispute: z.boolean(),
});

export function claimPublicActions(status: ClaimStatus): {
  canDispute: boolean;
} {
  return {
    canDispute: status === 'pending' || status === 'reminder_sent',
  };
}

/**
 * Constructs a strict allow-listed public projection. Unknown input fields,
 * including database IDs and token hashes, are discarded. The only contact
 * detail accepted here is the creditor phone already filtered by server-side
 * consent.
 */
export function sanitizePublicClaimDto(input: unknown): PublicClaimDto {
  const parsed = publicClaimSourceSchema.parse(input);
  return publicClaimDtoSchema.parse({
    ...parsed,
    ...claimPublicActions(parsed.status),
  });
}

export const toPublicClaimDto = sanitizePublicClaimDto;
