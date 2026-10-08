import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Citation } from './parse.ts';
import { buildRepoIndex, countLines, resolveCitation, type RepoIndex } from './resolve.ts';

let root: string;
let index: RepoIndex;

const files: Record<string, string> = {
  'src/lib/auth.ts': 'a\nb\nc\nd\ne\n', // 5 lines
  'src/routes/a/route.ts': '1\n2\n3\n',
  'src/routes/b/route.ts': '1\n2\n3\n4\n',
  'src/unique/Only.java': 'x\r\ny\r\nz', // 3 lines, CRLF, no trailing newline
  'docs/guide/README.md': '# guide\n',
  'docs/guide/notes.md': 'n\n',
  'docs/other/notes.md': 'n\n',
  'README.md': 'root readme\n',
  'empty.txt': '',
  'node_modules/pkg/index.js': 'ignored\n',
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cite-resolve-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  index = buildRepoIndex(root);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const GUIDE = 'docs/guide/README.md';
const cite = (p: string | null, s: number | null = null, e: number | null = s, extra: Partial<Citation> = {}): Citation => ({
  path: p,
  lineStart: s,
  lineEnd: e,
  form: s === null ? 'path-only' : 'path-line',
  raw: `${p}:${s}`,
  source: { file: GUIDE, line: 1, column: 1 },
  group: 1,
  ...extra,
});
const res = (c: Citation) => resolveCitation(root, GUIDE, c, index);

describe('resolveCitation: resolution modes', () => {
  it('root-relative', () => {
    expect(res(cite('src/lib/auth.ts', 2, 4))).toEqual({ status: 'ok', file: 'src/lib/auth.ts', lineStart: 2, lineEnd: 4, via: 'root', kind: 'file' });
  });

  it('leading slash and ./ are root-relative', () => {
    expect(res(cite('/src/lib/auth.ts', 1))).toMatchObject({ status: 'ok', via: 'root' });
    expect(res(cite('./README.md'))).toMatchObject({ status: 'ok', file: 'README.md', via: 'root' });
  });

  it('root wins over guide-relative when both exist', () => {
    expect(res(cite('README.md'))).toMatchObject({ status: 'ok', file: 'README.md', via: 'root' });
  });

  it('guide-file-relative (md-relative), including ../', () => {
    expect(res(cite('notes.md'))).toMatchObject({ status: 'ok', file: 'docs/guide/notes.md', via: 'guide' });
    expect(res(cite('../other/notes.md', 1))).toMatchObject({ status: 'ok', file: 'docs/other/notes.md', via: 'guide' });
    expect(res(cite('../../src/lib/auth.ts', 5))).toMatchObject({ status: 'ok', file: 'src/lib/auth.ts', via: 'guide' });
  });

  it('unique suffix on whole segments', () => {
    expect(res(cite('Only.java', 3))).toMatchObject({ status: 'ok', file: 'src/unique/Only.java', via: 'suffix' });
    expect(res(cite('lib/auth.ts', 1))).toMatchObject({ status: 'ok', file: 'src/lib/auth.ts', via: 'suffix' });
    expect(res(cite('a/route.ts', 3))).toMatchObject({ status: 'ok', file: 'src/routes/a/route.ts', via: 'suffix' });
    // 'uth.ts' is not a segment suffix of auth.ts
    expect(res(cite('uth.ts', 1))).toMatchObject({ status: 'error', reason: 'missing-file' });
  });

  it('path-only file and directory citations', () => {
    expect(res(cite('src/lib/'))).toMatchObject({ status: 'ok', file: 'src/lib', kind: 'dir', lineStart: null });
    expect(res(cite('routes/'))).toMatchObject({ status: 'ok', file: 'src/routes', kind: 'dir', via: 'suffix' });
    expect(res(cite('empty.txt'))).toMatchObject({ status: 'ok', kind: 'file' });
  });

  it('line count: CRLF and missing trailing newline', () => {
    expect(res(cite('Only.java', 3))).toMatchObject({ status: 'ok' });
    expect(res(cite('Only.java', 4))).toMatchObject({ status: 'error', reason: 'line-out-of-range' });
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('a\r\nb\r\n')).toBe(2);
    expect(countLines('a\n\n')).toBe(2);
  });

  it('accepts an absolute guide path', () => {
    expect(resolveCitation(root, path.join(root, GUIDE), cite('notes.md'), index)).toMatchObject({ status: 'ok', via: 'guide' });
  });

  it('builds its own index when none is passed', () => {
    expect(resolveCitation(root, GUIDE, cite('src/lib/auth.ts', 1))).toMatchObject({ status: 'ok' });
  });
});

