import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase/client';
import { useAuth } from '@/providers/auth-provider';

export type Entitlement =
  'ocr_scan' | 'automatic_reminders' | 'advanced_exports' | 'smart_suggestions';
export function useEntitlements() {
  const { user, configured } = useAuth();
  const query = useQuery({
    queryKey: ['entitlements', user?.id],
    enabled: configured && Boolean(user),
    queryFn: async () => {
      const start = new Date();
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      const { data, error } = await getSupabase()
        .from('usage_counters')
        .select('ocr_scans_used')
        .eq('user_id', user!.id)
        .gte('period_start', start.toISOString().slice(0, 10))
        .maybeSingle();
      if (error) throw error;
      const scansUsed = Number(data?.ocr_scans_used ?? 0);
      return {
        plan: 'free' as const,
        scansUsed,
        scanLimit: 3,
        can: (entitlement: Entitlement) => entitlement === 'ocr_scan' && scansUsed < 3,
      };
    },
  });
  return {
    ...query,
    data: query.data ?? {
      plan: 'free' as const,
      scansUsed: 0,
      scanLimit: 3,
      can: (entitlement: Entitlement) => entitlement === 'ocr_scan',
    },
  };
}
