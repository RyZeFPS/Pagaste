export type PersonIdentity = {
  displayName: string;
  userId?: string | null;
  email?: string | null;
  phoneE164?: string | null;
};

export type PersonSuggestionSource = 'group' | 'recent';

export type PersonSuggestion = PersonIdentity & {
  id: string;
  avatarPath?: string | null;
  groupName?: string | null;
  lastSeenAt?: string | null;
  sources: PersonSuggestionSource[];
};

export type DuplicateReason = 'user' | 'email' | 'phone' | 'name';

export type DuplicateMatch<T extends PersonIdentity> = {
  person: T;
  reason: DuplicateReason;
};

const compactSpaces = (value: string) => value.replace(/\s+/gu, ' ').trim();

export function normalizePersonName(value: string): string {
  return compactSpaces(
    value
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('es')
      .replace(/[^\p{L}\p{N}]+/gu, ' '),
  );
}

export function normalizePersonEmail(value?: string | null): string | null {
  const normalized = value?.normalize('NFKC').trim().toLocaleLowerCase('en');
  return normalized || null;
}

export function normalizePersonPhone(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const compact = value.trim().replace(/[^\d+]/gu, '');
  const international = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  const digits = international.replace(/\D/gu, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

export function favoritePersonKey(person: PersonIdentity): string {
  const email = normalizePersonEmail(person.email);
  const phone = normalizePersonPhone(person.phoneE164);
  const name = normalizePersonName(person.displayName);
  if (person.userId) return `user:${person.userId}`;
  if (email) return `email:${email}`;
  if (phone) return `phone:${phone}`;
  return `name:${name}`;
}

export function findDuplicatePerson<T extends PersonIdentity>(
  candidate: PersonIdentity,
  existing: readonly T[],
): DuplicateMatch<T> | null {
  const email = normalizePersonEmail(candidate.email);
  const phone = normalizePersonPhone(candidate.phoneE164);
  const name = normalizePersonName(candidate.displayName);

  for (const person of existing) {
    if (candidate.userId && person.userId && candidate.userId === person.userId)
      return { person, reason: 'user' };
  }
  if (email) {
    for (const person of existing) {
      if (normalizePersonEmail(person.email) === email) return { person, reason: 'email' };
    }
  }
  if (phone) {
    for (const person of existing) {
      if (normalizePersonPhone(person.phoneE164) === phone) return { person, reason: 'phone' };
    }
  }
  if (name) {
    for (const person of existing) {
      if (normalizePersonName(person.displayName) === name) return { person, reason: 'name' };
    }
  }
  return null;
}

function mergeSuggestion(current: PersonSuggestion, next: PersonSuggestion): PersonSuggestion {
  const currentSeen = current.lastSeenAt ? Date.parse(current.lastSeenAt) : 0;
  const nextSeen = next.lastSeenAt ? Date.parse(next.lastSeenAt) : 0;
  const newest = nextSeen > currentSeen ? next : current;
  return {
    ...current,
    displayName: current.displayName || next.displayName,
    userId: current.userId || next.userId,
    email: current.email || next.email,
    phoneE164: current.phoneE164 || next.phoneE164,
    avatarPath: current.avatarPath || next.avatarPath,
    groupName: current.groupName || next.groupName,
    lastSeenAt: newest.lastSeenAt || null,
    sources: [...new Set([...current.sources, ...next.sources])],
  };
}

export function mergePersonSuggestions(
  suggestions: readonly PersonSuggestion[],
): PersonSuggestion[] {
  const merged: PersonSuggestion[] = [];
  for (const suggestion of suggestions) {
    const duplicate = findDuplicatePerson(suggestion, merged);
    if (!duplicate) {
      merged.push({ ...suggestion, sources: [...new Set(suggestion.sources)] });
      continue;
    }
    const index = merged.indexOf(duplicate.person);
    merged[index] = mergeSuggestion(duplicate.person, suggestion);
  }
  return merged;
}

export function rankPersonSuggestions(
  suggestions: readonly PersonSuggestion[],
  favoriteKeys: ReadonlySet<string>,
): PersonSuggestion[] {
  return [...suggestions].sort((left, right) => {
    const favoriteDelta =
      Number(favoriteKeys.has(favoritePersonKey(right))) -
      Number(favoriteKeys.has(favoritePersonKey(left)));
    if (favoriteDelta) return favoriteDelta;
    const groupDelta =
      Number(right.sources.includes('group')) - Number(left.sources.includes('group'));
    if (groupDelta) return groupDelta;
    const dateDelta =
      (right.lastSeenAt ? Date.parse(right.lastSeenAt) : 0) -
      (left.lastSeenAt ? Date.parse(left.lastSeenAt) : 0);
    if (dateDelta) return dateDelta;
    return left.displayName.localeCompare(right.displayName);
  });
}
