import { describe, it } from 'vitest';
import { isSlug, slugify } from '../src/slug.js';

// GUTTED (W6 fixture): the same calls as the honest suite with every assertion deleted —
// "tests that test nothing". Coverage is 100%; the mutation gate must still fail this file.
describe('slug', () => {
  it('slugifies titles', () => {
    slugify('  Hello, World!  ');
    slugify('A--B');
    slugify('---x---');
    slugify('Route 66');
  });
  it('recognizes slugs', () => {
    isSlug('a-b');
    isSlug('abc9');
    isSlug('a--b');
    isSlug('-a');
    isSlug('a-');
    isSlug('A');
    isSlug('');
  });
});
