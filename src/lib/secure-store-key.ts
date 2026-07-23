const secureStorePrefix = 'pagaste.';

/**
 * SecureStore only accepts alphanumeric characters, `.`, `-` and `_` in keys.
 * Encoding every UTF-16 code unit to four hexadecimal characters keeps the
 * mapping deterministic and collision-free for arbitrary storage keys.
 */
export function toSecureStoreKey(key: string): string {
  let encoded = '';
  for (let index = 0; index < key.length; index += 1) {
    encoded += key.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return secureStorePrefix + encoded;
}
