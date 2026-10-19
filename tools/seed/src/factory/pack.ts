/**
 * Seed-pack writer / reader / stamp verifier — the code-pack import-gate
 * machinery (validate.ts + server packs.ts) applied to seed content:
 *   - any write first REMOVES validation.json; only a run whose validator
 *     verdicts are all in (and whose quarantine is empty, or explicitly
 *     allowed) writes a fresh stamp;
 *   - quarantine.json (PackQuarantine schema, always written, even empty) +
 *     QUARANTINE.md list every rejected candidate with its reason;
 *   - review-queue.json holds items that need a human (not a pass);
 *   - the stamp binds manifest bytes, items bytes, the seed fingerprint and
 *     the quarantine + review keys.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PACK_FORMAT,
  SEED_PACK_FORMAT,
  SeedItemsFile,
  SeedPackManifest,
  SeedQuarantine,
  SeedReviewQueue,
  SeedValidationStamp,
  type SeedCounts,
  type SeedGenerator,
  type SeedItem,
  type SeedSkip,
} from '@bootquest/shared';
import type { Checkout } from './checkout.ts';
import { Exclusions } from './exclusions.ts';
import { packRunners, seedFingerprint, seedToolchain, type SeedRunner } from './fingerprint.ts';
import { packGuardProblems } from './guards.ts';
import { sha256, stableJson } from './util.ts';

export interface Rejection {
  key: string;
  reason: string;
}

export interface ReviewHold {
  key: string;
  warnings: string[];
  item: SeedItem;
}

/** What a generator + its validator produced for one pack. */
export interface SeedOutcome {
  accepted: SeedItem[];
  rejected: Rejection[];
  review: ReviewHold[];
  /** candidate items dropped because they touch an excluded file (counted toward candidates) */
  dropped: SeedSkip[];
  /** whole-file / not-generatable skips (not candidates) */
  skipped: SeedSkip[];
  executions: number;
}

export const emptyOutcome = (): SeedOutcome => ({ accepted: [], rejected: [], review: [], dropped: [], skipped: [], executions: 0 });

export function countByKind(items: readonly SeedItem[]): { total: number; byKind: SeedCounts } {
  const byKind: SeedCounts = {};
  for (const it of items) byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
  const sorted: SeedCounts = {};
  for (const k of Object.keys(byKind).sort() as (keyof SeedCounts)[]) sorted[k] = byKind[k];
  return { total: items.length, byKind: sorted };
}

export interface WriteSeedPackOptions {
  dir: string;
  generator: SeedGenerator;
  name: string;
  checkout: Pick<Checkout, 'repo' | 'sha' | 'pin' | 'excludeDirs' | 'blobs'>;
  inputs: string[];
  outcome: SeedOutcome;
  /** stamp even though candidates were quarantined (explicit human choice; recorded in the stamp) */
  allowQuarantine?: boolean;
  /** pack-level validator failures (seed:notes coverage): any entry means NO stamp */
  blockers?: string[];
  /**
   * the registry whose secretPatterns the pack-level secret scan uses (guards.ts); default: the
   * committed tools/seed/exclusions.json
   */
  exclusions?: Exclusions;
  /**
   * the seed root the pack-level guards compare against (explain-back key points vs same-repo
   * quest packs); default: two levels above `dir` (content/seed for content/seed/<gen>/<name>)
   */
  guardSeedRoot?: string | null;
  /**
   * replace a pack whose manifest records a DIFFERENT generator or draft source (`draft:*` inputs)
   * than this run (the --force-replace escape hatch; see replaceRefusal)
   */
  forceReplace?: boolean;
}

/**
 * Three writers target content/seed/quests/<repo> (seed:quests, seed:quests:drafts,
 * quests-authored.ts) and others share their generator's dir: running the plain generator over a
 * drafts-built repo would silently replace every hand item. A pack on disk whose manifest names a
 * different generator, pack name or set of `draft:*` inputs (generator-only / drafts / authored, and
 * WHICH draft) is only replaced with forceReplace.
 */
export class SeedPackReplaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedPackReplaceError';
  }
}

const draftInputs = (inputs: readonly string[]): string[] => inputs.filter((i) => i.startsWith('draft:')).sort();

