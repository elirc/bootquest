import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  LessonSpec,
  PROJECT_UNIT_KINDS,
  type CheckSpecInput,
  type CompetencyId,
  type SeedExplainBackItem,
  type SeedPatchKataItem,
  type SeedVariantItem,
  type TrackId,
} from '@bootquest/shared';
import { UnitContentEntry } from '@bootquest/shared/api';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { liveChecks, reconcileCheck } from './check-policy.ts';
import { insertUnit } from './content.ts';
import type { SeedItemStore } from './seed-items.ts';
import { STUDY_COMPETENCY, STUDY_QUIZ_PASS_PCT, studyQuizSpecFor } from './study-quests.ts';

/**
 * W7 ladder wiring (audit #4): the REAL competency-ladder units, derived at startup from the
 * stamped seed items (seed-items.ts) — never hand-edited rows:
 *   - one explain-back unit per explain-back item (the G2 delegation-brief rubrics go to the
 *     agentic track; the DESIGN IT system-design rubrics to the campaign-less sysdesign track,
 *     competencies system-design + communication, never linked to a campaign quest; ordinary
 *     sets to their repo's campaign track). Prerequisites (ordinary sets only) = the PROJECT
 *     units the set explains (a unit whose lesson guide ref is the set's source file, e.g.
 *     signalpost U01 after `bootquest sync`), so leg (b) links to leg (a);
 *   - one patch-kata unit per kata, all on the agentic track: the G1 "Kata bank";
 *   - one STUDY unit per seed:quests pack whose repo is NOT a campaign study quest (kata-bank
 *     style standalone reference material, e.g. ww6 — correctly absent from the campaign as a
 *     ww-crud family member): the pack's quiz gate / reading list / flashcards stay playable
 *     without inventing a quest. Key binds the gate's item keys, so a re-seeded pack retires
 *     the old unit and creates a fresh one (never a silent in-place rebind);
 *   - one retest unit per variant item (content/seed/variants): kind 'retest', variation_of the
 *     artifact unit named by the item's unitKey. A variant whose artifact unit is not in this DB
 *     yet (e.g. signalpost before its first sync) is PENDING: counted, created on a later load;
 *   - the authored agentic unit definitions (content/units/agentic.json: G3 live delegation,
 *     G4 verification engineering).
 * Campaign links (repo -> quest) are recorded for display (GET /api/ladder) and never lock a
 * ladder unit: the answer-first flows are self-contained, and acts 2+ stay locked until their
 * quiz gates are seeded.
 * Upsert by unit key, idempotent; a unit whose item left the seed packs is RETIRED (history
 * rows keep their FK target), never deleted; kind / track / check-type changes are refused; a
 * changed check spec (a re-seeded item under the same key: question count, defect count, a
 * variant's check) follows THE re-seed policy (store/check-policy.ts reconcileCheck): updated in
 * place while unreferenced, retired-and-replaced once history references it — never a refusal.
 * loaded === built is asserted per family; duplicate seed-item references across live units
 * refuse startup (audit #3).
 */

export const LADDER_SOURCE_KEY = 'ladder:seed';
export const AUTHORED_SOURCE_KEY = 'units:authored';
export const LADDER_PREFIX = 'ladder/';

export class LadderLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LadderLoadError';
  }
}

const h12 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);
const slug = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-');

const G2_PROMPT = /^G2 BRIEF\b/;
export const isG2 = (item: SeedExplainBackItem): boolean => G2_PROMPT.test(item.questions[0]?.prompt ?? '');
const DESIGN_PROMPT = /^DESIGN IT\b/;
/** a DESIGN IT system-design rubric set (G2 keeps precedence; the two prefixes cannot both match) */
export const isDesignIt = (item: SeedExplainBackItem): boolean => !isG2(item) && DESIGN_PROMPT.test(item.questions[0]?.prompt ?? '');
/** the campaign-less track the DESIGN IT sets load on; its units never carry a quest link */
export const DESIGN_TRACK = 'sysdesign' as const satisfies TrackId;

/**
 * Explain-back alternate sets (retakes): sibling sets of one question set share the seed
 * provenance (repo, path) — the grouping is DERIVED, never stored (no DB column;
 * unit.variation_of_unit_id stays reserved for retests). Each sibling is its own item, unit and
 * key, so every per-item honesty invariant applies to it unchanged. The group id is surfaced
 * only in the unit-detail API.
 */
