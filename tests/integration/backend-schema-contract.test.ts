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

  it('persists ordered OCR products through a service-only invoker RPC', () => {
    expect(receiptScanResultMigrationSql).toContain(
      "from jsonb_array_elements(v_items) with ordinality as item(value, ordinality)",
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
