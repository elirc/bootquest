/**
 * seed:pins (read-only): every seed pack's recorded blob ids against git itself.
 * For each content/seed/<generator>/<name>/manifest.json, the mirror holding
 * source.repo at source.sha (<cache>/repos/<repo>, <cache>/sources/<repo>, or
 * BOOTQUEST_REPOS) is asked for `git ls-tree -r <sha>`, and every entry of the
 * manifest's `blobs` map must be git's blob id for that path:
 *   OK          every recorded id is git's
 *   MISMATCH    file-level detail (an id git never had there, or a path not in the tree)
 *   UNCHECKABLE no mirror for the repo, or the mirror lacks the sha (a FAILURE by
 *               default; --no-strict reports it without failing)
 * A pack that pins 0 blobs is OK by definition: nothing pinned, nothing to verify.
 * Nothing is written. The checkout is NOT consulted: this checks what the pack
 * claims against the repo, not against the bytes that produced the claim.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SeedPackManifest } from '@bootquest/shared';
import { findPacks } from '../factory/check/check.ts';
import { verifyManifestBlobs, type ManifestPinResult } from '../factory/pins.ts';

export interface PackPinReport extends ManifestPinResult {
  pack: string;
  repo: string;
  sha: string;
  pin: string;
}

export interface PinsOptions {
  seedDir: string;
  roots: readonly string[];
  /** only packs whose source.repo is listed */
  repos?: readonly string[];
  log?: (l: string) => void;
}

export interface PinsSummary {
  packs: PackPinReport[];
  ok: number;
  mismatch: number;
  uncheckable: number;
}

/**
 * seed:pins' verdict: any MISMATCH fails; so does any UNCHECKABLE pack (no mirror / mirror lacks the
 * sha) unless strict is off (--no-strict): a pin nobody can check is not a verified pin. A 0-blob pack
 * is OK by definition (nothing pinned, nothing to verify) and never needs a mirror.
 */
export function pinsFailed(s: Pick<PinsSummary, 'mismatch' | 'uncheckable'>, strict = true): boolean {
  return s.mismatch > 0 || (strict && s.uncheckable > 0);
}

export function runPins(o: PinsOptions): PinsSummary {
  const packs: PackPinReport[] = [];
  const only = o.repos?.length ? new Set(o.repos) : null;
  for (const dir of findPacks(o.seedDir)) {
    const pack = relative(o.seedDir, dir).replace(/\\/g, '/');
    let m: SeedPackManifest;
    try {
      m = SeedPackManifest.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
    } catch (err) {
      packs.push({ pack, repo: '?', sha: '?', pin: '?', status: 'mismatch', problems: [`manifest unreadable: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`], checked: 0, mirror: null });
      continue;
    }
    if (only && !only.has(m.source.repo)) continue;
    // nothing pinned (e.g. a variants pack made without --checkout): nothing to check, no mirror needed
    if (Object.keys(m.blobs).length === 0) {
      packs.push({ pack, repo: m.source.repo, sha: m.source.sha, pin: m.source.pin, status: 'ok', problems: [], checked: 0, mirror: null });
      continue;
    }
    packs.push({ pack, repo: m.source.repo, sha: m.source.sha, pin: m.source.pin, ...verifyManifestBlobs(m.source.repo, m.source.sha, m.blobs, o.roots) });
  }
  const pad = (s: string, n: number) => s.padEnd(n);
  for (const p of packs) {
    const at = `${p.repo}@${p.sha.slice(0, 12)}`;
    if (p.status === 'ok') o.log?.(`${pad('OK', 12)}${p.pack}  ${at}  ${p.checked ? `${p.checked} blob(s) == git` : 'nothing pinned (0 blobs)'} (pin ${p.pin})`);
    else if (p.status === 'uncheckable') o.log?.(`${pad('UNCHECKABLE', 12)}${p.pack}  ${at}  ${p.problems[0]}`);
    else {
      o.log?.(`${pad('MISMATCH', 12)}${p.pack}  ${at}  ${p.problems.length}/${p.checked} recorded blob(s) are not git's (pin ${p.pin})`);
      for (const x of p.problems) o.log?.(`${' '.repeat(12)}  ${x}`);
    }
  }
  return {
    packs,
    ok: packs.filter((p) => p.status === 'ok').length,
    mismatch: packs.filter((p) => p.status === 'mismatch').length,
    uncheckable: packs.filter((p) => p.status === 'uncheckable').length,
  };
}