export const ebSetGroup = (it: SeedExplainBackItem): string => h12(`${it.provenance.repo}\u0000${it.provenance.path}`);

export const explainBackUnitKey = (item: SeedExplainBackItem): string =>
  `${LADDER_PREFIX}${isG2(item) ? 'g2' : 'explain-back'}/${slug(item.provenance.repo)}/${h12(item.key)}`;
export const kataUnitKey = (item: SeedPatchKataItem): string => `${LADDER_PREFIX}kata/${slug(item.provenance.repo)}/${h12(item.key)}`;
export const retestUnitKey = (item: SeedVariantItem): string => `${LADDER_PREFIX}retest/${slug(item.provenance.repo)}/${h12(item.key)}`;
/** standalone study-pack unit: the key binds the GATE (item keys), so a re-seed = new unit */
export const studyUnitKey = (repo: string, quizItemKeys: readonly string[]): string => `${LADDER_PREFIX}study/${slug(repo)}/${h12(quizItemKeys.join('\u0000'))}`;

const KATA_DIFFICULTY: Readonly<Record<string, number>> = { easy: 1, medium: 2, hard: 3 };
const PROJECT_KINDS_SQL = PROJECT_UNIT_KINDS.map((k) => `'${k}'`).join(', ');

// ---------------------------------------------------------------- authored unit definitions

export const AuthoredUnitsFile = z
  .object({
    format: z.literal('bootquest-authored-units@1'),
    /** free-text provenance / review note (shown nowhere) */
    _note: z.string().optional(),
    units: z.array(LessonSpec).min(1),
    content: z.record(z.string().min(1), UnitContentEntry),
  })
  .strict()
  .superRefine((f, ctx) => {
    const keys = new Set<string>();
    for (const u of f.units) {
      if (keys.has(u.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate unit key ${u.key}` });
      keys.add(u.key);
      if (!(u.key in f.content)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unit ${u.key} has no content entry` });
    }
    for (const k of Object.keys(f.content)) if (!keys.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `content entry ${k} has no unit` });
  });
export type AuthoredUnitsFile = z.infer<typeof AuthoredUnitsFile>;

export function readAuthoredUnits(path: string): AuthoredUnitsFile {
  if (!existsSync(path)) throw new LadderLoadError(`authored units file ${path} not found`);
  try {
    return AuthoredUnitsFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    throw new LadderLoadError(`authored units ${path} are malformed: ${err instanceof Error ? err.message.slice(0, 400) : String(err)}`);
  }
}

// ---------------------------------------------------------------- planning (pure)

interface PlannedUnit {
  family: 'explain-back' | 'g2' | 'kata' | 'retest' | 'study';
  key: string;
  track: TrackId;
  kind: 'explain-back' | 'patch-kata' | 'retest' | 'study';
  title: string;
  difficulty: number | null;
  repo: string;
  competencies: CompetencyId[];
  check: CheckSpecInput;
  /** study only: the gate's pass threshold (mirrors the campaign study-quiz gates) */
  threshold?: number;
  /** retest only: the artifact unit key */
  variationOf?: string;
  /** explain-back only: the source file the set covers (artifact matching) */
  sourcePath?: string;
  /** explain-back only: a DESIGN IT set (sysdesign track; no artifact or quest link, like G2) */
  design?: boolean;
  /** explain-back only: the alternate-set id (absent = the primary set) */
  set?: string;
}

function baseName(p: string): string {
  return p.split('/').pop() ?? p;
}

/**
 * Display label for an explain-back unit's source file. A bare `README.md`
 * tells the learner nothing when one repo ships several README-anchored sets
 * (the javabootcamp design packs), so a README keeps its parent directory.
 */
export function unitLabel(p: string): string {
  const base = baseName(p);
  if (!/^readme\.md$/i.test(base)) return base;
  const parts = p.split('/').filter(Boolean);
  const parent = parts.length >= 2 ? parts[parts.length - 2]! : '';
  return parent ? `${parent}/${base}` : base;
}

