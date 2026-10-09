// W7 factory fixes (LEARNING.md W5c-js / W5c-katas lists): citation false positives,
// the `- Goal:` / `- **Check:**` bullet shape, reading-step key collisions, the
// per-repo citation whitelist, and the new quiz / flashcard enum values.
import { SeedItem } from '@bootquest/shared';
import { describe, expect, it } from 'vitest';
import { looksLikeFile, looksLikeNamespace, parseCitations } from '../citations/parse.ts';
import { ExclusionRegistry, Exclusions } from './exclusions.ts';
import { readingStepKeyBases } from './quests/generate.ts';
import { extractGoalChecks, headings, scanLines } from './quests/parse.ts';

const cites = (md: string) => parseCitations(md, 'docs/guide.md').citations.map((c) => [c.form, c.path, c.lineStart]);

describe('citation parser: command names and namespaces are not citations', () => {
  it('npm.cmd / npx.cmd shims are not files', () => {
    expect(cites('Run `npm.cmd` then `npx.cmd vitest`.')).toEqual([]);
    expect(looksLikeFile('npm.cmd')).toBe(false);
    // a real .cmd script with a directory still is one
    expect(looksLikeFile('scripts/build.cmd')).toBe(true);
  });

  it('System.* / Microsoft.* / 3+ PascalCase segments are namespaces', () => {
    expect(cites('Use `System.Text.Json` and `Microsoft.AspNetCore.Http`.')).toEqual([]);
    expect(looksLikeNamespace('System.Text.Json')).toBe(true);
    expect(looksLikeNamespace('Contoso.Billing.Invoices')).toBe(true);
    expect(looksLikeNamespace('appsettings.json')).toBe(false);
    expect(looksLikeFile('appsettings.json')).toBe(true);
  });

  it('a bare `Program.cs` concept word is not a citation; a located one still is', () => {
    expect(cites('Register the service in `Program.cs`.')).toEqual([]);
    expect(cites('See `src/Program.cs:12`.')).toEqual([['path-line', 'src/Program.cs', 12]]);
    expect(cites('See `Program.cs:12-14`.')).toEqual([['path-line', 'Program.cs', 12]]);
    expect(cites('Open `src/Api/Program.cs`.')).toEqual([['path-only', 'src/Api/Program.cs', null]]);
    expect(cites('Bare prose src/Program.cs:7 counts.')).toEqual([['path-line', 'src/Program.cs', 7]]);
  });
});

describe('quest parser: `- Goal:` / `- **Check:**` bullet shape (nettrello astraupskill/05-PRACTICE.md)', () => {
  const md = [
    '# Practice',
    '',
    '## Exercises',
    '',
    '**1. Omitted versus null.**',
    '- Goal: send a title-only patch and predict every field.',
    '- **Check:** `CardPatchTests.TitleOnlyPatch_AppliesTitle`; over HTTP, `BoardApiTests.TitleOnlyPatch`.',
    '',
    '**2. Malformed bodies.**',
    '- Goal: predict status and code for `{}`.',
    '- **Check:** the five rows of `CardPatchTests.MalformedPatch`.',
    '',
    'Prose that mentions Goal: in a sentence is not an exercise.',
    '',
  ].join('\n');
  const lines = scanLines(md);
  const { items, skips } = extractGoalChecks(lines, headings(lines));

  it('extracts both exercises with their bold labels, goal and check text', () => {
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      shape: 'sectioned',
      label: '1. Omitted versus null',
      goal: 'send a title-only patch and predict every field.',
      checks: ['`CardPatchTests.TitleOnlyPatch_AppliesTitle`; over HTTP, `BoardApiTests.TitleOnlyPatch`.'],
      lineStart: 5,
      lineEnd: 7,
    });
    expect(items[1]!.label).toBe('2. Malformed bodies');
    expect(items[1]!.checks).toEqual(['the five rows of `CardPatchTests.MalformedPatch`.']);
    expect(skips).toEqual([]);
  });

  it('the plain-word bullet `- Check:` pairs too; a goal with no check is still counted unpaired', () => {
    const l2 = scanLines(['**A.**', '- Goal: do x.', '- Check: y passes.', '', '**B.**', '- Goal: lonely.', ''].join('\n'));
    const r = extractGoalChecks(l2, headings(l2));
    expect(r.items.map((i) => [i.label, i.goal, i.checks])).toEqual([['A', 'do x.', ['y passes.']]]);
    expect(r.skips.map((s) => s.reason)).toEqual(['unpaired-goal']);
  });
});

