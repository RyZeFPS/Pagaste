import type { SupabaseClient } from '@supabase/supabase-js';

type PushInput = {
  userId: string;
  eventType: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

type ExpoTicket = { status?: string; details?: { error?: string }; message?: string };

export async function sendPushToUser(
  admin: SupabaseClient,
  input: PushInput,
): Promise<{ sent: number; failed: number }> {
  const { data: profile } = await admin
    .from('profiles')
    .select('notifications_enabled')
    .eq('id', input.userId)
    .maybeSingle();
  if (!profile?.notifications_enabled) return { sent: 0, failed: 0 };

  const { data: tokens, error } = await admin
    .from('push_tokens')
    .select('id,token')
    .eq('user_id', input.userId)
    .limit(100);
  if (error || !tokens?.length) return { sent: 0, failed: 0 };

  const messages = tokens.map((entry) => ({
    to: entry.token,
    sound: 'default',
    title: input.title.slice(0, 80),
    body: input.body.slice(0, 180),
    data: input.data ?? {},
  }));
  let tickets: ExpoTicket[] = [];
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      const payload = (await response.json()) as { data?: ExpoTicket[] | ExpoTicket };
      tickets = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
    }
  } catch {
    tickets = [];
  }

  let sent = 0;
  let failed = 0;
  for (const [index, token] of tokens.entries()) {
    const ticket = tickets[index];
    const errorCode = ticket?.details?.error ?? (ticket ? undefined : 'NETWORK_ERROR');
    const invalid = errorCode === 'DeviceNotRegistered';
    const status = ticket?.status === 'ok' ? 'sent' : invalid ? 'invalid_token' : 'failed';
    if (status === 'sent') sent += 1;
    else failed += 1;
    await admin.from('push_delivery_logs').insert({
      user_id: input.userId,
      push_token_id: token.id,
      event_type: input.eventType,
      status,
      error_code: errorCode?.slice(0, 80) ?? null,
    });
    if (invalid) await admin.from('push_tokens').delete().eq('id', token.id);
  }
  return { sent, failed };
}
