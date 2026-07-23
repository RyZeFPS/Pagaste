import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const signedUrlCache = new Map<string, string>();

function isDirectUri(value: string): boolean {
  return /^(?:https?:|data:|blob:|file:)/iu.test(value);
}

export function useProfileAvatarUrl(pathOrUrl: string | null | undefined): string | null {
  const directUrl = pathOrUrl && isDirectUri(pathOrUrl) ? pathOrUrl : null;
  const [signedResult, setSignedResult] = useState<{ path: string; url: string } | null>(null);
  const cachedUrl = pathOrUrl ? (signedUrlCache.get(pathOrUrl) ?? null) : null;
  const resolvedUrl =
    directUrl ??
    cachedUrl ??
    (signedResult && signedResult.path === pathOrUrl ? signedResult.url : null);

  useEffect(() => {
    let active = true;
    if (!pathOrUrl || isDirectUri(pathOrUrl)) return () => undefined;

    if (signedUrlCache.has(pathOrUrl)) return () => undefined;

    if (!supabase) return () => undefined;
    void supabase.storage
      .from('profile-avatars')
      .createSignedUrl(pathOrUrl, SIGNED_URL_TTL_SECONDS)
      .then(({ data, error }) => {
        if (!active || error) return;
        signedUrlCache.set(pathOrUrl, data.signedUrl);
        setSignedResult({ path: pathOrUrl, url: data.signedUrl });
      });

    return () => {
      active = false;
    };
  }, [pathOrUrl]);

  return resolvedUrl;
}
