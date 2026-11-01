import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type {
  CompetenciesResponse,
  CompetencyRow,
  Dashboard as DashboardData,
  PromotionLegState,
  PromotionProgress,
  SlateItem,
  TrackId,
} from '../api/types';
import { DueNowPanel } from '../components/DueNow';
import { Heatmap } from '../components/Heatmap';
import { Icon } from '../components/Icon';
import { SlateFocus } from '../components/SlateFocus';
import { Chip, Kbd, LoadState, PageHeader, Panel, ProgressBar, RatingPips } from '../components/ui';
import { WeakSpotsTeaser } from '../components/WeakSpots';
import { fmtInt, fmtRelative, fmtShortDate, fmtWhen, plural } from '../lib/format';
import { useTracks } from '../lib/tracks';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { FREEZE_TOKENS_MAX, SLATE_DRILL_TRACKS, TRACK_LABEL, TRACK_PLACEHOLDER, dayOfMs, isTrackId } from '../lib/view';

type Loaded<T> = AsyncState<T> & { reload: () => void };

export function DashboardPage() {
  const api = useApi();
  const q = useAsync(() => api.getDashboard(), [api]);
  // fix/client-dash: the open retests live on GET /competencies only (the review queue excludes
  // them by design). Requested alongside the dashboard and laid out once it SETTLES, so the
  // "Due now" panel never pushes the page down after first paint.
  const comp = useAsync(() => api.getCompetencies(), [api]);
  // fix/client-review 4: only the FIRST paint waits for /competencies. Once the body is up it stays
  // mounted while the Due-now panel reloads (its own Retry), so the rest of the page is not torn
  // down and refetched. ab S4: the slate links come with GET /dashboard (targetUnitId), so a mount
  // is this page's two reads plus the shell's shared /tracks.
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

      <DueNowPanel />

      {/* ab S1: "Choose your focus" until a slate choice is saved, then a summary + Change link */}
      <SlateFocus />

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
              {/* a sibling of the card (never a nested anchor): the track's whole unit list, so a
                  null-unit card has an action too; #units opens and focuses the Practice-units browser) */}
              <Link to={`/campaign/${n.trackId}#units`} className="nextup-browse small">
                Browse all<span className="sr-only"> {TRACK_LABEL[n.trackId]} units</span> <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ab wave S3: last on the page, so its late arrival never pushes anything down; absent without data */}
      <WeakSpotsTeaser />
    </div>
  );
}

// ---------------------------------------------------------------- slate

const slateTrack = (s: SlateItem): TrackId | null => (s.kind === 'drill-set' && s.track && isTrackId(s.track) ? s.track : null);

/**
 * Where each slate row leads. ab S4: the server computes the target in GET /dashboard
 * (`targetUnitId`: a drill set's first passable, unrevealed drill; the campaign step's quest unit),
 * so the dashboard no longer fans out to /tracks/:id/units and five /tracks/:id/campaign reads. A
 * missing target (null, or an older server without the field) falls back to the track / campaign page.
 */
function slateView(s: SlateItem): { label: string; href: string; hint?: string } {
  const target = s.targetUnitId ?? null;
  switch (s.kind) {
    case 'drill-set': {
      const track = slateTrack(s);
      const size = s.size !== undefined ? ` (${plural(s.size, 'drill')})` : '';
      const label = `${track ? TRACK_LABEL[track] : (s.track ?? '')} drill set${size}`.trim();
      if (target !== null) return { label, href: `/play/${target}` };
      return { label, href: track ? `/campaign/${track}` : '/campaign' };
    }
    case 'campaign-step':
      return target !== null ? { label: 'Campaign step', href: `/play/${target}` } : { label: 'Campaign step', href: '/campaign' };
    case 'review-clear':
      return { label: 'Clear the review queue', href: '/review' };
  }
}

function Slate({ d }: { d: DashboardData }) {
  const tracks = useTracks();
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
          <SlateRow key={s.slot} s={s} view={slateView(s)} vacuous={vacuous(s)} />
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
      <MixedDrills tracks={mixedTracks(items, SLATE_DRILL_TRACKS.filter(unlocked))} />
    </>
  );
}

/**
 * ab S4 ring fix (S3 review SHOULD-1): the tracks Mixed drills rotate over are today's slate drill-set
 * tracks (the learner's chosen focus), unlocked ones only, in slate order; with fewer than 2 of them it
 * falls back to every unlocked drill track, so the button still mixes something.
 */
export function mixedTracks(items: readonly SlateItem[], unlockedDrillTracks: readonly TrackId[]): TrackId[] {
  const slate = [...new Set(items.flatMap((s) => {
    const t = slateTrack(s);
    return t !== null && unlockedDrillTracks.includes(t) ? [t] : [];
  }))];
  return slate.length >= 2 ? slate : [...unlockedDrillTracks];
}

/**
 * ab S4: interleaved practice. GET /drills/next?mode=mixed is asked only on click (never on mount),
 * then the learner lands on that drill. The server rotates over the tracks deterministically (day +
 * drills passed), so the next press after a pass moves to another track.
 */
function MixedDrills({ tracks }: { tracks: readonly TrackId[] }) {
  const api = useApi();
  const navigate = useNavigate();
  const [state, setState] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  if (tracks.length < 2) return null;
  const start = () => {
    setState({ busy: true, note: null });
    api.getNextDrill(tracks).then(
      (r) => {
        if (r.unit) navigate(`/play/${r.unit.id}`);
        else setState({ busy: false, note: 'No drill is open on these tracks right now.' });
      },
      (e: unknown) => setState({ busy: false, note: errorText(e) }),
    );
  };
  return (
    <div className="slate-mixed" data-testid="mixed-drills">
      <button type="button" className="btn btn-sm" onClick={start} disabled={state.busy} aria-describedby="mixed-why">
        <Icon name="bolt" /> Mixed drills
      </button>
      <span id="mixed-why" className="muted small">
        one drill at a time, rotating {tracks.map((t) => TRACK_LABEL[t]).join(' · ')}
      </span>
      {state.note && (
        <p className="small" role="status" data-testid="mixed-note">
          {state.note}
        </p>
      )}
    </div>
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
