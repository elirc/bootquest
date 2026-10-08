/** Small deterministic helpers shared by the seed generators/validators. */
import { createHash } from 'node:crypto';

export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

/** git's blob id for these bytes (so a pack's pin is comparable with `git ls-tree` at the sha). */
export function gitBlobSha1(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** CRLF/whitespace/dash normalisation used before hashing stable keys (estate-contract §6 (d)). */
export function normKeyText(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Stable item key: namespaced by generator + repo, hashed over (repo, kind,
 * normalized heading path + item label). Path-independent on purpose (file
 * moves re-match); twins never collide because the repo is in the key.
 */
export function stableKey(generator: string, repo: string, kind: string, parts: readonly string[]): string {
  const h = sha256([repo, kind, ...parts.map(normKeyText)].join('\u0000')).slice(0, 16);
  return `seed:${generator}:${encodeURIComponent(repo)}/${kind}/${h}`;
}

/** Whitespace-normalised text for quote matching ("substring, whitespace-normalized"). */
export function normWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Comparison form for duplicate detection: lowercase, markdown/punctuation stripped, whitespace collapsed. */
export function normCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`*_>#[\]()"'.,;:!?]/g, ' ')
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenJaccard(a: string, b: string): number {
  const ta = new Set(normCompare(a).split(' ').filter(Boolean));
  const tb = new Set(normCompare(b).split(' ').filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export const NEAR_DUP_JACCARD = 0.8;

/** Two texts that a learner could not tell apart as answers (or a checklist would double-count). */
export function nearDuplicate(a: string, b: string): boolean {
  const na = normCompare(a);
  const nb = normCompare(b);
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length >= 12 && long.includes(short)) return true;
  return tokenJaccard(a, b) >= NEAR_DUP_JACCARD;
}

/** Deterministic ordering by a seeded hash (no RNG anywhere in the factory). */
export function hashOrder<T>(items: readonly T[], seed: string, id: (t: T) => string): T[] {
  return [...items].sort((x, y) => {
    const hx = sha256(`${seed}\u0000${id(x)}`);
    const hy = sha256(`${seed}\u0000${id(y)}`);
    return hx < hy ? -1 : hx > hy ? 1 : 0;
  });
}

/** Stable JSON for committed files: 1-space indent + trailing newline (bootforge pack style). */
export const stableJson = (v: unknown): string => `${JSON.stringify(v, null, 1)}\n`;
