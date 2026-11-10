import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CheckSpecInput, TrackId } from '@bootquest/shared';
import type { UnitContentEntry } from '@bootquest/shared/api';
import {
  countFundamentals,
  FUND_LEVEL_DIFFICULTY,
  FUND_PASS_PCT,
  FundamentalsFile,
  FundamentalsManifest,
  fundTopicUnitKey,
  type FundFlashcard,
  type FundQuizItem,
  type FundTopic,
  type FundTrack,
} from '@bootquest/shared/fundamentals';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { liveChecks, reconcileCheck } from './check-policy.ts';
import { insertUnit } from './content.ts';

/**
 * fund wave: the Fundamentals ladder — content/fundamentals/<track>/{topics.json, manifest.json}, compiled
 * by `seed:import:fundamentals` from hand-written authoring (no upstream repo). Loaded at startup:
 *   - topics.json is read only when its bytes hash to the manifest's sha256 and it re-parses under the
 *     FundamentalsFile invariants with the manifest's counts (loaded === built); anything else refuses
 *     startup (re-run the importer);
 *   - one STUDY unit per topic (key fund/<track>/<topic>, source 'fundamentals:local'): its ONE check is
 *     study-quiz {itemKeys: the topic's quiz items, passPct 0.8}, threshold 0.8, competency
 *     language-fluency; the lesson is served as the unit's instructions (content entry, never a DB column);
 *     the topic's flashcards enrol into FSRS review on the first pass (api/study-service.ts);
 *   - the ladder ORDER is the gate: topic N's unit has topic N-1's unit as its prerequisite, so it lists as
 *     locked until that quiz gate is passed;
 *   - the drills are an ordinary code pack (content/packs/fund-<track>, stamped by seed:validate) loaded by
 *     the pack loader; they are joined to their topic by key (FundTopic.drillKeys) at read time only.
 * Upsert by unit key, idempotent, under THE re-seed policy (store/check-policy.ts): a changed gate is
 * updated in place while unreferenced, retired-and-replaced once attempts reference it. A topic that left
 * the file is RETIRED (history keeps its FK target), never deleted. kind / track changes are refused.
 */

export const FUND_SOURCE_KEY = 'fundamentals:local';
export const FUND_COMPETENCY = 'language-fluency' as const;

export class FundamentalsLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FundamentalsLoadError';
  }
}

export interface FundTopicRef {
  track: FundTrack;
  topic: FundTopic;
}

/** The loaded Fundamentals content (in memory; curriculum text never enters the DB). */
export interface FundStore {
  tracks(): readonly FundTrack[];
  /** a track's topics in ladder order (empty when the track has none) */
  topics(track: FundTrack | TrackId): readonly FundTopic[];
  quiz(key: string): FundQuizItem | undefined;
  flashcard(key: string): FundFlashcard | undefined;
  /** the topic a quiz / flashcard item belongs to */
  topicOfItem(key: string): FundTopicRef | undefined;
  /** the topic whose study unit has this key */
  topicOfUnitKey(unitKey: string): FundTopicRef | undefined;
  /** f52 C3: "More practice" unit keys of a topic (content/fundamentals/related.json), in listed order; [] when none */
  related(track: FundTrack | TrackId, topicId: string): readonly string[];
}

/** f52 C3: content/fundamentals/related.json = { "<track>": { "<topicId>": ["<existing unit key>", ...] } }. */
export type FundRelatedMap = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;

export function mapFundStore(files: readonly FundamentalsFile[], related: FundRelatedMap = new Map()): FundStore {
  const byTrack = new Map<FundTrack, FundTopic[]>();
  const quizzes = new Map<string, FundQuizItem>();
  const cards = new Map<string, FundFlashcard>();
  const ofItem = new Map<string, FundTopicRef>();
  const ofUnit = new Map<string, FundTopicRef>();
  for (const f of files) {
    if (byTrack.has(f.track)) throw new FundamentalsLoadError(`two fundamentals files for track ${f.track}`);
    byTrack.set(f.track, [...f.topics]);
    for (const topic of f.topics) {
      const ref = { track: f.track, topic };
      ofUnit.set(fundTopicUnitKey(f.track, topic.id), ref);
      for (const q of topic.quiz) {
        quizzes.set(q.key, q);
        ofItem.set(q.key, ref);
      }
      for (const c of topic.flashcards) {
        cards.set(c.key, c);
        ofItem.set(c.key, ref);
      }
    }
  }
  return {
    tracks: () => [...byTrack.keys()],
    topics: (t) => byTrack.get(t as FundTrack) ?? [],
    quiz: (k) => quizzes.get(k),
    flashcard: (k) => cards.get(k),
    topicOfItem: (k) => ofItem.get(k),
    topicOfUnitKey: (k) => ofUnit.get(k),
    related: (t, topic) => related.get(t)?.get(topic) ?? [],
  };
}

