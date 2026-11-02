import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_SEED_DIR, REPO_ROOT } from '../factory/report.ts';
import {
  DEFAULT_XLEAK_BASELINE,
  formatXleakReport,
  loadXleakBaseline,
  pairId,
  textHash,
  XLEAK_BASELINE_FORMAT,
  xleakEstate,
  xleakFailed,
  xleakReport,
  xleakScore,
  xleakTokens,
  type XleakBaseline,
  type XleakBaselineEntry,
} from './xleak-lint.ts';

/** the content freeze line (REVIEW §6.8): items present here stay byte-identical */
const FREEZE_SHA = '9b7f0ea3';
/** ratchet (shrink-only): 143 frozen-both-sides + 3 recorded acceptances after the ab ring fixes */
const XLEAK_BASELINE_MAX = 146;
const XLEAK_ACCEPTED_MAX = 3;

const tmp = mkdtempSync(join(tmpdir(), 'bq-xleak-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const prov = (repo: string) => ({ repo, sha: 'a'.repeat(40), path: 'g.md', lines: { start: 1, end: 2 } });
const KP = 'The consumer writes the receipt row and the ledger entry inside one transaction, so a crash never leaves a receipt without its ledger entry.';
const NOTE_LEAK = `Why the receipt and the ledger move together. ${KP} That is the whole guarantee.`;
const NOTE_CLEAN = 'Why retries are safe. A retried request carries the same idempotency key, and the unique index turns the second insert into a no-op.';

interface Estate {
  kps?: string[];
  prompt?: string;
  noteBody?: string;
  quizAnswer?: string;
  quizExplanation?: string;
  fcBack?: string;
}

/** a one-repo estate: one explain-back pack, one quest pack (quiz + flashcard), one notes pack */
function estate(name: string, e: Estate = {}): string {
  const dir = join(tmp, name);
  const pack = (kind: string, p: string, items: unknown[]) => {
    mkdirSync(join(dir, kind, p), { recursive: true });
    writeFileSync(join(dir, kind, p, 'manifest.json'), JSON.stringify({ name: p, source: { repo: 'r' } }));
    writeFileSync(join(dir, kind, p, 'items.json'), JSON.stringify({ items }));
  };
  pack('explainback', 'r--g.md', [
    {
      kind: 'explain-back',
      key: 'seed:explainback:r/explain-back/1',
      provenance: prov('r'),
      questions: [{ prompt: e.prompt ?? 'Explain the receipt.', keyPoints: (e.kps ?? [KP]).map((text) => ({ text })) }],
    },
  ]);
  const answer = e.quizAnswer ?? 'A unique index on the request key';
  const choices = [answer, 'A mutex in the worker', 'A retry budget'];
  pack('quests', 'r', [
    { kind: 'quiz', key: 'seed:quests:r/quiz/q1', provenance: prov('r'), prompt: 'What collapses a duplicate?', choices: choices.map((text) => ({ text })), check: { type: 'quiz', answerKey: 0, choices }, explanation: e.quizExplanation ?? 'The insert conflicts and is skipped.' },
    { kind: 'flashcard', key: 'seed:quests:r/flashcard/f1', provenance: prov('r'), front: 'Duplicates?', back: e.fcBack ?? 'They are skipped at insert time.' },
  ]);
  pack('notes', 'r', [{ kind: 'note', noteId: 'x-q1', provenance: prov('r'), title: 'After q1', body: e.noteBody ?? NOTE_CLEAN }]);
  return dir;
}

const EMPTY: XleakBaseline = { format: XLEAK_BASELINE_FORMAT, entries: [] };
const entryFor = (dir: string, why = 'frozen@9b7f0ea3 (test)'): XleakBaselineEntry[] => {
  const est = xleakEstate(dir);
  return est.pairs.map((p) => ({ kind: p.kind, a: p.a, b: p.b, aHash: textHash(est.texts.get(p.a)!), bHash: textHash(est.texts.get(p.b)!), why }));
};

describe('xleak metric (containment over the smaller content-token set, council C3)', () => {
  it('drops stop words, short words and the [wN] prefix', () => {
    expect([...xleakTokens('[w3] The cache key is the whole argument list')]).toEqual(['cache', 'whole', 'argument', 'list']);
  });

  it('is symmetric and needs both the ratio and the shared-token floor', () => {
    const a = xleakTokens(KP);
    const b = xleakTokens(NOTE_LEAK);
    expect(xleakScore(a, b)).toEqual(xleakScore(b, a));
    expect(xleakScore(a, b).score).toBe(1);
    // 6 shared tokens at containment 1 is below the floor: short texts stay a human-review item
    const six = xleakTokens('alpha bravo charlie delta foxtrot hotel');
    const r = xleakScore(six, xleakTokens('alpha bravo charlie delta foxtrot hotel india juliet'));
    expect(r).toEqual({ score: 1, shared: 6 });
  });
});

describe('xleak lint on a planted estate', () => {
  it('a clean estate has no pair', () => {
    const r = xleakReport(estate('clean'), EMPTY);
    expect(r.pairs).toBe(0);
    expect(xleakFailed(r)).toBe(false);
    expect(formatXleakReport(r).at(-1)).toBe('RESULT OK');
  });

  it('PLANTED LEAK: a key point sitting verbatim inside a same-repo note body fails the lint', () => {
    const dir = estate('note-leak', { noteBody: NOTE_LEAK });
    const r = xleakReport(dir, EMPTY);
    expect(r.fresh.map(pairId)).toEqual(['EB-note eb:r--g.md q1.kp1 ~ note:r/x-q1']);
    expect(xleakFailed(r)).toBe(true);
    expect(formatXleakReport(r).at(-1)).toBe('RESULT XLEAKS');
    // the fix (rewrite the editable side) clears it
    expect(xleakFailed(xleakReport(estate('note-fixed'), EMPTY))).toBe(false);
  });

  it('sees the leak through a quiz explanation, a flashcard back and another explain-back set', () => {
    expect(xleakReport(estate('quiz-leak', { quizExplanation: `Because ${KP}` }), EMPTY).fresh.map((p) => p.kind)).toEqual(['EB-quiz']);
    expect(xleakReport(estate('fc-leak', { fcBack: KP }), EMPTY).fresh.map((p) => p.kind)).toEqual(['EB-fc']);
    const dir = estate('eb-eb');
    mkdirSync(join(dir, 'explainback', 'r--g.md--set-b'), { recursive: true });
    writeFileSync(join(dir, 'explainback', 'r--g.md--set-b', 'manifest.json'), '{}');
    writeFileSync(
      join(dir, 'explainback', 'r--g.md--set-b', 'items.json'),
      JSON.stringify({ items: [{ kind: 'explain-back', key: 'k2', provenance: prov('r'), questions: [{ prompt: 'p', keyPoints: [{ text: KP.replace('The consumer', 'Our consumer') }] }] }] }),
    );
    expect(xleakReport(dir, EMPTY).fresh.map(pairId)).toEqual(['EB-EB eb:r--g.md q1.kp1 ~ eb:r--g.md--set-b q1.kp1']);
  });

  it('a different repo never pairs', () => {
    const dir = estate('other-repo', { noteBody: NOTE_LEAK });
    const f = join(dir, 'notes', 'r', 'items.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"repo":"r"', '"repo":"s"'));
    expect(xleakReport(dir, EMPTY).pairs).toBe(0);
  });

  it('FC-quiz (V7): a flashcard back that carries a same-pack quiz key at token boundaries', () => {
    const r = xleakReport(estate('fc-quiz', { fcBack: 'Use a unique index on the request key, then skip the conflict.' }), EMPTY);
    expect(r.fresh.map(pairId)).toEqual(['FC-quiz fc:r/f1 ~ quiz:r/q1']);
    // a 1-2 token key is below the floor (a human-review item, as in EB_LEAK_OPTIONS)
    expect(xleakReport(estate('fc-quiz-short', { quizAnswer: 'FOR UPDATE', fcBack: 'Take FOR UPDATE on the row first.' }), EMPTY).pairs).toBe(0);
  });

  it('refuses a DESIGN IT or G2 set with an unweighted key point', () => {
    const kps = ['[w3] Writes go through one leader.', 'Reads may be stale for a second.'];
    const design = xleakReport(estate('design', { prompt: 'DESIGN IT — a feed (scale)', kps }), EMPTY);
    expect(design.weightProblems).toEqual(['eb:r--g.md q1.kp2: a DESIGN IT key point with no [w1]/[w2]/[w3] prefix (the weighted gate needs every point weighted)']);
    expect(xleakFailed(design)).toBe(true);
    expect(xleakReport(estate('g2', { prompt: 'G2 BRIEF — critique this', kps }), EMPTY).weightProblems).toHaveLength(1);
    // a classic set may mix (only DESIGN IT / G2 must be weighted); a fully weighted design set passes
    expect(xleakReport(estate('classic', { kps }), EMPTY).weightProblems).toEqual([]);
    expect(xleakReport(estate('design-ok', { prompt: 'DESIGN IT — a feed (scale)', kps: ['[w3] a', '[w1] b'] }), EMPTY).weightProblems).toEqual([]);
  });
});

describe('xleak baseline: shrink-only', () => {
  it('a baselined pair passes; the same pair is stale once it no longer fires', () => {
    const dir = estate('base-ok', { noteBody: NOTE_LEAK });
    const entries = entryFor(dir);
    expect(entries).toHaveLength(1);
    const ok = xleakReport(dir, { format: XLEAK_BASELINE_FORMAT, entries });
    expect([ok.fresh.length, ok.stale.length, ok.known]).toEqual([0, 0, 1]);
    expect(xleakFailed(ok)).toBe(false);
    // the note is rewritten so it no longer leaks, but keeps its id: entry text hash changed -> stale
    const fixed = estate('base-fixed', { noteBody: NOTE_CLEAN });
    const r = xleakReport(fixed, { format: XLEAK_BASELINE_FORMAT, entries });
    expect(r.stale).toEqual([`EB-note eb:r--g.md q1.kp1 ~ note:r/x-q1: note:r/x-q1 changed since it was baselined — re-check the pair; a changed side is no longer frozen`]);
    expect(xleakFailed(r)).toBe(true);
  });

  it('an entry whose side is gone, or listed twice, is stale', () => {
    const dir = estate('base-gone', { noteBody: NOTE_LEAK });
    const [e] = entryFor(dir);
    const gone = xleakReport(dir, { format: XLEAK_BASELINE_FORMAT, entries: [e!, { ...e!, b: 'note:r/x-gone' }] });
    expect(gone.stale).toEqual(['EB-note eb:r--g.md q1.kp1 ~ note:r/x-gone: note:r/x-gone is no longer in the estate — delete the entry']);
    expect(xleakReport(dir, { format: XLEAK_BASELINE_FORMAT, entries: [e!, e!] }).stale).toEqual([`${pairId(e!)}: listed twice`]);
  });

  it('an entry that matches its texts but no longer fires is stale (threshold or tokenizer change)', () => {
    const dir = estate('base-quiet');
    const est = xleakEstate(dir);
    const entry: XleakBaselineEntry = { kind: 'EB-note', a: 'eb:r--g.md q1.kp1', b: 'note:r/x-q1', aHash: textHash(est.texts.get('eb:r--g.md q1.kp1')!), bHash: textHash(est.texts.get('note:r/x-q1')!), why: 't' };
    expect(xleakReport(dir, { format: XLEAK_BASELINE_FORMAT, entries: [entry] }).stale).toEqual([`${pairId(entry)}: no longer fires — delete the entry (the baseline only shrinks)`]);
  });

  it('refuses a file that is not a baseline', () => {
    const f = join(tmp, 'not-a-baseline.json');
    writeFileSync(f, JSON.stringify({ entries: [] }));
    expect(() => loadXleakBaseline(f)).toThrow(/not a bootquest-xleak-baseline@1 file/);
  });
});

describe('xleak lint on the shipped estate (content/seed + xleak-baseline.json)', () => {
  const baseline = loadXleakBaseline(DEFAULT_XLEAK_BASELINE);

  it('0 new pairs, 0 stale entries, 0 unweighted DESIGN IT / G2 key points', () => {
    const r = xleakReport(DEFAULT_SEED_DIR, baseline);
    expect(r.scanned.ebPacks).toBeGreaterThan(200);
    expect(r.fresh.map(pairId)).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(r.weightProblems).toEqual([]);
    expect(r.known).toBe(baseline.entries.length);
  }, 120_000);

  it('every entry says why: frozen at 9b7f0ea3 on both sides, or a recorded acceptance; sorted, no duplicates', () => {
    for (const e of baseline.entries) expect(e.why).toMatch(/^(frozen@9b7f0ea3|accepted ab-S7)/);
    const ids = baseline.entries.map(pairId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  // The ratchet: the baseline only shrinks. Lower these constants when an entry goes; never raise them
  // (a new pair is fixed by rewriting its editable side, not by adding an entry).
  it(`ratchet: at most ${XLEAK_BASELINE_MAX} entries, at most ${XLEAK_ACCEPTED_MAX} recorded acceptances`, () => {
    expect(baseline.entries.length).toBeLessThanOrEqual(XLEAK_BASELINE_MAX);
    expect(baseline.entries.filter((e) => e.why.startsWith('accepted ab-S7')).length).toBeLessThanOrEqual(XLEAK_ACCEPTED_MAX);
  });

  // A "frozen@9b7f0ea3" why is a claim: both sides must be byte-identical to the items present at the
  // freeze line. Re-derive the texts of every referenced pack AT 9b7f0ea3 (git archive) and compare hashes.
  const hasFreezeLine = spawnSync('git', ['cat-file', '-e', `${FREEZE_SHA}^{commit}`], { cwd: REPO_ROOT, windowsHide: true }).status === 0;
  it.skipIf(!hasFreezeLine)('every frozen@9b7f0ea3 entry has both side texts unchanged since 9b7f0ea3', () => {
    const frozen = baseline.entries.filter((e) => e.why.startsWith('frozen@9b7f0ea3'));
    expect(frozen.length).toBeGreaterThan(0);
    const packPath = (id: string): string => {
      const [kind, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
      if (kind === 'eb') return `content/seed/explainback/${rest.split(' ')[0]}`;
      return `content/seed/${kind === 'note' ? 'notes' : 'quests'}/${rest.split('/')[0]}`;
    };
    const paths = [...new Set(frozen.flatMap((e) => [e.a, e.b]).map(packPath))].flatMap((p) => [`${p}/items.json`, `${p}/manifest.json`]);
    const dir = join(tmp, 'at-freeze-line');
    mkdirSync(dir, { recursive: true });
    const tarFile = join(dir, 'seed.tar');
    const arch = spawnSync('git', ['archive', '-o', tarFile, FREEZE_SHA, '--', ...paths], { cwd: REPO_ROOT, windowsHide: true, encoding: 'utf8' });
    expect(arch.status, arch.stderr).toBe(0);
    const untar = spawnSync('tar', ['-xf', 'seed.tar'], { cwd: dir, windowsHide: true, encoding: 'utf8' });
    expect(untar.status, untar.stderr).toBe(0);
    const then = xleakEstate(join(dir, 'content', 'seed')).texts;
    const notFrozen = frozen.filter((e) => {
      const a = then.get(e.a);
      const b = then.get(e.b);
      return a === undefined || b === undefined || textHash(a) !== e.aHash || textHash(b) !== e.bHash;
    });
    expect(notFrozen.map(pairId)).toEqual([]);
  }, 120_000);
});
