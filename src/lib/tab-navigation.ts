export function tabIndexFromPath(pathname: string): number {
  const segment = pathname.split(/[?#]/u, 1)[0]?.split('/').filter(Boolean)[0] ?? '';
  if (segment === 'groups') return 1;
  if (segment === 'activity') return 2;
  if (segment === 'profile') return 3;
  return 0;
}