interface CampaignLink {
  questId: number;
  questKey: string;
  track: TrackId;
  actNo: number;
  unitId: number | null;
}

function campaignLinks(db: Db): Map<string, CampaignLink> {
  const out = new Map<string, CampaignLink>();
  for (const r of db.all<{ questId: number; questKey: string; repo: string; track: TrackId; actNo: number; unitId: number | null }>(
    `SELECT q.id AS questId, q.key AS questKey, q.repo AS repo, a.track_id AS track, a.act_no AS actNo, q.unit_id AS unitId
       FROM quest q JOIN campaign_act a ON a.id = q.act_id ORDER BY a.track_id, a.act_no, q.ordinal`,
  )) {
    if (!out.has(r.repo)) out.set(r.repo, r);
  }
  return out;
}

/**
 * track for an ordinary explain-back set: its repo's campaign track; else a Java-looking repo
 * name (j<N>, *java*) -> java, a C#-looking one -> csharp, else js.
 */
function trackForRepo(repo: string, links: Map<string, CampaignLink>): TrackId {
  const l = links.get(repo);
  if (l && l.track !== 'agentic') return l.track;
  if (/^j\d+$|java(?!script)/i.test(repo)) return 'java';
  return /^(net|dotnet|csharp|cs)|-net$/.test(repo) ? 'csharp' : 'js';
}

function plan(items: SeedItemStore, links: Map<string, CampaignLink>, kataDifficulty: ReadonlyMap<string, number>, studyQuestRepos: ReadonlySet<string>): PlannedUnit[] {
  const out: PlannedUnit[] = [];
  for (const it of items.explainBackItems()) {
    const g2 = isG2(it);
    const design = isDesignIt(it);
    const title = g2 ? `G2 delegation brief: ${it.provenance.repo}` : `Explain back: ${it.provenance.repo} — ${unitLabel(it.provenance.path)}`;
    out.push({
      family: g2 ? 'g2' : 'explain-back',
      key: explainBackUnitKey(it),
      track: g2 ? 'agentic' : design ? DESIGN_TRACK : trackForRepo(it.provenance.repo, links),
      kind: 'explain-back',
      // an alternate set is titled as its primary's sibling; primary titles are unchanged
      title: it.set !== undefined ? `${title} (set ${it.set.toUpperCase()})` : title,
      difficulty: null,
      repo: it.provenance.repo,
      competencies: g2 ? ['agentic-engineering', 'communication'] : design ? ['system-design', 'communication'] : ['language-fluency'],
      check: { type: 'explain-back', questionSetKey: it.key, questionCount: it.questions.length },
      sourcePath: it.provenance.path,
      ...(design ? { design: true } : {}),
      ...(it.set !== undefined ? { set: it.set } : {}),
    });
  }
  for (const it of items.kataItems()) {
    out.push({
      family: 'kata',
      key: kataUnitKey(it),
      track: 'agentic',
      kind: 'patch-kata',
      title: `Kata: ${it.title}`,
      difficulty: kataDifficulty.get(it.key) ?? null,
      repo: it.provenance.repo,
      competencies: ['code-reading'],
      check: { type: 'patch-kata', kataKey: it.key, defectCount: it.seededDefectKey.length },
    });
  }
  // standalone study packs: a seed:quests pack (with a quiz gate) whose repo is not a campaign
  // study quest is wired as reference material here; matched packs belong to store/study-quests.ts
  for (const [repo, pack] of items.questPacks()) {
    if (studyQuestRepos.has(repo)) continue;
    const spec = studyQuizSpecFor(pack);
    if (!spec) continue; // nothing to gate on (no quiz items): stays a merely-unmatched pack
    const itemKeys = (spec as { itemKeys: string[] }).itemKeys;
    out.push({
      family: 'study',
      key: studyUnitKey(repo, itemKeys),
      track: trackForRepo(repo, links),
      kind: 'study',
      title: `Study reference: ${repo}`,
      difficulty: null,
      repo,
      competencies: [STUDY_COMPETENCY],
      check: spec,
      threshold: STUDY_QUIZ_PASS_PCT,
    });
  }
  for (const it of items.variantItems()) {
    out.push({
      family: 'retest',
      key: retestUnitKey(it),
      track: 'js', // replaced by the artifact's track at load
      kind: 'retest',
      title: `Changed-example retest: ${it.task.split('\n')[0]!.replace(/^#+\s*/, '').slice(0, 90)}`,
      difficulty: null,
      repo: it.provenance.repo,
      competencies: [], // the artifact's competencies at load
      check: it.check,
      variationOf: it.unitKey,
    });
  }
  return out;
}

