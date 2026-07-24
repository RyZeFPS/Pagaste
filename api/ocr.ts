import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { parseReceiptLines, ReceiptParseError } from '../server/ocr/receipt-parser';
import { recognizeReceiptImage } from '../server/ocr/tesseract-receipt';

const requestSchema = z
  .object({
    imageUrl: z.string().url().max(2_000),
    locale: z.string().trim().min(2).max(35).default('es-ES'),
    currencyHint: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
    responseFormat: z.literal('json').optional(),
    schema: z.literal('pagaste.receipt.v1').optional(),
  })
  .strict();

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

class InvalidReceiptUrlError extends Error {
  constructor() {
    super('INVALID_RECEIPT_URL');
    this.name = 'InvalidReceiptUrlError';
  }
}

function response(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function authorized(request: Request): boolean {
  const expected = process.env.OCR_INTERNAL_KEY?.trim();
  const authorization = request.headers.get('authorization');
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

function assertPrivateReceiptUrl(value: string): URL {
  const receiptUrl = new URL(value);
  const configuredSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!configuredSupabaseUrl) throw new Error('OCR_SUPABASE_URL_MISSING');
  const supabaseUrl = new URL(configuredSupabaseUrl);
  if (
    receiptUrl.protocol !== 'https:' ||
    receiptUrl.origin !== supabaseUrl.origin ||
    !receiptUrl.pathname.startsWith('/storage/v1/object/sign/receipts/') ||
    !receiptUrl.searchParams.has('token')
  ) {
    throw new InvalidReceiptUrlError();
  }
  return receiptUrl;
}

async function downloadReceipt(value: string): Promise<Buffer> {
  const url = assertPrivateReceiptUrl(value);
  const imageResponse = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    redirect: 'error',
    headers: { Accept: 'image/jpeg,image/png,image/webp' },
  });
  if (!imageResponse.ok) throw new Error('OCR_IMAGE_FETCH_FAILED');
  const contentType = imageResponse.headers.get('content-type')?.toLowerCase() ?? '';
  if (!/^image\/(?:jpeg|png|webp)(?:;|$)/u.test(contentType)) {
    throw new Error('OCR_IMAGE_TYPE_INVALID');
  }
  const declaredLength = Number(imageResponse.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error('OCR_IMAGE_TOO_LARGE');
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('OCR_IMAGE_TOO_LARGE');
  return bytes;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return response({ error: 'unauthorized' }, 401);
  try {
    const input = requestSchema.parse(await request.json());
    const image = await downloadReceipt(input.imageUrl);
    const recognition = await recognizeReceiptImage(image);
    const result = parseReceiptLines(recognition.lines, {
      currencyHint: input.currencyHint,
      pageConfidence: recognition.confidence,
    });
    return response(result, 200);
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: 'invalid_request' }, 400);
    if (error instanceof InvalidReceiptUrlError) {
      return response({ error: 'invalid_receipt_url' }, 400);
    }
    if (error instanceof ReceiptParseError) {
      return response({ error: error.code }, 422);
    }
    console.error('Receipt OCR failed', error instanceof Error ? error.message : 'unknown');
    return response({ error: 'ocr_failed' }, 500);
  }
}

export function GET(): Response {
  return response({ service: 'pagaste-ocr', status: 'ready' }, 200);
}
