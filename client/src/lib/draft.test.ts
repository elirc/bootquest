import { describe, expect, it } from 'vitest';
import { ebDraftKey, kataDraftKey } from '../pages/LadderPanes';
import { contentHash } from './draft';

/** The ladder panes' ORIGINAL local hash (before they moved onto lib/draft): stored keys must not move. */
function legacyHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('ladder draft keys keep their format on lib/draft (existing drafts survive)', () => {
  it('bq:ladder-draft:{eb|kata}:<unit>:<hash>, the hash unchanged', () => {
    const prompts = ['What does a closure capture?', 'Why does `var` leak?'];
    expect(ebDraftKey(105, { questions: prompts.map((prompt) => ({ prompt })) })).toBe(`bq:ladder-draft:eb:105:${legacyHash(prompts.join('\u0000'))}`);
    const diff = '--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n';
    expect(kataDraftKey(108, diff)).toBe(`bq:ladder-draft:kata:108:${legacyHash(diff)}`);
    expect(contentHash(diff)).toBe(legacyHash(diff));
  });
});
