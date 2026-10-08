/** seed:variants end to end: draft (LLM-authored in seed sessions) → wrong-solution filter (real runner) → pack + stamp. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SeedProvenance, SeedRunnableCheck, type SeedVariantItem } from '@bootquest/shared';
import { openCheckout, CheckoutError, type Checkout } from '../checkout.ts';
import { Exclusions } from '../exclusions.ts';
import { defaultHarness, type Harness } from '../harness/harness.ts';
import { emptyOutcome, writeSeedPack } from '../pack.ts';
import { checkProvenance } from '../quests/validate.ts';
import { bucket, DEFAULT_SEED_DIR, refusal, summarize, type RunReport } from '../report.ts';
import { stableKey } from '../util.ts';
import { validateVariant } from './variants.ts';

export const VariantsDraft = z
  .object({
    unit: z.string().min(1),
    /** the unit text the variants transfer from (e.g. signalpost milestones[code=U02].transfer) */
    provenance: SeedProvenance,
    items: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
            task: z.string(),
            check: SeedRunnableCheck,
            referenceSolution: z.string(),
            deliberatelyWrongSolution: z.string(),
            wrongBecause: z.string(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export interface VariantsOptions {
  draft: string;
  /** optional: verify the provenance at the pinned sha */
  checkout?: string;
  out?: string;
  harness?: Harness;
  exclusionsPath?: string;
}

export async function runVariants(o: VariantsOptions): Promise<RunReport> {
  const head = [`[seed:variants] draft ${o.draft}`];
  const ex = Exclusions.load(o.exclusionsPath);
  let draft: z.infer<typeof VariantsDraft>;
  let raw: string;
  try {
    raw = readFileSync(o.draft, 'utf8');
    draft = VariantsDraft.parse(JSON.parse(raw));
  } catch (err) {
    return refusal('variants', head, `draft unreadable/malformed: ${err instanceof z.ZodError ? err.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : err instanceof Error ? err.message : String(err)}`);
  }
  const secrets = ex.scan(raw);
  if (secrets.length) return refusal('variants', head, `UNREGISTERED SECRET: draft matches secret pattern(s) ${secrets.join(', ')}; refusing to ingest it`);
  const p = draft.provenance;
  head[0] = `[seed:variants] unit ${draft.unit} from ${p.repo}@${p.sha.slice(0, 12)} ${p.path}:${p.lines.start}-${p.lines.end} (${draft.items.length} draft item(s))`;
  const repoHit = ex.repo(p.repo);
  if (repoHit) return refusal('variants', head, `source repo ${p.repo} is ${repoHit.reason}: ${repoHit.entry.note}`);
  const pathHit = ex.path(p.repo, p.path);
  if (pathHit) return refusal('variants', head, `source ${p.path} is ${pathHit.reason} — refusing to ingest it`);

  let co: Pick<Checkout, 'repo' | 'sha' | 'pin' | 'excludeDirs' | 'blobs'> = { repo: p.repo, sha: p.sha, pin: 'caller-asserted', excludeDirs: [], blobs: new Map() };
  if (o.checkout) {
    try {
      const full = openCheckout({ root: o.checkout, sha: p.sha, repo: p.repo });
      const pr = checkProvenance(full, ex, p);
      if (pr.error || pr.excluded) return refusal('variants', head, `provenance does not hold at the pinned sha: ${pr.error ?? pr.excluded}`);
      co = full;
    } catch (err) {
      if (err instanceof CheckoutError) return refusal('variants', head, err.message);
      throw err;
    }
  } else {
    head.push('[seed:variants] no --checkout: provenance recorded as caller-asserted (not resolved)');
  }

  const h = o.harness ?? defaultHarness();
  head.push(`[seed:variants] runners: ${Object.keys(h.runners).join(', ') || '(none)'}`);
  const outcome = emptyOutcome();
  for (const d of draft.items) {
    const item: SeedVariantItem = {
      kind: 'variant',
      key: stableKey('variants', p.repo, 'variant', [draft.unit, d.id]),
      provenance: p,
      citations: [],
      unitKey: draft.unit,
      task: d.task,
      check: d.check,
      referenceSolution: d.referenceSolution,
      deliberatelyWrongSolution: d.deliberatelyWrongSolution,
      wrongBecause: d.wrongBecause,
    };
    bucket(outcome, item.key, await validateVariant(h, item));
  }
  outcome.executions = h.executions;
  const name = draft.unit.replace(/[^A-Za-z0-9._-]+/g, '-');
  const outDir = o.out ?? join(DEFAULT_SEED_DIR, 'variants', name);
  const write = writeSeedPack({ dir: outDir, generator: 'variants', name, checkout: co, inputs: [p.path, `draft:${o.draft.replace(/\\/g, '/').split('/').pop()}`], outcome });
  return summarize('variants', head, outcome, write, outDir, false);
}
