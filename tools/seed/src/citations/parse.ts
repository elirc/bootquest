/**
 * Citation extraction from markdown guide text (spec §7, estate-contract §2.3).
 *
 * Pure: no I/O. Give it the guide's text and the guide's path (used only to stamp
 * source locations); get back every citation with where it was found.
 *
 * Forms recognised (all inside one "block" = paragraph / list item / table row / heading):
 *   path-line     `src/lib/auth/session.ts:13-22`, `client.ts:7,31`, `session.ts:17,22-24`,
 *                 `today-client.tsx:140, 154`, `alerting.ts:144–239` (en/em dash), `App.java:43:9`
 *                 (column ignored), plus bare-in-prose src/foo.ts:12 outside code spans.
 *   anchor        GitHub-style line anchors: `model.py#L421-L423`, [x](../src/main.jsx#L7)
 *   path-only     `docs/architecture/README.md`, `routes.ts`, [link](../05-PRACTICE.md), `src/app/`
 *   continuation  `:12`, `:71-75` — inherits the most recent file cited earlier in the block
 *   prose-line    "line 53", "(lines 15-40)", "lines 271 and 282" — inherits the same way;
 *                 dropped (with a note) when the block has no earlier file.
 */

export interface SourceLoc {
  /** Guide file path exactly as handed to the parser. */
  file: string;
  /** 1-based line in the guide. */
  line: number;
  /** 1-based column of `raw` in that line. */
  column: number;
}

export type CitationForm = 'path-line' | 'anchor' | 'path-only' | 'continuation' | 'prose-line';

/** One cited span: a file (or directory, for path-only) plus an optional inclusive line range. */
export interface Citation {
  /** Path as written (backslashes normalised to '/'); null only for an orphan continuation. */
  path: string | null;
  /** 1-based inclusive range; both null for path-only citations. Not validated here. */
  lineStart: number | null;
  lineEnd: number | null;
  form: CitationForm;
  /** The exact text the citation came from (a comma list yields several citations with one raw). */
  raw: string;
  source: SourceLoc;
  /** Citations split out of one textual reference (comma lists, "lines A and B") share a group. */
  group: number;
  /** For continuation / prose-line: where the inherited file was cited. */
  inheritedFrom?: SourceLoc;
  /** Set when the text looks like a citation but cannot be read as one. */
  malformed?: string;
  /**
   * Continuation / prose-line only: set when the block cited 2+ distinct files before this ref,
   * so "most recent file" may be the wrong one (real case: ww6 F4 `:106-112` binds to
   * allocationRunRepository.ts but means allocationRunService.ts). Resolution still proceeds;
   * the report counts these as warnings for human review.
   */
  inheritAmbiguous?: string[];
}

export interface ParseNote {
  kind: 'dropped-prose-line';
  raw: string;
  source: SourceLoc;
  message: string;
}

export interface ParseResult {
  citations: Citation[];
  notes: ParseNote[];
}

/** Extensions accepted for bare filenames (no '/') — keeps `App.site`, `rules.length` out. */
export const KNOWN_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'json', 'jsonc', 'md', 'mdx', 'py', 'pyi',
  'java', 'kt', 'kts', 'scala', 'groovy', 'gradle', 'cs', 'csx', 'fs', 'vb', 'csproj', 'fsproj', 'sln', 'slnx',
  'props', 'targets', 'razor', 'cshtml', 'go', 'rs', 'rb', 'erb', 'php', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp',
  'm', 'sql', 'prisma', 'graphql', 'gql', 'proto', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'config',
  'properties', 'env', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'html', 'htm', 'css', 'scss', 'sass',
  'less', 'vue', 'svelte', 'astro', 'xml', 'svg', 'txt', 'csv', 'tf', 'hcl', 'ex', 'exs', 'erl', 'hs', 'clj',
  'lua', 'dart', 'r', 'jl', 'ipynb', 'lock', 'dockerfile', 'mk', 'http', 'rest', 'snap',
]);

/** Extension-less filenames that are still unambiguously files. */
export const EXTENSIONLESS_FILES = new Set([
  'Dockerfile', 'Makefile', 'Procfile', 'Gemfile', 'Rakefile', 'Jenkinsfile', 'Vagrantfile', 'Caddyfile',
  'LICENSE', 'CODEOWNERS', '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc', '.env',
  '.env.example', '.dockerignore', '.prettierrc', '.eslintrc',
]);

