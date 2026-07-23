import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { ApiError } from './http.ts';
import { publicApiKey, requiredEnv, secretApiKey } from './env.ts';

export function adminClient(): SupabaseClient {
  return createClient(requiredEnv('SUPABASE_URL'), secretApiKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearer(req: Request): string {
  const value = req.headers.get('authorization');
  if (!value?.startsWith('Bearer '))
    throw new ApiError('AUTH_REQUIRED', 'Inicia sesión para continuar.', 401);
  const token = value.slice(7).trim();
  if (!token) throw new ApiError('AUTH_REQUIRED', 'Inicia sesión para continuar.', 401);
  return token;
}

export type UserContext = {
  user: User;
  client: SupabaseClient;
  admin: SupabaseClient;
  accessToken: string;
};

export async function optionalUser(req: Request): Promise<User | null> {
  const value = req.headers.get('authorization');
  if (!value?.startsWith('Bearer ')) return null;
  const accessToken = value.slice(7).trim();
  if (!accessToken) return null;
  const { data, error } = await adminClient().auth.getUser(accessToken);
  return error ? null : (data.user ?? null);
}

export async function requireUser(req: Request): Promise<UserContext> {
  const accessToken = bearer(req);
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(accessToken);
  if (error || !data.user) throw new ApiError('INVALID_SESSION', 'La sesión no es válida.', 401);
  const client = createClient(requiredEnv('SUPABASE_URL'), publicApiKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user: data.user, client, admin, accessToken };
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const a = await crypto.subtle.digest('SHA-256', encoder.encode(left));
  const b = await crypto.subtle.digest('SHA-256', encoder.encode(right));
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < aa.length; index += 1) diff |= (aa[index] ?? 0) ^ (bb[index] ?? 0);
  return diff === 0;
}

export async function requireInternalService(req: Request): Promise<SupabaseClient> {
  const expected = secretApiKey();
  const supplied =
    req.headers.get('x-internal-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';
  if (!supplied || !(await safeEqual(supplied, expected))) {
    throw new ApiError('AUTH_REQUIRED', 'Credenciales internas no válidas.', 401);
  }
  return adminClient();
}
