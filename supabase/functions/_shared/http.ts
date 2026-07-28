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
    'INVALID_CONTRIBUTIONS',
    'DUPLICATE_CONTRIBUTOR',
    'CONTRIBUTIONS_MISMATCH',
    'DEBT_TOTAL_MISMATCH',
    'CLAIM_AMOUNTS_MISMATCH',
    'NO_SETTLEMENTS_REQUIRED',
    'SETTLEMENTS_REQUIRED',
    'CLAIM_NOT_FOUND',
    'NOT_CLAIM_CREDITOR',
    'NOT_CLAIM_DEBTOR',
    'CLAIM_RECIPIENT_NOT_LINKED',
    'CLAIM_STATE_NOT_ALLOWED',
    'PAYMENT_CHECK_TOO_EARLY',
    'PAYMENT_CHECK_TOO_SOON',
    'REMINDER_NOT_ALLOWED',
    'REMINDER_TOO_SOON',
    'REMINDER_DISABLED',
    'REMINDER_STATUS',
    'REMINDER_LIMIT_REACHED',
    'REMINDER_NOT_DUE',
    'REMINDER_QUIET_HOURS',
    'REMINDER_BUNDLE_CHANGED',
    'BANK_REVIEW_REQUIRED',
    'INVALID_REMINDER_BATCH',
    'DUPLICATE_CLAIM_ID',
    'INVALID_LINK_EXPIRY',
    'CLAIM_LINK_NOT_ROTATABLE',
    'CLAIM_NOT_VISIBLE',
    'RECEIVED_CLAIM_CANNOT_BE_REVOKED',
    'INVITE_NOT_FOUND',
    'INVITE_NOT_ACTIVE',
    'INVITE_EMAIL_MISMATCH',
    'NOT_GROUP_OWNER',
    'INVALID_COLLABORATION_TOKEN',
    'INVALID_COLLABORATION_EXPIRY',
    'INVALID_COLLABORATION_NAME',
    'INVALID_COLLABORATION_SELECTION',
    'DUPLICATE_COLLABORATION_ITEM',
    'COLLABORATION_EXPENSE_NOT_EDITABLE',
    'COLLABORATION_NOT_FOUND',
    'COLLABORATION_NOT_EDITABLE',
    'COLLABORATION_EMPTY',
    'COLLABORATION_GUEST_LIMIT',
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
    INVALID_CONTRIBUTIONS: 'Revisa quién pagó y el método de cada aportación.',
    DUPLICATE_CONTRIBUTOR: 'Cada persona solo puede tener una aportación.',
    CONTRIBUTIONS_MISMATCH: 'Las aportaciones deben sumar exactamente el total del gasto.',
    DEBT_TOTAL_MISMATCH: 'La suma de las partes no coincide con el total del gasto.',
    CLAIM_AMOUNTS_MISMATCH: 'Las cantidades a solicitar no coinciden con el reparto.',
    NO_SETTLEMENTS_REQUIRED: 'Las aportaciones ya cuadran; no hay solicitudes que crear.',
    SETTLEMENTS_REQUIRED: 'Todavía hay cantidades pendientes que necesitan una solicitud.',
    NOT_CLAIM_DEBTOR: 'Solo quien debe este importe puede enviar el aviso.',
    CLAIM_RECIPIENT_NOT_LINKED:
      'La persona que debe revisar el ingreso no tiene una cuenta vinculada.',
    PAYMENT_CHECK_TOO_EARLY: 'Podrás enviar este aviso 10 minutos después de la solicitud.',
    PAYMENT_CHECK_TOO_SOON:
      'Ya has enviado un aviso recientemente. Podrás repetirlo dentro de 24 horas.',
    REMINDER_DISABLED: 'Los recordatorios están desactivados.',
    REMINDER_STATUS: 'Este cobro ya no admite recordatorios.',
    REMINDER_LIMIT_REACHED: 'Ya se han enviado todos los recordatorios configurados.',
    REMINDER_NOT_DUE: 'El siguiente recordatorio todavía no está disponible.',
    REMINDER_QUIET_HOURS: 'El destinatario está dentro de sus horas silenciosas.',
    REMINDER_NOT_ALLOWED: 'Este recordatorio no está disponible.',
    REMINDER_BUNDLE_CHANGED:
      'Los cobros agrupados han cambiado. Revísalos de nuevo antes de enviar.',
    BANK_REVIEW_REQUIRED: 'Comprueba primero que el ingreso no haya llegado.',
    INVALID_REMINDER_BATCH: 'El grupo de recordatorios no es válido.',
    DUPLICATE_CLAIM_ID: 'Un cobro aparece duplicado en el recordatorio.',
    INVALID_LINK_EXPIRY: 'Elige una caducidad de entre 1 y 90 días.',
    CLAIM_LINK_NOT_ROTATABLE: 'Este cobro ya no admite un enlace nuevo.',
    CLAIM_NOT_VISIBLE: 'No tienes acceso a este cobro.',
    INVALID_COLLABORATION_TOKEN: 'El enlace colaborativo no es válido.',
    INVALID_COLLABORATION_EXPIRY: 'Elige una duración de entre 1 hora y 7 días.',
    INVALID_COLLABORATION_NAME: 'Escribe un nombre válido.',
    INVALID_COLLABORATION_SELECTION: 'Selecciona al menos un producto válido.',
    DUPLICATE_COLLABORATION_ITEM: 'Un producto aparece repetido en la selección.',
    COLLABORATION_EXPENSE_NOT_EDITABLE: 'Este gasto ya no se puede repartir por QR.',
    COLLABORATION_NOT_FOUND: 'Esta sesión colaborativa ya no está disponible.',
    COLLABORATION_NOT_EDITABLE: 'Esta sesión colaborativa ya no se puede modificar.',
    COLLABORATION_EMPTY: 'Aún no hay selecciones para aplicar.',
    COLLABORATION_GUEST_LIMIT: 'Esta sesión ya ha alcanzado el límite de participantes.',
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
      : code === 'OCR_LIMIT_REACHED' || code === 'COLLABORATION_GUEST_LIMIT'
        ? 429
        : code.includes('STATE') ||
            code.includes('TOO_') ||
            code.includes('NOT_ACTIVE') ||
            code.startsWith('REMINDER_') ||
            code === 'BANK_REVIEW_REQUIRED' ||
            code === 'CLAIM_LINK_NOT_ROTATABLE' ||
            code === 'SETTLEMENTS_REQUIRED' ||
            code === 'COLLABORATION_EXPENSE_NOT_EDITABLE' ||
            code === 'COLLABORATION_NOT_EDITABLE'
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
