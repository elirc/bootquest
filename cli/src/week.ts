import type { WeekResponse } from '@bootquest/shared/api-ext';

/**
 * rv2 S3 (PLAN F7): `bootquest week` prints GET /week (read-only). The reflection is answered in the app (/week).
 */

const CATEGORY_LABEL: Record<string, string> = {
  misread: 'misread the question',
  'concept-gap': 'concept gap',
  'edge-case': 'missed an edge case',
  'api-or-syntax': 'API or syntax',
  slip: 'careless slip',
  other: 'other',
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function formatWeek(w: WeekResponse, server: string): string {
  const lines: string[] = [];
  lines.push(`Week ${w.start} to ${w.end}${w.today >= w.start && w.today <= w.end ? ' (this week)' : ''}`);
  const h = Math.floor(w.time.estMinutes / 60);
  const m = w.time.estMinutes % 60;
  lines.push(`  Time:      ~${h > 0 ? `${h} h ` : ''}${m} min over ${plural(w.time.sittings, 'sitting')} on ${plural(w.time.activeDays, 'day')} (estimated)`);
  const kinds = w.passes.byKind.map((k) => `${k.units} ${k.kind}`).join(', ');
  lines.push(`  Passes:    ${plural(w.passes.units, 'unit')} passed (${w.passes.firstTime} for the first time)${kinds ? `: ${kinds}` : ''}`);
  if (w.passes.selfScored > 0) lines.push(`             ${plural(w.passes.selfScored, 'explain-back / kata answer')} self-scored`);
  lines.push(`  XP:        ${w.xp}`);
  lines.push(`  Reviews:   ${w.reviews.graded} graded, ${w.reviews.again} rated again`);
  if (w.shakyIdeas.length === 0) lines.push('  Key ideas: none rated again twice this week');
  else {
    lines.push(`  Key ideas rated again twice or more (${w.shakyIdeas.length}):`);
    for (const s of w.shakyIdeas) lines.push(`    - ${s.idea ?? `${s.section}/${s.ideaId}`} (${s.again}x)`);
  }
  if (w.notebook.entries === 0) lines.push('  Notebook:  no entries this week');
  else lines.push(`  Notebook:  ${plural(w.notebook.entries, 'entry', 'entries')}; top: ${w.notebook.topCategories.map((c) => `${CATEGORY_LABEL[c.category] ?? c.category} (${c.count})`).join(', ')}`);
  lines.push(
    w.reflection.answers
      ? `  Reflection: saved ${new Date(w.reflection.savedAt!).toISOString().slice(0, 10)}`
      : `  Reflection: not written yet - ${w.reflection.questions.length} questions at ${server}/week`,
  );
  return lines.join('\n');
}
