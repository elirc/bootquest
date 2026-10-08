/**
 * seed:patches — defective-patch katas built from the estate's real findings:
 * {diff (unified), contextFiles, seededDefectKey: [{scenario, evidence file:line, consequence}]}.
 *
 * Validator (spec §7 + W5a brief):
 *   - the seeded-defect list is non-empty; every entry has scenario + consequence;
 *   - every evidence file:line resolves: `in: 'repo'` at the pinned sha (P4 resolver),
 *     `in: 'patched'` inside the kata's patched context;
 *   - verbatim context files are byte-identical to the repo at the pinned sha;
 *   - the diff APPLIES cleanly to the context (`git apply --check` in a temp dir with
 *     GIT_CEILING_DIRECTORIES set, so a parent repo can never capture it), touches only
 *     context files, and changes something;
 *   - where a test is provided it PASSES on the context and FAILS (a named test, not a
 *     crash) on the defective version, executed by the real runner (same harness as
 *     seed:variants);
 *   - context / diff text is secret-scanned; excluded files drop the kata (counted).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SeedItem, type SeedPatchKataItem } from '@bootquest/shared';
import { buildRepoIndex, resolveCitation } from '../../citations/resolve.ts';
import { pinFile, type Checkout } from '../checkout.ts';
import { resolveAt } from '../cite.ts';
import type { Exclusions } from '../exclusions.ts';
import { describeFailures, execute, failsAsVerdict, type Harness } from '../harness/harness.ts';
import type { ItemVerdict } from '../quests/validate.ts';
import { checkProvenance } from '../quests/validate.ts';

/** Lines a..b of a file as stored in a verbatim context (each line keeps its own terminator). */
export function sliceLines(text: string, a: number, b: number): string {
  const parts = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return parts.slice(a - 1, b).join('');
}

/** Files a unified diff targets (b-side; a-side for deletions). */
export function diffTargets(diff: string): string[] {
  const out = new Set<string>();
  const lines = diff.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\+\+\+ (.+?)\r?$/.exec(lines[i]!);
    if (!m) continue;
    let p = m[1]!.replace(/\t.*$/, '');
    if (p === '/dev/null') {
      const a = /^--- (.+?)\r?$/.exec(lines[i - 1] ?? '');
      p = a ? a[1]!.replace(/\t.*$/, '') : p;
    }
    out.add(p.replace(/^[ab]\//, ''));
  }
  return [...out].sort();
}

export interface ApplyResult {
  ok: boolean;
  dir: string;
  error?: string;
}

/** Write the context to a fresh temp dir and `git apply` the diff there (check first). Caller removes dir. */
export function applyInTemp(contextFiles: ReadonlyArray<{ path: string; content: string }>, diff: string): ApplyResult {
  const dir = mkdtempSync(join(tmpdir(), 'bq-kata-'));
  for (const f of contextFiles) {
    const abs = join(dir, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
  const patch = join(dir, '.kata.patch');
  writeFileSync(patch, diff);
  // never let git discover a repo above the temp dir (this machine's home dir IS a repo)
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir).replace(/\\/g, '/') };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', '--whitespace=nowarn', ...args, '.kata.patch'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    git(['--check']);
    git([]);
  } catch (err) {
    const e = err as { stderr?: Buffer; message?: string };
    return { ok: false, dir, error: (e.stderr?.toString('utf8') || e.message || 'git apply failed').trim().slice(0, 400) };
  } finally {
    rmSync(patch, { force: true });
  }
  return { ok: true, dir };
}

