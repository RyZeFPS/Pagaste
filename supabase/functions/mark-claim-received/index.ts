import { z } from 'zod';
import { fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { requireUser } from '../_shared/supabase.ts';

const inputSchema = z.object({ claimId: z.string().uuid() }).strict();

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { user, admin } = await requireUser(req);
  const { data, error } = await admin.rpc('mark_claim_received', {
    p_claim_id: input.claimId,
    p_actor_user_id: user.id,
  });
  if (error) throw fromDatabaseError(error, 'MARK_CLAIM_RECEIVED_FAILED');
  const result = data as {
    claimId: string;
    status: 'received';
    receivedAt: string;
  };
  return ok(req, result);
});
