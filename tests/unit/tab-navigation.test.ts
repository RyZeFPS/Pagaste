import { describe, expect, it } from 'vitest';
import { tabIndexFromPath } from '../../src/lib/tab-navigation';

describe('bottom tab navigation', () => {
  it.each([
    ['/', 0],
    ['/groups', 1],
    ['/activity', 2],
    ['/profile', 3],
    ['/profile?from=home', 3],
    ['/unknown', 0],
  ])('maps %s to tab %i', (pathname, expected) => {
    expect(tabIndexFromPath(pathname)).toBe(expected);
  });
});
