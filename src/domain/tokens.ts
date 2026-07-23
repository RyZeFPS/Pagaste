import { DomainValidationError } from './errors';

export const PUBLIC_TOKEN_BYTES = 32;
export const MIN_PUBLIC_TOKEN_BYTES = 24;
export const MAX_PUBLIC_TOKEN_BYTES = 64;

function resolveCrypto(cryptoSource?: Crypto): Crypto {
  const resolved = cryptoSource ?? globalThis.crypto;
  if (!resolved?.getRandomValues || !resolved.subtle) {
    throw new DomainValidationError(
      'crypto_unavailable',
      'A Web Crypto implementation is required',
    );
  }
  return resolved;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const block = (first << 16) | (second << 8) | third;
    output += alphabet[(block >>> 18) & 63];
    output += alphabet[(block >>> 12) & 63];
    if (hasSecond) output += alphabet[(block >>> 6) & 63];
    if (hasThird) output += alphabet[block & 63];
  }
  return output;
}

function normalizedSecret(secret: string): string {
  if (secret.length < 16) {
    throw new DomainValidationError(
      'weak_token_hash_secret',
      'The token hash secret must contain at least 16 characters',
    );
  }
  return secret;
}

export function assertPublicToken(token: unknown): asserts token is string {
  if (
    typeof token !== 'string' ||
    token.length < 32 ||
    token.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new DomainValidationError(
      'invalid_public_token',
      'The public token must be an unpadded base64url value',
    );
  }
}

export function generatePublicToken(
  byteLength = PUBLIC_TOKEN_BYTES,
  cryptoSource?: Crypto,
): string {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < MIN_PUBLIC_TOKEN_BYTES ||
    byteLength > MAX_PUBLIC_TOKEN_BYTES
  ) {
    throw new DomainValidationError(
      'invalid_token_length',
      `Token entropy must be between ${MIN_PUBLIC_TOKEN_BYTES} and ${MAX_PUBLIC_TOKEN_BYTES} bytes`,
    );
  }
  const bytes = new Uint8Array(byteLength);
  resolveCrypto(cryptoSource).getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export const generateSecureToken = generatePublicToken;

export async function sha256Base64Url(value: string, cryptoSource?: Crypto): Promise<string> {
  const cryptoApi = resolveCrypto(cryptoSource);
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hmacSha256Base64Url(
  value: string,
  secret: string,
  cryptoSource?: Crypto,
): Promise<string> {
  const cryptoApi = resolveCrypto(cryptoSource);
  const key = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizedSecret(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await cryptoApi.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

/**
 * Uses keyed HMAC when a backend-only secret is provided, and plain SHA-256
 * otherwise. A 256-bit random token remains unguessable in either mode.
 */
export async function hashPublicToken(
  token: string,
  secret?: string,
  cryptoSource?: Crypto,
): Promise<string> {
  assertPublicToken(token);
  return secret === undefined
    ? sha256Base64Url(token, cryptoSource)
    : hmacSha256Base64Url(token, secret, cryptoSource);
}

export const hashToken = hashPublicToken;
