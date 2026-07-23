import type { PublicClaimDto } from '@/types';

export type Profile = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  avatar_url?: string | null;
  payment_phone_e164: string | null;
  share_payment_phone: boolean;
  default_currency: string;
  locale: string;
  timezone: string;
  notifications_enabled: boolean;
  onboarding_completed: boolean;
  created_at: string;
  archived_at?: string | null;
};

export type Expense = {
  id: string;
  group_id: string | null;
  created_by: string;
  payer_member_id: string | null;
  payer_participant_id: string | null;
  title: string;
  merchant_name: string | null;
  occurred_at: string;
  currency: string;
  total_cents: number;
  recoverable_cents: number;
  own_share_cents: number;
  receipt_path: string | null;
  status: 'draft' | 'sent' | 'settled' | 'cancelled';
  scan_status: 'idle' | 'processing' | 'completed' | 'failed';
  notes: string | null;
  created_at: string;
  archived_at: string | null;
};

export type ExpenseItem = {
  id: string;
  expense_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number | null;
  line_total_cents: number;
  category: string | null;
  sort_order: number;
  ocr_confidence: number | null;
  source: 'manual' | 'ocr' | 'adjustment';
};

export type Participant = {
  id: string;
  expense_id: string;
  user_id: string | null;
  display_name: string;
  avatar_path: string | null;
  email: string | null;
  phone_e164: string | null;
  is_payer: boolean;
  sort_order: number;
};

export type ItemAllocation = {
  id: string;
  item_id: string;
  participant_id: string;
  method: 'equal' | 'shares' | 'percentage' | 'units' | 'custom';
  shares: number | null;
  percentage: number | null;
  units: number | null;
  amount_cents: number;
};

export type ClaimStatus = 'pending' | 'received' | 'reminder_sent' | 'disputed' | 'cancelled';
export type ClaimDispute = {
  reason: 'did_not_consume' | 'incorrect_amount' | 'already_paid' | 'unknown_expense' | 'other';
  message: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
};
export type Claim = {
  id: string;
  expense_id: string;
  debtor_participant_id: string;
  creditor_participant_id: string;
  amount_cents: number;
  status: ClaimStatus;
  sent_at: string | null;
  viewed_at: string | null;
  received_at: string | null;
  received_by_user_id: string | null;
  last_reminded_at: string | null;
  reminder_count: number;
  debtor?: Pick<Participant, 'id' | 'user_id' | 'display_name' | 'avatar_path'> | null;
  expense?: Pick<Expense, 'id' | 'title' | 'merchant_name' | 'occurred_at' | 'currency'> | null;
  disputes?: ClaimDispute[];
};

export type Group = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  type: string;
  currency: string;
  avatar_path: string | null;
  avatar_url?: string | null;
  created_at: string;
};

export type GroupMember = {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  avatar_path: string | null;
  role: string;
  status: string;
};

export type ReputationCard = {
  userId: string;
  score: number | null;
  level: 'new' | 'very_reliable' | 'reliable' | 'building' | 'improving';
  completedPayments: number;
  within24Rate: number | null;
  medianPaymentHours: number | null;
  averageReminders: number | null;
  isOwn: boolean;
};

export type GroupStreakCard = {
  groupId: string;
  currentStreak: number;
  longestStreak: number;
  completedRounds: number;
  successfulRounds: number;
  within24Rate: number | null;
  hasOverdue: boolean;
  activeClaims: number;
  nextDeadline: string | null;
};

export type ExpenseDetail = Expense & {
  items: ExpenseItem[];
  participants: Participant[];
  allocations: ItemAllocation[];
  claims: Claim[];
};

export type PublicClaim = PublicClaimDto;

export type ClaimLink = {
  claimId: string;
  debtorParticipantId: string;
  amountCents: number;
  url: string;
};