describe('reading-step keys: basename, unless two guides of one run share it', () => {
  it('unique basenames keep the historical basename key (shipped packs unchanged)', () => {
    expect([...readingStepKeyBases(['astraupskill/01-a.md', 'astraupskill/02-b.md']).values()]).toEqual(['01-a.md', '02-b.md']);
  });
  it('colliding basenames switch to the full repo-relative path', () => {
    const m = readingStepKeyBases(['apps/a/docs/learning/01.md', 'apps/b/docs/learning/01.md', 'docs/learning/02.md']);
    expect(m.get('apps/a/docs/learning/01.md')).toBe('apps/a/docs/learning/01.md');
    expect(m.get('apps/b/docs/learning/01.md')).toBe('apps/b/docs/learning/01.md');
    expect(m.get('docs/learning/02.md')).toBe('02.md');
  });
});

describe('per-repo citation whitelist', () => {
  const reg = ExclusionRegistry.parse({
    format: 'bootquest-seed-exclusions@1',
    entries: [],
    citationWhitelist: [
      { repo: '*', pattern: 'dev.db', note: 'runtime file' },
      { repo: 'j1', pattern: 'tests/', note: 'Checks name test files the learner writes' },
      { repo: 'j1', pattern: 'src/**/*.generated.ts', note: 'gitignored codegen output' },
    ],
    secretPatterns: [{ id: 'x', regex: 'NEVERMATCHES_[0-9]{40}' }],
  });
  const ex = new Exclusions(reg);
  it('matches exact / suffix, dir/ prefix and globs, scoped to the repo', () => {
    expect(ex.citationWhitelistHit('any', 'prisma/dev.db')).toEqual({ pattern: 'dev.db', note: 'runtime file' });
    expect(ex.citationWhitelistHit('j1', 'tests/new.test.ts')?.pattern).toBe('tests/');
    expect(ex.citationWhitelistHit('j1', 'src/api/x.generated.ts')?.pattern).toBe('src/**/*.generated.ts');
    expect(ex.citationWhitelistHit('ww6', 'tests/new.test.ts')).toBeNull(); // other repo
    expect(ex.citationWhitelistHit('j1', 'src/api/x.ts')).toBeNull();
  });
  it('the whitelisted mark is a schema-valid, visible field on a shipped citation', () => {
    const item = SeedItem.parse({
      kind: 'reading-step',
      key: 'seed:quests:j1/reading-step/0123456789abcdef',
      provenance: { repo: 'j1', sha: 'efc26ca', path: 'a.md', lines: { start: 1, end: 2 } },
      citations: [{ raw: 'tests/new.test.ts', path: 'tests/new.test.ts', lineStart: null, lineEnd: null, form: 'path-only', sourceLine: 1, whitelisted: { pattern: 'tests/', note: 'n' } }],
      title: 't',
      headingPath: ['t'],
    });
    expect(item.citations[0]!.whitelisted?.pattern).toBe('tests/');
  });
});

describe('seed-pack enums (W7)', () => {
  const base = { key: 'seed:quests:r/x/0123456789abcdef', provenance: { repo: 'r', sha: 'abcdef1', path: 'a.md', lines: { start: 1, end: 1 } } };
  it("quiz variety 'concept' is accepted", () => {
    const q = SeedItem.safeParse({
      ...base,
      kind: 'quiz',
      variety: 'concept',
      prompt: 'p?',
      choices: [{ text: 'a' }, { text: 'b' }],
      check: { type: 'quiz', itemKey: base.key, grading: 'choice', answerKey: 0, choices: ['a', 'b'] },
    });
    expect(q.success).toBe(true);
    expect(SeedItem.safeParse({ ...base, kind: 'quiz', variety: 'trivia', prompt: 'p', choices: [{ text: 'a' }, { text: 'b' }], check: { type: 'quiz', itemKey: 'k', grading: 'choice', answerKey: 0 } }).success).toBe(false);
  });
  it("flashcard shape 'hand-authored' is accepted", () => {
    expect(SeedItem.safeParse({ ...base, kind: 'flashcard', shape: 'hand-authored', label: 'H1', front: 'f', back: 'b', observation: 'read-derived' }).success).toBe(true);
  });
});
