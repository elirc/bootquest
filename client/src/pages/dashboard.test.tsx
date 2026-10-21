import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorText } from '../api/errors';
import { createMockApi } from '../api/mock';
import { ApiError, type BootQuestApi, type Dashboard, type RetestListItemDto, type SlateItem } from '../api/types';
import { daysFrom, fmtRelative, fmtShortDate, fmtStamp, plural } from '../lib/format';
import { COMPETENCY_IDS, TRACK_IDS, isTrackId } from '../lib/view';
import { renderApp } from '../test/render';
import { reviewKeyBlocked } from './Review';

// fix/client-dash: Due-now panel, local dates, demotions, Review shortcut gating, slate routing
// and variants, the evidence deep link, friendly error text.

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function withSlate(items: SlateItem[], base = createMockApi()): BootQuestApi {
  return {
    ...base,
    getDashboard: async (): Promise<Dashboard> => {
      const d = await base.getDashboard();
      return { ...d, slate: { ...d.slate, items } };
    },
  };
}

const slateRow = (slot: string) => document.querySelector<HTMLElement>(`.slate [data-slot="${slot}"]`);

describe('local dates (lib/format)', () => {
  it('a timestamp renders on its LOCAL day: 20:00 in Los Angeles is not the next (UTC) day', () => {
    process.env.TZ = 'America/Los_Angeles';
    const evening = Date.UTC(2026, 9, 10, 3, 0); // Oct 9, 20:00 PDT = Oct 10, 03:00 UTC
    expect(fmtShortDate(evening)).toBe('Oct 9');
    expect(fmtShortDate(new Date(evening).toISOString())).toBe('Oct 9');
    expect(fmtStamp(evening)).toBe('2026-10-09 20:00');
    expect(daysFrom('2026-10-09', evening)).toBe(0);
    expect(fmtRelative('2026-10-08', evening)).toBe('tomorrow');

    // and east of UTC: 08:00 in Tokyo is still the previous day in UTC
    process.env.TZ = 'Asia/Tokyo';
    const morning = Date.UTC(2026, 9, 8, 23, 0); // Oct 9, 08:00 JST
    expect(new Date(morning).getHours()).toBe(8); // the zone switch itself took effect
    expect(fmtShortDate(morning)).toBe('Oct 9');
    expect(fmtStamp(morning)).toBe('2026-10-09 08:00');
  });

  it('a day key is that calendar day in every zone', () => {
    for (const tz of ['America/Los_Angeles', 'UTC', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      expect(fmtShortDate('2026-10-09')).toBe('Oct 9');
      expect(daysFrom('2026-10-07', '2026-10-09')).toBe(2);
    }
  });

  it('pluralizes counts', () => {
    expect(plural(1, 'drill')).toBe('1 drill');
    expect(plural(2, 'drill')).toBe('2 drills');
    expect(plural(0, 'retest')).toBe('0 retests');
  });

  it('the dashboard retest leg says the local opening day', async () => {
    process.env.TZ = 'America/Los_Angeles';
    const base = createMockApi();
    const evening = Date.UTC(2026, 9, 10, 3, 0);
    const api: BootQuestApi = {
      ...base,
      getDashboard: async () => {
        const d = await base.getDashboard();
        return {
          ...d,
          competencies: d.competencies.map((c) => (c.promotion && c.id === 'language-fluency' ? { ...c, promotion: { ...c.promotion, retest: { ...c.promotion.retest, dueAt: evening } } } : c)),
        };
      },
    };
    renderApp('/', api);
    const table = await screen.findByRole('table');
    expect(table.querySelector('[data-competency="language-fluency"] [data-leg="retest"]')).toHaveTextContent('opens Oct 9');
  });
});

describe('lib/view mirrors shared/src/enums.ts', () => {
  it('server order for tracks; all eight competencies', () => {
    expect(TRACK_IDS).toEqual(['js', 'csharp', 'java', 'agentic', 'sysdesign']);
    expect(COMPETENCY_IDS).toHaveLength(8);
    expect(isTrackId('java')).toBe(true);
    expect(isTrackId('python')).toBe(false);
  });
});

describe('Due now (open retests)', () => {
  const NOW = Date.now();
  const retests: RetestListItemDto[] = [
    { reviewItemId: 9, unitId: 777, title: 'Changed example: later one', dueAt: NOW + 2 * 86_400_000, artifactUnitId: 106, due: false },
    { reviewItemId: 8, unitId: 102, title: 'Changed example: group records by key length', dueAt: NOW - 3_600_000, artifactUnitId: 106, due: true },
  ];

  it('lists due retests first and prominently, each linking its retest unit; legs link their units', async () => {
    const base = createMockApi();
    const api: BootQuestApi = { ...base, getCompetencies: async () => ({ ...(await base.getCompetencies()), retests }) };
    renderApp('/', api);
    const panel = await screen.findByTestId('due-now');
    const section = panel.closest('section')!;
    expect(section).toHaveClass('due-now-hot');
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Due now · 1 retest open');
    const rows = panel.querySelectorAll('[data-retest]');
    expect(Array.from(rows).map((r) => r.getAttribute('data-retest'))).toEqual(['102', '777']);
    expect(rows[0]).toHaveAttribute('data-due', 'true');
    expect(within(rows[0] as HTMLElement).getByText('open now')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: /Take the retest/ })).toHaveAttribute('href', '/play/102');
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'artifact unit #106' })).toHaveAttribute('href', '/play/106');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: /Retest: Changed example: later one/ })).toHaveAttribute('href', '/play/777');
    expect(rows[1]).toHaveTextContent(`opens ${fmtShortDate(NOW + 2 * 86_400_000)}`);

    // the competency legs: artifact + retest chips are links; the due retest says so
    const lf = screen.getByRole('table').querySelector<HTMLElement>('[data-competency="language-fluency"]')!;
    expect(within(lf.querySelector<HTMLElement>('[data-leg="artifact"]')!).getByRole('link')).toHaveAttribute('href', '/play/106');
    const retestLeg = lf.querySelector<HTMLElement>('[data-leg="retest"]')!;
    expect(within(retestLeg).getByRole('link')).toHaveAttribute('href', '/play/102');
    expect(retestLeg).toHaveTextContent('open now');
    // explain-back has no unit on the wire: stays a plain chip
    expect(within(lf.querySelector<HTMLElement>('[data-leg="explain"]')!).queryByRole('link')).toBeNull();
  });

  it('says how a retest gets scheduled when there is none; a failed read has its own retry', async () => {
    renderApp('/');
    expect(await screen.findByTestId('due-empty')).toHaveTextContent('A passing explain-back');
    expect(screen.getByTestId('due-now').closest('section')).not.toHaveClass('due-now-hot');

    const base = createMockApi();
    let fail = true;
    const api: BootQuestApi = {
      ...base,
      getCompetencies: () => (fail ? Promise.reject(new ApiError(500, 'INTERNAL', 'boom')) : base.getCompetencies()),
    };
    const second = renderApp('/', api);
    const due = await within(second.container).findByTestId('due-now');
    expect(within(due).getByRole('alert')).toHaveTextContent('boom');
    // the rest of the dashboard is still there
    expect(within(second.container).getByRole('table')).toBeInTheDocument();
    fail = false;
    await second.user.click(within(due).getByRole('button', { name: 'Retry' }));
    expect(await within(second.container).findByTestId('due-empty')).toBeInTheDocument();
  });

  it('the panel\'s Retry keeps the rest of the dashboard mounted (no blank page, no refetched slate targets)', async () => {
    const base = createMockApi();
    let fail = true;
    let release: () => void = () => {};
    let trackUnitCalls = 0;
    const api: BootQuestApi = {
      ...base,
      getCompetencies: () =>
        fail
          ? Promise.reject(new ApiError(500, 'INTERNAL', 'boom'))
          : new Promise((resolve, reject) => {
              release = () => void base.getCompetencies().then(resolve, reject);
            }),
      getTrackUnits: (t) => {
        trackUnitCalls++;
        return base.getTrackUnits(t);
      },
    };
    const { user, container } = renderApp('/', api);
    const due = await within(container).findByTestId('due-now');
    await waitFor(() => expect(within(slateRow('drill:js')!).getByRole('link')).toHaveAttribute('href', '/play/102'));
    const table = within(container).getByRole('table');
    const calls = trackUnitCalls;
    fail = false;
    await user.click(within(due).getByRole('button', { name: 'Retry' }));
    // mid-reload: the page is still there (same nodes), and the panel does not claim "no retests"
    expect(table).toBeInTheDocument();
    expect(within(container).getByTestId('due-now')).toBe(due);
    expect(within(due).queryByTestId('due-empty')).toBeNull();
    act(() => release());
    expect(await within(due).findByTestId('due-empty')).toBeInTheDocument();
    expect(table).toBeInTheDocument();
    expect(trackUnitCalls).toBe(calls);
  });
});

