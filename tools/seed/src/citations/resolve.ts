/**
 * Citation resolution against a plain directory tree (spec §7).
 *
 * The caller pins the SHA (hands us a checkout / extracted tarball); we only see files.
 * Order: root-relative -> guide-file-relative -> unique path-suffix. All lookups go through
 * an exact-case index of the tree, so results are identical on case-insensitive Windows
 * and case-sensitive Linux clones.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Citation } from './parse.ts';

export type ResolveVia = 'root' | 'guide' | 'suffix';

export type ResolveErrorReason =
  | 'malformed'
  | 'orphan-continuation'
  | 'missing-file'
  | 'ambiguous-suffix'
  | 'not-a-file'
  | 'line-out-of-range'
  | 'escapes-repo';

export type Resolution =
  | {
      status: 'ok';
      /** Repo-relative, '/'-separated, exact case. */
      file: string;
      /** null for path-only citations. */
      lineStart: number | null;
      lineEnd: number | null;
      via: ResolveVia;
      kind: 'file' | 'dir';
    }
  | {
      status: 'error';
      reason: ResolveErrorReason;
      message: string;
      /** Repo-relative matches, for ambiguous-suffix. */
      candidates?: string[];
    };

export interface RepoIndex {
  root: string;
  files: Set<string>;
  dirs: Set<string>;
  lineCounts: Map<string, number>;
}

/** Directories never indexed (never cited by guides as code; huge). */
export const DEFAULT_EXCLUDED_DIRS = ['.git', 'node_modules'];

/**
 * Index every file and directory under repoRoot.
 * `excludeDirs`: a bare name (`node_modules`) skips that name at any depth; an entry containing
 * '/' (`astraupskill/snapshots`) skips that exact repo-relative directory — useful when a guide
 * tree carries code snapshots that would make bare-filename suffixes ambiguous.
 */
export function buildRepoIndex(repoRoot: string, excludeDirs: string[] = DEFAULT_EXCLUDED_DIRS): RepoIndex {
  const root = path.resolve(repoRoot);
  const files = new Set<string>();
  const dirs = new Set<string>();
  const byName = new Set(excludeDirs.filter((d) => !d.includes('/')));
  const byPath = new Set(excludeDirs.filter((d) => d.includes('/')).map((d) => d.replace(/^\/+|\/+$/g, '')));
  const walk = (abs: string, rel: string) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (byName.has(ent.name) || byPath.has(r)) continue;
        dirs.add(r);
        walk(path.join(abs, ent.name), r);
      } else if (ent.isFile()) {
        files.add(r);
      }
    }
  };
  walk(root, '');
  return { root, files, dirs, lineCounts: new Map() };
}

/** Number of lines as an editor shows them: "a\nb\n" and "a\nb" both have 2; "" has 0. */
export function countLines(content: string): number {
  if (content.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) n++;
  return content.endsWith('\n') ? n : n + 1;
}

function lineCount(index: RepoIndex, rel: string): number {
  let n = index.lineCounts.get(rel);
  if (n === undefined) {
    n = countLines(fs.readFileSync(path.join(index.root, rel), 'utf8'));
    index.lineCounts.set(rel, n);
  }
  return n;
}

