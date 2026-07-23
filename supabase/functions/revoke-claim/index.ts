import { z } from 'zod';
import { fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { requireUser } from '../_shared/supabase.ts';

const inputSchema = z.object({ claimId: z.string().uuid() }).strict();

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client } = await requireUser(req);
  const { data, error } = await client.rpc('revoke_claim_transaction', {
    p_claim_id: input.claimId,
  });
  if (error) throw fromDatabaseError(error, 'REVOKE_CLAIM_FAILED');
  return ok(req, data as { claimId: string; status: 'cancelled'; cancelledAt: string });
});
