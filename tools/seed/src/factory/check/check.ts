/**
 * seed:check — the umbrella W7's full validate calls: every emitted seed pack
 * under content/seed/<generator>/<name>/ is re-verified from scratch:
 *   1. structure: manifest/items bytes + schema + loaded === built counts +
 *      quarantine/review files consistent (loadSeedPack);
 *   2. stamp: present and still bound to the bytes, the quarantine + review keys
 *      and the CURRENT seed fingerprint (a validator/generator/registry change
 *      makes every stamp stale);
 *   3. pin: the source checkout's files still hash to the pinned blob ids and,
 *      with a mirror (pin git-tree), the checkout is git's tree byte for byte and
 *      every pinned id is git's own at the sha (seed:pins checks ids alone);
 *   4. content: every shipped item re-runs its generator's validator and must
 *      come back 'accept' and byte-identical (canonical JSON); every review item
 *      must still be held (never silently promoted); variants and patches are
 *      re-EXECUTED through the real runner;
 *   5. guards (factory/guards.ts, the same calls writeSeedPack makes before stamping): blind-pass,
 *      quiz-balance and explanation-lint for quest packs, the explain-back key-point leak check
 *      against same-repo quest packs, and a secret scan over every shipped string.
 * A pack whose source checkout is unavailable FAILS (it cannot be re-verified).
 * Checkouts are found at <checkouts>/<repo>@<sha> (default .cache/checkouts,
 * overridable with --checkouts or BOOTQUEST_CHECKOUTS).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SeedItem, SeedNoteItem } from '@bootquest/shared';
import { SeedReviewQueue } from '@bootquest/shared';
import { openCheckout, verifyBlobs, type Checkout } from '../checkout.ts';
import { validateExplainBack } from '../explainback/explainback.ts';
import { Exclusions } from '../exclusions.ts';
import { keyedQuizIndex, packGuardProblems, type KeyedQuiz } from '../guards.ts';
import { defaultHarness, type Harness } from '../harness/harness.ts';
import { loadSeedPack, restampSeedPack, type LoadedSeedPack } from '../pack.ts';
import { BINDING_RE, loadQuestPackView, notesCoverageProblems, validateNote, type QuestPackView } from '../notes/notes.ts';
import { validatePatchKata } from '../patches/patches.ts';
import { checkProvenance, validateQuestItem, type ItemVerdict } from '../quests/validate.ts';
import { REPO_ROOT } from '../report.ts';
import { validateVariant } from '../variants/variants.ts';

export const DEFAULT_CHECKOUTS = resolve(REPO_ROOT, '.cache', 'checkouts');

/** Canonical JSON (sorted keys) for "byte-identical after re-validation" comparisons. */
export function canonical(v: unknown): string {
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

export function findPacks(seedDir: string): string[] {
  if (!existsSync(seedDir)) return [];
  const out: string[] = [];
  for (const g of readdirSync(seedDir).sort()) {
    const gd = join(seedDir, g);
    if (!statSync(gd).isDirectory()) continue;
    for (const n of readdirSync(gd).sort()) {
      const pd = join(gd, n);
      if (statSync(pd).isDirectory() && existsSync(join(pd, 'manifest.json'))) out.push(pd);
    }
  }
  return out;
}

export interface PackCheck {
  dir: string;
  ok: boolean;
  problems: string[];
  items: number;
  review: number;
  executions: number;
  /** W7 --restamp: the stamp was stale-fingerprint-only and has been rewritten after a clean full re-validation */
  restamped: boolean;
}

export interface CheckOptions {
  seedDir: string;
  checkouts?: string;
  exclusionsPath?: string;
  harness?: Harness;
  log?: (l: string) => void;
  /**
   * W7: rewrite the stamp of a pack whose ONLY problem is a stale seed fingerprint,
   * after every shipped item re-validated 'accept' byte-identical and every review
   * hold is still held under the CURRENT validators. Any other problem: no restamp.
   */
  restamp?: boolean;
  /** keyedQuizIndex(seedDir), built once by runCheck for the explain-back leak guard */
  questIndex?: ReadonlyMap<string, readonly KeyedQuiz[]>;
}

export async function checkPack(dir: string, o: CheckOptions): Promise<PackCheck> {
  const res: PackCheck = { dir, ok: false, problems: [], items: 0, review: 0, executions: 0, restamped: false };
  let pack: LoadedSeedPack;
  try {
    pack = loadSeedPack(dir, { requireStamp: true, allowStaleFingerprint: o.restamp === true });
  } catch (err) {
    res.problems.push(err instanceof Error ? err.message : String(err));
    return res;
  }
  res.items = pack.items.length;
  res.review = pack.reviewKeys.length;
  const m = pack.manifest;
  const ex = Exclusions.load(o.exclusionsPath);
  // 5. the pack-level guards (factory/guards.ts) the generators also run before stamping: blind-pass,
  //    quiz-balance and explanation-lint (quests), the explain-back key-point leak check, and a secret
  //    scan over every shipped string. They need no checkout, so they run first; any failure FAILS
  //    the pack, so --restamp refuses it too.
  for (const g of packGuardProblems({ generator: m.generator, name: m.name, repo: m.source.repo, items: pack.items, ex, seedRoot: resolve(dir, '..', '..'), ...(o.questIndex ? { questIndex: o.questIndex } : {}) })) {
    res.problems.push(`guard ${g}`);
  }
  const coDir = join(o.checkouts ?? process.env.BOOTQUEST_CHECKOUTS ?? DEFAULT_CHECKOUTS, `${m.source.repo}@${m.source.sha}`);
  const needsCheckout = m.generator !== 'variants';
  let co: Checkout | null = null;
  if (existsSync(coDir)) {
    try {
      co = openCheckout({ root: coDir, sha: m.source.sha, repo: m.source.repo, excludeDirs: m.source.excludeDirs.filter((d) => d !== '.git' && d !== 'node_modules') });
    } catch (err) {
      res.problems.push(`checkout ${coDir}: ${err instanceof Error ? err.message : String(err)}`);
      return res;
    }
    const bad = verifyBlobs(co, m.blobs);
    if (bad.length) res.problems.push(`pin broken: ${bad.slice(0, 5).join('; ')}`);
  } else if (needsCheckout) {
    res.problems.push(`source checkout unavailable at ${coDir}: cannot re-resolve citations at ${m.source.sha.slice(0, 12)} (extract the repo there, or pass --checkouts)`);
    return res;
  }

  // seed:notes: the quest pack the notes annotate (<seed>/quests/<name>) must still be the exact
  // bytes the notes were validated against (its items.json sha256 is bound in the manifest inputs)
  let quests: QuestPackView | null = null;
  if (m.generator === 'notes') {
    const binding = m.source.inputs.map((i) => BINDING_RE.exec(i)).find((x) => x !== null);
    if (!binding) {
      res.problems.push('notes manifest has no quests:<pack>@items-sha256:<hex> binding input');
      return res;
    }
    try {
      quests = loadQuestPackView(join(dir, '..', '..', 'quests', binding[1]!));
    } catch (err) {
      res.problems.push(`quest pack ${binding[1]}: ${err instanceof Error ? err.message : String(err)}`);
      return res;
    }
    if (quests.itemsSha256 !== binding[2]) {
      res.problems.push(`quest pack ${binding[1]} items.json changed since the notes were validated (${quests.itemsSha256.slice(0, 12)} != bound ${binding[2]!.slice(0, 12)}): re-run seed:notes`);
      return res;
    }
    for (const p of notesCoverageProblems(pack.items.filter((i): i is SeedNoteItem => i.kind === 'note'), quests)) res.problems.push(p);
  }

  // a shared harness's runners, but a per-pack execution count (the stamp records this pack's executions)
  const h: Harness = { runners: (o.harness ?? defaultHarness()).runners, executions: 0 };
  const validate = async (item: SeedItem): Promise<ItemVerdict> => {
    switch (m.generator) {
      case 'quests':
        return validateQuestItem(co!, ex, item);
      case 'explainback': {
        const text = readFileSync(join(co!.root, item.provenance.path), 'utf8').replace(/^﻿/, '');
        return validateExplainBack(co!, ex, text, item);
      }
      case 'variants': {
        if (co) {
          const pr = checkProvenance(co, ex, item.provenance);
          if (pr.error || pr.excluded) return { verdict: 'reject', reason: pr.error ?? pr.excluded! };
        }
        return validateVariant(h, item);
      }
      case 'patches':
        return validatePatchKata(co!, ex, h, item);
      case 'notes':
        return validateNote(co!, ex, quests!, item);
    }
  };
  for (const item of pack.items) {
    const v = await validate(item);
    if (v.verdict !== 'accept') res.problems.push(`${item.key}: shipped item no longer passes (${v.verdict}: ${'reason' in v ? v.reason : v.warnings.join(' | ')})`);
    else if (canonical(v.item) !== canonical(item)) res.problems.push(`${item.key}: re-validation binds it differently than the shipped bytes`);
  }
  const rq = SeedReviewQueue.parse(JSON.parse(readFileSync(join(dir, 'review-queue.json'), 'utf8')));
  for (const e of rq.entries) {
    const v = await validate(e.item);
    if (v.verdict === 'accept') res.problems.push(`${e.key}: held for review but now validates clean — re-seed so the hold is re-decided, never auto-promoted`);
  }
  res.executions = h.executions;
  if (pack.staleFingerprint && res.problems.length === 0) {
    // stale-only + clean full re-validation: the current validators vouch for these bytes
    try {
      restampSeedPack(pack, h.executions);
      res.restamped = true;
    } catch (err) {
      res.problems.push(`restamp refused: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (pack.staleFingerprint) {
    res.problems.push('stale seed fingerprint NOT restamped: the pack has other problems (fix or re-seed it)');
  }
  res.ok = res.problems.length === 0;
  return res;
}

export async function runCheck(o: CheckOptions): Promise<{ ok: boolean; packs: PackCheck[] }> {
  const packs: PackCheck[] = [];
  const opts: CheckOptions = { ...o, questIndex: o.questIndex ?? keyedQuizIndex(o.seedDir) };
  for (const dir of findPacks(o.seedDir)) {
    const r = await checkPack(dir, opts);
    o.log?.(`${r.ok ? 'OK  ' : 'FAIL'} ${dir}: ${r.items} item(s) re-validated, ${r.review} held for review${r.executions ? `, ${r.executions} execution(s)` : ''}${r.restamped ? ' — RESTAMPED (stale fingerprint, clean re-validation)' : ''}`);
    for (const p of r.problems) o.log?.(`     PROBLEM ${p}`);
    packs.push(r);
  }
  return { ok: packs.every((p) => p.ok), packs };
}
