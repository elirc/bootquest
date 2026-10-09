/**
 * Exclusion / redaction registry (tools/seed/exclusions.json) — consulted by
 * EVERY seed generator before it reads a file or ships an item.
 *
 *   repo-level   an entry without `paths` excludes the whole repo
 *   file-level   `paths` (exact file, 'dir/' prefix, or * / ** glob)
 *   date-bounded `until.clearedBy === null` keeps the entry active regardless of
 *                the date (seed output must not depend on the wall clock); a
 *                human sets clearedBy to lift it
 * Defence in depth: any text a generator ingests is also scanned for secret
 * patterns; a hit in a file the registry does NOT already exclude is an
 * UnregisteredSecretError (hard refusal — a human must register it).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const EXCLUSION_REASONS = ['stale-anchors', 'expiring-tests', 'leaked-secret'] as const;

const Entry = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    repo: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1).optional(),
    reason: z.enum(EXCLUSION_REASONS),
    until: z.object({ bombDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), clearedBy: z.string().min(1).nullable() }).strict().optional(),
    note: z.string().min(1),
  })
  .strict();
export type ExclusionEntry = z.infer<typeof Entry>;

export const ExclusionRegistry = z
  .object({
    format: z.literal('bootquest-seed-exclusions@1'),
    about: z.string().optional(),
    entries: z.array(Entry),
    citationWhitelist: z.array(z.object({ repo: z.string().min(1), pattern: z.string().min(1), note: z.string().min(1) }).strict()),
    secretPatterns: z.array(z.object({ id: z.string().min(1), regex: z.string().min(1) }).strict()).min(1),
  })
  .strict()
  .superRefine((r, ctx) => {
    const ids = new Set<string>();
    for (const e of r.entries) {
      if (ids.has(e.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate entry id ${e.id}` });
      ids.add(e.id);
    }
    for (const p of r.secretPatterns) {
      try {
        new RegExp(p.regex);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `secret pattern ${p.id} is not a valid regex` });
      }
    }
  });
export type ExclusionRegistry = z.infer<typeof ExclusionRegistry>;

export const DEFAULT_EXCLUSIONS_PATH = resolve(import.meta.dirname, '..', '..', 'exclusions.json');

export function loadExclusions(path: string = DEFAULT_EXCLUSIONS_PATH): ExclusionRegistry {
  return ExclusionRegistry.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Translate a registry path pattern to a RegExp over repo-relative /-paths. */
export function pathPatternRegex(pattern: string): RegExp {
  // 'dir/' = everything under dir
  if (pattern.endsWith('/')) return new RegExp(`${pathPatternRegex(pattern.slice(0, -1)).source.slice(0, -1)}/`);
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      // '**/' = any number of leading directories (incl. none)
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else out += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export interface ExclusionHit {
  entry: ExclusionEntry;
  /** "excluded:<id> (<reason>)" — the reason string every report uses */
  reason: string;
}

const active = (e: ExclusionEntry): boolean => !e.until || e.until.clearedBy === null;
const hit = (entry: ExclusionEntry): ExclusionHit => ({ entry, reason: `excluded:${entry.id} (${entry.reason})` });

export class Exclusions {
  readonly registry: ExclusionRegistry;
  private readonly secrets: Array<{ id: string; re: RegExp }>;
  constructor(registry: ExclusionRegistry) {
    this.registry = registry;
    this.secrets = registry.secretPatterns.map((p) => ({ id: p.id, re: new RegExp(p.regex) }));
  }

  static load(path?: string): Exclusions {
    return new Exclusions(loadExclusions(path));
  }

  /** Whole-repo exclusion (an active entry without paths), else null. */
  repo(repo: string): ExclusionHit | null {
    const e = this.registry.entries.find((x) => x.repo === repo && !x.paths && active(x));
    return e ? hit(e) : null;
  }

  /** Does an active entry exclude this repo-relative path (or the whole repo)? */
  path(repo: string, relPath: string): ExclusionHit | null {
    const p = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    for (const e of this.registry.entries) {
      if (e.repo !== repo || !active(e)) continue;
      if (!e.paths) return hit(e);
      if (e.paths.some((pat) => pathPatternRegex(pat).test(p))) return hit(e);
    }
    return null;
  }

  /** Whitelisted citation paths for the resolver (`ignore` option): runtime files etc. */
  citationIgnores(repo: string): string[] {
    return this.registry.citationWhitelist.filter((w) => w.repo === '*' || w.repo === repo).map((w) => w.pattern);
  }

  /**
   * W7 per-repo citation whitelist: the entry (repo '*' = every repo) whose pattern
   * matches a cited path as written. Pattern forms: exact path or bare name
   * (also matches as a '/'-suffix, the pre-W7 rule), 'dir/' prefix, or * / ** glob
   * (pathPatternRegex). A whitelisted citation is NOT resolved: validators record
   * the hit on the citation (visible in the shipped item) and never count it ok.
   */
  citationWhitelistHit(repo: string, citedPath: string): { pattern: string; note: string } | null {
    const p = citedPath.replace(/\\/g, '/').replace(/^\.\//, '');
    for (const w of this.registry.citationWhitelist) {
      if (w.repo !== '*' && w.repo !== repo) continue;
      const glob = w.pattern.includes('*') || w.pattern.endsWith('/');
      const hitIt = glob ? pathPatternRegex(w.pattern).test(p) : p === w.pattern || p.endsWith(`/${w.pattern}`);
      if (hitIt) return { pattern: w.pattern, note: w.note };
    }
    return null;
  }

  /** Secret-pattern ids found in text (never returns the match itself). */
  scan(text: string): string[] {
    return this.secrets.filter((s) => s.re.test(text)).map((s) => s.id);
  }

  /**
   * Gate for ingesting a file's text: excluded → returns the hit (caller skips,
   * counted); secret pattern in a non-excluded file → throws.
   */
  admit(repo: string, relPath: string, text: string): ExclusionHit | null {
    const h = this.path(repo, relPath);
    if (h) return h;
    const found = this.scan(text);
    if (found.length) throw new UnregisteredSecretError(repo, relPath, found);
    return null;
  }
}

export class UnregisteredSecretError extends Error {
  readonly patterns: string[];
  constructor(repo: string, relPath: string, patterns: string[]) {
    super(
      `UNREGISTERED SECRET: ${repo}/${relPath} matches secret pattern(s) ${patterns.join(', ')}; refusing to ingest it. ` +
        'Redact/revoke at the source, or register the file in tools/seed/exclusions.json (reason leaked-secret).',
    );
    this.name = 'UnregisteredSecretError';
    this.patterns = patterns;
  }
}

/** The registry file is part of every seed fingerprint (a registry change re-validates everything). */
export const EXCLUSIONS_FILE = join(import.meta.dirname, '..', '..', 'exclusions.json');
