import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  SeedExplainBackItem,
  SeedFlashcardItem,
  SeedPatchKataItem,
  SeedQuizItem,
  SeedReadingStepItem,
  SeedVariantItem,
  type SeedExplainBackItem as ExplainBackItem,
  type SeedFlashcardItem as FlashcardItem,
  type SeedQuizItem as QuizItem,
  type SeedReadingStepItem as ReadingStepItem,
  type SeedPatchKataItem as PatchKataItem,
  type SeedVariantItem as VariantItem,
} from '@bootquest/shared';
// the ONE seed-pack verifier (seed:check uses it too); a runtime import only — tools/seed
// depends on the server package, never the other way round at the package level
import { loadSeedPack } from '../../../tools/seed/src/factory/pack.ts';

/**
 * W6: the seed items the explain-back and patch-kata players are built from
 * (W5a seed packs: content/seed/explainback/<name>/, content/seed/patches/<name>/ and,
 * since W7, content/seed/variants/<name>/ (changed-example retests);
 * format bootquest-seed-pack@1). Check specs reference them by item key
 * (explain-back `questionSetKey`, patch-kata `kataKey`).
 *
 * Seed content NEVER enters the DB (curriculum text is never a column): it is
 * held in memory and split server-side into a PUBLIC half (questions; diff +
 * context) and a PRIVATE half (key points; seeded-defect key) that only the
 * answer-first endpoints release.
 *
 * A pack is loaded only when its validation.json stamp binds the exact
 * items.json bytes (the generator's deterministic validator passed on them).
 */
export interface SeedItemStore {
  explainBack(key: string): ExplainBackItem | undefined;
  kata(key: string): PatchKataItem | undefined;
  size(): number;
  /** W7: every loaded item of a kind, in load order (the ladder loader builds units from these) */
  explainBackItems(): readonly ExplainBackItem[];
  kataItems(): readonly PatchKataItem[];
  variantItems(): readonly VariantItem[];
  /** W8: seed:quests items (quiz gate, flashcards, reading steps), grouped by source repo, pack order */
  questPacks(): ReadonlyMap<string, QuestPackItems>;
  quiz(key: string): QuizItem | undefined;
  flashcard(key: string): FlashcardItem | undefined;
}

/** W8: one repo's seed:quests content (the study-quest unit is derived from it, store/study-quests.ts). */
export interface QuestPackItems {
  repo: string;
  /** the pinned sha the pack was generated at (every item's provenance.sha) */
  sha: string;
  quizzes: readonly QuizItem[];
  flashcards: readonly FlashcardItem[];
  readingSteps: readonly ReadingStepItem[];
}

export const emptySeedItemStore: SeedItemStore = {
  explainBack: () => undefined,
  kata: () => undefined,
  size: () => 0,
  explainBackItems: () => [],
  kataItems: () => [],
  variantItems: () => [],
  questPacks: () => new Map(),
  quiz: () => undefined,
  flashcard: () => undefined,
};

export class SeedItemLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedItemLoadError';
  }
}

