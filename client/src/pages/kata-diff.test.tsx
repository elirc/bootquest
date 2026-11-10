// f52: the kata diff folds runs of removed comment lines, and never mistakes a removed `-- ` line
// (a removed SQL comment) for a file header.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiffView, classifyDiff, commentSyntaxOf, diffHeaderPath, isRemovedCommentLine, removedCommentLines } from './LadderPanes';
import { renderApp } from '../test/render';

const DIFF = [
  'diff --git a/db/migrate.sql b/db/migrate.sql',
  '--- a/db/migrate.sql',
  '+++ b/db/migrate.sql',
  '@@ -1,7 +1,3 @@',
  ' CREATE TABLE loan (',
  // a removed SQL comment: the diff's "-" in front of the line's own "-- "
  '--- the id is assigned by the sequence',
  '--- never reuse an id',
  '-  id INTEGER PRIMARY KEY,',
  '+  id INTEGER,',
  '--- one lone comment',
  // a removed line that itself starts "- " (a markdown bullet): a removal, not a comment
  '-- a removed bullet',
  ' );',
  '--- a/src/orders.js',
  '+++ b/src/orders.js',
  '@@ -3,6 +3,2 @@ function total(order) {',
  '-  // sum the lines',
  '-  /* in cents,',
  '-   * never floats',
  '-   */',
  '-  #region not a comment',
  ' return 1;',
  '+ // added comment',
].join('\n');

describe('classifyDiff', () => {
  it('inside a hunk a line starting "-- " or "--- " is a removal; between hunks "---" / "+++" are file headers', () => {
    const lines = DIFF.split('\n');
    const cls = classifyDiff(lines);
    const of = (text: string) => cls[lines.indexOf(text)];
    expect(of('--- a/db/migrate.sql')).toBe('diff-file');
    expect(of('+++ b/db/migrate.sql')).toBe('diff-file');
    expect(of('--- the id is assigned by the sequence')).toBe('diff-del');
    expect(of('--- never reuse an id')).toBe('diff-del');
    expect(of('--- one lone comment')).toBe('diff-del');
    expect(of('-- a removed bullet')).toBe('diff-del');
    // the first hunk's counts ran out: the next "---" is the second file's header (no "diff " line)
    expect(of('--- a/src/orders.js')).toBe('diff-file');
    expect(of('+++ b/src/orders.js')).toBe('diff-file');
    expect(of('@@ -3,6 +3,2 @@ function total(order) {')).toBe('diff-hunk');
    expect(of('+ // added comment')).toBe('diff-add');
    expect(of(' return 1;')).toBe('diff-ctx');
  });

  it('a hunk header without counts stays open until the next header', () => {
    expect(classifyDiff(['@@ garbled @@', '-- a comment', '--- more', '+++ added', '@@ -1 +1 @@', '-x', '+y', '--- a/next'])).toEqual([
      'diff-hunk',
      'diff-del',
      'diff-del',
      'diff-add',
      'diff-hunk',
      'diff-del',
      'diff-add',
      'diff-file',
    ]);
  });
});

describe('isRemovedCommentLine', () => {
  it('knows comment-only removed lines from code, per file type', () => {
    // C-like: // and /* */; a "* x" line only inside a block
    for (const l of ['-// x', '-  // x', '-/* x */', '-/* x', '-/** doc */ // and more']) expect(isRemovedCommentLine(l, 'a/b.js'), l).toBe(true);
    for (const l of ['- * x', '- */', '-   never floats', '-', '-x */']) expect(isRemovedCommentLine(l, 'src/A.java', true), `${l} (in block)`).toBe(true);
    for (const l of ['-const a = 1; // x', '-#region x', '-#if DEBUG', '-# x', '-*p = 1;', '- * factor', '- */', '-', '-  ', '+// x', ' // x', '--- x', '-/* x */ f();', '-<!-- x -->'])
      expect(isRemovedCommentLine(l, 'src/a.cs'), l).toBe(false);
    expect(isRemovedCommentLine('- */ g();', 'a.ts', true)).toBe(false);
    // # only where it is a comment
    for (const p of ['x.py', 'x.rb', 'run.sh', 'ci.yml', 'ci.yaml', 'a.toml', 'Dockerfile', 'docker/Dockerfile.dev', '.env', '.env.local', 'Makefile'])
      for (const l of ['-# x', '-#', '-#!/bin/sh', '-  #x']) expect(isRemovedCommentLine(l, p), `${l} in ${p}`).toBe(true);
    expect(isRemovedCommentLine('-// x', 'x.py')).toBe(false);
    expect(isRemovedCommentLine('-x = 1  # x', 'x.py')).toBe(false);
    // -- only in sql / lua / hs
    for (const p of ['db/m.sql', 'a.lua', 'A.hs']) for (const l of ['--- x', '---', '-  -- x']) expect(isRemovedCommentLine(l, p), `${l} in ${p}`).toBe(true);
    for (const l of ['-- x', '-a -- b', '-# x', '-// x']) expect(isRemovedCommentLine(l, 'db/m.sql'), l).toBe(false);
    expect(isRemovedCommentLine('-/* x */', 'db/m.sql')).toBe(true);
    expect(isRemovedCommentLine('--- x', 'a.js')).toBe(false);
    expect(isRemovedCommentLine('-<!-- x -->', 'a.html')).toBe(true);
    // markdown and unknown file types: never
    for (const p of ['README.md', 'docs/a.mdx', 'notes.txt', 'LICENSE', undefined, null])
      for (const l of ['-# Title', '-// x', '--- x', '- * item', '-/* x */', '-<!-- x -->']) expect(isRemovedCommentLine(l, p), `${l} in ${String(p)}`).toBe(false);
  });

  it('commentSyntaxOf / diffHeaderPath', () => {
    expect(commentSyntaxOf('a/B.TS')).toMatchObject({ line: true, block: true, hash: false, dash: false });
    expect(commentSyntaxOf('README.md')).toEqual({ line: false, block: false, hash: false, dash: false, html: false });
    expect(diffHeaderPath('diff --git a/src/a b.js b/src/a b.js')).toBe('src/a b.js');
    expect(diffHeaderPath('+++ b/db/m.sql')).toBe('db/m.sql');
    expect(diffHeaderPath('--- a/db/m.sql\t2024-01-01')).toBe('db/m.sql');
    expect(diffHeaderPath('--- /dev/null')).toBeNull();
    expect(diffHeaderPath('index 1..2 100644')).toBeNull();
  });
});

