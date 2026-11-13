// rv B (R3-03, R2-14, R3-04, R3-05, R4-07, D6): kata cues and grouping, the G2 open-book link, the explain-back
// answer floor note and the "Copy prompt for Claude" button on the key view.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { explainBackFixtures, kataFixtures } from '../api/fixtures/ladder';
import type { BootQuestApi } from '../api/types';
import { contextRows, DiffView, maskFindingMarkers } from './LadderPanes';
import { renderApp } from '../test/render';

const HARNESS_DIFF = [
  'diff --git a/src/orders.js b/src/orders.js',
  '--- a/src/orders.js',
  '+++ b/src/orders.js',
  '@@ -1,2 +1,2 @@',
  '-  if (order.ownerId !== user.id) throw forbidden(); // finding T4',
  '+  if (!order) throw notFound();',
  'diff --git a/bootquest-kata/orders.Testable.js b/bootquest-kata/orders.Testable.js',
  '--- a/bootquest-kata/orders.Testable.js',
  '+++ b/bootquest-kata/orders.Testable.js',
  '@@ -1,2 +1,2 @@',
  '-  if (order.ownerId !== user.id) throw forbidden();',
  '+  if (!order) throw notFound();',
].join('\n');

describe('kata cues (display only)', () => {
  it('R3-03: finding markers render as [ref]', () => {
    expect(maskFindingMarkers('see review finding 1 / exercise 3, Finding T4 and (F10); the Step-6 answer')).toBe('see review [ref] / [ref], [ref] and [ref]; the [ref]');
    expect(maskFindingMarkers('findings are listed; F10 alone stays')).toBe('findings are listed; F10 alone stays');
  });

  it('R2-14: a bootquest-kata/ harness mirror folds into one row; the real change stays open and its markers are masked', () => {
    render(<DiffView diff={HARNESS_DIFF} />);
    const diff = screen.getByTestId('diff');
    const harness = within(diff).getByTestId('diff-harness');
    expect(harness.querySelector('summary')).toHaveTextContent('Test harness mirror bootquest-kata/orders.Testable.js (6 lines)');
    expect(harness).not.toHaveAttribute('open');
    const loose = [...diff.querySelectorAll(':scope > .diff-line')].map((e) => e.textContent);
    expect(loose).toContain('diff --git a/src/orders.js b/src/orders.js\n');
    expect(loose).toContain('-  if (order.ownerId !== user.id) throw forbidden(); // [ref]\n');
    expect(loose.some((l) => l?.includes('bootquest-kata'))).toBe(false);
  });

  it('R3-03: a context file folds its runs of comment lines (the pre-patch comment the diff removed) and masks markers', () => {
    const rows = contextRows(
      ['export function exit(code) {', '  // Exiting 0 here would tell scripts the save worked,', '  // so exit non-zero (review finding 1 / exercise 3).', '  process.exit(code);', '  // lone', '}'].join('\n'),
      'src/session.mjs',
    );
    expect(rows.map((r) => r.kind)).toEqual(['line', 'fold', 'line', 'line', 'line']);
    expect(rows[1]).toEqual({ kind: 'fold', lines: ['  // Exiting 0 here would tell scripts the save worked,', '  // so exit non-zero (review finding 1 / exercise 3).'] });
    // markdown has no comment syntax: nothing folds
    expect(contextRows('# Title\n# Sub', 'README.md').every((r) => r.kind === 'line')).toBe(true);
  });

  it('R3-04: the key view groups "the defect" (patched lines) before "consequences and context"', async () => {
    const id = Number(Object.keys(kataFixtures)[0]);
    const api = createMockApi();
    const { user } = renderApp(`/play/${id}`, api);
    await screen.findByTestId('diff');
    for (const field of ['scenario', 'evidence', 'consequence']) await user.type(screen.getByRole('textbox', { name: `Finding 1 ${field}` }), 'x');
    await user.click(screen.getByRole('button', { name: /Submit findings/ }));
    const key = await screen.findByTestId('kata-key');
    const fx = kataFixtures[String(id)]!;
    if (fx.defects.some((d) => d.evidence.in === 'patched')) expect(within(key).getByTestId('kata-group-patched')).toHaveTextContent('The defect (in the patched lines)');
    if (fx.defects.some((d) => d.evidence.in !== 'patched')) expect(within(key).getByTestId('kata-group-repo')).toHaveTextContent('Consequences and context');
  });
});

describe('explain-back: open-book G2, the answer floor, the Claude prompt', () => {
  const EB = Number(Object.keys(explainBackFixtures)[0]);

  it('R3-05: a G2 brief is open-book with a link to the pinned tree; other sets stay "Code hidden"', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      getUnit: async (id) => {
        const d = await base.getUnit(id);
        return id === EB ? { ...d, unit: { ...d.unit, key: 'ladder/g2/mock-repo/abc123' } } : d;
      },
      getUnitSource: async (id) => ({ unitId: id, repo: 'mock-repo', sha: '0123456789abcdef', url: 'https://github.com/elirc/mock-repo/tree/0123456789abcdef', openBook: true }),
    };
    renderApp(`/play/${EB}`, api);
    const note = await screen.findByTestId('open-book');
    expect(note).toHaveTextContent('Open book');
    const link = await within(note).findByTestId('source-link');
    expect(link).toHaveAttribute('href', 'https://github.com/elirc/mock-repo/tree/0123456789abcdef');
    expect(link).toHaveTextContent('mock-repo @ 0123456');
    expect(screen.queryByTestId('code-hidden')).not.toBeInTheDocument();
  });

  it('R4-07: a short answer shows its word count against the 15-word floor', async () => {
    const { user } = renderApp(`/play/${EB}`);
    await user.type(await screen.findByRole('textbox', { name: 'Answer 1' }), 'x, x, x');
    expect(screen.getByTestId('eb-words-1')).toHaveTextContent('3 words: an answer needs at least 15');
  });

  it('D6: the key view copies a prompt with each question, the stored answer and the key points (clipboard only)', async () => {
    // user-event's setup() installs a clipboard stub: read back what the button wrote
    const api = createMockApi();
    const long = 'my own answer covers the scope, the data model, the failure modes and the tests that pin each rule';
    const n = explainBackFixtures[String(EB)]!.questions.length;
    await api.answerExplainBack(EB, { answers: Array.from({ length: n }, () => long), selfAssisted: false });
    const { user } = renderApp(`/play/${EB}`, api);
    await user.click(await screen.findByRole('button', { name: 'Copy prompt for Claude' }));
    expect(await screen.findByText(/Copied. Paste it into your own Claude session/)).toBeInTheDocument();
    const writes = [await navigator.clipboard.readText()];
    const q = explainBackFixtures[String(EB)]!.questions[0]!;
    expect(writes[0]).toContain(`Question: ${q.prompt}`);
    expect(writes[0]).toContain(`My answer: ${long}`);
    expect(writes[0]).toContain('q1k1');
  });
});
