import { z } from 'zod';
import { fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { sendPushToUser } from '../_shared/push.ts';
import { requireUser } from '../_shared/supabase.ts';

const inputSchema = z.object({ claimId: z.string().uuid() }).strict();

function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { admin, user } = await requireUser(req);
  const { data, error } = await admin.rpc('request_claim_payment_check', {
    p_claim_id: input.claimId,
    p_actor_user_id: user.id,
  });
  if (error) throw fromDatabaseError(error, 'PAYMENT_CHECK_FAILED');

  const result = data as {
    claimId: string;
    expenseId: string;
    recipientUserId: string;
    debtorDisplayName: string;
    expenseTitle: string;
    currency: string;
    amountCents: number;
    groupName: string | null;
    requestedAt: string;
    nextAllowedAt: string;
  };
  const groupContext = result.groupName ? ` en ${result.groupName}` : '';
  const push = await sendPushToUser(admin, {
    userId: result.recipientUserId,
    eventType: 'payment_check_requested',
    title: 'Comprueba si ha llegado',
    body: `${result.debtorDisplayName} te pide revisar el ingreso de ${formatMoney(result.amountCents, result.currency)}${groupContext}.`,
    data: {
      route: '/settings/notifications',
      claimId: result.claimId,
      expenseId: result.expenseId,
    },
  });

  return ok(req, {
    claimId: result.claimId,
    expenseId: result.expenseId,
    requestedAt: result.requestedAt,
    nextAllowedAt: result.nextAllowedAt,
    push,
  });
});
