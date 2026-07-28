import type { ActivityHistoryRecord } from '@/lib/activity-history';
import { getSupabase } from '@/lib/supabase/client';

const PAGE_SIZE = 500;
const ACTIVITY_SELECT = `id,expense_id,amount_cents,status,sent_at,created_at,
  debtor:expense_participants!claims_debtor_participant_id_fkey(id,user_id,display_name,avatar_path),
  creditor:expense_participants!claims_creditor_participant_id_fkey(id,user_id,display_name,avatar_path),
  expense:expenses!claims_expense_id_fkey(
    id,title,merchant_name,occurred_at,currency,group_id,
    group:groups!expenses_group_id_fkey(id,name),
    items:expense_items(id,name)
  ),
  disputes:claim_disputes(status),
  events:claim_events(event_type,created_at)`;

export async function listActivityHistory(): Promise<ActivityHistoryRecord[]> {
  const client = getSupabase();
  const records: ActivityHistoryRecord[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('claims')
      .select(ACTIVITY_SELECT)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as ActivityHistoryRecord[];
    records.push(...page);
    if (page.length < PAGE_SIZE) return records;
  }
}
