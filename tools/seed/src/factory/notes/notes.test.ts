import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NotesDraft, SeedNoteItem, SeedQuizItem } from '@bootquest/shared';
import { checkPack } from '../check/check.ts';
import { openCheckout } from '../checkout.ts';
import { Exclusions } from '../exclusions.ts';
import { loadSeedPack } from '../pack.ts';
import { DEFAULT_SEED_DIR } from '../report.ts';
import { runQuests } from '../quests/run.ts';
import { buildNoteItem, keyedAnswer, loadQuestPackView, noteLeaks, validateNote, type QuestPackView } from './notes.ts';
import { runNotes } from './run.ts';

// The fixture checkouts have no git mirror, so their pins are caller-asserted: these tests use the
// writers' explicit escape hatch (pack.ts unverifiedPinProblem) to stamp them.
process.env.BOOTQUEST_SEED_ALLOW_UNVERIFIED_PIN = '1';

const FX = join(import.meta.dirname, '..', 'fixtures');
const D = join(FX, 'drafts');
const WW6 = '09751ceaee909a30e5c4b5ff5cdde99880b9a3e5';
const tmp = mkdtempSync(join(tmpdir(), 'bq-notes-test-'));
const seed = join(tmp, 'seed');
const questsDir = join(seed, 'quests');
const checkouts = join(tmp, 'checkouts');
const CO = join(checkouts, `ww6@${WW6}`);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let quests: QuestPackView;
beforeAll(() => {
  cpSync(join(FX, 'ww6'), CO, { recursive: true });
  const r = runQuests({ root: CO, sha: WW6, guides: ['astraupskill/05-PRACTICE.md', 'astraupskill/06-SOLUTIONS-AND-REVIEW.md'], out: join(questsDir, 'ww6') });
  expect(r.ok).toBe(true);
  quests = loadQuestPackView(join(questsDir, 'ww6'));
});

const run = (draft: string, out: string, extra: Partial<Parameters<typeof runNotes>[0]> = {}) =>
  runNotes({ checkout: CO, draft: draft.includes('/') || draft.includes('\\') ? draft : join(D, draft), questsDir, out, ...extra });
const good = (): NotesDraft => JSON.parse(readFileSync(join(D, 'notes-ww6.json'), 'utf8')) as NotesDraft;
const writeDraft = (name: string, d: NotesDraft): string => {
  const p = join(tmp, `${name}.json`);
  writeFileSync(p, `${JSON.stringify(d, null, 1)}\n`);
  return p;
};
const reasons = (r: ReturnType<typeof runNotes>): string => r.lines.join('\n');

