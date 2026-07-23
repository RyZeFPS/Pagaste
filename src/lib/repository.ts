import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { appUrl, getSupabase } from '@/lib/supabase/client';
import { AppError } from '@/lib/api-error';
import { sanitizePublicClaimDto } from '@/domain/public-claims';
import type {
  Claim,
  ClaimLink,
  Expense,
  ExpenseDetail,
  ExpenseItem,
  Group,
  GroupMember,
  GroupStreakCard,
  ItemAllocation,
  Participant,
  Profile,
  PublicClaim,
  ReputationCard,
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

async function invoke<T>(name: string, body: object): Promise<T> {
  const result = await getSupabase().functions.invoke<EdgeEnvelope<T>>(name, { body });
  if (result.error) throw new AppError('FUNCTION_ERROR', result.error.message);
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
  async uploadProfileAvatar(userId: string, uri: string): Promise<Profile> {
    const client = getSupabase();
    const current = unwrap(
      await client.from('profiles').select('*').eq('id', userId).single(),
    ) as Profile;
    const bytes = await readImageBytes(uri, PROFILE_AVATAR_MAX_BYTES);
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
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
        '*, debtor:expense_participants!claims_debtor_participant_id_fkey(id,user_id,display_name,avatar_path), expense:expenses!claims_expense_id_fkey(id,title,merchant_name,occurred_at,currency)',
      )
      .order('created_at', { ascending: false });
    if (expenseId) query = query.eq('expense_id', expenseId);
    const result = await query.limit(100);
    return unwrap(result) as Claim[];
  },
  async expense(id: string): Promise<ExpenseDetail> {
    const client = getSupabase();
    const [expense, items, participants, allocations, claims] = await Promise.all([
      client.from('expenses').select('*').eq('id', id).single(),
      client.from('expense_items').select('*').eq('expense_id', id).order('sort_order'),
      client.from('expense_participants').select('*').eq('expense_id', id).order('sort_order'),
      client
        .from('item_allocations')
        .select('*, expense_items!inner(expense_id)')
        .eq('expense_items.expense_id', id),
      client
        .from('claims')
        .select(
          '*, debtor:expense_participants!claims_debtor_participant_id_fkey(id,user_id,display_name,avatar_path), expense:expenses!claims_expense_id_fkey(id,title,merchant_name,occurred_at,currency), disputes:claim_disputes(reason,message,status,created_at)',
        )
        .eq('expense_id', id)
        .order('created_at'),
    ]);
    return {
      ...(unwrap(expense) as Expense),
      items: unwrap(items) as ExpenseItem[],
      participants: unwrap(participants) as Participant[],
      allocations: unwrap(allocations) as ItemAllocation[],
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
    input: { name: string; lineTotalCents: number; quantity?: number; source?: string },
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
  async deleteItem(id: string): Promise<void> {
    const { error } = await getSupabase().from('expense_items').delete().eq('id', id);
    if (error) throw new AppError(error.code, error.message);
  },
  async addParticipant(
    expenseId: string,
    input: { displayName: string; userId?: string; isPayer?: boolean },
    sortOrder: number,
  ): Promise<Participant> {
    const result = await getSupabase()
      .from('expense_participants')
      .insert({
        expense_id: expenseId,
        user_id: input.userId ?? null,
        display_name: input.displayName,
        is_payer: input.isPayer ?? false,
        sort_order: sortOrder,
      })
      .select()
      .single();
    return unwrap(result) as Participant;
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
  async group(id: string): Promise<{ group: Group; members: GroupMember[]; expenses: Expense[] }> {
    const client = getSupabase();
    const [group, members, expenses] = await Promise.all([
      client.from('groups').select('*').eq('id', id).single(),
      client.from('group_members').select('*').eq('group_id', id).order('created_at'),
      client
        .from('expenses')
        .select('*')
        .eq('group_id', id)
        .order('occurred_at', { ascending: false }),
    ]);
    return {
      group: await withGroupAvatarUrl(unwrap(group) as Group),
      members: unwrap(members) as GroupMember[],
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
    const path = `${groupId}/${crypto.randomUUID()}.jpg`;
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
    const path = `${userId}/${expenseId}/${crypto.randomUUID()}.jpg`;
    const { error } = await getSupabase()
      .storage.from('receipts')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new AppError('UPLOAD_FAILED', error.message);
    await repository.updateExpense(expenseId, { receipt_path: path, scan_status: 'processing' });
    return path;
  },
  scanReceipt(expenseId: string, receiptPath?: string) {
    return invoke<{
      jobId: string;
      provider: string;
      status: 'completed';
      confidence: number;
      warnings: string[];
      merchantName: string | null;
      currency: string;
      totalCents: number;
      items: {
        name: string;
        quantity: number;
        unitPriceCents: number | null;
        lineTotalCents: number;
        category: string | null;
        confidence: number;
      }[];
    }>('scan-receipt', { expenseId, receiptPath });
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
    claims: { debtorParticipantId: string; amountCents: number }[],
  ): Promise<{ claims: ClaimLink[] }> {
    return invoke('create-claim-links', { expenseId, claims });
  },
  async publicClaim(token: string): Promise<PublicClaim> {
    return sanitizePublicClaimDto(await invoke<unknown>('get-public-claim', { token }));
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
  sendReminder(claimId: string) {
    return invoke<{ claimId: string; reminderCount: number; message: string; shareUrl: string }>(
      'send-reminder',
      { claimId },
    );
  },
  revokeClaim(claimId: string) {
    return invoke<{ claimId: string; status: 'cancelled'; cancelledAt: string }>('revoke-claim', {
      claimId,
    });
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
