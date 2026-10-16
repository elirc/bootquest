// B3: render tests for the Campaign page's skill-tree view (layout math: lib/skilltree.test.ts).
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi } from '../api/types';
import { renderApp } from '../test/render';
import { CAMPAIGN_VIEW_KEY } from './CampaignTree';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** Records every API method called. */
function spyApi(base: BootQuestApi = createMockApi()): { api: BootQuestApi; calls: string[] } {
  const calls: string[] = [];
  const api = Object.fromEntries(
    Object.entries(base).map(([k, fn]) => [k, (...a: unknown[]) => (calls.push(k), (fn as (...x: unknown[]) => unknown)(...a))]),
  ) as unknown as BootQuestApi;
  return { api, calls };
}

const tree = () => screen.findByTestId('skilltree');
const node = (key: string) => document.querySelector<HTMLElement>(`[data-node="${key}"]`);

async function openTree(path = '/campaign/js', api?: BootQuestApi) {
  const r = renderApp(path, api);
  await r.user.click(await screen.findByRole('button', { name: 'Tree' }));
  return { ...r, canvas: await tree() };
}

describe('campaign skill tree: view toggle', () => {
  it('list is the default; the Tree toggle switches views and is remembered in localStorage', async () => {
    const first = renderApp('/campaign/js');
    expect(await screen.findByRole('tabpanel', { name: 'Campaign acts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    await first.user.click(screen.getByRole('button', { name: 'Tree' }));
    expect(await screen.findByRole('tabpanel', { name: 'Campaign skill tree' })).toBeInTheDocument();
    expect(window.localStorage.getItem(CAMPAIGN_VIEW_KEY)).toBe('tree');
    first.unmount();

    renderApp('/campaign/csharp');
    expect(await tree()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"v" toggles the view from the keyboard', async () => {
    const { user } = renderApp('/campaign/js');
    await screen.findByRole('tabpanel', { name: 'Campaign acts' });
    await user.keyboard('v');
    expect(await tree()).toBeInTheDocument();
    await user.keyboard('v');
    expect(await screen.findByRole('tabpanel', { name: 'Campaign acts' })).toBeInTheDocument();
  });

  it('blocked storage (getItem/setItem throw) degrades to an in-memory toggle', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { user } = renderApp('/campaign/js');
    expect(await screen.findByRole('tabpanel', { name: 'Campaign acts' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tree' }));
    expect(await tree()).toBeInTheDocument();
  });
});

describe('campaign skill tree: nodes, states, edges', () => {
  it('act gates carry state + expansion; the open act shows its quests with their node states', async () => {
    await openTree();
    const g1 = node('a:1')!;
    const g2 = node('a:2')!;
    expect(g1).toHaveAccessibleName(/^Act 1: Foundations, in progress, core 1 of 3, 4 quests$/);
    expect(g1).toHaveAttribute('aria-expanded', 'true');
    expect(g2).toHaveAccessibleName(/Act 2: APIs and data, locked, .*unlocks at 80% of act 1 core \+ level 4 \(you: 3\)/);
    expect(g2).toHaveAttribute('aria-expanded', 'false'); // locked acts start collapsed
    expect(node('q:21')).toBeNull();

    expect(node('q:11')).toHaveClass('tree-q-done');
    expect(node('q:12')).toHaveClass('tree-q-in-progress');
    expect(node('q:13')).toHaveClass('tree-q-pending');
    expect(node('q:14')).toHaveClass('tree-q-available');
    expect(within(node('q:13')!).getByText('content pending')).toBeInTheDocument();
    expect(within(node('q:14')!).getByText('reading')).toBeInTheDocument();
    expect(node('q:12')).toHaveAttribute('href', '/play/102');
  });

  it('draws the act chain, the open act bus and prerequisite edges (collapsed ends attach to the gate)', async () => {
    const { user } = await openTree();
    const edges = (kind: string) => [...document.querySelectorAll(`[data-edge="${kind}"]`)].map((e) => `${e.getAttribute('data-from')}>${e.getAttribute('data-to')}`);
    expect(edges('chain')).toEqual(['a:1>a:2']);
    expect(document.querySelector('[data-edge="chain"]')).not.toHaveClass('edge-open'); // act 2 is locked
    expect(edges('bus')).toEqual(['a:1>a:1']);
    expect(edges('prereq')).toEqual(['q:11>q:12', 'q:11>q:13', 'q:12>a:2']);
    await user.click(node('a:2')!);
    expect(edges('prereq')).toEqual(['q:11>q:12', 'q:11>q:13', 'q:12>q:21']);
    expect(edges('bus')).toEqual(['a:1>a:1', 'a:2>a:2']);
  });

  it('expand all / collapse all', async () => {
    const { user } = await openTree();
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(node('q:21')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(document.querySelectorAll('[data-node^="q:"]')).toHaveLength(0);
    expect(node('a:1')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('campaign skill tree: locked content is never revealed', () => {
  it('a locked-act quest shows its title only: not a link, aria-disabled, and no unit detail is ever fetched', async () => {
    const { api, calls } = spyApi();
    const { user } = await openTree('/campaign/js', api);
    await user.click(node('a:2')!);
    const locked = node('q:21')!;
    expect(locked.tagName).toBe('DIV');
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveClass('tree-q-locked');
    expect(locked).toHaveTextContent('HTTP lab: idempotent POST /orders');
    expect(screen.queryByRole('link', { name: /HTTP lab/ })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/play/108"]')).toBeNull();
    act(() => locked.focus());
    await user.keyboard('{Enter}');
    expect(document.querySelector('[data-testid="skilltree"]')).toBeInTheDocument(); // still on the campaign page
    expect(calls).not.toContain('getUnit');
  });

  it('a locked track (Java locked in-test) renders greyed with inert locked nodes', async () => {
    const { user } = await openTree('/campaign/java', createMockApi({ lockedTracks: ['java'] }));
    expect(screen.getByRole('note')).toHaveTextContent('Java is locked.');
    expect(document.querySelector('.skilltree')).toHaveClass('skilltree-locked');
    const gate = node('a:9')!;
    expect(gate).toHaveAccessibleName(/locked: content arrives after V1/);
    // no act is unlocked: the first act is open so its titles show
    expect(gate).toHaveAttribute('aria-expanded', 'true');
    for (const key of ['q:91', 'q:92']) {
      expect(node(key)!.tagName).toBe('DIV');
      expect(node(key)).toHaveClass('tree-q-locked');
    }
    expect(document.querySelectorAll('.skilltree a')).toHaveLength(0);
    await user.click(gate);
    expect(gate).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('campaign skill tree: keyboard', () => {
  it('one tab stop on the first playable quest; arrows move; Left reaches the gate; Enter toggles a gate and opens a quest', async () => {
    const { user, path } = await openTree();
    const stops = [...document.querySelectorAll<HTMLElement>('[data-node]')].filter((n) => n.tabIndex === 0);
    expect(stops.map((n) => n.dataset.node)).toEqual(['q:12']);
    act(() => node('q:12')!.focus());
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(node('q:13'));
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(node('q:11'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(node('a:1'));
    expect(node('a:1')!.tabIndex).toBe(0); // the roving stop follows focus
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(node('q:11'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(node('a:2'));
    await user.keyboard('{Enter}');
    expect(node('a:2')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(node('q:21'));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(node('a:1'));
    await user.keyboard('{Enter}'); // collapse act 1
    expect(node('q:12')).toBeNull();
    await user.keyboard('{Enter}'); // and expand it again
    act(() => node('q:12')!.focus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(path()).toBe('/play/102'));
  });

  it('j / k still walk the quest nodes in the tree view', async () => {
    const { user } = await openTree();
    await user.keyboard('j');
    expect(document.activeElement).toBe(node('q:12'));
    await user.keyboard('j');
    expect(document.activeElement).toBe(node('q:13'));
    await user.keyboard('k');
    expect(document.activeElement).toBe(node('q:12'));
  });
});
