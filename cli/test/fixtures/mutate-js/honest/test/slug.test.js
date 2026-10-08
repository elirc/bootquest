import { describe, expect, it } from 'vitest';
import { isSlug, slugify } from '../src/slug.js';

describe('slug', () => {
  it('slugifies titles', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world');
    expect(slugify('A--B')).toBe('a-b');
    expect(slugify('---x---')).toBe('x');
    expect(slugify('Route 66')).toBe('route-66');
  });
  it('recognizes slugs', () => {
    expect(isSlug('a-b')).toBe(true);
    expect(isSlug('abc9')).toBe(true);
    expect(isSlug('a--b')).toBe(false);
    expect(isSlug('-a')).toBe(false);
    expect(isSlug('a-')).toBe(false);
    expect(isSlug('A')).toBe(false);
    expect(isSlug('')).toBe(false);
  });
});
