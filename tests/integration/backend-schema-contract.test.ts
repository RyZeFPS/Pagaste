import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../..');
const migrationsDirectory = join(projectRoot, 'supabase', 'migrations');
const migrationSql = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(migrationsDirectory, name), 'utf8'))
  .join('\n')
  .toLowerCase();
const receiptFlowMigrationSql = readFileSync(
  join(migrationsDirectory, '20260722191620_simplify_claim_receipt_flow.sql'),
  'utf8',
).toLowerCase();
const claimAmbiguityMigrationSql = readFileSync(
  join(migrationsDirectory, '20260724080931_fix_create_claims_amount_ambiguity.sql'),
  'utf8',
).toLowerCase();
const claimNotificationMigrationSql = readFileSync(
  join(migrationsDirectory, '20260724083014_fix_public_claim_and_notifications.sql'),
  'utf8',
).toLowerCase();
const notificationGrantMigrationSql = readFileSync(
  join(migrationsDirectory, '20260724085148_restrict_app_notification_updates.sql'),
  'utf8',
).toLowerCase();
const notificationCenterMigrationSql = readFileSync(
  join(migrationsDirectory, '20260724091337_notification_center_and_payment_check.sql'),
  'utf8',
).toLowerCase();
const receiptScanResultMigrationSql = readFileSync(
  join(migrationsDirectory, '20260724141537_fix_receipt_scan_result_ordinality.sql'),
  'utf8',
).toLowerCase();
const reminderPreferencesMigrationSql = readFileSync(
  join(migrationsDirectory, '20260724192918_configurable_reminders.sql'),
  'utf8',
).toLowerCase();
const multiPayerMigrationSql = readFileSync(
  join(migrationsDirectory, '20260724195625_multi_payer_contributions.sql'),
  'utf8',
).toLowerCase();
const claimLinkLifecycleMigrationSql = readFileSync(
  join(migrationsDirectory, '20260726130808_claim_link_lifecycle.sql'),
  'utf8',
).toLowerCase();
const multiPayerHardeningMigrationSql = readFileSync(
  join(migrationsDirectory, '20260726131349_multi_payer_hardening.sql'),
  'utf8',
).toLowerCase();
const anonymousOcrLearningMigrationSql = readFileSync(
  join(migrationsDirectory, '20260726133139_anonymous_ocr_correction_learning.sql'),
  'utf8',
).toLowerCase();
const debtOffsetMigrationSql = readFileSync(
  join(migrationsDirectory, '20260728155324_group_debt_offsets_and_public_progress.sql'),
  'utf8',
).toLowerCase();
const debtOffsetEntrypointMigrationSql = readFileSync(
  join(migrationsDirectory, '20260728161306_enforce_offset_claim_entrypoint.sql'),
  'utf8',
).toLowerCase();
const debtOffsetNotificationMigrationSql = readFileSync(
  join(migrationsDirectory, '20260728161957_remove_offset_claim_notifications.sql'),
  'utf8',
).toLowerCase();

const exposedTables = Array.from(
  migrationSql.matchAll(/create\s+table\s+public\.([a-z][a-z0-9_]*)/g),
  (match) => match[1],
);

