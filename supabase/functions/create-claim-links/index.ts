import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { optionalEnv } from '../_shared/env.ts';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { sendPushToUser } from '../_shared/push.ts';
import { requireUser } from '../_shared/supabase.ts';
import { generatePublicToken, hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z
  .object({
    expenseId: z.string().uuid(),
    claims: z
      .array(
        z
          .object({
            debtorParticipantId: z.string().uuid(),
            amountCents: z.number().int().positive().safe(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.claims.map((claim) => claim.debtorParticipantId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', message: 'Duplicate debtor' });
    const total = value.claims.reduce((sum, claim) => sum + BigInt(claim.amountCents), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      context.addIssue({ code: 'custom', message: 'Unsafe claim total' });
  });

function appUrl(): string {
  const raw = optionalEnv('APP_URL') ?? optionalEnv('EXPO_PUBLIC_APP_URL') ?? 'https://pagaste.app';
  const value = new URL(raw);
  if (!['http:', 'https:'].includes(value.protocol))
    throw new ApiError('APP_URL_INVALID', 'APP_URL no es válida.', 500);
  return value.toString().replace(/\/$/u, '');
}

function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}

async function notifyLinkedDebtors(
  admin: SupabaseClient,
  input: {
    expenseId: string;
    expenseTitle: string;
    currency: string;
    creditorName: string;
    claims: {
      claimId: string;
      debtorParticipantId: string;
      amountCents: number;
      token: string;
    }[];
  },
): Promise<void> {
  const participantIds = input.claims.map((claim) => claim.debtorParticipantId);
  const { data: participants, error } = await admin
    .from('expense_participants')
    .select('id,user_id')
    .in('id', participantIds);
  if (error || !participants?.length) return;

  const users = new Map(
    participants
      .filter(
        (participant): participant is { id: string; user_id: string } =>
          typeof participant.user_id === 'string',
      )
      .map((participant) => [participant.id, participant.user_id]),
  );

  await Promise.allSettled(
    input.claims.map(async (claim) => {
      const userId = users.get(claim.debtorParticipantId);
      if (!userId) return;
      await sendPushToUser(admin, {
        userId,
        eventType: 'claim_requested',
        title: 'Nueva solicitud de pago',
        body: `${input.creditorName} te ha solicitado ${formatMoney(claim.amountCents, input.currency)} por ${input.expenseTitle}.`,
        data: {
          route: '/settings/notifications',
          claimId: claim.claimId,
          expenseId: input.expenseId,
        },
      });
    }),
  );
}

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client, admin, user } = await requireUser(req);
  const baseUrl = appUrl();
  const secrets = await Promise.all(
    input.claims.map(async (claim) => {
      const token = generatePublicToken();
      return { ...claim, token, tokenHash: await hashPublicToken(token) };
    }),
  );
  const { data, error } = await client.rpc('create_claims_transaction', {
    p_expense_id: input.expenseId,
    p_claims: secrets.map(({ debtorParticipantId, amountCents, tokenHash }) => ({
      debtorParticipantId,
      amountCents,
      tokenHash,
    })),
  });
  if (error) throw fromDatabaseError(error, 'CLAIMS_CREATE_FAILED');
  if (!Array.isArray(data))
    throw new ApiError('CLAIMS_CREATE_FAILED', 'No se pudieron crear las solicitudes.', 500);
  const rows = new Map<string, { claim_id: string; amount_cents: number }>(
    data.map((row: { debtor_participant_id: string; claim_id: string; amount_cents: number }) => [
      row.debtor_participant_id,
      row,
    ]),
  );
  const createdClaims = secrets.map((secret) => {
    const row = rows.get(secret.debtorParticipantId);
    if (!row) throw new ApiError('CLAIMS_CREATE_FAILED', 'Falta una solicitud creada.', 500);
    return {
      claimId: row.claim_id,
      debtorParticipantId: secret.debtorParticipantId,
      amountCents: row.amount_cents,
      token: secret.token,
      url: `${baseUrl}/c/${secret.token}`,
    };
  });

  const [{ data: expense }, { data: creditor }] = await Promise.all([
    admin.from('expenses').select('title,currency').eq('id', input.expenseId).maybeSingle(),
    admin.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
  ]);
  if (expense && creditor) {
    const delivery = notifyLinkedDebtors(admin, {
      expenseId: input.expenseId,
      expenseTitle: expense.title,
      currency: expense.currency,
      creditorName: creditor.display_name,
      claims: createdClaims,
    }).catch((error: unknown) => {
      console.error('Claim push delivery failed', error instanceof Error ? error.name : 'Unknown');
    });
    const edgeRuntime = (
      globalThis as typeof globalThis & {
        EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
      }
    ).EdgeRuntime;
    if (edgeRuntime) edgeRuntime.waitUntil(delivery);
    else await delivery;
  }

  return ok(
    req,
    {
      claims: createdClaims.map(({ token: _token, ...claim }) => claim),
    },
    201,
  );
});