/** Store over in-memory items (tests / the promotion demo); every item is schema-validated. */
export function mapSeedItemStore(items: readonly unknown[]): SeedItemStore {
  const eb = new Map<string, ExplainBackItem>();
  const kata = new Map<string, PatchKataItem>();
  const variants = new Map<string, VariantItem>();
  const quizzes = new Map<string, QuizItem>();
  const flashcards = new Map<string, FlashcardItem>();
  const quests = new Map<string, { repo: string; sha: string; quizzes: QuizItem[]; flashcards: FlashcardItem[]; readingSteps: ReadingStepItem[] }>();
  const packOf = (repo: string, sha: string) => {
    let p = quests.get(repo);
    if (!p) {
      p = { repo, sha, quizzes: [], flashcards: [], readingSteps: [] };
      quests.set(repo, p);
    }
    if (p.sha !== sha) throw new SeedItemLoadError(`seed:quests items for ${repo} come from two shas (${p.sha.slice(0, 12)} and ${sha.slice(0, 12)}); one pack per repo`);
    return p;
  };
  const seen = new Set<string>();
  const once = (key: string, kind: string) => {
    if (seen.has(key)) throw new SeedItemLoadError(`duplicate ${kind} item ${key}`);
    seen.add(key);
  };
  for (const raw of items) {
    const kind = (raw as { kind?: unknown })?.kind;
    if (kind === 'explain-back') {
      const it = SeedExplainBackItem.parse(raw);
      if (eb.has(it.key)) throw new SeedItemLoadError(`duplicate explain-back item ${it.key}`);
      eb.set(it.key, it);
    } else if (kind === 'patch-kata') {
      const it = SeedPatchKataItem.parse(raw);
      if (kata.has(it.key)) throw new SeedItemLoadError(`duplicate patch-kata item ${it.key}`);
      kata.set(it.key, it);
    } else if (kind === 'variant') {
      const it = SeedVariantItem.parse(raw);
      if (variants.has(it.key)) throw new SeedItemLoadError(`duplicate variant item ${it.key}`);
      variants.set(it.key, it);
    } else if (kind === 'quiz') {
      const it = SeedQuizItem.parse(raw);
      once(it.key, 'quiz');
      quizzes.set(it.key, it);
      packOf(it.provenance.repo, it.provenance.sha).quizzes.push(it);
    } else if (kind === 'flashcard') {
      const it = SeedFlashcardItem.parse(raw);
      once(it.key, 'flashcard');
      flashcards.set(it.key, it);
      packOf(it.provenance.repo, it.provenance.sha).flashcards.push(it);
    } else if (kind === 'reading-step') {
      const it = SeedReadingStepItem.parse(raw);
      once(it.key, 'reading-step');
      packOf(it.provenance.repo, it.provenance.sha).readingSteps.push(it);
    }
  }
  return {
    explainBack: (k) => eb.get(k),
    kata: (k) => kata.get(k),
    size: () => eb.size + kata.size + variants.size + seen.size,
    explainBackItems: () => [...eb.values()],
    kataItems: () => [...kata.values()],
    variantItems: () => [...variants.values()],
    questPacks: () => quests,
    quiz: (k) => quizzes.get(k),
    flashcard: (k) => flashcards.get(k),
  };
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Canonical JSON (sorted keys) — the content hash an answer is bound to (audit #8). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * W7 (audit #8): the content hash of one seed item. An answer attempt stores the hash of the
 * item it was answered against; key / self-score refuse (409 CONTENT_CHANGED) once the loaded
 * item differs, so a re-seed can never silently re-label key-point / defect ids (which are
 * positional) or rewrite past G1 totals.
 */
export function seedItemHash(item: ExplainBackItem | PatchKataItem): string {
  return sha256(canonical(item));
}

/**
 * Read ONE stamped seed pack dir with the FULL stamp verification (audit #7) — the same
 * verifier seed:check uses (tools/seed/src/factory/pack.ts loadSeedPack, requireStamp):
 * manifest + items bytes, schema, loaded === built per-kind counts, quarantine and review
 * keys bound to the stamp, and the CURRENT seed fingerprint (validator / generator /
 * registry / toolchain). Any mismatch refuses startup; `npm run seed:check -- --restamp`
 * re-validates every item and re-stamps when only the fingerprint went stale.
 */
export function readSeedPackItems(dir: string): unknown[] {
  if (!existsSync(join(dir, 'items.json'))) throw new SeedItemLoadError(`${dir}: no items.json`);
  if (!existsSync(join(dir, 'validation.json'))) {
    throw new SeedItemLoadError(`${dir}: no validation.json stamp (run the seed generator's validator to completion)`);
  }
  try {
    return loadSeedPack(dir, { requireStamp: true }).items;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SeedItemLoadError(`${msg}${/fingerprint/.test(msg) ? ' — run `npm run seed:check -- --restamp` (re-validates every item first)' : ''}`);
  }
}

/**
 * Every content/seed/{explainback,patches,variants,quests}/<name>/ dir holding items.json
 * (default for the real entrypoint). W8: seed:quests packs feed the study-quest units.
 */
export function defaultSeedItemDirs(root: string): string[] {
  const out: string[] = [];
  for (const gen of ['explainback', 'patches', 'variants', 'quests']) {
    const base = join(root, gen);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(base, d.name, 'items.json'))) out.push(join(base, d.name));
    }
  }
  return out.sort();
}

export function loadSeedItemStore(dirs: readonly string[]): SeedItemStore {
  return mapSeedItemStore(dirs.flatMap((d) => readSeedPackItems(d)));
}

export interface SeedPackStat {
  dir: string;
  /** "<generator>/<name>" from the dir layout */
  source: string;
  items: number;
  byKind: Record<string, number>;
}

/** loadSeedItemStore + one stat row per pack (the startup summary prints these; loaded === built is asserted inside). */
export function loadSeedItemStoreWithStats(dirs: readonly string[]): { store: SeedItemStore; packs: SeedPackStat[] } {
  const packs: SeedPackStat[] = [];
  const all: unknown[] = [];
  for (const d of dirs) {
    const items = readSeedPackItems(d);
    const byKind: Record<string, number> = {};
    for (const it of items) {
      const k = String((it as { kind?: unknown }).kind);
      byKind[k] = (byKind[k] ?? 0) + 1;
    }
    const parts = d.split(/[\\/]/);
    packs.push({ dir: d, source: `${parts[parts.length - 2]}/${parts[parts.length - 1]}`, items: items.length, byKind });
    all.push(...items);
  }
  return { store: mapSeedItemStore(all), packs };
}

// ---------------------------------------------------------------- public / private projections

/** Positional key point id (q1k1 ...): stable as long as the stamped item is unchanged. */
export const keyPointId = (q: number, k: number): string => `q${q + 1}k${k + 1}`;
export const defectId = (i: number): string => `d${i + 1}`;

export function explainBackQuestions(item: ExplainBackItem): { prompt: string }[] {
  return item.questions.map((q) => ({ prompt: q.prompt }));
}

export function explainBackKey(item: ExplainBackItem) {
  return item.questions.map((q, qi) => ({
    prompt: q.prompt,
    keyPoints: q.keyPoints.map((kp, ki) => ({
      id: keyPointId(qi, ki),
      text: kp.text,
      quote: kp.quote ?? null,
      cite: kp.cite ? { path: kp.cite.path, lineStart: kp.cite.lineStart, lineEnd: kp.cite.lineEnd } : null,
    })),
  }));
}

/** Public half of a kata: diff + context, and NOT the defect count (audit #9: blind review). */
export function kataPublic(item: PatchKataItem) {
  return {
    title: item.title,
    diff: item.diff,
    contextFiles: item.contextFiles.map((f) => ({ path: f.path, content: f.content })),
  };
}

export function kataKey(item: PatchKataItem) {
  return item.seededDefectKey.map((d, i) => ({
    id: defectId(i),
    scenario: d.scenario,
    evidence: { path: d.evidence.path, lineStart: d.evidence.lineStart, lineEnd: d.evidence.lineEnd, in: d.evidence.in },
    consequence: d.consequence,
  }));
}