describe('removed-comment folding follows the file type of the file section (fix pass 4)', () => {
  const folds = (diff: string[]) => {
    const { container } = render(<DiffView diff={diff.join('\n')} />);
    const out = [...container.querySelectorAll('[data-testid="diff-fold"]')].map((f) => [...f.querySelectorAll('.diff-del')].map((e) => e.textContent!.replace(/\n$/, '')));
    const loose = [...container.querySelectorAll('[data-testid="diff"] > .diff-line')].map((e) => e.textContent!.replace(/\n$/, ''));
    return { out, loose };
  };

  it('markdown is never folded: "-# Title" and "-## Sub" stay', () => {
    const { out, loose } = folds(['diff --git a/README.md b/README.md', '--- a/README.md', '+++ b/README.md', '@@ -1,4 +1,1 @@', '-# Title', '-## Sub', '-* item', ' text']);
    expect(out).toEqual([]);
    expect(loose).toEqual(expect.arrayContaining(['-# Title', '-## Sub', '-* item']));
  });

  it('JS: "* factor" continuation lines outside a block comment are code; inside one they fold; // still folds', () => {
    const { out, loose } = folds([
      'diff --git a/src/price.js b/src/price.js',
      '--- a/src/price.js',
      '+++ b/src/price.js',
      '@@ -1,10 +1,2 @@',
      ' const total = base',
      '-    * factor',
      '-    * rate;',
      ' /* the old',
      '-   * note one',
      '-   * note two',
      '-   */',
      '-    * 2;',
      '-  // a',
      '-  // b',
    ]);
    expect(out).toEqual([
      ['-   * note one', '-   * note two', '-   */'],
      ['-  // a', '-  // b'],
    ]);
    expect(loose).toEqual(expect.arrayContaining(['-    * factor', '-    * rate;', '-    * 2;']));
  });

  it('SQL: two removed "-- note" lines fold, a lone one stays; "#" lines in SQL do not', () => {
    const { out, loose } = folds(['diff --git a/db/m.sql b/db/m.sql', '--- a/db/m.sql', '+++ b/db/m.sql', '@@ -1,7 +1,2 @@', '--- note', '--- note two', ' SELECT 1;', '--- lone', ' SELECT 2;', '-# x', '-# y']);
    expect(out).toEqual([['--- note', '--- note two']]);
    expect(loose).toEqual(expect.arrayContaining(['--- lone', '-# x', '-# y']));
  });

  it('each file section has its own rules, and an added line never changes block context', () => {
    const lines = ['diff --git a/a.py b/a.py', '@@ -1,2 +0,0 @@', '-# one', '-# two', 'diff --git a/a.js b/a.js', '@@ -1,3 +1,1 @@', '-# one', '-# two', '+/* added, never closed', '- * not in a block'];
    expect(removedCommentLines(lines, classifyDiff(lines))).toEqual([false, false, true, true, false, false, false, false, false, false]);
  });
});

describe('DiffView', () => {
  it('folds a run of two or more removed comment lines; a lone one, added comments and code stay as they are', () => {
    render(<DiffView diff={DIFF} />);
    const diff = screen.getByTestId('diff');
    const folds = within(diff).getAllByTestId('diff-fold');
    expect(folds).toHaveLength(2);
    expect(folds[0]!.querySelector('summary')).toHaveTextContent('2 comment lines removed');
    expect(folds[1]!.querySelector('summary')).toHaveTextContent('4 comment lines removed');
    expect(folds[0]).not.toHaveAttribute('open');
    // the folded lines are still there (and still removals), ready to expand
    expect([...folds[0]!.querySelectorAll('.diff-del')].map((e) => e.textContent)).toEqual(['--- the id is assigned by the sequence\n', '--- never reuse an id\n']);
    expect(folds[1]!.querySelectorAll('.diff-del')).toHaveLength(4);
    // not folded: the lone removed comment, the #region line, the added comment
    const loose = [...diff.querySelectorAll(':scope > .diff-line')].map((e) => e.textContent);
    expect(loose).toContain('--- one lone comment\n');
    expect(loose).toContain('-- a removed bullet\n');
    expect(loose).toContain('-  #region not a comment\n');
    expect(loose).toContain('+ // added comment\n');
    expect(diff.querySelectorAll('.diff-file')).toHaveLength(5);
  });

  it('the kata instructions say that removed comments are collapsed', async () => {
    renderApp('/play/109');
    await screen.findByTestId('diff');
    expect(screen.getByText(/Runs\s+of removed comment lines are collapsed; click one to expand it\./)).toBeInTheDocument();
  });
});
