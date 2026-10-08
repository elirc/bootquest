import { createHash } from 'node:crypto';

/**
 * Markdown sectioning + stable_key derivation (spec §3.2, estate contract §6).
 *
 * STABLE KEY ALGORITHM v1 (content_ref.stable_key_algo = 1)
 *  1. Sections are ATX headings (`#`..`######`, up to 3 leading spaces) outside
 *     fenced code blocks; setext headings are not sections. A file with no
 *     heading is one section titled by its file name.
 *  2. Heading path = the normalized texts of the heading and all its ancestors
 *     (H1 > H2 > H3 ...). Normalization: inline markdown stripped (code ticks,
 *     emphasis, links/images, HTML tags), NFKC, CRLF/whitespace collapsed,
 *     every dash variant (en/em/figure/minus) -> "-", curly quotes -> straight,
 *     lower-cased. The FILE PATH IS NOT PART OF THE KEY, so a moved file
 *     re-matches its existing keys.
 *  3. Within one file, the n-th section with an identical heading path gets
 *     ordinal n; ordinal 1 is omitted from the hash (adding a later duplicate
 *     never renames the first).
 *  4. key = "h:" + sha256(repo + "\n" + headingPath.join("\n") [+ "\n#" + n])[0..20).
 *     Keys are SCOPED PER REPO (the repo is hashed in and content_ref is
 *     UNIQUE(repo, stable_key)): twin repos with identical headings never collide.
 *  5. Frontmatter `id:` wins: the file gets a document-level key "fm:<id>"
 *     (provenance 'frontmatter') and its heading keys are hashed under
 *     "fm:<id>" instead of the repo-wide heading space (so they follow the id).
 *  6. CROSS-FILE DEDUP: when two files in the same repo produce the same key
 *     (e.g. a generated copy of a guide), files are taken in sorted path order
 *     (JS string order); the first keeps the key, the k-th occurrence becomes
 *     "<key>~k". Deterministic for a given tree.
 */
export const STABLE_KEY_ALGO = 1;

export interface MdSection {
  path: string;
  /** raw (cleaned, not normalized) heading texts, outermost first */
  headingPath: string[];
  title: string;
  /** 1-6; 0 = whole-document section (no headings / frontmatter document key) */
  level: number;
  lineStart: number;
  lineEnd: number;
  /** GitHub-style heading slug (with -1, -2 suffixes for duplicates in the file) */
  anchor: string | null;
  /** occurrence of this exact normalized heading path within the file (1-based) */
  ordinal: number;
  frontmatterId: string | null;
}