const DASH = '[-–—]';
const RANGE = `\\d+(?:\\s*${DASH}\\s*L?\\d+)?`;
/** Inside a code span: comma lists may carry spaces (`:140, 154`), optional trailing :col. */
const SPAN_LINESPEC = new RegExp(`^(${RANGE}(?:\\s*,\\s*${RANGE})*)(?::(\\d+))?$`);
/** In prose: no spaces after commas (too ambiguous with sentence commas). */
const PROSE_LINESPEC = `\\d+(?:${DASH}\\d+)?(?:,\\d+(?:${DASH}\\d+)?)*`;
/** Prose paths: no parens (sentence punctuation), no spaces. */
const PROSE_PATH = '[\\w.@$+\\-\\[\\]/\\\\]*[\\w\\]]';

/** Bare names that end in a source extension but are product names, not files. */
export const NOT_FILES = new Set([
  'node.js', 'next.js', 'nuxt.js', 'vue.js', 'react.js', 'express.js', 'chart.js', 'three.js', 'd3.js',
  'angular.js', 'ember.js', 'backbone.js', 'socket.io', 'deno.js', 'bun.js', 'nest.js', 'nestjs', 'asp.net',
  // JS member expressions that look like filenames (real hit: `express.json` in newcodex3-23 docs/upskill.md)
  'express.json', 'res.json', 'req.json', 'response.json', 'request.json',
  // Windows command shims named in run instructions (W7: `npm.cmd test` advice in W5c-js guides)
  'npm.cmd', 'npx.cmd', 'pnpm.cmd', 'yarn.cmd', 'node.cmd', 'tsx.cmd', 'vitest.cmd', 'dotnet.cmd',
]);

/**
 * W7: bare conventional entry-point names that C# guides use as CONCEPT words
 * ("put it in `Program.cs`") — a path-only mention is not a citation (it is
 * ambiguous in every multi-project repo). With a line spec (`Program.cs:12`) or
 * a directory (`src/Api/Program.cs`) it is still a real citation.
 */
export const CONCEPT_FILENAMES = new Set(['Program.cs', 'Startup.cs', 'Program.fs']);

/**
 * W7: .NET namespaces / qualified type names (`System.Text.Json`,
 * `Microsoft.AspNetCore.Http.Results`) — a bare dotted PascalCase name rooted at
 * System/Microsoft, or any bare name of 3+ PascalCase segments, is not a file.
 */
export function looksLikeNamespace(p: string): boolean {
  if (p.includes('/')) return false;
  if (/^(System|Microsoft)(\.[A-Z][A-Za-z0-9]*)+$/.test(p)) return true;
  return /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*){2,}$/.test(p);
}

function normalisePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function lastSegment(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function extensionOf(seg: string): string | null {
  // needs a stem: `.mjs` alone is an extension being talked about, not a file
  const m = /^[^.].*\.([A-Za-z][A-Za-z0-9]*)$/.exec(seg);
  return m ? m[1]!.toLowerCase() : null;
}

function hasForbidden(p: string): boolean {
  // ellipses, globs, placeholders, URLs, shell-ish text: never repo paths
  // `[...slug]` / `[[...publicId]]` are Next.js catch-all segments, not ellipses
  const q = p.replace(/\[\[?\.\.\./g, '[');
  return (
    q.includes('...') || q.includes('…') || /[*?<>{}|=,;'"`\s]/.test(p) || p.includes('://') ||
    p.startsWith('-') || p.startsWith('@/') || p.startsWith('~')
  );
}

/**
 * Does `p` look like a file path?
 * - bare name (no '/'): must have a KNOWN extension or be a known extension-less file.
 * - with '/': last segment must have some letter-led extension or be a known extension-less file.
 */
export function looksLikeFile(p: string): boolean {
  if (!p || hasForbidden(p) || p.endsWith('/')) return false;
  if (/^\d/.test(p) && !p.includes('/')) return false; // 127.0.0.1, 1.2.3
  if (!p.includes('/') && NOT_FILES.has(p.toLowerCase())) return false;
  if (looksLikeNamespace(p)) return false;
  const seg = lastSegment(p);
  if (EXTENSIONLESS_FILES.has(seg)) return true;
  const ext = extensionOf(seg);
  if (!ext) return false;
  if (!p.includes('/')) return KNOWN_EXTENSIONS.has(ext);
  return true;
}

/** A directory reference: contains '/', ends with '/', no forbidden characters. */
export function looksLikeDir(p: string): boolean {
  // a leading '/' directory is almost always a URL route (`/api/tasks/`), not a repo dir
  if (!p.endsWith('/') || hasForbidden(p) || p.startsWith('/')) return false;
  const body = p.replace(/\/+$/, '');
  return body.length > 0 && /^[\w.@$\-\[\]()/]+$/.test(body) && /[A-Za-z]/.test(body);
}

interface RangeParse {
  ranges: Array<{ start: number; end: number }>;
  error?: string;
}

function parseRanges(spec: string): RangeParse {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const part of spec.split(',')) {
    const t = part.trim();
    const m = new RegExp(`^L?(\\d+)(?:\\s*${DASH}\\s*L?(\\d+))?$`).exec(t);
    if (!m) return { ranges, error: `unreadable line spec "${spec}"` };
    const start = Number(m[1]);
    const end = m[2] !== undefined ? Number(m[2]) : start;
    ranges.push({ start, end });
  }
  return { ranges };
}

type Event =
  | { col: number; kind: 'span'; text: string; raw: string }
  | { col: number; kind: 'link'; target: string; raw: string }
  | { col: number; kind: 'prose-path'; path: string; spec: string; raw: string }
  | { col: number; kind: 'prose-line'; a: number; b: number | null; and: boolean; raw: string };

interface CodeSpan {
  start: number; // index of first backtick
  end: number; // index after closing backticks
  content: string;
  contentStart: number;
}

function findCodeSpans(line: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\\' && line[i + 1] === '`') {
      i += 2;
      continue;
    }
    if (line[i] !== '`') {
      i++;
      continue;
    }
    let n = 0;
    while (line[i + n] === '`') n++;
    const fence = '`'.repeat(n);
    let j = i + n;
    let close = -1;
    while (j < line.length) {
      const k = line.indexOf(fence, j);
      if (k === -1) break;
      let m = 0;
      while (line[k + m] === '`') m++;
      if (m === n) {
        close = k;
        break;
      }
      j = k + m;
    }
    if (close === -1) {
      i += n; // unmatched run: literal backticks
      continue;
    }
    let content = line.slice(i + n, close);
    let contentStart = i + n;
    if (content.length >= 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') {
      content = content.slice(1, -1);
      contentStart += 1;
    }
    spans.push({ start: i, end: close + n, content, contentStart });
    i = close + n;
  }
  return spans;
}

function mask(line: string, ranges: Array<[number, number]>): string {
  const chars = line.split('');
  for (const [a, b] of ranges) for (let k = a; k < b && k < chars.length; k++) chars[k] = ' ';
  return chars.join('');
}

const BLOCK_START = /^\s*(?:#{1,6}\s|[-*+]\s+|\d+[.)]\s+|\|)/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Extract every citation from one markdown guide. */
export function parseCitations(text: string, guideFile: string): ParseResult {
  const citations: Citation[] = [];
  const notes: ParseNote[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let fence: string | null = null;
  let lastFile: { path: string; source: SourceLoc } | null = null;
  let group = 0;
  /** Distinct files cited so far in the current block (for inheritAmbiguous). */
  let blockFiles = new Set<string>();

  const emit = (c: Omit<Citation, 'group'>, g: number) => {
    const inherited = c.form === 'continuation' || c.form === 'prose-line';
    if (inherited && c.path !== null && blockFiles.size > 1) {
      citations.push({ ...c, group: g, inheritAmbiguous: [...blockFiles] });
    } else {
      citations.push({ ...c, group: g });
    }
    if (!inherited && c.path !== null && !c.path.endsWith('/')) blockFiles.add(c.path);
  };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const lineNo = li + 1;

    const fm = FENCE.exec(line);
    if (fence !== null) {
      if (fm && fm[1]![0] === fence[0] && fm[1]!.length >= fence.length && line.trim() === fm[1]) fence = null;
      continue;
    }
    if (fm) {
      fence = fm[1]!;
      lastFile = null;
      blockFiles = new Set();
      continue;
    }
    if (line.trim() === '' || BLOCK_START.test(line)) {
      lastFile = null;
      blockFiles = new Set();
    }

    // 1. code spans
    const spans = findCodeSpans(line);
    const events: Event[] = spans.map((s) => ({
      col: s.contentStart,
      kind: 'span' as const,
      text: s.content,
      raw: s.content,
    }));
    let masked = mask(line, spans.map((s) => [s.start, s.end] as [number, number]));

    // 2. markdown links / images (targets only)
    const linkRe = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
    const linkMasks: Array<[number, number]> = [];
    for (let m = linkRe.exec(masked); m; m = linkRe.exec(masked)) {
      const target = m[1]!;
      const tStart = m.index + m[0].indexOf(target);
      events.push({ col: tStart, kind: 'link', target, raw: target });
      linkMasks.push([m.index, m.index + m[0].length]);
    }
    masked = mask(masked, linkMasks);

    // 3. prose path:line (outside code spans and links)
    const prosePath = new RegExp(`(?<![\\w./\\\\:@\\-])(${PROSE_PATH}):(${PROSE_LINESPEC})(?![\\w:])`, 'g');
    for (let m = prosePath.exec(masked); m; m = prosePath.exec(masked)) {
      const p = normalisePath(m[1]!);
      if (!looksLikeFile(p)) continue;
      events.push({ col: m.index, kind: 'prose-path', path: p, spec: m[2]!, raw: m[0] });
    }

    // 4. prose "line N" / "lines N-M" / "lines N and M"
    const proseLine = new RegExp(
      `\\blines?\\s+(\\d+)(?:\\s*(?:(${DASH}|to|through)|(and|&))\\s*(\\d+))?(?![\\w.]\\d)`,
      'gi',
    );
    for (let m = proseLine.exec(masked); m; m = proseLine.exec(masked)) {
      const b = m[4] !== undefined ? Number(m[4]) : null;
      events.push({ col: m.index, kind: 'prose-line', a: Number(m[1]), b, and: m[3] !== undefined, raw: m[0] });
    }

    events.sort((x, y) => x.col - y.col);

    for (const ev of events) {
      const source: SourceLoc = { file: guideFile, line: lineNo, column: ev.col + 1 };
      if (ev.kind === 'span') {
        const t = ev.text.trim();
        // continuation `:12`, `:71-75`, `:7,31`
        const cont = /^:(.+)$/.exec(t);
        if (cont && /^\d/.test(cont[1]!)) {
          const lm = SPAN_LINESPEC.exec(cont[1]!);
          const g = ++group;
          const pr = lm ? parseRanges(lm[1]!) : { ranges: [], error: `unreadable line spec "${cont[1]}"` };
          if (pr.error || !lastFile) {
            emit(
              {
                path: lastFile?.path ?? null,
                lineStart: pr.ranges[0]?.start ?? null,
                lineEnd: pr.ranges[0]?.end ?? null,
                form: 'continuation',
                raw: ev.raw,
                source,
                ...(lastFile ? { inheritedFrom: lastFile.source } : {}),
                malformed: pr.error ?? 'continuation reference with no earlier file in the same block',
              },
              g,
            );
            continue;
          }
          for (const r of pr.ranges) {
            emit(
              { path: lastFile.path, lineStart: r.start, lineEnd: r.end, form: 'continuation', raw: ev.raw, source, inheritedFrom: lastFile.source },
              g,
            );
          }
          continue;
        }
        // anchor `path#L12-L20`
        const anc = /^(.+?)#L(\d+)(?:-L?(\d+))?$/.exec(t);
        if (anc) {
          const p = normalisePath(anc[1]!);
          if (looksLikeFile(p)) {
            const s = Number(anc[2]);
            emit({ path: p, lineStart: s, lineEnd: anc[3] ? Number(anc[3]) : s, form: 'anchor', raw: ev.raw, source }, ++group);
            lastFile = { path: p, source };
          }
          continue;
        }
        // path-line `path:spec`
        const pl = /^([^:\s]+):(\d.*)$/.exec(t);
        if (pl) {
          const p = normalisePath(pl[1]!);
          if (!looksLikeFile(p)) continue;
          const g = ++group;
          const lm = SPAN_LINESPEC.exec(pl[2]!.trim());
          const pr = lm ? parseRanges(lm[1]!) : { ranges: [], error: `unreadable line spec "${pl[2]}"` };
          if (pr.error) {
            emit({ path: p, lineStart: null, lineEnd: null, form: 'path-line', raw: ev.raw, source, malformed: pr.error }, g);
          } else {
            for (const r of pr.ranges) {
              emit({ path: p, lineStart: r.start, lineEnd: r.end, form: 'path-line', raw: ev.raw, source }, g);
            }
          }
          lastFile = { path: p, source };
          continue;
        }
        // a path ending in ':' with nothing usable after it (e.g. `foo.ts:` or `foo.ts:x1`)
        const bad = /^([^:\s]+):(\S*)$/.exec(t);
        if (bad && looksLikeFile(normalisePath(bad[1]!)) && (bad[2] === '' || /\d/.test(bad[2]!))) {
          emit(
            { path: normalisePath(bad[1]!), lineStart: null, lineEnd: null, form: 'path-line', raw: ev.raw, source, malformed: `unreadable line spec "${bad[2]}"` },
            ++group,
          );
          continue;
        }
        // path-only
        const p = normalisePath(t);
        if (CONCEPT_FILENAMES.has(p)) continue; // concept word, not a citation (W7)
        if (looksLikeFile(p)) {
          emit({ path: p, lineStart: null, lineEnd: null, form: 'path-only', raw: ev.raw, source }, ++group);
          lastFile = { path: p, source };
        } else if (looksLikeDir(p)) {
          emit({ path: p, lineStart: null, lineEnd: null, form: 'path-only', raw: ev.raw, source }, ++group);
        }
        continue;
      }
      if (ev.kind === 'link') {
        let target = ev.target;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
        try {
          target = decodeURI(target);
        } catch {
          /* keep raw */
        }
        const [pathPart = '', frag = ''] = target.split('#', 2);
        let p = normalisePath(pathPart.split('?')[0]!);
        if (!p) continue;
        // [x](../../apps/viewer/src/pages/_app.tsx:57) — line spec inside the link target
        const lt = /^(.+?):(\d.*)$/.exec(p);
        if (lt && looksLikeFile(lt[1]!)) {
          const lm = SPAN_LINESPEC.exec(lt[2]!);
          const pr = lm ? parseRanges(lm[1]!) : { ranges: [], error: `unreadable line spec "${lt[2]}"` };
          const g = ++group;
          p = lt[1]!;
          if (pr.error) emit({ path: p, lineStart: null, lineEnd: null, form: 'path-line', raw: ev.raw, source, malformed: pr.error }, g);
          for (const r of pr.ranges) emit({ path: p, lineStart: r.start, lineEnd: r.end, form: 'path-line', raw: ev.raw, source }, g);
          lastFile = { path: p, source };
          continue;
        }
        const am = /^L(\d+)(?:-L?(\d+))?$/.exec(frag);
        if (am && looksLikeFile(p)) {
          const s = Number(am[1]);
          emit({ path: p, lineStart: s, lineEnd: am[2] ? Number(am[2]) : s, form: 'anchor', raw: ev.raw, source }, ++group);
          lastFile = { path: p, source };
        } else if (looksLikeFile(p) || looksLikeDir(p)) {
          emit({ path: p, lineStart: null, lineEnd: null, form: 'path-only', raw: ev.raw, source }, ++group);
          if (looksLikeFile(p)) lastFile = { path: p, source };
        }
        continue;
      }
      if (ev.kind === 'prose-path') {
        const p = normalisePath(ev.path);
        const pr = parseRanges(ev.spec);
        const g = ++group;
        for (const r of pr.ranges) emit({ path: p, lineStart: r.start, lineEnd: r.end, form: 'path-line', raw: ev.raw, source }, g);
        lastFile = { path: p, source };
        continue;
      }
      // prose-line
      if (!lastFile) {
        notes.push({ kind: 'dropped-prose-line', raw: ev.raw, source, message: 'prose line reference with no earlier file in the same block' });
        continue;
      }
      const g = ++group;
      if (ev.b !== null && ev.and) {
        for (const n of [ev.a, ev.b]) {
          emit({ path: lastFile.path, lineStart: n, lineEnd: n, form: 'prose-line', raw: ev.raw, source, inheritedFrom: lastFile.source }, g);
        }
      } else {
        emit(
          { path: lastFile.path, lineStart: ev.a, lineEnd: ev.b ?? ev.a, form: 'prose-line', raw: ev.raw, source, inheritedFrom: lastFile.source },
          g,
        );
      }
    }
  }
  return { citations, notes };
}