describe('seed:notes', () => {
  it('a full-coverage draft is stamped: one after note per quiz, 2 pack readings, deterministic bytes', () => {
    const a = run('notes-ww6.json', join(seed, 'notes', 'ww6'));
    expect(reasons(a)).toContain('RESULT OK');
    const b = run('notes-ww6.json', join(tmp, 'rerun'));
    expect(b.ok).toBe(true);
    expect(readFileSync(join(tmp, 'rerun', 'items.json'), 'utf8')).toBe(readFileSync(join(seed, 'notes', 'ww6', 'items.json'), 'utf8'));
    const pack = loadSeedPack(join(seed, 'notes', 'ww6'), { requireStamp: true });
    expect(pack.manifest.generator).toBe('notes');
    expect(pack.items).toHaveLength(20);
    const items = pack.items as SeedNoteItem[];
    expect(items.filter((n) => n.phase === 'after').map((n) => n.target).sort()).toEqual(quests.quizzes.map((q) => q.key).sort());
    expect(items.filter((n) => n.phase === 'before' && n.target === 'pack')).toHaveLength(2);
    expect(pack.manifest.source.inputs).toContain(`quests:ww6@items-sha256:${quests.itemsSha256}`);
    expect(Object.keys(pack.manifest.blobs)).toContain('docs/learning/testing-rationale.md');
  });

  it('seed:check re-verifies a notes pack, and fails it once the quest pack bytes it was bound to change', async () => {
    const ok = await checkPack(join(seed, 'notes', 'ww6'), { seedDir: seed, checkouts });
    expect(ok.problems).toEqual([]);
    expect(ok.items).toBe(20);
    const copy = join(tmp, 'seed-drift');
    cpSync(seed, copy, { recursive: true });
    const qi = join(copy, 'quests', 'ww6', 'items.json');
    const m = join(copy, 'quests', 'ww6', 'manifest.json');
    // a re-seeded quest pack: re-write items + manifest consistently (the quest stamp goes stale too)
    const items = readFileSync(qi, 'utf8').replace('"Which location holds this defect?', '"Where is this defect?');
    writeFileSync(qi, items);
    const { createHash } = await import('node:crypto');
    const man = JSON.parse(readFileSync(m, 'utf8')) as { items: { sha256: string } };
    man.items.sha256 = createHash('sha256').update(items).digest('hex');
    writeFileSync(m, `${JSON.stringify(man, null, 1)}\n`);
    const bad = await checkPack(join(copy, 'notes', 'ww6'), { seedDir: copy, checkouts });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join('\n')).toMatch(/quest pack ww6: .*(stale\/invalid stamp|items\.json changed since the notes were validated)/);
  });

  it('planted: a quote that is not in its lines is quarantined and blocks the stamp', () => {
    const r = run('planted-notes-bad-quote.json', join(tmp, 'n1'));
    expect(r.ok).toBe(false);
    expect(reasons(r)).toContain('quote is not verbatim in those lines');
    expect(existsSync(join(tmp, 'n1', 'validation.json'))).toBe(false);
  });

  it('planted: an excerpt past the end of its file is quarantined', () => {
    const r = run('planted-notes-line-out-of-range.json', join(tmp, 'n2'));
    expect(r.ok).toBe(false);
    expect(reasons(r)).toContain('docs/learning/testing-rationale.md:900-902): line out of range (the file has 56 lines)');
  });

  it('planted: a reading that contains a keyed answer is quarantined (answer-first)', () => {
    const r = run('planted-notes-leaky-before.json', join(tmp, 'n3'));
    expect(r.ok).toBe(false);
    expect(reasons(r)).toContain('leaks an answer: body contains the keyed answer of quiz c6a7224a750a4855');
  });

  it('planted: an after note on a flashcard is quarantined and the quiz it left uncovered blocks the stamp', () => {
    const r = run('planted-notes-after-on-flashcard.json', join(tmp, 'n4'));
    expect(r.ok).toBe(false);
    expect(reasons(r)).toContain('an after note must target a quiz');
    expect(reasons(r)).toContain('COVERAGE coverage: 1 quiz(zes) without an accepted after note');
    expect(r.write?.stamped).toBe(false);
  });

  it('--allow-quarantine never stamps over a coverage gap', () => {
    const r = run('planted-notes-after-on-flashcard.json', join(tmp, 'n4b'), { allowQuarantine: true });
    expect(r.ok).toBe(false);
    expect(existsSync(join(tmp, 'n4b', 'validation.json'))).toBe(false);
  });

  it('refuses a draft whose sha / repo is not the quest pack pin, and an unknown pack', () => {
    const d = good();
    expect(reasons(run(writeDraft('sha', { ...d, sha: 'deadbeefcafe' }), join(tmp, 'r1')))).toContain('REFUSED draft sha deadbeefcafe != quest pack ww6 source.sha');
    expect(reasons(run(writeDraft('pack', { ...d, pack: 'nope' }), join(tmp, 'r2')))).toContain('REFUSED quest pack nope');
    expect(reasons(run(writeDraft('fmt', { ...d, format: 'x' as never }), join(tmp, 'r3')))).toContain('REFUSED draft is malformed');
  });

  it('duplicate ids, a second after note for one quiz, and an unknown target are each quarantined', () => {
    const d = good();
    const dupId = { ...d.notes[2]!, target: d.notes[3]!.target };
    const second = { ...d.notes[2]!, id: 'x-second-explanation' };
    const unknown = { ...d.notes[1]!, id: 'r09-unknown-target', target: 'seed:quests:ww6/quiz/0000000000000000' };
    const r = run(writeDraft('dups', { ...d, notes: [...d.notes, dupId, second, unknown] }), join(tmp, 'dups'));
    const t = reasons(r);
    expect(t).toContain(`duplicate note id ${d.notes[2]!.id}`);
    expect(t).toContain(`second after note for quiz ${d.notes[2]!.target}`);
    expect(t).toContain('target seed:quests:ww6/quiz/0000000000000000 is not an item key');
    expect(r.ok).toBe(false);
  });
});