export const emptyFundStore: FundStore = mapFundStore([]);

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** Read + verify one content/fundamentals/<track>/ dir (manifest-bound bytes, schema, counts). */
export function readFundamentalsDir(dir: string): FundamentalsFile {
  const mPath = join(dir, 'manifest.json');
  const tPath = join(dir, 'topics.json');
  if (!existsSync(mPath) || !existsSync(tPath)) throw new FundamentalsLoadError(`${dir}: needs manifest.json and topics.json (run \`npm run seed:import:fundamentals\`)`);
  let manifest: FundamentalsManifest;
  try {
    manifest = FundamentalsManifest.parse(JSON.parse(readFileSync(mPath, 'utf8')));
  } catch (err) {
    throw new FundamentalsLoadError(`${mPath}: not a fundamentals manifest (${err instanceof Error ? err.message.slice(0, 300) : String(err)})`);
  }
  const bytes = readFileSync(tPath);
  const got = sha256(bytes);
  if (got !== manifest.sha256) {
    throw new FundamentalsLoadError(`${tPath}: bytes hash to ${got.slice(0, 12)}, the manifest binds ${manifest.sha256.slice(0, 12)} (edited by hand? re-run \`npm run seed:import:fundamentals -- --track ${manifest.track}\`)`);
  }
  let file: FundamentalsFile;
  try {
    file = FundamentalsFile.parse(JSON.parse(bytes.toString('utf8')));
  } catch (err) {
    throw new FundamentalsLoadError(`${tPath}: fails the fundamentals schema (${err instanceof Error ? err.message.slice(0, 400) : String(err)})`);
  }
  if (file.track !== manifest.track) throw new FundamentalsLoadError(`${tPath}: track ${file.track}, its manifest says ${manifest.track}`);
  const counts = countFundamentals(file);
  if (JSON.stringify(counts) !== JSON.stringify(manifest.counts)) {
    throw new FundamentalsLoadError(`${tPath}: loaded ${JSON.stringify(counts)} !== built ${JSON.stringify(manifest.counts)}`);
  }
  if (manifest.expected && JSON.stringify(counts) !== JSON.stringify(manifest.expected)) {
    throw new FundamentalsLoadError(`${tPath}: counts ${JSON.stringify(counts)} differ from the census ${JSON.stringify(manifest.expected)}`);
  }
  return file;
}

/**
 * The Fundamentals store of these track dirs. f52 C3: plus the "More practice" map, by default
 * `related.json` beside the track dirs (their parent dir); a missing file = no related units.
 */
export function loadFundStore(dirs: readonly string[], opts: { relatedPaths?: readonly string[]; warn?: (msg: string) => void } = {}): FundStore {
  const relatedPaths = opts.relatedPaths ?? [...new Set(dirs.map((d) => join(dirname(d), FUND_RELATED_FILE)))];
  return mapFundStore(
    dirs.map((d) => readFundamentalsDir(d)),
    readFundRelated(relatedPaths, opts.warn),
  );
}

export const FUND_RELATED_FILE = 'related.json';

const defaultWarn = (m: string): void => console.warn(`[bootquest fundamentals] ${m}`);

/**
 * f52 C3: read the "More practice" map(s). Never refuses startup: a missing file is no related units; an
 * unreadable / malformed file or entry logs a warning and is skipped. Whether each key resolves to a live
 * drill of the track is decided at read time (api/fundamentals-service.ts skips it; relatedKeyProblems
 * lists it for the startup warning).
 */
