import { describe, expect, it } from 'vitest';
import { looksLikeFile, parseCitations, type Citation } from './parse.ts';

const G = 'docs/guide.md';
const parse = (md: string) => parseCitations(md, G);
const brief = (cs: Citation[]) => cs.map((c) => [c.form, c.path, c.lineStart, c.lineEnd]);

describe('parseCitations: documented forms', () => {
  it('path:line, range, comma list (estate memo §2.3 F-table row)', () => {
    const { citations } = parse('| F1 | Critical | `src/lib/auth/session.ts:13-22`, `src/lib/http/client.ts:7,31` | x |');
    expect(brief(citations)).toEqual([
      ['path-line', 'src/lib/auth/session.ts', 13, 22],
      ['path-line', 'src/lib/http/client.ts', 7, 7],
      ['path-line', 'src/lib/http/client.ts', 31, 31],
    ]);
    // comma-list siblings share a group and raw text
    expect(citations[1]!.group).toBe(citations[2]!.group);
    expect(citations[0]!.group).not.toBe(citations[1]!.group);
    expect(citations[2]!.raw).toBe('src/lib/http/client.ts:7,31');
  });

  it('multi-entry lists :56,79,91', () => {
    const { citations } = parse('`src/services/allocationEngineService.ts:56,79,91`');
    expect(citations.map((c) => c.lineStart)).toEqual([56, 79, 91]);
  });

  it('bare filenames', () => {
    const { citations } = parse('the legacy parser (`TaskRepository.java:107`) and (`route.ts:28`).');
    expect(brief(citations)).toEqual([
      ['path-line', 'TaskRepository.java', 107, 107],
      ['path-line', 'route.ts', 28, 28],
    ]);
  });

  it('continuation `:12` inherits the previous file in the block', () => {
    const { citations } = parse('`budgetService.ts:18` has it despite the comment at `:12`, and `:71-75`.');
    expect(brief(citations)).toEqual([
      ['path-line', 'budgetService.ts', 18, 18],
      ['continuation', 'budgetService.ts', 12, 12],
      ['continuation', 'budgetService.ts', 71, 75],
    ]);
    expect(citations[1]!.inheritedFrom).toEqual({ file: G, line: 1, column: 2 });
  });

  it('prose "line 53" / "(line 47)" / "lines 15-40" / "lines 271 and 282" inherit too', () => {
    const md = [
      'in `save` (`TaskRepository.java:51`) and is preserved (line 53), see line 47.',
      '',
      'Open `forms/service.ts` (lines 15–40) and `schema.ts` lines 271 and 282.',
    ].join('\n');
    const { citations } = parse(md);
    expect(brief(citations)).toEqual([
      ['path-line', 'TaskRepository.java', 51, 51],
      ['prose-line', 'TaskRepository.java', 53, 53],
      ['prose-line', 'TaskRepository.java', 47, 47],
      ['path-only', 'forms/service.ts', null, null],
      ['prose-line', 'forms/service.ts', 15, 40],
      ['path-only', 'schema.ts', null, null],
      ['prose-line', 'schema.ts', 271, 271],
      ['prose-line', 'schema.ts', 282, 282],
    ]);
  });

  it('root-relative and md-relative paths (path-only) and directories', () => {
    const { citations } = parse('Re-run exercise 2 from `docs/architecture/README.md`, see [practice](../05-PRACTICE.md) and `src/app/`.');
    expect(brief(citations)).toEqual([
      ['path-only', 'docs/architecture/README.md', null, null],
      ['path-only', '../05-PRACTICE.md', null, null],
      ['path-only', 'src/app/', null, null],
    ]);
  });

  it('Goal/**Check** on one line and named test-file Check', () => {
    const md = [
      '3. **Goal:** close the scope override. **Check:** change `caseService.ts:96-100` so `...accessWhere` is spread last. Re-run exercise 2 from `docs/architecture/README.md`; the response must now be `{ "items": [] }`.',
      '',
      '**Check:** `practice/guarantees.test.mjs`. This passes on the delivered code.',
    ].join('\n');
    expect(brief(parse(md).citations)).toEqual([
      ['path-line', 'caseService.ts', 96, 100],
      ['path-only', 'docs/architecture/README.md', null, null],
      ['path-only', 'practice/guarantees.test.mjs', null, null],
    ]);
  });

  it('R-heading finding shape', () => {
    const md = '**R21. The auth callback ignores `exchangeCodeForSession` errors (`route.ts:28`).**\n- An expired magic link lands on the dashboard.';
    expect(brief(parse(md).citations)).toEqual([['path-line', 'route.ts', 28, 28]]);
  });
});

