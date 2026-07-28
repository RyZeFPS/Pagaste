import { z } from 'zod';
import { optionalEnv } from '../_shared/env.ts';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { sendPushToUser } from '../_shared/push.ts';
import { requireUser } from '../_shared/supabase.ts';
import { generatePublicToken, hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z
  .object({
    claimId: z.string().uuid(),
    bankChecked: z.literal(true),
  })
  .strict();

type ReminderClaim = {
  claimId: string;
  expenseId: string;
  expenseTitle: string;
  merchantName: string | null;
  amountCents: number;
  currency: string;
  debtorDisplayName: string;
  debtorUserId: string | null;
  reminderCount: number;
};

type ReminderPreview = {
  eligible: boolean;
  blockedReason: string | null;
  nextAllowedAt: string | null;
  debtorDisplayName: string;
  debtorUserId: string | null;
  recipientLocale: string;
  currency: string;
  totalCents: number;
  messageTone: 'soft' | 'neutral' | 'direct';
  grouped: boolean;
  claims: ReminderClaim[];
};

function appUrl(): string {
  const raw = optionalEnv('APP_URL') ?? optionalEnv('EXPO_PUBLIC_APP_URL') ?? 'https://pagaste.app';
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new ApiError('APP_URL_INVALID', 'APP_URL no es válida.', 500);
  return url.toString().replace(/\/$/u, '');
}

function money(cents: number, currency: string, locale: string): string {
  if (!Number.isSafeInteger(cents))
    throw new ApiError('INVALID_AMOUNT', 'El importe no es válido.', 500);
  const value = BigInt(cents);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const major = absolute / 100n;
  const minor = (absolute % 100n).toString().padStart(2, '0');
  const english = locale.toLowerCase().startsWith('en');
  const separator = english ? '.' : ',';
  const symbol = currency === 'EUR' ? '€' : currency;
  const formattedMajor = new Intl.NumberFormat(english ? 'en-GB' : 'es-ES', {
    maximumFractionDigits: 0,
  }).format(major);
  return `${negative ? '-' : ''}${formattedMajor}${separator}${minor} ${symbol}`;
}

function reminderCopy(
  preview: ReminderPreview,
  links: { claim: ReminderClaim; url: string }[],
): { title: string; body: string; message: string } {
  const english = preview.recipientLocale.toLowerCase().startsWith('en');
  const amount = money(preview.totalCents, preview.currency, preview.recipientLocale);
  const count = links.length;
  const detail = links
    .map(({ claim, url }) => {
      const lineAmount = money(claim.amountCents, claim.currency, preview.recipientLocale);
      return `• ${claim.expenseTitle}: ${lineAmount}\n${url}`;
    })
    .join('\n');

  if (english) {
    const opening =
      preview.messageTone === 'soft'
        ? `Hi ${preview.debtorDisplayName}, when you have a moment, ${amount} is still pending in Pagaste.`
        : preview.messageTone === 'direct'
          ? `${preview.debtorDisplayName}, you still have ${amount} pending in Pagaste.`
          : `Pagaste reminder: ${amount} is still pending.`;
    return {
      title: 'Pagaste reminder',
      body:
        count > 1
          ? `${count} pending expenses add up to ${amount}.`
          : `${links[0]?.claim.expenseTitle ?? 'A payment'} is still pending.`,
      message: `${opening}\n\n${detail}`,
    };
  }

  const opening =
    preview.messageTone === 'soft'
      ? `Hola, ${preview.debtorDisplayName}. Cuando puedas, siguen pendientes ${amount} en Pagaste.`
      : preview.messageTone === 'direct'
        ? `${preview.debtorDisplayName}, tienes pendientes ${amount} en Pagaste.`
        : `Recordatorio de Pagaste: siguen pendientes ${amount}.`;
  return {
    title: 'Recordatorio de Pagaste',
    body:
      count > 1
        ? `${count} gastos pendientes suman ${amount}.`
        : `Sigue pendiente «${links[0]?.claim.expenseTitle ?? 'un pago'}».`,
    message: `${opening}\n\n${detail}`,
  };
}

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client, admin } = await requireUser(req);
  const baseUrl = appUrl();

  const { data: previewData, error: previewError } = await client.rpc('preview_claim_reminder', {
    p_claim_id: input.claimId,
  });
  if (previewError) throw fromDatabaseError(previewError, 'REMINDER_PREVIEW_FAILED');
  const preview = previewData as ReminderPreview;
  if (!preview?.eligible || !preview.claims?.length) {
    throw new ApiError(
      `REMINDER_${(preview?.blockedReason ?? 'NOT_ALLOWED').toUpperCase()}`,
      'El recordatorio todavía no está disponible.',
      409,
    );
  }

  const tokens = await Promise.all(
    preview.claims.map(async (claim) => {
      const token = generatePublicToken();
      return {
        claim,
        token,
        tokenHash: await hashPublicToken(token),
      };
    }),
  );
  const { data, error } = await client.rpc('prepare_claim_reminder_batch', {
    p_claims: tokens.map(({ claim, tokenHash }) => ({
      claimId: claim.claimId,
      tokenHash,
    })),
    p_bank_checked: input.bankChecked,
  });
  if (error) throw fromDatabaseError(error, 'REMINDER_FAILED');
  const result = data as ReminderPreview & { preparedAt: string };
  const language = result.recipientLocale.toLowerCase().startsWith('en') ? 'en' : 'es';
  const links = tokens.map(({ claim, token }) => ({
    claim,
    url: `${baseUrl}/c/${token}?lang=${language}`,
  }));
  const requestedLink = links.find(({ claim }) => claim.claimId === input.claimId) ?? links[0];
  const copy = reminderCopy(result, links);

  if (result.debtorUserId) {
    await sendPushToUser(admin, {
      userId: result.debtorUserId,
      eventType: 'claim_reminder',
      title: copy.title,
      body: copy.body,
      data: {
        claimId: input.claimId,
        route: '/notifications',
      },
    });
  }
  return ok(req, {
    claimId: input.claimId,
    claimIds: links.map(({ claim }) => claim.claimId),
    reminderCount: (requestedLink?.claim.reminderCount ?? 0) + 1,
    message: copy.message,
    shareUrl: requestedLink?.url,
    shareUrls: links.map(({ url }) => url),
    grouped: links.length > 1,
    preparedAt: result.preparedAt,
  });
});
