import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SeedItemsFile, type SeedFlashcardItem, type SeedQuizItem } from '@bootquest/shared';
import { openCheckout } from '../checkout.ts';
import { plantAndie } from '../demo/plant.ts';
import { Exclusions } from '../exclusions.ts';
import { loadSeedPack } from '../pack.ts';
import { hashOrder } from '../util.ts';
import { isArtifactExplanation } from '../../ops/explanation-lint.ts';
import { findingLocationExplanation, generateQuestCandidates, goalCheckExplanation, LENGTH_TELL_RATIO, lengthTellReason, MAX_DISTRACTORS, pickGoalCheckDistractors } from './generate.ts';
import { extractFindings, extractGoalChecks, headings, scanLines } from './parse.ts';
import { runQuests } from './run.ts';
import { singleKeyedProblems, validateQuestItem } from './validate.ts';

// The fixture checkouts have no git mirror, so their pins are caller-asserted: these tests use the
// writers' explicit escape hatch (pack.ts unverifiedPinProblem) to stamp them.
process.env.BOOTQUEST_SEED_ALLOW_UNVERIFIED_PIN = '1';

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

  it('a bare mid-sentence **Goal** is prose, not a marker (master3 05-PRACTICE.md:3 intro)', () => {
    // verbatim master3@913823e astraupskill/05-PRACTICE.md:1-9 — act-3 slice C shipped this intro as
    // a junk goal-check ("Goal: (what to work out by reading code) and a") before the parser fix
    const md = [
      '# Practice exercises',
      '',
      'Each exercise has a **Goal** (what to work out by reading code) and a **Check** (a `node:test` file you run to confirm your answer). Checks need no `npm install`: save each one anywhere outside the repo and run it from the repo root with',
      '',
      '```bash',
      'node --experimental-strip-types --test path/to/check.test.mjs',
      '```',
      '',
      '(Node 22.6 or newer.) Domain checks import the real `packages/domain/src/index.ts`; service checks read source text because the service needs Prisma.',
    ].join('\n');
    const lines = scanLines(md);
    const { items, skips } = extractGoalChecks(lines, headings(lines));
    expect(items).toEqual([]);
    // the orphaned **Check** in the intro is counted, never silently dropped
    expect(skips).toEqual([expect.objectContaining({ line: 3, reason: 'check-without-goal' })]);
  });

  it('an intro sentence before real exercises yields only the real exercises (atlas final-system-design.md:103-115)', () => {
    // verbatim organized-study-atlas-fulfillment@d82cc29 docs/architecture/final-system-design.md:103-111
    const md = [
      '## Exercises',
      '',
      'Each has a **Goal** and a **Check** you can observe.',
      '',
      '1. **Reserve an order end to end.**',
      '   *Goal:* after `db:push` and `db:seed`, run the API and `curl -X POST -H "x-user-id: user-warehouse-lead" http://127.0.0.1:4000/api/orders/so-10035/reserve`.',
      '   *Check:* the response is `{ "ok": true, "status": "allocated", ... }`; `GET /api/inventory` now shows the west green pack (`PACK-22-GRN`) with `reserved` 38 and `available` 4; a second identical POST returns `ok: true` without changing the numbers.',
      '2. **See the role ranking.**',
      '   *Goal:* as `user-buyer`, call the reserve endpoint and the CSV export.',
      '   *Check:* reserve returns 403 with `requiredRoles: ["warehouse_manager", "admin"]`; the export returns 200.',
    ].join('\n');
    const lines = scanLines(md);
    const { items, skips } = extractGoalChecks(lines, headings(lines));
    expect(items.map((i) => i.goal)).toEqual([
      'after `db:push` and `db:seed`, run the API and `curl -X POST -H "x-user-id: user-warehouse-lead" http://127.0.0.1:4000/api/orders/so-10035/reserve`.',
      'as `user-buyer`, call the reserve endpoint and the CSV export.',
    ]);
    // verbatim checks: the first item's Check must NOT absorb the next list item's title
    expect(items.map((i) => i.checks)).toEqual([
      ['the response is `{ "ok": true, "status": "allocated", ... }`; `GET /api/inventory` now shows the west green pack (`PACK-22-GRN`) with `reserved` 38 and `available` 4; a second identical POST returns `ok: true` without changing the numbers.'],
      ['reserve returns 403 with `requiredRoles: ["warehouse_manager", "admin"]`; the export returns 200.'],
    ]);
    expect(items.map((i) => [i.lineStart, i.lineEnd])).toEqual([[6, 7], [9, 10]]);
    expect(items.flatMap((i) => i.checks).some((c) => /you can observe/.test(c))).toBe(false);
    expect(skips).toEqual([expect.objectContaining({ line: 3, reason: 'check-without-goal' })]);
  });

  it('a Goal/Check on continuation lines ends at the next sibling list item (atlas final-system-design.md:111-116)', () => {
    // verbatim organized-study-atlas-fulfillment@d82cc29 docs/architecture/final-system-design.md:111-116
    // (+ two synthetic lines: a nested bullet under a Check stays part of it); before the fix each
    // non-final Check ended with the next item's title ("... the export returns 200. 3. **Pass the actor through.**")
    const md = [
      '2. **See the role ranking.**',
      '   *Goal:* as `user-buyer`, call the reserve endpoint and the CSV export.',
      '   *Check:* reserve returns 403 with `requiredRoles: ["warehouse_manager", "admin"]`; the export returns 200.',
      '3. **Pass the actor through.**',
      '   *Goal:* add an `actorId` parameter to `reserveSalesOrder` and `runReconciliation`, and pass `request.actor.id` from `app.ts`.',
      '   *Check:* after exercise 1, `GET /api/audit-logs` (as admin) shows an `order.reserved` row with `actorId: "user-warehouse-lead"`.',
      '4. **Make reconciliation warehouse-aware.**',
      '   *Goal:* include the warehouse code in the duplicate check (or store `inventoryItemId` on the notification).',
      '   *Check:* a nested detail',
      '     - still belongs to this check',
    ].join('\n');
    const lines = scanLines(md);
    const { items, skips } = extractGoalChecks(lines, headings(lines));
    expect(skips).toEqual([]);
    expect(items.map((i) => i.checks)).toEqual([
      ['reserve returns 403 with `requiredRoles: ["warehouse_manager", "admin"]`; the export returns 200.'],
      ['after exercise 1, `GET /api/audit-logs` (as admin) shows an `order.reserved` row with `actorId: "user-warehouse-lead"`.'],
      ['a nested detail - still belongs to this check'],
    ]);
    expect(items.flatMap((i) => i.checks).some((c) => /\*\*/.test(c))).toBe(false);
  });

  it('a bare **Goal** still counts at the start of a line or list item, and with a colon anywhere', () => {
    const md = [
      '## A',
      '',
      '**Goal** read the router. **Check** you can name its fallback.',
      '',
      '## B',
      '',
      '1. **Goal** trace one request. **Check:** the log shows two spans.',
      '',
      '## C',
      '',
      'Exercise 3 — **Goal**: find the retry rule. **Check:** you can quote it.',
    ].join('\n');
    const lines = scanLines(md);
    const { items, skips } = extractGoalChecks(lines, headings(lines));
    expect(skips).toEqual([]);
    expect(items.map((i) => [i.shape, i.goal, i.checks])).toEqual([
      ['sectioned', 'read the router.', ['you can name its fallback.']],
      ['inline', 'trace one request.', ['the log shows two spans.']],
      ['sectioned', 'find the retry rule.', ['you can quote it.']],
    ]);
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
    // 41/19 before factory-3: the 05-PRACTICE.md:33 goal-check (key 357 chars vs a longest distractor of 207) is a
    // length tell with no length-matched set in the guide, so it is now a counted skip, not a candidate
    expect(a.write!.manifest).toMatchObject({ candidates: 40, quarantined: 0, review: 8, dropped: 0, counts: { total: 32, byKind: { flashcard: 11, quiz: 18, 'reading-step': 3 } } });
    expect(a.write!.manifest.skipped.filter((s) => s.reason.startsWith('length-tell')).map((s) => s.subject)).toEqual(['astraupskill/05-PRACTICE.md:33']);
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

describe('goal-check answer-LENGTH tells (factory-3, docs/SEEDING.md backlog)', () => {
  // a pool whose first MAX_DISTRACTORS members in the generator's hash order get lengths[0..2], the rest lengths[3..]
  const pool = (key: string, lengths: number[]) => {
    const ids = lengths.map((_, i) => `other-${i}`);
    const ordered = hashOrder(ids, key, (x) => x);
    return ordered.map((id, i) => ({ text: `${id} `.padEnd(lengths[i]!, 'x'), evidence: [id] }));
  };

  it('a pick that does not tell is the historical hash-order pick, byte for byte', () => {
    const p = pool('k1', [100, 90, 80, 10, 10]);
    const r = pickGoalCheckDistractors('a'.repeat(120), p, 'k1');
    expect(r.lengthTell).toBeNull();
    expect(r.distractors).toEqual(hashOrder(p, 'k1', (d) => d.evidence[0]!).slice(0, MAX_DISTRACTORS));
  });

  it('a telling pick is re-picked from length-matched Checks when the guide has enough', () => {
    const p = pool('k2', [20, 20, 20, 95, 110, 130, 15]);
    const answer = 'a'.repeat(120);
    expect(lengthTellReason(answer, hashOrder(p, 'k2', (d) => d.evidence[0]!).slice(0, MAX_DISTRACTORS))).toMatch(/^length-tell/);
    const r = pickGoalCheckDistractors(answer, p, 'k2');
    expect(r.lengthTell).toBeNull();
    expect(r.distractors.map((d) => d.text.length).sort((a, b) => a - b)).toEqual([95, 110, 130]);
    expect(lengthTellReason(answer, r.distractors)).toBeNull();
  });

  it('with no length-matched set the item is a counted length-tell skip, never fewer distractors', () => {
    const r = pickGoalCheckDistractors('a'.repeat(400), pool('k3', [100, 150, 20, 30]), 'k3');
    expect(r.distractors).toEqual([]);
    expect(r.lengthTell).toBe(`length-tell (key 400 chars > ${LENGTH_TELL_RATIO}x the longest distractor 150 chars; the guide has no length-matched set of 3 other Checks)`);
    // exactly 1.5x is not a tell; one char more is
    expect(lengthTellReason('a'.repeat(150), [{ text: 'b'.repeat(100) }])).toBeNull();
    expect(lengthTellReason('a'.repeat(151), [{ text: 'b'.repeat(100) }])).toMatch(/^length-tell/);
  });

  it('no shipped-shape goal-check from the fixtures keys a Check longer than 1.5x its longest distractor', () => {
    const co = openCheckout({ root: join(FX, 'ww6'), sha: WW6, repo: 'ww6' });
    const quizzes = generateQuestCandidates(co, GUIDES_0506, ex).guides.flatMap((g) => g.items).filter((i): i is SeedQuizItem => i.kind === 'quiz' && i.variety === 'goal-check');
    expect(quizzes.length).toBeGreaterThan(0);
    for (const q of quizzes) {
      const key = q.choices[q.check.answerKey]!.text;
      const longest = Math.max(...q.choices.filter((_, i) => i !== q.check.answerKey).map((c) => c.text.length));
      expect(key.length, q.key).toBeLessThanOrEqual(LENGTH_TELL_RATIO * longest);
    }
  });
});

describe('finding-location explanations (release review: bare "3" explanations)', () => {
  it('keep the label and severity, but never ship a bare list number as the explanation', () => {
    expect(findingLocationExplanation('docs/r.md', { label: 'F3', severity: 'Medium', lineStart: 9, lineEnd: 9 })).toBe('F3 (Medium)');
    expect(findingLocationExplanation('docs/r.md', { label: '3', severity: 'High', lineStart: 9, lineEnd: 9 })).toBe('3 (High)');
    expect(findingLocationExplanation('docs/r.md', { label: 'Missing tenant filter', lineStart: 9, lineEnd: 9 })).toBe('Missing tenant filter');
    for (const label of ['3', '12', '-', '']) {
      const s = findingLocationExplanation('docs/r.md', { label, lineStart: 9, lineEnd: 11 });
      expect(s, label).toMatch(/^In docs\/r\.md:9-11, the guide records this defect/);
      expect(isArtifactExplanation(s), label).toBe(false);
    }
  });
});

describe('goal-check explanations (campaign 2 review F5)', () => {
  it('say where the guide pairs the Goal with the Check, never the raw parser label', () => {
    expect(goalCheckExplanation('docs/a.md', { label: '1', lineStart: 4, lineEnd: 4 })).toBe('In docs/a.md:4, the guide pairs this Goal with this Check; the other choices are the Checks of other exercises in the same guide.');
    expect(goalCheckExplanation('docs/a.md', { label: '-', lineStart: 4, lineEnd: 6 })).toMatch(/^In docs\/a\.md:4-6, the guide pairs/);
    expect(goalCheckExplanation('docs/a.md', { label: 'goal 2', lineStart: 4, lineEnd: 6 })).toMatch(/^In docs\/a\.md:4-6, the guide pairs/);
    expect(goalCheckExplanation('g.md', { label: 'Level 1 — policy table', lineStart: 5, lineEnd: 7 })).toMatch(/^In g\.md:5-7 \(exercise "Level 1 — policy table"\), the guide pairs/);
  });

  it('the inline (zz9) and sectioned (ww6) generator quizzes carry real explanations', () => {
    const z = generateQuestCandidates(openCheckout({ root: join(FX, 'zz9'), sha: ZZ9 }), ['docs/architecture/auth-and-permissions.md'], ex);
    const w = generateQuestCandidates(openCheckout({ root: join(FX, 'ww6'), sha: WW6, repo: 'ww6' }), GUIDES_0506, ex);
    const gcs = [...z.guides, ...w.guides].flatMap((g) => g.items).filter((i): i is SeedQuizItem => i.kind === 'quiz' && i.variety === 'goal-check');
    expect(gcs.length).toBeGreaterThan(4);
    for (const q of gcs) {
      expect(q.explanation).not.toMatch(/^(\d+|-) \(.*item\)$|^goal \d+$/i);
      expect(q.explanation).toContain(`${q.provenance.path}:${q.provenance.lines.start}`);
    }
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
    // a bare .git/HEAD with no objects proves nothing: only a real, listable repo earns git-head (pins.test.ts)
    expect(r3.write!.manifest.source.pin).toBe('caller-asserted');
  });
});
