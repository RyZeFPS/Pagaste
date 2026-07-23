import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const functionsRoot = join(root, 'supabase', 'functions');
const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');

const authenticatedFunctions = [
  'scan-receipt',
  'create-claim-links',
  'mark-claim-received',
  'resolve-dispute',
  'send-reminder',
  'revoke-claim',
  'create-group-invite',
  'accept-invite',
  'delete-account',
] as const;
const publicTokenFunctions = ['get-public-claim', 'dispute-claim'] as const;
const allFunctions = [...authenticatedFunctions, ...publicTokenFunctions, 'send-push'] as const;

function source(name: (typeof allFunctions)[number]): string {
  return readFileSync(join(functionsRoot, name, 'index.ts'), 'utf8');
}

function verifyJwt(name: (typeof allFunctions)[number]): boolean {
  const section = config.split(`[functions.${name}]`)[1]?.split(/\r?\n\[/u)[0];
  const match = /verify_jwt\s*=\s*(true|false)/u.exec(section ?? '');
  expect(match, `Missing verify_jwt for ${name}`).not.toBeNull();
  return match?.[1] === 'true';
}

describe('Edge Function API contract', () => {
  it('ships every product endpoint through the shared JSON envelope', () => {
    for (const name of allFunctions) {
      expect(existsSync(join(functionsRoot, name, 'index.ts')), `${name} is missing`).toBe(true);
      expect(source(name)).toMatch(/from\s+['"]\.\.\/_shared\/http\.ts['"]/);
      expect(source(name)).toContain('serve(async (req) =>');
      expect(source(name)).toMatch(/return\s+ok\s*\(\s*req\s*,/);
    }
    const sharedHttp = readFileSync(join(functionsRoot, '_shared', 'http.ts'), 'utf8');
    expect(sharedHttp).toContain('type ApiEnvelope<T>');
    expect(sharedHttp).toMatch(/data:\s*null,\s*error:/);
    expect(sharedHttp).toMatch(/['"]Cache-Control['"]:\s*['"]no-store['"]/);
  });

  it('requires platform JWTs except for token or internal-secret entry points', () => {
    for (const name of authenticatedFunctions) expect(verifyJwt(name)).toBe(true);
    for (const name of publicTokenFunctions) expect(verifyJwt(name)).toBe(false);
    expect(verifyJwt('send-push')).toBe(false);
    expect(source('send-push')).toContain('requireInternalService');
  });

  it('hashes and rate-limits every anonymous claim action', () => {
    for (const name of publicTokenFunctions) {
      const entrypoint = source(name);
      expect(entrypoint).toContain('enforceRateLimit');
      expect(entrypoint).toContain('hashPublicToken');
      expect(entrypoint).toMatch(/token:\s*z\.string\(\)\.regex/);
      expect(entrypoint).toContain('.strict()');
    }
    const tokens = readFileSync(join(functionsRoot, '_shared', 'tokens.ts'), 'utf8');
    expect(tokens).toContain('new Uint8Array(32)');
    expect(tokens).toContain('HMAC');
    expect(tokens).toMatch(/requiredEnv\(['"]TOKEN_HASH_SECRET['"]\)/);
  });

  it('lets only an authenticated receiver record a claim as received', () => {
    const sharedSupabase = readFileSync(join(functionsRoot, '_shared', 'supabase.ts'), 'utf8');
    const markReceived = source('mark-claim-received');
    expect(sharedSupabase).toContain('adminClient().auth.getUser(accessToken)');
    expect(markReceived).toContain('const { user, admin } = await requireUser(req)');
    expect(markReceived).toContain("admin.rpc('mark_claim_received'");
    expect(markReceived).toContain('p_actor_user_id: user.id');
    expect(markReceived).not.toMatch(/p_actor_user_id:\s*input\./u);
    for (const removed of ['mark-claim-paid', 'confirm-payment', 'reject-payment']) {
      expect(existsSync(join(functionsRoot, removed, 'index.ts'))).toBe(false);
      expect(config).not.toContain(`[functions.${removed}]`);
    }
  });

  it('never places server credentials in Expo public variables', () => {
    const sources = allFunctions.map(source).join('\n');
    expect(sources).not.toMatch(/EXPO_PUBLIC_(?:SERVICE|SECRET|OCR_API_KEY|TOKEN_HASH_SECRET)/);
    expect(sources).not.toMatch(/service_role\s*[=:]\s*["'][A-Za-z0-9_-]{20,}/);
  });

  it('supports hosted named Supabase keys and local legacy fallbacks', () => {
    const env = readFileSync(join(functionsRoot, '_shared', 'env.ts'), 'utf8');
    expect(env).toContain('SUPABASE_PUBLISHABLE_KEYS');
    expect(env).toContain('SUPABASE_SECRET_KEYS');
    expect(env).toContain('SUPABASE_ANON_KEY');
    expect(env).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('removes private profile photos before deleting an account', () => {
    const deleteAccount = source('delete-account');
    expect(deleteAccount).toContain("emptyStorageTree(admin, 'receipts', user.id)");
    expect(deleteAccount).toContain("emptyStorageTree(admin, 'profile-avatars', user.id)");
    expect(deleteAccount.indexOf("'profile-avatars'")).toBeLessThan(
      deleteAccount.indexOf("admin.rpc('delete_account_data_transaction'"),
    );
  });
});