export function readFundRelated(paths: readonly string[], warn: (msg: string) => void = defaultWarn): FundRelatedMap {
  const out = new Map<string, Map<string, string[]>>();
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      warn(`${path}: not JSON, ignored (${err instanceof Error ? err.message.slice(0, 200) : String(err)})`);
      continue;
    }
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
      warn(`${path}: expected { "<track>": { "<topicId>": ["<unit key>", ...] } }, ignored`);
      continue;
    }
    for (const [track, topics] of Object.entries(doc as Record<string, unknown>)) {
      if (typeof topics !== 'object' || topics === null || Array.isArray(topics)) {
        warn(`${path}: track "${track}" is not an object, skipped`);
        continue;
      }
      const byTopic = out.get(track) ?? new Map<string, string[]>();
      out.set(track, byTopic);
      for (const [topic, keys] of Object.entries(topics as Record<string, unknown>)) {
        if (!Array.isArray(keys)) {
          warn(`${path}: ${track}/${topic} is not a list of unit keys, skipped`);
          continue;
        }
        const list = byTopic.get(topic) ?? [];
        for (const k of keys) {
          if (typeof k === 'string' && k.trim() !== '' && !list.includes(k)) list.push(k);
          else warn(`${path}: ${track}/${topic}: entry ${JSON.stringify(k)} is not a new unit key, skipped`);
        }
        byTopic.set(topic, list);
      }
    }
  }
  return out;
}

/**
 * f52 C3: the related keys that do not resolve on this DB (no live unit of that key, another track, or
 * not a drill). For the startup warning; the API skips them.
 */
export function relatedKeyProblems(db: Db, store: FundStore): string[] {
  const problems: string[] = [];
  for (const track of store.tracks()) {
    for (const topic of store.topics(track)) {
      for (const key of store.related(track, topic.id)) {
        const u = db.get<{ kind: string; track_id: string; retired_at: number | null }>('SELECT kind, track_id, retired_at FROM unit WHERE key = ?', key);
        if (!u || u.retired_at !== null) problems.push(`${track}/${topic.id}: ${key} is not a live unit`);
        else if (u.track_id !== track) problems.push(`${track}/${topic.id}: ${key} is on track ${u.track_id}`);
        else if (u.kind !== 'drill') problems.push(`${track}/${topic.id}: ${key} is a ${u.kind}, not a drill`);
      }
    }
  }
  return problems;
}

/** Every content/fundamentals/<track>/ dir holding a manifest (default for the real entrypoint). */
export function defaultFundamentalsDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'manifest.json')))
    .map((d) => join(root, d.name))
    .sort();
}

/** A topic's quiz gate. */
export function fundGateSpec(topic: FundTopic): CheckSpecInput {
  return { type: 'study-quiz', itemKeys: topic.quiz.map((q) => q.key), passPct: FUND_PASS_PCT };
}

export const fundTopicTitle = (topic: FundTopic): string => `${String(topic.order).padStart(2, '0')} · ${topic.title}`;

/** Content entries (the lesson as instructions) for every topic unit, by unit key. */
export function fundContentEntries(store: FundStore): Map<string, UnitContentEntry> {
  const m = new Map<string, UnitContentEntry>();
  for (const track of store.tracks()) {
    for (const topic of store.topics(track)) m.set(fundTopicUnitKey(track, topic.id), { instructions: topic.lesson });
  }
  return m;
}

export interface FundLoadStats {
  tracks: { track: FundTrack; topics: number; loaded: number }[];
  inserted: number;
  retired: number;
  /** topic gates retired-and-replaced (re-seeded after attempts referenced them) */
  replaced: string[];
}

function sourceId(db: Db, t: number): number {
  const row = db.get<{ id: number }>('SELECT id FROM source WHERE key = ?', FUND_SOURCE_KEY);
  if (row) return row.id;
  return db.run(
    `INSERT INTO source (key, repo, subpath, role, origin_kind, pinned_sha, local_cache_path, read_only, created_at)
     VALUES (?, ?, '', 'pack', 'local', NULL, NULL, 1, ?)`,
    FUND_SOURCE_KEY,
    'local/content-fundamentals',
    t,
  ).lastInsertRowid;
}

