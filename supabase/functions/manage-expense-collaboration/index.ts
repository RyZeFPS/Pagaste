import { z } from 'zod';
import { optionalEnv } from '../_shared/env.ts';
import { ApiError, fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { requireUser } from '../_shared/supabase.ts';
import { generatePublicToken, hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start'),
      expenseId: z.string().uuid(),
      expiresInHours: z.number().int().min(1).max(168).default(24),
      locale: z.enum(['es', 'en']).default('es'),
    })
    .strict(),
  z.object({ action: z.literal('get'), expenseId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('apply'), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('revoke'), sessionId: z.string().uuid() }).strict(),
]);

function publicAppUrl(): URL {
  const raw = optionalEnv('APP_URL') ?? optionalEnv('EXPO_PUBLIC_APP_URL') ?? 'https://pagaste.app';
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ApiError('APP_URL_INVALID', 'APP_URL no es válida.', 500);
  }
  return url;
}

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const { client } = await requireUser(req);

  if (input.action === 'get') {
    const { data, error } = await client.rpc('get_expense_collaboration_owner_payload', {
      p_expense_id: input.expenseId,
    });
    if (error) throw fromDatabaseError(error, 'COLLABORATION_LOOKUP_FAILED');
    return ok(req, data);
  }

  if (input.action === 'apply') {
    const { data, error } = await client.rpc('apply_expense_collaboration_session', {
      p_session_id: input.sessionId,
    });
    if (error) throw fromDatabaseError(error, 'COLLABORATION_APPLY_FAILED');
    return ok(req, data);
  }

  if (input.action === 'revoke') {
    const { error } = await client.rpc('revoke_expense_collaboration_session', {
      p_session_id: input.sessionId,
    });
    if (error) throw fromDatabaseError(error, 'COLLABORATION_REVOKE_FAILED');
    return ok(req, { sessionId: input.sessionId, status: 'revoked' as const });
  }

  const token = generatePublicToken();
  const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);
  const { data, error } = await client.rpc('start_expense_collaboration_session', {
    p_expense_id: input.expenseId,
    p_token_hash: await hashPublicToken(token),
    p_expires_at: expiresAt.toISOString(),
  });
  if (error) throw fromDatabaseError(error, 'COLLABORATION_START_FAILED');

  const url = publicAppUrl();
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/join/${token}`;
  url.search = new URLSearchParams({ lang: input.locale }).toString();
  url.hash = '';

  return ok(
    req,
    {
      sessionId: data as string,
      expiresAt: expiresAt.toISOString(),
      url: url.toString(),
    },
    201,
  );
});
