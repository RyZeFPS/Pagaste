import { z } from 'zod';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { adminClient } from '../_shared/supabase.ts';
import { hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const admin = adminClient();
  await enforceRateLimit(admin, req, 'get-public-claim', 60, 60);
  const tokenHash = await hashPublicToken(input.token);
  const { data, error } = await admin.rpc('get_public_claim_payload', { p_token_hash: tokenHash });
  if (error) throw fromDatabaseError(error, 'CLAIM_LOOKUP_FAILED');
  if (!data) throw new ApiError('CLAIM_NOT_FOUND', 'Este enlace no está disponible.', 404);
  return ok(req, data);
});