function sameSpec(stored: string, spec: CheckSpecInput): boolean {
  const have = JSON.parse(stored) as Record<string, unknown>;
  const want = spec as Record<string, unknown>;
  return Object.keys(want).every((k) => JSON.stringify(have[k]) === JSON.stringify(want[k]));
}

export function loadFundamentalsIntoDb(db: Db, store: FundStore, clock: Clock): FundLoadStats {
  const t = nowMs(clock);
  return db.tx(() => {
    const src = sourceId(db, t);
    const stats: FundLoadStats = { tracks: [], inserted: 0, retired: 0, replaced: [] };
    const keep = new Set<string>();
    for (const track of store.tracks()) {
      let prev: number | null = null;
      for (const topic of store.topics(track)) {
        const key = fundTopicUnitKey(track, topic.id);
        const spec = fundGateSpec(topic);
        const title = fundTopicTitle(topic);
        const difficulty = FUND_LEVEL_DIFFICULTY[topic.level];
        const have = db.get<{ id: number; kind: string; track_id: string; source_id: number | null }>('SELECT id, kind, track_id, source_id FROM unit WHERE key = ?', key);
        let id: number;
        if (!have) {
          id = insertUnit(
            db,
            { key, track, kind: 'study', title, phase: `fundamentals:${track}`, difficulty, competencies: [FUND_COMPETENCY], checks: [{ spec, threshold: FUND_PASS_PCT }] },
            clock,
          );
          db.run('UPDATE unit SET source_id = ? WHERE id = ?', src, id);
          stats.inserted++;
        } else {
          id = have.id;
          if (have.source_id !== src) throw new FundamentalsLoadError(`unit key ${key} already belongs to another source (source_id ${String(have.source_id)})`);
          if (have.kind !== 'study' || have.track_id !== track) throw new FundamentalsLoadError(`fundamentals unit ${key} changed kind/track (${have.kind}/${have.track_id}); refusing`);
          const live = liveChecks(db, id);
          if (live.length !== 1) throw new FundamentalsLoadError(`fundamentals unit ${key} has ${live.length} live checks (want exactly 1); refusing`);
          const cur = live[0]!;
          if (cur.type !== 'study-quiz') throw new FundamentalsLoadError(`fundamentals unit ${key}: its check is ${cur.type}, not study-quiz; refusing`);
          if (!sameSpec(cur.spec, spec) || cur.threshold !== FUND_PASS_PCT) {
            const r = reconcileCheck(db, id, cur, { spec, threshold: FUND_PASS_PCT }, clock);
            if (r.outcome === 'replaced') stats.replaced.push(key);
          }
          db.run('UPDATE unit SET title = ?, difficulty = ?, retired_at = NULL WHERE id = ?', title, difficulty, id);
          db.run('DELETE FROM unit_competency WHERE unit_id = ?', id);
          db.run('INSERT INTO unit_competency (unit_id, competency_id) VALUES (?, ?)', id, FUND_COMPETENCY);
        }
        // the ladder order IS the gate: topic N waits for topic N-1's quiz
        db.run('DELETE FROM unit_prerequisite WHERE unit_id = ?', id);
        if (prev !== null) db.run('INSERT INTO unit_prerequisite (unit_id, prereq_unit_id) VALUES (?, ?)', id, prev);
        prev = id;
        keep.add(key);
      }
    }
    const stale = db.all<{ id: number; key: string }>('SELECT id, key FROM unit WHERE source_id = ? AND retired_at IS NULL', src).filter((u) => !keep.has(u.key));
    for (const u of stale) db.run('UPDATE unit SET retired_at = ? WHERE id = ?', t, u.id);
    stats.retired = stale.length;

    // ---- loaded === built, per track (re-read from the DB)
    for (const track of store.tracks()) {
      const topics = store.topics(track);
      const loaded = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM unit WHERE source_id = ? AND retired_at IS NULL AND track_id = ? AND kind = 'study'`,
        src,
        track,
      )!.n;
      stats.tracks.push({ track, topics: topics.length, loaded });
    }
    const bad = stats.tracks.filter((s) => s.loaded !== s.topics);
    if (bad.length) throw new FundamentalsLoadError(`fundamentals loaded !== built: ${bad.map((s) => `${s.track} ${s.loaded} vs ${s.topics}`).join('; ')}`);
    return stats;
  });
}
