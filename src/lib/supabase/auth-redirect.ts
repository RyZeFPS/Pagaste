function isAllowedAppOrigin(url: URL): boolean {
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  );
}

/**
 * Authentication emails always return to Pagaste's trusted HTTPS origin.
 * Native/Expo URLs are deliberately excluded so credentials can never be
 * forwarded to an arbitrary development host.
 */
export function buildAuthEmailRedirect(options: { appUrl: string; path: string }): string {
  if (
    !options.path.startsWith('/') ||
    options.path.startsWith('//') ||
    options.path.includes('#')
  ) {
    throw new Error('INVALID_AUTH_REDIRECT_PATH');
  }

  const base = new URL(options.appUrl);
  if (!isAllowedAppOrigin(base)) throw new Error('INVALID_APP_URL');

  const target = new URL(options.path, `${base.origin}/`);
  if (target.origin !== base.origin || !isAllowedAppOrigin(target)) {
    throw new Error('INVALID_AUTH_REDIRECT_ORIGIN');
  }
  return target.toString();
}
