/** seed:patches end to end: kata draft + repo checkout at the pinned sha → validator → pack + stamp. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SeedDefect, SeedRunnableCheck, type SeedPatchKataItem } from '@bootquest/shared';
import { CheckoutError, openCheckout, pinFile } from '../checkout.ts';
import { Exclusions } from '../exclusions.ts';
import { defaultHarness, type Harness } from '../harness/harness.ts';
import { emptyOutcome, writeSeedPack } from '../pack.ts';
import { bucket, DEFAULT_SEED_DIR, refusal, summarize, type RunReport } from '../report.ts';
import { stableKey } from '../util.ts';
import { sliceLines, validatePatchKata } from './patches.ts';

const range = z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).strict();

export const PatchesDraft = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    katas: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
            title: z.string(),
            /** seed:quests flashcard key of the finding the kata is built from */
            findingRef: z.string().optional(),
            /** the guide text (finding) the kata comes from */
            provenance: z.object({ path: z.string(), lines: range }).strict(),
            diff: z.string(),
            contextFiles: z.array(
              z
                .object({
                  path: z.string(),
                  /** omitted for verbatim files: the factory copies them from the checkout */
                  content: z.string().optional(),
                  origin: z.object({ kind: z.enum(['verbatim', 'adapted']), repoPath: z.string(), lines: range.optional() }).strict(),
                })
                .strict(),
            ),
            seededDefectKey: z.array(SeedDefect),
            test: z.object({ module: z.string(), check: SeedRunnableCheck }).strict().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export interface PatchesOptions {
  draft: string;
  checkout: string;
  sha: string;
  repo?: string;
  out?: string;
  harness?: Harness;
  exclusionsPath?: string;
}

export async function runPatches(o: PatchesOptions): Promise<RunReport> {
  const head = [`[seed:patches] draft ${o.draft}`];
  const ex = Exclusions.load(o.exclusionsPath);
  let draft: z.infer<typeof PatchesDraft>;
  let raw: string;
  try {
    raw = readFileSync(o.draft, 'utf8');
    draft = PatchesDraft.parse(JSON.parse(raw));
  } catch (err) {
    return refusal('patches', head, `draft unreadable/malformed: ${err instanceof z.ZodError ? err.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : err instanceof Error ? err.message : String(err)}`);
  }
  const secrets = ex.scan(raw);
  if (secrets.length) return refusal('patches', head, `UNREGISTERED SECRET: draft matches secret pattern(s) ${secrets.join(', ')}; refusing to ingest it`);
  let co;
  try {
    co = openCheckout({ root: o.checkout, sha: o.sha, ...(o.repo ? { repo: o.repo } : {}) });
  } catch (err) {
    if (err instanceof CheckoutError) return refusal('patches', head, err.message);
    throw err;
  }
  head[0] = `[seed:patches] ${draft.name}: ${draft.katas.length} kata draft(s) against ${co.repo} @ ${co.sha} (pin ${co.pin})`;
  const repoHit = ex.repo(co.repo);
  if (repoHit) return refusal('patches', head, `repo ${co.repo} is ${repoHit.reason}: ${repoHit.entry.note}`);
  const h = o.harness ?? defaultHarness();
  head.push(`[seed:patches] runners: ${Object.keys(h.runners).join(', ') || '(none)'}`);

  const outcome = emptyOutcome();
  for (const k of draft.katas) {
    const key = stableKey('patches', co.repo, 'patch-kata', [draft.name, k.id]);
    // verbatim context is copied from the checkout (never typed in by hand), unless the file is excluded
    const contextFiles: SeedPatchKataItem['contextFiles'] = [];
    let dropped: string | null = null;
    for (const f of k.contextFiles) {
      const hit = ex.path(co.repo, f.origin.repoPath);
      if (hit) {
        dropped = `context ${f.path} comes from ${f.origin.repoPath}: ${hit.reason}`;
        break;
      }
      let content = f.content;
      if (content === undefined) {
        if (f.origin.kind !== 'verbatim' || !co.fullIndex.files.has(f.origin.repoPath)) {
          content = '';
        } else {
          const text = readFileSync(join(co.root, f.origin.repoPath), 'utf8');
          pinFile(co, f.origin.repoPath);
          content = f.origin.lines ? sliceLines(text, f.origin.lines.start, f.origin.lines.end) : text;
        }
      }
      contextFiles.push({ path: f.path, content, origin: { kind: f.origin.kind, repoPath: f.origin.repoPath, ...(f.origin.lines ? { lines: f.origin.lines } : {}) } });
    }
    if (dropped) {
      outcome.dropped.push({ subject: key, reason: dropped });
      continue;
    }
    const item = {
      kind: 'patch-kata',
      key,
      provenance: { repo: co.repo, sha: co.sha, path: k.provenance.path, lines: k.provenance.lines },
      citations: [],
      title: k.title,
      diff: k.diff,
      contextFiles,
      seededDefectKey: k.seededDefectKey,
      ...(k.test ? { test: k.test } : {}),
      ...(k.findingRef ? { findingRef: k.findingRef } : {}),
    };
    bucket(outcome, key, await validatePatchKata(co, ex, h, item));
  }
  outcome.executions = h.executions;
  const outDir = o.out ?? join(DEFAULT_SEED_DIR, 'patches', draft.name);
  const write = writeSeedPack({ dir: outDir, generator: 'patches', name: draft.name, checkout: co, inputs: [...new Set(draft.katas.map((k) => k.provenance.path))].concat(`draft:${o.draft.replace(/\\/g, '/').split('/').pop()}`), outcome });
  return summarize('patches', head, outcome, write, outDir, false);
}
