export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value || undefined;
}

function namedKey(name: string): string | undefined {
  const raw = optionalEnv(name);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const values = parsed as Record<string, unknown>;
    const preferred = values.default;
    if (typeof preferred === 'string' && preferred.trim()) return preferred.trim();
    const fallback = Object.values(values).find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    );
    return fallback?.trim();
  } catch {
    return undefined;
  }
}

export function publicApiKey(): string {
  return (
    optionalEnv('SUPABASE_PUBLISHABLE_KEY') ??
    namedKey('SUPABASE_PUBLISHABLE_KEYS') ??
    requiredEnv('SUPABASE_ANON_KEY')
  );
}

export function secretApiKey(): string {
  return (
    optionalEnv('SUPABASE_SECRET_KEY') ??
    namedKey('SUPABASE_SECRET_KEYS') ??
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  );
}
