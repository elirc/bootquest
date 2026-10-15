// W10 polish: prose renderer review findings, /tracks refresh, uncovered legs, empty reading
// units and the "(untitled guide)" reading-title fallback.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../api/context';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, TracksResponse, UnitDetail } from '../api/types';
import { closesFence, parseProse, proseChunks, splitPrompt } from '../lib/prose';
import { TracksProvider, useTracks } from '../lib/tracks';
import { campaignSourceOf, readingTitle } from '../lib/view';
import { renderApp } from '../test/render';

function withUnit(id: number, edit: (d: UnitDetail) => UnitDetail, base: BootQuestApi = createMockApi()): BootQuestApi {
  return { ...base, getUnit: async (u) => (u === id ? edit(await base.getUnit(u)) : base.getUnit(u)) };
}

/** getTracks counted; each call can be held open until released (in call order). */
function heldTracks(base: BootQuestApi = createMockApi()) {
  const releases: (() => void)[] = [];
  let calls = 0;
  let hold = false;
  const api: BootQuestApi = {
    ...base,
    getTracks: () => {
      calls++;
      if (!hold) return base.getTracks();
      return new Promise<TracksResponse>((res) => releases.push(() => res(base.getTracks())));
    },
  };
  return {
    api,
    calls: () => calls,
    holdNext: (v: boolean) => (hold = v),
    releaseNext: () => releases.shift()?.(),
  };
}

const jsPct = () => {
  const sidebar = screen.getByRole('complementary', { name: 'Primary' });
  return within(sidebar).getByRole('link', { name: /JS\/TS/ }).querySelector('.track-count')?.textContent;
};

describe('prose (a): a numbered run is code only with 3+ lines or a code-like character', () => {
  it('a two-line numbered prose list stays prose', () => {
    expect(parseProse('Steps:\n1 Read the guide\n2 Take the quiz')).toEqual([{ kind: 'p', lines: ['Steps:', '1 Read the guide', '2 Take the quiz'] }]);
  });

  it('a two-line run with ( { ; = or => is code', () => {
    for (const code of ['1 foo()\n2 bar', '1 if x {\n2 }', '1 a\n2 b;', '1 x = 1\n2 y', '1 const f = () => 1\n2 f']) {
      expect(parseProse(code)).toEqual([{ kind: 'code', text: code, lang: null }]);
    }
  });

  it('three or more numbered lines are code even without code characters', () => {
    expect(parseProse('1 alpha\n2 beta\n3 gamma')).toEqual([{ kind: 'code', text: '1 alpha\n2 beta\n3 gamma', lang: null }]);
  });

  it('the number itself is not a code character (digits / spacing only)', () => {
    expect(parseProse('1 Open the repo\n2 Read it').map((b) => b.kind)).toEqual(['p']);
  });
});

describe('prose (b): a fence closes only on a line that is exactly a marker of the same kind and >= length', () => {
  it('a code line that merely starts with ``` does not close the block', () => {
    expect(parseProse('```js\nconst s = `x`;\n```js inner\nmore\n```\nafter')).toEqual([
      { kind: 'code', text: 'const s = `x`;\n```js inner\nmore', lang: 'js' },
      { kind: 'p', lines: ['after'] },
    ]);
  });

  it('a shorter or different marker does not close; a longer one (and up to 3 leading spaces / trailing spaces) does', () => {
    expect(parseProse('````\na\n```\n~~~~\nb\n`````  \nafter').slice(0, 1)).toEqual([{ kind: 'code', text: 'a\n```\n~~~~\nb', lang: null }]);
    expect(closesFence('```', '```')).toBe(true);
    expect(closesFence('   ````  ', '```')).toBe(true);
    expect(closesFence('    ```', '```')).toBe(false); // 4 spaces = indented content, not a fence
    expect(closesFence('``', '```')).toBe(false);
    expect(closesFence('~~~', '```')).toBe(false);
    expect(closesFence('```js', '```')).toBe(false);
    expect(closesFence('``` x', '```')).toBe(false);
  });

  it('proseChunks uses the same closing rule (a blank line after a non-closing ``` line stays inside)', () => {
    expect(proseChunks('Q?\n```\na\n```js not-a-close\n\nb\n```\n\nNext')).toEqual(['Q?\n```\na\n```js not-a-close\n\nb\n```', 'Next']);
  });
});

