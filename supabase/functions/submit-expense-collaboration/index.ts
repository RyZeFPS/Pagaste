import { z } from 'zod';
import { fromDatabaseError, ok, readJson, serve } from '../_shared/http.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { adminClient } from '../_shared/supabase.ts';
import { hashPublicToken } from '../_shared/tokens.ts';

const inputSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    displayName: z.string().trim().min(1).max(80),
    itemIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict()
  .refine((input) => new Set(input.itemIds).size === input.itemIds.length, {
    message: 'Duplicate item ids are not allowed',
    path: ['itemIds'],
  });

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const admin = adminClient();
  await enforceRateLimit(admin, req, 'submit-expense-collaboration', 12, 600);
  const { data, error } = await admin.rpc('submit_expense_collaboration_selection', {
    p_token_hash: await hashPublicToken(input.token),
    p_display_name: input.displayName,
    p_item_ids: input.itemIds,
  });
  if (error) throw fromDatabaseError(error, 'COLLABORATION_SUBMIT_FAILED');
  return ok(req, data, 201);
});
