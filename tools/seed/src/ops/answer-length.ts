// f52 C2 (W2.3) seed-time LINT: answer-key LENGTH bias in multiple-choice content.
//
// The server shuffles choice POSITIONS per learner (server/src/api/choice-order.ts; answer-positions.ts
// lints the authored positions), but it cannot hide LENGTH: a pack whose keyed answer is usually the single
// longest (or the single shortest) choice can be passed by picking on length. With four choices chance is
// about 25%. This lint scans every choice-graded item of the quest packs (content/seed/quests), the code
// packs (content/packs) and the Fundamentals quizzes (content/fundamentals/<track>/topics.json) and FAILS a
// pack/track when more than 40% of its keyed items have the key as the single longest choice, or more than
// 40% as the single shortest. A Fundamentals TOPIC is a closed-book gate of its own, so each topic also gets
// a row ('fundamentals/<track>/<topic id>') judged with the same 40% limit from 8 keyed items up (a topic
// with 8 items fails at 4 single-longest keys, i.e. more than 3 of 8).
//
// Packs that already exceed it are listed in a RATCHET baseline (answer-length-baseline.json): an entry
// passes while its share EQUALS the baselined hits/keyed; it FAILS when the share rose (worse), it FAILS as
// STALE-HIGH when the share fell below the entry (lower the entry to the new hits/keyed, so the gain can
// never be given back), and it is STALE (fails: delete the entry) once the pack no longer exceeds the limit
// or is gone. Never add entries for new content: rebalance its distractors instead.
//
// Deliberately OUTSIDE the fingerprinted factory / validate code (like answer-positions.ts): it only READS
// JSON and changes nothing, so it never invalidates a stamp.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface AnswerLengthOptions {
  /** a pack fails when MORE than this share of its keyed items have the key as the single longest / shortest choice */
  maxShare: number;
  /** ...and it has at least this many keyed items (smaller packs are reported, never failed) */
  minItems: number;
}

export const DEFAULT_ANSWER_LENGTH_OPTIONS: AnswerLengthOptions = { maxShare: 0.4, minItems: 10 };
/** One Fundamentals topic (its own gate): the same 40% limit, judged from 8 keyed items. */
export const DEFAULT_TOPIC_LENGTH_OPTIONS: AnswerLengthOptions = { maxShare: 0.4, minItems: 8 };

export type LengthMetric = 'longest' | 'shortest';

/** One keyed multiple-choice item: its choice texts and the stored index of the key. */
export interface KeyedChoices {
  choices: readonly string[];
  key: number;
}

export interface AnswerLengthRow {
  /** 'quests/<repo>', 'packs/<source>', 'fundamentals/<track>' or 'fundamentals/<track>/<topic id>' */
  pack: string;
  keyed: number;
  /** items whose key is the single longest choice */
  longest: number;
  /** items whose key is the single shortest choice */
  shortest: number;
  longestShare: number;
  shortestShare: number;
  /** the metrics over the limit (with >= minItems keyed items) */
  exceeds: LengthMetric[];
}

/** PURE: 'longest' / 'shortest' / null for one item (ties are neither). */
export function keyLengthClass(item: KeyedChoices): { longest: boolean; shortest: boolean } {
  const lens = item.choices.map((c) => c.trim().length);
  const k = lens[item.key];
  if (k === undefined || lens.length < 2) return { longest: false, shortest: false };
  const max = Math.max(...lens);
  const min = Math.min(...lens);
  return {
    longest: k === max && lens.filter((n) => n === max).length === 1,
    shortest: k === min && lens.filter((n) => n === min).length === 1,
  };
}

