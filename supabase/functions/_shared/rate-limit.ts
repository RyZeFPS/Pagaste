import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, fromDatabaseError } from './http.ts';
import { hashOpaqueValue } from './tokens.ts';

function clientAddress(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export async function enforceRateLimit(
  admin: SupabaseClient,
  req: Request,
  endpoint:
    | 'get-public-claim'
    | 'dispute-claim'
    | 'accept-invite'
    | 'get-expense-collaboration'
    | 'submit-expense-collaboration',
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const keyHash = await hashOpaqueValue(`${endpoint}:${clientAddress(req)}`);
  const { data, error } = await admin.rpc('consume_endpoint_rate_limit', {
    p_endpoint: endpoint,
    p_key_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw fromDatabaseError(error, 'RATE_LIMIT_FAILED');
  if (data !== true)
    throw new ApiError('RATE_LIMITED', 'Demasiados intentos. Prueba de nuevo más tarde.', 429);
}
