import { useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type {
  CompetenciesResponse,
  CompetencyRow,
  Dashboard as DashboardData,
  FundamentalsResponse,
  PromotionLegState,
  PromotionProgress,
  SlateItem,
  SlateSettingsResponse,
  TrackId,
} from '../api/types';
import { DueNowPanel } from '../components/DueNow';
import { Heatmap } from '../components/Heatmap';
import { Icon } from '../components/Icon';
import { SlateFocus } from '../components/SlateFocus';
import { Chip, Kbd, LoadState, PageHeader, Panel, ProgressBar, RatingPips } from '../components/ui';
import { WeakSpotsTeaser } from '../components/WeakSpots';
import { TOPIC_MINUTES, drillMinutes, fmtMinutes, reviewEstimate } from '../lib/estimates';
import { fmtInt, fmtRelative, fmtShortDate, fmtWhen, plural } from '../lib/format';
import { drillOpen, fundProgress, fundProgressText, type FundProgress } from '../lib/fundamentals';
import { useTracks } from '../lib/tracks';
import { useAsync, type AsyncState } from '../lib/useAsync';
import { FREEZE_TOKENS_MAX, SLATE_DRILL_TRACKS, TRACK_LABEL, TRACK_PLACEHOLDER, dayOfMs, isTrackId } from '../lib/view';

type Loaded<T> = AsyncState<T> & { reload: () => void };

/** The partial-day rule (server engines/streak.ts): this much XP in a day keeps the streak. */
const STREAK_XP = 20;
/** wave B (ruling 6): with no review due, this much XP today (or a complete slate) is a full day. */
export const DONE_XP = 50;

/** No xpToday on the wire (W-7): today's heatmap row is the server's own number for it. */
export const xpTodayOf = (d: DashboardData): number => d.heatmap.find((h) => h.day === d.today)?.xp ?? 0;

/**
 * wave B (ruling 6): "Done for today" — nothing due for review AND (today's slate is complete OR at
 * least 50 XP today). The hero then says so and keeps the next step as a secondary button.
 */
export function doneForToday(d: DashboardData): boolean {
  if (d.reviewQueue.due > 0) return false;
  const counted = d.slate.items.filter((s) => !vacuousReviewSlot(d.slate.items, d.reviewQueue.due)(s));
  const slateComplete = d.streak.todayComplete || (counted.length > 0 && counted.every((s) => s.done));
  return slateComplete || xpTodayOf(d) >= DONE_XP;
}

export function DashboardPage() {
  const api = useApi();
  const q = useAsync(() => api.getDashboard(), [api]);
  // The competency table marks units with a due retest from GET /competencies (the review queue
  // excludes retests by design). The first paint waits for it to SETTLE so the table never shifts.
  // ab S3: the "Due now" panel reads its own GET /due (and Weak spots GET /stats/weak), each with
  // its own Retry, so the rest of the page is not torn down when one of them reloads.
  const comp = useAsync(() => api.getCompetencies(), [api]);
  // ab S4: the slate links come with GET /dashboard (targetUnitId). A mount reads /dashboard,
  // /competencies, the shell's shared /tracks, /due, /stats/weak, /settings/slate (read once here,
  // shared by the hero and the focus card) and, f52 U6, ONE /tracks/:id/fundamentals for the hero.
  const slate = useAsync(() => api.getSlateSettings(), [api]);
  const fund = useFundamentalsStep(slate);
  const [painted, setPainted] = useState(false);
  const showBody = q.status === 'ready' && (painted || comp.status !== 'loading');
  if (showBody && !painted) setPainted(true);
  return (
    // f52 U20: one centred content column, the same width as the Campaign page
    <div className="page-col">
      <PageHeader
        eyebrow={q.data ? new Date(`${q.data.today}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ' '}
        title="Dashboard"
      />
      {showBody ? <DashboardBody d={q.data} comp={comp} slate={slate} fund={fund} /> : <LoadState error={q.error} onRetry={q.reload} minHeight={720} />}
    </div>
  );
}

// ---------------------------------------------------------------- hero (f52 U6 + U7)

/** The Fundamentals ladders, in the order the hero tries them (council ruling 5). */
const FUND_TRACKS: readonly TrackId[] = ['js', 'csharp', 'java'];

/**
 * The first language track on today's slate (slate settings), the only ladder the dashboard reads.
 * A failed settings read counts as every track on (JS first); no language track on is no ladder.
 */
export function firstFundTrack(s: SlateSettingsResponse | undefined): TrackId | null {
  if (!s) return FUND_TRACKS[0]!;
  const on = new Set<string>(s.todayTracks.filter((t) => t.enabled).map((t) => t.trackId));
  return FUND_TRACKS.find((t) => on.has(t)) ?? null;
}

/** Where the learner is on one Fundamentals ladder (dashboard-local). */
export interface FundStep {
  trackId: TrackId;
  unitId: number;
  kind: 'topic' | 'drill';
  /** the topic's title, or the drill's */
  title: string;
  /** 1-based topic position and the ladder length */
  order: number;
  total: number;
  /** the first topic, nothing passed yet */
  fresh: boolean;
  /** a drill's position among its topic's drills */
  drill?: { at: number; of: number };
  /** wave B (ruling 3): topics complete (gate + one own drill) and gates passed on this ladder */
  progress: FundProgress;
  /** wave B (ruling 6): the static estimate of this step (topic about 10 min; drill 5 / 10 / 15 by difficulty) */
  minutes: number;
}

/**
 * The ladder's next step: the first topic whose quiz gate is not passed (its lesson + gate) or, when
 * that topic's gate is passed, its first OPEN drill (lib/fundamentals drillOpen, the rule shared with
 * lib/nextstep.ts: a done, locked or revealed drill is never a next step). A finished ladder, or a
 * topic that is still locked, is no step (null).
 */
export function fundamentalsStep(r: FundamentalsResponse): FundStep | null {
  const topics = r.topics;
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i]!;
    const base = { trackId: r.trackId, order: i + 1, total: topics.length, progress: fundProgress(topics) };
    if (t.unit.state !== 'done') {
      if (t.unit.state === 'locked') return null;
      return { ...base, unitId: t.unit.id, kind: 'topic', title: t.title, fresh: i === 0, minutes: TOPIC_MINUTES };
    }
    const at = t.drills.findIndex(drillOpen);
    if (at !== -1) {
      const d = t.drills[at]!;
      return { ...base, unitId: d.id, kind: 'drill', title: d.title, fresh: false, drill: { at: at + 1, of: t.drills.length }, minutes: drillMinutes(d.difficulty) };
    }
  }
  return null;
}

type FundState = { settled: false } | { settled: true; step: FundStep | null };

/**
 * One GET /tracks/:id/fundamentals, for the first language track on the slate, once the settings
 * read has settled. A failed ladder read is no step (the hero moves on); it never blocks the page.
 */
function useFundamentalsStep(slate: AsyncState<SlateSettingsResponse>): FundState {
  const api = useApi();
  // fixed by the first settled settings read, so a settings Retry never refetches the ladder
  const track = useRef<TrackId | null | undefined>(undefined);
  if (track.current === undefined && slate.status !== 'loading') track.current = firstFundTrack(slate.data);
  const t = track.current;
  const q = useAsync<FundStep | null>(
    () =>
      t === undefined
        ? new Promise<never>(() => {})
        : t === null
          ? Promise.resolve(null)
          : api.getFundamentals(t).then(fundamentalsStep, () => null),
    [api, t],
  );
  return q.status === 'ready' ? { settled: true, step: q.data } : { settled: false };
}

export type HeroKind = 'review' | 'fundamentals' | 'slate' | 'next' | 'none';
export interface HeroPick {
  kind: HeroKind;
  label: string;
  href: string;
  context: string;
}

/**
 * Council ruling 5: reviews due -> the Fundamentals next step -> the first undone slate item ->
 * the first Next-up unit. Never an explain-back.
 */
export function pickHero(d: DashboardData, fund: FundStep | null): HeroPick {
  const due = d.reviewQueue.due;
  // wave B (ruling 6): static estimates give the session a shape (a review card is about 10 s)
  if (due > 0) {
    return { kind: 'review', label: `Review ${plural(due, 'card')}`, href: '/review', context: `Reviews first: these cards are due today · ${reviewEstimate(due)}` };
  }
  if (fund) {
    const where = `Fundamentals · ${TRACK_LABEL[fund.trackId]} · Topic ${fund.order} of ${fund.total}`;
    // wave B (ruling 3): "3 complete · 5 gates passed" once anything is passed
    const progress = fund.progress.gates > 0 ? ` · ${fundProgressText(fund.progress)}` : '';
    if (fund.kind === 'drill' && fund.drill) {
      return {
        kind: 'fundamentals',
        label: `Practise: ${fund.title}`,
        href: `/play/${fund.unitId}`,
        context: `${where} · drill ${fund.drill.at} of ${fund.drill.of} · ${fmtMinutes(fund.minutes)}${progress}`,
      };
    }
    return {
      kind: 'fundamentals',
      label: `${fund.fresh ? 'Start' : 'Continue'} Fundamentals: ${fund.title}`,
      href: `/play/${fund.unitId}`,
      context: `${where} · ${fmtMinutes(fund.minutes)}${progress}`,
    };
  }
  // a slate row does not say its unit's kind; a target that Next up lists as an explain-back is skipped
  const explainBacks = new Set(d.nextUp.flatMap((n) => (n.unit?.kind === 'explain-back' ? [n.unit.id] : [])));
  const items = d.slate.items;
  const vacuous = vacuousReviewSlot(items, due);
  const counted = items.filter((s) => !vacuous(s));
  const open = items.find((s) => !s.done && s.kind !== 'review-clear' && !(s.targetUnitId != null && explainBacks.has(s.targetUnitId)));
  if (open) {
    const v = slateView(open);
    return { kind: 'slate', label: `Start: ${v.label}`, href: v.href, context: `Today's slate · ${counted.filter((s) => s.done).length} of ${counted.length} done` };
  }
  const next = d.nextUp.find((n) => n.unit && n.unit.kind !== 'explain-back');
  if (next?.unit) return { kind: 'next', label: next.unit.title, href: `/play/${next.unit.id}`, context: `Next up · ${TRACK_LABEL[next.trackId]} · ${next.unit.kind}` };
  return { kind: 'none', label: 'Open the campaign', href: '/campaign', context: 'Nothing is queued right now' };
}

function Hero({ d, fund }: { d: DashboardData; fund: FundState }) {
  // reviews win outright; otherwise wait for the ladder so the button never changes under the cursor
  const ready = d.reviewQueue.due > 0 || fund.settled;
  const pick = ready ? pickHero(d, fund.settled ? fund.step : null) : null;
  // wave B (ruling 6): a full day says so; what would be next stays one (secondary) click away
  const done = doneForToday(d);
  return (
    <section
      className={`panel dash-hero${done ? ' dash-hero-done' : ''}`}
      aria-labelledby="p-hero"
      data-testid="dash-hero"
      data-kind={pick?.kind ?? 'loading'}
      data-done={done ? 'true' : 'false'}
    >
      <h2 className="panel-title" id="p-hero">
        {done ? 'Today' : 'Next step'}
      </h2>
      {done && (
        <p className="dash-hero-donetext pos" data-testid="hero-done">
          Done for today ✓ · streak safe
        </p>
      )}
      {pick ? (
        <>
          <Link to={pick.href} className={`btn ${done ? 'dash-hero-more' : 'btn-primary'} dash-hero-go`} data-testid="hero-go">
            <Icon name="play" /> <span className="dash-hero-label">{pick.label}</span>
          </Link>
          <p className="dash-hero-context muted" data-testid="hero-context">
            {pick.context}
          </p>
        </>
      ) : (
        <div className="dash-hero-wait" aria-busy="true">
          <span className="sr-only">Finding your next step…</span>
        </div>
      )}
    </section>
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

function DashboardBody({
  d,
  comp,
  slate,
  fund,
}: {
  d: DashboardData;
  comp: Loaded<CompetenciesResponse>;
  slate: Loaded<SlateSettingsResponse>;
  fund: FundState;
}) {
  const items = d.slate.items;
  const vacuous = vacuousReviewSlot(items, d.reviewQueue.due);
  const counted = items.filter((s) => !vacuous(s));
  const slateDone = counted.filter((s) => s.done).length;
  const xpToday = xpTodayOf(d);
  const tokens = Math.min(d.streak.tokens, FREEZE_TOKENS_MAX);
  const streakSafe = xpToday >= STREAK_XP || d.streak.todayComplete;
  const retests = comp.data?.retests ?? [];
  const dueRetestUnits = new Set(retests.filter((r) => r.due).map((r) => r.unitId));
  return (
    <div className="dash">
      {/* f52 U7: the one next step, with today's slate beside it (both above the fold at 1440x900) */}
      <div className="dash-top">
        <Hero d={d} fund={fund} />
        <Panel title="Today's slate" labelledBy="p-slate" className="dash-slate">
          <Slate d={d} />
        </Panel>
      </div>

      <div className="tiles">
        <section className="tile" aria-labelledby="t-streak">
          <h2 className="tile-label" id="t-streak">
            <Icon name="flame" /> Streak
          </h2>
          <div className="tile-value">
            {d.streak.current}
            <span className="tile-unit">days</span>
          </div>
          {/* f52 U16 (display only): 20 XP today, or a complete slate, already keeps the streak */}
          {streakSafe ? (
            <p className="tile-safe pos" data-testid="streak-safe" title="20 XP today or a cleared slate keeps the streak">
              Streak safe for today ✓
            </p>
          ) : (
            // wave B (ruling 6): until then, how far today's XP is from keeping it
            <p className="tile-safe muted" data-testid="streak-progress" title="20 XP today or a cleared slate keeps the streak">
              {xpToday} / {STREAK_XP} XP today
            </p>
          )}
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

      <Panel title="Next up" labelledBy="p-next">
        {/* f52 U19: rows of equal cards (all in one row when wide, then halves), never one card alone */}
        <ul className="nextup" style={{ '--nextup-n': d.nextUp.length, '--nextup-half': Math.ceil(d.nextUp.length / 2) } as CSSProperties}>
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

      <CompetencyPanel rows={d.competencies} today={d.today} dueRetestUnits={dueRetestUnits} />

      <Panel title="Activity" labelledBy="p-activity" className="dash-heat" aside={<span className="muted">last {d.heatmap.length} days</span>}>
        <Heatmap days={d.heatmap} today={d.today} />
      </Panel>

      {/* ab S1: "Choose your focus" until a slate choice is saved, then a summary + Change link
          (f52: below the page's work; it reads the settings the hero already fetched) */}
      <SlateFocus q={slate} />

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
  // an empty slate (every chosen track exhausted, no campaign step, no review card yet) is not a
  // review-only day: the server never counts it as a slate-day, so only the 20 XP partial rule applies
  const emptySlate = items.length === 0;
  const reviewOnly = !emptySlate && items.every((s) => s.kind === 'review-clear');
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
      {emptySlate && (
        <p className="slate-note muted small" data-testid="slate-empty" title="No drill set, campaign step or review could be scheduled today.">
          Nothing on today&apos;s slate. Earn 20 XP to keep the streak.
        </p>
      )}
      {reviewOnly && (
        <p
          className="slate-note muted small"
          data-testid="slate-review-only"
          title="No drill set and no campaign step can be taken today. Clearing the queue counts only after at least one review today; with nothing due, earn 20 XP to keep the streak."
        >
          Review-only day: do at least one review, or earn 20 XP, to keep the streak.
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

/** f52 U18: the promotion rule, in full, for the panel's tooltip. */
export const COMP_RULE = 'Rated 1–5 and never averaged. A promotion needs an artifact, an explain-back with at least 80% coverage, and a retest at least 2 days later.';

/** Nothing to show yet: every competency at rating 1 (or unrated) with no evidence at all. */
export const competenciesUntouched = (rows: readonly CompetencyRow[]): boolean => rows.every((r) => (r.rating ?? 1) <= 1 && !r.lastEvidence);

/**
 * f52 U8: on day one the table is eight empty rows, so the panel collapses to a one-line summary
 * with a Show toggle until any competency has evidence (or a rating above 1).
 */
function CompetencyPanel({ rows, today, dueRetestUnits }: { rows: CompetencyRow[]; today: string; dueRetestUnits: ReadonlySet<number> }) {
  const untouched = competenciesUntouched(rows);
  const [shown, setShown] = useState(false);
  const open = !untouched || shown;
  return (
    <Panel
      title="Competencies"
      labelledBy="p-comp"
      className={open ? undefined : 'comp-quiet'}
      aside={
        <span className="muted" title={COMP_RULE} data-testid="comp-rule">
          rated 1–5
        </span>
      }
    >
      {untouched && (
        <p className="comp-summary small" data-testid="comp-summary">
          <span className="muted">{plural(rows.length, 'competency', 'competencies')} · not started yet. Passing units earns the first evidence.</span>{' '}
          <button type="button" className="link-btn" aria-expanded={open} aria-controls="comp-table" onClick={() => setShown((s) => !s)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </p>
      )}
      <div id="comp-table" hidden={!open}>
        {open && <CompetencyTable rows={rows} today={today} dueRetestUnits={dueRetestUnits} />}
      </div>
    </Panel>
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
                  // f52 U8: no evidence yet is a starting point, not a warning
                  <span className="evidence-none muted">Not started</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
