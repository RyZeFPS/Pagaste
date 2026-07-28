import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { appUrl, getSupabase } from '@/lib/supabase/client';
import { AppError } from '@/lib/api-error';
import { sanitizePublicClaimResponseDto } from '@/domain/public-claims';
import type { PersonSuggestion } from '@/domain/person-suggestions';
import type { CombinedReceiptResult } from '@/domain/multi-receipt';
import type { ReceiptScanResult } from '@/types';
import type {
  Claim,
  ClaimLink,
  ClaimLinkActivity,
  AppNotification,
  AppliedExpenseCollaboration,
  ExpenseContribution,
  ExpenseCollaborationOwnerPayload,
  Expense,
  ExpenseDetail,
  ExpenseItem,
  ExpenseReceipt,
  ExpenseSettlement,
  Group,
  GroupMember,
  GroupMemberDebt,
  GroupStreakCard,
  ItemAllocation,
  Participant,
  Profile,
  PublicClaim,
  PublicExpenseCollaboration,
  ReminderPreferences,
  ReminderPreview,
  ReputationCard,
  StartedExpenseCollaboration,
} from '@/lib/models';

function unwrap<T>(result: {
  data: T | null;
  error: { message: string; code?: string } | null;
}): T {
  if (result.error) throw new AppError(result.error.code ?? 'SERVER_ERROR', result.error.message);
  if (result.data === null) throw new AppError('NOT_FOUND', 'Not found');
  return result.data;
}

type EdgeEnvelope<T> = { data: T | null; error: { code: string; message: string } | null };

function isEdgeError(value: unknown): value is { code: string; message: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

async function parseFunctionError(error: unknown): Promise<AppError> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof context === 'object' && 'json' in context) {
      try {
        const payload = await (context as { json: () => Promise<unknown> }).json();
        if (payload && typeof payload === 'object') {
          const edgeError = (payload as { error?: unknown }).error;
          if (isEdgeError(edgeError)) return new AppError(edgeError.code, edgeError.message);
        }
      } catch {
        // Fall back to the SDK error when the response is not our JSON envelope.
      }
    }
  }
  return new AppError(
    'FUNCTION_ERROR',
    error instanceof Error ? error.message : 'No se pudo completar la operación.',
  );
}

async function invoke<T>(name: string, body: object): Promise<T> {
  const result = await getSupabase().functions.invoke<EdgeEnvelope<T>>(name, { body });
  if (result.error) throw await parseFunctionError(result.error);
  if (!result.data || result.data.error || !result.data.data) {
    throw new AppError(
      result.data?.error?.code ?? 'FUNCTION_ERROR',
      result.data?.error?.message ?? 'Function failed',
    );
  }
  return result.data.data;
}

const GROUP_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const GROUP_AVATAR_TTL_SECONDS = 60 * 60;
const PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_AVATAR_TTL_SECONDS = 60 * 60;

async function readImageBytes(uri: string, maxBytes: number): Promise<ArrayBuffer> {
  let bytes: ArrayBuffer;
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new AppError('UPLOAD_READ_FAILED', 'No se ha podido leer la imagen.');
    bytes = await response.arrayBuffer();
  } else {
    const file = new File(uri);
    if (file.size > maxBytes)
      throw new AppError('IMAGE_TOO_LARGE', 'La imagen supera el límite de 2 MB.');
    bytes = await file.arrayBuffer();
  }
  if (bytes.byteLength > maxBytes)
    throw new AppError('IMAGE_TOO_LARGE', 'La imagen supera el límite de 2 MB.');
  return bytes;
}

async function withGroupAvatarUrl(group: Group): Promise<Group> {
  if (!group.avatar_path) return { ...group, avatar_url: null };
  const { data, error } = await getSupabase()
    .storage.from('group-avatars')
    .createSignedUrl(group.avatar_path, GROUP_AVATAR_TTL_SECONDS);
  return { ...group, avatar_url: error ? null : data.signedUrl };
}

async function withProfileAvatarUrl(profile: Profile): Promise<Profile> {
  if (!profile.avatar_path) return { ...profile, avatar_url: null };
  const { data, error } = await getSupabase()
    .storage.from('profile-avatars')
    .createSignedUrl(profile.avatar_path, PROFILE_AVATAR_TTL_SECONDS);
  return { ...profile, avatar_url: error ? null : data.signedUrl };
}