describe('parseCitations: forms found in the corpus beyond the memo', () => {
  it('mixed comma + range lists and spaces after commas', () => {
    const { citations } = parse('(`session.ts:17,22-24`) and (`today-client.tsx:140, 154`) and `Invoice.js:31-36, 178`');
    expect(brief(citations)).toEqual([
      ['path-line', 'session.ts', 17, 17],
      ['path-line', 'session.ts', 22, 24],
      ['path-line', 'today-client.tsx', 140, 140],
      ['path-line', 'today-client.tsx', 154, 154],
      ['path-line', 'Invoice.js', 31, 36],
      ['path-line', 'Invoice.js', 178, 178],
    ]);
  });

  it('en-dash / em-dash ranges', () => {
    expect(brief(parse('`alerting.ts:144–239` `x/a.ts:3—4`').citations)).toEqual([
      ['path-line', 'alerting.ts', 144, 239],
      ['path-line', 'x/a.ts', 3, 4],
    ]);
  });

  it('GitHub #L anchors in code spans and links (md-relative)', () => {
    const md = '**Read first**: `api/models/model.py#L421-L423`, [main](../src/main.jsx#L7), [all](src/JobTracker.jsx#L432-L470)';
    expect(brief(parse(md).citations)).toEqual([
      ['anchor', 'api/models/model.py', 421, 423],
      ['anchor', '../src/main.jsx', 7, 7],
      ['anchor', 'src/JobTracker.jsx', 432, 470],
    ]);
  });

  it('markdown link targets carrying :line, incl. Next.js catch-all [[...x]] segments', () => {
    const md =
      'see [router](../../packages/bot-engine/src/api/router.ts:68) and [page](../../apps/viewer/src/pages/[[...publicId]].tsx:28) and `src/app/[...slug]/page.tsx:3`';
    expect(brief(parse(md).citations)).toEqual([
      ['path-line', '../../packages/bot-engine/src/api/router.ts', 68, 68],
      ['path-line', '../../apps/viewer/src/pages/[[...publicId]].tsx', 28, 28],
      ['path-line', 'src/app/[...slug]/page.tsx', 3, 3],
    ]);
  });

  it('line:col suffix keeps the line, drops the column', () => {
    expect(brief(parse('`src/App.java:43:9`').citations)).toEqual([['path-line', 'src/App.java', 43, 43]]);
  });

  it('bare path:line in prose outside code spans', () => {
    expect(brief(parse('See src/lib/auth.ts:12-14, then the handler.').citations)).toEqual([
      ['path-line', 'src/lib/auth.ts', 12, 14],
    ]);
  });

  it('Next.js route segments with brackets and parens', () => {
    expect(brief(parse('`src/app/(app)/tasks/[id]/route.ts:9`').citations)).toEqual([
      ['path-line', 'src/app/(app)/tasks/[id]/route.ts', 9, 9],
    ]);
  });
});

