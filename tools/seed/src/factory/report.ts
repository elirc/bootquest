/** Shared CLI plumbing for the seed generators: args, outcome bucketing, the printed report, exit codes. */
import { resolve } from 'node:path';
import type { SeedGenerator, SeedItem, SeedSkip } from '@bootquest/shared';
import type { ItemVerdict } from './quests/validate.ts';
import { countByKind, SeedPackReplaceError, type SeedOutcome, type WriteSeedPackResult } from './pack.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
export const DEFAULT_SEED_DIR = resolve(REPO_ROOT, 'content', 'seed');

export function parseArgs(argv: readonly string[]): { positional: string[]; opts: Map<string, string>; flags: Set<string> } {
  const positional: string[] = [];
  const opts = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts.set(name, next);
        i++;
      } else flags.add(name);
    } else positional.push(a);
  }
  return { positional, opts, flags };
}

/** Put one validator verdict into the outcome buckets. */
export function bucket(out: SeedOutcome, key: string, v: ItemVerdict): void {
  if (v.verdict === 'accept') out.accepted.push(v.item);
  else if (v.verdict === 'review') out.review.push({ key, warnings: v.warnings, item: v.item });
  else if (v.verdict === 'drop') out.dropped.push({ subject: key, reason: v.reason });
  else out.rejected.push({ key, reason: v.reason });
}

export interface RunReport {
  generator: SeedGenerator;
  ok: boolean;
  /** hard refusal before/while generating (nothing or a partial pack written) */
  refused: string | null;
  outcome: SeedOutcome | null;
  write: WriteSeedPackResult | null;
  outDir: string | null;
  lines: string[];
}

const fmtCounts = (items: readonly SeedItem[]): string => {
  const c = countByKind(items);
  return `${c.total} (${Object.entries(c.byKind).map(([k, v]) => `${k} ${v}`).join(' / ') || 'none'})`;
};

export function summarize(generator: SeedGenerator, head: string[], outcome: SeedOutcome, write: WriteSeedPackResult, outDir: string, allowQuarantine: boolean): RunReport {
  const lines = [...head];
  const skipsAll: SeedSkip[] = [...outcome.skipped, ...outcome.dropped];
  for (const s of outcome.skipped) lines.push(`  SKIP ${s.subject}: ${s.reason}`);
  for (const d of outcome.dropped) lines.push(`  DROPPED ${d.subject}: ${d.reason}`);
  for (const r of outcome.rejected) lines.push(`  QUARANTINED ${r.key}: ${r.reason}`);
  for (const r of outcome.review) lines.push(`  REVIEW ${r.key}: ${r.warnings.join(' | ')}`);
  const m = write.manifest;
  lines.push(
    `COUNTS candidates ${m.candidates} = shipped ${fmtCounts(outcome.accepted)} + quarantined ${m.quarantined} + review ${m.review} + dropped ${m.dropped}; skipped (not candidates) ${outcome.skipped.length}; exclusion skips ${skipsAll.filter((s) => s.reason.startsWith('excluded:') || s.reason.includes('excluded:')).length}`,
  );
  if (outcome.executions) lines.push(`EXECUTIONS ${outcome.executions} real runner execution(s)`);
  lines.push(`PACK ${outDir}`);
  lines.push(write.stamped ? `STAMP written ${resolve(outDir, 'validation.json')}` : `STAMP none: ${write.unstampedBecause.join('; ')}`);
  const ok = write.stamped && (outcome.rejected.length === 0 || allowQuarantine);
  lines.push(`RESULT ${ok ? 'OK' : 'FAIL'}`);
  return { generator, ok, refused: null, outcome, write, outDir, lines };
}

export function refusal(generator: SeedGenerator, head: string[], why: string): RunReport {
  return { generator, ok: false, refused: why, outcome: null, write: null, outDir: null, lines: [...head, `REFUSED ${why}`, 'RESULT FAIL'] };
}

export function finish(name: string, run: () => Promise<RunReport> | RunReport): void {
  Promise.resolve()
    .then(run)
    .then(
      (r) => {
        for (const l of r.lines) console.log(l);
        process.exit(r.ok ? 0 : 1);
      },
      (err: unknown) => {
        if (err instanceof SeedPackReplaceError) {
          // a refusal, not a crash: the dir holds a pack another writer / draft built (pass --force-replace)
          console.log(`[${name}] REFUSED ${err.message}`);
          console.log('RESULT FAIL');
        } else console.error(`[${name}] CRASHED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        process.exit(1);
      },
    );
}