export interface KeyedSection extends MdSection {
  stableKey: string;
  provenance: 'frontmatter' | 'heading-hash';
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/** Strip inline markdown from heading text (display title). */
export function cleanHeading(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalization used for hashing (step 2 of the algorithm). */
export function normalizeHeading(text: string): string {
  return cleanHeading(text)
    .normalize('NFKC')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** GitHub-ish heading slug. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function frontmatter(lines: string[]): { id: string | null; bodyStart: number } {
  if (lines[0]?.trim() !== '---') return { id: null, bodyStart: 0 };
  for (let i = 1; i < Math.min(lines.length, 200); i++) {
    const l = lines[i]!.trim();
    if (l === '---' || l === '...') {
      let id: string | null = null;
      for (const fl of lines.slice(1, i)) {
        const m = /^id:\s*(.+?)\s*$/.exec(fl);
        if (m) id = m[1]!.replace(/^(['"])(.*)\1$/, '$2').trim() || null;
      }
      return { id, bodyStart: i + 1 };
    }
  }
  return { id: null, bodyStart: 0 };
}

export function parseMarkdownSections(path: string, text: string): MdSection[] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  // a trailing newline yields one empty last element: not a line
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const fm = frontmatter(lines);
  const heads: { level: number; title: string; line: number }[] = [];
  let fence: { ch: string; len: number } | null = null;
  for (let i = fm.bodyStart; i < lines.length; i++) {
    const line = lines[i]!;
    const f = FENCE_RE.exec(line);
    if (f) {
      const ch = f[1]![0]!;
      const len = f[1]!.length;
      if (!fence) fence = { ch, len };
      else if (fence.ch === ch && len >= fence.len && line.trim().replace(new RegExp(`^\\${ch}+`), '') === '') fence = null;
      continue;
    }
    if (fence) continue;
    const m = ATX_RE.exec(line);
    if (!m) continue;
    const title = cleanHeading(m[2] ?? '');
    if (title === '') continue;
    heads.push({ level: m[1]!.length, title, line: i + 1 });
  }

  const lastLine = (() => {
    let n = lines.length;
    while (n > 0 && lines[n - 1]!.trim() === '') n--;
    return Math.max(n, 1);
  })();
  const fileTitle = path.split('/').pop()!.replace(/\.(md|markdown)$/i, '') || path;
  const out: MdSection[] = [];

  if (fm.id !== null) {
    out.push({ path, headingPath: [], title: heads[0]?.title ?? fileTitle, level: 0, lineStart: 1, lineEnd: lastLine, anchor: null, ordinal: 1, frontmatterId: fm.id });
  }
  if (heads.length === 0) {
    if (fm.id === null) {
      out.push({ path, headingPath: [fileTitle], title: fileTitle, level: 0, lineStart: 1, lineEnd: lastLine, anchor: null, ordinal: 1, frontmatterId: null });
    }
    return out;
  }

  const stack: { level: number; title: string }[] = [];
  const pathCount = new Map<string, number>();
  const slugCount = new Map<string, number>();
  heads.forEach((h, idx) => {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) stack.pop();
    stack.push({ level: h.level, title: h.title });
    const headingPath = stack.map((s) => s.title);
    const norm = headingPath.map(normalizeHeading).join('\n');
    const ordinal = (pathCount.get(norm) ?? 0) + 1;
    pathCount.set(norm, ordinal);
    // section ends before the next heading of the same or a higher level
    let end = lastLine;
    for (let j = idx + 1; j < heads.length; j++) {
      if (heads[j]!.level <= h.level) {
        end = heads[j]!.line - 1;
        break;
      }
    }
    while (end > h.line && lines[end - 1]!.trim() === '') end--;
    const base = slugify(h.title);
    const seen = slugCount.get(base) ?? 0;
    slugCount.set(base, seen + 1);
    out.push({
      path,
      headingPath,
      title: h.title,
      level: h.level,
      lineStart: h.line,
      lineEnd: Math.max(end, h.line),
      anchor: seen === 0 ? base : `${base}-${seen}`,
      ordinal,
      frontmatterId: fm.id,
    });
  });
  return out;
}

function hash20(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 20);
}

/** Base key of one section (steps 2-5), before cross-file dedup. */
export function baseStableKey(repo: string, s: MdSection): { key: string; provenance: KeyedSection['provenance'] } {
  if (s.frontmatterId !== null && s.level === 0) return { key: `fm:${s.frontmatterId}`, provenance: 'frontmatter' };
  const scope = s.frontmatterId !== null ? `fm:${s.frontmatterId}` : repo;
  const norm = s.headingPath.map(normalizeHeading).join('\n');
  const material = `${scope}\n${norm}${s.ordinal > 1 ? `\n#${s.ordinal}` : ''}`;
  return { key: `h:${hash20(material)}`, provenance: s.frontmatterId !== null ? 'frontmatter' : 'heading-hash' };
}

/** Steps 2-6 over a whole repo snapshot. `files` must be the sections of ALL selected files. */
export function assignStableKeys(repo: string, sections: readonly MdSection[]): KeyedSection[] {
  const byPath = [...sections].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.lineStart - b.lineStart));
  const seen = new Map<string, number>();
  return byPath.map((s) => {
    const { key, provenance } = baseStableKey(repo, s);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { ...s, stableKey: n === 1 ? key : `${key}~${n}`, provenance };
  });
}
