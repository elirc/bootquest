import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SeedItemsFile, type SeedFlashcardItem, type SeedQuizItem } from '@bootquest/shared';
import { openCheckout } from '../checkout.ts';
import { plantAndie } from '../demo/plant.ts';
import { Exclusions } from '../exclusions.ts';
import { loadSeedPack } from '../pack.ts';
import { generateQuestCandidates } from './generate.ts';
import { extractFindings, extractGoalChecks, headings, scanLines } from './parse.ts';
import { runQuests } from './run.ts';
import { singleKeyedProblems, validateQuestItem } from './validate.ts';

const SEED = join(import.meta.dirname, '..', '..');
const FX = join(SEED, 'factory', 'fixtures');
const P4 = join(SEED, 'citations', 'fixtures');
const WW6 = '09751ceaee909a30e5c4b5ff5cdde99880b9a3e5';
const ZZ9 = 'a1982f8801804306ad317c135354f014d2c9ca70';
const HN = 'a9d10809613954b2cb8bea5df36b9faf3b931d2a';
const J1 = 'efc26ca7e2cd19dd481aeeba1aedf6bf0265948b';
const GUIDES_0506 = ['astraupskill/05-PRACTICE.md', 'astraupskill/06-SOLUTIONS-AND-REVIEW.md'];