describe('validateNote rules', () => {
  const ex = Exclusions.load();
  const co = () => openCheckout({ root: CO, sha: WW6, repo: 'ww6' });
  const base = () => good().notes[0]!;
  const verdict = (patch: Partial<ReturnType<typeof base>>, exOverride?: Exclusions) => {
    const c = co();
    return validateNote(c, exOverride ?? ex, quests, buildNoteItem(c, 'ww6', { ...base(), ...patch }));
  };
  const reason = (v: ReturnType<typeof verdict>) => (v.verdict === 'reject' || v.verdict === 'drop' ? v.reason : '');

  it('accepts the fixture reading as authored', () => {
    expect(verdict({}).verdict).toBe('accept');
  });

  it('bounds: title length, body words (before 300 / after 250), excerpt and readMore counts, quote length', () => {
    expect(reason(verdict({ title: 'Short' }))).toContain('title is 5 chars (needs 8-90)');
    expect(reason(verdict({ body: 'too few words here' }))).toContain('body is 4 words (a before note needs 60-300)');
    expect(reason(verdict({ body: Array.from({ length: 301 }, () => 'word').join(' ') }))).toContain('body is 301 words');
    const e = base().excerpts[0]!;
    expect(reason(verdict({ excerpts: [] }))).toContain('schema');
    expect(reason(verdict({ excerpts: [e, e, e, e, e] }))).toContain('5 excerpts (needs 1-4)');
    expect(reason(verdict({ excerpts: [{ ...e, quote: 'read-only roles' }] }))).toContain('quote is 15 chars (needs >= 20)');
    // token boundaries: a quote cut mid-word is not "verbatim" ("MAX = 3" must not stand for "MAX = 30")
    const lastWord = [...e.quote.matchAll(/\w{5,}/g)].at(-1)!;
    const midWord = e.quote.slice(0, lastWord.index + 3);
    expect(midWord.length).toBeGreaterThanOrEqual(20);
    expect(reason(verdict({ excerpts: [{ ...e, quote: midWord }] }))).toContain('quote is not verbatim in those lines (whitespace-normalized, at token boundaries)');
    const rm = { path: 'docs/learning/testing-rationale.md', lineStart: null, lineEnd: null, why: 'Background reading.' };
    expect(reason(verdict({ readMore: [rm, rm, rm, rm, rm] }))).toContain('5 readMore entries (max 4)');
    expect(reason(verdict({ readMore: [{ ...rm, why: 'short' }] }))).toContain('why is 5 chars (needs 8-200)');
  });

  it('no HTML and no images in the body (code spans are fine)', () => {
    const words = Array.from({ length: 60 }, () => 'word').join(' ');
    expect(reason(verdict({ body: `${words} <div>hi</div>` }))).toContain('body contains HTML');
    expect(reason(verdict({ body: `${words} ![alt](x.png)` }))).toContain('body contains an image');
    expect(verdict({ body: `${words} \`<Suspense>\` is fine in code` }).verdict).toBe('accept');
  });

  it('paths: missing files, line ranges, readMore ranges, id shape', () => {
    const e = base().excerpts[0]!;
    expect(reason(verdict({ excerpts: [{ ...e, path: 'docs/nope.md' }] }))).toContain('no such file');
    expect(reason(verdict({ excerpts: [{ ...e, lineStart: 9, lineEnd: 8 }] }))).toContain('lineStart > lineEnd');
    expect(reason(verdict({ readMore: [{ path: 'src/missing.ts', lineStart: null, lineEnd: null, why: 'Not really there.' }] }))).toContain('no such file');
    expect(reason(verdict({ readMore: [{ path: 'docs/learning/testing-rationale.md', lineStart: 1, lineEnd: 999, why: 'Out of range on purpose.' }] }))).toContain('line out of range');
    expect(reason(verdict({ readMore: [{ path: 'docs/learning/testing-rationale.md', lineStart: 1, lineEnd: null, why: 'Half a range given.' }] }))).toContain('both lineStart and lineEnd');
    expect(reason(verdict({ id: 'X!' }))).toContain('must match');
  });

  it('excluded files may not be quoted, pointed at or named', () => {
    const reg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'exclusions.json'), 'utf8')) as { entries: unknown[] };
    const exl = new Exclusions({ ...(reg as never), entries: [...reg.entries, { id: 'test-ww6-rationale', repo: 'ww6', paths: ['docs/learning/**'], reason: 'stale-anchors', note: 'test only' }] } as never);
    expect(reason(verdict({}, exl))).toContain('cites an excluded file: excluded:test-ww6-rationale');
    const e = { path: 'astraupskill/05-PRACTICE.md', lineStart: 1, lineEnd: 3, quote: '' };
    e.quote = readFileSync(join(CO, e.path), 'utf8').split('\n')[0]!.trim();
    const named = verdict({ excerpts: [e], readMore: [], body: `${base().body} See docs/learning/testing-rationale.md for more.` }, exl);
    expect(reason(named)).toContain('names docs/learning/testing-rationale.md: excluded:test-ww6-rationale');
  });

  it('an after note must target a quiz; a pack-wide after note is refused', () => {
    expect(reason(verdict({ phase: 'after' }))).toContain('an after note must target a quiz key');
  });
});

