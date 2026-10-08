import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SeedExplainBackItem,
  SeedItemsFile,
  SeedPatchKataItem,
  SeedValidationStamp,
  type SeedExplainBackItem as ExplainBackItem,
  type SeedPatchKataItem as PatchKataItem,
} from '@bootquest/shared';

/**
 * W6: the seed items the explain-back and patch-kata players are built from
 * (W5a seed packs: content/seed/explainback/<name>/ and content/seed/patches/<name>/,
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
}

export const emptySeedItemStore: SeedItemStore = { explainBack: () => undefined, kata: () => undefined, size: () => 0 };

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
    }
    // other seed kinds (quiz / flashcard / reading-step / variant) are served elsewhere
  }
  return { explainBack: (k) => eb.get(k), kata: (k) => kata.get(k), size: () => eb.size + kata.size };
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Read ONE stamped seed pack dir (items.json + validation.json). */
export function readSeedPackItems(dir: string): unknown[] {
  const itemsPath = join(dir, 'items.json');
  const stampPath = join(dir, 'validation.json');
  if (!existsSync(itemsPath)) throw new SeedItemLoadError(`${dir}: no items.json`);
  if (!existsSync(stampPath)) {
    throw new SeedItemLoadError(`${dir}: no validation.json stamp (run the seed generator's validator to completion)`);
  }
  const bytes = readFileSync(itemsPath);
  const stamp = SeedValidationStamp.parse(JSON.parse(readFileSync(stampPath, 'utf8')));
  // autocrlf checkouts may rewrite LF -> CRLF: accept the LF-normalized bytes too
  const lf = bytes.toString('utf8').replace(/\r\n/g, '\n');
  if (stamp.itemsSha256 !== sha256(bytes) && stamp.itemsSha256 !== sha256(lf)) {
    throw new SeedItemLoadError(`${dir}: items.json bytes do not match the validation stamp (edited after validation?)`);
  }
  return SeedItemsFile.parse(JSON.parse(lf)).items;
}

/** Every content/seed/{explainback,patches}/<name>/ dir holding items.json (default for the real entrypoint). */
export function defaultSeedItemDirs(root: string): string[] {
  const out: string[] = [];
  for (const gen of ['explainback', 'patches']) {
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

export function kataPublic(item: PatchKataItem) {
  return {
    title: item.title,
    diff: item.diff,
    contextFiles: item.contextFiles.map((f) => ({ path: f.path, content: f.content })),
    defectCount: item.seededDefectKey.length,
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