describe('parseCitations: blocks, malformed and non-citations', () => {
  it('continuation does not cross a block boundary (orphan → malformed, path null)', () => {
    const md = '`a.ts:1`\n\nthe comment at `:12`\n| F2 | `b.ts:3` |\n| F3 | `:4` |';
    const { citations } = parse(md);
    expect(brief(citations)).toEqual([
      ['path-line', 'a.ts', 1, 1],
      ['continuation', null, 12, 12],
      ['path-line', 'b.ts', 3, 3],
      ['continuation', null, 4, 4],
    ]);
    expect(citations[1]!.malformed).toMatch(/no earlier file/);
    expect(citations[3]!.source).toEqual({ file: G, line: 5, column: 9 });
  });

  it('prose line ref with no file in the block is dropped with a note', () => {
    const { citations, notes } = parse('| 4 | `reviewAssignmentId @unique` (line 271) |');
    expect(citations).toEqual([]);
    expect(notes).toEqual([
      { kind: 'dropped-prose-line', raw: 'line 271', source: { file: G, line: 1, column: 37 }, message: expect.any(String) },
    ]);
  });

  it('list items each start a new block', () => {
    const md = '1. one `a.ts:1`\n2. two (line 5)\n   continued (line 6) `b.ts:2` then `:9`';
    const { citations, notes } = parse(md);
    expect(brief(citations)).toEqual([
      ['path-line', 'a.ts', 1, 1],
      ['path-line', 'b.ts', 2, 2],
      ['continuation', 'b.ts', 9, 9],
    ]);
    expect(notes.map((n) => n.raw)).toEqual(['line 5', 'line 6']);
  });

  it('flags inheritAmbiguous when the block cited 2+ files (real ww6 F4 shape)', () => {
    const md =
      '| F4 | High | `src/services/allocationRunService.ts:35-61`, `src/repositories/allocationRunRepository.ts:67-72` | catch path writes FAILED unguarded (`:106-112`). |';
    const c = parse(md).citations.at(-1)!;
    expect(c.path).toBe('src/repositories/allocationRunRepository.ts');
    expect(c.inheritAmbiguous).toEqual(['src/services/allocationRunService.ts', 'src/repositories/allocationRunRepository.ts']);
  });

  it('malformed line specs are retained with a reason', () => {
    const { citations } = parse('`foo.ts:` `foo.ts:12-` `foo.ts:12-x` `:3-`');
    expect(citations.map((c) => [c.raw, Boolean(c.malformed)])).toEqual([
      ['foo.ts:', true],
      ['foo.ts:12-', true],
      ['foo.ts:12-x', true],
      [':3-', true],
    ]);
  });

  it('zero and reversed ranges parse (resolver rejects them)', () => {
    expect(brief(parse('`a.ts:0` `a.ts:25-10`').citations)).toEqual([
      ['path-line', 'a.ts', 0, 0],
      ['path-line', 'a.ts', 25, 10],
    ]);
  });

  it('ignores non-paths: identifiers, URLs, ellipses, globs, hosts, product names, fenced code', () => {
    const md = [
      '`NEXT_PUBLIC_` `summary.matchedRules` `rules.length` `App.updated_at` `Integer.parseInt` `decode()`',
      '`...accessWhere` `src/.../x.ts:3` `src/**/*.ts` `localhost:3000` `127.0.0.1:5432` `db.example.com:5432`',
      '`npm test` `.mjs` `Node.js` `Next.js` `/api/tasks/` `@prisma/client` `Number(...)` `Decimal(12,2)`',
      'https://github.com/elirc/x/blob/main/src/a.ts#L3 and [gh](https://github.com/x/y/blob/main/b.ts#L1) [top](#setup)',
      'At 10:30 we met; ratio 3:2.',
      '```ts',
      'const x = require("src/a.ts:12");',
      '```',
    ].join('\n');
    expect(parse(md).citations).toEqual([]);
  });

  it('source locations are 1-based line/column of the raw text; BOM and CRLF tolerated', () => {
    const { citations } = parse('﻿# Title\r\n\r\nsee `a/b.ts:3` and x/y.ts:4\r\n');
    expect(citations.map((c) => c.source)).toEqual([
      { file: G, line: 3, column: 6 },
      { file: G, line: 3, column: 20 },
    ]);
  });

  it('looksLikeFile heuristics', () => {
    expect(looksLikeFile('Dockerfile')).toBe(true);
    expect(looksLikeFile('docker/Dockerfile')).toBe(true);
    expect(looksLikeFile('src/thing.weird')).toBe(true); // any extension once there is a '/'
    expect(looksLikeFile('thing.weird')).toBe(false);
    expect(looksLikeFile('.env')).toBe(true);
    expect(looksLikeFile('src/app')).toBe(false);
  });
});
