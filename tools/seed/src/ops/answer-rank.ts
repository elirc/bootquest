// rv wave (R1-01 / R2-r2, T11) seed-time LINT: the FULL length-rank spread of the keyed answer.
//
// answer-length.ts fails a pack when the key is usually the single longest or the single shortest choice. The f52
// rewrite passed that check by making the key the SECOND-longest choice instead (key rank 0/1/2/3 per Fundamentals
// track: js 31/41/19/8%, csharp 31/39/29/2%, java 28/42/26/4%), so "pick the second-longest" still beat chance and
// "never pick the shortest" was almost free. This lint looks at the whole spread. For every four-choice keyed item
// the key's RANK is the number of choices strictly longer than it (0 = longest .. 3 = shortest; trimmed length;
// items with another number of choices are not ranked). A pack / track / topic row FAILS when
//   - 'rank-over':    more than 40% of its ranked items share one rank (any rank), or
//   - 'not-shortest': the key is NOT the shortest choice in more than 90% of them (shortest under 10%),
// judged from a minimum number of ranked items: 50 for a quest repo or code pack (the quest repos hold 10-30 items
// each, too few to judge a spread), 10 for a Fundamentals track, and 8 for a Fundamentals topic (its own closed-book
// gate; 'rank-over' only: a 10-item topic may hold at most 4 keys on one rank, an 8-item topic at most 3).
// The estate's own unbiased hand-written quest quizzes sit at 29/34/21/16% (R2 round 2), inside both limits.
//
// Frozen upstream packs that exceed it are listed in a RATCHET baseline (answer-rank-baseline.json), with the same
// rules as answer-length-baseline.json: an entry passes while its share EQUALS hits/ranked, fails when the share rose,
// fails as STALE-HIGH when it fell (lower the entry), and is STALE once the row is back within the limit or gone.
// Never add entries for new content: rewrite its distractors instead.
//
// Deliberately OUTSIDE the fingerprinted factory / validate code (like answer-length.ts): it only READS JSON.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { keyedChoiceChecks, type KeyedChoices } from './answer-length.ts';

export type RankMetric = 'rank-over' | 'not-shortest';

export interface RankOptions {
  /** a row fails when MORE than this share of its ranked items sit on one rank */
  maxRankShare: number;
  /** ...or when MORE than this share are not the shortest choice (null = not judged) */
  maxNotShortest: number | null;
  /** ...with at least this many ranked items (smaller rows are reported, never failed) */
  minItems: number;
}

export const DEFAULT_PACK_RANK_OPTIONS: RankOptions = { maxRankShare: 0.4, maxNotShortest: 0.9, minItems: 50 };
export const DEFAULT_TRACK_RANK_OPTIONS: RankOptions = { maxRankShare: 0.4, maxNotShortest: 0.9, minItems: 10 };
export const DEFAULT_TOPIC_RANK_OPTIONS: RankOptions = { maxRankShare: 0.4, maxNotShortest: null, minItems: 8 };

/** PURE: the key's length rank (0 = longest .. 3 = shortest), or null when the item does not have exactly 4 choices. */
export function keyLengthRank(item: KeyedChoices): number | null {
  if (item.choices.length !== 4) return null;
  const lens = item.choices.map((c) => c.trim().length);
  const k = lens[item.key];
  if (k === undefined) return null;
  return lens.filter((n) => n > k).length;
}

export interface RankRow {
  /** 'quests/<repo>', 'packs/<source>', 'fundamentals/<track>' or 'fundamentals/<track>/<topic id>' */
  pack: string;
  /** four-choice keyed items */
  ranked: number;
  /** items per key rank, [longest, second, third, shortest] */
  ranks: [number, number, number, number];
  /** the largest rank count ('rank-over' hits) */
  top: number;
  /** items whose key is not the shortest ('not-shortest' hits) */
  notShortest: number;
  exceeds: RankMetric[];
}

export const rankHits = (row: RankRow, metric: RankMetric): number => (metric === 'rank-over' ? row.top : row.notShortest);

/** PURE: the rank row for one pack's items. */
export function rankRow(pack: string, items: readonly KeyedChoices[], options: RankOptions): RankRow {
  const ranks: [number, number, number, number] = [0, 0, 0, 0];
  for (const it of items) {
    const r = keyLengthRank(it);
    if (r !== null) ranks[r]++;
  }
  const ranked = ranks[0] + ranks[1] + ranks[2] + ranks[3];
  const top = Math.max(...ranks);
  const notShortest = ranked - ranks[3];
  const exceeds: RankMetric[] = [];
  if (ranked >= options.minItems) {
    if (top / ranked > options.maxRankShare) exceeds.push('rank-over');
    if (options.maxNotShortest !== null && notShortest / ranked > options.maxNotShortest) exceeds.push('not-shortest');
  }
  return { pack, ranked, ranks, top, notShortest, exceeds };
}