const tmp = mkdtempSync(join(tmpdir(), 'bq-quests-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const out = (n: string) => join(tmp, n);
const parse = (file: string) => {
  const lines = scanLines(readFileSync(file, 'utf8'));
  return { lines, hs: headings(lines) };
};
const ex = Exclusions.load();

describe('guide shapes (real excerpts)', () => {
  it('sectioned Goal/Check with bold-lead labels (ww6 05-PRACTICE.md)', () => {
    const { lines, hs } = parse(join(FX, 'ww6', 'astraupskill', '05-PRACTICE.md'));
    const { items, skips } = extractGoalChecks(lines, hs);
    expect(items).toHaveLength(10);
    expect(skips).toEqual([]);
    expect(items[0]).toMatchObject({ shape: 'sectioned', label: 'Level 1 — policy table', goal: 'list all legal targets from PENDING and RUNNING and identify terminal statuses.', lineStart: 5, lineEnd: 7 });
    expect(items[0]!.checks).toEqual(['your answer matches `src/services/allocationRunService.ts:20-25` exactly.']);
  });

  it('inline Goal/Check list items, Goal and Check on one line (zz9 auth-and-permissions.md excerpt)', () => {
    const { lines, hs } = parse(join(FX, 'zz9', 'docs', 'architecture', 'auth-and-permissions.md'));
    const { items } = extractGoalChecks(lines, hs);
    expect(items.map((i) => [i.shape, i.label, i.goal])).toEqual([
      ['inline', '1', 'see revocation take effect.'],
      ['inline', '2', 'measure the timing gap.'],
      ['inline', '3', 'close the scope override.'],
      ['inline', '4', 'enforce assignment permission.'],
    ]);
    expect(items[2]!.checks[0]).toMatch(/^change `caseService.ts:96-100` so/);
  });

  it('separate paragraphs, a list inside the goal, several Checks per Goal; unpaired markers are counted', () => {
    const text = [
      '## Exercise 2: fix three paths',
      '',
      '**Goal:** fix the three defects:',
      '',
      '1. one',
      '2. two',
      '',
      '**Check:** `practice/diagnostics.test.mjs`. All three fail on the delivered code.',
      '',
      '**Check:** exercise 1 stays green.',
      '',
      '## Exercise 3',
      '**Goal:** an exercise with no check.',
      '',
      '**Check:** a stray check after a heading break.',
    ].join('\n');
    // the stray check belongs to the goal above it (same section) — only a check with no goal at all is counted
    const lines = scanLines(text);
    const { items, skips } = extractGoalChecks(lines, headings(lines));
    expect(items[0]).toMatchObject({ goal: 'fix the three defects: 1. one 2. two', checks: ['`practice/diagnostics.test.mjs`. All three fail on the delivered code.', 'exercise 1 stays green.'] });
    expect(items).toHaveLength(2);
    const orphan = scanLines('## A\n\n**Check:** nothing to verify.\n');
    expect(extractGoalChecks(orphan, headings(orphan)).skips).toEqual([{ line: 3, reason: 'check-without-goal', text: '**Check:** nothing to verify.' }]);
  });

  it('`**Goal.**` / bare `**Check.**`-then-fence (buildsubbox 05-PRACTICE.md:11-23) and the `*Goal:*` emphasis form', () => {
    const md = [
      '## Exercise 1 — Predict the recommendation order (easy)',
      '',
      '**Goal.** Understand that eligibility filters first and scoring only orders what is left.',
      '',
      'Read `eligible` and `recommendations` and compute the score of every item.',
      '',
      '**Check.**',
      '',
      '```powershell',
      'node -e "import(\'./src/model.js\').then(m => console.log(m.recommendations()))"',
      '```',
      '',
      'Your list matches the nine printed lines exactly.',
      '',
      '## Exercise 2 — Reject an item priced below cost (easy)',
      '',
      '**Goal.** One complete red -> green loop on a validator.',
      '',
      '**Check.** Before the fix: `# tests 37`, `# fail 1`. After: `# pass 37`.',
      '',
      '## Exercise 3',
      '',
      '*Goal:* read the queue module. *Check:* you can name its retry rule.',
    ].join('\n');
    const lines = scanLines(md);
    const { items, skips } = extractGoalChecks(lines, headings(lines));
    expect(skips).toEqual([]);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ shape: 'sectioned', goal: 'Understand that eligibility filters first and scoring only orders what is left. Read `eligible` and `recommendations` and compute the score of every item.', lineStart: 3, lineEnd: 11 });
    // the fenced block after the bare **Check.** IS the check
    expect(items[0]!.checks).toHaveLength(1);
    expect(items[0]!.checks[0]).toContain('node -e');
    expect(items[1]!.checks).toEqual(['Before the fix: `# tests 37`, `# fail 1`. After: `# pass 37`.']);
    expect(items[2]).toMatchObject({ goal: 'read the queue module.', checks: ['you can name its retry rule.'] });
  });

  it('F-table findings with severity + section honesty (ww6 06: "none reproduced" => read-derived)', () => {
    const { lines, hs } = parse(join(FX, 'ww6', 'astraupskill', '06-SOLUTIONS-AND-REVIEW.md'));
    const f = extractFindings(lines, hs);
    expect(f.map((x) => x.label)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13']);
    expect(f[0]).toMatchObject({ shape: 'f-table', severity: 'Critical', title: 'Authentication is a bare `x-user-id` header.', observation: 'read-derived', lineStart: 22 });
    expect(f[0]!.evidence).toBe('`src/lib/auth/session.ts:13-22`, `src/lib/http/client.ts:7,31`');
  });

  it('numbered findings under a findings heading (j1: "reproduced on" => author-recorded, never "observed")', () => {
    const { lines, hs } = parse(join(P4, 'j1', 'astraupskill', '06-SOLUTIONS-AND-REVIEW.md'));
    const f = extractFindings(lines, hs);
    expect(f.map((x) => [x.shape, x.label])).toEqual([1, 2, 3, 4, 5, 6].map((n) => ['numbered', String(n)]));
    expect(f[0]).toMatchObject({ title: 'A CRLF-converted snapshot is misdiagnosed as a broken legacy file.', observation: 'author-recorded' });
  });

  it('R-headings: severity/verification tags, labelled bullets, [AI] tag (hnjobtrack review.md)', () => {
    const { lines, hs } = parse(join(FX, 'hnjobtrack', 'training', '_answers', 'review.md'));
    const f = extractFindings(lines, hs);
    expect(f.map((x) => x.label)).toEqual(['R18', 'R19', 'R20', 'R21']);
    expect(f[3]).toMatchObject({ shape: 'r-heading', title: 'The auth callback ignores `exchangeCodeForSession` errors (`route.ts:28`).', consequence: 'An expired magic link lands on the dashboard logged out, with no message.' });
    expect(f[2]!.aiTag).toBe(true);
    const tagged = scanLines('**R1. The public anon key can modify listings. (critical, verified)**\n- Where: `schema.sql:79-137` has no RLS.\n- Impact: anyone can change listings.\n- Fix: the mid-03 migration.\n');
    expect(extractFindings(tagged, [])[0]).toMatchObject({ severity: 'critical', observation: 'author-recorded', title: 'The public anon key can modify listings.', evidence: '`schema.sql:79-137` has no RLS.', consequence: 'anyone can change listings. the mid-03 migration.' });
  });
});

describe('seed:quests over real excerpts', () => {
  it('ww6 05+06: counts, every shipped item validated, stamp written; byte-identical on a rerun (deterministic)', () => {
    const a = runQuests({ root: join(FX, 'ww6'), sha: WW6, repo: 'ww6', guides: GUIDES_0506, out: out('ww6-a') });
    expect(a.lines).toContain('RESULT OK');
    expect(a.write!.manifest).toMatchObject({ candidates: 41, quarantined: 0, review: 8, dropped: 0, counts: { total: 33, byKind: { flashcard: 11, quiz: 19, 'reading-step': 3 } } });
    expect(a.write!.stamped).toBe(true);
    const b = runQuests({ root: join(FX, 'ww6'), sha: WW6, repo: 'ww6', guides: GUIDES_0506, out: out('ww6-b') });
    for (const f of ['items.json', 'manifest.json', 'quarantine.json', 'review-queue.json', 'validation.json']) {
      expect(readFileSync(join(out('ww6-b'), f), 'utf8'), f).toBe(readFileSync(join(out('ww6-a'), f), 'utf8'));
    }
    const pack = loadSeedPack(out('ww6-a'), { requireStamp: true });
    const fc = pack.items.find((i) => i.kind === 'flashcard' && i.label === 'F1') as SeedFlashcardItem;
    expect(fc).toMatchObject({ front: 'F1 (Critical): Authentication is a bare `x-user-id` header. Evidence: `src/lib/auth/session.ts:13-22`, `src/lib/http/client.ts:7,31`', observation: 'read-derived', provenance: { repo: 'ww6', sha: WW6, path: 'astraupskill/06-SOLUTIONS-AND-REVIEW.md', lines: { start: 22, end: 22 } } });
    expect(fc.back).toMatch(/^Any caller with a user id is that user/);
    expect(fc.citations.map((c) => c.resolved)).toEqual(['src/lib/auth/session.ts', 'src/lib/http/client.ts', 'src/lib/http/client.ts']);
    // every cited/ingested file is pinned by git blob id
    expect(Object.keys(pack.manifest.blobs)).toContain('src/lib/auth/session.ts');
  });

  it('inheritAmbiguous and cross-block continuations are held for review, NOT a pass', () => {
    const rq = JSON.parse(readFileSync(join(out('ww6-a'), 'review-queue.json'), 'utf8')) as { entries: { key: string; warnings: string[] }[] };
    const warnings = rq.entries.flatMap((e) => e.warnings);
    expect(warnings.some((w) => w.startsWith('inheritAmbiguous: `:106-112` at astraupskill/06-SOLUTIONS-AND-REVIEW.md:25 bound to src/repositories/allocationRunRepository.ts'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('cross-block continuation: `:31` at astraupskill/05-PRACTICE.md:11 has no file in its own block; bound to src/services/allocationRunService.ts'))).toBe(true);
    const shipped = new Set(SeedItemsFile.parse(JSON.parse(readFileSync(join(out('ww6-a'), 'items.json'), 'utf8'))).items.map((i) => i.key));
    for (const e of rq.entries) expect(shipped.has(e.key)).toBe(false);
  });

  it('unresolvable citations quarantine the item; no stamp unless quarantine is explicitly allowed', () => {
    const r = runQuests({ root: join(P4, 'ww6'), sha: WW6, repo: 'ww6', guides: ['astraupskill/CORRUPTED-REVIEW.md'], out: out('corrupt') });
    expect(r.ok).toBe(false);
    const text = r.lines.join('\n');
    expect(text).toMatch(/-> line-out-of-range: src\/lib\/auth\/session.ts has 32 lines; cited 13-99/);
    expect(text).toMatch(/-> missing-file:/);
    expect(text).toMatch(/-> ambiguous-suffix: "route.ts" matches 2 files/);
    expect(text).toMatch(/STAMP none: \d+ candidate\(s\) quarantined/);
    const q = JSON.parse(readFileSync(join(out('corrupt'), 'quarantine.json'), 'utf8'));
    expect(q).toMatchObject({ format: 'bootquest-pack@1', source: 'quests/ww6' });
    expect(q.entries.length).toBe(r.write!.manifest.quarantined);
    // nothing acceptable at all: no stamp even with --allow-quarantine
    const none = runQuests({ root: join(P4, 'ww6'), sha: WW6, repo: 'ww6', guides: ['astraupskill/CORRUPTED-REVIEW.md'], out: out('corrupt1'), allowQuarantine: true });
    expect(none.ok).toBe(false);
    expect(none.lines.join('\n')).toMatch(/STAMP none: no accepted items/);
    // a real mixed run (testing-rationale.md cites test files absent from the excerpt tree): stamped with the quarantine withheld
    const mixed = [...GUIDES_0506, 'docs/learning/testing-rationale.md'];
    const blocked = runQuests({ root: join(FX, 'ww6'), sha: WW6, repo: 'ww6', guides: mixed, out: out('mixed1') });
    expect(blocked.ok).toBe(false);
    const allowed = runQuests({ root: join(FX, 'ww6'), sha: WW6, repo: 'ww6', guides: mixed, out: out('mixed2'), allowQuarantine: true });
    expect(allowed.ok).toBe(true);
    const stamp = JSON.parse(readFileSync(join(out('mixed2'), 'validation.json'), 'utf8'));
    const mq = JSON.parse(readFileSync(join(out('mixed2'), 'quarantine.json'), 'utf8'));
    expect(stamp.quarantinedKeys.length).toBeGreaterThan(0);
    expect(stamp.quarantinedKeys).toEqual(mq.entries.map((e: { key: string }) => e.key));
    expect(loadSeedPack(out('mixed2'), { requireStamp: true }).items.some((i) => stamp.quarantinedKeys.includes(i.key))).toBe(false);
  });

  it('inline (zz9) and R-heading (hnjobtrack) shapes end to end; findings without file:line are quarantined', () => {
    const z = runQuests({ root: join(FX, 'zz9'), sha: ZZ9, guides: ['docs/architecture/auth-and-permissions.md'], out: out('zz9') });
    expect(z.write!.manifest.counts.byKind.quiz).toBe(4);
    expect(z.ok).toBe(true);
    const h = runQuests({ root: join(FX, 'hnjobtrack'), sha: HN, guides: ['training/_answers/review.md'], out: out('hn') });
    expect(h.write!.manifest).toMatchObject({ quarantined: 2, counts: { byKind: { flashcard: 2 } } });
    expect(h.lines.filter((l) => l.includes('finding has no resolvable citation'))).toHaveLength(2);
  });

  it('j1 numbered findings resolve bare filenames by unique suffix', () => {
    const r = runQuests({ root: join(P4, 'j1'), sha: J1, guides: ['astraupskill/06-SOLUTIONS-AND-REVIEW.md'], out: out('j1') });
    expect(r.write!.manifest.counts.byKind.flashcard).toBeGreaterThanOrEqual(5);
    const items = loadSeedPack(out('j1')).items.filter((i): i is SeedFlashcardItem => i.kind === 'flashcard');
    expect(items.every((i) => i.observation === 'author-recorded')).toBe(true);
    expect(items.flatMap((i) => i.citations.map((c) => c.resolved))).toContain('src/todo/repository/TaskRepository.java');
  });

  it('a bare dotted identifier resolving to no file is dropped as a counted skip, never a quarantine (fix 3b)', () => {
    const root = join(tmp, 'ident');
    mkdirSync(join(root, 'astraupskill'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'config.js'), 'a\nb\n');
    writeFileSync(join(root, 'astraupskill', 'G.md'), '# G\n\n## One\n\nThe exporter writes the `state.history.json` member before `src/config.js:1` runs.\n');
    const r = runQuests({ root, sha: 'abcdef1', repo: 'identdemo', guides: ['astraupskill/G.md'], out: out('ident') });
    expect(r.ok).toBe(true);
    expect(r.write!.manifest.quarantined).toBe(0);
    expect(r.write!.manifest.skipped).toContainEqual({ subject: 'astraupskill/G.md:5', reason: expect.stringContaining('not-a-citation: `state.history.json`') });
    const step = loadSeedPack(out('ident')).items[0]!;
    expect(step.citations.map((c) => c.raw)).toEqual(['src/config.js:1']);
  });

  it('guides may cite files inside snapshot trees by exact path, while bare suffixes ignore snapshot dupes', () => {
    const root = join(tmp, 'snap');
    mkdirSync(join(root, 'astraupskill', 'snapshots'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'errors.ts'), 'a\nb\nc\n');
    writeFileSync(join(root, 'astraupskill', 'snapshots', 'errors.ts'), 'old\n');
    writeFileSync(join(root, 'astraupskill', 'snapshots', 'errors.ts.original.txt'), 'x\n');
    writeFileSync(join(root, 'astraupskill', 'G.md'), '# G\n\n## One\n\nSee [the original](snapshots/errors.ts.original.txt) and `errors.ts:3`.\n');
    const r = runQuests({ root, sha: 'abcdef1', repo: 'snapdemo', guides: ['astraupskill/G.md'], out: out('snap') });
    expect(r.ok).toBe(true);
    const step = loadSeedPack(out('snap')).items[0]!;
    expect(step.citations.map((c) => c.resolved)).toEqual(['astraupskill/snapshots/errors.ts.original.txt', 'src/errors.ts']);
  });
});

describe('single-keyed quiz validator', () => {
  const co = openCheckout({ root: join(FX, 'ww6'), sha: WW6, repo: 'ww6' });
  const cand = generateQuestCandidates(co, GUIDES_0506, ex);
  const quizzes = cand.guides.flatMap((g) => g.items).filter((i): i is SeedQuizItem => i.kind === 'quiz');
  const loc = quizzes.find((q) => q.variety === 'finding-location' && validateQuestItem(co, ex, q).verdict === 'accept')!;
  const gc = quizzes.find((q) => q.variety === 'goal-check' && validateQuestItem(co, ex, q).verdict === 'accept')!;

  it('a generated quiz is single-keyed', () => {
    expect(singleKeyedProblems(loc)).toEqual([]);
    expect(singleKeyedProblems(gc)).toEqual([]);
  });

  it('REJECTS a multi-keyable location quiz (a distractor cites a file the keyed finding cites)', () => {
    const k = loc.check.answerKey as number;
    const d = k === 0 ? 1 : 0;
    const bad = structuredClone(loc);
    bad.choices[d]!.evidence = [...bad.choices[d]!.evidence, bad.choices[k]!.evidence[0]!];
    const v = validateQuestItem(co, ex, bad);
    expect(v.verdict).toBe('reject');
    expect(v.verdict === 'reject' && v.reason).toMatch(/multi-keyable: choice \d shares evidence with the key/);
  });

  it('REJECTS near-duplicate choices, a prompt that reveals the key, an out-of-range key', () => {
    const k = gc.check.answerKey as number;
    const d = k === 0 ? 1 : 0;
    const dup = structuredClone(gc);
    dup.choices[d]!.text = `${dup.choices[k]!.text} `.replace('`', '');
    dup.check.choices = dup.choices.map((c) => c.text);
    expect(singleKeyedProblems(dup).join(' ')).toMatch(/ambiguous: choices \d and \d are \(near-\)duplicates/);
    const reveal = structuredClone(gc);
    reveal.prompt = `${reveal.prompt}\n(hint: ${reveal.choices[k]!.text})`;
    expect(singleKeyedProblems(reveal)).toContain('the prompt reveals the key');
    const range = structuredClone(gc);
    range.check.answerKey = 9;
    expect(singleKeyedProblems(range).join(' ')).toMatch(/answerKey 9 out of range/);
  });

  it('REJECTS a flashcard with no resolvable citation and one whose back is inside its front', () => {
    const fc = cand.guides.flatMap((g) => g.items).find((i): i is SeedFlashcardItem => i.kind === 'flashcard')!;
    const v1 = validateQuestItem(co, ex, { ...fc, citations: [] });
    expect(v1.verdict === 'reject' && v1.reason).toMatch(/finding has no resolvable citation/);
    const v2 = validateQuestItem(co, ex, { ...fc, front: `${fc.front} ${fc.back}` });
    expect(v2.verdict === 'reject' && v2.reason).toMatch(/back is contained in the front/);
  });

  it('a provenance that points outside the pinned sha or past the file end is rejected', () => {
    const v = validateQuestItem(co, ex, { ...gc, provenance: { ...gc.provenance, sha: 'ffffffff' } });
    expect(v.verdict === 'reject' && v.reason).toMatch(/provenance sha ffffffff != pinned/);
    const w = validateQuestItem(co, ex, { ...gc, provenance: { ...gc.provenance, lines: { start: 1, end: 999 } } });
    expect(w.verdict === 'reject' && w.reason).toMatch(/line-out-of-range/);
  });
});

describe('exclusions inside seed:quests', () => {
  const root = mkdtempSync(join(tmpdir(), 'bq-andie-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const andie = plantAndie(root, 'andie');

  it('discovery skips the excluded VERIFICATION.md and drops the item citing it — counted, never silent', () => {
    const r = runQuests({ root: andie, sha: 'deadbeefcafe', out: out('andie') });
    expect(r.ok).toBe(true);
    const m = r.write!.manifest;
    expect(m.skipped).toContainEqual({ subject: 'astraupskill/VERIFICATION.md', reason: 'excluded:andie-verification-token (leaked-secret)' });
    expect(m.dropped).toBeGreaterThanOrEqual(1);
    expect(m.skipped.some((s) => s.reason.includes('cites astraupskill/VERIFICATION.md: excluded:andie-verification-token'))).toBe(true);
    // the token never reaches the pack
    for (const f of ['items.json', 'manifest.json', 'review-queue.json', 'quarantine.json']) {
      expect(readFileSync(join(out('andie'), f), 'utf8')).not.toMatch(/shpat_/);
    }
    expect(m.source.inputs).not.toContain('astraupskill/VERIFICATION.md');
  });

  it('explicitly asking to ingest it is refused (exit nonzero)', () => {
    const r = runQuests({ root: andie, sha: 'deadbeefcafe', guides: ['astraupskill/VERIFICATION.md'], out: out('andie-x') });
    expect(r.ok).toBe(false);
    expect(r.refused).toMatch(/requested guide astraupskill\/VERIFICATION.md is excluded:andie-verification-token \(leaked-secret\)/);
  });

  it('the same planted token in an unregistered repo is an UNREGISTERED SECRET refusal', () => {
    const other = plantAndie(root, 'notandie');
    const r = runQuests({ root: other, sha: 'deadbeefcafe', out: out('notandie') });
    expect(r.ok).toBe(false);
    expect(r.refused).toMatch(/^UNREGISTERED SECRET: notandie\/astraupskill\/VERIFICATION.md matches secret pattern\(s\) shopify-token/);
  });

  it('a whole-repo exclusion (z8) refuses the run; a .git checkout at another sha is refused', () => {
    const r = runQuests({ root: join(FX, 'ww6'), sha: WW6, repo: 'z8', out: out('z8') });
    expect(r.refused).toMatch(/repo z8 is excluded:z8-test-time-bomb \(expiring-tests\)/);
    const g = join(root, 'gitco');
    cpSync(join(FX, 'zz9'), g, { recursive: true });
    mkdirSync(join(g, '.git'));
    writeFileSync(join(g, '.git', 'HEAD'), `${'1'.repeat(40)}\n`);
    const r2 = runQuests({ root: g, sha: ZZ9, repo: 'zz9', out: out('gitco') });
    expect(r2.refused).toMatch(/is at 111111111111, not the pinned a1982f88/);
    const r3 = runQuests({ root: g, sha: '1111111', repo: 'zz9', guides: ['docs/architecture/auth-and-permissions.md'], out: out('gitco2') });
    expect(r3.write!.manifest.source.pin).toBe('git-head');
  });
});
