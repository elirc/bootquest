/**
 * One-shot migration (run by the orchestrator in the app repo, foreground):
 * repair seed packs whose pins were taken from autocrlf-converted checkouts.
 *
 * This machine's SYSTEM gitconfig sets core.autocrlf=true, and `git archive`
 * honours it: every LF text file came out of the old recipe with CRLF bytes, so
 * the manifests recorded blob ids git never had at the pinned sha, and verbatim
 * kata context files (and the diffs/specs built on them) carry CRs the repo does
 * not. The rule enforced is BYTE IDENTITY with git's blob (a repo's own CRLF
 * files keep their CRs).
 *
 *   (a) every pinned (repo, sha) referenced by a manifest with >= 1 blob is checked
 *       out again from its mirror (pins.ts extractTree: fresh temp dir + rename;
 *       an existing checkout that already hashes clean is left alone);
 *   (b) each manifest's blob map is recomputed from `git ls-tree` and its pin set
 *       to 'git-tree';
 *   (c) patch katas: verbatim context files become the exact repo bytes; adapted
 *       files and diff sections whose origin blob is LF-only lose their CRs; the
 *       new diff must apply and patch to exactly the old result minus the CRs; the
 *       committed authoring drafts/specs (tools/seed/authoring/katas) get the same
 *       fix and, when the cache is the repo's own, katagen must reproduce the
 *       fixed draft byte-for-byte from the fixed spec + new checkout;
 *   (d) a pack whose bytes changed gets its stamp REBOUND to the new bytes with a
 *       zeroed fingerprint: it is NOT vouched for — every loader refuses it until
 *       `seed:check --restamp` (restamp:all) re-validates every item under the
 *       current validators and writes a real stamp.
 * Refuses (writes nothing) if any needed mirror is missing or lacks the sha, and
 * lists the fetch commands. Idempotent: a second run finds nothing to do.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { findPacks } from '../factory/check/check.ts';
import { applyInTemp, sliceLines } from '../factory/patches/patches.ts';
import { checkTreeShape, extractTree, fetchHint, findMirror, gitTree, mirrorRoots, type GitTree } from '../factory/pins.ts';
import { sha256, stableJson, stableKey } from '../factory/util.ts';

const ZERO_FP = '0'.repeat(64);
const lf = (s: string): string => s.replace(/\r\n/g, '\n');
const hasCr = (s: string): boolean => s.includes('\r');

export interface FixOptions {
  /** app repo root: content/seed + tools/seed/authoring/katas live here */
  root: string;
  /** default <root>/.cache (mirrors in repos/ + sources/, checkouts in checkouts/) */
  cacheDir?: string;
  /** only packs (and authoring files) whose source repo is listed */
  repos?: readonly string[];
  dryRun?: boolean;
  log?: (l: string) => void;
}

export interface FixReport {
  ok: boolean;
  /** missing mirrors (nothing was done) */
  refused: string[];
  checkouts: Array<{ pin: string; action: 'clean' | 're-extracted' | 'would re-extract'; problems: number }>;
  manifests: Array<{ pack: string; blobsChanged: number; pinChanged: boolean; itemsChanged: boolean }>;
  kataFiles: Array<{ pack: string; kata: string; file: string; kind: 'verbatim' | 'adapted'; repoPath: string; crs: number }>;
  authoring: Array<{ file: string; strings: number }>;
  stampsRebound: string[];
  failures: string[];
}

interface Pin {
  repo: string;
  sha: string;
  tree: GitTree;
  dir: string;
}

interface CtxFile {
  path: string;
  content?: string;
  origin: { kind: 'verbatim' | 'adapted'; repoPath: string; lines?: { start: number; end: number } };
}
interface KataLike {
  diff: string;
  contextFiles: CtxFile[];
}

