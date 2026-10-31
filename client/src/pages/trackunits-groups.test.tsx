// ab S4: the Practice-units browser renders group headers only until a group is opened (JS serves
// ~4,000 units); the filter still covers every unit. Render counts over a 4,000-row fixture.
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockApi } from '../api/mock';
import type { BootQuestApi, TrackId, UnitSummary } from '../api/types';
import { renderApp } from '../test/render';
import { AUTO_EXPAND_MAX } from './TrackUnits';

const MODULES = 40;
const PER_MODULE = 100;
/** a JS-sized payload: 4,000 units over 40 modules (key `jsdrills/<module>/<slug>`) */
function big(): UnitSummary[] {
  return Array.from({ length: MODULES * PER_MODULE }, (_, i) => ({
    id: 10_000 + i,
    key: `jsdrills/${String(Math.floor(i / PER_MODULE)).padStart(2, '0')}-mod${Math.floor(i / PER_MODULE)}/u${i}`,
    trackId: 'sysdesign' as TrackId,
    kind: i % 4 === 0 ? ('explain-back' as const) : ('drill' as const),
    title: i === 1234 ? 'Needle unit' : `Unit ${i}`,
    difficulty: 1,
    state: i % 10 === 0 ? ('done' as const) : ('available' as const),
    revealed: false,
    prerequisites: [],
  }));
}
function bigApi(): BootQuestApi {
  const base = createMockApi();
  return { ...base, getTrackUnits: async (t) => ({ ...(await base.getTrackUnits(t)), units: big() }) };
}
const rows = () => document.querySelectorAll('[data-unit]');
const groupButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.tu-group > h3 > button')];

describe('unit browser: groups collapsed by default (4,000-row fixture)', () => {
  async function open() {
    const r = renderApp('/campaign/sysdesign', bigApi());
    const sec = await screen.findByTestId('track-units');
    await within(sec).findByTestId('track-units-count');
    const search = within(sec.querySelector<HTMLElement>('.tu-toolbar')!).getByRole('searchbox', { name: 'Filter units' });
    return { ...r, sec, search };
  }

  it('renders the 40 group headers and zero rows; counts still cover every unit', async () => {
    const { sec } = await open();
    expect(rows()).toHaveLength(0);
    expect(groupButtons()).toHaveLength(MODULES);
    expect(groupButtons().every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(within(sec).getByTestId('track-units-count')).toHaveTextContent('Showing 4000 of 4000 units · 400 done');
    expect(groupButtons()[0]).toHaveTextContent('mod0 10/100 done');
  });

  it('opening one group renders only its rows; closing it removes them', async () => {
    const { user } = await open();
    const g = groupButtons()[3]!;
    await user.click(g);
    expect(g).toHaveAttribute('aria-expanded', 'true');
    expect(rows()).toHaveLength(PER_MODULE);
    expect(document.getElementById(g.getAttribute('aria-controls')!)!.querySelectorAll('[data-unit]')).toHaveLength(PER_MODULE);
    await user.click(g);
    expect(rows()).toHaveLength(0);
  });

  it('the filter runs across everything: a narrow query opens just the matching group', async () => {
    const { user, sec, search } = await open();
    await user.type(search, 'needle');
    expect(within(sec).getByTestId('track-units-count')).toHaveTextContent('Showing 1 of 4000 units');
    expect([...rows()].map((r) => (r as HTMLElement).dataset.unit)).toEqual(['11234']);
    expect(groupButtons()).toHaveLength(1);
    expect(groupButtons()[0]).toHaveTextContent('mod12 10/100 done · 1 shown');
    expect(groupButtons()[0]).toHaveAttribute('aria-expanded', 'true');
    // the learner can still close an auto-opened group
    await user.click(groupButtons()[0]!);
    expect(rows()).toHaveLength(0);
  });

  it(`a broad query (more than ${AUTO_EXPAND_MAX} matches) keeps the groups closed; kind filters only change the counts`, async () => {
    const { user, sec, search } = await open();
    await user.type(search, 'unit 1');
    expect(within(sec).getByTestId('track-units-count')).toHaveTextContent(/Showing \d{3,4} of 4000 units/);
    expect(rows()).toHaveLength(0);
    await user.clear(search);
    await user.click(within(sec).getByRole('button', { name: 'Explain-backs (1000)' }));
    expect(within(sec).getByTestId('track-units-count')).toHaveTextContent('Showing 1000 of 4000 units');
    expect(rows()).toHaveLength(0);
    expect(groupButtons()[0]).toHaveTextContent('mod0 10/100 done · 25 shown');
  });

  it('Expand all / Collapse all', async () => {
    const { user, sec, search } = await open();
    await user.type(search, 'mod7');
    const all = within(sec).getByTestId('track-units-all');
    expect(all).toHaveTextContent('Collapse all');
    expect(rows()).toHaveLength(PER_MODULE);
    await user.click(all);
    expect(rows()).toHaveLength(0);
    expect(all).toHaveTextContent('Expand all');
    await user.click(all);
    expect(rows()).toHaveLength(PER_MODULE);
  });
});
