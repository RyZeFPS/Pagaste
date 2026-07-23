import { z } from 'zod';
import { optionalEnv } from '../_shared/env.ts';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { sendPushToUser } from '../_shared/push.ts';
import { requireUser } from '../_shared/supabase.ts';
import { generatePublicToken, hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z.object({ claimId: z.string().uuid() }).strict();

function appUrl(): string {
  const raw = optionalEnv('APP_URL') ?? optionalEnv('EXPO_PUBLIC_APP_URL') ?? 'https://pagaste.app';
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new ApiError('APP_URL_INVALID', 'APP_URL no es válida.', 500);
  return url.toString().replace(/\/$/u, '');
}

function euroLike(cents: number, currency: string): string {
  if (!Number.isSafeInteger(cents))
    throw new ApiError('INVALID_AMOUNT', 'El importe no es válido.', 500);
  const value = BigInt(cents);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const major = absolute / 100n;
  const minor = (absolute % 100n).toString().padStart(2, '0');
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${negative ? '-' : ''}${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(major)},${minor} ${symbol}`;
}

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client, admin } = await requireUser(req);
  const baseUrl = appUrl();
  const token = generatePublicToken();
  const { data, error } = await client.rpc('prepare_claim_reminder', {
    p_claim_id: input.claimId,
    p_new_token_hash: await hashPublicToken(token),
  });
  if (error) throw fromDatabaseError(error, 'REMINDER_FAILED');
  const result = data as {
    claimId: string;
    amountCents: number;
    currency: string;
    expenseTitle: string;
    debtorDisplayName: string;
    debtorUserId: string | null;
    reminderCount: number;
  };
  const shareUrl = `${baseUrl}/c/${token}`;
  const message = `Recordatorio de Pagaste: sigue pendiente tu parte de ${euroLike(result.amountCents, result.currency)} de “${result.expenseTitle}”.\n\n${shareUrl}`;
  if (result.debtorUserId) {
    await sendPushToUser(admin, {
      userId: result.debtorUserId,
      eventType: 'claim_reminder',
      title: 'Recordatorio de Pagaste',
      body: `Sigue pendiente tu parte de “${result.expenseTitle}”.`,
    });
  }
  return ok(req, {
    claimId: result.claimId,
    reminderCount: result.reminderCount,
    message,
    shareUrl,
  });
});
