import { z } from 'zod';
import { optionalEnv } from '../_shared/env.ts';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { requireUser } from '../_shared/supabase.ts';
import { generatePublicToken, hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z
  .object({
    claimId: z.string().uuid(),
    expiresInDays: z.number().int().min(1).max(90).default(30),
  })
  .strict();

function appUrl(): string {
  const raw = optionalEnv('APP_URL') ?? optionalEnv('EXPO_PUBLIC_APP_URL') ?? 'https://pagaste.app';
  const value = new URL(raw);
  if (!['http:', 'https:'].includes(value.protocol))
    throw new ApiError('APP_URL_INVALID', 'APP_URL is invalid.', 500);
  return value.toString().replace(/\/$/u, '');
}

function languageFor(locale: unknown): 'es' | 'en' {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? 'en' : 'es';
}

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client } = await requireUser(req);
  const token = generatePublicToken();
  const tokenHash = await hashPublicToken(token);

  const { data, error } = await client.rpc('rotate_claim_link', {
    p_claim_id: input.claimId,
    p_new_token_hash: tokenHash,
    p_expires_in_days: input.expiresInDays,
  });
  if (error) throw fromDatabaseError(error, 'CLAIM_LINK_REGENERATE_FAILED');
  if (!data || typeof data !== 'object')
    throw new ApiError(
      'CLAIM_LINK_REGENERATE_FAILED',
      'The claim link could not be regenerated.',
      500,
    );

  const result = data as {
    claimId?: unknown;
    expiresAt?: unknown;
    recipientLocale?: unknown;
  };
  if (typeof result.claimId !== 'string' || typeof result.expiresAt !== 'string')
    throw new ApiError('CLAIM_LINK_REGENERATE_FAILED', 'The claim link response is invalid.', 500);

  return ok(req, {
    claimId: result.claimId,
    expiresAt: result.expiresAt,
    url: `${appUrl()}/c/${token}?lang=${languageFor(result.recipientLocale)}`,
  });
});
