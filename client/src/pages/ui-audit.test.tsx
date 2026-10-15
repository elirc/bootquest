// W9: one regression test per fixed docs/recon/ui-audit.md finding that has client behaviour.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type UnitDetail } from '../api/types';
import { InlineProse, Prose, parseProse, proseChunks } from '../lib/prose';
import { unitProse } from '../lib/view';
import { renderApp } from '../test/render';

const EB = 105; // explain-back fixture
const KATA = 109; // patch-kata fixture

interface ApiSpy {
  api: BootQuestApi;
  calls: string[];
  /** promises of API calls that have not settled yet */
  inflight: Set<Promise<unknown>>;
}

/** Records every API method called, in order, and tracks the calls still in flight. */
function spyApi(base: BootQuestApi = createMockApi()): ApiSpy {
  const calls: string[] = [];
  const inflight = new Set<Promise<unknown>>();
  const api = Object.fromEntries(
    Object.entries(base).map(([k, fn]) => [
      k,
      (...a: unknown[]) => {
        calls.push(k);
        const r = (fn as (...x: unknown[]) => unknown)(...a);
        if (r instanceof Promise) {
          inflight.add(r);
          void r.then(
            () => inflight.delete(r),
            () => inflight.delete(r),
          );
        }
        return r;
      },
    ]),
  ) as unknown as BootQuestApi;
  return { api, calls, inflight };
}

/**
 * F13: wait until the page is QUIET instead of sleeping a fixed time: every API call made so far
 * has settled, React has flushed what those results triggered (act), and a full round made no new
 * call. Any probe the page would ever fire in reaction to its data is therefore already in
 * `calls` (a later one could only come from a timer, which the panes do not use).
 */
async function settled(spy: ApiSpy): Promise<void> {
  for (let round = 0; round < 100; round++) {
    const before = spy.calls.length;
    await act(async () => {
      await Promise.allSettled([...spy.inflight]);
    });
    if (spy.inflight.size === 0 && spy.calls.length === before) return;
  }
  throw new Error(`the page never went quiet: ${spy.calls.length} calls, ${spy.inflight.size} in flight`);
}

/** The mock with getUnit(id) post-processed (to serve a shape the fixtures do not carry). */
function withUnit(id: number, edit: (d: UnitDetail) => UnitDetail): BootQuestApi {
  const base = createMockApi();
  return { ...base, getUnit: async (u) => (u === id ? edit(await base.getUnit(u)) : base.getUnit(u)) };
}

