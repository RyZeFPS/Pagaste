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
    // Accepted only so an older installed client can call the updated Edge
    // Function. Amounts are never trusted: the database calculates every
    // debtor/creditor transfer from allocations and contributions.
    claims: z.array(z.unknown()).max(100).optional(),
  })
  .strict();

function appUrl(): string {
  const raw = optionalEnv('APP_URL') ?? optionalEnv('EXPO_PUBLIC_APP_URL') ?? 'https://pagaste.app';
  const value = new URL(raw);
  if (!['http:', 'https:'].includes(value.protocol))
    throw new ApiError('APP_URL_INVALID', 'APP_URL no es válida.', 500);
  return value.toString().replace(/\/$/u, '');
}

function normalizedLanguage(locale: string | null | undefined): 'es' | 'en' {
  return locale?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

function formatMoney(amountCents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}

async function loadRecipientLocales(
  admin: SupabaseClient,
  participantIds: string[],
): Promise<Map<string, string>> {
  if (!participantIds.length) return new Map();
  const { data: participants, error } = await admin
    .from('expense_participants')
    .select('id,user_id')
    .in('id', [...new Set(participantIds)]);
  if (error || !participants?.length) return new Map();

  const userIds = participants
    .map((participant) => participant.user_id)
    .filter((userId): userId is string => typeof userId === 'string');
  if (!userIds.length) return new Map();

  const { data: profiles } = await admin
    .from('profiles')
    .select('id,locale')
    .in('id', [...new Set(userIds)]);
  const localeByUser = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      typeof profile.locale === 'string' ? profile.locale : 'es-ES',
    ]),
  );
  return new Map(
    participants
      .filter(
        (participant): participant is { id: string; user_id: string } =>
          typeof participant.user_id === 'string',
      )
      .map((participant) => [participant.id, localeByUser.get(participant.user_id) ?? 'es-ES']),
  );
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
      creditorParticipantId: string;
      amountCents: number;
      token: string;
    }[];
    recipientLocales: Map<string, string>;
  },
): Promise<void> {
  const participantIds = [
    ...new Set(
      input.claims.flatMap((claim) => [claim.debtorParticipantId, claim.creditorParticipantId]),
    ),
  ];
  const { data: participants, error } = await admin
    .from('expense_participants')
    .select('id,user_id,display_name')
    .in('id', participantIds);
  if (error || !participants?.length) return;

  const debtorUsers = new Map(
    participants
      .filter(
        (
          participant,
        ): participant is {
          id: string;
          user_id: string;
          display_name: string;
        } => typeof participant.user_id === 'string',
      )
      .map((participant) => [participant.id, participant.user_id]),
  );
  const participantNames = new Map(
    participants.map((participant) => [participant.id, participant.display_name]),
  );

  await Promise.allSettled(
    input.claims.map(async (claim) => {
      const userId = debtorUsers.get(claim.debtorParticipantId);
      if (!userId) return;
      const creditorName = participantNames.get(claim.creditorParticipantId) ?? input.creditorName;
      const locale = input.recipientLocales.get(claim.debtorParticipantId) ?? 'es-ES';
      const language = normalizedLanguage(locale);
      await sendPushToUser(admin, {
        userId,
        eventType: 'claim_requested',
        title: language === 'en' ? 'New payment request' : 'Nueva solicitud de pago',
        body:
          language === 'en'
            ? `${creditorName} requested ${formatMoney(claim.amountCents, input.currency, locale)} from you for ${input.expenseTitle}.`
            : `${creditorName} te ha solicitado ${formatMoney(claim.amountCents, input.currency, locale)} por ${input.expenseTitle}.`,
        data: {
          route: '/notifications',
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
  const { data: settlements, error: previewError } = await client.rpc(
    'preview_expense_settlements',
    {
      p_expense_id: input.expenseId,
    },
  );
  if (previewError) throw fromDatabaseError(previewError, 'CLAIMS_CREATE_FAILED');
  if (!Array.isArray(settlements) || settlements.length === 0) {
    const { error: settleError } = await client.rpc('settle_balanced_expense', {
      p_expense_id: input.expenseId,
    });
    if (settleError) throw fromDatabaseError(settleError, 'BALANCED_EXPENSE_SETTLE_FAILED');
    return ok(req, { claims: [], status: 'settled' }, 201);
  }
  const secrets = await Promise.all(
    settlements.map(
      async (claim: {
        debtor_participant_id: string;
        creditor_participant_id: string;
        amount_cents: number;
      }) => {
        const token = generatePublicToken();
        return {
          debtorParticipantId: claim.debtor_participant_id,
          creditorParticipantId: claim.creditor_participant_id,
          amountCents: claim.amount_cents,
          token,
          tokenHash: await hashPublicToken(token),
        };
      },
    ),
  );
  const { data, error } = await client.rpc('create_claims_with_offsets_transaction', {
    p_expense_id: input.expenseId,
    p_claims: secrets.map(
      ({ debtorParticipantId, creditorParticipantId, amountCents, tokenHash }) => ({
        debtorParticipantId,
        creditorParticipantId,
        amountCents,
        tokenHash,
      }),
    ),
  });
  if (error) throw fromDatabaseError(error, 'CLAIMS_CREATE_FAILED');
  if (!Array.isArray(data))
    throw new ApiError('CLAIMS_CREATE_FAILED', 'No se pudieron crear las solicitudes.', 500);
  const rows = new Map<
    string,
    {
      claim_id: string;
      amount_cents: number;
      debtor_participant_id: string;
      creditor_participant_id: string;
    }
  >(
    data.map(
      (row: {
        debtor_participant_id: string;
        creditor_participant_id: string;
        claim_id: string;
        amount_cents: number;
      }) => [`${row.debtor_participant_id}:${row.creditor_participant_id}`, row],
    ),
  );
  const recipientLocales = await loadRecipientLocales(
    admin,
    secrets.map((secret) => secret.debtorParticipantId),
  );
  const createdClaims = secrets.flatMap((secret) => {
    const row = rows.get(`${secret.debtorParticipantId}:${secret.creditorParticipantId}`);
    // A missing row means this transfer was fully compensated against an
    // existing reverse debt. No public bearer link or push is needed.
    if (!row) return [];
    return [
      {
        claimId: row.claim_id,
        debtorParticipantId: secret.debtorParticipantId,
        creditorParticipantId: secret.creditorParticipantId,
        amountCents: row.amount_cents,
        token: secret.token,
        url: `${baseUrl}/c/${secret.token}?lang=${normalizedLanguage(
          recipientLocales.get(secret.debtorParticipantId),
        )}`,
      },
    ];
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
      recipientLocales,
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
      status: createdClaims.length ? 'sent' : 'settled',
    },
    201,
  );
});
