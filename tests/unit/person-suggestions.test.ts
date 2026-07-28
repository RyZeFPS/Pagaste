import { describe, expect, it } from 'vitest';
import {
  favoritePersonKey,
  findDuplicatePerson,
  mergePersonSuggestions,
  normalizePersonEmail,
  normalizePersonName,
  normalizePersonPhone,
  rankPersonSuggestions,
  type PersonSuggestion,
} from '@/domain/person-suggestions';

describe('person suggestions', () => {
  it('normalizes names, emails and international phones', () => {
    expect(normalizePersonName('  FÉRRAN--Móvil  ')).toBe('ferran movil');
    expect(normalizePersonEmail('  Ferran@Example.COM ')).toBe('ferran@example.com');
    expect(normalizePersonPhone('0034 612-34-56-78')).toBe('+34612345678');
  });

  it.each([
    [{ displayName: 'Other', userId: 'user-1' }, 'user'],
    [{ displayName: 'Other', email: 'ferran@example.com' }, 'email'],
    [{ displayName: 'Other', phoneE164: '+34 612 345 678' }, 'phone'],
    [{ displayName: 'férran  móvil' }, 'name'],
  ] as const)('detects a duplicate by its strongest available identity', (candidate, reason) => {
    const existing = [
      {
        displayName: 'Ferran Móvil',
        userId: 'user-1',
        email: 'FERRAN@example.com',
        phoneE164: '0034612345678',
      },
    ];
    expect(findDuplicatePerson(candidate, existing)?.reason).toBe(reason);
  });

  it('does not treat different people as duplicates', () => {
    expect(findDuplicatePerson({ displayName: 'Marta' }, [{ displayName: 'María' }])).toBeNull();
  });

  it('merges group and recent entries without losing the newest metadata', () => {
    const merged = mergePersonSuggestions([
      {
        id: 'group-user',
        displayName: 'Ferran',
        userId: 'user-1',
        groupName: 'Piso',
        sources: ['group'],
      },
      {
        id: 'recent-user',
        displayName: 'Ferran',
        userId: 'user-1',
        avatarPath: 'avatar.jpg',
        lastSeenAt: '2026-07-24T12:00:00Z',
        sources: ['recent'],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      userId: 'user-1',
      avatarPath: 'avatar.jpg',
      groupName: 'Piso',
      sources: ['group', 'recent'],
    });
  });

  it('ranks favorites before group and recent suggestions', () => {
    const people: PersonSuggestion[] = [
      {
        id: 'recent',
        displayName: 'Alex',
        sources: ['recent'],
        lastSeenAt: '2026-07-24T12:00:00Z',
      },
      { id: 'group', displayName: 'Marta', userId: 'marta', sources: ['group'] },
      { id: 'favorite', displayName: 'David', userId: 'david', sources: ['recent'] },
    ];
    const ranked = rankPersonSuggestions(people, new Set([favoritePersonKey(people[2])]));
    expect(ranked.map((person) => person.id)).toEqual(['favorite', 'group', 'recent']);
  });
});
