import { Prose } from '../../lib/prose';
import { storedGet, storedSet } from '../../lib/draft';

/**
 * rv B (R5-07, R3-09): 209 drills (javadrills 80/80, sysdrills 129/129) state the worked model in a
 * "**Why it works.**" paragraph BEFORE "**Your task.**", so the drill grades typing, not reasoning. The
 * player folds that section until the learner's first failed submit or a pass (client-only: the content
 * stays byte-identical). The open state is remembered per unit in this browser.
 */

export const WHY_MARKER = '**Why it works.**';

/** Split instructions around the "Why it works" paragraph(s): up to the next bold-lead paragraph ("**Your task.**"). */
export function splitWhyItWorks(md: string): { before: string; why: string; after: string } | null {
  const start = md.indexOf(WHY_MARKER);
  if (start < 0) return null;
  // the section ends at the next paragraph that opens with a bold lead ("**Your task.**", "**Worked example.**")
  const rest = md.slice(start + WHY_MARKER.length);
  const next = /\n\s*\n\*\*[^*\n]{2,60}\*\*/.exec(rest);
  const end = next ? start + WHY_MARKER.length + next.index : md.length;
  return { before: md.slice(0, start).trimEnd(), why: md.slice(start, end).trim(), after: md.slice(end).trimStart() };
}

const key = (unitId: number) => `why-open:v1:${unitId}`;
/** true once this browser saw a failed submit (or a pass) on the unit */
export const whyOpenStored = (unitId: number): boolean => storedGet(key(unitId)) === '1';
export const rememberWhyOpen = (unitId: number): void => {
  storedSet(key(unitId), '1');
};

/** The instructions with the "Why it works" section folded (closed) or shown (open). */
export function WhyItWorksProse({ text, open, className }: { text: string; open: boolean; className?: string }) {
  const split = splitWhyItWorks(text);
  if (!split || open) return <Prose text={text} className={className} />;
  return (
    <>
      {split.before !== '' && <Prose text={split.before} className={className} />}
      <p className="why-fold muted small" data-testid="why-fold">
        <strong>Why it works</strong> is folded: work out the model yourself first. It opens after your first failed submit (a free one costs nothing) or a pass.
      </p>
      {split.after !== '' && <Prose text={split.after} className={className} />}
    </>
  );
}