/** The seed quest packs under <seedDir>/quests (each <repo>/items.json), one row per repo. */
export function questRankRows(seedDir: string, options: RankOptions = DEFAULT_PACK_RANK_OPTIONS): RankRow[] {
  const dir = join(seedDir, 'quests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'items.json')))
    .map((e) => e.name)
    .sort()
    .map((repo) => {
      const doc = JSON.parse(readFileSync(join(dir, repo, 'items.json'), 'utf8')) as { items?: { kind?: string; check?: unknown }[] };
      return rankRow(`quests/${repo}`, (doc.items ?? []).filter((i) => i.kind === 'quiz').flatMap((i) => keyedChoiceChecks(i.check)), options);
    });
}

/** The code packs under <packsDir> (each <source>/*.json course file), one row per source. */
export function codePackRankRows(packsDir: string, options: RankOptions = DEFAULT_PACK_RANK_OPTIONS): RankRow[] {
  if (!existsSync(packsDir)) return [];
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packsDir, e.name, 'manifest.json')))
    .map((e) => e.name)
    .sort()
    .map((source) => {
      const files = readdirSync(join(packsDir, source))
        .filter((f) => f.endsWith('.json') && !['manifest.json', 'quarantine.json', 'validation.json', 'review-queue.json'].includes(f))
        .sort();
      return rankRow(`packs/${source}`, files.flatMap((f) => keyedChoiceChecks((JSON.parse(readFileSync(join(packsDir, source, f), 'utf8')) as { units?: unknown }).units ?? [])), options);
    });
}

interface FundTopicDoc {
  id?: unknown;
  quiz?: { choices?: unknown; answer?: unknown }[];
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function fundTracks(fundDir: string): { track: string; topics: FundTopicDoc[] }[] {
  if (!existsSync(fundDir)) return [];
  return readdirSync(fundDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(fundDir, e.name, 'topics.json')))
    .map((e) => e.name)
    .sort()
    .map((track) => ({ track, topics: (JSON.parse(readFileSync(join(fundDir, track, 'topics.json'), 'utf8')) as { topics?: FundTopicDoc[] }).topics ?? [] }));
}

const topicItems = (t: FundTopicDoc): KeyedChoices[] =>
  (t.quiz ?? []).flatMap((q) =>
    isStrings(q.choices) && typeof q.answer === 'number' && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length ? [{ choices: q.choices, key: q.answer }] : [],
  );

/** One row per Fundamentals track ('fundamentals/<track>'). */
export function fundamentalsRankRows(fundDir: string, options: RankOptions = DEFAULT_TRACK_RANK_OPTIONS): RankRow[] {
  return fundTracks(fundDir).map(({ track, topics }) => rankRow(`fundamentals/${track}`, topics.flatMap(topicItems), options));
}

