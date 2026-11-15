// seed:audit:explanations (rv3 PLAN §2): the measurable explanation bar for the Fundamentals tracks (quiz
// explanations, drill explanations and hints, lessons) and the sysdrills bank (drill explanations and hints).
// Read-only: it reads the committed authoring (tools/seed/authoring/fundamentals/<track>/*.json,
// tools/seed/authoring/sysdrills/*.json; the importer turns them into content/ byte-deterministically) and
// content/fundamentals/sections.json, scores every item, and changes nothing. Lives in ops/, outside the
// fingerprint walk. Rules (G = gate: `--check` exits 1 when one fails; L = listed for reading):
//   quiz   Q1 G  25..90 words
//          Q2 G  at most 70% of the explanation's distinct content words occur in the prompt + the keyed choice
//          Q3 G  names a wrong turn: a content word of a non-keyed choice that is not in the keyed choice, or a
//                misconception phrase (MISCONCEPTION_RE)
//          Q4 G  no reference to a choice by position (choices are served shuffled): "option B", "the first
//                choice", "the answer above"; "above 2^53" is a comparison and passes
//          Q5 G  does not restate the keyed answer of another item of the same gate (factory/leak.ts
//                leakMatchPrepared with the estate's EB_LEAK_JACCARD / EB_LEAK_OPTIONS)
//   drill  D1 G  explanation >= 60 prose words (fenced code blocks are not counted)
//          D2 L  names a wrong approach (CONTRAST_RE) and the test that catches it (a test name, or most of one)
//          D3 L  sentences that claim a wrong change "would fail / fails / breaks / throws": each must be proven
//                by a run (stop report); listed as the proof worklist
//          D4 G  hint 1 and hint 2 are prose: the importer's own hint-2 rule (sysdrills/import.ts hintProseCode;
//                java also refuses `->`), applied to both
//   lesson L1 G  >= 380 prose words; no `##` section under 40 prose words
//          L2 L  every gate item maps (sections.json `gate`) to a lesson heading that exists, and that section holds
//                at least half of the keyed choice's content words
//          L3 L  every `##` section has a code block, an inline code span or a number (a concrete case)
//          L4    `--node-check` only (js): each ```js block passes `node --check` (reported, not a gate)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EB_LEAK_JACCARD, EB_LEAK_OPTIONS } from '../factory/guards.ts';
import { leakMatchPrepared, prepareLeakKey, prepareLeakText } from '../factory/leak.ts';
import { hintProseCode } from '../sysdrills/import.ts';

export const AUDIT_TRACKS = ['js', 'csharp', 'java', 'sysdrills'] as const;
export type AuditTrack = (typeof AUDIT_TRACKS)[number];
export const FUND_AUDIT_TRACKS = ['js', 'csharp', 'java'] as const;

export const Q_MIN_WORDS = 25;
export const Q_MAX_WORDS = 90;
export const Q_MAX_RESTATE = 0.7;
export const D_MIN_WORDS = 60;
export const L_MIN_WORDS = 380;
export const L_MIN_SECTION_WORDS = 40;
export const L2_MIN_SHARE = 0.5;

export type GateRule = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'D1' | 'D4' | 'L1';
export type ListRule = 'D2' | 'D3' | 'L2' | 'L3';

// ---------------------------------------------------------------- words

