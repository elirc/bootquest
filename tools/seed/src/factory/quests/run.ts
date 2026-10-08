/** seed:quests end to end: open checkout → registry → generate → validate → write + stamp. */
import { join } from 'node:path';
import { CheckoutError, openCheckout } from '../checkout.ts';
import { Exclusions, UnregisteredSecretError } from '../exclusions.ts';
import { emptyOutcome, writeSeedPack } from '../pack.ts';
import { bucket, DEFAULT_SEED_DIR, refusal, summarize, type RunReport } from '../report.ts';
import { discoverGuides, generateQuestCandidates } from './generate.ts';
import { validateQuestItem } from './validate.ts';

export interface QuestsOptions {
  root: string;
  sha: string;
  repo?: string;
  /** explicit guide list (repo-relative); default: discovered user-authored guide trees */
  guides?: string[];
  out?: string;
  excludeDirs?: string[];
  allowQuarantine?: boolean;
  exclusionsPath?: string;
}

export function runQuests(o: QuestsOptions): RunReport {
  const head = ['[seed:quests]'];
  let ex: Exclusions;
  try {
    ex = Exclusions.load(o.exclusionsPath);
  } catch (err) {
    return refusal('quests', head, `exclusion registry unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  let co;
  try {
    co = openCheckout({ root: o.root, sha: o.sha, ...(o.repo ? { repo: o.repo } : {}), ...(o.excludeDirs ? { excludeDirs: o.excludeDirs } : {}) });
  } catch (err) {
    if (err instanceof CheckoutError) return refusal('quests', head, err.message);
    throw err;
  }
  head[0] = `[seed:quests] repo ${co.repo} @ ${co.sha} (pin ${co.pin}) root ${co.root}`;
  head.push(`[seed:quests] index excludeDirs: ${co.excludeDirs.join(', ')}`);
  const repoHit = ex.repo(co.repo);
  if (repoHit) return refusal('quests', head, `repo ${co.repo} is ${repoHit.reason}: ${repoHit.entry.note}`);

  let guides: string[];
  if (o.guides?.length) {
    guides = o.guides.map((g) => g.replace(/\\/g, '/'));
    for (const g of guides) {
      const hit = ex.path(co.repo, g);
      if (hit) return refusal('quests', head, `requested guide ${g} is ${hit.reason} — refusing to ingest it (${hit.entry.note})`);
      if (!co.index.files.has(g)) return refusal('quests', head, `requested guide ${g} not found in the checkout`);
    }
  } else {
    guides = discoverGuides(co);
  }
  head.push(`[seed:quests] guides ${guides.length}${o.guides?.length ? ' (explicit)' : ' (discovered)'}: ${guides.join(', ') || '(none)'}`);
  if (guides.length === 0) return refusal('quests', head, 'no guides to seed from');

  let cand;
  try {
    cand = generateQuestCandidates(co, guides, ex);
  } catch (err) {
    if (err instanceof UnregisteredSecretError) return refusal('quests', head, err.message);
    throw err;
  }
  const outcome = emptyOutcome();
  outcome.skipped.push(...cand.excludedGuides);
  for (const g of cand.guides) {
    outcome.skipped.push(...g.skipped);
    for (const item of g.items) bucket(outcome, item.key, validateQuestItem(co, ex, item));
  }
  const outDir = o.out ?? join(DEFAULT_SEED_DIR, 'quests', co.repo);
  const write = writeSeedPack({ dir: outDir, generator: 'quests', name: co.repo, checkout: co, inputs: guides.filter((g) => !cand.excludedGuides.some((s) => s.subject === g)), outcome, allowQuarantine: o.allowQuarantine ?? false });
  return summarize('quests', head, outcome, write, outDir, o.allowQuarantine ?? false);
}