describe('noteLeaks (before notes never give a keyed answer away)', () => {
  const subj = (body: string, extra: Partial<Parameters<typeof noteLeaks>[0]> = {}) => ({ title: 'A neutral title', body, excerpts: [], readMore: [], ...extra });
  const quiz = (key: string, variety: SeedQuizItem['variety'] = 'concept'): SeedQuizItem =>
    ({
      kind: 'quiz',
      key: 'seed:quests:t/quiz/abc',
      variety,
      prompt: 'p',
      choices: [{ text: key, evidence: [] }, { text: 'other choice', evidence: [] }],
      check: { type: 'quiz', itemKey: 'seed:quests:t/quiz/abc', grading: 'choice', answerKey: 0, choices: [key, 'other choice'] },
      explanation: '',
      provenance: { repo: 't', sha: 'abcdef1', path: 'a.md', lines: { start: 1, end: 1 } },
      citations: [],
    }) as SeedQuizItem;

  it('normalized token-boundary substring', () => {
    const q = quiz('334, 333, 333');
    expect(keyedAnswer(q)).toBe('334, 333, 333');
    expect(noteLeaks(subj('The shares come out as 334, 333, 333 exactly.'), [q])[0]).toContain('body contains the keyed answer');
    expect(noteLeaks(subj('The SHARES: `334` `333` `333`.'), [q])[0]).toContain('contains the keyed answer');
    expect(noteLeaks(subj('A total of 1334 cents, 3333 cents.'), [q])).toEqual([]);
  });

  it('token-Jaccard >= 0.5 against a sentence or an answer-sized window', () => {
    const q = quiz('Everything under the page joins the client bundle');
    expect(noteLeaks(subj('Mark a page and everything under that page joins the bundle for clients, which is costly.'), [q])[0]).toMatch(/overlaps the keyed answer .*token-Jaccard/);
    expect(noteLeaks(subj('Server components ship no JavaScript for themselves.'), [q])).toEqual([]);
  });

  it('checks the title and every excerpt quote too', () => {
    const q = quiz('The first image');
    expect(noteLeaks(subj('nothing here', { title: 'It is the first image' }), [q])[0]).toContain('title contains');
    expect(noteLeaks(subj('nothing here', { excerpts: [{ path: 'x.ts', lineStart: 1, lineEnd: 1, quote: 'falls back to the first image' }] }), [q])[0]).toContain('excerpt 1 contains');
  });

  it('checks every readMore `why` (shown with the link before the learner answers)', () => {
    const q = quiz('The first image');
    const rm = (why: string) => [{ path: 'README.md', lineStart: null, lineEnd: null, why }];
    expect(noteLeaks(subj('nothing here', { readMore: rm('Read this: it explains why the view uses the first image.') }), [q])[0]).toContain('readMore 1 why contains the keyed answer');
    expect(noteLeaks(subj('nothing here', { readMore: rm('The course overview and how the sprints are organised.') }), [q])).toEqual([]);
  });

  it('a finding-location key: an excerpt or readMore range overlapping the keyed lines points at the answer', () => {
    const q = quiz('src/lib/auth/session.ts:13-22', 'finding-location');
    expect(noteLeaks(subj('neutral'), [q])).toEqual([]);
    expect(noteLeaks(subj('neutral', { excerpts: [{ path: 'src/lib/auth/session.ts', lineStart: 20, lineEnd: 25, quote: 'q' }] }), [q])[0]).toContain('points at the keyed location');
    expect(noteLeaks(subj('neutral', { readMore: [{ path: 'src/lib/auth/session.ts', lineStart: null, lineEnd: null }] }), [q])[0]).toContain('points at the keyed location');
    expect(noteLeaks(subj('neutral', { excerpts: [{ path: 'src/lib/auth/session.ts', lineStart: 1, lineEnd: 12, quote: 'q' }] }), [q])).toEqual([]);
    const bare = quiz('store.js:64', 'finding-location');
    expect(noteLeaks(subj('neutral', { excerpts: [{ path: 'src/store.js', lineStart: 60, lineEnd: 70, quote: 'q' }] }), [bare])[0]).toContain('points at the keyed location');
  });
});

describe('committed notes packs (content/seed/notes/*)', () => {
  const root = join(DEFAULT_SEED_DIR, 'notes');
  const packs = existsSync(root) ? readdirSync(root).filter((n) => existsSync(join(root, n, 'manifest.json'))) : [];

  it('there is at least one real notes pack', () => {
    expect(packs.length).toBeGreaterThan(0);
  });

  it.each(packs)('%s: every before note is free of every keyed answer of its quest pack', (name) => {
    // a content check, not a stamp check (seed:check owns that): a stale seed fingerprint must not mask a leak
    const pack = loadSeedPack(join(root, name), { allowStaleFingerprint: true });
    const q = loadQuestPackView(join(DEFAULT_SEED_DIR, 'quests', name));
    const before = (pack.items as SeedNoteItem[]).filter((n) => n.phase === 'before');
    expect(before.length).toBeGreaterThanOrEqual(2);
    for (const n of before) expect(noteLeaks(n, q.quizzes), n.noteId).toEqual([]);
  });
});