describe('slate routing and variants', () => {
  it('drill sets go to the next unpassed drill; the campaign step to the track that has one', async () => {
    const api = createMockApi();
    renderApp('/', api);
    await screen.findByTestId('due-now');
    // csharp: the dashboard's own next-up unit is a drill (202)
    expect(within(slateRow('drill:csharp')!).getByRole('link')).toHaveAttribute('href', '/play/202');
    // js: next-up is a program unit, so the first open drill of the track list (102)
    await waitFor(() => expect(within(slateRow('drill:js')!).getByRole('link')).toHaveAttribute('href', '/play/102'));
    // java: no drill unit at all -> the track page
    expect(within(slateRow('drill:java')!).getByRole('link')).toHaveAttribute('href', '/campaign/java');
    // campaign: the in-progress quest of the first track with an actionable one
    await waitFor(() => expect(within(slateRow('campaign')!).getByRole('link')).toHaveAttribute('href', '/campaign/js?unit=102'));
    expect(slateRow('campaign')).toHaveTextContent('Campaign step JS/TS');
    expect(slateRow('drill:js')).toHaveTextContent('JS/TS drill set (5 drills)');
  });

  it('size 1 and 2 are pluralized; a missing track slot is stated neutrally (never "exhausted")', async () => {
    renderApp(
      '/',
      withSlate([
        { slot: 'drill:js', kind: 'drill-set', track: 'js', size: 1, done: false },
        { slot: 'drill:csharp', kind: 'drill-set', track: 'csharp', size: 2, done: true },
        { slot: 'campaign', kind: 'campaign-step', done: false },
        { slot: 'review', kind: 'review-clear', done: false },
      ]),
    );
    await screen.findByTestId('due-now');
    expect(slateRow('drill:js')).toHaveTextContent('JS/TS drill set (1 drill)');
    expect(slateRow('drill:js')).not.toHaveTextContent('1 drills');
    expect(slateRow('drill:csharp')).toHaveTextContent('C#/.NET drill set (2 drills)');
    const java = slateRow('drill:java')!;
    expect(java).toHaveAttribute('data-missing', 'true');
    // fix/client-review 7g: a missing row may be slate_drills=0, not an exhausted track
    expect(java).toHaveTextContent("Java drills no drill slot on today's slate");
    expect(java).not.toHaveTextContent('exhausted');
    expect(within(java).queryByRole('link')).toBeNull();
    // the tile counts only the real slots
    expect(screen.getByRole('progressbar', { name: 'Slate items cleared' })).toHaveAttribute('aria-valuemax', '4');
    expect(screen.queryByTestId('slate-review-only')).toBeNull();
  });

  it('a review-only slate explains itself', async () => {
    renderApp('/', withSlate([{ slot: 'review', kind: 'review-clear', done: false }]));
    expect(await screen.findByTestId('slate-review-only')).toHaveTextContent('Review-only day');
    for (const t of ['js', 'csharp', 'java', 'sysdesign']) expect(slateRow(`drill:${t}`)).toHaveAttribute('data-missing', 'true');
    expect(slateRow('campaign')).toHaveTextContent('nothing open in an unlocked act today');
    expect(within(slateRow('review')!).getByRole('link')).toHaveAttribute('href', '/review');
    expect(screen.getByRole('progressbar', { name: 'Slate items cleared' })).toHaveAttribute('aria-valuemax', '1');
  });
});

