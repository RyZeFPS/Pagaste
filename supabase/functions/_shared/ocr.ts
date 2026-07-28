import { z } from 'zod';
import { ApiError } from './http.ts';
import { optionalEnv, requiredEnv } from './env.ts';

const cents = z.number().int().safe();
const optionalCents = cents.nullable();

export const receiptScanResultSchema = z
  .object({
    merchantName: z.string().max(120).nullable(),
    merchantAddress: z.string().max(300).nullable(),
    occurredAt: z.iso.datetime({ offset: true }).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    subtotalCents: optionalCents,
    taxCents: optionalCents,
    tipCents: optionalCents,
    discountCents: optionalCents,
    totalCents: cents.positive(),
    confidence: z.number().min(0).max(1),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(160),
          quantity: z.number().positive().max(10_000),
          unitPriceCents: optionalCents,
          lineTotalCents: cents.refine((value) => value !== 0),
          confidence: z.number().min(0).max(1),
        }),
      )
      .min(1)
      .max(300),
    warnings: z.array(z.string().max(200)).max(30),
  })
  .strict()
  .superRefine((result, context) => {
    const sum = result.items.reduce((total, item) => total + item.lineTotalCents, 0);
    if (!Number.isSafeInteger(sum))
      context.addIssue({ code: 'custom', message: 'Unsafe item total' });
  });

export type ReceiptScanResult = z.infer<typeof receiptScanResultSchema>;
export interface ReceiptOcrProvider {
  readonly name: string;
  scanReceipt(input: {
    imageUrl: string;
    locale: string;
    currencyHint?: string;
  }): Promise<ReceiptScanResult>;
}

class MockReceiptOcrProvider implements ReceiptOcrProvider {
  readonly name = 'mock';
  async scanReceipt(input: {
    imageUrl: string;
    locale: string;
    currencyHint?: string;
  }): Promise<ReceiptScanResult> {
    void input.imageUrl;
    void input.locale;
    await Promise.resolve();
    return receiptScanResultSchema.parse({
      merchantName: 'Pizzería Bella Napoli',
      merchantAddress: null,
      occurredAt: new Date().toISOString(),
      currency: input.currencyHint ?? 'EUR',
      subtotalCents: 4000,
      taxCents: null,
      tipCents: null,
      discountCents: null,
      totalCents: 4000,
      confidence: 0.95,
      items: [
        ['Pizza', 1200],
        ['Refrescos', 700],
        ['Patatas', 420],
        ['Ensalada', 680],
        ['Tiramisú', 550],
        ['Café', 450],
      ].map(([name, amount]) => ({
        name,
        quantity: 1,
        unitPriceCents: amount,
        lineTotalCents: amount,
        confidence: 0.94,
      })),
      warnings: ['review_before_split'],
    });
  }
}

class HttpReceiptOcrProvider implements ReceiptOcrProvider {
  readonly name = 'http';
  async scanReceipt(input: {
    imageUrl: string;
    locale: string;
    currencyHint?: string;
  }): Promise<ReceiptScanResult> {
    const response = await fetch(requiredEnv('OCR_API_URL'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${requiredEnv('OCR_API_KEY')}`,
      },
      body: JSON.stringify({
        imageUrl: input.imageUrl,
        locale: input.locale,
        currencyHint: input.currencyHint,
        responseFormat: 'json',
        schema: 'pagaste.receipt.v1',
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) {
      if (response.status === 422) {
        throw new ApiError(
          'OCR_NOT_READABLE',
          'No se ha podido distinguir el total o los productos. Prueba con más luz y el ticket completo.',
          422,
        );
      }
      throw new ApiError(
        'OCR_PROVIDER_ERROR',
        'El lector de tickets no respondió correctamente.',
        502,
      );
    }
    return receiptScanResultSchema.parse(await response.json());
  }
}

export function receiptOcrProvider(): ReceiptOcrProvider {
  const provider = optionalEnv('OCR_PROVIDER') ?? 'mock';
  if (provider === 'mock') return new MockReceiptOcrProvider();
  if (provider === 'http') return new HttpReceiptOcrProvider();
  throw new ApiError('OCR_PROVIDER_INVALID', 'Proveedor OCR no configurado.', 500);
}
