import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api/context';
import type { NodeState, TrackId, TrackSummary, UnitSummary } from '../api/types';
import { Icon } from '../components/Icon';
import { Chip, LoadState, PageHeader } from '../components/ui';
import { hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { useAsync } from '../lib/useAsync';
import { TRACK_IDS, isTrackId } from '../lib/view';

const STATE_LABEL: Record<NodeState, string> = {
  done: 'Done',
  available: 'Available',
  locked: 'Locked',
};

export function CampaignPage() {
  const { trackId } = useParams();
  if (!isTrackId(trackId)) return <Navigate to="/campaign/js" replace />;
  return <CampaignView trackId={trackId} />;
}

/**
 * The campaign view is derived from GET /api/tracks/:id/units (there is no /campaign route).
 * Acts arrive in W5; until then the track renders as ONE act in server unit order.
 */
function CampaignView({ trackId }: { trackId: TrackId }) {
  const api = useApi();
  const tracks = useAsync(() => api.getTracks(), [api]);
  const units = useAsync(() => api.getTrackUnits(trackId), [api, trackId]);
  const mapRef = useRef<HTMLDivElement>(null);
  const track = units.data?.track ?? tracks.data?.tracks.find((t) => t.id === trackId);
  const locked = track?.locked === true;

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
      const current = nodes.findIndex((n) => n.dataset.state === 'available');
      next = current === -1 ? 0 : current;
    } else {
      next = Math.max(0, Math.min(nodes.length - 1, at + (e.key === 'j' ? 1 : -1)));
    }
    nodes[next]?.focus();
  });

  return (
    <>
      <PageHeader eyebrow="Campaign" title={track ? track.name : ' '} />
      <TrackTabs tracks={tracks.data?.tracks ?? []} current={trackId} />
      <div className={`campaign${locked ? ' campaign-locked' : ''}`} ref={mapRef}>
        {locked && track && (
          <div className="locked-banner" role="note">
            <Icon name="lock" /> <strong>{track.name} is locked.</strong> No content is available on this track yet.
          </div>
        )}
        {units.status === 'ready' ? (
          <CampaignPath units={units.data.units} />
        ) : (
          <LoadState error={units.error} onRetry={units.reload} minHeight={480} />
        )}
      </div>
    </>
  );
}

function TrackTabs({ tracks, current }: { tracks: TrackSummary[]; current: TrackId }) {
  const navigate = useNavigate();
  const list: Pick<TrackSummary, 'id' | 'name' | 'locked'>[] = tracks.length ? tracks : TRACK_IDS.map((id) => ({ id, name: id, locked: false }));
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

function CampaignPath({ units }: { units: UnitSummary[] }) {
  const done = units.filter((u) => u.state === 'done').length;
  const state = units.length === 0 ? 'locked' : done === units.length ? 'complete' : units.some((u) => u.state !== 'locked') ? 'in-progress' : 'locked';
  return (
    <ol className="acts" role="tabpanel" aria-label="Campaign acts">
      <li className={`act act-${state}`} data-act="all">
        <header className="act-head">
          <span className="act-num" aria-hidden="true">
            I
          </span>
          <div className="act-text">
            <h2 className="act-title">All units</h2>
            <p className="act-summary">Single act in unit order — campaign acts arrive in W5.</p>
          </div>
          <div className="act-side">
            {units.length > 0 && (
              <span className="muted">
                {done}/{units.length} done
              </span>
            )}
          </div>
        </header>
        {units.length === 0 ? (
          <p className="act-gate">No units on this track yet.</p>
        ) : (
          <ol className="path">
            {units.map((u) => (
              <StepNode key={u.id} unit={u} />
            ))}
          </ol>
        )}
      </li>
    </ol>
  );
}

const NODE_CLASS: Record<NodeState, string> = { done: 'complete', available: 'available', locked: 'locked' };

function StepNode({ unit }: { unit: UnitSummary }) {
  const actionable = unit.state !== 'locked';
  const cls = NODE_CLASS[unit.state];
  const body = (
    <>
      <span className={`node node-${cls}`} aria-hidden="true">
        {unit.state === 'done' && <Icon name="check" size={12} />}
        {unit.state === 'locked' && <Icon name="lock" size={11} />}
      </span>
      <span className="step-main">
        <span className="step-title">{unit.title}</span>
        <span className="step-meta">
          {unit.kind}
          {unit.difficulty !== null && <> · difficulty {unit.difficulty}</>}
        </span>
      </span>
      {unit.revealed && <Chip tone="warning">revealed · 0 XP</Chip>}
      <span className="sr-only">, {STATE_LABEL[unit.state]}</span>
    </>
  );
  return (
    <li className={`step step-${cls}`}>
      {actionable ? (
        <Link to={`/play/${unit.id}`} className="step-box" data-step data-state={unit.state}>
          {body}
        </Link>
      ) : (
        <div className="step-box" data-step data-state={unit.state} tabIndex={-1} aria-disabled="true">
          {body}
        </div>
      )}
    </li>
  );
}