describe('Review: demotions and shortcut gating', () => {
  it('a demotion from a grade is announced with the competency, old -> new, and its evidence', async () => {
    const base = createMockApi();
    const api: BootQuestApi = {
      ...base,
      gradeReview: async (id, g) => ({ ...(await base.gradeReview(id, g)), demotion: { competency: 'language-fluency', from: 3, to: 2, evidenceId: 913 } }),
    };
    const { user } = renderApp('/review', api);
    await screen.findByRole('button', { name: /Show answer/ });
    expect(screen.queryByTestId('demotion')).toBeNull();
    await user.keyboard(' ');
    await user.keyboard('1');
    const note = await screen.findByTestId('demotion');
    expect(note).toHaveAttribute('role', 'alert');
    expect(note).toHaveTextContent('Language fluency demoted: 3 → 2');
    expect(within(note).getByRole('link', { name: 'evidence #913' })).toHaveAttribute('href', '/stats?competency=language-fluency#evidence-913');
  });

  it('1-4 do nothing while a dialog is open, on auto-repeat, or when already handled', async () => {
    const base = createMockApi();
    const gradeReview = vi.fn(base.gradeReview);
    const { user } = renderApp('/review', { ...base, gradeReview });
    await screen.findByRole('button', { name: /Show answer/ });
    await user.keyboard(' ');
    await screen.findByRole('button', { name: /Good/ });

    // the shortcut help dialog owns the keyboard
    await user.keyboard('?');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('3');
    expect(gradeReview).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // a held key (auto-repeat) never grades
    act(() => {
      fireEvent.keyDown(window, { key: '3', repeat: true });
    });
    expect(gradeReview).not.toHaveBeenCalled();

    // someone earlier in the chain already handled it
    const claim = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', claim, true);
    act(() => {
      fireEvent.keyDown(document.body, { key: '3' });
    });
    window.removeEventListener('keydown', claim, true);
    expect(gradeReview).not.toHaveBeenCalled();

    // a plain press still grades
    await user.keyboard('3');
    await waitFor(() => expect(gradeReview).toHaveBeenCalledTimes(1));
  });

  it('Space / Enter on a focused control belong to that control, not to "Show answer"', async () => {
    renderApp('/review');
    await screen.findByRole('button', { name: /Show answer/ });
    const link = screen.getAllByRole('link', { name: /Dashboard/ })[0]!;
    link.focus();
    act(() => {
      fireEvent.keyDown(link, { key: ' ' });
      fireEvent.keyDown(link, { key: 'Enter' });
    });
    expect(screen.queryByTestId('card-back')).toBeNull();
    // from the page body it reveals
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      fireEvent.keyDown(document.body, { key: ' ' });
    });
    expect(await screen.findByTestId('card-back')).toBeInTheDocument();
  });

  it('reviewKeyBlocked: editable targets and digit-consuming widgets', () => {
    const input = document.createElement('input');
    const group = document.createElement('div');
    group.setAttribute('role', 'radiogroup');
    const radio = document.createElement('span');
    group.appendChild(radio);
    document.body.append(input, group);
    const ev = (key: string, target: EventTarget) => {
      const e = new KeyboardEvent('keydown', { key });
      Object.defineProperty(e, 'target', { value: target });
      return e;
    };
    expect(reviewKeyBlocked(ev('1', input))).toBe(true);
    expect(reviewKeyBlocked(ev('1', radio))).toBe(true);
    expect(reviewKeyBlocked(ev('1', document.body))).toBe(false);
    input.remove();
    group.remove();
  });
});