/** Split a unified diff into per-file sections (`diff --git` headers), each with its b-side target. */
function diffSections(diff: string): Array<{ text: string; target: string | null }> {
  const parts = diff.split(/(?=^diff --git )/m);
  return parts.map((text) => {
    const m = /^\+\+\+ (?:b\/)?(.+?)\r?$/m.exec(text);
    return { text, target: m ? m[1]!.replace(/\t.*$/, '') : null };
  });
}

/** The bytes git has for `repoPath` at the pin (read from the verified fresh checkout), or null. */
function gitBytesOf(pin: Pin, repoPath: string): Buffer | null {
  if (!pin.tree.has(repoPath)) return null;
  return readFileSync(join(pin.dir, repoPath));
}

interface KataFix {
  changedFiles: Array<{ file: string; kind: 'verbatim' | 'adapted'; repoPath: string; crs: number }>;
  diffChanged: boolean;
  /** context paths whose CRs were removed (CR-only change) */
  converted: Set<string>;
  problems: string[];
}

/**
 * Fix one kata in place (items carry verbatim content; drafts omit it). A context
 * file is "LF-origin" when git's blob for its repoPath has no CR: any CR in its
 * content or its diff section can only have come from an autocrlf checkout.
 */
function fixKata(k: KataLike, pin: Pin, where: string): KataFix {
  const out: KataFix = { changedFiles: [], diffChanged: false, converted: new Set(), problems: [] };
  const lfOrigin = new Map<string, boolean>();
  for (const f of k.contextFiles) {
    const bytes = gitBytesOf(pin, f.origin.repoPath);
    if (!bytes) {
      if (f.content !== undefined && hasCr(f.content)) out.problems.push(`${where} ${f.path}: has CRs but ${f.origin.repoPath} is not in git at the pin`);
      continue;
    }
    const isLf = !bytes.includes(13);
    lfOrigin.set(f.path, isLf);
    if (f.origin.kind === 'verbatim') {
      if (f.content === undefined) {
        if (isLf) out.converted.add(f.path);
        continue;
      }
      const text = bytes.toString('utf8');
      const want = f.origin.lines ? sliceLines(text, f.origin.lines.start, f.origin.lines.end) : text;
      if (f.content === want) continue;
      if (lf(f.content) !== lf(want)) {
        out.problems.push(`${where} ${f.path}: verbatim content differs from ${f.origin.repoPath} at the pin beyond line endings`);
        continue;
      }
      const crs = (f.content.match(/\r/g) ?? []).length - (want.match(/\r/g) ?? []).length;
      f.content = want;
      out.converted.add(f.path);
      out.changedFiles.push({ file: f.path, kind: 'verbatim', repoPath: f.origin.repoPath, crs });
    } else if (f.content !== undefined && hasCr(f.content) && isLf) {
      const crs = (f.content.match(/\r/g) ?? []).length;
      f.content = lf(f.content);
      out.converted.add(f.path);
      out.changedFiles.push({ file: f.path, kind: 'adapted', repoPath: f.origin.repoPath, crs });
    }
  }
  const secs = diffSections(k.diff);
  const next = secs.map((s) => {
    if (!hasCr(s.text)) return s.text;
    if (s.target === null || !lfOrigin.has(s.target)) {
      out.problems.push(`${where}: diff section ${s.target ?? '(no +++ header)'} has CRs and targets no context file with a git origin`);
      return s.text;
    }
    return lfOrigin.get(s.target) ? lf(s.text) : s.text;
  });
  const diff = next.join('');
  if (diff !== k.diff) {
    k.diff = diff;
    out.diffChanged = true;
  }
  return out;
}

