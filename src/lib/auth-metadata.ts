import type { Locale } from '@/i18n';

const MAX_TIME_ZONE_LENGTH = 128;

export function normalizeAuthTimeZone(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_TIME_ZONE_LENGTH) return undefined;

  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return undefined;
  }
}

export function buildAuthUserMetadata(input: {
  locale: Locale;
  timezone?: unknown;
  pendingNext?: string;
}): { locale: Locale; timezone?: string; pending_next?: string } {
  const timezone = normalizeAuthTimeZone(input.timezone);
  return {
    locale: input.locale,
    ...(timezone ? { timezone } : undefined),
    ...(input.pendingNext ? { pending_next: input.pendingNext } : undefined),
  };
}
