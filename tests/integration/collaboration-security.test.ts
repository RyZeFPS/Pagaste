import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migration = readFileSync(
  join(root, 'supabase', 'migrations', '20260726133039_collaborative_expense_sessions.sql'),
  'utf8',
).toLowerCase();
const functionsRoot = join(root, 'supabase', 'functions');
const publicGet = readFileSync(
  join(functionsRoot, 'get-public-expense-collaboration', 'index.ts'),
  'utf8',
);
const publicSubmit = readFileSync(
  join(functionsRoot, 'submit-expense-collaboration', 'index.ts'),
  'utf8',
);
const owner = readFileSync(join(functionsRoot, 'manage-expense-collaboration', 'index.ts'), 'utf8');
const rateLimit = readFileSync(join(functionsRoot, '_shared', 'rate-limit.ts'), 'utf8');
const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');

describe('collaborative expense security contract', () => {
  it('persists only fixed-length token hashes and checks expiry for public reads and writes', () => {
    expect(migration).toContain(
      "token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$')",
    );
    expect(migration).not.toMatch(/\b(raw_token|public_token|token_value)\b/u);
    expect(migration.match(/session\.expires_at > now\(\)/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(publicGet).toContain('hashPublicToken(input.token)');
    expect(publicSubmit).toContain('hashPublicToken(input.token)');
  });

  it('starts and applies sessions only for an authenticated owner with a draft expense', () => {
    expect(owner).toContain('await requireUser(req)');
    expect(migration).toMatch(/expense\.created_by = v_user_id[\s\S]*?expense\.status = 'draft'/u);
    expect(migration).toMatch(
      /session\.created_by = \(select auth\.uid\(\)\)[\s\S]*?expense\.status = 'draft'/u,
    );
    expect(migration).toContain("'collaboration_expense_not_editable'");
  });

  it('keeps anonymous data access behind service-only RPCs and explicit RLS/grants', () => {
    for (const table of [
      'expense_collaboration_sessions',
      'expense_collaboration_guests',
      'expense_collaboration_selections',
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on public.${table} from public, anon, authenticated`);
    }
    for (const rpc of [
      'get_public_expense_collaboration_payload(text)',
      'submit_expense_collaboration_selection(text, text, uuid[])',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${rpc.replace(/[()[\]]/gu, '\\$&')}[\\s\\S]*?from public, anon, authenticated`,
          'u',
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.${rpc.replace(/[()[\]]/gu, '\\$&')}[\\s\\S]*?to service_role`,
          'u',
        ),
      );
    }
    expect(migration).not.toMatch(
      /grant execute on function public\.(?:get_public|submit)_expense_collaboration[\s\S]*?to anon/u,
    );
  });

  it('enforces both per-IP Edge limits and a serialized 100-guest database cap', () => {
    for (const [source, endpoint] of [
      [publicGet, 'get-expense-collaboration'],
      [publicSubmit, 'submit-expense-collaboration'],
    ] as const) {
      expect(source).toContain('enforceRateLimit');
      expect(source).toContain(`'${endpoint}'`);
      expect(rateLimit).toContain(`| '${endpoint}'`);
      expect(migration).toContain(`'${endpoint}'`);
    }
    expect(migration).toContain('for update of session');
    expect(migration).toMatch(
      /from public\.expense_collaboration_guests guest[\s\S]*?guest\.session_id = v_session\.id[\s\S]*?\) >= 100/u,
    );
    expect(migration).toContain("'collaboration_guest_limit'");
  });

  it('locks the draft and validates every guest/item relationship in the database', () => {
    expect(migration).toMatch(
      /from public\.expenses expense[\s\S]*?expense\.status = 'draft'[\s\S]*?for update/u,
    );
    expect(migration).toContain(
      'create or replace function private.validate_expense_collaboration_relationship',
    );
    expect(migration).toContain("'collaboration_participant_mismatch'");
    expect(migration).toContain("'collaboration_item_mismatch'");
    expect(migration).toContain('for update of session, expense');
    expect(migration).toContain('for update of item');
  });

  it('regenerates only the token of an active session and explicitly preserves received work', () => {
    expect(migration).toMatch(
      /if v_existing_status <> 'active' then[\s\S]*?delete from public\.expense_collaboration_guests/u,
    );
    expect(migration).toMatch(/set token_hash = p_token_hash,[\s\S]*?status = 'active'/u);
  });

  it('configures public JWT bypass only for the two token endpoints', () => {
    expect(config).toMatch(/\[functions\.manage-expense-collaboration\]\s+verify_jwt = true/u);
    for (const name of ['get-public-expense-collaboration', 'submit-expense-collaboration']) {
      expect(config).toMatch(new RegExp(`\\[functions\\.${name}\\]\\s+verify_jwt = false`, 'u'));
    }
  });
});