const STOP = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by
can cannot could did do does doing done down during each either else even ever every few for from further get gets got had
has have having he her here hers him his how however i if in into is it its itself just let lets like may me might more most
much must my no nor not now of off on once one only or other our ours out over own per rather same she should since so some
still such than that the their theirs them then there these they this those through thus to too under until up upon us use
used uses using very via was way we were what when where whether which while who whom whose why will with within without
would yet you your yours instead otherwise because already always never back another`
    .split(/\s+/)
    .filter(Boolean),
);

/** a crude, consistent stemmer: plurals, -ed, -ing (only for words long enough to keep a stem) */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ied')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es') && /(?:ss|sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** distinct content words (lower-cased, stop words and 1-letter words dropped, stemmed); digits are kept */
export function contentWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().replace(/['’]s\b/g, '').match(/[a-z0-9_$]+/g) ?? []) {
    if (STOP.has(raw)) continue;
    if (raw.length < 2 && !/\d/.test(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** fenced code blocks removed (``` ... ```) */
export const stripFences = (s: string): string => s.replace(/```[\s\S]*?(?:```|$)/g, ' ');
/** prose words: whitespace tokens with at least one letter or digit, outside fenced code */
export const proseWords = (s: string): number => stripFences(s).split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t)).length;

// ---------------------------------------------------------------- quiz rules

/** a misconception named in words (Q3's second way to pass) */
export const MISCONCEPTION_RE = /\b(?:instead of|rather than|mistake|misconception|trap|tempting|wrongly|contrary to|a common (?:belief|guess|reading|assumption)|it is easy to (?:think|assume|expect))\b/i;
/** a choice referred to by position (Q4) */
export const POSITION_RES: readonly RegExp[] = [
  /\b(?:option|choice)\s+\(?[A-Ea-e1-5]\)?(?![\w'’-])/,
  /\b(?:first|second|third|fourth|fifth|last|final|top|bottom)\s+(?:two\s+|three\s+)?(?:options?|choices?|answers?)\b/i,
  /\b(?:see|as|shown|listed|stated|mentioned|given|options?|choices?|answers?|ones?)\s+(?:above|below)\b/i,
  /\b(?:above|below)\s+(?:options?|choices?|answers?)\b/i,
  /\bthe\s+(?:above|below)\b/i,
];

export interface QuizInput {
  id: string;
  prompt: string;
  choices: readonly string[];
  answer: number;
  explanation: string;
}

export interface QuizAudit {
  id: string;
  track: AuditTrack;
  topic: string;
  words: number;
  /** share of the explanation's content words found in prompt + keyed choice */
  restate: number;
  /** the distractor words the explanation names (Q3) */
  distractorWords: string[];
  fails: GateRule[];
  /** human-readable reason per failing rule */
  why: Partial<Record<GateRule, string>>;
}

export function auditQuiz(track: AuditTrack, topic: string, q: QuizInput, gate: readonly QuizInput[]): QuizAudit {
  const why: QuizAudit['why'] = {};
  const words = proseWords(q.explanation);
  if (words < Q_MIN_WORDS || words > Q_MAX_WORDS) why.Q1 = `${words} words (want ${Q_MIN_WORDS}..${Q_MAX_WORDS})`;
  const keyed = q.choices[q.answer] ?? '';
  const ew = contentWords(q.explanation);
  const pk = contentWords(`${q.prompt} ${keyed}`);
  let shared = 0;
  for (const w of ew) if (pk.has(w)) shared++;
  const restate = ew.size ? shared / ew.size : 1;
  if (restate > Q_MAX_RESTATE) why.Q2 = `${Math.round(restate * 100)}% of its content words are in the prompt + keyed choice (max ${Q_MAX_RESTATE * 100}%)`;
  const kw = contentWords(keyed);
  const distractor = new Set<string>();
  q.choices.forEach((c, i) => {
    if (i === q.answer) return;
    for (const w of contentWords(c)) if (!kw.has(w)) distractor.add(w);
  });
  const named = [...distractor].filter((w) => ew.has(w)).sort();
  if (!named.length && !MISCONCEPTION_RE.test(q.explanation)) why.Q3 = 'names no distractor word and no misconception';
  const pos = POSITION_RES.map((re) => re.exec(q.explanation)).find(Boolean);
  if (pos) why.Q4 = `refers to a choice by position: "${pos[0]}"`;
  const text = prepareLeakText(q.explanation);
  for (const o of gate) {
    if (o.id === q.id) continue;
    const ans = o.choices[o.answer];
    if (!ans) continue;
    const m = leakMatchPrepared(text, prepareLeakKey(ans), EB_LEAK_JACCARD, EB_LEAK_OPTIONS);
    if (m) {
      why.Q5 = `${m.kind === 'contains' ? 'contains' : `overlaps (${m.score.toFixed(2)})`} the keyed answer of ${o.id}: "${ans.slice(0, 80)}"`;
      break;
    }
  }
  return { id: q.id, track, topic, words, restate: Math.round(restate * 1000) / 1000, distractorWords: named, fails: (Object.keys(why) as GateRule[]).sort(), why };
}

// ---------------------------------------------------------------- drill rules

/** a wrong approach named in words (D2) */
export const CONTRAST_RE = /\b(?:instead of|rather than|not)\b|n['’]t\b/i;
/** a claim that a change makes a test fail (D3) */
export const CLAIM_RE = /\b(?:fail|fails|failing|break|breaks|throw|throws)\b/i;
/** ... about a test: D3 lists only claim sentences that also say "test" */
export const CLAIM_TEST_RE = /\btests?\b/i;

export interface DrillInput {
  id: string;
  explanation: string;
  hints: readonly string[];
  testNames: readonly string[];
}

export interface DrillAudit {
  id: string;
  track: AuditTrack;
  topic: string;
  words: number;
  fails: GateRule[];
  why: Partial<Record<GateRule, string>>;
  /** D2 sub-flags: no test named / no wrong approach named */
  listed: ListRule[];
  d2: { namesTest: boolean; namesWrongApproach: boolean };
  /** D3 worklist: the claim sentences */
  claims: string[];
}

export const sentences = (s: string): string[] =>
  stripFences(s)
    // a sentence ends at . ! ? before a capital, quote, backtick or bracket (so `??` or `a.b c` inside prose does not split)
    .split(/(?<=[.!?])\s+(?=[A-Z`"'(*[])|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** the explanation names a test: its name verbatim, or at least 60% of one name's content words (and the word "test") */
export function namesATest(explanation: string, names: readonly string[]): boolean {
  const low = explanation.toLowerCase().replace(/\s+/g, ' ');
  if (names.some((n) => n.trim() && low.includes(n.toLowerCase().replace(/\s+/g, ' ').trim()))) return true;
  if (!/\btests?\b/i.test(explanation)) return false;
  const ew = contentWords(explanation);
  return names.some((n) => {
    const nw = [...contentWords(n)];
    return nw.length >= 2 && nw.filter((w) => ew.has(w)).length / nw.length >= 0.6;
  });
}

export function hintCode(track: AuditTrack, hint: string): string | null {
  const c = hintProseCode(hint);
  if (c) return c;
  return track === 'java' && hint.includes('->') ? 'contains "->"' : null;
}

export function auditDrill(track: AuditTrack, topic: string, d: DrillInput): DrillAudit {
  const why: DrillAudit['why'] = {};
  const words = proseWords(d.explanation);
  if (words < D_MIN_WORDS) why.D1 = `${words} prose words (min ${D_MIN_WORDS})`;
  const bad = d.hints
    .slice(0, 2)
    .map((h, i) => [i + 1, hintCode(track, h)] as const)
    .filter(([, c]) => c !== null);
  if (d.hints.length < 3) why.D4 = `${d.hints.length} hints (want 3)`;
  else if (bad.length) why.D4 = bad.map(([i, c]) => `hint ${i} ${c}`).join('; ');
  const namesTest = namesATest(d.explanation, d.testNames);
  const namesWrongApproach = CONTRAST_RE.test(stripFences(d.explanation));
  const listed: ListRule[] = [];
  if (!namesTest || !namesWrongApproach) listed.push('D2');
  const claims = sentences(d.explanation).filter((s) => CLAIM_RE.test(s) && CLAIM_TEST_RE.test(s));
  if (claims.length) listed.push('D3');
  return { id: d.id, track, topic, words, fails: (Object.keys(why) as GateRule[]).sort(), why, listed, d2: { namesTest, namesWrongApproach }, claims };
}

/** test names of a drill per track (js / sysdrills: tests[].name; csharp: Test("..."); java: test("...")) */
export function drillTestNames(track: AuditTrack, raw: any): string[] {
  if (Array.isArray(raw?.tests)) return raw.tests.map((t: { name?: string }) => String(t.name ?? ''));
  const code = String(track === 'csharp' ? (raw?.tests ?? '') : (raw?.solution ?? ''));
  return [...code.matchAll(/\b[Tt]est\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
}

// ---------------------------------------------------------------- lesson rules

export interface LessonSection {
  heading: string;
  body: string;
  words: number;
}

/** `##` sections of a lesson (### stays inside its section); text before the first `##` is not a section */
export function lessonSections(lesson: string): LessonSection[] {
  const out: LessonSection[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  let fence = false;
  for (const line of lesson.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m && !line.startsWith('###')) {
      if (cur) out.push({ heading: cur.heading, body: cur.lines.join('\n'), words: proseWords(cur.lines.join('\n')) });
      cur = { heading: m[1]!, lines: [] };
    } else cur?.lines.push(line);
  }
  if (cur) out.push({ heading: cur.heading, body: cur.lines.join('\n'), words: proseWords(cur.lines.join('\n')) });
  return out;
}

export interface LessonAudit {
  id: string;
  track: AuditTrack;
  words: number;
  sections: number;
  fails: GateRule[];
  why: Partial<Record<GateRule, string>>;
  listed: ListRule[];
  /** L2: gate items whose mapped heading is missing, or whose section lacks the keyed choice's words */
  l2: Array<{ item: string; heading: string | null; share: number | null }>;
  /** L3: headings of sections with no code and no number */
  l3: string[];
}

export function auditLesson(track: AuditTrack, topic: string, lesson: string, quiz: readonly QuizInput[], gateMap: Readonly<Record<string, string>> | undefined): LessonAudit {
  const why: LessonAudit['why'] = {};
  const words = proseWords(lesson);
  const secs = lessonSections(lesson);
  const short = secs.filter((s) => s.words < L_MIN_SECTION_WORDS);
  const l1: string[] = [];
  if (words < L_MIN_WORDS) l1.push(`${words} prose words (min ${L_MIN_WORDS})`);
  if (short.length) l1.push(`short section(s): ${short.map((s) => `"${s.heading}" ${s.words}`).join(', ')}`);
  if (l1.length) why.L1 = l1.join('; ');
  const byHeading = new Map(secs.map((s) => [s.heading.trim(), s]));
  const l2: LessonAudit['l2'] = [];
  quiz.forEach((q, i) => {
    const heading = gateMap?.[String(i + 1)] ?? null;
    const sec = heading === null ? undefined : byHeading.get(heading.trim());
    if (!sec) {
      l2.push({ item: q.id, heading, share: null });
      return;
    }
    const kw = [...contentWords(q.choices[q.answer] ?? '')];
    if (!kw.length) return;
    const sw = contentWords(sec.body);
    const share = kw.filter((w) => sw.has(w)).length / kw.length;
    if (share < L2_MIN_SHARE) l2.push({ item: q.id, heading, share: Math.round(share * 100) / 100 });
  });
  const l3 = secs.filter((s) => !/```|`[^`\n]+`|\d/.test(s.body)).map((s) => s.heading);
  const listed: ListRule[] = [];
  if (l2.length) listed.push('L2');
  if (l3.length) listed.push('L3');
  return { id: `fund/${track}/${topic}`, track, words, sections: secs.length, fails: (Object.keys(why) as GateRule[]).sort(), why, listed, l2, l3 };
}

/** ```js / ```javascript / ```mjs blocks of a lesson (L4 input) */
export const jsBlocks = (lesson: string): string[] => [...lesson.matchAll(/```(?:js|javascript|mjs)\s*\n([\s\S]*?)```/g)].map((m) => m[1]!);

// ---------------------------------------------------------------- the audit

export interface TrackSummary {
  track: AuditTrack;
  quiz: { items: number; pass: number; fail: Partial<Record<GateRule, number>> };
  drills: { items: number; pass: number; fail: Partial<Record<GateRule, number>>; listed: Partial<Record<ListRule, number>>; claims: number };
  lessons: { items: number; pass: number; fail: Partial<Record<GateRule, number>>; listed: Partial<Record<ListRule, number>> };
}

export interface ExplainAudit {
  format: 'bootquest-explain-audit@1';
  tracks: AuditTrack[];
  quiz: QuizAudit[];
  drills: DrillAudit[];
  lessons: LessonAudit[];
  summary: TrackSummary[];
}

export interface AuditPaths {
  /** tools/seed/authoring/fundamentals */
  fundamentalsAuthoring: string;
  /** tools/seed/authoring/sysdrills */
  sysdrillsAuthoring: string;
  /** content/fundamentals/sections.json (may be absent) */
  sectionsFile: string;
}

const rd = (f: string): any => JSON.parse(readFileSync(f, 'utf8'));
const jsonFiles = (d: string): string[] => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).sort() : []);

const tally = <R extends string>(rows: Array<{ fails?: readonly string[]; listed?: readonly string[] }>, field: 'fails' | 'listed'): Partial<Record<R, number>> => {
  const out: Partial<Record<R, number>> = {};
  for (const r of rows) for (const x of (r[field] ?? []) as R[]) out[x] = (out[x] ?? 0) + 1;
  return out;
};

export function runAudit(paths: AuditPaths, tracks: readonly AuditTrack[] = AUDIT_TRACKS): ExplainAudit {
  const quiz: QuizAudit[] = [];
  const drills: DrillAudit[] = [];
  const lessons: LessonAudit[] = [];
  const sections = existsSync(paths.sectionsFile) ? rd(paths.sectionsFile) : {};
  for (const track of tracks) {
    if (track === 'sysdrills') {
      for (const f of jsonFiles(paths.sysdrillsAuthoring)) {
        const m = rd(join(paths.sysdrillsAuthoring, f));
        for (const ex of m.exercises ?? [])
          drills.push(auditDrill(track, m.module, { id: `sysdrills/${m.module}/${ex.slug}`, explanation: String(ex.explanation ?? ''), hints: ex.hints ?? [], testNames: drillTestNames(track, ex) }));
      }
      continue;
    }
    const dir = join(paths.fundamentalsAuthoring, track);
    for (const f of jsonFiles(dir)) {
      const t = rd(join(dir, f));
      const topic = String(t.topic);
      const items: QuizInput[] = (t.quiz ?? []).map((q: any, i: number) => ({ id: `fund:${track}/${topic}/q${String(i + 1).padStart(2, '0')}`, prompt: q.prompt, choices: q.choices, answer: q.answer, explanation: q.explanation }));
      for (const q of items) quiz.push(auditQuiz(track, topic, q, items));
      for (const d of t.drills ?? [])
        drills.push(auditDrill(track, topic, { id: `fund-${track}/${topic}/${d.slug}`, explanation: String(d.explanation ?? ''), hints: d.hints ?? [], testNames: drillTestNames(track, d) }));
      lessons.push(auditLesson(track, topic, String(t.lesson ?? ''), items, sections?.[track]?.[topic]?.gate));
    }
  }
  const summary: TrackSummary[] = tracks.map((track) => {
    const q = quiz.filter((x) => x.track === track);
    const d = drills.filter((x) => x.track === track);
    const l = lessons.filter((x) => x.track === track);
    return {
      track,
      quiz: { items: q.length, pass: q.filter((x) => !x.fails.length).length, fail: tally<GateRule>(q, 'fails') },
      drills: { items: d.length, pass: d.filter((x) => !x.fails.length).length, fail: tally<GateRule>(d, 'fails'), listed: tally<ListRule>(d, 'listed'), claims: d.reduce((n, x) => n + x.claims.length, 0) },
      lessons: { items: l.length, pass: l.filter((x) => !x.fails.length).length, fail: tally<GateRule>(l, 'fails'), listed: tally<ListRule>(l, 'listed') },
    };
  });
  return { format: 'bootquest-explain-audit@1', tracks: [...tracks], quiz, drills, lessons, summary };
}

export const auditGateFailures = (a: ExplainAudit): number => a.quiz.filter((x) => x.fails.length).length + a.drills.filter((x) => x.fails.length).length + a.lessons.filter((x) => x.fails.length).length;

const pct = (pass: number, n: number): string => (n ? `${pass}/${n} (${Math.round((pass / n) * 100)}%)` : '-');
const rules = (r: Partial<Record<string, number>>): string =>
  Object.entries(r)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || '-';

/** The summary table (markdown), one row per track and item family. */
export function formatAuditSummary(a: ExplainAudit): string[] {
  const out = ['| track | family | pass (all gate rules) | gate failures by rule | listed for reading |', '|---|---|---|---|---|'];
  for (const s of a.summary) {
    if (s.quiz.items) out.push(`| ${s.track} | quiz | ${pct(s.quiz.pass, s.quiz.items)} | ${rules(s.quiz.fail)} | - |`);
    if (s.drills.items) out.push(`| ${s.track} | drills | ${pct(s.drills.pass, s.drills.items)} | ${rules(s.drills.fail)} | ${rules(s.drills.listed)}; D3 claim sentences ${s.drills.claims} |`);
    if (s.lessons.items) out.push(`| ${s.track} | lessons | ${pct(s.lessons.pass, s.lessons.items)} | ${rules(s.lessons.fail)} | ${rules(s.lessons.listed)} |`);
  }
  return out;
}

/** One line per failing (or, with `listed`, listed) item. */
export function formatAuditItems(a: ExplainAudit, opts: { rule?: string; listed?: boolean } = {}): string[] {
  const out: string[] = [];
  const want = (fails: readonly string[]): boolean => (opts.rule ? fails.includes(opts.rule) : fails.length > 0);
  for (const x of [...a.quiz, ...a.drills, ...a.lessons]) {
    if (want(x.fails)) out.push(`FAIL ${x.id}: ${x.fails.map((r) => `${r} ${x.why[r] ?? ''}`.trim()).join(' | ')}`);
  }
  if (opts.listed) {
    for (const d of a.drills) {
      if (opts.rule && !d.listed.includes(opts.rule as ListRule)) continue;
      if (d.listed.includes('D2')) out.push(`LIST D2 ${d.id}: ${d.d2.namesTest ? '' : 'no test named; '}${d.d2.namesWrongApproach ? '' : 'no wrong approach named'}`.replace(/; $/, ''));
      for (const c of d.claims) out.push(`LIST D3 ${d.id}: ${c}`);
    }
    for (const l of a.lessons) {
      if (opts.rule && !l.listed.includes(opts.rule as ListRule)) continue;
      for (const x of l.l2) out.push(`LIST L2 ${x.item}: ${x.heading === null ? 'no gate heading in sections.json' : x.share === null ? `heading "${x.heading}" is not a lesson section` : `section "${x.heading}" holds ${Math.round(x.share * 100)}% of the keyed choice's words`}`);
      for (const h of l.l3) out.push(`LIST L3 ${l.id}: section "${h}" has no code and no number`);
    }
  }
  return out;
}
