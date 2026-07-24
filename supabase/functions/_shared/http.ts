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

function normalizeConfiguredOrigin(entry: string): string | undefined {
  const value = entry.trim().replace(/^ALLOWED_ORIGINS\s*=\s*/u, '');
  if (value === '*') return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function allowedOrigin(req: Request): string | undefined {
  const origin = req.headers.get('origin');
  if (!origin) return '*';
  const raw = Deno.env.get('ALLOWED_ORIGINS')?.trim();
  if (!raw) return '*';
  const configured = raw
    .split(',')
    .map(normalizeConfiguredOrigin)
    .filter((entry): entry is string => Boolean(entry));
  if (configured.includes('*')) return '*';
  return configured.includes(origin) ? origin : undefined;
}

export function corsHeaders(req: Request): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-internal-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  const origin = allowedOrigin(req);
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
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
    'ALLOCATION_METHOD_MISMATCH',
    'ALLOCATION_PARTICIPANT_MISMATCH',
    'DEBT_TOTAL_MISMATCH',
    'CLAIM_AMOUNTS_MISMATCH',
    'CLAIM_NOT_FOUND',
    'NOT_CLAIM_CREDITOR',
    'NOT_CLAIM_DEBTOR',
    'CLAIM_RECIPIENT_NOT_LINKED',
    'CLAIM_STATE_NOT_ALLOWED',
    'PAYMENT_CHECK_TOO_EARLY',
    'PAYMENT_CHECK_TOO_SOON',
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

function databaseMessage(code: string): string {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: 'Inicia sesión para continuar.',
    EXPENSE_NOT_FOUND: 'Este gasto ya no está disponible.',
    NOT_EXPENSE_OWNER: 'Solo quien creó el gasto puede enviar las solicitudes.',
    EXPENSE_NOT_DRAFT: 'Este gasto ya no está en borrador.',
    INVALID_TOTAL: 'El total del gasto no es válido.',
    PAYER_REQUIRED: 'Falta indicar quién pagó el gasto.',
    ITEM_TOTAL_MISMATCH: 'Los productos no coinciden con el total del gasto.',
    ALLOCATIONS_MISMATCH: 'El reparto de uno o más productos no coincide con su importe.',
    ALLOCATION_METHOD_MISMATCH: 'Uno de los productos tiene un método de reparto incoherente.',
    ALLOCATION_PARTICIPANT_MISMATCH: 'El reparto contiene una persona que no pertenece al gasto.',
    DEBT_TOTAL_MISMATCH: 'La suma de las partes no coincide con el total del gasto.',
    CLAIM_AMOUNTS_MISMATCH: 'Las cantidades a solicitar no coinciden con el reparto.',
    NOT_CLAIM_DEBTOR: 'Solo quien debe este importe puede enviar el aviso.',
    CLAIM_RECIPIENT_NOT_LINKED:
      'La persona que debe revisar el ingreso no tiene una cuenta vinculada.',
    PAYMENT_CHECK_TOO_EARLY: 'Podrás enviar este aviso 10 minutos después de la solicitud.',
    PAYMENT_CHECK_TOO_SOON:
      'Ya has enviado un aviso recientemente. Podrás repetirlo dentro de 24 horas.',
  };
  return messages[code] ?? code;
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
        : code.includes('STATE') || code.includes('TOO_') || code.includes('NOT_ACTIVE')
          ? 409
          : 400;
  return new ApiError(code, databaseMessage(code), status);
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
