// f52 wave B (app ruling 4): the course rail under the header of every Fundamentals unit.
//
//   JS/TS Fundamentals · Topic 3/20     Lesson ✓ → Gate ✓ → Drill 1 → Drill 2 → Next topic
//
// It reads the page's shared ladder (lib/useFundLadder), so its ticks follow each recorded submit.
// A step that is the page itself is text; a locked one is text too; everything else is a link.
import { Link } from 'react-router-dom';
import type { UnitSummary } from '../../api/types';
import { Icon } from '../../components/Icon';
import { TOPIC_MINUTES, drillMinutes, fmtMinutes } from '../../lib/estimates';
import { fundPlace } from '../../lib/fundamentals';
import { useSharedFundLadder } from '../../lib/useFundLadder';
import { TRACK_LABEL } from '../../lib/view';

interface Step {
  id: string;
  label: string;
  /** shown after the label while the step is not done */
  estimate?: string;
  done: boolean;
  current: boolean;
  /** where the step leads; null = not a link (this page, or locked) */
  to: string | null;
  title?: string;
}

export function CourseRail({ unit }: { unit: Pick<UnitSummary, 'id' | 'key' | 'trackId'> }) {
  const shared = useSharedFundLadder();
  const place = shared?.ladder ? fundPlace(shared.ladder, unit.key) : null;
  if (!place) return null;
  const { topic, index, total, next } = place;
  const onTopic = unit.id === topic.unit.id;
  const gateDone = topic.unit.state === 'done';
  const topicHref = onTopic || topic.unit.state === 'locked' ? null : `/play/${topic.unit.id}`;
  const steps: Step[] = [
    { id: 'lesson', label: 'Lesson', estimate: fmtMinutes(TOPIC_MINUTES), done: gateDone, current: false, to: topicHref, title: 'Lesson and quiz gate together' },
    { id: 'gate', label: 'Gate', done: gateDone, current: onTopic, to: topicHref },
    ...topic.drills.map(
      (d, i): Step => ({
        id: `drill-${i + 1}`,
        label: `Drill ${i + 1}`,
        estimate: fmtMinutes(drillMinutes(d.difficulty)),
        done: d.state === 'done',
        current: d.id === unit.id,
        to: d.id === unit.id || d.state === 'locked' ? null : `/play/${d.id}`,
        title: d.title,
      }),
    ),
    {
      id: 'next',
      label: next ? 'Next topic' : 'Ladder end',
      done: false,
      current: false,
      to: next && next.unit.state !== 'locked' ? `/play/${next.unit.id}` : null,
      title: next ? (next.unit.state === 'locked' ? "Unlocks when you pass this topic's quiz gate" : next.title) : undefined,
    },
  ];
  return (
    <nav className="course-rail" aria-label="Fundamentals course" data-testid="course-rail">
      <span className="course-rail-where" data-testid="rail-where">
        {TRACK_LABEL[unit.trackId]} Fundamentals · Topic {index + 1}/{total}
      </span>
      <ol className="course-rail-steps">
        {steps.map((s) => {
          const body = (
            <>
              {s.done && <Icon name="check" size={12} />}
              <span>{s.label}</span>
              {s.done && <span className="sr-only"> (done)</span>}
              {!s.done && s.estimate && <span className="course-rail-est"> {s.estimate}</span>}
            </>
          );
          return (
            <li key={s.id} data-step={s.id} data-done={s.done ? 'true' : 'false'} {...(s.current ? { 'data-current': 'true' } : {})}>
              {s.to ? (
                <Link to={s.to} title={s.title}>
                  {body}
                </Link>
              ) : (
                <span title={s.title} {...(s.current ? { 'aria-current': 'step' as const } : {})}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