/** PURE: the row for one pack's items. */
export function answerLengthRow(pack: string, items: readonly KeyedChoices[], options: AnswerLengthOptions = DEFAULT_ANSWER_LENGTH_OPTIONS): AnswerLengthRow {
  let longest = 0;
  let shortest = 0;
  for (const it of items) {
    const c = keyLengthClass(it);
    if (c.longest) longest++;
    if (c.shortest) shortest++;
  }
  const keyed = items.length;
  const longestShare = keyed ? longest / keyed : 0;
  const shortestShare = keyed ? shortest / keyed : 0;
  const exceeds: LengthMetric[] = [];
  if (keyed >= options.minItems && longestShare > options.maxShare) exceeds.push('longest');
  if (keyed >= options.minItems && shortestShare > options.maxShare) exceeds.push('shortest');
  return { pack, keyed, longest, shortest, longestShare, shortestShare, exceeds };
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'string');

/**
 * Every choice-graded quiz check carrying its choices anywhere in a parsed document ({type:'quiz',
 * grading:'choice', answerKey, choices}), in document order; a check object is counted once.
 */
export function keyedChoiceChecks(doc: unknown): KeyedChoices[] {
  const out: KeyedChoices[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v !== 'object' || v === null) return;
    const o = v as Record<string, unknown>;
    if (o.type === 'quiz' && o.grading === 'choice' && typeof o.answerKey === 'number' && isStrings(o.choices)) {
      if (Number.isInteger(o.answerKey) && o.answerKey >= 0 && o.answerKey < o.choices.length) out.push({ choices: o.choices, key: o.answerKey });
      return;
    }
    for (const x of Object.values(o)) walk(x);
  };
  walk(doc);
  return out;
}

/** The seed quest packs under <seedDir>/quests (each <repo>/items.json), one row per repo. */
export function questLengthRows(seedDir: string, options: AnswerLengthOptions = DEFAULT_ANSWER_LENGTH_OPTIONS): AnswerLengthRow[] {
  const dir = join(seedDir, 'quests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'items.json')))
    .map((e) => e.name)
    .sort()
    .map((repo) => {
      const doc = JSON.parse(readFileSync(join(dir, repo, 'items.json'), 'utf8')) as { items?: { kind?: string; check?: unknown }[] };
      const items = (doc.items ?? []).filter((i) => i.kind === 'quiz').flatMap((i) => keyedChoiceChecks(i.check));
      return answerLengthRow(`quests/${repo}`, items, options);
    });
}

/** The code packs under <packsDir> (each <source>/*.json course file), one row per source. */
export function codePackLengthRows(packsDir: string, options: AnswerLengthOptions = DEFAULT_ANSWER_LENGTH_OPTIONS): AnswerLengthRow[] {
  if (!existsSync(packsDir)) return [];
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packsDir, e.name, 'manifest.json')))
    .map((e) => e.name)
    .sort()
    .map((source) => {
      const files = readdirSync(join(packsDir, source))
        .filter((f) => f.endsWith('.json') && !['manifest.json', 'quarantine.json', 'validation.json', 'review-queue.json'].includes(f))
        .sort();
      const items = files.flatMap((f) => keyedChoiceChecks((JSON.parse(readFileSync(join(packsDir, source, f), 'utf8')) as { units?: unknown }).units ?? []));
      return answerLengthRow(`packs/${source}`, items, options);
    });
}

interface FundTopicDoc {
  id?: unknown;
  quiz?: { choices?: unknown; answer?: unknown }[];
}

/** The Fundamentals tracks under <fundDir> (each <track>/topics.json), in name order, with their topics. */
function fundTracks(fundDir: string): { track: string; topics: FundTopicDoc[] }[] {
  if (!existsSync(fundDir)) return [];
  return readdirSync(fundDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(fundDir, e.name, 'topics.json')))
    .map((e) => e.name)
    .sort()
    .map((track) => ({ track, topics: (JSON.parse(readFileSync(join(fundDir, track, 'topics.json'), 'utf8')) as { topics?: FundTopicDoc[] }).topics ?? [] }));
}

const topicKeyed = (t: FundTopicDoc): KeyedChoices[] =>
  (t.quiz ?? []).flatMap((q) =>
    isStrings(q.choices) && typeof q.answer === 'number' && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length ? [{ choices: q.choices, key: q.answer }] : [],
  );

