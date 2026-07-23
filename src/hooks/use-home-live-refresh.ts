import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

const INVALIDATION_DELAY_MS = 280;

export function useFinanceLiveRefresh(userId?: string) {
  const cache = useQueryClient();

  useEffect(() => {
    const client = supabase;
    if (!client || !userId) return;

    let disposed = false;
    let hasSubscribed = false;
    let shouldRefreshAfterReconnect = false;
    let invalidationTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (disposed) return;
      if (invalidationTimer) clearTimeout(invalidationTimer);
      invalidationTimer = setTimeout(() => {
        invalidationTimer = undefined;
        if (disposed) return;
        void Promise.all([
          cache.invalidateQueries({ queryKey: ['expenses'], exact: true }),
          cache.invalidateQueries({ queryKey: ['claims'], exact: true }),
          cache.invalidateQueries({ queryKey: ['expense'] }),
          cache.invalidateQueries({ queryKey: ['group'] }),
          cache.invalidateQueries({ queryKey: ['groups'], exact: true }),
          cache.invalidateQueries({ queryKey: ['group-streak'] }),
          cache.invalidateQueries({ queryKey: ['reputation'] }),
          cache.invalidateQueries({ queryKey: ['reputations'] }),
        ]);
      }, INVALIDATION_DELAY_MS);
    };

    const channel = client
      .channel(`pagaste-finance-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'claims' }, scheduleRefresh)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'claim_events' },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          if (hasSubscribed || shouldRefreshAfterReconnect) scheduleRefresh();
          hasSubscribed = true;
          shouldRefreshAfterReconnect = false;
          return;
        }
        if (
          hasSubscribed &&
          (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
        ) {
          shouldRefreshAfterReconnect = true;
        }
      });

    return () => {
      disposed = true;
      if (invalidationTimer) clearTimeout(invalidationTimer);
      void client.removeChannel(channel);
    };
  }, [cache, userId]);
}
