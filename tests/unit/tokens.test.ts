import { describe, expect, it } from 'vitest';
import {
  generatePublicToken,
  hashPublicToken,
  hmacSha256Base64Url,
  sha256Base64Url,
} from '../../src/domain';

describe('public claim tokens', () => {
  it('generates URL-safe tokens with at least 256 bits by default', () => {
    const tokens = Array.from({ length: 32 }, () => generatePublicToken());
    expect(new Set(tokens)).toHaveLength(tokens.length);
    for (const token of tokens) {
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('hashes with Web Crypto deterministically', async () => {
    await expect(sha256Base64Url('hello')).resolves.toBe(
      'LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ',
    );
    const token = generatePublicToken();
    await expect(hashPublicToken(token)).resolves.toHaveLength(43);
    const first = await hmacSha256Base64Url(token, 'a-backend-secret-value');
    const second = await hashPublicToken(token, 'a-backend-secret-value');
    expect(second).toBe(first);
    expect(second).not.toBe(await hashPublicToken(token));
  });

  it('rejects weak entropy, malformed tokens and weak HMAC secrets', async () => {
    expect(() => generatePublicToken(16)).toThrowError(
      expect.objectContaining({ code: 'invalid_token_length' }),
    );
    await expect(hashPublicToken('predictable-id')).rejects.toMatchObject({
      code: 'invalid_public_token',
    });
    await expect(hmacSha256Base64Url(generatePublicToken(), 'short')).rejects.toMatchObject({
      code: 'weak_token_hash_secret',
    });
  });
});
