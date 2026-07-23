import { z } from 'zod';
import { fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { sendPushToUser } from '../_shared/push.ts';
import { requireUser } from '../_shared/supabase.ts';

const inputSchema = z
  .object({
    claimId: z.string().uuid(),
    outcome: z.enum(['reopen', 'cancel']),
    resolutionNote: z.string().trim().max(1000).optional(),
  })
  .strict();

type ResolutionResult = {
  claimId: string;
  disputeId: string;
  status: 'pending' | 'reminder_sent' | 'cancelled';
  disputeStatus: 'resolved' | 'dismissed';
  resolvedAt: string;
  debtorUserId: string | null;
};

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client, admin } = await requireUser(req);
  const { data, error } = await client.rpc('resolve_claim_dispute_transaction', {
    p_claim_id: input.claimId,
    p_outcome: input.outcome,
    p_resolution_note: input.resolutionNote ?? null,
  });
  if (error) throw fromDatabaseError(error, 'RESOLVE_DISPUTE_FAILED');
  const result = data as ResolutionResult;
  if (result.debtorUserId) {
    await sendPushToUser(admin, {
      userId: result.debtorUserId,
      eventType: input.outcome === 'cancel' ? 'dispute_cancelled' : 'dispute_resolved',
      title: input.outcome === 'cancel' ? 'Solicitud cancelada' : 'Incidencia revisada',
      body:
        input.outcome === 'cancel'
          ? 'La solicitud se ha cancelado tras revisar la incidencia.'
          : 'La incidencia se ha revisado y la solicitud vuelve a estar pendiente.',
    });
  }
  return ok(req, {
    claimId: result.claimId,
    disputeId: result.disputeId,
    status: result.status,
    disputeStatus: result.disputeStatus,
    resolvedAt: result.resolvedAt,
  });
});
