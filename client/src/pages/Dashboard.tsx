import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import type {
  CompetenciesResponse,
  CompetencyRow,
  Dashboard as DashboardData,
  PromotionLegState,
  PromotionProgress,
  RetestListItemDto,
  SlateItem,
  TrackId,
} from '../api/types';
import { Heatmap } from '../components/Heatmap';
import { Icon } from '../components/Icon';
import { Chip, Kbd, LoadState, PageHeader, Panel, ProgressBar, RatingPips } from '../components/ui';
import { fmtInt, fmtRelative, fmtShortDate, fmtWhen, plural } from '../lib/format';
import { useTracks } from '../lib/tracks';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { FREEZE_TOKENS_MAX, SLATE_DRILL_TRACKS, TRACK_IDS, TRACK_LABEL, TRACK_PLACEHOLDER, dayOfMs, isTrackId } from '../lib/view';

type Loaded<T> = AsyncState<T> & { reload: () => void };

export function DashboardPage() {
  const api = useApi();
  const q = useAsync(() => api.getDashboard(), [api]);
  // fix/client-dash: the open retests live on GET /competencies only (the review queue excludes
  // them by design). Requested alongside the dashboard and laid out once it SETTLES, so the
  // "Due now" panel never pushes the page down after first paint.
  const comp = useAsync(() => api.getCompetencies(), [api]);
  // fix/client-review 4: only the FIRST paint waits for /competencies. Once the body is up it stays
  // mounted while the Due-now panel reloads (its own Retry), so the rest of the page (and the slate
  // target lookups it fires on mount) is not torn down and refetched.
  const [painted, setPainted] = useState(false);
  const showBody = q.status === 'ready' && (painted || comp.status !== 'loading');
  if (showBody && !painted) setPainted(true);
  return (
    <>
      <PageHeader
        eyebrow={q.data ? new Date(`${q.data.today}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ' '}
        title="Dashboard"
      />
      {showBody ? <DashboardBody d={q.data} comp={comp} /> : <LoadState error={q.error} onRetry={q.reload} minHeight={720} />}
    </>
  );
}

/**
 * fix-wave 6a (display only — the server's slate/streak math is untouched): on a day that has real
 * work, a "Clear the review queue" slot the server marks done while NOTHING is due is not work
 * cleared, so it is left out of the tile's X / N and the progress bar and its row says "nothing
 * due". A review-only day is exempt: there the review slot is the whole slate (never 0 / 0).
 */
function vacuousReviewSlot(items: readonly SlateItem[], reviewDue: number): (s: SlateItem) => boolean {
  const reviewOnly = items.every((s) => s.kind === 'review-clear');
  return (s) => !reviewOnly && s.kind === 'review-clear' && s.done && reviewDue === 0;
}

function DashboardBody({ d, comp }: { d: DashboardData; comp: Loaded<CompetenciesResponse> }) {
  const items = d.slate.items;
  const vacuous = vacuousReviewSlot(items, d.reviewQueue.due);
  const counted = items.filter((s) => !vacuous(s));
  const slateDone = counted.filter((s) => s.done).length;
  // No xpToday on the wire (W-7): today's heatmap row is the server's own number for it.
  const xpToday = d.heatmap.find((h) => h.day === d.today)?.xp ?? 0;
  const tokens = Math.min(d.streak.tokens, FREEZE_TOKENS_MAX);
  const retests = comp.data?.retests ?? [];
  const dueRetestUnits = new Set(retests.filter((r) => r.due).map((r) => r.unitId));
  return (
    <div className="dash">
      <div className="tiles">
        <section className="tile" aria-labelledby="t-streak">
          <h2 className="tile-label" id="t-streak">
            <Icon name="flame" /> Streak
          </h2>
          <div className="tile-value">
            {d.streak.current}
            <span className="tile-unit">days</span>
          </div>
          <div className="tile-meta">
            <span
              className="freeze"
              aria-label={`${d.streak.tokens} of ${FREEZE_TOKENS_MAX} freeze tokens banked`}
              title={`${d.streak.tokens} of ${FREEZE_TOKENS_MAX} freeze tokens banked — a banked token automatically covers one missed day; every 7 full slate days banks one`}
            >
              {Array.from({ length: FREEZE_TOKENS_MAX }, (_, i) => (
                <span key={i} className={`freeze-token${i < tokens ? ' freeze-on' : ''}`}>
                  <Icon name="snow" size={14} />
                </span>
              ))}
            </span>
            <span title="Slate-days banked toward the next freeze token">
              {d.streak.slateDaysBanked} banked · best {d.streak.longest}
            </span>
          </div>
        </section>

        <section className="tile" aria-labelledby="t-level">
          <h2 className="tile-label" id="t-level">
            <Icon name="bolt" /> Level
          </h2>
          <div className="tile-value">
            {d.xp.level}
            <span className="tile-unit">{fmtInt(d.xp.total)} XP</span>
          </div>
          <ProgressBar value={d.xp.intoLevel} max={d.xp.levelSpan} label={`Progress to level ${d.xp.level + 1}`} />
          <div className="tile-meta">
            <span>
              {fmtInt(d.xp.intoLevel)} / {fmtInt(d.xp.levelSpan)} to L{d.xp.level + 1}
            </span>
            <span className="pos">+{xpToday} today</span>
          </div>
        </section>

        <section className="tile" aria-labelledby="t-review">
          <h2 className="tile-label" id="t-review">
            <Icon name="cards" /> Review queue
          </h2>
          <div className="tile-value">
            {d.reviewQueue.due}
            <span className="tile-unit">due</span>
          </div>
          <div className="tile-meta">
            {d.reviewQueue.due > 0 ? (
              <Link to="/review" className="btn btn-sm btn-primary">
                Start review <Kbd>g</Kbd>
                <Kbd>r</Kbd>
              </Link>
            ) : (
              <span className="pos">Queue clear</span>
            )}
          </div>
        </section>

        <section className="tile" aria-labelledby="t-slate">
          <h2 className="tile-label" id="t-slate">
            <Icon name="check" /> Today's slate
          </h2>
          <div className="tile-value">
            {slateDone}
            <span className="tile-unit">/ {counted.length} cleared</span>
          </div>
          <ProgressBar value={slateDone} max={counted.length} label="Slate items cleared" tone="success" />
          <div className="tile-meta">
            <span>{d.streak.todayComplete ? 'Slate complete — today counts' : 'Clear the slate (or earn 20 XP) to keep the streak'}</span>
          </div>
        </section>
      </div>

      <DueNowPanel q={comp} retests={retests} />

      <div className="dash-row">
        <Panel title="Activity" labelledBy="p-activity" className="dash-heat" aside={<span className="muted">last {d.heatmap.length} days</span>}>
          <Heatmap days={d.heatmap} today={d.today} />
        </Panel>
        <Panel title="Today's slate" labelledBy="p-slate" className="dash-slate">
          <Slate d={d} />
        </Panel>
      </div>

      <Panel title="Competencies" labelledBy="p-comp" aside={<span className="muted">rated 1–5 · never averaged · promotion = artifact + explain-back ≥80% + retest ≥2 days later</span>}>
        <CompetencyTable rows={d.competencies} today={d.today} dueRetestUnits={dueRetestUnits} />
      </Panel>

      <Panel title="Next up" labelledBy="p-next">
        <ul className="nextup">
          {d.nextUp.map((n) => (
            <li key={n.trackId}>
              {n.unit ? (
                <Link to={`/play/${n.unit.id}`} className="nextup-card">
                  <span className={`track-badge track-${n.trackId}`}>{TRACK_LABEL[n.trackId]}</span>
                  <span className="nextup-title">{n.unit.title}</span>
                  <span className="nextup-meta">{n.unit.kind}</span>
                </Link>
              ) : (
                <div className="nextup-card nextup-locked" aria-disabled="true">
                  <span className="track-badge">{TRACK_LABEL[n.trackId]}</span>
                  <span className="nextup-title">Nothing available</span>
                  <span className="nextup-meta">locked, or every unit is done</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- due now (open retests)

/** Due first (oldest opening first), then the upcoming ones by opening time. */
const byUrgency = (a: RetestListItemDto, b: RetestListItemDto) => Number(b.due) - Number(a.due) || a.dueAt - b.dueAt;

/**
 * fix/client-dash: the changed-example retests (promotion leg c). They are excluded from the
 * review queue by design, so this panel is where a due one is seen at all.
 */
function DueNowPanel({ q, retests }: { q: Loaded<CompetenciesResponse>; retests: RetestListItemDto[] }) {
  const due = retests.filter((r) => r.due).length;
  const sorted = [...retests].sort(byUrgency);
  return (
    <Panel
      title={
        <>
          Due now{due > 0 && <span className="due-count"> · {plural(due, 'retest')} open</span>}
        </>
      }
      labelledBy="p-due"
      className={`due-now${due > 0 ? ' due-now-hot' : ''}`}
      aside={<span className="muted small">retests are not in the review queue</span>}
    >
      <div data-testid="due-now">
        {q.status !== 'ready' ? (
          // an error (with Retry), or the reload that Retry started: never "No retests" while unknown
          <LoadState error={q.error} onRetry={q.reload} minHeight={64} />
        ) : sorted.length === 0 ? (
          <p className="muted small due-empty" data-testid="due-empty">
            No retests scheduled. A passing explain-back (≥80% coverage) on an artifact with a seeded changed example schedules a retest at least 2 days later; units without a seeded variation rotate alternate question sets instead — the next fresh set opens from the unit page.
          </p>
        ) : (
          <ul className="due-list">
            {sorted.map((r) => (
              <li key={r.reviewItemId} className={`due-row${r.due ? ' due-row-open' : ''}`} data-retest={r.unitId} data-due={r.due}>
                {r.due ? <Chip tone="accent">open now</Chip> : <Chip tone="info">opens {fmtShortDate(r.dueAt)}</Chip>}
                <Link to={`/play/${r.unitId}`} className="due-title">
                  {r.due ? 'Take the retest: ' : 'Retest: '}
                  {r.title}
                </Link>
                <span className="due-meta muted small">
                  {r.due ? `opened ${fmtWhen(r.dueAt)}` : `opens ${fmtWhen(r.dueAt)}`} · changed example of{' '}
                  <Link to={`/play/${r.artifactUnitId}`}>artifact unit #{r.artifactUnitId}</Link> · solo, no help
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- slate

type SlateTargets = {
  /** per drill track: the first unpassed, unrevealed, available drill (null = none found) */
  drill: Partial<Record<TrackId, number | null>>;
  /** the first track (server order) with an actionable quest in an unlocked act */
  campaign: { trackId: TrackId; unitId: number } | null;
};

const slateTrack = (s: SlateItem): TrackId | null => (s.kind === 'drill-set' && s.track && isTrackId(s.track) ? s.track : null);

/**
 * fix/client-dash: where each slate row leads. A drill set goes to the next drill on its track:
 * the dashboard's own next-up unit when that IS a drill, otherwise the first unpassed drill of
 * GET /tracks/:id/units. The campaign step goes to the track that has an actionable quest (the
 * bare /campaign route always opened JS). Resolved after first paint; links only change target.
 */
function useSlateTargets(d: DashboardData) {
  const api = useApi();
  const nextDrill = (t: TrackId) => {
    const u = d.nextUp.find((n) => n.trackId === t)?.unit;
    return u && u.kind === 'drill' ? u.id : null;
  };
  const lookup = d.slate.items
    .map(slateTrack)
    .filter((t): t is TrackId => t !== null && nextDrill(t) === null);
  const wantCampaign = d.slate.items.some((s) => s.kind === 'campaign-step');
  const key = `${lookup.join(',')}|${wantCampaign}`;
  const q = useAsync(async (): Promise<SlateTargets> => {
    const drill: SlateTargets['drill'] = {};
    await Promise.all(
      lookup.map(async (t) => {
        try {
          const units = (await api.getTrackUnits(t)).units.filter((u) => u.kind === 'drill' && u.state !== 'done' && !u.revealed);
          drill[t] = (units.find((u) => u.state === 'available') ?? null)?.id ?? null;
        } catch {
          drill[t] = null;
        }
      }),
    );
    let campaign: SlateTargets['campaign'] = null;
    if (wantCampaign) {
      const all = await Promise.allSettled(TRACK_IDS.map((t) => api.getCampaign(t)));
      for (const [i, r] of all.entries()) {
        if (r.status !== 'fulfilled' || r.value.track.locked) continue;
        const open = r.value.acts.filter((a) => a.unlocked).flatMap((a) => a.quests.filter((x) => x.state === 'available' && x.unitId !== undefined));
        const pick = open.find((x) => x.inProgress) ?? open[0];
        if (pick?.unitId !== undefined) {
          campaign = { trackId: TRACK_IDS[i]!, unitId: pick.unitId };
          break;
        }
      }
    }
    return { drill, campaign };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  return { nextDrill, targets: q.data };
}

function slateView(s: SlateItem, nextDrill: (t: TrackId) => number | null, targets: SlateTargets | undefined): { label: string; href: string; hint?: string } {
  switch (s.kind) {
    case 'drill-set': {
      const track = slateTrack(s);
      const size = s.size !== undefined ? ` (${plural(s.size, 'drill')})` : '';
      const label = `${track ? TRACK_LABEL[track] : (s.track ?? '')} drill set${size}`.trim();
      if (!track) return { label, href: '/campaign' };
      const unit = nextDrill(track) ?? targets?.drill[track] ?? null;
      return unit !== null ? { label, href: `/play/${unit}` } : { label, href: `/campaign/${track}` };
    }
    case 'campaign-step': {
      const c = targets?.campaign;
      return c ? { label: 'Campaign step', hint: TRACK_LABEL[c.trackId], href: `/campaign/${c.trackId}?unit=${c.unitId}` } : { label: 'Campaign step', href: '/campaign' };
    }
    case 'review-clear':
      return { label: 'Clear the review queue', href: '/review' };
  }
}

function Slate({ d }: { d: DashboardData }) {
  const tracks = useTracks();
  const { nextDrill, targets } = useSlateTargets(d);
  const items = d.slate.items;
  // while /tracks loads, the placeholder (all unlocked) stands in, so rows do not pop in later
  const trackRows: readonly { id: TrackId; locked: boolean }[] = tracks.data?.tracks ?? TRACK_PLACEHOLDER;
  const unlocked = (t: TrackId) => trackRows.some((r) => r.id === t && !r.locked);
  // fix/client-review 7g: the list is a client-side guess (slate_drills is server config), so a
  // missing row is stated neutrally, never as "track exhausted"
  const noDrillSlot = SLATE_DRILL_TRACKS.filter((t) => unlocked(t) && !items.some((s) => slateTrack(s) === t));
  const noCampaign = !items.some((s) => s.kind === 'campaign-step');
  const reviewOnly = items.every((s) => s.kind === 'review-clear');
  const vacuous = vacuousReviewSlot(items, d.reviewQueue.due);
  return (
    <>
      <ul className="slate">
        {items.map((s) => (
          <SlateRow key={s.slot} s={s} view={slateView(s, nextDrill, targets)} vacuous={vacuous(s)} />
        ))}
        {noDrillSlot.map((t) => (
          <li key={`gone-${t}`} className="slate-row slate-gone" data-slot={`drill:${t}`} data-missing="true">
            <span className="slate-check slate-check-gone" aria-hidden="true">
              –
            </span>
            <span className="slate-label">
              {TRACK_LABEL[t]} drills <span className="slate-why">no drill slot on today&apos;s slate</span>
            </span>
          </li>
        ))}
        {noCampaign && (
          <li className="slate-row slate-gone" data-slot="campaign" data-missing="true">
            <span className="slate-check slate-check-gone" aria-hidden="true">
              –
            </span>
            <span className="slate-label">
              Campaign step <span className="slate-why">nothing open in an unlocked act today</span>
            </span>
          </li>
        )}
      </ul>
      {reviewOnly && (
        <p className="slate-note muted small" data-testid="slate-review-only">
          Review-only day: no drill set and no campaign step can be taken. Clearing the queue counts only after at least one review today; with nothing due, earn 20 XP to keep the streak.
        </p>
      )}
    </>
  );
}

function SlateRow({ s, view, vacuous }: { s: SlateItem; view: { label: string; href: string; hint?: string }; vacuous: boolean }) {
  // a vacuous review slot (see vacuousReviewSlot) keeps its check, but says why: nothing was due
  const state = vacuous ? 'nothing due' : s.done ? 'done' : 'open';
  return (
    <li className={`slate-row${s.done ? ' slate-done' : ''}`} data-slot={s.slot} {...(vacuous ? { 'data-vacuous': 'true' } : {})}>
      <span className={`slate-check${s.done ? ' on' : ''}`} aria-hidden="true">
        {s.done && <Icon name="check" size={12} />}
      </span>
      <Link to={view.href} className="slate-label">
        {view.label}
        {view.hint && <span className="slate-why"> {view.hint}</span>}
        <span className="sr-only">{vacuous ? ' (nothing due today)' : s.done ? ' (done)' : ' (open)'}</span>
      </Link>
      <span className="slate-count" aria-hidden="true">
        {state}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------- competencies

const LEG_TONE: Record<PromotionLegState, string> = { done: 'success', pending: 'neutral', scheduled: 'info', failed: 'danger' };

function Leg({ name, state, detail, to, title }: { name: string; state: PromotionLegState; detail?: string | null; to?: string | null; title?: string }) {
  const chip = (
    <Chip tone={LEG_TONE[state]}>
      <span className="leg-name">{name}</span> {detail ?? state}
    </Chip>
  );
  return (
    <span data-leg={name.toLowerCase()} data-state={state}>
      {to ? (
        <Link to={to} className="leg-link" title={title}>
          {chip}
        </Link>
      ) : (
        chip
      )}
    </span>
  );
}

function PromotionLegs({ p, dueRetestUnits }: { p: PromotionProgress; dueRetestUnits: ReadonlySet<number> }) {
  const cov = p.explainBack.coverage !== null ? `${p.explainBack.state} ${Math.round(p.explainBack.coverage * 100)}%` : null;
  const retestOpen = p.retest.state === 'scheduled' && p.retest.unitId !== null && dueRetestUnits.has(p.retest.unitId);
  const due = retestOpen ? 'open now' : p.retest.state === 'scheduled' && p.retest.dueAt !== null ? `opens ${fmtShortDate(p.retest.dueAt)}` : null;
  return (
    <span className="legs" title={p.missing.join(' / ')}>
      <Leg name="Artifact" state={p.artifact.state} to={p.artifact.unitId !== null ? `/play/${p.artifact.unitId}` : null} title="Open the artifact unit" />
      <Leg name="Explain" state={p.explainBack.state} detail={cov} />
      <Leg
        name="Retest"
        state={p.retest.state}
        detail={due}
        to={p.retest.unitId !== null ? `/play/${p.retest.unitId}` : null}
        title={p.retest.dueAt !== null ? `Open the retest unit (opens ${fmtWhen(p.retest.dueAt)})` : 'Open the retest unit'}
      />
      {p.eligible && <Chip tone="accent">eligible</Chip>}
    </span>
  );
}

export function CompetencyTable({ rows, today, dueRetestUnits = new Set() }: { rows: CompetencyRow[]; today: string; dueRetestUnits?: ReadonlySet<number> }) {
  return (
    <div className="table-wrap">
      <table className="table comp-table">
        <thead>
          <tr>
            <th scope="col">Competency</th>
            <th scope="col">Rating</th>
            <th scope="col">Promotion</th>
            <th scope="col">Last evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-competency={r.id}>
              <th scope="row">{r.name}</th>
              <td>
                <RatingPips rating={r.rating} {...(r.promotion?.targetRating ? { target: r.promotion.targetRating } : {})} />
              </td>
              <td>{r.promotion ? <PromotionLegs p={r.promotion} dueRetestUnits={dueRetestUnits} /> : <span className="muted">—</span>}</td>
              <td className="evidence-cell">
                {r.lastEvidence ? (
                  <Link to={`/stats?competency=${r.id}#evidence-${r.lastEvidence.id}`} className="evidence-link">
                    <span className="evidence-summary">
                      {r.lastEvidence.kind} · #{r.lastEvidence.id}
                    </span>
                    <span className="evidence-meta">{fmtRelative(today, dayOfMs(r.lastEvidence.createdAt))}</span>
                  </Link>
                ) : (
                  <span className="evidence-missing">
                    <Icon name="warn" size={14} /> Evidence missing
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
