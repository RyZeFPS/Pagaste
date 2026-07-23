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
