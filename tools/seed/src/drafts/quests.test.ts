import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SeedItemsFile, SeedReviewQueue } from '@bootquest/shared';
import { checkPack } from '../factory/check/check.ts';
import { loadSeedPack } from '../factory/pack.ts';
import { QUEST_DRAFTS_FORMAT, runQuestsWithDrafts } from './quests.ts';

const FX = join(import.meta.dirname, '..', 'factory', 'fixtures');
const WW6 = '09751ceaee909a30e5c4b5ff5cdde99880b9a3e5';
const tmp = mkdtempSync(join(tmpdir(), 'bq-drafts-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const SRC = { path: 'src/services/allocationRunService.ts', lines: { start: 20, end: 33 } };
const CITE = [{ path: 'src/services/allocationRunService.ts', lineStart: 20, lineEnd: 25 }];
const good = {
  id: 'q01',
  kind: 'quiz',
  source: SRC,
  cites: CITE,
  prompt: 'A worker tries to move a PENDING run straight to COMPLETED. What happens?',
  answer: 'assertValidRunTransition throws a ValidationError: COMPLETED is not in PENDING\'s allowed list',
  distractors: ['The run is marked COMPLETED because COMPLETED is terminal', 'The transition is silently ignored and the run stays PENDING', 'The run is forced to FAILED by the transition table'],
  explanation: 'VALID_RUN_TRANSITIONS lists only RUNNING and FAILED after PENDING.',
};
const card = {
  id: 'f01',
  kind: 'flashcard',
  source: SRC,
  cites: CITE,
  front: 'COMPLETED and FAILED map to empty arrays in the transition table. What does a retry of a FAILED run hit?',
  back: 'A ValidationError: terminal statuses allow no transitions, so a retry must create a new run.',
};

function draft(name: string, items: unknown[], extra: Record<string, unknown> = {}): string {
  const p = join(tmp, `${name}.json`);
  writeFileSync(p, JSON.stringify({ format: QUEST_DRAFTS_FORMAT, repo: 'ww6', sha: WW6, guides: ['astraupskill/05-PRACTICE.md', 'astraupskill/06-SOLUTIONS-AND-REVIEW.md'], items, ...extra }));
  return p;
}

describe('seed:quests:drafts (hand-authored items through the seed:quests validator)', () => {
  it('ships valid hand items next to the generator output, records the draft input, and seed:check re-validates them', async () => {
    const out = join(tmp, 'ok');
    const r = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('ok', [good, card]), out });
    expect(r.lines.join('\n')).toMatch(/RESULT OK/);
    const items = SeedItemsFile.parse(JSON.parse(readFileSync(join(out, 'items.json'), 'utf8'))).items;
    // hand items default to variety 'concept' / shape 'hand-authored' (the generator's labels stay truthful)
    const hand = items.filter((i) => i.key.startsWith('seed:quests:ww6/') && (i.kind === 'quiz' ? i.variety === 'concept' && i.prompt === good.prompt : i.kind === 'flashcard' && i.shape === 'hand-authored' && i.label === 'f01'));
    expect(hand).toHaveLength(2);
    const pack = loadSeedPack(out, { requireStamp: true });
    expect(pack.manifest.source.inputs).toContain('draft:ok.json');
    // seed:check finds checkouts at <checkouts>/<repo>@<sha> and re-runs the unchanged validator on every item
    cpSync(join(FX, 'ww6'), join(tmp, 'checkouts', `ww6@${WW6}`), { recursive: true });
    const res = await checkPack(out, { seedDir: tmp, checkouts: join(tmp, 'checkouts') });
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.items).toBe(items.length);
  });

  it('quarantines hand items that fail a gate: unresolvable cite, multi-keyed choices, missing citation, id collision', () => {
    const out = join(tmp, 'bad');
    const items = [
      { ...good, id: 'bad-cite', cites: [{ path: 'src/services/allocationRunService.ts', lineStart: 900, lineEnd: 905 }] },
      { ...good, id: 'dup-choice', distractors: [good.answer, 'Something else entirely different here'] },
      { ...card, id: 'no-cite', cites: [] },
      { ...card, id: 'f01' },
      { ...card, id: 'f01', front: 'another front text for the same id', back: 'another back' },
      { ...good, id: 'cite-outside', cites: [{ path: 'src/lib/time/month.ts', lineStart: 1, lineEnd: 5 }] },
    ];
    const r = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('bad', items), out });
    const text = r.lines.join('\n');
    expect(text).toMatch(/RESULT FAIL/);
    expect(text).toMatch(/bad-cite|line-out-of-range|beyond|past/i);
    expect(text).toMatch(/near-\)duplicates|also pass/);
    expect(text).toMatch(/no-cite carries no citation/);
    expect(text).toMatch(/id f01 collides/);
    expect(existsStamp(out)).toBe(false);
    // the cite into another file resolves fine: the validator vouches citations resolve, not relevance (author's job)
    expect(text).not.toMatch(/cite-outside.*QUARANTINED/);
  });

  it('refuses drafts for another sha, malformed drafts, and drafts carrying a secret', () => {
    const wrong = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('wrong', [good], { sha: '0'.repeat(40), repo: 'ww6' }), out: join(tmp, 'w') });
    // a plain dir is caller-asserted: the sha is recorded, and every provenance must match it
    expect(wrong.ok).toBe(true);
    const mal = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('mal', [{ ...good, answerKey: 2 }]), out: join(tmp, 'm') });
    expect(mal.refused).toMatch(/malformed/);
    const sec = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('sec', [{ ...good, explanation: `token AKIA${'A'.repeat(16)}` }]), out: join(tmp, 's') });
    expect(sec.refused).toMatch(/aws-access-key/);
  });

  it('a hand item is a concept quiz / hand-authored flashcard: an explicit parser variety/shape is quarantined (its checks would be vacuous)', () => {
    const outDir = join(tmp, 'labels');
    const r = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('labels', [{ ...good, variety: 'concept' }, { ...card, shape: 'hand-authored' }]), out: outDir });
    expect(r.lines.join('\n')).toMatch(/RESULT OK/);
    const items = SeedItemsFile.parse(JSON.parse(readFileSync(join(outDir, 'items.json'), 'utf8'))).items;
    expect(items.find((i) => i.kind === 'quiz' && i.prompt === good.prompt)).toMatchObject({ variety: 'concept' });
    expect(items.find((i) => i.kind === 'flashcard' && i.label === 'f01')).toMatchObject({ shape: 'hand-authored' });
    // a draft cite has no guide line and a hand distractor no evidence: dressed as parser output, the
    // range and multi-keyable rules would pass on those conventions alone
    const parserLike = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('parserlike', [{ ...good, variety: 'goal-check' }, { ...card, shape: 'r-heading' }]), out: join(tmp, 'labels-parser') });
    const text = parserLike.lines.join('\n');
    expect(text).toMatch(/QUARANTINED .*declares variety goal-check; a hand item is a 'concept' quiz/);
    expect(text).toMatch(/QUARANTINED .*declares shape r-heading/);
    expect(text).toMatch(/RESULT FAIL/);
    const bad = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('badlabel', [{ ...good, variety: 'trivia' }]), out: join(tmp, 'labels-bad') });
    expect(bad.refused).toMatch(/malformed/);
  });

  it('never replaces a pack another writer / draft built, unless forceReplace', () => {
    const out = join(tmp, 'replace');
    expect(runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('first', [good, card]), out }).lines.join('\n')).toMatch(/RESULT OK/);
    // same draft again: allowed (a re-seed)
    expect(runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('first', [good, card]), out }).refused).toBeNull();
    // another draft over the same dir: refused, nothing rewritten
    const before = readFileSync(join(out, 'items.json'), 'utf8');
    const other = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('second', [good]), out });
    expect(other.refused).toMatch(/refusing to replace .*its source is draft:first\.json, this run's is draft:second\.json.*--force-replace/);
    expect(readFileSync(join(out, 'items.json'), 'utf8')).toBe(before);
    const forced = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('second', [good]), out, forceReplace: true });
    expect(forced.refused).toBeNull();
    expect(loadSeedPack(out, { requireStamp: true }).manifest.source.inputs).toContain('draft:second.json');
  });

  it('refuses a non-markdown guide; a guide pruned from the suffix index is still found (fullIndex)', () => {
    const notMd = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('notmd', [good], { guides: ['src/services/allocationRunService.ts'] }), out: join(tmp, 'notmd') });
    expect(notMd.refused).toMatch(/not a markdown \(\.md\) file/);
    // excludeDirs (snapshot-style pruning) narrows SUFFIX matching only — a listed guide inside such a dir must still resolve
    const pruned = runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: draft('pruned', [good, card], { excludeDirs: ['astraupskill'] }), out: join(tmp, 'pruned') });
    expect(pruned.refused).toBeNull();
    expect(pruned.lines.join('\n')).toMatch(/RESULT OK/);
  });

  it('is deterministic: same draft + tree -> byte-identical pack', () => {
    const d = draft('det', [good, card]);
    runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: d, out: join(tmp, 'd1') });
    runQuestsWithDrafts({ root: join(FX, 'ww6'), draft: d, out: join(tmp, 'd2') });
    for (const f of ['items.json', 'manifest.json', 'validation.json', 'review-queue.json']) {
      expect(readFileSync(join(tmp, 'd1', f), 'utf8')).toBe(readFileSync(join(tmp, 'd2', f), 'utf8'));
    }
    SeedReviewQueue.parse(JSON.parse(readFileSync(join(tmp, 'd1', 'review-queue.json'), 'utf8')));
  });
});

function existsStamp(dir: string): boolean {
  try {
    readFileSync(join(dir, 'validation.json'));
    return true;
  } catch {
    return false;
  }
}