describe('prose renderer (#2 / #3): code fences, indented + numbered listings, inline code, escape-safe', () => {
  it('parses fences, 4-space indented blocks and 1..n numbered listings into code blocks', () => {
    expect(parseProse('What happens when you run:\n```js\nconst x = 1;\nx = 2;\n```')).toEqual([
      { kind: 'p', lines: ['What happens when you run:'] },
      { kind: 'code', text: 'const x = 1;\nx = 2;', lang: 'js' },
    ]);
    expect(parseProse('Write CountVowels.\n\n    CountVowels("hello")   → 2\n    CountVowels("HELLO")   → 2\n\nA string is enumerable.')).toEqual([
      { kind: 'p', lines: ['Write CountVowels.'] },
      { kind: 'code', text: 'CountVowels("hello")   → 2\nCountVowels("HELLO")   → 2', lang: null },
      { kind: 'p', lines: ['A string is enumerable.'] },
    ]);
    const review = parseProse("Proposed handler:\n1 app.patch('/t/:id', async (req,res) => {\n2   const t = await find();\n3 });\nPR test: 200.");
    expect(review.map((b) => b.kind)).toEqual(['p', 'code', 'p']);
    expect(review[1]).toMatchObject({ text: "1 app.patch('/t/:id', async (req,res) => {\n2   const t = await find();\n3 });" });
    // a single numbered line, or a list not starting at 1, stays prose
    expect(parseProse('3 apples and\n4 pears').map((b) => b.kind)).toEqual(['p']);
  });

  it('chunks split at blank lines OUTSIDE fences only', () => {
    expect(proseChunks('Q?\n```js\na\n\nb\n```\n\nNext para')).toEqual(['Q?\n```js\na\n\nb\n```', 'Next para']);
  });

  it('renders inline `code` and **bold**, keeps case, and renders markup characters as text (no HTML injection)', () => {
    const { container } = render(<Prose text={'**Concepts:** strings  \nUse `CONST x` <script>alert(1)</script> & `a < b`'} />);
    expect(container.querySelector('strong')).toHaveTextContent('Concepts:');
    expect([...container.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['CONST x', 'a < b']);
    expect(container.querySelector('br')).not.toBeNull(); // "  " line end = hard break
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    const inline = render(<InlineProse text="`x` becomes 2" />);
    expect(inline.container.querySelector('code')).toHaveTextContent(/^x$/);
  });

  it('unitProse keeps a fenced quiz prompt whole (its code block is not split off into the instructions)', () => {
    const d = { unit: { kind: 'quiz' }, check: null, instructions: 'After running:\n```js\nlet s = "a";\n\ns.toUpperCase();\n```\nwhat prints?\n\nHint para' } as unknown as UnitDetail;
    expect(unitProse(d)).toEqual({ prompt: 'After running:\n```js\nlet s = "a";\n\ns.toUpperCase();\n```\nwhat prints?', instructions: 'Hint para' });
  });
});

describe('#2 quiz prompt: original case, real code block', () => {
  it('renders the prompt heading in its own case (not .panel-title) and the fence as a <pre>', async () => {
    const api = withUnit(103, (d) => ({ ...d, instructions: 'What happens when you run:\n```js\nconst x = 1;\nx = 2;\n```' }));
    renderApp('/play/103', api);
    const h = await screen.findByRole('heading', { name: 'What happens when you run:' });
    expect(h).toHaveClass('prompt-title');
    expect(h).not.toHaveClass('panel-title');
    const pre = document.querySelector('.player-work pre.code-block');
    expect(pre?.textContent).toBe('const x = 1;\nx = 2;');
    expect(document.body.textContent).not.toContain('```');
    expect(screen.getByText('The question is in the answer pane.')).toBeInTheDocument();
  });
});

describe('#3 written/drill instructions keep code blocks', () => {
  it('a numbered handler listing renders as one <pre>, not a wrapped paragraph', async () => {
    const api = withUnit(102, (d) => ({ ...d, instructions: 'Review this:\n1 app.patch(x, async () => {\n2   return 1;\n3 });\n\nThen write findings.' }));
    renderApp('/play/102', api);
    await screen.findByText('Review this:');
    const pre = document.querySelector('.player-instructions pre.code-block');
    expect(pre?.textContent).toBe('1 app.patch(x, async () => {\n2   return 1;\n3 });');
    expect(screen.getByText('Then write findings.')).toBeInTheDocument();
  });
});

describe('#1 locked campaign act', () => {
  it('an actGate unit renders a locked state: no editor, no submit, no reveal, a link to the campaign', async () => {
    const api = withUnit(102, (d) => ({ ...d, actGate: { locked: true }, check: null, instructions: null, starter: null }));
    renderApp('/play/102', api);
    const panel = await screen.findByTestId('act-locked');
    expect(panel).toHaveTextContent('campaign act is locked');
    expect(within(panel).getByRole('link', { name: /campaign map/ })).toHaveAttribute('href', '/campaign/js?unit=102'); // W11: targets this quest
    expect(screen.queryByRole('button', { name: /Submit|Reveal|Run|Check answer/ })).not.toBeInTheDocument();
    expect(document.querySelector('.editor')).toBeNull();
  });
});

describe('#13 a permanent 404 offers no Retry', () => {
  it('NOT_FOUND has no Retry button; other errors keep it', async () => {
    renderApp('/play/9999');
    expect(await screen.findByRole('alert')).toHaveTextContent('NOT_FOUND');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a transient error still offers Retry', async () => {
    const api = { ...createMockApi(), getUnit: () => Promise.reject(new ApiError(503, 'UNAVAILABLE_OFFLINE', 'offline')) } as BootQuestApi;
    renderApp('/play/102', api);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('#10 no expected-403 key probe on unanswered explain-back / kata', () => {
  it('F13: settled() waits out a probe chained behind a SLOW call (a fixed 50 ms sleep would have missed it)', async () => {
    const spy = spyApi(createMockApi({ latencyMs: 120 }));
    // a late probe: only after a 120 ms load resolves does a second call start (itself 120 ms)
    void spy.api.getUnit(EB).then(() => spy.api.getExplainBackKey(EB).catch(() => undefined));
    await settled(spy);
    expect(spy.calls).toEqual(['getUnit', 'getExplainBackKey']);
    expect(spy.inflight.size).toBe(0);
  });

  it('explain-back with answered=false never requests the key on mount', async () => {
    const spy = spyApi();
    renderApp(`/play/${EB}`, spy.api);
    await screen.findByRole('textbox', { name: 'Answer 1' });
    await settled(spy);
    expect(spy.calls).toContain('getUnit'); // the spy saw the page's own loads
    expect(spy.calls).not.toContain('getExplainBackKey');
  });

  it('kata with answered=false never requests the key on mount; an answered one loads it', async () => {
    const first = spyApi();
    const firstApp = renderApp(`/play/${KATA}`, first.api);
    await screen.findByTestId('diff');
    await settled(first);
    expect(first.calls).toContain('getUnit');
    expect(first.calls).not.toContain('getKataKey');
    firstApp.unmount(); // W10: one app at a time (two mounted shells doubled the render work under load)

    const base = createMockApi();
    await base.submitKataFindings(KATA, { findings: [{ scenario: 's', evidence: 'e:1', consequence: 'c' }], selfAssisted: false });
    const again = spyApi(base);
    renderApp(`/play/${KATA}`, again.api);
    // two full app trees are mounted in this test; under a parallel suite the second one's key load measured
    // 600-1100 ms, past findBy's 1 s default. A longer WAIT only; no assertion is timing-based.
    expect(await screen.findByTestId('kata-key', {}, { timeout: 15_000 })).toBeInTheDocument();
    expect(again.calls).toContain('getKataKey');
  });
});

describe('#11 kata pane: no duplicated title, optional line wrap', () => {
  it('the pane heading is not the kata title, and Wrap lines toggles the diff wrap', async () => {
    const { user } = renderApp(`/play/${KATA}`);
    const diff = await screen.findByTestId('diff');
    expect(screen.getByRole('heading', { level: 2, name: 'Review the patch' })).toBeInTheDocument();
    expect(diff).not.toHaveClass('diff-wrap');
    await user.click(screen.getByRole('button', { name: 'Wrap lines' }));
    expect(diff).toHaveClass('diff-wrap');
    expect(screen.getByRole('button', { name: 'No wrap' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('inline confirm boxes are not fake modals (new finding)', () => {
  it('the reveal confirm focuses Cancel, is not aria-modal, and Escape cancels it', async () => {
    const { user } = renderApp('/play/102');
    await screen.findByRole('textbox', { name: /Code editor/ });
    await user.click(screen.getByRole('button', { name: /Reveal solution/ }));
    const box = screen.getByRole('alertdialog', { name: 'Reveal the solution?' });
    expect(box).toHaveClass('confirm');
    expect(box).not.toHaveAttribute('aria-modal');
    expect(within(box).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('#4 sidebar tracks: one shared request, placeholder rows while loading', () => {
  it('the campaign page and the sidebar share ONE getTracks call', async () => {
    const { api, calls } = spyApi();
    renderApp('/campaign/csharp', api);
    const sidebar = screen.getByRole('complementary', { name: 'Primary' });
    expect(await within(sidebar).findByRole('link', { name: /C#\/.NET/ })).toBeInTheDocument();
    expect(calls.filter((c) => c === 'getTracks')).toHaveLength(1);
  });

  it('while /tracks is pending the list shows placeholder rows (never an empty TRACKS header), and the tabs show names, not ids', async () => {
    let release: () => void = () => undefined;
    const base = createMockApi();
    const api: BootQuestApi = { ...base, getTracks: () => new Promise((res) => (release = () => res(base.getTracks()))) };
    renderApp('/campaign/csharp', api);
    const list = document.querySelector('.track-list')!;
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(list.querySelectorAll('.track-skel')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'C#/.NET' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'csharp' })).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(list.querySelectorAll('.track-skel')).toHaveLength(0));
    expect(list).toHaveAttribute('aria-busy', 'false');
  });
});

describe('#8 reading/other units: empty competency row hidden; material refs linked', () => {
  it('hides the Competencies label when there are none and lists refs as pinned GitHub links', async () => {
    const api = withUnit(104, (d) => ({
      ...d,
      unit: { ...d.unit, competencies: [] },
      refs: [
        { id: 7, role: 'program', repo: 'elirc/grok-js', path: 'docs/a b.md', sha: 'abcdef1234567', anchor: null, title: 'Closures guide', kind: 'guide', status: 'ok', lineStart: 3, lineEnd: 9, contentUrl: null },
      ],
    }));
    renderApp('/play/104', api);
    const link = await screen.findByRole('link', { name: 'Closures guide' });
    expect(link).toHaveAttribute('href', 'https://github.com/elirc/grok-js/blob/abcdef1234567/docs/a%20b.md#L3-L9');
    expect(screen.queryByText('Competencies')).not.toBeInTheDocument();
  });
});
