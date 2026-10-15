import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/context';
import type { CampaignActDto, CampaignQuestDto, QuestState, TrackId, TrackProgress, TrackSummary } from '../api/types';
import { Icon } from '../components/Icon';
import { Chip, LoadState, PageHeader, ProgressBar } from '../components/ui';
import { toRoman } from '../lib/format';
import { hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { useAsync } from '../lib/useAsync';
import { useTracks } from '../lib/tracks';
import { TRACK_PLACEHOLDER, isTrackId, progressLabel, progressTitle } from '../lib/view';
import { SkillTree, ViewToggle, useCampaignView } from './CampaignTree';

const STATE_LABEL: Record<QuestState, string> = {
  done: 'Done',
  available: 'Available',
  pending: 'Content pending',
  locked: 'Locked',
};
const NODE_CLASS: Record<QuestState, string> = { done: 'complete', available: 'available', pending: 'locked', locked: 'locked' };

export function CampaignPage() {
  const { trackId } = useParams();
  if (!isTrackId(trackId)) return <Navigate to="/campaign/js" replace />;
  return <CampaignView trackId={trackId} />;
}

/** Bound to GET /api/tracks/:id/campaign (W5b): acts, derived unlock state, quests in rank order. */
function CampaignView({ trackId }: { trackId: TrackId }) {
  const api = useApi();
  const tracks = useTracks();
  const campaign = useAsync(() => api.getCampaign(trackId), [api, trackId]);
  const mapRef = useRef<HTMLDivElement>(null);
  const track = campaign.data?.track ?? tracks.data?.tracks.find((t) => t.id === trackId);
  const locked = track?.locked === true;
  // W10: progress made elsewhere (player submits) changes counts and lock state; re-read the
  // shared /tracks in the background on mount (joins the app's first read on a cold load).
  const refreshTracks = tracks.refresh;
  useEffect(() => {
    refreshTracks({ join: true });
  }, [refreshTracks]);
  const [view, setView] = useCampaignView(); // B3: list or skill tree, remembered
  // W11: `?unit=<unitId>` targets one quest (e.g. from a reading unit): it is scrolled to, focused and
  // marked in either view. Only a quest the campaign payload itself lists can be targeted.
  const [params] = useSearchParams();
  const targetUnit = Number(params.get('unit'));
  const target =
    campaign.status === 'ready' && Number.isInteger(targetUnit) && targetUnit > 0
      ? campaign.data.acts.flatMap((a) => a.quests).find((q) => q.unitId === targetUnit)
      : undefined;
  const targetId = target?.id;
  useEffect(() => {
    if (targetId === undefined || view !== 'list') return;
    const el = mapRef.current?.querySelector<HTMLElement>(`[data-quest="${targetId}"] [data-step]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'center' });
  }, [targetId, view]);

  // j / k walk the quests (including locked ones, which are focusable but not actionable).
  useKeydown((e) => {
    if (hasModifier(e) || isEditableTarget(e.target)) return;
    if (e.key === 'v') {
      e.preventDefault();
      setView(view === 'tree' ? 'list' : 'tree');
      return;
    }
    if (e.key !== 'j' && e.key !== 'k') return;
    const nodes = Array.from(mapRef.current?.querySelectorAll<HTMLElement>('[data-step]') ?? []);
    if (nodes.length === 0) return;
    e.preventDefault();
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (at === -1) {
      const current = nodes.findIndex((n) => n.dataset.state === 'available');
      next = current === -1 ? 0 : current;
    } else {
      next = Math.max(0, Math.min(nodes.length - 1, at + (e.key === 'j' ? 1 : -1)));
    }
    nodes[next]?.focus();
  });

  return (
    <>
      <PageHeader eyebrow="Campaign" title={track ? track.name : ' '} actions={<ViewToggle view={view} onChange={setView} />} />
      <TrackTabs tracks={tracks.data?.tracks ?? []} current={trackId} />
      <TrackProgressLine progress={tracks.data?.tracks.find((t) => t.id === trackId)?.progress} locked={locked} />
      <div className={`campaign${locked ? ' campaign-locked' : ''}`} ref={mapRef}>
        {locked && track && (
          <div className="locked-banner" role="note">
            <Icon name="lock" /> <strong>{track.name} is locked.</strong> No content is available on this track yet.
          </div>
        )}
        {campaign.status === 'ready' ? (
          campaign.data.acts.length === 0 ? (
            <div className="act-empty" data-testid="campaign-empty">
              <p>No campaign acts are seeded for this track yet.</p>
              <p className="muted small">Practice units on this track are still playable from the dashboard's next-up list.</p>
            </div>
          ) : view === 'tree' ? (
            <div role="tabpanel" aria-label="Campaign skill tree">
              <SkillTree key={trackId} acts={campaign.data.acts} trackLocked={locked} level={campaign.data.level} targetQuestId={targetId} />
            </div>
          ) : (
            <ol className="acts" role="tabpanel" aria-label="Campaign acts">
              {[...campaign.data.acts]
                .sort((a, b) => a.ordinal - b.ordinal)
                .map((act) => (
                  <ActCard key={act.id} act={act} level={campaign.data.level} targetQuestId={targetId} />
                ))}
            </ol>
          )
        ) : (
          <LoadState error={campaign.error} onRetry={campaign.reload} minHeight={480} />
        )}
      </div>
    </>
  );
}

/**
 * Campaign 2 B2 (ui-audit #26): the track's headline percentage, the SAME server number the sidebar
 * shows (TrackProgress), with its definition. Reserved height: no layout shift while /tracks loads.
 */
function TrackProgressLine({ progress, locked }: { progress: TrackProgress | undefined; locked: boolean }) {
  return (
    // one short line (no wrap at 400px, so no shift when /tracks lands); the full definition is the tooltip
    <p className="track-progress-line small" data-testid="track-progress">
      {progress && !locked && progress.basis !== 'none' ? (
        <>
          <span className="muted">Track progress </span>
          <strong className="num" title={progressTitle(progress)}>
            {progressLabel(progress)}
          </strong>
          <span className="muted">
            {progress.basis === 'campaign-core'
              ? ` · ${progress.coreDone}/${progress.coreTotal} core quests, all acts`
              : ` · ${progress.practiceDone}/${progress.practiceTotal} practice units`}
          </span>
        </>
      ) : (
        ' '
      )}
    </p>
  );
}

function TrackTabs({ tracks, current }: { tracks: TrackSummary[]; current: TrackId }) {
  const navigate = useNavigate();
  const list: readonly Pick<TrackSummary, 'id' | 'name' | 'locked'>[] = tracks.length ? tracks : TRACK_PLACEHOLDER;
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = list.findIndex((t) => t.id === current);
    const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    if (!next) return;
    navigate(`/campaign/${next.id}`);
    requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
  };
  return (
    <div className="tabs" role="tablist" aria-label="Tracks" onKeyDown={onKey}>
      {list.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={t.id === current}
          tabIndex={t.id === current ? 0 : -1}
          className={`tab${t.locked ? ' tab-locked' : ''}`}
          onClick={() => navigate(`/campaign/${t.id}`)}
        >
          {t.locked && <Icon name="lock" size={14} />}
          {t.name}
        </button>
      ))}
    </div>
  );
}

function unlockText(act: CampaignActDto, level: number): string {
  const r = act.unlockRule;
  if (r.staticLock) return 'Locked: content arrives after V1.';
  const parts: string[] = [];
  if (r.previousCorePct > 0) parts.push(`${r.previousCorePct}% of the previous act's core quests`);
  // W11: a level the learner already has is shown as met, not as an open requirement
  if (r.level > 1) parts.push(level >= r.level ? `level ${r.level} (reached)` : `level ${r.level} (you are level ${level})`);
  return `Unlocks at ${parts.length ? parts.join(' and ') : 'start'}.`;
}

function ActCard({ act, level, targetQuestId }: { act: CampaignActDto; level: number; targetQuestId?: number }) {
  const { coreDone, coreTotal } = act.progress;
  const state = !act.unlocked ? 'locked' : coreTotal > 0 && coreDone >= coreTotal ? 'complete' : 'in-progress';
  return (
    <li className={`act act-${state}`} data-act={act.ordinal} data-unlocked={act.unlocked}>
      <header className="act-head">
        <span className="act-num" aria-hidden="true">
          {toRoman(act.ordinal)}
        </span>
        <div className="act-text">
          <h2 className="act-title">
            Act {act.ordinal}: {act.title}
          </h2>
          {act.theme && <p className="act-summary">{act.theme}</p>}
        </div>
        <div className="act-side">
          {act.unlocked ? <Chip tone="success">unlocked</Chip> : <Chip>locked</Chip>}
          <span className="muted">
            core {coreDone}/{coreTotal}
          </span>
          {coreTotal > 0 && <ProgressBar value={coreDone} max={coreTotal} label={`Act ${act.ordinal} core progress`} tone="success" />}
        </div>
      </header>
      {!act.unlocked && (
        <p className="act-gate">
          <Icon name="lock" size={12} /> {unlockText(act, level)}
        </p>
      )}
      {act.quests.length === 0 ? (
        <p className="act-gate">No quests seeded in this act yet.</p>
      ) : (
        <ol className="path">
          {act.quests.map((q) => (
            <QuestNode key={q.id} quest={q} actUnlocked={act.unlocked} target={q.id === targetQuestId} />
          ))}
        </ol>
      )}
    </li>
  );
}

function QuestNode({ quest, actUnlocked, target = false }: { quest: CampaignQuestDto; actUnlocked: boolean; target?: boolean }) {
  const actionable = actUnlocked && quest.state !== 'locked' && quest.unitId !== undefined;
  const cls = NODE_CLASS[quest.state];
  const body = (
    <>
      <span className={`node node-${cls}`} aria-hidden="true">
        {quest.state === 'done' && <Icon name="check" size={12} />}
        {quest.state === 'locked' && <Icon name="lock" size={11} />}
      </span>
      <span className="step-main">
        <span className="step-title">{quest.title}</span>
        {/* W11: the meta line wraps at phone width, so the full repo name is always visible text */}
        <span className="step-meta">
          {quest.kind} · {quest.repo}
          {quest.twinRepo && <> · twin of {quest.twinRepo}</>}
        </span>
      </span>
      <span className="chips">
        {quest.core ? <Chip tone="accent">core</Chip> : <Chip>optional</Chip>}
        {quest.state === 'done' && <Chip tone="success">done</Chip>}
        {quest.contentPending && <Chip tone="warning">content pending</Chip>}
      </span>
      <span className="sr-only">, {STATE_LABEL[quest.state]}</span>
    </>
  );
  return (
    <li className={`step step-${cls}${target ? ' step-target' : ''}`} data-quest={quest.id} aria-current={target ? 'location' : undefined}>
      {actionable ? (
        <Link to={`/play/${quest.unitId}`} className="step-box" data-step data-state={quest.state}>
          {body}
        </Link>
      ) : (
        <div className="step-box" data-step data-state={quest.state} tabIndex={-1} aria-disabled="true">
          {body}
        </div>
      )}
    </li>
  );
}