/** content entries (public task; private reference solution for reveal) for retest units, by unit key. */
export function ladderContentEntries(items: SeedItemStore): Map<string, UnitContentEntry> {
  const m = new Map<string, UnitContentEntry>();
  for (const it of items.variantItems()) {
    m.set(retestUnitKey(it), { instructions: it.task, solution: it.referenceSolution });
  }
  return m;
}

/** katas-index.json difficulty labels (easy/medium/hard -> 1/2/3), if the index is present. */
export function readKataDifficulty(path: string): Map<string, number> {
  const m = new Map<string, number>();
  if (!existsSync(path)) return m;
  const idx = JSON.parse(readFileSync(path, 'utf8')) as { katas?: { key?: string; difficulty?: string }[] };
  for (const k of idx.katas ?? []) if (k.key && k.difficulty && KATA_DIFFICULTY[k.difficulty]) m.set(k.key, KATA_DIFFICULTY[k.difficulty]!);
  return m;
}

// ---------------------------------------------------------------- loading

export interface LadderFamilyStats {
  built: number;
  loaded: number;
}

export interface LadderLoadStats {
  explainBack: LadderFamilyStats & { linkedToArtifact: number; linkedToQuest: number };
  g2: LadderFamilyStats;
  katas: LadderFamilyStats & { linkedToQuest: number };
  retests: LadderFamilyStats & { pending: string[] };
  /** standalone study-pack units (quest packs matching no campaign study quest) */
  study: LadderFamilyStats;
  authored: LadderFamilyStats;
  inserted: number;
  retired: number;
}

function upsertSource(db: Db, key: string, repo: string, t: number): number {
  const row = db.get<{ id: number }>('SELECT id FROM source WHERE key = ?', key);
  if (row) return row.id;
  return db.run(
    `INSERT INTO source (key, repo, subpath, role, origin_kind, pinned_sha, local_cache_path, read_only, created_at)
     VALUES (?, ?, '', 'pack', 'local', NULL, NULL, 1, ?)`,
    key,
    repo,
    t,
  ).lastInsertRowid;
}

function unitIdByKey(db: Db, key: string): number | null {
  return db.get<{ id: number }>('SELECT id FROM unit WHERE key = ? AND retired_at IS NULL', key)?.id ?? null;
}

/** Project units whose lesson guide ref is this file in this repo (owner/name ends with /repo). */
function artifactUnitsFor(db: Db, repo: string, path: string): number[] {
  return db
    .all<{ id: number }>(
      `SELECT DISTINCT u.id AS id FROM unit u JOIN unit_ref ur ON ur.unit_id = u.id JOIN content_ref r ON r.id = ur.content_ref_id
        WHERE u.retired_at IS NULL AND u.kind IN (${PROJECT_KINDS_SQL}) AND r.path = ? AND (r.repo = ? OR r.repo LIKE ?)
        ORDER BY u.id`,
      path,
      repo,
      `%/${repo}`,
    )
    .map((r) => r.id);
}

function competenciesOf(db: Db, unitIds: readonly number[]): CompetencyId[] {
  if (unitIds.length === 0) return [];
  return db
    .all<{ c: CompetencyId }>(
      `SELECT DISTINCT competency_id AS c FROM unit_competency WHERE unit_id IN (${unitIds.map(() => '?').join(', ')}) ORDER BY competency_id`,
      ...unitIds,
    )
    .map((r) => r.c);
}

interface ExistingUnit {
  id: number;
  kind: string;
  track_id: string;
  title: string;
  difficulty: number | null;
  retired_at: number | null;
  source_id: number | null;
  variation_of_unit_id: number | null;
}

function existing(db: Db, key: string): ExistingUnit | undefined {
  return db.get<ExistingUnit>('SELECT id, kind, track_id, title, difficulty, retired_at, source_id, variation_of_unit_id FROM unit WHERE key = ?', key);
}

