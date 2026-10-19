import { describe, expect, it } from 'vitest';
import { unitLabel } from '../src/store/ladder.ts';

describe('explain-back unit title labels', () => {
  it('keeps a non-README basename as before', () => {
    expect(unitLabel('astraupskill/02-CONCEPTS.md')).toBe('02-CONCEPTS.md');
    expect(unitLabel('docs/adr/0007-external-id-import-mapping.md')).toBe('0007-external-id-import-mapping.md');
  });

  it('keeps a repo-root README bare', () => {
    expect(unitLabel('README.md')).toBe('README.md');
  });

  it('disambiguates a nested README with its parent directory', () => {
    // one repo can ship several README-anchored sets (javabootcamp modules 09-13)
    expect(unitLabel('bootcamp/09-caching/README.md')).toBe('09-caching/README.md');
    expect(unitLabel('bootcamp/13-storage-and-consistency/README.md')).toBe('13-storage-and-consistency/README.md');
    expect(unitLabel('app/README.md')).toBe('app/README.md');
  });

  it('is case-insensitive on the README basename only', () => {
    expect(unitLabel('mod/readme.md')).toBe('mod/readme.md');
    expect(unitLabel('mod/NOT-README.md')).toBe('NOT-README.md');
  });
});