/** Collapse '.' and '..' in a '/'-path; returns null if it climbs above the start. */
function collapse(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

function guideRelDir(index: RepoIndex, guidePath: string): string {
  const g = guidePath.replace(/\\/g, '/');
  const abs = path.isAbsolute(guidePath) ? guidePath : path.join(index.root, g);
  const rel = path.relative(index.root, path.dirname(abs)).replace(/\\/g, '/');
  return rel === '' ? '' : rel;
}

function lookup(index: RepoIndex, rel: string, wantDir: boolean): 'file' | 'dir' | null {
  if (wantDir) return index.dirs.has(rel) ? 'dir' : index.files.has(rel) ? 'file' : null;
  return index.files.has(rel) ? 'file' : index.dirs.has(rel) ? 'dir' : null;
}

/**
 * Resolve one citation. `guidePath` is repo-relative (or absolute inside repoRoot).
 * Pass a prebuilt `index` when resolving many citations against one tree.
 */
export function resolveCitation(
  repoRoot: string,
  guidePath: string,
  citation: Citation,
  index: RepoIndex = buildRepoIndex(repoRoot),
): Resolution {
  if (citation.path === null) {
    return { status: 'error', reason: 'orphan-continuation', message: citation.malformed ?? 'continuation with no file to inherit' };
  }
  if (citation.malformed) return { status: 'error', reason: 'malformed', message: citation.malformed };

  const hasLines = citation.lineStart !== null || citation.lineEnd !== null;
  if (hasLines) {
    const s = citation.lineStart;
    const e = citation.lineEnd;
    if (s === null || e === null || !Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < s) {
      return { status: 'error', reason: 'malformed', message: `invalid line range ${s}-${e} (need 1 <= start <= end)` };
    }
  }

  const raw = citation.path.replace(/\\/g, '/');
  const wantDir = raw.endsWith('/');
  const tries: Array<{ via: ResolveVia; rel: string | null }> = [];
  if (raw.startsWith('/')) {
    tries.push({ via: 'root', rel: collapse(raw) });
  } else {
    tries.push({ via: 'root', rel: collapse(raw) });
    const gdir = guideRelDir(index, guidePath);
    tries.push({ via: 'guide', rel: collapse(gdir ? `${gdir}/${raw}` : raw) });
  }

  let found: { via: ResolveVia; rel: string; kind: 'file' | 'dir' } | null = null;
  for (const t of tries) {
    if (t.rel === null || t.rel === '') continue;
    const kind = lookup(index, t.rel, wantDir);
    if (kind) {
      found = { via: t.via, rel: t.rel, kind };
      break;
    }
  }

  if (!found && !raw.startsWith('/')) {
    // unique-suffix match on whole path segments; leading ./ and ../ segments are dropped
    const suffix = raw
      .split('/')
      .filter((s) => s !== '' && s !== '.' && s !== '..')
      .join('/');
    if (suffix) {
      const pool = wantDir ? index.dirs : index.files;
      let candidates = [...pool].filter((f) => f === suffix || f.endsWith(`/${suffix}`)).sort();
      if (candidates.length === 1) {
        found = { via: 'suffix', rel: candidates[0]!, kind: wantDir ? 'dir' : 'file' };
      } else if (candidates.length > 1) {
        // Factory fix 5: app-root-aware scoping — in a multi-app tree a guide's bare suffix
        // usually means the file in ITS OWN app. Walk the guide's ancestor dirs innermost ->
        // outermost; the first scope with matches decides (1 -> resolve, 2+ -> ambiguous with
        // the scoped candidates). No scope match anywhere -> the original global ambiguity.
        // Runs ONLY when matches > 1, so every previously-unique resolution is unchanged.
        for (let scope = guideRelDir(index, guidePath); scope !== ''; scope = scope.includes('/') ? scope.slice(0, scope.lastIndexOf('/')) : '') {
          const scoped = candidates.filter((f) => f.startsWith(`${scope}/`));
          if (scoped.length === 1) {
            found = { via: 'suffix', rel: scoped[0]!, kind: wantDir ? 'dir' : 'file' };
            break;
          }
          if (scoped.length > 1) {
            candidates = scoped;
            break;
          }
        }
        if (!found) {
          return {
            status: 'error',
            reason: 'ambiguous-suffix',
            message: `"${raw}" matches ${candidates.length} files; cite a longer path`,
            candidates,
          };
        }
      }
    }
  }

  if (!found) {
    const climbs = tries.every((t) => t.rel === null);
    if (climbs) return { status: 'error', reason: 'escapes-repo', message: `"${raw}" climbs above the repo root` };
    return { status: 'error', reason: 'missing-file', message: `"${raw}" not found (root-relative, guide-relative, or as a path suffix)` };
  }

  if (!hasLines) {
    return { status: 'ok', file: found.rel, lineStart: null, lineEnd: null, via: found.via, kind: found.kind };
  }
  if (found.kind !== 'file') {
    return { status: 'error', reason: 'not-a-file', message: `"${found.rel}" is a directory; line citations need a file` };
  }
  const n = lineCount(index, found.rel);
  if (citation.lineEnd! > n) {
    return {
      status: 'error',
      reason: 'line-out-of-range',
      message: `${found.rel} has ${n} lines; cited ${citation.lineStart}-${citation.lineEnd}`,
    };
  }
  return { status: 'ok', file: found.rel, lineStart: citation.lineStart, lineEnd: citation.lineEnd, via: found.via, kind: 'file' };
}