function sameSpec(stored: string, spec: CheckSpecInput): boolean {
  const have = JSON.parse(stored) as Record<string, unknown>;
  const want = spec as Record<string, unknown>;
  return Object.keys(want).every((k) => JSON.stringify(have[k]) === JSON.stringify(want[k]));
}

/**
 * Bring a ladder / authored unit's ONE live check in line with the planned spec under THE re-seed
 * policy (store/check-policy.ts, server review F3): unchanged -> nothing; unreferenced -> updated
 * in place; referenced by attempts / runs -> RETIRED-AND-REPLACED (history keeps the frame it was
 * graded in). A re-seed that changes a set's question count or a kata's defect count under the
 * same item key therefore boots instead of refusing startup. Still refused (a kind-level decision,
 * like the pack loader): a type change, and a unit that does not have exactly one live check.
 * "Changed" keeps this loader's historical meaning (every planned key equal), so a stored spec
 * written by an older writer with extra keys is not churned.
 */
function reconcileLadderCheck(db: Db, unitId: number, unitKey: string, want: CheckSpecInput, threshold: number | null, clock: Clock): void {
  const live = liveChecks(db, unitId);
  if (live.length !== 1) throw new LadderLoadError(`ladder unit ${unitKey} has ${live.length} live checks (want exactly 1); refusing`);
  const current = live[0]!;
  if (sameSpec(current.spec, want) && (threshold === null || current.threshold === threshold)) return;
  if (current.type !== want.type) throw new LadderLoadError(`ladder unit ${unitKey}: its check changed type (${current.type} -> ${want.type}); refusing`);
  reconcileCheck(db, unitId, current, { spec: want, threshold }, clock);
}

/** Insert or refresh one unit; returns [id, inserted]. */
function upsertUnit(db: Db, sourceId: number, u: Omit<PlannedUnit, 'family' | 'repo' | 'sourcePath' | 'design' | 'set'> & { variationOfId?: number | null; prerequisites: number[] }, clock: Clock): [number, boolean] {
  const have = existing(db, u.key);
  let id: number;
  let inserted = false;
  if (!have) {
    id = insertUnit(
      db,
      {
        key: u.key,
        track: u.track,
        kind: u.kind,
        title: u.title,
        ...(u.difficulty !== null ? { difficulty: u.difficulty } : {}),
        competencies: u.competencies,
        checks: [{ spec: u.check, ...(u.threshold !== undefined ? { threshold: u.threshold } : {}) }],
      },
      clock,
    );
    db.run('UPDATE unit SET source_id = ?, variation_of_unit_id = ? WHERE id = ?', sourceId, u.variationOfId ?? null, id);
    inserted = true;
  } else {
    id = have.id;
    if (have.source_id !== sourceId) throw new LadderLoadError(`unit key ${u.key} already belongs to another source (source_id ${String(have.source_id)})`);
    if (have.kind !== u.kind || have.track_id !== u.track) {
      throw new LadderLoadError(`ladder unit ${u.key} changed kind/track (${have.kind}/${have.track_id} -> ${u.kind}/${u.track}); refusing (attempts reference it)`);
    }
    reconcileLadderCheck(db, id, u.key, u.check, u.threshold ?? null, clock);
    if ((u.variationOfId ?? null) !== have.variation_of_unit_id && have.variation_of_unit_id !== null) {
      throw new LadderLoadError(`retest ${u.key} would move to another artifact (${have.variation_of_unit_id} -> ${String(u.variationOfId)}); refusing`);
    }
    db.run(
      'UPDATE unit SET title = ?, difficulty = ?, retired_at = NULL, variation_of_unit_id = COALESCE(variation_of_unit_id, ?) WHERE id = ?',
      u.title,
      u.difficulty,
      u.variationOfId ?? null,
      id,
    );
    // competencies are derived (artifact union): refresh
    db.run('DELETE FROM unit_competency WHERE unit_id = ?', id);
    for (const c of u.competencies) db.run('INSERT INTO unit_competency (unit_id, competency_id) VALUES (?, ?)', id, c);
  }
  db.run('DELETE FROM unit_prerequisite WHERE unit_id = ?', id);
  for (const p of u.prerequisites) db.run('INSERT INTO unit_prerequisite (unit_id, prereq_unit_id) VALUES (?, ?)', id, p);
  return [id, inserted];
}