describe('Supabase security contract', () => {
  it('enables RLS for every table in the exposed public schema', () => {
    expect(exposedTables.length).toBeGreaterThanOrEqual(10);
    expect(new Set(exposedTables).size).toBe(exposedTables.length);
    for (const table of exposedTables) {
      expect(migrationSql, `RLS missing for public.${table}`).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
    expect(migrationSql).not.toMatch(/disable\s+row\s+level\s+security/);
  });

  it('keeps receipt objects private and scoped through owner policies', () => {
    expect(migrationSql).toMatch(
      /values\s*\(\s*'receipts'\s*,\s*'receipts'\s*,\s*false\s*,\s*10485760/,
    );
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(migrationSql).toContain(`receipts_${operation}_owner`);
    }
    expect(migrationSql).toContain("bucket_id = 'receipts'");
    expect(migrationSql).toContain('private.receipt_object_owned(name)');
  });

  it('covers the composite foreign keys introduced by collaboration and multi-receipt flows', () => {
    expect(migrationSql).toContain('expense_collaboration_guests_participant_idx');
    expect(migrationSql).toMatch(
      /expense_items_receipt_expense_idx[\s\S]*?\(receipt_id, expense_id\)/,
    );
    expect(migrationSql).toMatch(
      /expense_receipts_scan_job_expense_idx[\s\S]*?\(scan_job_id, expense_id\)/,
    );
  });

  it('keeps group photos private, immutable and scoped to group membership', () => {
    expect(migrationSql).toMatch(
      /values\s*\(\s*'group-avatars'\s*,\s*'group-avatars'\s*,\s*false\s*,\s*2097152/,
    );
    expect(migrationSql).toContain("array['image/jpeg']");
    expect(migrationSql).toContain('group_avatars_select_members');
    expect(migrationSql).toContain('group_avatars_insert_owner');
    expect(migrationSql).toContain('group_avatars_delete_owner');
    expect(migrationSql).not.toContain('group_avatars_update_owner');
    expect(migrationSql).toContain('private.group_avatar_object_visible(name)');
    expect(migrationSql).toContain('private.group_avatar_object_owned(name)');
    expect(migrationSql).toContain('groups_avatar_path_shape');
  });

  it('lets active members read the complete member list only for their groups', () => {
    expect(migrationSql).toContain('group_members_select_group_members');
    expect(migrationSql).toContain('using (private.is_group_member(group_id))');
    expect(migrationSql).toMatch(
      /private\.is_group_member\(p_group_id uuid\)[\s\S]*?\(select auth\.uid\(\)\) is not null/,
    );
    expect(migrationSql).toMatch(
      /revoke all on function private\.is_group_member\(uuid\)[\s\S]*?from public, anon, authenticated/,
    );
  });

  it('keeps profile photos private, immutable and synchronized with social rows', () => {
    expect(migrationSql).toMatch(
      /values\s*\(\s*'profile-avatars'\s*,\s*'profile-avatars'\s*,\s*false\s*,\s*2097152/,
    );
    expect(migrationSql).toContain('profile_avatars_select_related');
    expect(migrationSql).toContain('profile_avatars_insert_owner');
    expect(migrationSql).toContain('profile_avatars_delete_owner');
    expect(migrationSql).not.toContain('profile_avatars_update_owner');
    expect(migrationSql).toContain('private.profile_avatar_object_visible(name)');
    expect(migrationSql).toContain('private.profile_avatar_object_owned(name)');
    expect(migrationSql).toContain('profiles_avatar_path_shape');
    expect(migrationSql).toContain('profiles_sync_linked_identity');
    expect(migrationSql).toContain('group_members_hydrate_linked_identity');
    expect(migrationSql).toContain('expense_participants_hydrate_linked_identity');
  });

  it('derives reputation only from receiver-recorded receipt timestamps', () => {
    expect(receiptFlowMigrationSql).toContain('received_at timestamptz');
    expect(receiptFlowMigrationSql).toContain('received_by_user_id uuid');
    expect(receiptFlowMigrationSql).toContain(
      'create or replace function private.get_reputation_card',
    );
    expect(receiptFlowMigrationSql).toContain("c.status = 'received'");
    expect(receiptFlowMigrationSql).toContain(
      "c.received_at <= c.reputation_started_at + interval '24 hours'",
    );
    expect(receiptFlowMigrationSql).toContain("'measurement', 'receiver_confirmation'");
    expect(receiptFlowMigrationSql).toContain('drop column if exists marked_paid_at');
    expect(receiptFlowMigrationSql).toContain('drop column if exists reputation_verified_at');
    expect(receiptFlowMigrationSql).toMatch(
      /grant execute on function public\.get_reputation_card\(uuid\)\s+to authenticated/,
    );
    expect(receiptFlowMigrationSql).toMatch(
      /grant execute on function public\.mark_claim_received\(uuid, uuid\)\s+to service_role/,
    );
  });

  it('qualifies table-returning claim amounts to avoid PL/pgSQL ambiguity', () => {
    expect(claimAmbiguityMigrationSql).toContain(
      'coalesce((select sum(calculated.amount_cents) from calculated), 0)',
    );
    expect(claimAmbiguityMigrationSql).not.toContain(
      'coalesce((select sum(amount_cents) from calculated), 0)',
    );
  });

  it('keeps the public claim payload aligned with the client allow-list', () => {
    for (const key of [
      'creditorDisplayName',
      'creditorAvatarUrl',
      'creditorPhoneE164',
      'expenseTitle',
      'amountCents',
    ]) {
      expect(claimNotificationMigrationSql).toContain(`'${key.toLowerCase()}'`);
    }
    expect(claimNotificationMigrationSql).not.toContain("'payerdisplayname'");
    expect(claimNotificationMigrationSql).not.toContain("'paymentphonee164'");
  });

  it('isolates durable claim notifications and publishes inserts in realtime', () => {
    expect(claimNotificationMigrationSql).toContain('create table public.app_notifications');
    expect(claimNotificationMigrationSql).toContain(
      'alter table public.app_notifications enable row level security',
    );
    expect(claimNotificationMigrationSql).toContain('app_notifications_select_own');
    expect(claimNotificationMigrationSql).toContain('app_notifications_update_own');
    expect(claimNotificationMigrationSql).toContain('private.create_claim_requested_notification');
    expect(claimNotificationMigrationSql).toContain(
      'alter publication supabase_realtime add table public.app_notifications',
    );
    expect(notificationGrantMigrationSql).toContain(
      'grant update (read_at) on table public.app_notifications to authenticated',
    );
    expect(notificationGrantMigrationSql).toContain(
      'revoke update on table public.app_notifications from authenticated',
    );
  });

  it('keeps payment-check requests notification-only and rate-limited', () => {
    expect(notificationCenterMigrationSql).toContain("'payment_check_requested'");
    expect(notificationCenterMigrationSql).toContain("interval '10 minutes'");
    expect(notificationCenterMigrationSql).toContain("interval '24 hours'");
    expect(notificationCenterMigrationSql).toContain("'claim_status_unchanged', true");
    expect(notificationCenterMigrationSql).toContain(
      'grant execute on function public.request_claim_payment_check(uuid, uuid)',
    );
    expect(notificationCenterMigrationSql).toContain('to service_role');
    expect(notificationCenterMigrationSql).not.toMatch(
      /update\s+public\.claims[\s\S]*?set\s+status/u,
    );
  });

  it('keeps scheduled reminders manual, private and bank-review gated', () => {
    expect(reminderPreferencesMigrationSql).toContain('create table public.reminder_preferences');
    expect(reminderPreferencesMigrationSql).toContain(
      'alter table public.reminder_preferences enable row level security',
    );
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(reminderPreferencesMigrationSql).toContain(`reminder_preferences_${operation}_own`);
    }
    expect(reminderPreferencesMigrationSql).toContain('first_delay_hours in (24, 48, 72)');
    expect(reminderPreferencesMigrationSql).toContain(
      "message_tone in ('soft', 'neutral', 'direct')",
    );
    expect(reminderPreferencesMigrationSql).toContain('p_bank_checked is distinct from true');
    expect(reminderPreferencesMigrationSql).toContain("message = 'bank_review_required'");
    expect(reminderPreferencesMigrationSql).toContain('v_seed.reminder_count >= 2');
    expect(reminderPreferencesMigrationSql).toContain('private.is_quiet_time');
    expect(reminderPreferencesMigrationSql).toContain('group_same_debtor');
    expect(reminderPreferencesMigrationSql).toMatch(
      /grant execute on function public\.preview_claim_reminder\(uuid\) to authenticated/,
    );
    expect(reminderPreferencesMigrationSql).toMatch(
      /grant execute on function public\.prepare_claim_reminder_batch\(jsonb, boolean\) to authenticated/,
    );
    expect(reminderPreferencesMigrationSql).toMatch(
      /revoke all on function public\.prepare_claim_reminder\(uuid, text\)[\s\S]*?from public, anon, authenticated, service_role/,
    );
  });

  it('keeps multi-payer contributions transactional, unique and readable with the expense', () => {
    expect(multiPayerMigrationSql).toContain('create table public.expense_contributions');
    expect(multiPayerMigrationSql).toContain(
      'constraint expense_contributions_one_row_per_participant',
    );
    expect(multiPayerMigrationSql).toContain(
      'alter table public.expense_contributions enable row level security',
    );
    expect(multiPayerMigrationSql).toContain(
      'using ((select private.can_read_expense(expense_id)))',
    );
    expect(multiPayerMigrationSql).toContain('duplicate_contributor');
    expect(multiPayerMigrationSql).toContain('participant.user_id is null');
    expect(multiPayerMigrationSql).toContain(
      'create unique index expense_participants_expense_user_unique',
    );
    expect(multiPayerMigrationSql).toContain(
      'create or replace function private.validate_expense_ledger_relationship',
    );
    expect(multiPayerMigrationSql).toContain("'claim_participant_mismatch'");
    expect(multiPayerMigrationSql).toMatch(
      /revoke all on function public\.save_expense_contributions\(uuid, jsonb\)[\s\S]*?from public, anon, authenticated, service_role/,
    );
    expect(multiPayerMigrationSql).toMatch(
      /grant execute on function public\.save_expense_contributions\(uuid, jsonb\)[\s\S]*?to authenticated/,
    );
  });

  it('nets reverse group debts transactionally and keeps an auditable offset ledger', () => {
    expect(debtOffsetMigrationSql).toContain('create table public.claim_offsets');
    expect(debtOffsetMigrationSql).toContain(
      'alter table public.claim_offsets enable row level security',
    );
    expect(debtOffsetMigrationSql).toContain('claim_offsets_select_group_members');
    expect(debtOffsetMigrationSql).toContain('original_amount_cents');
    expect(debtOffsetMigrationSql).toContain('pg_advisory_xact_lock');
    expect(debtOffsetMigrationSql).toContain('private.apply_group_debt_offsets');
    expect(debtOffsetMigrationSql).toContain("'debt_offset'");
    expect(debtOffsetMigrationSql).toMatch(
      /create function public\.create_claims_with_offsets_transaction[\s\S]*?public\.create_claims_transaction[\s\S]*?private\.apply_group_debt_offsets/,
    );
    expect(debtOffsetMigrationSql).toMatch(
      /grant execute on function public\.create_claims_with_offsets_transaction\(uuid, jsonb\)[\s\S]*?to authenticated/,
    );
    expect(debtOffsetEntrypointMigrationSql).toMatch(
      /revoke execute on function public\.create_claims_transaction\(uuid, jsonb\)[\s\S]*?from authenticated/,
    );
  });

  it('removes stale notifications when debt offsets fully close a claim', () => {
    expect(debtOffsetNotificationMigrationSql).toContain(
      'create or replace function private.remove_fully_offset_claim_notification',
    );
    expect(debtOffsetNotificationMigrationSql).toContain(
      "when (new.event_type = 'debt_offset')",
    );
    expect(debtOffsetNotificationMigrationSql).toContain("claim.status = 'cancelled'");
    expect(debtOffsetNotificationMigrationSql).toContain(
      "notification.kind = 'claim_requested'",
    );
    expect(debtOffsetNotificationMigrationSql).toMatch(
      /revoke all on function private\.remove_fully_offset_claim_notification\(\)[\s\S]*?from public, anon, authenticated, service_role/,
    );
  });

  it('limits group debt totals to members and public progress to the service role', () => {
    expect(debtOffsetMigrationSql).toContain('create function public.get_group_member_debts');
    expect(debtOffsetMigrationSql).toContain('not private.is_group_member(p_group_id)');
    expect(debtOffsetMigrationSql).toContain(
      "claim.status in ('pending', 'reminder_sent', 'disputed')",
    );
    expect(debtOffsetMigrationSql).toMatch(
      /grant execute on function public\.get_group_member_debts\(uuid\)[\s\S]*?to authenticated/,
    );
    expect(debtOffsetMigrationSql).toContain(
      'create function public.get_public_claim_payment_progress',
    );
    expect(debtOffsetMigrationSql).toMatch(
      /revoke all on function public\.get_public_claim_payment_progress\(text\)[\s\S]*?from public, anon, authenticated, service_role/,
    );
    expect(debtOffsetMigrationSql).toMatch(
      /grant execute on function public\.get_public_claim_payment_progress\(text\)[\s\S]*?to service_role/,
    );
  });

  it('makes public claim links expiring, rotatable, revocable and auditable', () => {
    expect(claimLinkLifecycleMigrationSql).toContain('public_link_expires_at timestamptz');
    expect(claimLinkLifecycleMigrationSql).toContain(
      'create table if not exists private.claim_link_accesses',
    );
    expect(claimLinkLifecycleMigrationSql).toContain(
      'create or replace function public.revoke_claim_link',
    );
    expect(claimLinkLifecycleMigrationSql).toContain(
      'create or replace function public.rotate_claim_link',
    );
    expect(claimLinkLifecycleMigrationSql).toContain(
      'create or replace function public.get_claim_link_activity',
    );
    expect(claimLinkLifecycleMigrationSql).toContain('c.public_link_expires_at > now()');
    expect(claimLinkLifecycleMigrationSql).toContain("'claim_link_regenerated'");
    expect(claimLinkLifecycleMigrationSql).toContain("'claim_link_revoked'");
    expect(claimLinkLifecycleMigrationSql).toContain("now() - interval '5 minutes'");
    expect(claimLinkLifecycleMigrationSql).toMatch(
      /grant execute on function public\.get_public_claim_payload\(text\)[\s\S]*?to service_role/,
    );
    expect(claimLinkLifecycleMigrationSql).not.toMatch(
      /grant execute on function public\.get_public_claim_payload\(text\)[\s\S]*?to anon/,
    );
  });

  it('repeats contribution templates and closes already-balanced expenses without claims', () => {
    expect(multiPayerHardeningMigrationSql).toContain(
      'create or replace function private.rescale_draft_expense_contributions',
    );
    expect(multiPayerHardeningMigrationSql).toContain('alter function public.repeat_expense(uuid)');
    expect(multiPayerHardeningMigrationSql).toContain(
      'public.repeat_expense_without_contributions',
    );
    expect(multiPayerHardeningMigrationSql).toContain('public.save_expense_contributions');
    expect(multiPayerHardeningMigrationSql).toContain(
      "v_participant_map := coalesce(v_result -> 'participantmap'",
    );
    expect(multiPayerHardeningMigrationSql).not.toContain('participant_position');
    expect(multiPayerHardeningMigrationSql).toContain(
      'create function public.settle_balanced_expense',
    );
    expect(multiPayerHardeningMigrationSql).toMatch(
      /grant execute on function public\.settle_balanced_expense\(uuid\)[\s\S]*?to authenticated/,
    );
  });

  it('keeps OCR correction learning optional, anonymous and service-gated', () => {
    expect(anonymousOcrLearningMigrationSql).toContain(
      'ocr_learning_consent boolean not null default false',
    );
    expect(anonymousOcrLearningMigrationSql).toContain(
      'create table private.ocr_correction_patterns',
    );
    for (const identifier of ['user_id', 'profile_id', 'expense_id', 'receipt_id', 'merchant_id']) {
      expect(
        anonymousOcrLearningMigrationSql.match(
          /create table private\.ocr_correction_patterns[\s\S]*?\);/,
        )?.[0],
      ).not.toContain(identifier);
    }
    expect(anonymousOcrLearningMigrationSql).toContain('profile.ocr_learning_consent');
    expect(anonymousOcrLearningMigrationSql).toContain('ranked.correction_count >= 3');
    expect(anonymousOcrLearningMigrationSql).toContain(
      'ranked.correction_count * 5 >= ranked.total_count * 4',
    );
    expect(anonymousOcrLearningMigrationSql).toContain('for update of item');
    expect(anonymousOcrLearningMigrationSql).toMatch(
      /update public\.expense_items[\s\S]*?source = 'manual'[\s\S]*?ocr_confidence = null/u,
    );
    expect(anonymousOcrLearningMigrationSql).toMatch(
      /grant execute on function public\.submit_anonymous_ocr_correction\(uuid, text\)[\s\S]*?to authenticated/,
    );
    expect(anonymousOcrLearningMigrationSql).toMatch(
      /grant execute on function public\.suggest_anonymous_ocr_corrections\(text\[\]\)[\s\S]*?to service_role/,
    );
  });

  it('persists ordered OCR products through a service-only invoker RPC', () => {
    expect(receiptScanResultMigrationSql).toContain(
      'from jsonb_array_elements(v_items) with ordinality as item(value, ordinality)',
    );
    expect(receiptScanResultMigrationSql).not.toContain('jsonb_to_recordset');
    expect(receiptScanResultMigrationSql).toContain('security invoker');
    expect(receiptScanResultMigrationSql).toMatch(
      /revoke execute on function public\.apply_receipt_scan_result\(uuid, uuid, jsonb\)[\s\S]*?from public, anon, authenticated/,
    );
    expect(receiptScanResultMigrationSql).toMatch(
      /grant execute on function public\.apply_receipt_scan_result\(uuid, uuid, jsonb\)[\s\S]*?to service_role/,
    );
  });

  it('keeps 24-hour streaks at group level and publishes live finance changes', () => {
    expect(migrationSql).toContain('create function public.get_group_streak');
    expect(migrationSql).toContain('private.is_group_member(p_group_id)');
    expect(receiptFlowMigrationSql).toContain(
      "received_at <= reputation_started_at + interval '24 hours'",
    );
    expect(receiptFlowMigrationSql).toMatch(
      /grant execute on function public\.get_group_streak\(uuid\)\s+to authenticated/,
    );
    expect(migrationSql).toContain("array['expenses', 'claims', 'claim_events']");
    expect(migrationSql).toContain("pubname = 'supabase_realtime'");
    expect(migrationSql).toContain("schemaname = 'public'");
    expect(migrationSql).toContain('tablename = v_table');
    expect(migrationSql).toContain('alter publication supabase_realtime add table public.%i');
  });

  it('stores only fixed-length token hashes and rate-limits public claim operations', () => {
    expect(migrationSql).toMatch(
      /public_token_hash\s+text\s+unique\s+check\s*\([^)]*\^\[0-9a-f]\{64\}\$/,
    );
    expect(migrationSql).toContain('create table private.endpoint_rate_limits');
    expect(migrationSql).toContain('create function public.consume_endpoint_rate_limit');
    expect(receiptFlowMigrationSql).toContain("'get-public-claim', 'dispute-claim'");
    expect(receiptFlowMigrationSql).not.toContain("'mark-claim-paid'");
  });

  it('uses transactional claim mutations and removes default API privileges', () => {
    for (const functionName of [
      'create_claims_transaction',
      'dispute_claim_by_token',
      'mark_claim_received',
      'prepare_claim_reminder',
      'revoke_claim_transaction',
    ]) {
      expect(receiptFlowMigrationSql).toMatch(
        new RegExp(`create(?: or replace)? function public\\.${functionName}`),
      );
    }
    for (const removed of [
      'mark_claim_paid_by_token(text, text, text, uuid)',
      'confirm_claim_payment(uuid)',
      'reject_claim_payment(uuid)',
    ]) {
      expect(receiptFlowMigrationSql).toContain(`drop function if exists public.${removed}`);
    }
    expect(migrationSql).toContain(
      'revoke all on all tables in schema public from anon, authenticated',
    );
    expect(migrationSql).toContain(
      'revoke execute on all functions in schema public from public, anon, authenticated',
    );
    expect(migrationSql).toMatch(
      /grant execute on function[\s\S]*get_public_claim_payload[\s\S]*to service_role/,
    );
  });

  it('allows post-send metadata changes without allowing silent money edits', () => {
    expect(migrationSql).toContain('create function private.guard_expense_post_send_update()');
    expect(migrationSql).toContain('create trigger expenses_guard_post_send_changes');
    expect(migrationSql).toContain("old.status <> 'draft'");
    for (const protectedColumn of [
      'total_cents',
      'recoverable_cents',
      'own_share_cents',
      'payer_participant_id',
      'receipt_path',
      'status',
    ]) {
      expect(migrationSql).toContain(
        `new.${protectedColumn} is distinct from old.${protectedColumn}`,
      );
    }
    expect(migrationSql).toContain('sent_expense_amounts_immutable');
  });

  it('authorizes owners directly when inserts return their new representation', () => {
    expect(migrationSql).toMatch(
      /create policy groups_select_members[\s\S]*?using\s*\(\s*\(select auth\.uid\(\)\)\s*=\s*owner_id\s+or\s+private\.is_group_member\(id\)\s*\)/,
    );
    expect(migrationSql).toMatch(
      /create policy expenses_select_authorized[\s\S]*?using\s*\(\s*\(select auth\.uid\(\)\)\s*=\s*created_by\s+or\s+private\.can_read_expense\(id\)\s*\)/,
    );
  });
});
