import { z } from 'zod';
import { optionalEnv } from '../_shared/env.ts';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { requireUser } from '../_shared/supabase.ts';
import { generatePublicToken, hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z
  .object({
    groupId: z.string().uuid(),
    invitedEmail: z.string().trim().email().max(254).optional(),
    expiresInDays: z.number().int().min(1).max(30).default(14),
  })
  .strict();

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client } = await requireUser(req);
  const rawAppUrl =
    optionalEnv('APP_URL') ?? optionalEnv('EXPO_PUBLIC_APP_URL') ?? 'https://pagaste.app';
  const appUrl = new URL(rawAppUrl);
  if (!['http:', 'https:'].includes(appUrl.protocol))
    throw new ApiError('APP_URL_INVALID', 'APP_URL no es válida.', 500);
  const token = generatePublicToken();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
  const { data, error } = await client.rpc('create_group_invite_transaction', {
    p_group_id: input.groupId,
    p_token_hash: await hashPublicToken(token),
    p_invited_email: input.invitedEmail ?? '',
    p_expires_at: expiresAt.toISOString(),
  });
  if (error) throw fromDatabaseError(error, 'INVITE_CREATE_FAILED');
  return ok(
    req,
    {
      inviteId: data as string,
      expiresAt: expiresAt.toISOString(),
      url: `${appUrl.toString().replace(/\/$/u, '')}/invite/${token}`,
    },
    201,
  );
});
