import type { PublicClaimCompletionDto, PublicClaimDto } from '@/types';

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
  ocr_learning_consent: boolean;
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
  receipt_id?: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number | null;
  line_total_cents: number;
  category: string | null;
  sort_order: number;
  ocr_confidence: number | null;
  source: 'manual' | 'ocr' | 'adjustment';
};

export type ExpenseReceipt = {
  id: string;
  expense_id: string;
  storage_path: string;
  mime_type: string;
  original_name: string | null;
  sort_order: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  scan_job_id: string | null;
  merchant_name: string | null;
  total_cents: number | null;
  confidence: number | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
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

export type ExpenseContribution = {
  id: string;
  expense_id: string;
  participant_id: string;
  amount_cents: number;
  method: 'card' | 'cash' | 'reservation' | 'other';
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ExpenseSettlement = {
  debtor_participant_id: string;
  creditor_participant_id: string;
  amount_cents: number;
  original_amount_cents?: number;
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
  creditor?: Pick<Participant, 'id' | 'user_id' | 'display_name' | 'avatar_path'> | null;
  expense?: Pick<Expense, 'id' | 'title' | 'merchant_name' | 'occurred_at' | 'currency'> | null;
  disputes?: ClaimDispute[];
  events?: {
    event_type: string;
    created_at: string;
    metadata?: Record<string, unknown>;
  }[];
};

export type ReminderTone = 'soft' | 'neutral' | 'direct';

export type ReminderPreferences = {
  user_id: string;
  enabled: boolean;
  first_delay_hours: 24 | 48 | 72;
  second_delay_days: number;
  quiet_start: string | null;
  quiet_end: string | null;
  message_tone: ReminderTone;
  group_same_debtor: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ReminderPreviewClaim = {
  claimId: string;
  expenseId: string;
  expenseTitle: string;
  merchantName: string | null;
  amountCents: number;
  currency: string;
  debtorDisplayName: string;
  debtorUserId: string | null;
  reminderCount: number;
  dueAt: string | null;
};

export type ReminderPreview = {
  eligible: boolean;
  blockedReason: 'disabled' | 'status' | 'limit_reached' | 'not_due' | 'quiet_hours' | null;
  nextAllowedAt: string | null;
  debtorDisplayName: string;
  debtorUserId: string | null;
  recipientLocale: string;
  currency: string;
  totalCents: number;
  messageTone: ReminderTone;
  grouped: boolean;
  claims: ReminderPreviewClaim[];
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

export type GroupMemberDebt = {
  group_member_id: string;
  user_id: string | null;
  amount_cents: number;
  currency: string;
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
  receipts: ExpenseReceipt[];
  items: ExpenseItem[];
  participants: Participant[];
  allocations: ItemAllocation[];
  contributions: ExpenseContribution[];
  claims: Claim[];
};

export type ExpenseCollaborationSession = {
  id: string;
  expenseId: string;
  status: 'active' | 'applied' | 'revoked';
  expiresAt: string;
  expired: boolean;
  createdAt: string;
};

export type ExpenseCollaborationGuest = {
  id: string;
  displayName: string;
  status: 'submitted' | 'applied' | 'dismissed';
  submittedAt: string;
  items: {
    id: string;
    name: string;
    lineTotalCents: number;
  }[];
};

export type ExpenseCollaborationOwnerPayload = {
  session: ExpenseCollaborationSession | null;
  guests: ExpenseCollaborationGuest[];
};

export type PublicExpenseCollaboration = {
  expenseId: string;
  title: string;
  merchantName: string | null;
  currency: string;
  totalCents: number;
  expiresAt: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    lineTotalCents: number;
  }[];
};

export type StartedExpenseCollaboration = {
  sessionId: string;
  expiresAt: string;
  url: string;
};

export type AppliedExpenseCollaboration = {
  expenseId: string;
  participantCount: number;
  itemCount: number;
};

export type PublicClaim = PublicClaimDto | PublicClaimCompletionDto;

export type ClaimLink = {
  claimId: string;
  debtorParticipantId: string;
  creditorParticipantId: string;
  amountCents: number;
  url: string;
};

export type ClaimLinkActivity = {
  claimId: string;
  active: boolean;
  expiresAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  recentAccesses: { accessedAt: string }[];
};

export type AppNotificationKind = 'claim_requested' | 'payment_check_requested';

export type AppNotification = {
  id: string;
  user_id: string;
  kind: AppNotificationKind;
  claim_id: string;
  read_at: string | null;
  created_at: string;
  claim?: {
    id: string;
    expense_id: string;
    amount_cents: number;
    status: ClaimStatus;
    debtor?: Pick<Participant, 'id' | 'user_id' | 'display_name' | 'avatar_path'> | null;
    creditor?: Pick<Participant, 'id' | 'user_id' | 'display_name' | 'avatar_path'> | null;
    expense?: Pick<Expense, 'id' | 'title' | 'currency' | 'group_id'> & {
      group?: Pick<Group, 'id' | 'name'> | null;
    };
  } | null;
};
