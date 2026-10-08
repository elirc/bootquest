import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api/context';
import type { Campaign, CampaignAct, CampaignStep, NodeState, Track, TrackId } from '../api/types';
import { toRoman } from '../lib/format';
import { Icon } from '../components/Icon';
import { Chip, LoadState, PageHeader } from '../components/ui';
import { hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { useAsync } from '../lib/useAsync';

const TRACK_IDS: TrackId[] = ['js', 'csharp', 'agentic', 'java'];
const isTrackId = (v: string | undefined): v is TrackId => TRACK_IDS.includes(v as TrackId);

const STATE_LABEL: Record<NodeState, string> = {
  complete: 'Complete',
  'in-progress': 'In progress',
  available: 'Available',
  locked: 'Locked',
};

export function CampaignPage() {
  const { trackId } = useParams();
  if (!isTrackId(trackId)) return <Navigate to="/campaign/js" replace />;
  return <CampaignView trackId={trackId} />;
}

function CampaignView({ trackId }: { trackId: TrackId }) {
  const api = useApi();
  const tracks = useAsync(() => api.getTracks(), [api]);
  const campaign = useAsync(() => api.getCampaign(trackId), [api, trackId]);
  const mapRef = useRef<HTMLDivElement>(null);
  const track = tracks.data?.find((t) => t.id === trackId);
  const locked = track?.status === 'locked';

  // j / k walk the path (including locked nodes, which are focusable but not actionable).
  useKeydown((e) => {
    if (hasModifier(e) || isEditableTarget(e.target)) return;
    if (e.key !== 'j' && e.key !== 'k') return;
    const nodes = Array.from(mapRef.current?.querySelectorAll<HTMLElement>('[data-step]') ?? []);
    if (nodes.length === 0) return;
    e.preventDefault();
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (at === -1) {
      const current = nodes.findIndex((n) => n.dataset.state === 'in-progress' || n.dataset.state === 'available');
      next = current === -1 ? 0 : current;
    } else {
      next = Math.max(0, Math.min(nodes.length - 1, at + (e.key === 'j' ? 1 : -1)));
    }
    nodes[next]?.focus();
  });

  return (
    <>
      <PageHeader eyebrow="Campaign" title={track ? track.name : ' '} />
      <TrackTabs tracks={tracks.data ?? []} current={trackId} />
      <div className={`campaign${locked ? ' campaign-locked' : ''}`} ref={mapRef}>
        {locked && track && (
          <div className="locked-banner" role="note">
            <Icon name="lock" /> <strong>{track.name} is locked.</strong> {track.lockedReason}
          </div>
        )}
        {campaign.status === 'ready' ? (
          <CampaignPath campaign={campaign.data} />
        ) : (
          <LoadState error={campaign.error} onRetry={campaign.reload} minHeight={480} />
        )}
      </div>
    </>
  );
}

function TrackTabs({ tracks, current }: { tracks: Track[]; current: TrackId }) {
  const navigate = useNavigate();
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tracks.findIndex((t) => t.id === current);
    const next = tracks[(i + (e.key === 'ArrowRight' ? 1 : tracks.length - 1)) % tracks.length];
    if (!next) return;
    navigate(`/campaign/${next.id}`);
    requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
  };
  return (
    <div className="tabs" role="tablist" aria-label="Tracks" onKeyDown={onKey}>
      {(tracks.length ? tracks : TRACK_IDS.map((id) => ({ id, short: id, name: id, status: 'active' }) as Track)).map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={t.id === current}
          tabIndex={t.id === current ? 0 : -1}
          className={`tab${t.status === 'locked' ? ' tab-locked' : ''}`}
          onClick={() => navigate(`/campaign/${t.id}`)}
        >
          {t.status === 'locked' && <Icon name="lock" size={14} />}
          {t.name}
        </button>
      ))}
    </div>
  );
}

function CampaignPath({ campaign }: { campaign: Campaign }) {
  return (
    <ol className="acts" role="tabpanel" aria-label="Campaign acts">
      {campaign.acts.map((act) => (
        <ActBlock key={act.id} act={act} />
      ))}
    </ol>
  );
}

function ActBlock({ act }: { act: CampaignAct }) {
  const done = act.steps.filter((s) => s.state === 'complete').length;
  return (
    <li className={`act act-${act.state}`} data-act={act.id}>
      <header className="act-head">
        <span className="act-num" aria-hidden="true">
          {toRoman(act.ordinal)}
        </span>
        <div className="act-text">
          <h2 className="act-title">
            Act {toRoman(act.ordinal)} · {act.title}
          </h2>
          <p className="act-summary">{act.summary}</p>
        </div>
        <div className="act-side">
          <Chip tone={act.state === 'complete' ? 'success' : act.state === 'locked' ? 'neutral' : 'accent'}>
            {act.state === 'locked' && <Icon name="lock" size={12} />} {STATE_LABEL[act.state]}
          </Chip>
          {act.steps.length > 0 && (
            <span className="muted">
              {done}/{act.steps.length} steps
            </span>
          )}
        </div>
      </header>
      {act.unlockHint && act.state === 'locked' && <p className="act-gate">Unlocks when: {act.unlockHint}</p>}
      {act.steps.length > 0 && (
        <ol className="path">
          {act.steps.map((s) => (
            <StepNode key={s.id} step={s} />
          ))}
        </ol>
      )}
    </li>
  );
}

function StepNode({ step }: { step: CampaignStep }) {
  const actionable = step.state !== 'locked' && step.unitId !== null;
  const body = (
    <>
      <span className={`node node-${step.state}`} aria-hidden="true">
        {step.state === 'complete' && <Icon name="check" size={12} />}
        {step.state === 'locked' && <Icon name="lock" size={11} />}
        {step.state === 'in-progress' && <Icon name="play" size={10} />}
      </span>
      <span className="step-main">
        <span className="step-title">{step.title}</span>
        <span className="step-meta">
          {step.kind}
          {step.repo && <> · {step.repo}</>}
        </span>
      </span>
      <span className="step-xp">{step.xp} XP</span>
      <span className="sr-only">, {STATE_LABEL[step.state]}</span>
    </>
  );
  return (
    <li className={`step step-${step.state}`}>
      {actionable ? (
        <Link to={`/play/${step.unitId}`} className="step-box" data-step data-state={step.state}>
          {body}
        </Link>
      ) : (
        <div className="step-box" data-step data-state={step.state} tabIndex={-1} aria-disabled="true">
          {body}
        </div>
      )}
    </li>
  );
}
