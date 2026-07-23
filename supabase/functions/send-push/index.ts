import { z } from 'zod';
import { ok, readJson, serve } from '../_shared/http.ts';
import { sendPushToUser } from '../_shared/push.ts';
import { requireInternalService } from '../_shared/supabase.ts';

const inputSchema = z
  .object({
    userId: z.string().uuid(),
    eventType: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/u),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(180),
    data: z.record(z.string(), z.string().max(500)).optional(),
  })
  .strict();

serve(async (req) => {
  const input = inputSchema.parse(await readJson(req));
  const admin = await requireInternalService(req);
  return ok(req, await sendPushToUser(admin, input));
});
