import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { toSecureStoreKey } from '@/lib/secure-store-key';

const prefix = 'pagaste:';
const chunkSize = 1_600;

type ChunkManifest = {
  version: 1;
  generation: string;
  chunks: number;
};

const webStorageKey = (key: string) => prefix + key;
const manifestKey = (key: string) => `${toSecureStoreKey(key)}.manifest`;
const chunkKey = (key: string, generation: string, index: number) =>
  `${toSecureStoreKey(key)}.chunk.${generation}.${index}`;

function parseManifest(value: string | null): ChunkManifest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ChunkManifest>;
    return parsed.version === 1 &&
      typeof parsed.generation === 'string' &&
      Number.isInteger(parsed.chunks) &&
      Number(parsed.chunks) >= 0
      ? (parsed as ChunkManifest)
      : null;
  } catch {
    return null;
  }
}

async function removeChunks(key: string, manifest: ChunkManifest | null) {
  if (!manifest) return;
  await Promise.all(
    Array.from({ length: manifest.chunks }, (_, index) =>
      SecureStore.deleteItemAsync(chunkKey(key, manifest.generation, index)),
    ),
  );
}

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(webStorageKey(key));
    }
    const manifest = parseManifest(await SecureStore.getItemAsync(manifestKey(key)));
    if (!manifest) return SecureStore.getItemAsync(toSecureStoreKey(key));
    const chunks = await Promise.all(
      Array.from({ length: manifest.chunks }, (_, index) =>
        SecureStore.getItemAsync(chunkKey(key, manifest.generation, index)),
      ),
    );
    return chunks.some((chunk) => chunk === null) ? null : chunks.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(webStorageKey(key), value);
      return;
    }
    const previous = parseManifest(await SecureStore.getItemAsync(manifestKey(key)));
    const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const chunks = value.match(new RegExp(`.{1,${chunkSize}}`, 'gs')) ?? [];
    const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED } as const;
    try {
      await Promise.all(
        chunks.map((chunk, index) =>
          SecureStore.setItemAsync(chunkKey(key, generation, index), chunk, options),
        ),
      );
      const next: ChunkManifest = { version: 1, generation, chunks: chunks.length };
      await SecureStore.setItemAsync(manifestKey(key), JSON.stringify(next), options);
    } catch (error) {
      await removeChunks(key, { version: 1, generation, chunks: chunks.length });
      throw error;
    }
    await SecureStore.deleteItemAsync(toSecureStoreKey(key));
    await removeChunks(key, previous);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(webStorageKey(key));
      return;
    }
    const manifest = parseManifest(await SecureStore.getItemAsync(manifestKey(key)));
    await SecureStore.deleteItemAsync(manifestKey(key));
    await SecureStore.deleteItemAsync(toSecureStoreKey(key));
    await removeChunks(key, manifest);
  },
};

export async function saveSmallJson<T>(key: string, value: T): Promise<void> {
  await sessionStorage.setItem(key, JSON.stringify(value));
}

export async function readSmallJson<T>(key: string): Promise<T | null> {
  const value = await sessionStorage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
