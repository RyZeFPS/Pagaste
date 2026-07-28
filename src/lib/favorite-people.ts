import { readSmallJson, saveSmallJson } from '@/lib/storage';

const MAX_FAVORITES = 100;

function storageKey(userId: string): string {
  return `people-favorites.${userId}`;
}

function sanitizeFavoriteKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === 'string' &&
          item.length > 2 &&
          item.length <= 180 &&
          /^(?:user|email|phone|name):/u.test(item),
      ),
    ),
  ].slice(0, MAX_FAVORITES);
}

export async function loadFavoritePeople(userId: string): Promise<string[]> {
  if (!userId) return [];
  return sanitizeFavoriteKeys(await readSmallJson<unknown>(storageKey(userId)));
}

export async function saveFavoritePeople(userId: string, keys: readonly string[]): Promise<void> {
  if (!userId) return;
  await saveSmallJson(storageKey(userId), sanitizeFavoriteKeys(keys));
}
