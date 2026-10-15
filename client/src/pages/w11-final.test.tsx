// W11 final UI sweep: regressions for the findings fixed in docs/recon/ui-audit.md "W11 final sweep".
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type CampaignActDto, type UnitDetail } from '../api/types';
import { fmtStamp, fmtWhen } from '../lib/format';
import { renderApp } from '../test/render';
import { CAMPAIGN_VIEW_KEY } from './CampaignTree';

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');
const css = (name: string) => readFileSync(join(STYLES, name), 'utf8');
/** the declaration block of every rule whose selector list is exactly `selector` */
const rules = (src: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...src.matchAll(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!);
};

function withUnit(id: number, edit: (d: UnitDetail) => UnitDetail, base: BootQuestApi = createMockApi()): BootQuestApi {
  return { ...base, getUnit: async (u) => (u === id ? edit(await base.getUnit(u)) : base.getUnit(u)) };
}
function withCampaign(edit: (acts: CampaignActDto[], level: number) => { acts: CampaignActDto[]; level: number }, base: BootQuestApi = createMockApi()): BootQuestApi {
  return {
    ...base,
    getCampaign: async (t) => {
      const c = await base.getCampaign(t);
      return { ...c, ...edit(c.acts, c.level) };
    },
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('W11 #1/#2 campaign act cards (CSS regressions)', () => {
  it('the act header progress bar has a width (it collapsed to 0px in the end-aligned column)', () => {
    const decl = rules(css('app.css'), '.act-side .bar');
    expect(decl).toHaveLength(1);
    expect(decl[0]).toMatch(/width:\s*\d+px/);
  });

  it('`.act-locked` is ONLY the campaign card state: the player locked panel has its own class', async () => {
    const app = css('app.css');
    const actLocked = rules(app, '.act-locked');
    expect(actLocked).toHaveLength(1); // the card state rule; the W9 panel rule used to be a second one
    expect(actLocked[0]).not.toMatch(/max-width|display/);
    expect(app).not.toMatch(/\.act-locked p\b/);
    expect(rules(app, '.unit-locked')).toHaveLength(1);

    const api = withUnit(102, (d) => ({ ...d, actGate: { locked: true }, check: null, instructions: null, starter: null }));
    renderApp('/play/102', api);
    const panel = await screen.findByTestId('act-locked');
    expect(panel).toHaveClass('unit-locked');
    expect(panel).not.toHaveClass('act-locked');
  });

  it('the uncovered-legs note border is a token (--warning-line), defined in tokens.css', () => {
    expect(css('tokens.css')).toMatch(/--warning-line:\s*rgba\(/);
    const decl = rules(css('app.css'), '.uncovered');
    expect(decl[0]).toMatch(/border:\s*1px solid var\(--warning-line\)/);
    expect(css('app.css')).not.toMatch(/rgba\(210, 153, 34, 0\.4\)/);
  });
});

describe('W11 #11 campaign list meta line at phone width', () => {
  it('the repo meta line wraps (no ellipsis, no nowrap): the full repo name is visible text, not a tooltip', async () => {
    const decl = rules(css('app.css'), '.step-meta');
    expect(decl).toHaveLength(1);
    expect(decl[0]).toMatch(/overflow-wrap:\s*anywhere/);
    expect(decl[0]).not.toMatch(/text-overflow|white-space:\s*nowrap|overflow:\s*hidden/);

    const c = await createMockApi().getCampaign('js');
    const q = c.acts.flatMap((a) => a.quests)[0]!;
    renderApp('/campaign/js');
    const li = await waitFor(() => {
      const n = document.querySelector<HTMLElement>(`[data-quest="${q.id}"]`);
      expect(n).not.toBeNull();
      return n!;
    });
    expect(li.querySelector('.step-meta')).toHaveTextContent(q.repo);
  });
});

describe('W11 #3 unlock rule: a level already reached is not shown as an open requirement', () => {
  const lockedWithLevel = (need: number, have: number) =>
    withCampaign((acts) => ({
      level: have,
      acts: acts.map((a, i) => (i === 1 ? { ...a, unlocked: false, unlockRule: { ...a.unlockRule, staticLock: false, previousCorePct: 80, level: need } } : a)),
    }));

  it('list view', async () => {
    renderApp('/campaign/js', lockedWithLevel(4, 6));
    expect(await screen.findByText(/Unlocks at 80% of the previous act's core quests and level 4 \(reached\)\./)).toBeInTheDocument();
  });

  it('list view, level not reached yet', async () => {
    renderApp('/campaign/js', lockedWithLevel(4, 3));
    expect(await screen.findByText(/level 4 \(you are level 3\)\./)).toBeInTheDocument();
  });

  it('tree view (gate label)', async () => {
    window.localStorage.setItem(CAMPAIGN_VIEW_KEY, 'tree');
    renderApp('/campaign/js', lockedWithLevel(4, 6));
    await screen.findByTestId('skilltree');
    const gate = document.querySelector<HTMLElement>('[data-node^="a:"][aria-label*="locked"]')!;
    expect(gate.getAttribute('aria-label')).toMatch(/level 4 \(reached\)/);
    expect(gate.getAttribute('aria-label')).not.toMatch(/you: 6/);
  });
});

describe('W11 campaign `?unit=` target (ReadingEmpty / locked panel links)', () => {
  async function pickQuest(lockedAct: boolean) {
    const c = await createMockApi().getCampaign('js');
    const act = c.acts.find((a) => a.unlocked === !lockedAct && a.quests.some((q) => q.unitId !== undefined))!;
    return act.quests.find((q) => q.unitId !== undefined)!;
  }

  it('list view: the targeted quest is marked, focused and announced as the current location', async () => {
    const q = await pickQuest(false);
    renderApp(`/campaign/js?unit=${q.unitId}`);
    await screen.findByRole('tabpanel', { name: 'Campaign acts' });
    const li = document.querySelector<HTMLElement>(`[data-quest="${q.id}"]`)!;
    await waitFor(() => expect(li.querySelector('[data-step]')).toHaveFocus());
    expect(li).toHaveClass('step-target');
    expect(li).toHaveAttribute('aria-current', 'location');
    expect(document.querySelectorAll('.step-target')).toHaveLength(1);
  });

  it('tree view: a quest in a collapsed (locked) act is revealed, focused and marked', async () => {
    const q = await pickQuest(true);
    window.localStorage.setItem(CAMPAIGN_VIEW_KEY, 'tree');
    renderApp(`/campaign/js?unit=${q.unitId}`);
    await screen.findByTestId('skilltree');
    const el = await waitFor(() => {
      const n = document.querySelector<HTMLElement>(`[data-node="q:${q.id}"]`);
      expect(n).not.toBeNull();
      return n!;
    });
    await waitFor(() => expect(el).toHaveFocus());
    expect(el).toHaveClass('tree-q-target');
    expect(el).toHaveAttribute('aria-current', 'location');
    expect(el.tagName).toBe('DIV'); // still inert: a locked quest never becomes a link
  });

  it('an unknown or junk unit id targets nothing', async () => {
    renderApp('/campaign/js?unit=abc');
    await screen.findByRole('tabpanel', { name: 'Campaign acts' });
    expect(document.querySelectorAll('.step-target, [aria-current="location"]')).toHaveLength(0);
  });

  it('tree view at phone width: the target is scrolled to on the MEASURED layout, not the fallback one', async () => {
    // jsdom has no layout: give the tree box a phone width and record, for each scroll, whether
    // the tree had already been laid out at that width (one column = `skilltree-narrow`). The
    // fallback-width layout puts the node ~2,000px higher than where it ends up at 400px.
    const q = await pickQuest(true);
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('skilltree') ? 368 : 0;
    });
    const scrolls: { node: string | undefined; narrow: boolean }[] = [];
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown }; // jsdom has none
    const had = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView');
    const prev = proto.scrollIntoView;
    proto.scrollIntoView = function (this: HTMLElement) {
      scrolls.push({ node: this.dataset.node, narrow: !!this.closest('.skilltree-narrow') });
    };
    try {
      window.localStorage.setItem(CAMPAIGN_VIEW_KEY, 'tree');
      renderApp(`/campaign/js?unit=${q.unitId}`);
      await screen.findByTestId('skilltree');
      const el = await waitFor(() => {
        const n = document.querySelector<HTMLElement>(`[data-node="q:${q.id}"]`);
        expect(n).toHaveFocus();
        return n!;
      });
      expect(el.closest('.skilltree')).toHaveClass('skilltree-narrow');
      const toTarget = scrolls.filter((s) => s.node === `q:${q.id}`);
      expect(toTarget.length).toBeGreaterThan(0);
      expect(toTarget.every((s) => s.narrow)).toBe(true);
    } finally {
      width.mockRestore();
      if (had) proto.scrollIntoView = prev;
      else delete proto.scrollIntoView;
    }
  });
});

describe('W11 #6/#7 written unit: no immutable store of the untouched template; focus follows the store', () => {
  const REVIEW = 113; // fixture with a starter template

  it('Submit stays disabled until the starter template is edited, with a note saying why', async () => {
    const { user } = renderApp(`/play/${REVIEW}`);
    const box = await screen.findByRole('textbox', { name: 'Your answer' });
    expect((box as HTMLTextAreaElement).value.trim()).not.toBe('');
    const submit = screen.getByRole('button', { name: /Submit answer/ });
    expect(submit).toBeDisabled();
    expect(screen.getByTestId('draft-note')).toHaveTextContent('an untouched template cannot be stored');
    await user.type(box, ' The handler trusts the body orgId.');
    expect(submit).toBeEnabled();
    expect(screen.getByTestId('draft-note')).not.toHaveTextContent('untouched template');
  });

  it('after storing, keyboard focus lands on the model-answer heading (not <body>)', async () => {
    const { user } = renderApp(`/play/${REVIEW}`);
    await user.type(await screen.findByRole('textbox', { name: 'Your answer' }), ' my findings');
    await user.click(screen.getByRole('button', { name: /Submit answer/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Store answer and show the model answer/ }));
    const h = await screen.findByRole('heading', { name: 'Compare with the model answer' });
    await waitFor(() => expect(h).toHaveFocus());
    expect(screen.getByTestId('stored-meta')).not.toHaveTextContent('UTC');
  });

  it('the API refuses the untouched template too (422 UNTOUCHED_TEMPLATE), mirrored by the mock', async () => {
    const api = createMockApi();
    const starter = (await api.getUnit(REVIEW)).starter!;
    expect(starter.trim()).not.toBe('');
    await expect(api.answerWritten(REVIEW, { answer: `\n${starter}  `, selfAssisted: false })).rejects.toMatchObject({ status: 422, code: 'UNTOUCHED_TEMPLATE' });
    await expect(api.getModelAnswer(REVIEW)).rejects.toMatchObject({ code: 'NOT_ANSWERED' });
  });

  it('a server UNTOUCHED_TEMPLATE refusal is shown as a learner-facing line, and nothing is stored', async () => {
    // e.g. the client guard and the server disagree on whitespace: the server's refusal still reads well
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      answerWritten: async () => {
        throw new ApiError(422, 'UNTOUCHED_TEMPLATE', 'unit: the answer is the unchanged starter template');
      },
    };
    const { user } = renderApp(`/play/${REVIEW}`, api);
    await user.type(await screen.findByRole('textbox', { name: 'Your answer' }), ' x');
    await user.click(screen.getByRole('button', { name: /Submit answer/ }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Store answer and show the model answer/ }));
    expect(await screen.findByText(/That is the unchanged starter template\. Write your answer into it before storing it\. \(UNTOUCHED_TEMPLATE\)/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Compare with the model answer' })).toBeNull();
  });
});

describe('W11 #10 stored timestamps are local time (the server day keys are local)', () => {
  it('fmtWhen / fmtStamp use local fields, no UTC label', () => {
    const ms = new Date(2026, 9, 14, 23, 5).getTime(); // local 23:05
    expect(fmtWhen(ms)).not.toContain('UTC');
    expect(fmtWhen(ms)).toMatch(/Oct 14/);
    expect(fmtStamp(ms)).toBe('2026-10-14 23:05');
  });
});

describe('W11 #4/#5 review forecast', () => {
  it('every day keeps its weekday label (tomorrow is no longer dropped) and Today has its own row', async () => {
    renderApp('/stats');
    const panel = await screen.findByTestId('review-stats', {}, { timeout: 5000 });
    const svg = panel.querySelector('svg.chart-svg')!;
    const ticks = [...svg.querySelectorAll('text.chart-tick:not(.chart-sub-tick)')].map((t) => t.textContent).filter((t) => /^[A-Z][a-z]$/.test(t ?? ''));
    expect(ticks).toHaveLength(14);
    expect(svg.querySelector('text.chart-sub-tick')?.textContent).toBe('Today');
  });

  it("the forecast's data table sits under the forecast, before Grades", async () => {
    renderApp('/stats');
    const panel = await screen.findByTestId('review-stats', {}, { timeout: 5000 });
    const table = within(panel).getByText('Data table').closest('details')!;
    const grades = within(panel).getByText('Grades');
    expect(table.compareDocumentPosition(grades) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no cards: no forecast data table', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      getReviewStats: async () => {
        const s = await base.getReviewStats();
        return { ...s, cards: 0, dueNow: 0, overdue: 0, later: 0, forecast: s.forecast.map((d) => ({ ...d, due: 0 })) };
      },
    };
    renderApp('/stats', api);
    const empty = await screen.findByTestId('review-empty', {}, { timeout: 5000 });
    const panel = empty.closest<HTMLElement>('[data-testid="review-stats"]')!;
    expect(within(panel).queryByText('Data table')).not.toBeInTheDocument();
  });
});

describe('W11 #9 reading-list titles render inline code', () => {
  it('backticks in a study reading step title become <code>, not literal backticks', async () => {
    const api = withUnit(206, (d) =>
      d.studyQuest ? { ...d, studyQuest: { ...d.studyQuest, readingSteps: d.studyQuest.readingSteps.map((r, i) => (i === 0 ? { ...r, title: 'The `Try` pattern' } : r)) } } : d,
    );
    renderApp('/play/206', api);
    const list = await screen.findByTestId('reading-list');
    const link = within(list).getByRole('link', { name: 'The Try pattern' });
    expect(link.querySelector('code')?.textContent).toBe('Try');
    expect(list.textContent).not.toContain('`');
  });
});

describe('W11 #8 nav review badge counts down during a session', () => {
  it('each grade updates the badge from the server remainingDue', async () => {
    const { user } = renderApp('/review');
    const nav = screen.getByRole('complementary', { name: 'Primary' });
    const badge = await within(nav).findByLabelText(/\d+ due/);
    const start = Number(badge.textContent);
    expect(start).toBeGreaterThan(1);
    await screen.findByRole('button', { name: /Show answer/ });
    await user.keyboard(' ');
    await user.keyboard('3');
    await waitFor(() => expect(within(nav).getByLabelText(/\d+ due/)).toHaveTextContent(String(start - 1)));
  });
});