async function withGroupAvatarUrls(groups: Group[]): Promise<Group[]> {
  const paths = [
    ...new Set(groups.flatMap((group) => (group.avatar_path ? [group.avatar_path] : []))),
  ];
  if (!paths.length) return groups.map((group) => ({ ...group, avatar_url: null }));
  const { data, error } = await getSupabase()
    .storage.from('group-avatars')
    .createSignedUrls(paths, GROUP_AVATAR_TTL_SECONDS);
  if (error) return groups.map((group) => ({ ...group, avatar_url: null }));
  const urls = new Map(data.map((entry) => [entry.path, entry.error ? null : entry.signedUrl]));
  return groups.map((group) => ({
    ...group,
    avatar_url: group.avatar_path ? (urls.get(group.avatar_path) ?? null) : null,
  }));
}

export const repository = {
  async profile(userId: string): Promise<Profile | null> {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.code, error.message);
    return data ? withProfileAvatarUrl(data as Profile) : null;
  },
  async saveProfile(userId: string, values: Partial<Profile>): Promise<Profile> {
    const result = await getSupabase()
      .from('profiles')
      .update(values)
      .eq('id', userId)
      .select()
      .single();
    return withProfileAvatarUrl(unwrap(result) as Profile);
  },
  async reminderPreferences(userId: string): Promise<ReminderPreferences> {
    const { data, error } = await getSupabase()
      .from('reminder_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.code, error.message);
    return (
      (data as ReminderPreferences | null) ?? {
        user_id: userId,
        enabled: true,
        first_delay_hours: 24,
        second_delay_days: 3,
        quiet_start: '22:00:00',
        quiet_end: '08:00:00',
        message_tone: 'neutral',
        group_same_debtor: true,
      }
    );
  },
  async saveReminderPreferences(
    userId: string,
    values: Partial<Omit<ReminderPreferences, 'user_id' | 'created_at' | 'updated_at'>>,
  ): Promise<ReminderPreferences> {
    const current = await repository.reminderPreferences(userId);
    const result = await getSupabase()
      .from('reminder_preferences')
      .upsert(
        {
          user_id: userId,
          enabled: values.enabled ?? current.enabled,
          first_delay_hours: values.first_delay_hours ?? current.first_delay_hours,
          second_delay_days: values.second_delay_days ?? current.second_delay_days,
          quiet_start: values.quiet_start === undefined ? current.quiet_start : values.quiet_start,
          quiet_end: values.quiet_end === undefined ? current.quiet_end : values.quiet_end,
          message_tone: values.message_tone ?? current.message_tone,
          group_same_debtor: values.group_same_debtor ?? current.group_same_debtor,
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single();
    return unwrap(result) as ReminderPreferences;
  },
  async uploadProfileAvatar(userId: string, uri: string): Promise<Profile> {
    const client = getSupabase();
    const current = unwrap(
      await client.from('profiles').select('*').eq('id', userId).single(),
    ) as Profile;
    const bytes = await readImageBytes(uri, PROFILE_AVATAR_MAX_BYTES);
    const path = `${userId}/${Crypto.randomUUID()}.jpg`;
    const uploaded = await client.storage
      .from('profile-avatars')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) throw new AppError('PROFILE_AVATAR_UPLOAD_FAILED', uploaded.error.message);

    const updated = await client
      .from('profiles')
      .update({ avatar_path: path })
      .eq('id', userId)
      .select()
      .single();
    if (updated.error || !updated.data) {
      await client.storage.from('profile-avatars').remove([path]);
      throw new AppError(
        updated.error?.code ?? 'PROFILE_AVATAR_UPDATE_FAILED',
        updated.error?.message ?? 'No se ha podido guardar la foto de perfil.',
      );
    }

    if (current.avatar_path && current.avatar_path !== path) {
      await client.storage.from('profile-avatars').remove([current.avatar_path]);
    }
    return withProfileAvatarUrl(updated.data as Profile);
  },
  async removeProfileAvatar(userId: string): Promise<Profile> {
    const client = getSupabase();
    const current = unwrap(
      await client.from('profiles').select('*').eq('id', userId).single(),
    ) as Profile;
    const updated = await client
      .from('profiles')
      .update({ avatar_path: null })
      .eq('id', userId)
      .select()
      .single();
    const profile = unwrap(updated) as Profile;
    if (current.avatar_path) {
      await client.storage.from('profile-avatars').remove([current.avatar_path]);
    }
    return { ...profile, avatar_url: null };
  },
  async listExpenses(): Promise<Expense[]> {
    const result = await getSupabase()
      .from('expenses')
      .select('*')
      .is('archived_at', null)
      .order('occurred_at', { ascending: false })
      .limit(30);
    return unwrap(result) as Expense[];
  },
  async listClaims(expenseId?: string): Promise<Claim[]> {
    let query = getSupabase()
      .from('claims')
      .select(
        '*, debtor:expense_participants!claims_debtor_participant_id_fkey(id,user_id,display_name,avatar_path), creditor:expense_participants!claims_creditor_participant_id_fkey(id,user_id,display_name,avatar_path), expense:expenses!claims_expense_id_fkey(id,title,merchant_name,occurred_at,currency), events:claim_events(event_type,created_at,metadata)',
      )
      .order('created_at', { ascending: false });
    if (expenseId) query = query.eq('expense_id', expenseId);
    const result = await query.limit(100);
    return unwrap(result) as Claim[];
  },
  async listAppNotifications(userId: string): Promise<AppNotification[]> {
    const { data, error } = await getSupabase()
      .from('app_notifications')
      .select(
        'id,user_id,kind,claim_id,read_at,created_at, claim:claims!app_notifications_claim_id_fkey(id,expense_id,amount_cents,status, debtor:expense_participants!claims_debtor_participant_id_fkey(id,user_id,display_name,avatar_path), creditor:expense_participants!claims_creditor_participant_id_fkey(id,user_id,display_name,avatar_path), expense:expenses!claims_expense_id_fkey(id,title,currency,group_id, group:groups!expenses_group_id_fkey(id,name)))',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new AppError(error.code, error.message);
    return (data ?? []) as unknown as AppNotification[];
  },
  async unreadNotificationCount(userId: string): Promise<number> {
    const { count, error } = await getSupabase()
      .from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throw new AppError(error.code, error.message);
    return count ?? 0;
  },
  async markNotificationsRead(notificationIds: string[]): Promise<void> {
    if (!notificationIds.length) return;
    const { error } = await getSupabase()
      .from('app_notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', notificationIds);
    if (error) throw new AppError(error.code, error.message);
  },
  async expense(id: string): Promise<ExpenseDetail> {
    const client = getSupabase();
    const [expense, receipts, items, participants, allocations, contributions, claims] =
      await Promise.all([
        client.from('expenses').select('*').eq('id', id).single(),
        client
          .from('expense_receipts')
          .select('*')
          .eq('expense_id', id)
          .order('sort_order')
          .order('created_at'),
        client.from('expense_items').select('*').eq('expense_id', id).order('sort_order'),
        client.from('expense_participants').select('*').eq('expense_id', id).order('sort_order'),
        client
          .from('item_allocations')
          .select('*, expense_items!inner(expense_id)')
          .eq('expense_items.expense_id', id),
        client.from('expense_contributions').select('*').eq('expense_id', id).order('sort_order'),
        client
          .from('claims')
          .select(
            '*, debtor:expense_participants!claims_debtor_participant_id_fkey(id,user_id,display_name,avatar_path), creditor:expense_participants!claims_creditor_participant_id_fkey(id,user_id,display_name,avatar_path), expense:expenses!claims_expense_id_fkey(id,title,merchant_name,occurred_at,currency), disputes:claim_disputes(reason,message,status,created_at), events:claim_events(event_type,created_at,metadata)',
          )
          .eq('expense_id', id)
          .order('created_at'),
      ]);
    return {
      ...(unwrap(expense) as Expense),
      receipts: unwrap(receipts) as ExpenseReceipt[],
      items: unwrap(items) as ExpenseItem[],
      participants: unwrap(participants) as Participant[],
      allocations: unwrap(allocations) as ItemAllocation[],
      contributions: unwrap(contributions) as ExpenseContribution[],
      claims: unwrap(claims) as Claim[],
    };
  },
  async createExpense(
    userId: string,
    input: {
      title: string;
      merchantName?: string;
      totalCents: number;
      currency: string;
      notes?: string;
      groupId?: string;
    },
  ): Promise<Expense> {
    const result = await getSupabase()
      .from('expenses')
      .insert({
        created_by: userId,
        group_id: input.groupId || null,
        title: input.title,
        merchant_name: input.merchantName || null,
        occurred_at: new Date().toISOString(),
        currency: input.currency,
        total_cents: input.totalCents,
        recoverable_cents: 0,
        own_share_cents: input.totalCents,
        status: 'draft',
        scan_status: 'idle',
        notes: input.notes || null,
      })
      .select()
      .single();
    return unwrap(result) as Expense;
  },
  async updateExpense(id: string, input: Partial<Expense>): Promise<Expense> {
    const result = await getSupabase()
      .from('expenses')
      .update(input)
      .eq('id', id)
      .select()
      .single();
    return unwrap(result) as Expense;
  },
  async archiveExpense(id: string): Promise<{ expenseId: string; archivedAt: string }> {
    const result = await getSupabase().rpc('archive_expense', { p_expense_id: id });
    return unwrap(result) as { expenseId: string; archivedAt: string };
  },
  async addItem(
    expenseId: string,
    input: {
      name: string;
      lineTotalCents: number;
      quantity?: number;
      source?: string;
      category?: string | null;
    },
    sortOrder: number,
  ): Promise<ExpenseItem> {
    const result = await getSupabase()
      .from('expense_items')
      .insert({
        expense_id: expenseId,
        name: input.name,
        quantity: input.quantity ?? 1,
        unit_price_cents:
          input.quantity &&
          Number.isSafeInteger(input.quantity) &&
          input.quantity > 0 &&
          input.lineTotalCents % input.quantity === 0
            ? input.lineTotalCents / input.quantity
            : null,
        line_total_cents: input.lineTotalCents,
        category: input.category ?? null,
        sort_order: sortOrder,
        source: input.source ?? 'manual',
      })
      .select()
      .single();
    return unwrap(result) as ExpenseItem;
  },
  async updateItem(id: string, input: Partial<ExpenseItem>): Promise<ExpenseItem> {
    const result = await getSupabase()
      .from('expense_items')
      .update(input)
      .eq('id', id)
      .select()
      .single();
    return unwrap(result) as ExpenseItem;
  },
  async submitAnonymousOcrCorrection(itemId: string, correctedText: string): Promise<boolean> {
    const { data, error } = await getSupabase().rpc('submit_anonymous_ocr_correction', {
      p_item_id: itemId,
      p_corrected_text: correctedText,
    });
    if (error) throw new AppError(error.code, error.message);
    return data === true;
  },
  async deleteItem(id: string): Promise<void> {
    const { error } = await getSupabase().from('expense_items').delete().eq('id', id);
    if (error) throw new AppError(error.code, error.message);
  },
  async addParticipant(
    expenseId: string,
    input: {
      displayName: string;
      userId?: string;
      email?: string;
      phoneE164?: string;
      avatarPath?: string;
      isPayer?: boolean;
    },
    sortOrder: number,
  ): Promise<Participant> {
    const result = await getSupabase()
      .from('expense_participants')
      .insert({
        expense_id: expenseId,
        user_id: input.userId ?? null,
        display_name: input.displayName,
        email: input.email ?? null,
        phone_e164: input.phoneE164 ?? null,
        avatar_path: input.avatarPath ?? null,
        is_payer: input.isPayer ?? false,
        sort_order: sortOrder,
      })
      .select()
      .single();
    return unwrap(result) as Participant;
  },
  async listRecentPeople(userId: string): Promise<PersonSuggestion[]> {
    const { data, error } = await getSupabase()
      .from('expense_participants')
      .select(
        'id,user_id,display_name,avatar_path,email,phone_e164, expense:expenses!inner(id,created_by,occurred_at)',
      )
      .eq('expense.created_by', userId)
      .neq('user_id', userId)
      .order('occurred_at', { referencedTable: 'expenses', ascending: false })
      .limit(120);
    if (error) throw new AppError(error.code, error.message);
    return (data ?? []).map((row) => {
      const expense = Array.isArray(row.expense) ? row.expense[0] : row.expense;
      return {
        id: row.id,
        displayName: row.display_name,
        userId: row.user_id,
        email: row.email,
        phoneE164: row.phone_e164,
        avatarPath: row.avatar_path,
        lastSeenAt:
          expense && typeof expense === 'object' && 'occurred_at' in expense
            ? String(expense.occurred_at)
            : null,
        sources: ['recent'] as const,
      };
    });
  },
  async deleteParticipant(id: string): Promise<void> {
    const { error } = await getSupabase().from('expense_participants').delete().eq('id', id);
    if (error) throw new AppError(error.code, error.message);
  },
  async replaceAllocations(
    itemId: string,
    values: Omit<ItemAllocation, 'id' | 'item_id'>[],
  ): Promise<void> {
    const client = getSupabase();
    const removed = await client.from('item_allocations').delete().eq('item_id', itemId);
    if (removed.error) throw new AppError(removed.error.code, removed.error.message);
    if (!values.length) return;
    const inserted = await client
      .from('item_allocations')
      .insert(values.map((value) => ({ ...value, item_id: itemId })));
    if (inserted.error) throw new AppError(inserted.error.code, inserted.error.message);
  },
  async saveExpenseContributions(
    expenseId: string,
    contributions: {
      participantId: string;
      amountCents: number;
      method: ExpenseContribution['method'];
    }[],
  ): Promise<ExpenseContribution[]> {
    const result = await getSupabase().rpc('save_expense_contributions', {
      p_expense_id: expenseId,
      p_contributions: contributions,
    });
    return unwrap(result) as ExpenseContribution[];
  },
  async previewExpenseSettlements(expenseId: string): Promise<ExpenseSettlement[]> {
    const result = await getSupabase().rpc('preview_expense_settlements', {
      p_expense_id: expenseId,
    });
    return unwrap(result) as ExpenseSettlement[];
  },
  async startExpenseCollaboration(
    expenseId: string,
    locale: 'es' | 'en',
    expiresInHours = 24,
  ): Promise<StartedExpenseCollaboration> {
    return invoke<StartedExpenseCollaboration>('manage-expense-collaboration', {
      action: 'start',
      expenseId,
      locale,
      expiresInHours,
    });
  },
  async expenseCollaboration(expenseId: string): Promise<ExpenseCollaborationOwnerPayload> {
    return invoke<ExpenseCollaborationOwnerPayload>('manage-expense-collaboration', {
      action: 'get',
      expenseId,
    });
  },
  async applyExpenseCollaboration(sessionId: string): Promise<AppliedExpenseCollaboration> {
    return invoke<AppliedExpenseCollaboration>('manage-expense-collaboration', {
      action: 'apply',
      sessionId,
    });
  },
  async revokeExpenseCollaboration(sessionId: string): Promise<void> {
    await invoke<{ sessionId: string; status: 'revoked' }>('manage-expense-collaboration', {
      action: 'revoke',
      sessionId,
    });
  },
  async publicExpenseCollaboration(token: string): Promise<PublicExpenseCollaboration> {
    return invoke<PublicExpenseCollaboration>('get-public-expense-collaboration', { token });
  },
  async submitExpenseCollaboration(
    token: string,
    displayName: string,
    itemIds: string[],
  ): Promise<{ guestId: string; selectedCount: number }> {
    return invoke<{ guestId: string; selectedCount: number }>('submit-expense-collaboration', {
      token,
      displayName,
      itemIds,
    });
  },
  async listGroups(): Promise<Group[]> {
    const result = await getSupabase()
      .from('groups')
      .select('*')
      .is('archived_at', null)
      .order('updated_at', { ascending: false });
    return withGroupAvatarUrls(unwrap(result) as Group[]);
  },
  async createGroup(
    userId: string,
    input: { name: string; description?: string; type: string; currency: string },
  ): Promise<Group> {
    const result = await getSupabase()
      .from('groups')
      .insert({
        owner_id: userId,
        name: input.name,
        description: input.description || null,
        type: input.type,
        currency: input.currency,
      })
      .select()
      .single();
    return unwrap(result) as Group;
  },
  async group(id: string): Promise<{
    group: Group;
    members: GroupMember[];
    memberDebts: GroupMemberDebt[];
    expenses: Expense[];
  }> {
    const client = getSupabase();
    const [group, members, memberDebts, expenses] = await Promise.all([
      client.from('groups').select('*').eq('id', id).single(),
      client.from('group_members').select('*').eq('group_id', id).order('created_at'),
      client.rpc('get_group_member_debts', { p_group_id: id }),
      client
        .from('expenses')
        .select('*')
        .eq('group_id', id)
        .order('occurred_at', { ascending: false }),
    ]);
    return {
      group: await withGroupAvatarUrl(unwrap(group) as Group),
      members: unwrap(members) as GroupMember[],
      memberDebts: unwrap(memberDebts) as GroupMemberDebt[],
      expenses: unwrap(expenses) as Expense[],
    };
  },
  async groupStreak(groupId: string): Promise<GroupStreakCard> {
    const result = await getSupabase().rpc('get_group_streak', { p_group_id: groupId });
    return unwrap(result) as GroupStreakCard;
  },
  async uploadGroupAvatar(groupId: string, uri: string): Promise<Group> {
    const client = getSupabase();
    const current = unwrap(
      await client.from('groups').select('*').eq('id', groupId).single(),
    ) as Group;
    const bytes = await readImageBytes(uri, GROUP_AVATAR_MAX_BYTES);
    const path = `${groupId}/${Crypto.randomUUID()}.jpg`;
    const uploaded = await client.storage
      .from('group-avatars')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) throw new AppError('GROUP_AVATAR_UPLOAD_FAILED', uploaded.error.message);

    const updated = await client
      .from('groups')
      .update({ avatar_path: path })
      .eq('id', groupId)
      .select()
      .single();
    if (updated.error || !updated.data) {
      await client.storage.from('group-avatars').remove([path]);
      throw new AppError(
        updated.error?.code ?? 'GROUP_AVATAR_UPDATE_FAILED',
        updated.error?.message ?? 'No se ha podido guardar la foto del grupo.',
      );
    }

    if (current.avatar_path && current.avatar_path !== path) {
      await client.storage.from('group-avatars').remove([current.avatar_path]);
    }
    return withGroupAvatarUrl(updated.data as Group);
  },
  async removeGroupAvatar(groupId: string): Promise<Group> {
    const client = getSupabase();
    const current = unwrap(
      await client.from('groups').select('*').eq('id', groupId).single(),
    ) as Group;
    const updated = await client
      .from('groups')
      .update({ avatar_path: null })
      .eq('id', groupId)
      .select()
      .single();
    const group = unwrap(updated) as Group;
    if (current.avatar_path) {
      await client.storage.from('group-avatars').remove([current.avatar_path]);
    }
    return { ...group, avatar_url: null };
  },
  async uploadReceipt(userId: string, expenseId: string, uri: string): Promise<string> {
    let bytes: ArrayBuffer;
    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      if (!response.ok) throw new AppError('UPLOAD_READ_FAILED', 'No se ha podido leer la imagen.');
      bytes = await response.arrayBuffer();
    } else {
      const file = new File(uri);
      if (file.size > 10 * 1024 * 1024)
        throw new AppError('RECEIPT_TOO_LARGE', 'La imagen supera el límite de 10 MB.');
      bytes = await file.arrayBuffer();
    }
    if (bytes.byteLength > 10 * 1024 * 1024)
      throw new AppError('RECEIPT_TOO_LARGE', 'La imagen supera el límite de 10 MB.');
    const path = `${userId}/${expenseId}/${Crypto.randomUUID()}.jpg`;
    const { error } = await getSupabase()
      .storage.from('receipts')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new AppError('UPLOAD_FAILED', error.message);
    await repository.updateExpense(expenseId, { receipt_path: path, scan_status: 'processing' });
    return path;
  },
  async uploadExpenseReceipt(
    userId: string,
    expenseId: string,
    uri: string,
    originalName?: string | null,
  ): Promise<ExpenseReceipt> {
    let bytes: ArrayBuffer;
    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      if (!response.ok) throw new AppError('UPLOAD_READ_FAILED', 'No se ha podido leer la imagen.');
      bytes = await response.arrayBuffer();
    } else {
      const file = new File(uri);
      if (file.size > 10 * 1024 * 1024)
        throw new AppError('RECEIPT_TOO_LARGE', 'La imagen supera el límite de 10 MB.');
      bytes = await file.arrayBuffer();
    }
    if (bytes.byteLength > 10 * 1024 * 1024)
      throw new AppError('RECEIPT_TOO_LARGE', 'La imagen supera el límite de 10 MB.');

    const client = getSupabase();
    const path = `${userId}/${expenseId}/${Crypto.randomUUID()}.jpg`;
    const previous = await client
      .from('expense_receipts')
      .select('sort_order')
      .eq('expense_id', expenseId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previous.error) throw new AppError(previous.error.code, previous.error.message);
    const sortOrder = Number(previous.data?.sort_order ?? -1) + 1;
    const uploaded = await client.storage
      .from('receipts')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) throw new AppError('UPLOAD_FAILED', uploaded.error.message);
    const inserted = await client
      .from('expense_receipts')
      .insert({
        expense_id: expenseId,
        storage_path: path,
        mime_type: 'image/jpeg',
        original_name: originalName?.trim() || null,
        sort_order: sortOrder,
        status: 'queued',
      })
      .select()
      .single();
    if (inserted.error) {
      await client.storage.from('receipts').remove([path]);
      throw new AppError(inserted.error.code, inserted.error.message);
    }
    return inserted.data as ExpenseReceipt;
  },
  async updateExpenseReceipt(
    receiptId: string,
    input: Partial<
      Pick<
        ExpenseReceipt,
        'status' | 'scan_job_id' | 'merchant_name' | 'total_cents' | 'confidence' | 'error_code'
      >
    >,
  ): Promise<ExpenseReceipt> {
    const result = await getSupabase()
      .from('expense_receipts')
      .update(input)
      .eq('id', receiptId)
      .select()
      .single();
    return unwrap(result) as ExpenseReceipt;
  },
  async removeExpenseReceipt(receiptId: string): Promise<void> {
    const client = getSupabase();
    const record = await client
      .from('expense_receipts')
      .select('storage_path')
      .eq('id', receiptId)
      .single();
    const receipt = unwrap(record) as Pick<ExpenseReceipt, 'storage_path'>;
    const removedRow = await client.from('expense_receipts').delete().eq('id', receiptId);
    if (removedRow.error) throw new AppError(removedRow.error.code, removedRow.error.message);
    await client.storage.from('receipts').remove([receipt.storage_path]);
  },
  scanReceipt(
    expenseId: string,
    receiptPath?: string,
    options?: { persistResult?: boolean; locale?: string; currencyHint?: string },
  ) {
    return invoke<
      ReceiptScanResult & {
        jobId: string;
        provider: string;
        status: 'completed';
      }
    >('scan-receipt', {
      expenseId,
      receiptPath,
      persistResult: options?.persistResult,
      locale: options?.locale,
      currencyHint: options?.currencyHint,
    });
  },
  async applyMultiReceiptResult(
    expenseId: string,
    receiptIds: string[],
    result: CombinedReceiptResult,
  ): Promise<void> {
    const applied = await getSupabase().rpc('apply_multi_receipt_result', {
      p_expense_id: expenseId,
      p_receipt_ids: receiptIds,
      p_result: result,
    });
    if (applied.error) throw new AppError(applied.error.code, applied.error.message);
  },
  async latestReceiptScan(expenseId: string): Promise<{
    provider: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    confidence: number | null;
    warnings: unknown[];
    error_code: string | null;
    completed_at: string | null;
  } | null> {
    const { data, error } = await getSupabase()
      .from('receipt_scan_jobs')
      .select('provider,status,confidence,warnings,error_code,completed_at')
      .eq('expense_id', expenseId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new AppError(error.code, error.message);
    return data as {
      provider: string;
      status: 'queued' | 'processing' | 'completed' | 'failed';
      confidence: number | null;
      warnings: unknown[];
      error_code: string | null;
      completed_at: string | null;
    } | null;
  },
  createClaimLinks(
    expenseId: string,
  ): Promise<{ claims: ClaimLink[]; status?: 'sent' | 'settled' }> {
    return invoke('create-claim-links', { expenseId });
  },
  async publicClaim(token: string): Promise<PublicClaim> {
    return sanitizePublicClaimResponseDto(await invoke<unknown>('get-public-claim', { token }));
  },
  disputeClaim(
    token: string,
    reason: 'did_not_consume' | 'incorrect_amount' | 'already_paid' | 'unknown_expense' | 'other',
    message?: string,
  ) {
    return invoke<{ status: 'disputed'; createdAt: string }>('dispute-claim', {
      token,
      reason,
      message,
    });
  },
  markClaimReceived(claimId: string) {
    return invoke<{ claimId: string; status: 'received'; receivedAt: string }>(
      'mark-claim-received',
      { claimId },
    );
  },
  resolveDispute(claimId: string, outcome: 'reopen' | 'cancel', resolutionNote?: string) {
    return invoke<{
      claimId: string;
      disputeId: string;
      status: 'pending' | 'reminder_sent' | 'cancelled';
      disputeStatus: 'resolved' | 'dismissed';
      resolvedAt: string;
    }>('resolve-dispute', { claimId, outcome, resolutionNote });
  },
  async previewReminder(claimId: string): Promise<ReminderPreview> {
    const result = await getSupabase().rpc('preview_claim_reminder', { p_claim_id: claimId });
    return unwrap(result) as ReminderPreview;
  },
  sendReminder(claimId: string, bankChecked: true) {
    return invoke<{
      claimId: string;
      claimIds: string[];
      reminderCount: number;
      message: string;
      shareUrl: string;
      shareUrls: string[];
      grouped: boolean;
      preparedAt: string;
    }>('send-reminder', { claimId, bankChecked });
  },
  requestPaymentCheck(claimId: string) {
    return invoke<{
      claimId: string;
      expenseId: string;
      requestedAt: string;
      nextAllowedAt: string;
      push: { sent: number; failed: number };
    }>('request-payment-check', { claimId });
  },
  revokeClaim(claimId: string) {
    return invoke<{ claimId: string; status: 'cancelled'; cancelledAt: string }>('revoke-claim', {
      claimId,
    });
  },
  regenerateClaimLink(claimId: string, expiresInDays = 30) {
    return invoke<{ claimId: string; expiresAt: string; url: string }>('regenerate-claim-link', {
      claimId,
      expiresInDays,
    });
  },
  async claimLinkActivity(claimId: string) {
    const result = await getSupabase().rpc('get_claim_link_activity', {
      p_claim_id: claimId,
    });
    return unwrap(result) as ClaimLinkActivity;
  },
  async acceptInvite(token: string) {
    return invoke<{ groupId: string }>('accept-invite', { token });
  },
  createGroupInvite(groupId: string, invitedEmail?: string) {
    return invoke<{ inviteId: string; expiresAt: string; url: string }>('create-group-invite', {
      groupId,
      invitedEmail: invitedEmail?.trim() || undefined,
      expiresInDays: 14,
    });
  },
  async receiptUrl(path: string): Promise<string> {
    const { data, error } = await getSupabase().storage.from('receipts').createSignedUrl(path, 300);
    if (error) throw new AppError('RECEIPT_URL_FAILED', error.message);
    return data.signedUrl;
  },
  async reputation(userId: string): Promise<ReputationCard> {
    const result = await getSupabase().rpc('get_reputation_card', { p_user_id: userId });
    return unwrap(result) as ReputationCard;
  },
  async reputations(userIds: string[]): Promise<Record<string, ReputationCard>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return {};
    const result = await getSupabase().rpc('get_reputation_cards', { p_user_ids: unique });
    return unwrap(result) as Record<string, ReputationCard>;
  },
  async savePushToken(input: {
    userId: string;
    token: string;
    platform: string;
    deviceName?: string;
  }): Promise<void> {
    const { error } = await getSupabase()
      .from('push_tokens')
      .upsert(
        {
          user_id: input.userId,
          token: input.token,
          platform: input.platform,
          device_name: input.deviceName || null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'token' },
      );
    if (error) throw new AppError(error.code, error.message);
  },
  async deletePushToken(token: string): Promise<void> {
    const { error } = await getSupabase().from('push_tokens').delete().eq('token', token);
    if (error) throw new AppError(error.code, error.message);
  },
  async deletePushTokens(userId: string): Promise<void> {
    const { error } = await getSupabase().from('push_tokens').delete().eq('user_id', userId);
    if (error) throw new AppError(error.code, error.message);
  },
  deleteAccount() {
    return invoke<{ deleted: true }>('delete-account', { confirmation: 'ELIMINAR' });
  },
  claimUrl(token: string) {
    return `${appUrl}/c/${encodeURIComponent(token)}`;
  },
};