/** The Fundamentals quizzes under <fundDir>/<track>/topics.json ({topics:[{quiz:[{choices, answer}]}]}), one row per track. */
export function fundamentalsLengthRows(fundDir: string, options: AnswerLengthOptions = DEFAULT_ANSWER_LENGTH_OPTIONS): AnswerLengthRow[] {
  return fundTracks(fundDir).map(({ track, topics }) => answerLengthRow(`fundamentals/${track}`, topics.flatMap(topicKeyed), options));
}

/** One row per Fundamentals TOPIC ('fundamentals/<track>/<topic id>'; an id-less topic is named by its 1-based position). */
export function fundamentalsTopicLengthRows(fundDir: string, options: AnswerLengthOptions = DEFAULT_TOPIC_LENGTH_OPTIONS): AnswerLengthRow[] {
  return fundTracks(fundDir).flatMap(({ track, topics }) =>
    topics.map((t, i) => answerLengthRow(`fundamentals/${track}/${typeof t.id === 'string' ? t.id : `#${i + 1}`}`, topicKeyed(t), options)),
  );
}

// ---------------------------------------------------------------- ratchet baseline

export const ANSWER_LENGTH_BASELINE_FORMAT = 'bootquest-answer-length-baseline@1' as const;
export const DEFAULT_ANSWER_LENGTH_BASELINE = resolve(import.meta.dirname, 'answer-length-baseline.json');

export interface AnswerLengthBaselineEntry {
  pack: string;
  metric: LengthMetric;
  /** keyed items and hits when baselined: the current share must EQUAL hits/keyed (a ratchet: lower the entry when it falls) */
  keyed: number;
  hits: number;
  why: string;
}

export interface AnswerLengthBaseline {
  format: typeof ANSWER_LENGTH_BASELINE_FORMAT;
  about?: string;
  entries: AnswerLengthBaselineEntry[];
}

export function readAnswerLengthBaseline(path: string): AnswerLengthBaseline {
  if (!existsSync(path)) return { format: ANSWER_LENGTH_BASELINE_FORMAT, entries: [] };
  const doc = JSON.parse(readFileSync(path, 'utf8')) as AnswerLengthBaseline;
  if (doc.format !== ANSWER_LENGTH_BASELINE_FORMAT || !Array.isArray(doc.entries)) throw new Error(`${path}: not a ${ANSWER_LENGTH_BASELINE_FORMAT} file`);
  return doc;
}

export interface AnswerLengthReport {
  rows: AnswerLengthRow[];
  /** over the limit and not baselined */
  fresh: { row: AnswerLengthRow; metric: LengthMetric }[];
  /** baselined, still over the limit, exactly at the baselined share */
  known: { row: AnswerLengthRow; metric: LengthMetric }[];
  /** baselined but the share grew */
  worse: string[];
  /** baselined, still over the limit, but the share fell below the entry: lower the entry (ratchet) */
  staleHigh: string[];
  /** baselined but no longer over the limit, or the pack is gone: delete the entry */
  stale: string[];
  /** a pack / metric listed twice */
  duplicates: string[];
  options: AnswerLengthOptions;
}

const share = (hits: number, keyed: number): number => (keyed ? hits / keyed : 0);

/** PURE: apply the baseline to the rows. */
export function answerLengthReport(rows: readonly AnswerLengthRow[], baseline: AnswerLengthBaseline, options: AnswerLengthOptions = DEFAULT_ANSWER_LENGTH_OPTIONS): AnswerLengthReport {
  const byPack = new Map(rows.map((r) => [r.pack, r]));
  const listed = new Map<string, AnswerLengthBaselineEntry>();
  const duplicates: string[] = [];
  for (const e of baseline.entries) {
    const id = `${e.pack}:${e.metric}`;
    if (listed.has(id)) duplicates.push(id);
    listed.set(id, e);
  }
  const fresh: AnswerLengthReport['fresh'] = [];
  const known: AnswerLengthReport['known'] = [];
  const worse: string[] = [];
  const staleHigh: string[] = [];
  for (const row of rows) {
    for (const metric of row.exceeds) {
      const e = listed.get(`${row.pack}:${metric}`);
      if (!e) {
        fresh.push({ row, metric });
        continue;
      }
      const now = share(row[metric], row.keyed);
      const was = share(e.hits, e.keyed);
      if (now > was + 1e-9) {
        worse.push(`${row.pack} ${metric}: ${pct(now)} (${row[metric]}/${row.keyed}) is above its baselined ${pct(was)} (${e.hits}/${e.keyed}); the baseline only shrinks`);
      } else if (now < was - 1e-9) {
        staleHigh.push(
          `${row.pack} ${metric}: now ${pct(now)} (${row[metric]}/${row.keyed}), below its baselined ${pct(was)} (${e.hits}/${e.keyed}) — lower the entry to hits ${row[metric]}, keyed ${row.keyed} (the baseline is a ratchet)`,
        );
      } else known.push({ row, metric });
    }
  }
  const stale: string[] = [];
  for (const e of baseline.entries) {
    const row = byPack.get(e.pack);
    if (!row) stale.push(`${e.pack} ${e.metric}: the pack is gone — delete the entry`);
    else if (!row.exceeds.includes(e.metric)) {
      stale.push(`${e.pack} ${e.metric}: now ${pct(share(row[e.metric], row.keyed))} (${row[e.metric]}/${row.keyed}), within the ${pct(options.maxShare)} limit — delete the entry (the baseline only shrinks)`);
    }
  }
  return { rows: [...rows], fresh, known, worse, staleHigh, stale, duplicates, options };
}

export const answerLengthFails = (r: AnswerLengthReport): boolean =>
  r.fresh.length + r.worse.length + r.staleHigh.length + r.stale.length + r.duplicates.length > 0;

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function formatAnswerLengthReport(r: AnswerLengthReport, opts: { all?: boolean } = {}): string[] {
  const fmt = (row: AnswerLengthRow, tag: string) =>
    `${tag.padEnd(10)}  ${row.pack.padEnd(46)} ${String(row.keyed).padStart(4)} keyed  longest ${pct(row.longestShare).padStart(4)}  shortest ${pct(row.shortestShare).padStart(4)}`;
  const lines = [
    `seed:lint:answers — answer-key length bias (fails: > ${pct(r.options.maxShare)} of a pack's keyed items have the key as the single longest, or the single shortest, choice; >= ${r.options.minItems} keyed items, >= ${DEFAULT_TOPIC_LENGTH_OPTIONS.minItems} for a Fundamentals topic)`,
  ];
  if (opts.all) for (const row of r.rows) lines.push(fmt(row, row.exceeds.length ? 'OVER' : 'ok'));
  for (const f of r.fresh) lines.push(`${fmt(f.row, 'BIASED')}  (${f.metric}; not baselined: rebalance the distractors)`);
  for (const k of r.known) lines.push(`${fmt(k.row, 'baselined')}  (${k.metric})`);
  for (const w of r.worse) lines.push(`WORSE       answer-length-baseline ${w}`);
  for (const h of r.staleHigh) lines.push(`STALE-HIGH  answer-length-baseline ${h}`);
  for (const s of r.stale) lines.push(`STALE       answer-length-baseline ${s}`);
  for (const d of r.duplicates) lines.push(`DUPLICATE   answer-length-baseline ${d}`);
  lines.push(
    `${r.rows.length} pack(s) / topic(s) scanned, ${r.fresh.length} new over the limit, ${r.known.length} baselined, ${r.worse.length} worse, ${r.staleHigh.length} stale-high, ${r.stale.length} stale`,
    `RESULT ${answerLengthFails(r) ? 'BIASED' : 'OK'}`,
  );
  return lines;
}
