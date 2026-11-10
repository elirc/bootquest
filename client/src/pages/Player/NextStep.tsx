// U4 + U5: what to do after a verified pass. A Fundamentals unit continues on its ladder
// (lib/nextstep.ts); every other unit keeps the dashboard's server-derived "Next up" for its track.
//
// f52 wave B (app ruling 4): the ladder comes from the page's shared read (lib/useFundLadder, the
// one the course rail uses), re-read by the submit that mounts this component, so it reflects the
// pass. A gate pass, and the pass that completes a topic, get a completion panel around the links:
// "Topic 3 of 20 complete", the XP counted up, the flashcards enrolled, and the focused primary
// button. After a gate pass the primary is "Practise: <drill>" and the next topic is a muted
// "Skip to next topic" link.
//
// App ruling 5: once the topic's own drills are done (the step is no longer this topic's gate or
// one of its drills), the topic's "More practice" list follows the links.
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/context';
import type { SubmitResponse, TrackId, UnitSummary } from '../../api/types';
import { Icon } from '../../components/Icon';
import { MorePractice } from '../../components/MorePractice';
import { useCountUp } from '../../lib/countup';
import { fundPlace } from '../../lib/fundamentals';
import { InlineProse } from '../../lib/prose';
import { fundStepLabel, fundTrackOf, pickFundNext, type FundStep } from '../../lib/nextstep';
import { overlayOpen } from '../../lib/shortcuts';
import { useAsync } from '../../lib/useAsync';
import { useSharedFundLadder } from '../../lib/useFundLadder';

type Unit = Pick<UnitSummary, 'id' | 'key' | 'trackId'>;

/**
 * The primary link takes focus when it appears, so Enter advances (a dialog in front of the page
 * keeps its own focus).
 */
function PrimaryLink({ to, testId, children }: { to: string; testId?: string; children: ReactNode }) {
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

/** "+50 XP", counted up from 0 in 600 ms (at once under reduced motion and in tests). */
function XpCount({ amount }: { amount: number }) {
  const shown = useCountUp(amount);
  return (
    <span className="completion-xp" data-testid="completion-xp" aria-label={`+${amount} XP`}>
      +{shown} XP
    </span>
  );
}

/**
 * After a verified pass: the next step. `submit` is the pass itself (its XP and enrolled flashcards
 * feed the completion panel); `unit.trackId` is the unit's track (campaign map link + the nextUp
 * fallback).
 */
export function NextStep({ unit, submit }: { unit: Unit; submit?: SubmitResponse }) {
  const api = useApi();
  const shared = useSharedFundLadder();
  const onLadder = shared !== null && shared.track !== null && fundTrackOf(unit.key) === shared.track;
  // the submit that mounted this re-reads the ladder: wait for it, so the step reflects the pass
  const waiting = onLadder && (!shared.settled || shared.loading);
  // a ladder that cannot be read is not an error for the learner: the fallback still applies
  const ladder = onLadder && !waiting ? shared.ladder : null;
  const fund = ladder ? pickFundNext(ladder, unit) : null;
  const needNextUp = !waiting && !fund?.primary;
  const q = useAsync(
    async () => ({
      asked: needNextUp,
      // the dashboard's next open unit on the track (the fallback)
      unit: needNextUp ? ((await api.getDashboard()).nextUp.find((n) => n.trackId === unit.trackId)?.unit ?? null) : null,
    }),
    [api, needNextUp, unit.id, unit.trackId],
  );
  // useAsync still holds the previous answer for one render after `needNextUp` flips
  const nextUpPending = needNextUp && !(q.status === 'error' || (q.status === 'ready' && q.data.asked));
  if (waiting || nextUpPending) return null;

  const trackId: TrackId = unit.trackId;
  const next = q.status === 'ready' ? q.data.unit : null;

  // ---- wave B: the completion moment (Fundamentals only)
  const place = ladder ? fundPlace(ladder, unit.key) : null;
  const isGate = place !== null && unit.id === place.topic.unit.id;
  const gateDone = place !== null && (isGate || place.topic.unit.state === 'done');
  const otherDrillDone = place !== null && place.topic.drills.some((d) => d.id !== unit.id && d.state === 'done');
  // a re-pass of a drill that was already passed completes nothing new
  const firstPass = submit?.xp?.reason !== 'already-awarded';
  const completes =
    place !== null && (isGate ? place.topic.drills.length === 0 || otherDrillDone : gateDone && !otherDrillDone && firstPass);
  const showPanel = place !== null && (isGate || completes);
  const afterGate = isGate && fund?.primary?.kind === 'drill';

  const links = (
    <p className="next-unit" data-testid="next-unit">
      {fund?.primary ? (
        <>
          <PrimaryLink to={`/play/${fund.primary.unit.id}`} testId="next-primary">
            <StepText step={fund.primary} /> →
          </PrimaryLink>
          {fund.nextTopic &&
            (afterGate ? (
              // the gate alone already unlocked the next topic; practising first is the default
              <Link to={`/play/${fund.nextTopic.unit.id}`} className="next-skip muted small" data-testid="next-topic">
                Skip to next topic
              </Link>
            ) : (
              <Link to={`/play/${fund.nextTopic.unit.id}`} className="btn btn-sm" data-testid="next-topic">
                <StepText step={fund.nextTopic} />
              </Link>
            ))}
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
  // wave B (ruling 5): related drills of the track's other banks, once the topic's own are done
  const ownDone = place !== null && gateDone && fund?.primary?.kind !== 'drill' && fund?.primary?.kind !== 'gate';
  const more = ownDone && place !== null ? <MorePractice related={place.topic.related} as="block" /> : null;
  if (!showPanel || place === null) {
    return (
      <>
        {links}
        {more}
      </>
    );
  }

  const xp = submit?.xp?.amount ?? 0;
  const enrolled = submit?.studyQuiz?.flashcardsEnrolled ?? 0;
  const where = `Topic ${place.index + 1} of ${place.total}`;
  return (
    <section className="completion" data-testid="completion-panel" data-complete={completes ? 'true' : 'false'} aria-label="Topic progress">
      <p className="completion-title" data-testid="completion-title">
        <Icon name="check" /> <strong>{completes ? `${where} complete` : `${where} · quiz gate passed`}</strong>
        {xp > 0 && <XpCount amount={xp} />}
      </p>
      {enrolled > 0 && (
        <p className="muted small" data-testid="completion-flashcards">
          {enrolled} flashcard{enrolled === 1 ? '' : 's'} enrolled in your reviews (first due tomorrow).
        </p>
      )}
      {!completes && (
        <p className="muted small" data-testid="completion-todo">
          The next topic is unlocked. Pass one drill to complete this one.
        </p>
      )}
      {links}
      {more}
    </section>
  );
}