export async function validatePatchKata(co: Checkout, ex: Exclusions, h: Harness, candidate: unknown): Promise<ItemVerdict> {
  const parsed = SeedItem.safeParse(candidate);
  if (!parsed.success) return { verdict: 'reject', reason: `schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  const item = parsed.data;
  if (item.kind !== 'patch-kata') return { verdict: 'reject', reason: `seed:patches cannot emit ${item.kind}` };
  return validateKataItem(co, ex, h, item);
}

export async function validateKataItem(co: Checkout, ex: Exclusions, h: Harness, item: SeedPatchKataItem): Promise<ItemVerdict> {
  const prov = checkProvenance(co, ex, item.provenance);
  if (prov.excluded) return { verdict: 'drop', reason: prov.excluded };
  for (const f of item.contextFiles) {
    const hit = ex.path(co.repo, f.origin.repoPath);
    if (hit) return { verdict: 'drop', reason: `context ${f.path} comes from ${f.origin.repoPath}: ${hit.reason}` };
  }
  for (const d of item.seededDefectKey) {
    if (d.evidence.in !== 'repo') continue;
    const hit = ex.path(co.repo, d.evidence.path);
    if (hit) return { verdict: 'drop', reason: `defect evidence ${d.evidence.path}: ${hit.reason}` };
  }
  const why: string[] = [];
  if (prov.error) why.push(prov.error);
  const secrets = ex.scan([item.diff, ...item.contextFiles.map((f) => f.content)].join('\n'));
  if (secrets.length) return { verdict: 'reject', reason: `UNREGISTERED SECRET: kata text matches ${secrets.join(', ')}` };
  if (item.seededDefectKey.length === 0) why.push('seeded-defect key is empty (a kata needs >= 1 defect)');

  // verbatim context must equal the repo bytes at the pinned sha
  const paths = new Set<string>();
  for (const f of item.contextFiles) {
    if (paths.has(f.path)) why.push(`duplicate context file ${f.path}`);
    paths.add(f.path);
    if (f.origin.kind !== 'verbatim') continue;
    if (!co.fullIndex.files.has(f.origin.repoPath)) {
      why.push(`verbatim context ${f.path}: ${f.origin.repoPath} not in the repo at the pinned sha`);
      continue;
    }
    const repoText = readFileSync(join(co.root, f.origin.repoPath), 'utf8');
    pinFile(co, f.origin.repoPath);
    const want = f.origin.lines ? sliceLines(repoText, f.origin.lines.start, f.origin.lines.end) : repoText;
    if (want !== f.content) why.push(`verbatim context ${f.path} differs from ${f.origin.repoPath}${f.origin.lines ? `:${f.origin.lines.start}-${f.origin.lines.end}` : ''} at the pinned sha`);
  }

  // evidence in the repo
  for (const [i, d] of item.seededDefectKey.entries()) {
    if (d.evidence.in !== 'repo') continue;
    const r = resolveAt(co, item.provenance.path, { path: d.evidence.path, lineStart: d.evidence.lineStart, lineEnd: d.evidence.lineEnd, form: 'path-line', raw: `${d.evidence.path}:${d.evidence.lineStart}`, source: { file: item.provenance.path, line: 1, column: 1 }, group: 0 });
    if (r.status === 'error') why.push(`defect ${i + 1} evidence ${d.evidence.path}:${d.evidence.lineStart}-${d.evidence.lineEnd} (repo) -> ${r.reason}: ${r.message}`);
    else if (r.kind === 'file') pinFile(co, r.file);
  }

  const targets = diffTargets(item.diff);
  if (targets.length === 0) why.push('diff has no file headers (not a unified diff)');
  for (const t of targets) if (!paths.has(t)) why.push(`diff touches ${t}, which is not a context file`);
  if (why.length) return { verdict: 'reject', reason: why.join(' ; ') };

  const applied = applyInTemp(item.contextFiles, item.diff);
  try {
    if (!applied.ok) return { verdict: 'reject', reason: `diff does not apply cleanly to the context: ${applied.error}` };
    const patched = new Map<string, string>();
    let changed = 0;
    for (const f of item.contextFiles) {
      const now = readFileSync(join(applied.dir, f.path), 'utf8');
      patched.set(f.path, now);
      if (now !== f.content) changed++;
    }
    if (changed === 0) why.push('the diff applies but changes nothing');
    const pIndex = buildRepoIndex(applied.dir);
    for (const [i, d] of item.seededDefectKey.entries()) {
      if (d.evidence.in !== 'patched') continue;
      const r = resolveCitation(applied.dir, '', { path: d.evidence.path, lineStart: d.evidence.lineStart, lineEnd: d.evidence.lineEnd, form: 'path-line', raw: d.evidence.path, source: { file: '', line: 1, column: 1 }, group: 0 }, pIndex);
      if (r.status === 'error') why.push(`defect ${i + 1} evidence ${d.evidence.path}:${d.evidence.lineStart}-${d.evidence.lineEnd} (patched) -> ${r.reason}: ${r.message}`);
    }
    if (item.test) {
      const before = item.contextFiles.find((f) => f.path === item.test!.module);
      if (!before) why.push(`test module ${item.test.module} is not a context file`);
      else {
        const clean = await execute(h, item.test.check, before.content);
        if (!clean.ok) why.push(`test not executed on the context: ${clean.reason}`);
        else if (!clean.result.pass) why.push(`the test does not PASS on the un-patched context: ${describeFailures(clean.result)}`);
        const bad = await execute(h, item.test.check, patched.get(before.path)!);
        if (!bad.ok) why.push(`test not executed on the defective version: ${bad.reason}`);
        else if (bad.result.pass) why.push('the test PASSES on the defective version (it must fail there)');
        else {
          const v = failsAsVerdict(bad.result);
          if (!v.ok) why.push(`the defective version ${v.why} — it must load and fail a named test`);
        }
      }
    }
  } finally {
    rmSync(applied.dir, { recursive: true, force: true });
  }
  if (why.length) return { verdict: 'reject', reason: why.join(' ; ') };
  return { verdict: 'accept', item };
}