describe('evidence deep link', () => {
  it('/stats?…#evidence-N scrolls to that row, focuses and marks it', async () => {
    const scroll = vi.fn();
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = scroll;
    try {
      renderApp('/stats?competency=language-fluency#evidence-412');
      const list = await screen.findByTestId('evidence-list');
      const row = within(list).getAllByRole('listitem').find((li) => li.id === 'evidence-412')!;
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(scroll.mock.contexts[0]).toBe(row);
      expect(row).toHaveAttribute('data-highlight', 'true');
      expect(row).toHaveClass('evidence-row-hit');
      expect(document.activeElement).toBe(row);
      expect(list.querySelectorAll('[data-highlight]')).toHaveLength(1);
    } finally {
      proto.scrollIntoView = had;
    }
  });

  it('an evidence id that is not in the list says so instead of failing silently', async () => {
    // fix/client-review 7e: the note is scrolled into view (it sits below the stats panels)
    const scroll = vi.fn();
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown };
    const had = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView');
    const prev = proto.scrollIntoView;
    proto.scrollIntoView = scroll;
    try {
      renderApp('/stats?competency=language-fluency#evidence-409');
      const note = await screen.findByTestId('evidence-target-missing');
      expect(note).toHaveTextContent('Evidence #409 is not in this list (it is filtered by competency).');
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(scroll.mock.contexts).toContain(note);
    } finally {
      if (had) proto.scrollIntoView = prev;
      else delete proto.scrollIntoView;
    }
  });

  it('a failed attempt load does not stick: the next open retries and shows the attempt', async () => {
    const base = createMockApi();
    let calls = 0;
    const api: BootQuestApi = {
      ...base,
      getAttempt: (id) => (++calls === 1 ? Promise.reject(new ApiError(500, 'INTERNAL', 'attempt read failed')) : base.getAttempt(id)),
    };
    const { user } = renderApp('/stats?competency=language-fluency', api);
    await screen.findByTestId('evidence-list');
    const btn = screen.getByRole('button', { name: 'attempt #8811' });
    await user.click(btn);
    expect(await within(screen.getByTestId('attempt-8811')).findByRole('alert')).toHaveTextContent('attempt read failed');
    await user.click(btn); // close
    await user.click(btn); // open again
    expect(await screen.findByTestId('attempt-8811')).toHaveTextContent('signalpost U01');
    expect(within(screen.getByTestId('attempt-8811')).queryByRole('alert')).toBeNull();
  });
});