describe('prose (c): splitPrompt promotes only a LEADING paragraph', () => {
  it('a prompt opening with prose uses it as the heading', () => {
    const r = splitPrompt('What prints?\n```js\nlog(1)\n```');
    expect(r.heading).toBe('What prints?');
    expect(r.rest).toEqual([{ kind: 'code', text: 'log(1)', lang: 'js' }]);
  });

  it('a prompt opening with code keeps source order under the fallback heading', () => {
    const r = splitPrompt('```js\nlet x = 1;\n```\nWhat is x now?');
    expect(r.heading).toBe('');
    expect(r.rest).toEqual([
      { kind: 'code', text: 'let x = 1;', lang: 'js' },
      { kind: 'p', lines: ['What is x now?'] },
    ]);
  });

  it('renders the fallback heading, then code, then the trailing prose, in that order', async () => {
    const api = withUnit(103, (d) => ({ ...d, instructions: '```js\nlet x = 1;\n```\nWhat is x now?' }));
    renderApp('/play/103', api);
    const h = await screen.findByRole('heading', { name: 'Choose the answer' });
    const body = document.querySelector('.player-work .prompt-body')!;
    expect([...body.children].map((c) => c.tagName)).toEqual(['PRE', 'P']);
    expect(body.textContent).toBe('let x = 1;What is x now?');
    expect(h.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('/tracks refresh: counts follow progress without a layout shift', () => {
  it('a reading self-attest refreshes the sidebar percent in place', async () => {
    const t = heldTracks();
    const { user } = renderApp('/play/104', t.api);
    await waitFor(() => expect(jsPct()).toMatch(/%$/));
    const before = jsPct();
    expect(t.calls()).toBe(1);
    await user.click(await screen.findByRole('button', { name: /Mark as read/ }));
    await waitFor(() => expect(t.calls()).toBe(2));
    await waitFor(() => expect(jsPct()).not.toBe(before));
  });

  it('while a refresh is in flight the current rows stay (no placeholder rows, not aria-busy)', async () => {
    const t = heldTracks();
    const { user } = renderApp('/play/104', t.api);
    await waitFor(() => expect(jsPct()).toMatch(/%$/));
    const before = jsPct();
    t.holdNext(true);
    await user.click(await screen.findByRole('button', { name: /Mark as read/ }));
    await waitFor(() => expect(t.calls()).toBe(2));
    const list = document.querySelector('.track-list')!;
    expect(list.querySelectorAll('.track-skel')).toHaveLength(0);
    expect(list).toHaveAttribute('aria-busy', 'false');
    expect(jsPct()).toBe(before);
    act(() => t.releaseNext());
    await waitFor(() => expect(jsPct()).not.toBe(before));
  });

  it('a recorded drill submit refreshes; a free run does not', async () => {
    const t = heldTracks();
    const { user } = renderApp('/play/102', t.api);
    await screen.findByRole('textbox', { name: /Code editor/ });
    await waitFor(() => expect(t.calls()).toBe(1));
    await user.click(screen.getByRole('button', { name: /^Run/ }));
    await screen.findByText(/practice run/);
    expect(t.calls()).toBe(1);
    await user.click(screen.getByRole('button', { name: /^Submit/ }));
    await waitFor(() => expect(t.calls()).toBe(2));
  });

  it('opening the campaign re-reads /tracks; a cold load on the campaign still makes ONE request', async () => {
    const t = heldTracks();
    const { user, unmount } = renderApp('/', t.api);
    await waitFor(() => expect(jsPct()).toMatch(/%$/));
    expect(t.calls()).toBe(1);
    const nav = within(screen.getByRole('complementary', { name: 'Primary' })).getByRole('navigation');
    await user.click(within(nav).getByRole('link', { name: /Campaign/ }));
    await waitFor(() => expect(t.calls()).toBe(2));
    unmount();

    const cold = heldTracks();
    renderApp('/campaign/js', cold.api);
    await waitFor(() => expect(jsPct()).toMatch(/%$/));
    await new Promise((r) => setTimeout(r, 30));
    expect(cold.calls()).toBe(1);
  });

  it('requests never overlap: refresh() during a read queues ONE follow-up; refresh({ join }) shares it', async () => {
    const t = heldTracks();
    t.holdNext(true);
    let ctl: ReturnType<typeof useTracks> | null = null;
    function Probe() {
      ctl = useTracks();
      return <span data-testid="status">{ctl.status}</span>;
    }
    render(
      <ApiProvider api={t.api}>
        <TracksProvider>
          <Probe />
        </TracksProvider>
      </ApiProvider>,
    );
    expect(t.calls()).toBe(1);
    act(() => ctl!.refresh({ join: true }));
    expect(t.calls()).toBe(1); // joined the first read
    act(() => {
      ctl!.refresh();
      ctl!.refresh();
      ctl!.refresh();
    });
    expect(t.calls()).toBe(1); // still only one in flight
    t.holdNext(false);
    await act(async () => t.releaseNext());
    await waitFor(() => expect(t.calls()).toBe(2)); // exactly one follow-up
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await new Promise((r) => setTimeout(r, 30));
    expect(t.calls()).toBe(2);
  });

  it('a failed background refresh keeps the rows already shown', async () => {
    const base = createMockApi();
    let n = 0;
    const api: BootQuestApi = { ...base, getTracks: () => (++n === 1 ? base.getTracks() : Promise.reject(new Error('offline'))) };
    const { user } = renderApp('/play/104', api);
    await waitFor(() => expect(jsPct()).toMatch(/%$/));
    await user.click(await screen.findByRole('button', { name: /Mark as read/ }));
    await waitFor(() => expect(n).toBe(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(jsPct()).toMatch(/%$/);
    expect(screen.queryByText(/Tracks failed to load/)).not.toBeInTheDocument();
  });
});

describe('uncovered legs on program units', () => {
  it('lists every leg under an honest "Not machine-checked" note', async () => {
    const legs = ["T-04 acceptance 'practice typecheck pass' (tsc -p tsconfig.json) is NOT covered", 'T-04: `npm run lint` is clean'];
    renderApp('/play/102', withUnit(102, (d) => ({ ...d, uncoveredLegs: legs })));
    const note = await screen.findByTestId('uncovered-legs');
    expect(note).toHaveAttribute('role', 'note');
    expect(within(note).getByRole('heading', { name: /Not machine-checked/ })).toBeInTheDocument();
    expect(note).toHaveTextContent('does not cover these 2 acceptance legs');
    const items = within(note).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(legs[0]!);
    expect(items[1]!.querySelector('code')).toHaveTextContent('npm run lint');
  });

  it('renders nothing when the unit has no uncovered legs', async () => {
    renderApp('/play/102');
    await screen.findByRole('textbox', { name: /Code editor/ });
    expect(screen.queryByTestId('uncovered-legs')).not.toBeInTheDocument();
  });
});

describe('#8 reading unit with nothing to read: honest empty state', () => {
  it('names the campaign quest map and the source repo from the unit key, with no invented link', async () => {
    const api = withUnit(104, (d) => ({
      ...d,
      unit: { ...d.unit, key: 'campaign/js/JS-Exercise-Closures-Callbacks-ArrayMethods', competencies: [] },
      instructions: null,
      refs: [],
    }));
    renderApp('/play/104', api);
    const box = await screen.findByTestId('reading-empty');
    expect(box).toHaveTextContent('No reading material is served for this unit yet');
    expect(within(box).getByRole('link', { name: /campaign map/ })).toHaveAttribute('href', '/campaign/js');
    expect(within(box).getByText('JS-Exercise-Closures-Callbacks-ArrayMethods').tagName).toBe('CODE');
    expect(within(box).queryByRole('link', { name: /github/i })).not.toBeInTheDocument();
    expect(box.querySelectorAll('a[href^="http"]')).toHaveLength(0);
    expect(screen.queryByText(/No written instructions are served/)).not.toBeInTheDocument();
  });

  it('a non-campaign key says the source is not named', async () => {
    const api = withUnit(104, (d) => ({ ...d, unit: { ...d.unit, key: 'js/reading-x' }, instructions: null, refs: [] }));
    renderApp('/play/104', api);
    expect(await screen.findByTestId('reading-empty')).toHaveTextContent('does not name its source');
    expect(campaignSourceOf('js/reading-x')).toBeNull();
    expect(campaignSourceOf('campaign/csharp/borrowbox')).toEqual({ trackId: 'csharp', repo: 'borrowbox' });
  });

  it('a reading unit WITH refs keeps the material list instead', async () => {
    const api = withUnit(104, (d) => ({
      ...d,
      instructions: null,
      refs: [{ id: 7, role: 'program', repo: 'elirc/x', path: 'docs/guide.md', sha: 'abcdef1234567', anchor: null, title: '(untitled guide)', kind: 'guide', status: 'ok', lineStart: null, lineEnd: null, contentUrl: null }],
    }));
    renderApp('/play/104', api);
    expect(await screen.findByRole('link', { name: 'guide.md' })).toBeInTheDocument(); // #5 fallback on refs too
    expect(screen.queryByTestId('reading-empty')).not.toBeInTheDocument();
  });
});

describe('"(untitled guide)" reading titles show the file name', () => {
  it('readingTitle falls back to the path basename only for the placeholder', () => {
    expect(readingTitle('(untitled guide)', 'docs/week-1/README.md')).toBe('README.md');
    expect(readingTitle('(untitled guide)', 'notes\\a.md')).toBe('a.md');
    expect(readingTitle('Closures', 'docs/a.md')).toBe('Closures');
    expect(readingTitle('(untitled guide)', '')).toBe('(untitled guide)');
  });

  it('the study-quest reading list renders the basename', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      getUnit: async (u) => {
        const d = await base.getUnit(u);
        if (u !== 206 || !d.studyQuest) return d;
        const [first, ...rest] = d.studyQuest.readingSteps;
        return { ...d, studyQuest: { ...d.studyQuest, readingSteps: [{ ...first!, title: '(untitled guide)', path: 'guides/intro-notes.md' }, ...rest] } };
      },
    };
    renderApp('/play/206', api);
    const list = await screen.findByTestId('reading-list');
    expect(within(list).getByRole('link', { name: 'intro-notes.md' })).toBeInTheDocument();
    expect(list).not.toHaveTextContent('(untitled guide)');
  });
});

describe('W10 re-audit: answer-first units point at their pane instead of "no instructions"', () => {
  it('study quest, kata and explain-back say where the task is; a content-pending study quest does not', async () => {
    const first = renderApp('/play/206');
    expect(await screen.findByTestId('task-in-pane')).toHaveTextContent('reading list and the quiz gate are in the study pane');
    first.unmount();
    const kata = renderApp('/play/109');
    expect(await screen.findByTestId('task-in-pane')).toHaveTextContent('patch to review is in the review pane');
    kata.unmount();
    const eb = renderApp('/play/105');
    expect(await screen.findByTestId('task-in-pane')).toHaveTextContent('questions are in the answer pane');
    eb.unmount();
    renderApp('/play/206', withUnit(206, (d) => ({ ...d, instructions: null, studyQuest: null })));
    await screen.findByTestId('study-pending');
    expect(screen.queryByTestId('task-in-pane')).not.toBeInTheDocument();
    expect(screen.getByText('No written instructions are served for this unit yet.')).toBeInTheDocument();
  });
});