function retireMissing(db: Db, sourceId: number, keep: ReadonlySet<string>, t: number): number {
  const stale = db
    .all<{ id: number; key: string }>('SELECT id, key FROM unit WHERE source_id = ? AND retired_at IS NULL', sourceId)
    .filter((u) => !keep.has(u.key));
  for (const u of stale) db.run('UPDATE unit SET retired_at = ? WHERE id = ?', t, u.id);
  return stale.length;
}

/**
 * Refuse two LIVE units that reference the same explain-back question set or kata (audit #3):
 * answer-before-key is per item, so a shared item would let one unit's key answer the other.
 */
export function assertUniqueSeedItemRefs(db: Db): void {
  const dups = db.all<{ ref: string; n: number; keys: string }>(
    `SELECT COALESCE(json_extract(c.spec, '$.questionSetKey'), json_extract(c.spec, '$.kataKey')) AS ref, COUNT(DISTINCT u.id) AS n,
            group_concat(u.key, ', ') AS keys
       FROM "check" c JOIN unit u ON u.id = c.unit_id
      WHERE c.type IN ('explain-back', 'patch-kata') AND u.retired_at IS NULL AND c.retired_at IS NULL
      GROUP BY ref HAVING COUNT(DISTINCT u.id) > 1`,
  );
  // study-quiz gates reference their quiz items one by one (a miss enrols the item's KEY as a review
  // card), so a quiz item shared by two live gates — e.g. a standalone study unit and a campaign
  // study quest on the same pack — would let one gate's review card answer the other
  const quizDups = db.all<{ ref: string; n: number; keys: string }>(
    `SELECT j.value AS ref, COUNT(DISTINCT u.id) AS n, group_concat(DISTINCT u.key) AS keys
       FROM "check" c JOIN unit u ON u.id = c.unit_id, json_each(c.spec, '$.itemKeys') j
      WHERE c.type = 'study-quiz' AND u.retired_at IS NULL AND c.retired_at IS NULL
      GROUP BY ref HAVING COUNT(DISTINCT u.id) > 1`,
  );
  const all = [...dups, ...quizDups];
  if (all.length) {
    throw new LadderLoadError(
      `seed item(s) referenced by more than one live unit (answer-before-key is per item): ${all.map((d) => `${d.ref} <- ${d.keys}`).join('; ')}`,
    );
  }
}

export interface LadderInputs {
  seedItems: SeedItemStore;
  /** content/units/agentic.json (or null) */
  authored: AuthoredUnitsFile | null;
  kataDifficulty?: ReadonlyMap<string, number>;
}

