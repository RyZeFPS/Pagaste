import { z } from 'zod';
import { optionalEnv } from '../_shared/env.ts';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
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

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client } = await requireUser(req);
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
  return ok(
    req,
    {
      claims: secrets.map((secret) => {
        const row = rows.get(secret.debtorParticipantId);
        if (!row) throw new ApiError('CLAIMS_CREATE_FAILED', 'Falta una solicitud creada.', 500);
        return {
          claimId: row.claim_id,
          debtorParticipantId: secret.debtorParticipantId,
          amountCents: row.amount_cents,
          url: `${baseUrl}/c/${secret.token}`,
        };
      }),
    },
    201,
  );
});
