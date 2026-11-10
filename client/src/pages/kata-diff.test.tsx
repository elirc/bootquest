// f52: the kata diff folds runs of removed comment lines, and never mistakes a removed `-- ` line
// (a removed SQL comment) for a file header.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiffView, classifyDiff, isRemovedCommentLine } from './LadderPanes';
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
  it('knows comment-only removed lines from code', () => {
    for (const l of ['-// x', '-  // x', '-# x', '-#', '--- x', '---', '-/* x */', '- * x', '- */', '-<!-- x -->', '-#!/bin/sh']) expect(isRemovedCommentLine(l), l).toBe(true);
    for (const l of ['-const a = 1; // x', '-#region x', '-#if DEBUG', '-*p = 1;', '-', '-  ', '+// x', ' // x', '---x', '-- x', '-a -- b']) expect(isRemovedCommentLine(l), l).toBe(false);
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