/** Old patched result vs new: the new diff must apply and differ from the old outcome only by the removed CRs. */
function proveKata(before: KataLike, after: KataLike, converted: ReadonlySet<string>, where: string): string[] {
  const full = (k: KataLike) => k.contextFiles.map((f) => ({ path: f.path, content: f.content ?? '' }));
  const a = applyInTemp(full(before), before.diff);
  const b = applyInTemp(full(after), after.diff);
  try {
    if (!b.ok) return [`${where}: fixed diff does not apply to the fixed context: ${b.error}`];
    if (!a.ok) return []; // the old pair never applied (nothing to compare against); the new one does
    const bad: string[] = [];
    for (const f of after.contextFiles) {
      const pa = readFileSync(join(a.dir, f.path), 'utf8');
      const pb = readFileSync(join(b.dir, f.path), 'utf8');
      if ((converted.has(f.path) ? lf(pa) : pa) !== pb) bad.push(`${where}: patched ${f.path} differs from the old patched result beyond the removed CRs`);
    }
    return bad;
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
}

/** Every string leaf (path, value) of a JSON value. */
function leaves(v: unknown, path = ''): Array<[string, string]> {
  if (typeof v === 'string') return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => leaves(x, `${path}.${k}`));
  return [];
}

/** stableJson must reproduce the file's bytes (else rewriting it would reformat it). */
function rewritable(file: string, bytes: string, failures: string[]): unknown | null {
  const v = JSON.parse(bytes) as unknown;
  if (stableJson(v) !== bytes) {
    failures.push(`${file}: not in stableJson form (1-space indent + trailing newline); refusing to rewrite it`);
    return null;
  }
  return v;
}

interface SpecKata {
  id: string;
  provenance: { path: string; find?: string };
  contextFiles: Array<{ path: string; repoPath: string; kind: 'verbatim' | 'adapted'; content?: string }>;
  edits: Array<{ path: string; find: string; replace: string }>;
  defects: Array<{ in: 'repo' | 'patched'; path: string; find?: string }>;
}

/** Spec strings carry text found in repo files: strip CRs from those whose referenced blob is LF-only. */
function fixSpec(spec: { katas: SpecKata[] }, pin: Pin, file: string, problems: string[]): number {
  let n = 0;
  const lfBlob = (repoPath: string): boolean | null => {
    const b = gitBytesOf(pin, repoPath);
    return b ? !b.includes(13) : null;
  };
  const fix = (s: string | undefined, repoPath: string | undefined, where: string): string | undefined => {
    if (s === undefined || !hasCr(s)) return s;
    const isLf = repoPath === undefined ? null : lfBlob(repoPath);
    if (isLf === null) {
      problems.push(`${file} ${where}: has CRs but references no file in git at the pin`);
      return s;
    }
    if (!isLf) return s;
    n++;
    return lf(s);
  };
  for (const k of spec.katas) {
    const ctx = new Map(k.contextFiles.map((c) => [c.path, c.repoPath]));
    k.provenance.find = fix(k.provenance.find, k.provenance.path, `${k.id} provenance.find`);
    for (const c of k.contextFiles) c.content = fix(c.content, c.repoPath, `${k.id} context ${c.path}`);
    for (const e of k.edits) {
      e.find = fix(e.find, ctx.get(e.path), `${k.id} edit ${e.path} find`)!;
      e.replace = fix(e.replace, ctx.get(e.path), `${k.id} edit ${e.path} replace`)!;
    }
    for (const d of k.defects) d.find = fix(d.find, d.in === 'repo' ? d.path : ctx.get(d.path), `${k.id} defect ${d.path}`);
  }
  return n;
}

