/**
 * seed:check — the umbrella W7's full validate calls: every emitted seed pack
 * under content/seed/<generator>/<name>/ is re-verified from scratch:
 *   1. structure: manifest/items bytes + schema + loaded === built counts +
 *      quarantine/review files consistent (loadSeedPack);
 *   2. stamp: present and still bound to the bytes, the quarantine + review keys
 *      and the CURRENT seed fingerprint (a validator/generator/registry change
 *      makes every stamp stale);
 *   3. pin: the source checkout's files still hash to the pinned blob ids;
 *   4. content: every shipped item re-runs its generator's validator and must
 *      come back 'accept' and byte-identical (canonical JSON); every review item
 *      must still be held (never silently promoted); variants and patches are
 *      re-EXECUTED through the real runner.
 * A pack whose source checkout is unavailable FAILS (it cannot be re-verified).
 * Checkouts are found at <checkouts>/<repo>@<sha> (default .cache/checkouts,
 * overridable with --checkouts or BOOTQUEST_CHECKOUTS).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SeedItem } from '@bootquest/shared';
import { SeedReviewQueue } from '@bootquest/shared';
import { openCheckout, verifyBlobs, type Checkout } from '../checkout.ts';
import { validateExplainBack } from '../explainback/explainback.ts';
import { Exclusions } from '../exclusions.ts';
import { defaultHarness, type Harness } from '../harness/harness.ts';
import { loadSeedPack, type LoadedSeedPack } from '../pack.ts';
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
}

export interface CheckOptions {
  seedDir: string;
  checkouts?: string;
  exclusionsPath?: string;
  harness?: Harness;
  log?: (l: string) => void;
}

export async function checkPack(dir: string, o: CheckOptions): Promise<PackCheck> {
  const res: PackCheck = { dir, ok: false, problems: [], items: 0, review: 0, executions: 0 };
  let pack: LoadedSeedPack;
  try {
    pack = loadSeedPack(dir, { requireStamp: true });
  } catch (err) {
    res.problems.push(err instanceof Error ? err.message : String(err));
    return res;
  }
  res.items = pack.items.length;
  res.review = pack.reviewKeys.length;
  const m = pack.manifest;
  const ex = Exclusions.load(o.exclusionsPath);
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

  const h = o.harness ?? defaultHarness();
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
  res.ok = res.problems.length === 0;
  return res;
}

export async function runCheck(o: CheckOptions): Promise<{ ok: boolean; packs: PackCheck[] }> {
  const packs: PackCheck[] = [];
  for (const dir of findPacks(o.seedDir)) {
    const r = await checkPack(dir, o);
    o.log?.(`${r.ok ? 'OK  ' : 'FAIL'} ${dir}: ${r.items} item(s) re-validated, ${r.review} held for review${r.executions ? `, ${r.executions} execution(s)` : ''}`);
    for (const p of r.problems) o.log?.(`     PROBLEM ${p}`);
    packs.push(r);
  }
  return { ok: packs.every((p) => p.ok), packs };
}