describe('resolveCitation: failure modes', () => {
  it('missing file', () => {
    expect(res(cite('src/lib/nope.ts', 1))).toMatchObject({ status: 'error', reason: 'missing-file' });
  });

  it('ambiguous suffix lists candidates', () => {
    expect(res(cite('route.ts', 1))).toEqual({
      status: 'error',
      reason: 'ambiguous-suffix',
      message: expect.stringContaining('matches 2 files'),
      candidates: ['src/routes/a/route.ts', 'src/routes/b/route.ts'],
    });
    expect(res(cite('notes.md'.replace('notes', 'nope')))).toMatchObject({ reason: 'missing-file' });
  });

  it('line overflow (end beyond file length; start beyond too)', () => {
    expect(res(cite('src/lib/auth.ts', 4, 6))).toMatchObject({ status: 'error', reason: 'line-out-of-range', message: expect.stringContaining('has 5 lines') });
    expect(res(cite('src/lib/auth.ts', 9))).toMatchObject({ reason: 'line-out-of-range' });
    expect(res(cite('empty.txt', 1))).toMatchObject({ reason: 'line-out-of-range' });
    expect(res(cite('src/routes/a/route.ts', 3))).toMatchObject({ status: 'ok' }); // exactly last line
  });

  it('malformed: zero, reversed, half-open, parse-flagged', () => {
    expect(res(cite('src/lib/auth.ts', 0))).toMatchObject({ reason: 'malformed' });
    expect(res(cite('src/lib/auth.ts', 4, 2))).toMatchObject({ reason: 'malformed' });
    expect(res(cite('src/lib/auth.ts', 2, null))).toMatchObject({ reason: 'malformed' });
    expect(res(cite('src/lib/auth.ts', null, null, { malformed: 'unreadable line spec "12-"' }))).toMatchObject({ reason: 'malformed', message: 'unreadable line spec "12-"' });
  });

  it('orphan continuation', () => {
    expect(res(cite(null, 12, 12, { form: 'continuation', malformed: 'no earlier file' }))).toMatchObject({ reason: 'orphan-continuation' });
  });

  it('line citation of a directory', () => {
    expect(res(cite('src/lib', 1))).toMatchObject({ reason: 'not-a-file' });
  });

  it('path climbing above the repo root', () => {
    expect(res(cite('../../../../etc/passwd', 1))).toMatchObject({ status: 'error' });
    expect(res(cite('/../x.ts', 1))).toMatchObject({ reason: 'escapes-repo' });
  });

  it('exact case only (same verdict on Windows and Linux)', () => {
    expect(res(cite('src/lib/Auth.ts', 1))).toMatchObject({ reason: 'missing-file' });
  });

  it('excluded dirs (node_modules) are not indexed', () => {
    expect(res(cite('node_modules/pkg/index.js', 1))).toMatchObject({ reason: 'missing-file' });
  });

  it('path-form excludeDirs drops a snapshot tree so a bare suffix becomes unique (real hnjobtrack shape)', () => {
    const narrowed = buildRepoIndex(root, ['.git', 'node_modules', 'src/routes/b']);
    expect(resolveCitation(root, GUIDE, cite('route.ts', 1), narrowed)).toMatchObject({ status: 'ok', file: 'src/routes/a/route.ts', via: 'suffix' });
  });
});
