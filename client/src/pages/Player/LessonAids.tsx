// f52 wave B (app ruling 7): "check yourself" cards inside a Fundamentals lesson.
//
// Each check sits at the end of the lesson section whose heading it names (so it is read after the
// section it is about). A card is a prompt and a Reveal button: no XP, no attempt, nothing sent. The
// quiz gate pane owns the data (GET /units/:id/lesson-aids) and switches the cards off while the gate
// is open, even when the learner asked for the lesson back ("Show lesson").
import { createContext, useContext, useState } from 'react';
import type { LessonCheck } from '../../api/types';
import { Prose, ProseBlocks, parseProse, type ProseBlock } from '../../lib/prose';

export interface LessonAidsView {
  checks: readonly LessonCheck[];
  /** false while the quiz gate is open */
  show: boolean;
}

export const LessonAidsContext = createContext<LessonAidsView>({ checks: [], show: false });

export interface LessonSection {
  blocks: ProseBlock[];
  checks: LessonCheck[];
}

const same = (a: string, b: string): boolean => a.trim() === b.trim();

/**
 * Split a parsed lesson at its headings and hang each check on the section its heading names (the
 * first one, when a heading repeats). A check whose heading is not in the lesson goes after the last
 * section: it is never dropped and never guessed into the middle.
 */
export function placeChecks(blocks: readonly ProseBlock[], checks: readonly LessonCheck[]): LessonSection[] {
  const sections: LessonSection[] = [];
  for (const b of blocks) {
    if (b.kind === 'heading' || sections.length === 0) sections.push({ blocks: [b], checks: [] });
    else sections[sections.length - 1]!.blocks.push(b);
  }
  if (sections.length === 0) return checks.length > 0 ? [{ blocks: [], checks: [...checks] }] : [];
  for (const c of checks) {
    const at = sections.find((s) => s.blocks[0]?.kind === 'heading' && same(s.blocks[0].text, c.heading));
    (at ?? sections[sections.length - 1]!).checks.push(c);
  }
  return sections;
}

export function CheckCard({ check }: { check: LessonCheck }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className="check-card" data-testid="lesson-check" data-revealed={open ? 'true' : 'false'} aria-label="Check yourself">
      <p className="check-card-label">Check yourself</p>
      <Prose text={check.prompt} className="check-card-prompt" />
      {open ? (
        <div className="check-card-answer" data-testid="lesson-check-answer">
          <Prose text={check.answer} />
        </div>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          Reveal
        </button>
      )}
      <p className="muted small check-card-note">Not graded: no XP, no attempt.</p>
    </aside>
  );
}

/** A Fundamentals lesson: the same rendering as <Prose headings>, plus the section checks. */
export function LessonProse({ text, className }: { text: string; className?: string }) {
  const aids = useContext(LessonAidsContext);
  const blocks = parseProse(text, { headings: true });
  const sections = placeChecks(blocks, aids.show ? aids.checks : []);
  return (
    <div className={`prose${className ? ` ${className}` : ''}`}>
      {sections.map((s, i) => (
        <LessonSectionView key={i} section={s} />
      ))}
    </div>
  );
}

function LessonSectionView({ section }: { section: LessonSection }) {
  return (
    <>
      <ProseBlocks blocks={section.blocks} />
      {section.checks.map((c, i) => (
        <CheckCard key={`${c.heading}-${i}`} check={c} />
      ))}
    </>
  );
}
