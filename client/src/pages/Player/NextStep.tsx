// U4 + U5: what to do after a verified pass. A Fundamentals unit continues on its ladder
// (lib/nextstep.ts); every other unit keeps the dashboard's server-derived "Next up" for its track.
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/context';
import type { TrackId, UnitSummary } from '../../api/types';
import { InlineProse } from '../../lib/prose';
import { fundStepLabel, fundTrackOf, pickFundNext, type FundNext, type FundStep } from '../../lib/nextstep';
import { overlayOpen } from '../../lib/shortcuts';
import { useAsync } from '../../lib/useAsync';

type Unit = Pick<UnitSummary, 'id' | 'key' | 'trackId'>;

interface Resolved {
  fund: FundNext | null;
  /** the dashboard's next open unit on the track (the fallback) */
  nextUp: { id: number; title: string } | null;
}

/**
 * The primary link takes focus when it appears, so Enter advances (a dialog in front of the page
 * keeps its own focus).
 */
function PrimaryLink({ to, testId, children }: { to: string; testId?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!overlayOpen()) ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <Link ref={ref} to={to} className="btn btn-sm btn-primary next-primary" data-testid={testId}>
      {children}
    </Link>
  );
}

function StepText({ step }: { step: FundStep }) {
  const { lead, title } = fundStepLabel(step);
  return (
    <>
      {lead}: <InlineProse text={title} />
    </>
  );
}

/**
 * After a verified pass: the next step. Read when the pass lands, so it already reflects this unit
 * being done. `trackId` is the unit's track (campaign map link + the nextUp fallback).
 */
export function NextStep({ unit }: { unit: Unit }) {
  const api = useApi();
  const fundTrack = fundTrackOf(unit.key);
  const q = useAsync(async (): Promise<Resolved> => {
    let fund: FundNext | null = null;
    if (fundTrack !== null) {
      // a ladder that cannot be read is not an error for the learner: the fallback still applies
      fund = await api.getFundamentals(fundTrack).then(
        (ladder) => pickFundNext(ladder, unit),
        () => null,
      );
      if (fund?.primary) return { fund, nextUp: null };
    }
    const dash = await api.getDashboard();
    return { fund, nextUp: dash.nextUp.find((n) => n.trackId === unit.trackId)?.unit ?? null };
  }, [api, unit.id, unit.key, unit.trackId, fundTrack]);
  if (q.status === 'loading') return null;

  const trackId: TrackId = unit.trackId;
  const fund = q.status === 'ready' ? q.data.fund : null;
  const next = q.status === 'ready' ? q.data.nextUp : null;
  return (
    <p className="next-unit" data-testid="next-unit">
      {fund?.primary ? (
        <>
          <PrimaryLink to={`/play/${fund.primary.unit.id}`} testId="next-primary">
            <StepText step={fund.primary} /> →
          </PrimaryLink>
          {fund.nextTopic && (
            <Link to={`/play/${fund.nextTopic.unit.id}`} className="btn btn-sm" data-testid="next-topic">
              <StepText step={fund.nextTopic} />
            </Link>
          )}
        </>
      ) : next && next.id !== unit.id ? (
        <PrimaryLink to={`/play/${next.id}`} testId="next-primary">
          Next unit: <InlineProse text={next.title} /> →
        </PrimaryLink>
      ) : (
        <>
          <span className="muted">{q.status === 'error' ? 'Could not read what is next.' : 'Nothing else is open on this track right now.'}</span>{' '}
          <Link to={`/campaign/${trackId}`}>Open the campaign map</Link>
        </>
      )}
    </p>
  );
}
