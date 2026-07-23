import { z } from 'zod';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { sendPushToUser } from '../_shared/push.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { adminClient } from '../_shared/supabase.ts';
import { hashPublicToken } from '../_shared/tokens.ts';

const reasonSchema = z.enum([
  'did_not_consume',
  'incorrect_amount',
  'already_paid',
  'unknown_expense',
  'other',
  'wrong_amount',
  'wrong_items',
  'not_mine',
]);
const inputSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    reason: reasonSchema,
    message: z.string().trim().max(1000).optional(),
  })
  .strict();

function canonicalReason(reason: z.infer<typeof reasonSchema>): string {
  if (reason === 'wrong_amount') return 'incorrect_amount';
  if (reason === 'wrong_items') return 'did_not_consume';
  if (reason === 'not_mine') return 'unknown_expense';
  return reason;
}

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const admin = adminClient();
  await enforceRateLimit(admin, req, 'dispute-claim', 8, 60);
  const { data, error } = await admin.rpc('dispute_claim_by_token', {
    p_token_hash: await hashPublicToken(input.token),
    p_reason: canonicalReason(input.reason),
    p_message: input.message ?? '',
  });
  if (error) throw fromDatabaseError(error, 'DISPUTE_FAILED');
  if (!data) throw new ApiError('CLAIM_NOT_FOUND', 'Este enlace no está disponible.', 404);
  const result = data as {
    expenseId: string;
    status: 'disputed';
    createdAt: string;
    ownerUserId: string | null;
    debtorDisplayName: string;
  };
  if (result.ownerUserId) {
    await sendPushToUser(admin, {
      userId: result.ownerUserId,
      eventType: 'claim_disputed',
      title: 'Solicitud en revisión',
      body: `${result.debtorDisplayName} ha indicado que hay un error en su parte.`,
      data: { route: `/expense/${result.expenseId}/status` },
    });
  }
  return ok(req, { status: result.status, createdAt: result.createdAt });
});
