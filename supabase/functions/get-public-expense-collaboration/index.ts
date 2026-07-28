import { z } from 'zod';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { adminClient } from '../_shared/supabase.ts';
import { hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const admin = adminClient();
  await enforceRateLimit(admin, req, 'get-expense-collaboration', 60, 60);
  const { data, error } = await admin.rpc('get_public_expense_collaboration_payload', {
    p_token_hash: await hashPublicToken(input.token),
  });
  if (error) throw fromDatabaseError(error, 'COLLABORATION_LOOKUP_FAILED');
  if (!data) {
    throw new ApiError('COLLABORATION_NOT_FOUND', 'Esta sesión ya no está disponible.', 404);
  }
  return ok(req, data);
});
