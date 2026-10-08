/**
 * Thin layer over the P4 citations resolver (never a reimplementation):
 *   resolveAt       exact root-/guide-relative lookups see the FULL tree (guides do cite
 *                   files inside snapshot dirs: ww6 03-WORKED-CHANGE.md links
 *                   snapshots/errors.ts.original.txt), while unique-suffix matching sees
 *                   the pruned index (snapshot dupes would make bare names ambiguous — P4).
 *   bindCrossBlock  real guides continue a file across table rows / list items / paragraphs
 *                   (ww6 01-CODEBASE-MAP.md:11 `:90-92` continues row 10's file). The parser
 *                   rightly calls these orphans; we bind them to the most recent file cited
 *                   earlier in the same section and mark them crossBlockFrom — a guess that
 *                   routes the item to the review queue, never to a pass.
 */
import type { SeedCitation } from '@bootquest/shared';
import type { Citation } from '../citations/parse.ts';
import { resolveCitation, type Resolution } from '../citations/resolve.ts';
import type { Checkout } from './checkout.ts';
import type { Heading } from './quests/parse.ts';

export function resolveAt(co: Checkout, guide: string, c: Citation): Resolution {
  const full = resolveCitation(co.root, guide, c, co.fullIndex);
  if (full.status === 'ok' && full.via !== 'suffix') return full;
  return resolveCitation(co.root, guide, c, co.index);
}

export const toSeedCitation = (c: Citation): SeedCitation => ({
  raw: c.raw,
  path: c.path,
  lineStart: c.lineStart,
  lineEnd: c.lineEnd,
  form: c.form,
  sourceLine: c.source.line,
  ...(c.malformed ? { malformed: c.malformed } : {}),
  ...(c.inheritAmbiguous ? { inheritAmbiguous: c.inheritAmbiguous } : {}),
});

const ORPHAN = 'continuation reference with no earlier file in the same block';
const RANGE = /^L?(\d+)(?:\s*[-–—]\s*L?(\d+))?$/;

/** Section (H2-level or above) a guide line belongs to. */
function sectionOf(hs: readonly Heading[], line: number): number {
  let s = 0;
  for (const h of hs) if (h.level <= 2 && h.line <= line) s = h.line;
  return s;
}

/** Convert parser citations to seed citations, binding orphan continuations across blocks (marked). */
export function seedCitations(all: readonly Citation[], hs: readonly Heading[]): SeedCitation[] {
  const out: SeedCitation[] = [];
  let last: { path: string; line: number; section: number } | null = null;
  for (const c of all) {
    const inherited = c.form === 'continuation' || c.form === 'prose-line';
    if (!inherited && c.path && !c.malformed && !c.path.endsWith('/')) last = { path: c.path, line: c.source.line, section: sectionOf(hs, c.source.line) };
    if (c.form === 'continuation' && c.path === null && c.malformed === ORPHAN && last && last.section === sectionOf(hs, c.source.line)) {
      const spec = c.raw.trim().replace(/^:/, '');
      const ranges = spec.split(',').map((p) => RANGE.exec(p.trim()));
      if (ranges.every((m) => m !== null)) {
        for (const m of ranges) {
          const a = Number(m![1]);
          out.push({ raw: c.raw, path: last.path, lineStart: a, lineEnd: m![2] !== undefined ? Number(m![2]) : a, form: 'continuation', sourceLine: c.source.line, inheritAmbiguous: [last.path], crossBlockFrom: last.line });
        }
        continue;
      }
    }
    out.push(toSeedCitation(c));
  }
  return out;
}

/** Rebuild a parser Citation from a stored seed citation (for re-resolution). */
export function asCitation(c: SeedCitation, guide: string): Citation {
  return {
    path: c.path,
    lineStart: c.lineStart,
    lineEnd: c.lineEnd,
    form: c.form,
    raw: c.raw,
    source: { file: guide, line: c.sourceLine, column: 1 },
    group: 0,
    ...(c.malformed ? { malformed: c.malformed } : {}),
    ...(c.inheritAmbiguous ? { inheritAmbiguous: c.inheritAmbiguous } : {}),
  };
}
