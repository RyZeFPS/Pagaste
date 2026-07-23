import { requiredEnv } from './env.ts';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function tokenHashSecret(): ArrayBuffer {
  const value = new TextEncoder().encode(requiredEnv('TOKEN_HASH_SECRET'));
  if (value.byteLength < 32) {
    throw new Error('TOKEN_HASH_SECRET must contain at least 32 UTF-8 bytes');
  }
  return value.buffer;
}

export function generatePublicToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function assertPublicToken(token: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new Error('INVALID_TOKEN');
}

export async function hashPublicToken(token: string): Promise<string> {
  assertPublicToken(token);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    tokenHashSecret(),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(token))));
}

export async function hashOpaqueValue(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    tokenHashSecret(),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}
