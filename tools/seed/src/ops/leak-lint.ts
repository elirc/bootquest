// seed:lint:leaks — every explain-back key point (text or quote) that restates a keyed answer of a
// same-repo quest pack (guards.ts explainBackKeyLeaks: the noteLeaks token rules, EB_LEAK_JACCARD).
// seed:check runs the same guard per explain-back pack and tolerates only EB_LEAK_EXEMPT; this lint
// lists EVERY leak, exempt or not, so it is the worklist for the content agent that rewrites them.
// Read-only (no stamps touched).
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { SeedItem } from '@bootquest/shared';
import { findPacks } from '../factory/check/check.ts';
import { EB_LEAK_EXEMPT, explainBackKeyLeaks, explainBackLeakId, formatExplainBackLeak, sameRepoKeyedQuizzes, type ExplainBackLeak } from '../factory/guards.ts';

export interface LeakLintRow {
  pack: string;
  leaks: Array<ExplainBackLeak & { id: string; exempt: boolean }>;
  /** EB_LEAK_EXEMPT ids for this pack that no longer fire */
  stale: string[];
}

export interface LeakLintReport {
  scanned: number;
  rows: LeakLintRow[];
}

export function leakLintReport(seedDir: string, exempt: Readonly<Record<string, readonly string[]>> = EB_LEAK_EXEMPT): LeakLintReport {
  const packs = findPacks(seedDir).filter((d) => basename(join(d, '..')) === 'explainback');
  const rows: LeakLintRow[] = [];
  const cache = new Map<string, ReturnType<typeof sameRepoKeyedQuizzes>>();
  for (const dir of packs) {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { name: string; source: { repo: string } };
    const items = (JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')) as { items: SeedItem[] }).items;
    if (!cache.has(m.source.repo)) cache.set(m.source.repo, sameRepoKeyedQuizzes(seedDir, m.source.repo));
    const quizzes = cache.get(m.source.repo)!;
    const allowed = new Set(exempt[m.name] ?? []);
    const leaks = items.flatMap((it) => (it.kind === 'explain-back' ? explainBackKeyLeaks(it, quizzes) : [])).map((l) => ({ ...l, id: explainBackLeakId(l), exempt: allowed.has(explainBackLeakId(l)) }));
    const stale = [...allowed].filter((id) => !leaks.some((l) => l.id === id));
    if (leaks.length || stale.length) rows.push({ pack: m.name, leaks, stale });
  }
  for (const p of Object.keys(exempt)) if (!packs.some((d) => basename(d) === p)) rows.push({ pack: p, leaks: [], stale: [...exempt[p]!] });
  return { scanned: packs.length, rows };
}

export const leakLintCounts = (r: LeakLintReport) => {
  const all = r.rows.flatMap((x) => x.leaks);
  return { leaks: all.length, exempt: all.filter((l) => l.exempt).length, stale: r.rows.reduce((n, x) => n + x.stale.length, 0), packs: r.rows.filter((x) => x.leaks.length).length };
};

export function formatLeakLintReport(r: LeakLintReport): string[] {
  const c = leakLintCounts(r);
  const out = ['seed:lint:leaks — explain-back key points vs keyed answers of same-repo quest packs'];
  for (const row of r.rows) {
    for (const l of row.leaks) out.push(`${l.exempt ? 'LEAK(exempt)' : 'LEAK        '} explainback/${row.pack} ${l.item.split('/').pop()} ${formatExplainBackLeak(l).replace(/^eb-leak: /, '')}`);
    for (const s of row.stale) out.push(`STALE        explainback/${row.pack}: EB_LEAK_EXEMPT names "${s}" but it no longer leaks — delete it`);
  }
  out.push(`${r.scanned} explain-back pack(s) scanned: ${c.leaks} leak(s) in ${c.packs} pack(s) (${c.exempt} tolerated by seed:check via EB_LEAK_EXEMPT), ${c.stale} stale exemption(s)`);
  out.push(`RESULT ${c.leaks || c.stale ? 'LEAKS' : 'OK'}`);
  return out;
}