export function loadLadderIntoDb(db: Db, inputs: LadderInputs, clock: Clock): LadderLoadStats {
  const t = nowMs(clock);
  return db.tx(() => {
    const links = campaignLinks(db);
    const studyQuestRepos = new Set(
      db.all<{ repo: string }>(`SELECT DISTINCT repo FROM quest WHERE quest_kind = 'study-quest' AND unit_id IS NOT NULL`).map((r) => r.repo),
    );
    const planned = plan(inputs.seedItems, links, inputs.kataDifficulty ?? new Map(), studyQuestRepos);
    const sourceId = upsertSource(db, LADDER_SOURCE_KEY, 'local/content-seed', t);
    const stats: LadderLoadStats = {
      explainBack: { built: 0, loaded: 0, linkedToArtifact: 0, linkedToQuest: 0 },
      g2: { built: 0, loaded: 0 },
      katas: { built: 0, loaded: 0, linkedToQuest: 0 },
      retests: { built: 0, loaded: 0, pending: [] },
      study: { built: 0, loaded: 0 },
      authored: { built: 0, loaded: 0 },
      inserted: 0,
      retired: 0,
    };
    const keep = new Set<string>();
    // retests first resolve their artifacts; explain-backs then pick up artifact competencies
    for (const p of planned) {
      if (p.family === 'retest') {
        stats.retests.built++;
        const art = existing(db, p.variationOf!);
        const prior = existing(db, p.key);
        if (!art || art.retired_at !== null) {
          // pending until the artifact exists (e.g. after a sync); an already-created retest stays (retired below if its artifact left)
          stats.retests.pending.push(`${p.key} (artifact ${p.variationOf} not in this DB yet)`);
          continue;
        }
        if (prior && prior.variation_of_unit_id !== null && prior.variation_of_unit_id !== art.id) {
          throw new LadderLoadError(`retest ${p.key} points at unit ${prior.variation_of_unit_id}, but ${p.variationOf} is unit ${art.id}`);
        }
        const [, ins] = upsertUnit(
          db,
          sourceId,
          { ...p, track: art.track_id as TrackId, competencies: competenciesOf(db, [art.id]), variationOfId: art.id, prerequisites: [] },
          clock,
        );
        if (ins) stats.inserted++;
        keep.add(p.key);
        continue;
      }
      if (p.family === 'kata') {
        stats.katas.built++;
        if (links.has(p.repo)) stats.katas.linkedToQuest++;
        const [, ins] = upsertUnit(db, sourceId, { ...p, prerequisites: [] }, clock);
        if (ins) stats.inserted++;
        keep.add(p.key);
        continue;
      }
      if (p.family === 'study') {
        stats.study.built++;
        const [, ins] = upsertUnit(db, sourceId, { ...p, prerequisites: [] }, clock);
        if (ins) stats.inserted++;
        keep.add(p.key);
        continue;
      }
      // explain-back / g2 (a DESIGN IT set is an explain-back that, like G2, explains no project
      // artifact and links to no campaign quest: its competencies are exactly the planned ones)
      const artifacts = p.family === 'explain-back' && !p.design ? artifactUnitsFor(db, p.repo, p.sourcePath!) : [];
      if (p.family === 'g2') stats.g2.built++;
      else {
        stats.explainBack.built++;
        if (artifacts.length) stats.explainBack.linkedToArtifact++;
        if (links.has(p.repo) && !p.design) stats.explainBack.linkedToQuest++;
      }
      const comps = [...new Set<CompetencyId>([...p.competencies, ...competenciesOf(db, artifacts)])].sort();
      const [, ins] = upsertUnit(db, sourceId, { ...p, competencies: comps, prerequisites: artifacts }, clock);
      if (ins) stats.inserted++;
      keep.add(p.key);
    }
    stats.retired += retireMissing(db, sourceId, keep, t);

    // ---- authored unit definitions (G3 / G4)
    if (inputs.authored) {
      const aSource = upsertSource(db, AUTHORED_SOURCE_KEY, 'local/content-units', t);
      const aKeep = new Set<string>();
      for (const u of inputs.authored.units) {
        stats.authored.built++;
        const have = existing(db, u.key);
        if (!have) {
          const id = insertUnit(db, u, clock);
          db.run('UPDATE unit SET source_id = ? WHERE id = ?', aSource, id);
          stats.inserted++;
        } else {
          if (have.source_id !== aSource) throw new LadderLoadError(`unit key ${u.key} already belongs to another source`);
          if (have.kind !== u.kind || have.track_id !== u.track) throw new LadderLoadError(`authored unit ${u.key} changed kind/track; refusing`);
          if (u.checks.length !== 1) throw new LadderLoadError(`authored unit ${u.key} declares ${u.checks.length} checks (want exactly 1); refusing`);
          reconcileLadderCheck(db, have.id, u.key, u.checks[0]!.spec, u.checks[0]!.threshold ?? null, clock);
          db.run('UPDATE unit SET title = ?, difficulty = ?, target_level = ?, retired_at = NULL WHERE id = ?', u.title, u.difficulty ?? null, u.targetLevel ?? null, have.id);
        }
        aKeep.add(u.key);
      }
      stats.retired += retireMissing(db, aSource, aKeep, t);
      stats.authored.loaded = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM unit WHERE source_id = ? AND retired_at IS NULL', aSource)!.n;
    }

    // ---- loaded === built, per family (by key prefix, live units of the ladder source)
    const live = (prefix: string) =>
      db.get<{ n: number }>('SELECT COUNT(*) AS n FROM unit WHERE source_id = ? AND retired_at IS NULL AND substr(key, 1, ?) = ?', sourceId, prefix.length, prefix)!.n;
    stats.explainBack.loaded = live(`${LADDER_PREFIX}explain-back/`);
    stats.g2.loaded = live(`${LADDER_PREFIX}g2/`);
    stats.katas.loaded = live(`${LADDER_PREFIX}kata/`);
    stats.retests.loaded = live(`${LADDER_PREFIX}retest/`);
    stats.study.loaded = live(`${LADDER_PREFIX}study/`);
    const bad: string[] = [];
    if (stats.explainBack.loaded !== stats.explainBack.built) bad.push(`explain-back ${stats.explainBack.loaded} vs ${stats.explainBack.built}`);
    if (stats.g2.loaded !== stats.g2.built) bad.push(`g2 ${stats.g2.loaded} vs ${stats.g2.built}`);
    if (stats.katas.loaded !== stats.katas.built) bad.push(`katas ${stats.katas.loaded} vs ${stats.katas.built}`);
    if (stats.study.loaded !== stats.study.built) bad.push(`study ${stats.study.loaded} vs ${stats.study.built}`);
    if (stats.retests.loaded !== stats.retests.built - stats.retests.pending.length) {
      bad.push(`retests ${stats.retests.loaded} vs ${stats.retests.built} built - ${stats.retests.pending.length} pending`);
    }
    if (inputs.authored && stats.authored.loaded !== stats.authored.built) bad.push(`authored ${stats.authored.loaded} vs ${stats.authored.built}`);
    if (bad.length) throw new LadderLoadError(`ladder loaded !== built: ${bad.join('; ')}`);

    assertUniqueSeedItemRefs(db);
    return stats;
  });
}