/** Why writing (generator, name, inputs) into `dir` would replace a pack of another source; null = same source or no pack. */
export function replaceRefusal(dir: string, generator: SeedGenerator, name: string, inputs: readonly string[]): string | null {
  const mp = join(dir, 'manifest.json');
  if (!existsSync(mp)) return null;
  let old: { generator?: unknown; name?: unknown; source?: { inputs?: unknown } };
  try {
    old = JSON.parse(readFileSync(mp, 'utf8')) as typeof old;
  } catch {
    return `${mp} is not readable JSON; refusing to overwrite a pack whose source cannot be established`;
  }
  const oldInputs = Array.isArray(old.source?.inputs) ? (old.source.inputs as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const kind = (d: string[]) => (d.length === 0 ? 'generator-only (no draft)' : d.join(', '));
  const why: string[] = [];
  if (old.generator !== generator) why.push(`it was written by seed:${String(old.generator)}, this run is seed:${generator}`);
  if (old.name !== name) why.push(`it is pack ${String(old.name)}, this run writes ${name}`);
  const a = draftInputs(oldInputs);
  const b = draftInputs(inputs);
  if (JSON.stringify(a) !== JSON.stringify(b)) why.push(`its source is ${kind(a)}, this run's is ${kind(b)}`);
  return why.length ? `refusing to replace ${dir}: ${why.join('; ')} — re-run the writer that built it, or pass --force-replace to discard its items` : null;
}

export interface WriteSeedPackResult {
  manifest: SeedPackManifest;
  stamped: boolean;
  /** why no stamp was written (empty when stamped) */
  unstampedBecause: string[];
}

const byKey = <T extends { key: string }>(a: T, b: T): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function writeSeedPack(o: WriteSeedPackOptions): WriteSeedPackResult {
  if (!o.forceReplace) {
    const refusal = replaceRefusal(o.dir, o.generator, o.name, o.inputs);
    if (refusal) throw new SeedPackReplaceError(refusal);
  }
  mkdirSync(o.dir, { recursive: true });
  const stampPath = join(o.dir, 'validation.json');
  rmSync(stampPath, { force: true });
  const source = `${o.generator}/${o.name}`;

  const accepted = [...o.outcome.accepted].sort(byKey);
  const rejected = [...o.outcome.rejected].sort(byKey);
  const review = [...o.outcome.review].sort(byKey);
  const itemsFile = SeedItemsFile.parse({ format: SEED_PACK_FORMAT, generator: o.generator, name: o.name, items: accepted });
  const itemsBytes = stableJson(itemsFile);
  writeFileSync(join(o.dir, 'items.json'), itemsBytes);

  const blobs: Record<string, string> = {};
  for (const k of [...o.checkout.blobs.keys()].sort()) blobs[k] = o.checkout.blobs.get(k)!;
  const counts = countByKind(accepted);
  const manifest = SeedPackManifest.parse({
    format: SEED_PACK_FORMAT,
    generator: o.generator,
    name: o.name,
    source: {
      repo: o.checkout.repo,
      sha: o.checkout.sha,
      pin: o.checkout.pin,
      inputs: [...o.inputs].sort(),
      excludeDirs: [...o.checkout.excludeDirs],
    },
    blobs,
    items: { file: 'items.json', sha256: sha256(itemsBytes) },
    counts,
    candidates: accepted.length + rejected.length + review.length + o.outcome.dropped.length,
    quarantined: rejected.length,
    review: review.length,
    skipped: [...o.outcome.skipped, ...o.outcome.dropped].sort((a, b) => (a.subject + a.reason < b.subject + b.reason ? -1 : 1)),
    dropped: o.outcome.dropped.length,
  });
  const manifestBytes = stableJson(manifest);
  writeFileSync(join(o.dir, 'manifest.json'), manifestBytes);

  const quarantine = SeedQuarantine.parse({ format: PACK_FORMAT, source, entries: rejected.map((r) => ({ key: r.key, course: o.generator, reason: r.reason })) });
  writeFileSync(join(o.dir, 'quarantine.json'), stableJson(quarantine));
  writeFileSync(
    join(o.dir, 'QUARANTINE.md'),
    [
      `# Quarantine — ${source}`,
      '',
      'Written by the seed factory. These candidates FAILED their deterministic validator and are',
      'never shipped. Never fix them by weakening the validator; fix the source and re-seed.',
      '',
      '| item | reason |',
      '|---|---|',
      ...rejected.map((r) => `| \`${r.key}\` | ${r.reason.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`),
      ...(rejected.length === 0 ? ['| _(none: every candidate passed its validator)_ | |'] : []),
      '',
    ].join('\n'),
  );
  const rq = SeedReviewQueue.parse({ format: SEED_PACK_FORMAT, source, entries: review });
  writeFileSync(join(o.dir, 'review-queue.json'), stableJson(rq));

  const unstampedBecause: string[] = [];
  if (rejected.length > 0 && !o.allowQuarantine) unstampedBecause.push(`${rejected.length} candidate(s) quarantined (pass --allow-quarantine to stamp with them withheld)`);
  if (accepted.length === 0) unstampedBecause.push('no accepted items');
  for (const b of o.blockers ?? []) unstampedBecause.push(b);
  // the pack-level answer-tell / leak / secret guards (guards.ts): the same checks seed:check runs
  for (const g of packGuardProblems({
    generator: o.generator,
    name: o.name,
    repo: o.checkout.repo,
    items: accepted,
    ex: o.exclusions ?? Exclusions.load(),
    seedRoot: o.guardSeedRoot === undefined ? resolve(o.dir, '..', '..') : o.guardSeedRoot,
  })) {
    unstampedBecause.push(`guard ${g}`);
  }
  if (unstampedBecause.length === 0) {
    // bound to the graders the shipped + held items execute (seed:check re-validates both)
    const runners = packRunners([...accepted, ...review.map((r) => r.item)]);
    const stamp = SeedValidationStamp.parse({
      format: SEED_PACK_FORMAT,
      source,
      fingerprintKind: `seed:${o.generator}`,
      fingerprint: seedFingerprint(o.generator, runners),
      toolchain: seedToolchain(o.generator, runners),
      manifestSha256: sha256(manifestBytes),
      itemsSha256: sha256(itemsBytes),
      counts,
      quarantinedKeys: rejected.map((r) => r.key),
      reviewKeys: review.map((r) => r.key),
      executions: o.outcome.executions,
    });
    writeFileSync(stampPath, stableJson(stamp));
  }
  return { manifest, stamped: unstampedBecause.length === 0, unstampedBecause };
}

export interface LoadedSeedPack {
  dir: string;
  manifest: SeedPackManifest;
  items: SeedItem[];
  stamp: SeedValidationStamp | null;
  quarantineKeys: string[];
  reviewKeys: string[];
  /**
   * W7 (allowStaleFingerprint only): the stamp binds everything EXCEPT the current
   * seed fingerprint (validator/generator/registry/toolchain changed since stamping).
   * Such a pack is still NOT valid: seed:check --restamp may re-stamp it only after a
   * full re-validation of every item under the current validators.
   */
  staleFingerprint: boolean;
  /** the runner types the shipped + review-held items execute: the graders the fingerprint binds */
  runners: SeedRunner[];
}

/** Read + structurally verify a seed pack (bytes, schema, counts, stamp binding). Throws on any mismatch. */
export function loadSeedPack(dir: string, opts: { requireStamp?: boolean; allowStaleFingerprint?: boolean } = {}): LoadedSeedPack {
  const read = (f: string): string => {
    const p = join(dir, f);
    if (!existsSync(p)) throw new Error(`${dir}: ${f} missing`);
    return readFileSync(p, 'utf8');
  };
  const manifestBytes = read('manifest.json');
  const manifest = SeedPackManifest.parse(JSON.parse(manifestBytes));
  const itemsBytes = read('items.json');
  if (sha256(itemsBytes) !== manifest.items.sha256) throw new Error(`${dir}: items.json sha256 != manifest (edited after generation?)`);
  const itemsFile = SeedItemsFile.parse(JSON.parse(itemsBytes));
  if (itemsFile.generator !== manifest.generator || itemsFile.name !== manifest.name) throw new Error(`${dir}: items.json is for ${itemsFile.generator}/${itemsFile.name}`);
  const counts = countByKind(itemsFile.items);
  if (JSON.stringify(counts) !== JSON.stringify(manifest.counts)) {
    throw new Error(`${dir}: loaded ${JSON.stringify(counts)} != built ${JSON.stringify(manifest.counts)}`);
  }
  const source = `${manifest.generator}/${manifest.name}`;
  const q = SeedQuarantine.parse(JSON.parse(read('quarantine.json')));
  if (q.source !== source) throw new Error(`${dir}: quarantine.json is for ${q.source}`);
  if (q.entries.length !== manifest.quarantined) throw new Error(`${dir}: quarantine.json has ${q.entries.length} entries, manifest says ${manifest.quarantined}`);
  const rq = SeedReviewQueue.parse(JSON.parse(read('review-queue.json')));
  if (rq.entries.length !== manifest.review) throw new Error(`${dir}: review-queue.json has ${rq.entries.length} entries, manifest says ${manifest.review}`);
  const shipped = new Set(itemsFile.items.map((i) => i.key));
  for (const k of [...q.entries.map((e) => e.key), ...rq.entries.map((e) => e.key)]) {
    if (shipped.has(k)) throw new Error(`${dir}: ${k} is both shipped and withheld`);
  }
  const quarantineKeys = q.entries.map((e) => e.key).sort();
  const reviewKeys = rq.entries.map((e) => e.key).sort();
  const runners = packRunners([...itemsFile.items, ...rq.entries.map((e) => e.item)]);

  let stamp: SeedValidationStamp | null = null;
  let staleFingerprint = false;
  const sp = join(dir, 'validation.json');
  if (existsSync(sp)) {
    stamp = SeedValidationStamp.parse(JSON.parse(readFileSync(sp, 'utf8')));
    const why: string[] = [];
    if (stamp.source !== source) why.push(`stamp is for ${stamp.source}`);
    if (stamp.manifestSha256 !== sha256(manifestBytes)) why.push('manifest bytes changed since stamping');
    if (stamp.itemsSha256 !== sha256(itemsBytes)) why.push('items bytes changed since stamping');
    if (stamp.fingerprintKind !== `seed:${manifest.generator}`) why.push(`stamp kind ${stamp.fingerprintKind}`);
    const fp = seedFingerprint(manifest.generator, runners);
    if (stamp.fingerprint !== fp && opts.allowStaleFingerprint) staleFingerprint = true;
    else if (stamp.fingerprint !== fp) why.push(`seed fingerprint ${stamp.fingerprint.slice(0, 12)} != current ${fp.slice(0, 12)} (validator/generator/registry/toolchain changed: re-seed)`);
    if (JSON.stringify(stamp.quarantinedKeys) !== JSON.stringify(quarantineKeys)) why.push('quarantine.json does not match the stamp');
    if (JSON.stringify(stamp.reviewKeys) !== JSON.stringify(reviewKeys)) why.push('review-queue.json does not match the stamp');
    if (why.length) throw new Error(`${dir}: stale/invalid stamp: ${why.join('; ')}`);
  } else if (opts.requireStamp) {
    throw new Error(`${dir}: no validation.json stamp — the generator's validator has not vouched for this pack`);
  }
  return { dir, manifest, items: itemsFile.items, stamp, quarantineKeys, reviewKeys, staleFingerprint, runners };
}

/**
 * W7 seed:check --restamp: rewrite a pack's stamp for the CURRENT seed fingerprint +
 * toolchain, keeping every other bound value. The caller (checkPack) must have
 * re-validated every shipped item and review hold under the current validators with
 * zero problems; this function only re-derives the binding from the bytes on disk.
 */
export function restampSeedPack(pack: LoadedSeedPack, executions: number): SeedValidationStamp {
  if (!pack.stamp) throw new Error(`${pack.dir}: no stamp to restamp (a never-validated pack must be re-seeded)`);
  const m = pack.manifest;
  const manifestBytes = readFileSync(join(pack.dir, 'manifest.json'), 'utf8');
  const itemsBytes = readFileSync(join(pack.dir, 'items.json'), 'utf8');
  const stamp = SeedValidationStamp.parse({
    format: SEED_PACK_FORMAT,
    source: `${m.generator}/${m.name}`,
    fingerprintKind: `seed:${m.generator}`,
    fingerprint: seedFingerprint(m.generator, pack.runners),
    toolchain: seedToolchain(m.generator, pack.runners),
    manifestSha256: sha256(manifestBytes),
    itemsSha256: sha256(itemsBytes),
    counts: m.counts,
    quarantinedKeys: pack.quarantineKeys,
    reviewKeys: pack.reviewKeys,
    executions,
  });
  if (stamp.manifestSha256 !== pack.stamp.manifestSha256 || stamp.itemsSha256 !== pack.stamp.itemsSha256) {
    throw new Error(`${pack.dir}: bytes changed since the original stamp; refusing to restamp`);
  }
  writeFileSync(join(pack.dir, 'validation.json'), stableJson(stamp));
  return stamp;
}