describe('friendly error text for the new codes', () => {
  it('ARTIFACT_REQUIRED, the local-only guards, and SYNC_RELINK_FAILED (which is NOT "retry the sync")', () => {
    expect(errorText(new ApiError(409, 'ARTIFACT_REQUIRED', 'x'))).toBe('Pass the linked artifact unit solo first — the explain-back opens after. (ARTIFACT_REQUIRED)');
    for (const code of ['HOST_NOT_ALLOWED', 'ORIGIN_NOT_ALLOWED', 'UNSUPPORTED_MEDIA_TYPE'] as const) {
      expect(errorText(new ApiError(403, code, 'raw server text'))).not.toContain('raw server text');
    }
    // fix/client-review 7b: the server's message (cause, "next start may refuse", backup hint) wins
    const serverMsg = 'sync 4 COMMITTED (a@123): Re-linking FAILED: boom. The next server start will likely REFUSE to start; restore data/backup.db';
    expect(errorText(new ApiError(500, 'SYNC_RELINK_FAILED', serverMsg))).toBe(`${serverMsg} (SYNC_RELINK_FAILED)`);
    // the fallback (empty server message) never advises a plain restart nor a re-sync
    const relink = errorText(new ApiError(500, 'SYNC_RELINK_FAILED', ''));
    expect(relink).toContain('sync itself was saved');
    expect(relink).toContain('old ladder');
    expect(relink).toContain('next start may refuse');
    expect(relink).not.toMatch(/Restart the server to load/);
    expect(relink).not.toMatch(/try (the sync )?again|retry/i);
  });

  it('RETEST_NOT_OPEN (a retest with no schedule) does not claim a schedule exists', () => {
    const t = errorText(new ApiError(409, 'RETEST_NOT_OPEN', 'x'));
    expect(t).toContain('not scheduled yet');
    expect(t).not.toMatch(/when its schedule is due/);
  });
});
