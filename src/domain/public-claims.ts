import { z } from 'zod';
import type {
  ClaimStatus,
  PublicClaimCompletionDto,
  PublicClaimDto,
  PublicClaimResponseDto,
} from '../types';

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
const nonNegativeCentsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

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

const publicClaimPaymentPayerSchema = z
  .object({
    displayName: publicText(100),
    amountCents: nonNegativeCentsSchema,
    settledCents: nonNegativeCentsSchema,
    status: publicClaimStatusSchema,
    isCurrent: z.boolean(),
  })
  .strip();

const publicClaimPaymentProgressSchema = z
  .object({
    totalCents: nonNegativeCentsSchema,
    settledCents: nonNegativeCentsSchema,
    pendingCents: nonNegativeCentsSchema,
    completed: z.boolean(),
    payers: z.array(publicClaimPaymentPayerSchema).max(100),
  })
  .strip();

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
    originalAmountCents: centsSchema.positive(),
    offsetAmountCents: nonNegativeCentsSchema,
    status: publicClaimStatusSchema,
    recipientLocale: z.string().trim().min(2).max(35).optional(),
    linkExpiresAt: occurredAtSchema.nullable().optional(),
    items: z.array(publicClaimItemSchema).max(250),
    paymentProgress: publicClaimPaymentProgressSchema,
  })
  .strip();

export const publicClaimDtoSchema = publicClaimSourceSchema.extend({
  canDispute: z.boolean(),
});

export const publicClaimCompletionDtoSchema = z
  .object({
    terminal: z.literal(true),
    status: z.literal('received'),
    completed: z.literal(true),
    recipientLocale: z.string().trim().min(2).max(35).optional(),
  })
  .strip();

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

export function sanitizePublicClaimResponseDto(input: unknown): PublicClaimResponseDto {
  const completion = publicClaimCompletionDtoSchema.safeParse(input);
  if (completion.success) return completion.data satisfies PublicClaimCompletionDto;
  return sanitizePublicClaimDto(input);
}

export const toPublicClaimDto = sanitizePublicClaimDto;
