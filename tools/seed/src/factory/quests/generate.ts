/**
 * seed:quests generator: a repo checkout at a pinned sha → candidate quiz
 * items, finding-flashcards and reading steps. Deterministic: same (tree, sha)
 * → same candidates, same keys, same choice order (hash-seeded, no RNG).
 * Candidates are NOT shipped until validate.ts accepts them.
 */
import type { SeedCitation, SeedFlashcardItem, SeedItem, SeedQuizItem, SeedReadingStepItem, SeedSkip } from '@bootquest/shared';
import { isIdentifierToken, parseCitations } from '../../citations/parse.ts';
import { readTracked, type Checkout } from '../checkout.ts';
import { asCitation, resolveAt, seedCitations } from '../cite.ts';
import type { Exclusions } from '../exclusions.ts';
import { hashOrder, stableKey } from '../util.ts';
import { extractFindings, extractGoalChecks, headings, readingSections, scanLines, type Finding, type GoalCheck } from './parse.ts';

/** User-authored guide trees (HANDOFF rule 1); upstream project docs are not quest material. */
export const GUIDE_ROOTS = [
  /^astraupskill\//,
  /^fabledocs\d*\//,
  /^fable docs\//,
  /^docsclaude\//,
  /^docs-codex-learning\//,
  /^docs[2-4]\//,
  /^gptdocs\//,
  /^training\//,
  /^learn\//,
  /^docs\/(learning|upskill|architecture)\//,
];