/** One row per Fundamentals topic ('fundamentals/<track>/<topic id>'). */
export function fundamentalsTopicRankRows(fundDir: string, options: RankOptions = DEFAULT_TOPIC_RANK_OPTIONS): RankRow[] {
  return fundTracks(fundDir).flatMap(({ track, topics }) =>
    topics.map((t, i) => rankRow(`fundamentals/${track}/${typeof t.id === 'string' ? t.id : `#${i + 1}`}`, topicItems(t), options)),
  );
}

// ---------------------------------------------------------------- ratchet baseline

export const ANSWER_RANK_BASELINE_FORMAT = 'bootquest-answer-rank-baseline@1' as const;
export const DEFAULT_ANSWER_RANK_BASELINE = resolve(import.meta.dirname, 'answer-rank-baseline.json');

export interface RankBaselineEntry {
  pack: string;
  metric: RankMetric;
  /** ranked items and hits when baselined; the current share must EQUAL hits/ranked (a ratchet) */
  ranked: number;
  hits: number;
  why: string;
}

export interface RankBaseline {
  format: typeof ANSWER_RANK_BASELINE_FORMAT;
  about?: string;
  entries: RankBaselineEntry[];
}

export function readRankBaseline(path: string): RankBaseline {
  if (!existsSync(path)) return { format: ANSWER_RANK_BASELINE_FORMAT, entries: [] };
  const doc = JSON.parse(readFileSync(path, 'utf8')) as RankBaseline;
  if (doc.format !== ANSWER_RANK_BASELINE_FORMAT || !Array.isArray(doc.entries)) throw new Error(`${path}: not a ${ANSWER_RANK_BASELINE_FORMAT} file`);
  return doc;
}

export interface RankReport {
  rows: RankRow[];
  fresh: { row: RankRow; metric: RankMetric }[];
  known: { row: RankRow; metric: RankMetric }[];
  worse: string[];
  staleHigh: string[];
  stale: string[];
  duplicates: string[];
}

const share = (hits: number, n: number): number => (n ? hits / n : 0);
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** PURE: apply the baseline to the rows. */
export function rankReport(rows: readonly RankRow[], baseline: RankBaseline): RankReport {
  const byPack = new Map(rows.map((r) => [r.pack, r]));
  const listed = new Map<string, RankBaselineEntry>();
  const duplicates: string[] = [];
  for (const e of baseline.entries) {
    const id = `${e.pack}:${e.metric}`;
    if (listed.has(id)) duplicates.push(id);
    listed.set(id, e);
  }
  const fresh: RankReport['fresh'] = [];
  const known: RankReport['known'] = [];
  const worse: string[] = [];
  const staleHigh: string[] = [];
  for (const row of rows) {
    for (const metric of row.exceeds) {
      const e = listed.get(`${row.pack}:${metric}`);
      if (!e) {
        fresh.push({ row, metric });
        continue;
      }
      const hits = rankHits(row, metric);
      const now = share(hits, row.ranked);
      const was = share(e.hits, e.ranked);
      if (now > was + 1e-9) worse.push(`${row.pack} ${metric}: ${pct(now)} (${hits}/${row.ranked}) is above its baselined ${pct(was)} (${e.hits}/${e.ranked}); the baseline only shrinks`);
      else if (now < was - 1e-9) staleHigh.push(`${row.pack} ${metric}: now ${pct(now)} (${hits}/${row.ranked}), below its baselined ${pct(was)} (${e.hits}/${e.ranked}) — lower the entry to hits ${hits}, ranked ${row.ranked}`);
      else known.push({ row, metric });
    }
  }
  const stale: string[] = [];
  for (const e of baseline.entries) {
    const row = byPack.get(e.pack);
    if (!row) stale.push(`${e.pack} ${e.metric}: the pack is gone — delete the entry`);
    else if (!row.exceeds.includes(e.metric)) stale.push(`${e.pack} ${e.metric}: now within the limit (${rankHits(row, e.metric)}/${row.ranked}) — delete the entry (the baseline only shrinks)`);
  }
  return { rows: [...rows], fresh, known, worse, staleHigh, stale, duplicates };
}

export const rankFails = (r: RankReport): boolean => r.fresh.length + r.worse.length + r.staleHigh.length + r.stale.length + r.duplicates.length > 0;

const spread = (row: RankRow): string => row.ranks.map((n) => pct(share(n, row.ranked)).padStart(4)).join(' ');

/** Report lines. The Fundamentals TRACK rows are always printed (the before/after table of R1-01). */
export function formatRankReport(r: RankReport, opts: { all?: boolean } = {}): string[] {
  const fmt = (row: RankRow, tag: string) => `${tag.padEnd(10)}  ${row.pack.padEnd(46)} ${String(row.ranked).padStart(4)} ranked  rank 0/1/2/3 ${spread(row)}`;
  const lines = [
    `seed:lint:answers — key length-rank spread (fails: > ${pct(DEFAULT_PACK_RANK_OPTIONS.maxRankShare)} of a row's four-choice keys on one rank, or the key not the shortest in > ${pct(DEFAULT_PACK_RANK_OPTIONS.maxNotShortest ?? 1)}; >= ${DEFAULT_PACK_RANK_OPTIONS.minItems} ranked items per pack, >= ${DEFAULT_TRACK_RANK_OPTIONS.minItems} per Fundamentals track, >= ${DEFAULT_TOPIC_RANK_OPTIONS.minItems} per topic (rank-over only))`,
  ];
  for (const row of r.rows) {
    if (opts.all || (/^fundamentals\/[^/]+$/.test(row.pack) && !row.exceeds.length)) lines.push(fmt(row, row.exceeds.length ? 'OVER' : 'ok'));
  }
  for (const f of r.fresh) lines.push(`${fmt(f.row, 'SKEWED')}  (${f.metric}; not baselined: rewrite the distractors)`);
  for (const k of r.known) lines.push(`${fmt(k.row, 'baselined')}  (${k.metric})`);
  for (const w of r.worse) lines.push(`WORSE       answer-rank-baseline ${w}`);
  for (const h of r.staleHigh) lines.push(`STALE-HIGH  answer-rank-baseline ${h}`);
  for (const s of r.stale) lines.push(`STALE       answer-rank-baseline ${s}`);
  for (const d of r.duplicates) lines.push(`DUPLICATE   answer-rank-baseline ${d}`);
  lines.push(
    `${r.rows.length} pack(s) / track(s) / topic(s) scanned, ${r.fresh.length} new over the limit, ${r.known.length} baselined, ${r.worse.length} worse, ${r.staleHigh.length} stale-high, ${r.stale.length} stale`,
    `RESULT ${rankFails(r) ? 'SKEWED' : 'OK'}`,
  );
  return lines;
}
