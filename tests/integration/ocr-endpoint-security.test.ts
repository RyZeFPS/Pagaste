import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET, POST } from '../../api/ocr';

const originalSecret = process.env.OCR_INTERNAL_KEY;
const originalSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

beforeAll(() => {
  process.env.OCR_INTERNAL_KEY = 'test-internal-secret-with-enough-entropy';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.OCR_INTERNAL_KEY;
  else process.env.OCR_INTERNAL_KEY = originalSecret;
  if (originalSupabaseUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
});

describe('private OCR endpoint', () => {
  it('exposes only a non-sensitive readiness response', async () => {
    const result = GET();
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({
      service: 'pagaste-ocr',
      status: 'ready',
    });
  });

  it('rejects requests without the internal bearer secret', async () => {
    const result = await POST(
      new Request('https://pagaste.example/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl:
            'https://project.supabase.co/storage/v1/object/sign/receipts/user/ticket.jpg?token=x',
        }),
      }),
    );
    expect(result.status).toBe(401);
  });

  it('blocks signed-image URLs outside the configured private receipt bucket', async () => {
    const result = await POST(
      new Request('https://pagaste.example/api/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OCR_INTERNAL_KEY}`,
        },
        body: JSON.stringify({
          imageUrl: 'https://attacker.example/internal-resource?token=x',
          locale: 'es-ES',
          currencyHint: 'EUR',
          responseFormat: 'json',
          schema: 'pagaste.receipt.v1',
        }),
      }),
    );
    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({ error: 'invalid_receipt_url' });
  });
});
