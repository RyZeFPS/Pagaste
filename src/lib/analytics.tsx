import { createContext, useContext, type PropsWithChildren } from 'react';

export type AnalyticsEvent =
  | 'sign_up_completed'
  | 'expense_started'
  | 'receipt_uploaded'
  | 'receipt_scan_succeeded'
  | 'receipt_scan_failed'
  | 'expense_items_confirmed'
  | 'participant_added'
  | 'allocation_completed'
  | 'claims_created'
  | 'claim_shared'
  | 'public_claim_viewed'
  | 'claim_received'
  | 'claim_disputed'
  | 'reminder_created'
  | 'expense_settled';
export interface AnalyticsProvider {
  track(event: AnalyticsEvent, properties?: Record<string, string | number | boolean>): void;
}
const noop: AnalyticsProvider = { track: () => undefined };
const AnalyticsContext = createContext(noop);
export function AnalyticsBoundary({
  children,
  provider = noop,
}: PropsWithChildren<{ provider?: AnalyticsProvider }>) {
  return <AnalyticsContext.Provider value={provider}>{children}</AnalyticsContext.Provider>;
}
export const useAnalytics = () => useContext(AnalyticsContext);