export function discoverGuides(co: Checkout): string[] {
  return [...co.index.files].filter((f) => f.toLowerCase().endsWith('.md') && GUIDE_ROOTS.some((r) => r.test(f)) && !/(^|\/)(evidence|snapshots)\//.test(f)).sort();
}

export const MAX_DISTRACTORS = 3;

/**
 * Reading-step key base per guide. Historically the guide's BASENAME (keys of every
 * shipped pack stay byte-identical); W7 fix: when two guides of one run share a
 * basename (multi-app repos: apps/a/docs/learning/01.md + apps/b/docs/learning/01.md)
 * every colliding guide is keyed on its FULL repo-relative path instead, so
 * writeSeedPack no longer crashes on duplicate keys.
 */
export function readingStepKeyBases(guides: readonly string[]): Map<string, string> {
  const base = (g: string) => g.split('/').pop() ?? g;
  const n = new Map<string, number>();
  for (const g of guides) n.set(base(g), (n.get(base(g)) ?? 0) + 1);
  return new Map(guides.map((g) => [g, (n.get(base(g)) ?? 0) > 1 ? g : base(g)]));
}

/** Remove code spans that are citations (they would give a location quiz away). */
export function stripCitationSpans(s: string): string {
  return s
    .replace(/\s*\(`[^`]*:\d[^`]*`(?:,\s*`[^`]*`)*\)/g, '')
    .replace(/`[^`\s]*\.[A-Za-z]+:\d[^`]*`/g, 'the cited code')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Answer-LENGTH tell (docs/SEEDING.md backlog): a goal-check whose keyed Check is longer
 * than LENGTH_TELL_RATIO x the longest distractor is identifiable unread ("pick the long
 * one"), e.g. master3 05-PRACTICE.md:46, a Check of two concatenated `test(` blocks.
 */
export const LENGTH_TELL_RATIO = 1.5;

/** null when the key is not a length tell against these distractors, else the skip reason. */
export function lengthTellReason(answer: string, distractors: readonly { text: string }[]): string | null {
  const longest = Math.max(0, ...distractors.map((d) => d.text.length));
  if (answer.length <= LENGTH_TELL_RATIO * longest) return null;
  return `length-tell (key ${answer.length} chars > ${LENGTH_TELL_RATIO}x the longest distractor ${longest} chars; the guide has no length-matched set of ${distractors.length} other Checks)`;
}

/**
 * Goal-check distractors: the first MAX_DISTRACTORS other Checks in hash order (the
 * historical pick, so every non-telling item stays byte-identical). When that pick is a
 * length tell, re-pick the MAX_DISTRACTORS Checks closest in length to the key (log-ratio
 * distance, ties in hash order); if even that set tells, the item is not generated
 * (`lengthTell` carries the counted skip reason). Never pads with fewer distractors.
 */
export function pickGoalCheckDistractors<T extends { text: string; evidence: string[] }>(answer: string, pool: readonly T[], key: string): { distractors: T[]; lengthTell: string | null } {
  const ordered = hashOrder(pool, key, (d) => d.evidence[0]!);
  const first = ordered.slice(0, MAX_DISTRACTORS);
  if (!lengthTellReason(answer, first)) return { distractors: first, lengthTell: null };
  const dist = (d: T) => Math.abs(Math.log(Math.max(1, d.text.length) / Math.max(1, answer.length)));
  const matched = ordered
    .map((d, i) => ({ d, i }))
    .sort((a, b) => dist(a.d) - dist(b.d) || a.i - b.i)
    .slice(0, MAX_DISTRACTORS)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.d);
  const why = lengthTellReason(answer, matched);
  return why ? { distractors: [], lengthTell: why } : { distractors: matched, lengthTell: null };
}

/**
 * The review-card explanation of a generated goal-check: where the guide pairs the Goal
 * with its Check. (It used to be the parser's raw label, e.g. "1 (inline list item)" or
 * "goal 2", which explained nothing; campaign 2 review F5.) A bold lead label is a real
 * exercise title and is kept; list numbers, "-" and "goal N" ordinals are not.
 */
export function goalCheckExplanation(guide: string, g: Pick<GoalCheck, 'label' | 'lineStart' | 'lineEnd'>): string {
  const titled = !/^(\d+|-|goal \d+)$/i.test(g.label.trim()) && g.label.trim() !== '';
  const where = `${guide}:${g.lineStart}${g.lineEnd !== g.lineStart ? `-${g.lineEnd}` : ''}`;
  return `In ${where}${titled ? ` (exercise "${g.label.trim()}")` : ''}, the guide pairs this Goal with this Check; the other choices are the Checks of other exercises in the same guide.`;
}

/**
 * The review-card explanation of a generated finding-location quiz: the finding's label and
 * severity ("F3 (Medium)"), as it always was. A finding whose label is a bare list number with no
 * severity used to ship the explanation "3" (release review, the F5 sibling); it now says where
 * the guide records the finding instead.
 */
export function findingLocationExplanation(guide: string, f: { label: string; severity?: string | null; lineStart: number; lineEnd: number }): string {
  const label = f.label.trim();
  if (f.severity) return `${label} (${f.severity})`;
  if (label !== '' && !/^(\d+|-)$/.test(label)) return label;
  const where = `${guide}:${f.lineStart}${f.lineEnd !== f.lineStart ? `-${f.lineEnd}` : ''}`;
  return `In ${where}, the guide records this defect at this location; the other choices are where other findings in the same guide point.`;
}

export interface GuideCandidates {
  guide: string;
  items: SeedItem[];
  /** non-item skips (unpaired goals, no-distractor quizzes) */
  skipped: SeedSkip[];
}

interface FindingCtx {
  finding: Finding;
  guide: string;
  key: string;
  citations: SeedCitation[];
  /** first resolvable line citation: file + range (used for location quizzes) */
  primary: { file: string; lineStart: number; lineEnd: number } | null;
  /** every file its citations resolve to */
  files: string[];
}

export interface QuestCandidates {
  guides: GuideCandidates[];
  /** guides refused before reading (excluded by the registry) */
  excludedGuides: SeedSkip[];
}

/**
 * Build every candidate for the given guides. Excluded guides are never read
 * (reported). Secret patterns in a non-excluded guide throw (UnregisteredSecretError).
 */
export function generateQuestCandidates(co: Checkout, guides: readonly string[], ex: Exclusions): QuestCandidates {
  const out: QuestCandidates = { guides: [], excludedGuides: [] };
  const allFindings: FindingCtx[] = [];
  const parsed: Array<{ guide: string; gcs: GoalCheck[]; cites: SeedCitation[]; gc: GuideCandidates }> = [];
  const stepKeyBase = readingStepKeyBases(guides);

  for (const guide of guides) {
    const excluded = ex.path(co.repo, guide);
    if (excluded) {
      out.excludedGuides.push({ subject: guide, reason: excluded.reason });
      continue;
    }
    const text = readTracked(co, guide);
    // secrets in a guide the registry does not know about: hard refusal
    if (ex.admit(co.repo, guide, text)) continue;
    const lines = scanLines(text);
    const hs = headings(lines);
    const gc: GuideCandidates = { guide, items: [], skipped: [] };
    // fix 3b: a path-only, line-less `cfg.lock`-shaped token that resolves to NO file at the
    // pinned sha is a member expression the parser mistook for a filename — dropped here
    // (counted as a skip) so it never rides on an item and quarantines it.
    const citations = seedCitations(parseCitations(text, guide).citations, hs).filter((c) => {
      if (!c.path || c.malformed || c.lineStart !== null || c.lineEnd !== null || c.form !== 'path-only' || !isIdentifierToken(c.path)) return true;
      const r = resolveAt(co, guide, asCitation(c, guide));
      if (r.status === 'error' && r.reason === 'missing-file') {
        gc.skipped.push({ subject: `${guide}:${c.sourceLine}`, reason: `not-a-citation: \`${c.raw}\` reads as a dotted identifier and no such file exists at the pinned sha` });
        return false;
      }
      return true;
    });
    const within = (a: number, b: number) => citations.filter((c) => c.sourceLine >= a && c.sourceLine <= b);
    const prov = (a: number, b: number) => ({ repo: co.repo, sha: co.sha, path: guide, lines: { start: a, end: b } });

    // findings → flashcards
    for (const f of extractFindings(lines, hs)) {
      const cites = within(f.lineStart, f.lineEnd);
      const key = stableKey('quests', co.repo, 'flashcard', [...f.headingPath, f.label]);
      const ev = f.evidence ? ` Evidence: ${f.evidence}` : '';
      let front: string;
      let back: string;
      if (f.shape === 'r-heading') {
        front = `${f.label}. ${f.title}${ev}`;
        back = f.consequence || f.body;
      } else if (f.body) {
        front = `${f.label}${f.severity ? ` (${f.severity})` : ''}: ${f.title}${ev}`;
        back = f.body;
      } else {
        // single-sentence finding: front = the evidence only, back = the finding
        front = `${f.label}${f.severity ? ` (${f.severity})` : ''}: what is wrong here?${ev || ` Evidence: ${[...new Set(cites.map((c) => c.raw))].join(', ')}`}`;
        back = f.title;
      }
      const item: SeedFlashcardItem = {
        kind: 'flashcard',
        key,
        provenance: prov(f.lineStart, f.lineEnd),
        citations: cites,
        shape: f.shape,
        label: f.label,
        ...(f.severity ? { severity: f.severity } : {}),
        front: front.trim(),
        back: back.trim(),
        observation: f.observation,
        aiTag: f.aiTag,
      };
      gc.items.push(item);
      const resolved = cites
        .filter((c) => c.path && !c.malformed)
        .map((c) => ({ c, r: resolveAt(co, guide, asCitation(c, guide)) }))
        .filter((x) => x.r.status === 'ok' && x.r.kind === 'file');
      const files = [...new Set(resolved.map((x) => (x.r.status === 'ok' ? x.r.file : '')))].sort();
      const first = resolved.find((x) => x.r.status === 'ok' && x.r.lineStart !== null);
      allFindings.push({
        finding: f,
        guide,
        key,
        citations: cites,
        files,
        primary: first && first.r.status === 'ok' ? { file: first.r.file, lineStart: first.r.lineStart!, lineEnd: first.r.lineEnd! } : null,
      });
    }

    // reading steps
    for (const s of readingSections(lines, hs)) {
      const item: SeedReadingStepItem = {
        kind: 'reading-step',
        key: stableKey('quests', co.repo, 'reading-step', [stepKeyBase.get(guide) ?? guide, ...s.headingPath]),
        provenance: prov(s.lineStart, s.lineEnd),
        citations: within(s.lineStart, s.lineEnd),
        title: s.title,
        headingPath: s.headingPath,
      };
      gc.items.push(item);
    }

    const { items: gcs, skips } = extractGoalChecks(lines, hs);
    for (const s of skips) gc.skipped.push({ subject: `${guide}:${s.line}`, reason: s.reason });
    parsed.push({ guide, gcs, cites: citations, gc });
    out.guides.push(gc);
  }

  // goal-check quizzes: distractors are the checks of OTHER exercises in the same guide
  for (const p of parsed) {
    const within = (a: number, b: number) => p.cites.filter((c) => c.sourceLine >= a && c.sourceLine <= b);
    const keyed = p.gcs.map((g) => ({ g, key: stableKey('quests', co.repo, 'quiz', ['goal-check', ...g.headingPath, g.label, g.goal]) }));
    for (const { g, key } of keyed) {
      const answer = g.checks.join(' / ');
      const pool = keyed.filter((o) => o.key !== key).map((o) => ({ text: o.g.checks.join(' / '), evidence: [o.key] }));
      if (pool.length === 0) {
        p.gc.skipped.push({ subject: `${p.guide}:${g.lineStart}`, reason: 'no-distractors (only one Goal/Check exercise in the guide)' });
        continue;
      }
      const pick = pickGoalCheckDistractors(answer, pool, key);
      if (pick.lengthTell) {
        p.gc.skipped.push({ subject: `${p.guide}:${g.lineStart}`, reason: pick.lengthTell });
        continue;
      }
      p.gc.items.push(quiz(key, 'goal-check', { repo: co.repo, sha: co.sha, path: p.guide, lines: { start: g.lineStart, end: g.lineEnd } }, within(g.lineStart, g.lineEnd), `Goal: ${g.goal}\n\nWhich check verifies this goal?`, { text: answer, evidence: [key] }, pick.distractors, goalCheckExplanation(p.guide, g)));
    }
  }

  // finding-location quizzes: distractors are other findings' primary locations in files the keyed finding never cites
  for (const fc of allFindings) {
    if (!fc.primary) continue;
    const gc = out.guides.find((g) => g.guide === fc.guide)!;
    const key = stableKey('quests', co.repo, 'quiz', ['finding-location', ...fc.finding.headingPath, fc.finding.label]);
    const loc = (p: NonNullable<FindingCtx['primary']>) => `${p.file}:${p.lineStart}${p.lineEnd !== p.lineStart ? `-${p.lineEnd}` : ''}`;
    const seen = new Set<string>([fc.primary.file]);
    const pool = allFindings.filter((o) => o.key !== fc.key && o.primary && !o.files.some((f) => fc.files.includes(f) || ex.path(co.repo, f)));
    const distractors: { text: string; evidence: string[] }[] = [];
    for (const o of hashOrder(pool, key, (x) => x.key)) {
      if (distractors.length >= MAX_DISTRACTORS) break;
      if (seen.has(o.primary!.file)) continue;
      seen.add(o.primary!.file);
      distractors.push({ text: loc(o.primary!), evidence: o.files });
    }
    if (distractors.length === 0) {
      gc.skipped.push({ subject: `${fc.guide}:${fc.finding.lineStart}`, reason: 'no-distractors (no other finding cites disjoint files)' });
      continue;
    }
    const prompt = `Which location holds this defect?\n\n${stripCitationSpans(fc.finding.title)}`;
    gc.items.push(
      quiz(key, 'finding-location', { repo: co.repo, sha: co.sha, path: fc.guide, lines: { start: fc.finding.lineStart, end: fc.finding.lineEnd } }, fc.citations, prompt, { text: loc(fc.primary), evidence: fc.files }, distractors, findingLocationExplanation(fc.guide, fc.finding)),
    );
  }
  return out;
}

function quiz(
  key: string,
  variety: SeedQuizItem['variety'],
  provenance: SeedQuizItem['provenance'],
  cites: SeedCitation[],
  prompt: string,
  answer: { text: string; evidence: string[] },
  distractors: { text: string; evidence: string[] }[],
  explanation: string,
): SeedQuizItem {
  const choices = hashOrder([answer, ...distractors], `${key}:order`, (c) => c.text);
  const answerKey = choices.indexOf(answer);
  return {
    kind: 'quiz',
    key,
    provenance,
    citations: cites,
    variety,
    prompt,
    choices,
    check: { type: 'quiz', itemKey: key, grading: 'choice', answerKey, choices: choices.map((c) => c.text) },
    explanation,
  };
}