export function runFixCrlfPins(o: FixOptions): FixReport {
  const log = o.log ?? (() => {});
  const root = resolve(o.root);
  const cacheDir = resolve(o.cacheDir ?? join(root, '.cache'));
  const seedDir = join(root, 'content', 'seed');
  const kataDir = join(root, 'tools', 'seed', 'authoring', 'katas');
  const only = o.repos?.length ? new Set(o.repos) : null;
  const rep: FixReport = { ok: false, refused: [], checkouts: [], manifests: [], kataFiles: [], authoring: [], stampsRebound: [], failures: [] };
  const write = (file: string, bytes: string) => {
    if (!o.dryRun) writeFileSync(file, bytes);
  };

  // ---- scope: manifests with >= 1 pinned blob ----
  const packs: Array<{ dir: string; pack: string; raw: string; m: { generator: string; name: string; source: { repo: string; sha: string; pin: string }; blobs: Record<string, string>; items: { sha256: string } } }> = [];
  for (const dir of findPacks(seedDir)) {
    const raw = readFileSync(join(dir, 'manifest.json'), 'utf8');
    const m = JSON.parse(raw);
    if (only && !only.has(m.source.repo)) continue;
    const pack = `${basename(resolve(dir, '..'))}/${basename(dir)}`;
    if (Object.keys(m.blobs).length === 0) {
      log(`skip  ${pack}: no blobs pinned (nothing to re-pin)`);
      continue;
    }
    packs.push({ dir, pack, raw, m });
  }
  const pinKeys = [...new Set(packs.map((p) => `${p.m.source.repo}@${p.m.source.sha}`))].sort();
  const roots = mirrorRoots(cacheDir);
  const mirrors = new Map<string, { mirror: string; commit: string }>();
  for (const key of pinKeys) {
    const [repo, sha] = key.split('@') as [string, string];
    const f = findMirror(repo, sha, roots);
    if (f.found) mirrors.set(key, f);
    else rep.refused.push(`${key}: ${f.why === 'no-mirror' ? 'no mirror' : `mirror ${f.mirrors.join(', ')} lacks the sha`}\n    ${fetchHint(repo, sha, cacheDir)}`);
  }
  log(`[fix-crlf-pins] root ${root}; cache ${cacheDir}; ${packs.length} pack(s) over ${pinKeys.length} pin(s)${only ? ` (repos ${[...only].join(', ')})` : ''}${o.dryRun ? ' — DRY RUN' : ''}`);
  if (rep.refused.length) {
    log(`REFUSED: ${rep.refused.length} pinned repo(s) have no mirror holding the sha; nothing was changed. Fetch them (Git Bash, from ${root}):`);
    for (const r of rep.refused) log(`  ${r}`);
    return rep;
  }

  // ---- (a) fresh, verified checkouts ----
  const pins = new Map<string, Pin>();
  const t0 = Date.now();
  for (const [i, key] of pinKeys.entries()) {
    const [repo, sha] = key.split('@') as [string, string];
    const { mirror, commit } = mirrors.get(key)!;
    const tree = gitTree(mirror, commit);
    if (pinKeys.length > 1) log(`[${i + 1}/${pinKeys.length}] ${key.slice(0, key.indexOf('@') + 13)}: ${tree.size} blob(s) (${Math.round((Date.now() - t0) / 1000)}s)`);
    const dir = join(cacheDir, 'checkouts', `${repo}@${sha}`);
    const before = existsSync(dir) ? checkTreeShape(dir, tree, { deep: true }) : ['(absent)'];
    if (before.length === 0) {
      rep.checkouts.push({ pin: key, action: 'clean', problems: 0 });
      pins.set(key, { repo, sha, tree, dir });
      continue;
    }
    if (o.dryRun) {
      rep.checkouts.push({ pin: key, action: 'would re-extract', problems: before.length });
      log(`would re-extract ${key}: ${before.length} problem(s), e.g. ${before[0]}`);
      // a dry run reads git's bytes through a throwaway extraction
      const tmp = mkdtempSync(join(tmpdir(), 'bq-pins-'));
      extractTree(mirror, commit, join(tmp, 'co'));
      pins.set(key, { repo, sha, tree, dir: join(tmp, 'co') });
      continue;
    }
    try {
      extractTree(mirror, commit, dir);
    } catch (err) {
      rep.failures.push(`${key}: extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const after = checkTreeShape(dir, tree, { deep: true });
    if (after.length) {
      rep.failures.push(`${key}: re-extracted checkout still differs from git: ${after.slice(0, 3).join('; ')}`);
      continue;
    }
    rep.checkouts.push({ pin: key, action: 're-extracted', problems: before.length });
    log(`re-extracted ${key} (${before.length} problem(s) before, e.g. ${before[0]})`);
    pins.set(key, { repo, sha, tree, dir });
  }

  // ---- (b) + (c) manifests and kata items ----
  const fixedDrafts = new Map<string, Map<string, string>>(); // pack name -> kata id -> fixed diff (from items)
  for (const p of packs) {
    const key = `${p.m.source.repo}@${p.m.source.sha}`;
    const pin = pins.get(key);
    if (!pin) {
      rep.failures.push(`${p.pack}: its checkout ${key} could not be made byte-identical; pack left untouched`);
      continue;
    }
    const failuresBefore = rep.failures.length;
    const m = rewritable(join(p.dir, 'manifest.json'), p.raw, rep.failures) as typeof p.m | null;
    if (!m) continue;
    let blobsChanged = 0;
    for (const [rel, id] of Object.entries(m.blobs)) {
      const e = pin.tree.get(rel);
      if (!e) {
        rep.failures.push(`${p.pack}: ${rel} is not in git at ${key.slice(0, key.indexOf('@') + 13)}; cannot re-pin it`);
        continue;
      }
      if (e.id !== id) {
        m.blobs[rel] = e.id;
        blobsChanged++;
      }
    }
    const pinChanged = m.source.pin !== 'git-tree';
    m.source.pin = 'git-tree';

    let itemsChanged = false;
    let itemsBytes: string | null = null;
    if (m.generator === 'patches') {
      const itemsPath = join(p.dir, 'items.json');
      const rawItems = readFileSync(itemsPath, 'utf8');
      const file = rewritable(itemsPath, rawItems, rep.failures) as { items: Array<KataLike & { key: string }> } | null;
      if (!file) continue;
      const ids = new Map<string, string>();
      for (const it of file.items) {
        const before = JSON.parse(JSON.stringify(it)) as KataLike;
        const fx = fixKata(it, pin, `${p.pack} ${it.key}`);
        rep.failures.push(...fx.problems);
        for (const c of fx.changedFiles) rep.kataFiles.push({ pack: p.pack, kata: it.key, ...c });
        if (fx.changedFiles.length || fx.diffChanged) {
          itemsChanged = true;
          rep.failures.push(...proveKata(before, it, fx.converted, `${p.pack} ${it.key}`));
        }
        for (const [leaf, s] of leaves(it)) {
          if (!hasCr(s)) continue;
          if (leaf === '.diff') continue; // checked per section in fixKata
          const cm = /^\.contextFiles\[(\d+)\]\.content$/.exec(leaf);
          const cf = cm ? it.contextFiles[Number(cm[1])] : undefined;
          const b = cf ? gitBytesOf(pin, cf.origin.repoPath) : null;
          if (!(b && b.includes(13))) rep.failures.push(`${p.pack} ${it.key}${leaf}: still has CRs not in git`);
        }
        ids.set(it.key, it.diff);
      }
      fixedDrafts.set(m.name, ids);
      // ALWAYS bind the manifest to the items bytes that will be on disk (re-written or as found): a
      // run interrupted after writing items.json but before manifest.json resumes cleanly, instead of
      // leaving a manifest whose items sha256 no loader accepts (the fixed items are a fixpoint, so
      // the re-run sees itemsChanged=false). The zeroed stamp fingerprint below still forces a full
      // seed:check --restamp re-validation of whatever these bytes are.
      itemsBytes = itemsChanged ? stableJson(file) : rawItems;
      if (sha256(itemsBytes) !== m.items.sha256) {
        if (!itemsChanged) log(`resume ${p.pack}: items.json was already fixed by an interrupted run; re-binding the manifest to it`);
        m.items.sha256 = sha256(itemsBytes);
      }
    }
    if (rep.failures.length > failuresBefore) continue; // never write a half-fixed pack
    const manifestBytes = stableJson(m);
    if (manifestBytes === p.raw) continue;
    const sp = join(p.dir, 'validation.json');
    let stampBytes: string | null = null;
    if (existsSync(sp)) {
      const rawStamp = readFileSync(sp, 'utf8');
      const st = rewritable(sp, rawStamp, rep.failures) as { manifestSha256: string; itemsSha256: string; fingerprint: string } | null;
      if (!st) continue; // nothing written yet: the pack stays as it was
      st.manifestSha256 = sha256(manifestBytes);
      if (itemsBytes !== null) st.itemsSha256 = sha256(itemsBytes);
      st.fingerprint = ZERO_FP;
      stampBytes = stableJson(st);
    }
    rep.manifests.push({ pack: p.pack, blobsChanged, pinChanged, itemsChanged });
    log(`re-pin ${p.pack}: ${blobsChanged}/${Object.keys(m.blobs).length} blob id(s) were not git's${pinChanged ? '; pin -> git-tree' : ''}${itemsChanged ? '; kata items fixed' : ''}`);
    // write order: stamp (zeroed: the old stamp stops vouching first), items, manifest LAST. Every
    // interrupted state re-runs to the same result: the manifest is only rewritten once the bytes it
    // binds are on disk, and the re-run re-derives every sha from the bytes it finds.
    if (stampBytes !== null) {
      write(sp, stampBytes);
      rep.stampsRebound.push(p.pack);
    }
    if (itemsChanged && itemsBytes !== null) write(join(p.dir, 'items.json'), itemsBytes);
    write(join(p.dir, 'manifest.json'), manifestBytes);
  }

  // ---- (c) authoring drafts + specs ----
  const patchPins = new Map<string, string>(); // patches pack name -> repo@sha
  for (const p of packs) if (p.m.generator === 'patches') patchPins.set(p.m.name, `${p.m.source.repo}@${p.m.source.sha}`);
  const katagenChecks: Array<{ spec: string; draft: string; draftBytes: string; specBytes: string }> = [];
  if (existsSync(kataDir)) {
    const files = readdirSync(kataDir).filter((f) => f.endsWith('.draft.json') || f.endsWith('.spec.json')).sort();
    const fixedText = new Map<string, string>();
    for (const f of files) {
      const path = join(kataDir, f);
      const raw = readFileSync(path, 'utf8');
      const v = JSON.parse(raw) as { name: string; checkout?: string; katas: unknown[] };
      const key = f.endsWith('.spec.json') ? (v.checkout ? basename(v.checkout) : undefined) : patchPins.get(v.name);
      if (!key || !pins.has(key)) continue; // out of scope (or not a pinned kata pack)
      const pin = pins.get(key)!;
      const before = rep.failures.length;
      const obj = rewritable(path, raw, rep.failures) as typeof v | null;
      if (!obj) continue;
      let n = 0;
      if (f.endsWith('.spec.json')) {
        n = fixSpec(obj as unknown as { katas: SpecKata[] }, pin, f, rep.failures);
      } else {
        const fixedItems = fixedDrafts.get(v.name);
        for (const k of obj.katas as Array<KataLike & { id: string }>) {
          const fx = fixKata(k, pin, `${f} ${k.id}`);
          rep.failures.push(...fx.problems);
          n += fx.changedFiles.length + (fx.diffChanged ? 1 : 0);
          const itemDiff = fixedItems?.get(stableKey('patches', pin.repo, 'patch-kata', [v.name, k.id]));
          if (itemDiff !== undefined && itemDiff !== k.diff) rep.failures.push(`${f} ${k.id}: fixed draft diff != fixed shipped item diff`);
        }
      }
      for (const [leaf, s] of leaves(obj)) {
        if (!hasCr(s)) continue;
        // what is left must belong to a CRLF file in git (fixKata/fixSpec decided per reference)
        if (!/(\.diff|\.content|\.find|\.replace)$/.test(leaf)) rep.failures.push(`${f}${leaf}: has CRs outside any repo-derived field`);
      }
      if (rep.failures.length > before) continue;
      const bytes = stableJson(obj);
      fixedText.set(f, bytes);
      if (bytes !== raw) {
        rep.authoring.push({ file: f, strings: n });
        log(`fix   authoring/katas/${f}: ${n} CR-contaminated string(s)/file(s)`);
        write(path, bytes);
      }
    }
    for (const f of files.filter((x) => x.endsWith('.spec.json'))) {
      const draft = f.replace(/\.spec\.json$/, '.draft.json');
      if (fixedText.has(f) && fixedText.has(draft)) katagenChecks.push({ spec: f, draft, specBytes: fixedText.get(f)!, draftBytes: fixedText.get(draft)! });
    }
  }
  // katagen must rebuild each fixed draft from its fixed spec + the new checkout (only when the
  // cache is the repo's own: specs name `.cache/checkouts/...` relative to the repo root)
  const katagen = join(root, 'tools', 'seed', 'authoring', 'katagen.mjs');
  if (!o.dryRun && resolve(cacheDir) === resolve(root, '.cache') && existsSync(katagen)) {
    for (const c of katagenChecks) {
      const tmp = mkdtempSync(join(tmpdir(), 'bq-katagen-'));
      try {
        writeFileSync(join(tmp, 'spec.json'), c.specBytes);
        execFileSync(process.execPath, [katagen, join(tmp, 'spec.json'), join(tmp, 'draft.json')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        if (readFileSync(join(tmp, 'draft.json'), 'utf8') !== c.draftBytes) rep.failures.push(`katagen(${c.spec}) does not reproduce ${c.draft} after the fix`);
      } catch (err) {
        const e = err as { stderr?: Buffer; message?: string };
        rep.failures.push(`katagen(${c.spec}) failed: ${(e.stderr?.toString('utf8') || e.message || '').trim().slice(0, 300)}`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    if (katagenChecks.length) log(`katagen reproduced ${katagenChecks.length - rep.failures.filter((x) => x.startsWith('katagen(')).length}/${katagenChecks.length} fixed draft(s) from their fixed specs`);
  }

  if (o.dryRun) for (const p of pins.values()) if (p.dir.startsWith(tmpdir())) rmSync(resolve(p.dir, '..'), { recursive: true, force: true });
  rep.ok = rep.failures.length === 0;
  return rep;
}

export function printSummary(rep: FixReport, log: (l: string) => void): void {
  log('---- summary ----');
  if (rep.refused.length) {
    log(`REFUSED: ${rep.refused.length} missing mirror(s); nothing changed`);
    return;
  }
  const by = (a: string) => rep.checkouts.filter((c) => c.action === a).length;
  log(`checkouts: ${rep.checkouts.length} pin(s): ${by('clean')} already byte-identical, ${by('re-extracted')} re-extracted${by('would re-extract') ? `, ${by('would re-extract')} would be re-extracted` : ''}`);
  log(`manifests rewritten: ${rep.manifests.length} (${rep.manifests.filter((m) => m.blobsChanged > 0).length} had CRLF-derived blob ids, ${rep.manifests.reduce((a, m) => a + m.blobsChanged, 0)} id(s) total; ${rep.manifests.filter((m) => m.itemsChanged).length} with kata items fixed)`);
  log(`kata context files converted to the repo's bytes: ${rep.kataFiles.length}`);
  for (const k of rep.kataFiles) log(`  ${k.pack} ${k.kata.split('/').pop()} ${k.file} (${k.kind} <- ${k.repoPath}): ${k.crs} CR(s) removed`);
  log(`authoring files fixed: ${rep.authoring.length}${rep.authoring.length ? ` (${rep.authoring.map((a) => a.file).join(', ')})` : ''}`);
  log(`stamps rebound (zeroed fingerprint: seed:check --restamp must re-validate): ${rep.stampsRebound.length}`);
  if (rep.failures.length) {
    log(`FAILURES (${rep.failures.length}):`);
    for (const f of rep.failures) log(`  ${f}`);
  }
  log(`RESULT ${rep.ok ? 'OK' : 'FAIL'}`);
}
