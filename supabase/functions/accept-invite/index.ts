import { z } from 'zod';
import { fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { requireUser } from '../_shared/supabase.ts';
import { hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client, admin } = await requireUser(req);
  await enforceRateLimit(admin, req, 'accept-invite', 20, 300);
  const { data, error } = await client.rpc('accept_group_invite_transaction', {
    p_token_hash: await hashPublicToken(input.token),
  });
  if (error) throw fromDatabaseError(error, 'INVITE_ACCEPT_FAILED');
  return ok(req, data as { groupId: string });
});