// ---------------------------------------------------------------- listing (GET /api/ladder)

export interface LadderUnitRow {
  id: number;
  key: string;
  kind: string;
  family: 'explain-back' | 'g2' | 'kata' | 'retest' | 'study' | 'authored';
  trackId: string;
  title: string;
  difficulty: number | null;
  repo: string | null;
  quest: { id: number; key: string; track: string; actNo: number } | null;
  prerequisites: number[];
  variationOfUnitId: number | null;
}

const FAMILY_OF = (key: string): LadderUnitRow['family'] | null => {
  const m = /^ladder\/(explain-back|g2|kata|retest|study)\//.exec(key);
  return m ? (m[1] as LadderUnitRow['family']) : null;
};

/** Every live ladder + authored unit with its campaign link (by repo) — the Kata bank and explain-back listing. */
export function ladderUnits(db: Db): LadderUnitRow[] {
  const links = campaignLinks(db);
  const rows = db.all<{ id: number; key: string; kind: string; trackId: string; title: string; difficulty: number | null; variationOf: number | null; source: string }>(
    `SELECT u.id AS id, u.key AS key, u.kind AS kind, u.track_id AS trackId, u.title AS title, u.difficulty AS difficulty,
            u.variation_of_unit_id AS variationOf, s.key AS source
       FROM unit u JOIN source s ON s.id = u.source_id
      WHERE u.retired_at IS NULL AND s.key IN (?, ?) ORDER BY u.track_id, u.key`,
    LADDER_SOURCE_KEY,
    AUTHORED_SOURCE_KEY,
  );
  return rows.map((r) => {
    const family = FAMILY_OF(r.key) ?? 'authored';
    const repo = family === 'authored' ? null : (r.key.split('/')[2] ?? null);
    // the campaign-less design track never links to a quest, even when its repo has one
    const l = repo && r.trackId !== DESIGN_TRACK ? links.get(repo) : undefined;
    return {
      id: r.id,
      key: r.key,
      kind: r.kind,
      family,
      trackId: r.trackId,
      title: r.title,
      difficulty: r.difficulty,
      repo,
      quest: l ? { id: l.questId, key: l.questKey, track: l.track, actNo: l.actNo } : null,
      prerequisites: db.all<{ p: number }>('SELECT prereq_unit_id AS p FROM unit_prerequisite WHERE unit_id = ? ORDER BY prereq_unit_id', r.id).map((x) => x.p),
      variationOfUnitId: r.variationOf,
    };
  });
}

export const DEFAULT_AUTHORED_UNITS = (root: string): string => join(root, 'content', 'units', 'agentic.json');
