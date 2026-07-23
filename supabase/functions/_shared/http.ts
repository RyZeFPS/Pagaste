import type { ZodError } from 'zod';

export type ApiErrorBody = { code: string; message: string };
export type ApiEnvelope<T> = { data: T | null; error: ApiErrorBody | null };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function allowedOrigin(req: Request): string {
  const origin = req.headers.get('origin');
  if (!origin) return '*';
  const configured = Deno.env
    .get('ALLOWED_ORIGINS')
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!configured?.length || configured.includes('*')) return '*';
  return configured.includes(origin) ? origin : (configured[0] ?? 'null');
}

export function corsHeaders(req: Request): HeadersInit {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(req),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-internal-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

export function json<T>(req: Request, status: number, payload: ApiEnvelope<T>): Response {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders(req) });
}

export function ok<T>(req: Request, data: T, status = 200): Response {
  return json(req, status, { data, error: null });
}

function isZodError(error: unknown): error is ZodError {
  return error instanceof Error && error.name === 'ZodError' && 'issues' in error;
}

function databaseCode(message: string): string | undefined {
  const stableCodes = [
    'AUTH_REQUIRED',
    'EXPENSE_NOT_FOUND',
    'NOT_EXPENSE_OWNER',
    'EXPENSE_NOT_DRAFT',
    'INVALID_TOTAL',
    'PAYER_REQUIRED',
    'ITEM_TOTAL_MISMATCH',
    'ALLOCATIONS_MISMATCH',
    'DEBT_TOTAL_MISMATCH',
    'CLAIM_AMOUNTS_MISMATCH',
    'CLAIM_NOT_FOUND',
    'NOT_CLAIM_CREDITOR',
    'CLAIM_STATE_NOT_ALLOWED',
    'REMINDER_NOT_ALLOWED',
    'REMINDER_TOO_SOON',
    'RECEIVED_CLAIM_CANNOT_BE_REVOKED',
    'INVITE_NOT_FOUND',
    'INVITE_NOT_ACTIVE',
    'INVITE_EMAIL_MISMATCH',
    'NOT_GROUP_OWNER',
    'DISPUTE_NOT_FOUND',
    'INVALID_DISPUTE_RESOLUTION',
    'OCR_LIMIT_REACHED',
  ];
  return stableCodes.find((code) => message.includes(code));
}

export function fromDatabaseError(
  error: { message: string; code?: string } | null,
  fallback: string,
): ApiError {
  const message = error?.message ?? fallback;
  const code = databaseCode(message) ?? fallback;
  const status = code.includes('NOT_FOUND')
    ? 404
    : code.startsWith('NOT_') || code === 'AUTH_REQUIRED' || code === 'INVITE_EMAIL_MISMATCH'
      ? 403
      : code === 'OCR_LIMIT_REACHED'
        ? 429
        : code.includes('STATE') || code.includes('TOO_SOON') || code.includes('NOT_ACTIVE')
          ? 409
          : 400;
  return new ApiError(code, code, status);
}

export async function readJson(req: Request): Promise<unknown> {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 64_000) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 'La solicitud es demasiado grande.', 413);
  }
  try {
    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > 64_000) {
      throw new ApiError('PAYLOAD_TOO_LARGE', 'La solicitud es demasiado grande.', 413);
    }
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('INVALID_JSON', 'El cuerpo debe ser JSON válido.');
  }
}

export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== 'POST') {
      return json(req, 405, {
        data: null,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' },
      });
    }
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof ApiError) {
        return json(req, error.status, {
          data: null,
          error: { code: error.code, message: error.message },
        });
      }
      if (isZodError(error)) {
        return json(req, 422, {
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'Revisa los datos enviados.' },
        });
      }
      console.error(
        'Unhandled edge function error',
        error instanceof Error ? error.name : 'UnknownError',
      );
      return json(req, 500, {
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'No se pudo completar la operación.' },
      });
    }
  });
}
