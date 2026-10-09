import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runExplainBack } from '../explainback/run.ts';
import { runPatches } from '../patches/run.ts';
import { runQuests } from '../quests/run.ts';
import { runVariants } from '../variants/run.ts';
import { canonical, runCheck } from './check.ts';

const FX = join(import.meta.dirname, '..', 'fixtures');
const D = join(FX, 'drafts');
const WW6 = '09751ceaee909a30e5c4b5ff5cdde99880b9a3e5';
const SP = 'ff8446042a16d0aaef1687b34932b4f9137e6e0d';
const tmp = mkdtempSync(join(tmpdir(), 'bq-check-test-'));
const seed = join(tmp, 'seed');
const checkouts = join(tmp, 'checkouts');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeAll(async () => {
  mkdirSync(checkouts, { recursive: true });
  cpSync(join(FX, 'ww6'), join(checkouts, `ww6@${WW6}`), { recursive: true });
  cpSync(join(FX, 'signalpost-swe-bootcamp'), join(checkouts, `signalpost-swe-bootcamp@${SP}`), { recursive: true });
  const co = join(checkouts, `ww6@${WW6}`);
  expect(runQuests({ root: co, sha: WW6, guides: ['astraupskill/05-PRACTICE.md', 'astraupskill/06-SOLUTIONS-AND-REVIEW.md'], out: join(seed, 'quests', 'ww6') }).ok).toBe(true);
  expect(runExplainBack({ unit: 'docs/learning/testing-rationale.md', checkout: co, sha: WW6, draft: join(D, 'explainback-ww6-testing-rationale.json'), out: join(seed, 'explainback', 'ww6-tr') }).ok).toBe(true);
  expect((await runVariants({ draft: join(D, 'variants-signalpost-U02.json'), checkout: join(checkouts, `signalpost-swe-bootcamp@${SP}`), out: join(seed, 'variants', 'U02') })).ok).toBe(true);
  expect((await runPatches({ draft: join(D, 'patches-ww6.json'), checkout: co, sha: WW6, out: join(seed, 'patches', 'ww6-katas') })).ok).toBe(true);
}, 240_000);

describe('seed:check (umbrella re-verification)', () => {
  it('re-validates every generator\'s pack from scratch (variants/patches re-executed) and passes', async () => {
    const log: string[] = [];
    const r = await runCheck({ seedDir: seed, checkouts, log: (l) => log.push(l) });
    expect(log.filter((l) => l.startsWith('FAIL'))).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.packs).toHaveLength(4);
    expect(r.packs.find((p) => p.dir.includes('variants'))!.executions).toBeGreaterThanOrEqual(2);
    expect(r.packs.find((p) => p.dir.includes('patches'))!.executions).toBeGreaterThanOrEqual(2);
  }, 240_000);

  it('FAILS on: missing checkout, broken pin, tampered items, forged stamp, missing stamp', async () => {
    const variant = (n: string, mutate: (dir: string) => void) => {
      const root = join(tmp, n);
      cpSync(join(seed, 'quests'), join(root, 'quests'), { recursive: true });
      mutate(join(root, 'quests', 'ww6'));
      return root;
    };
    const fails = async (root: string, co: string, re: RegExp) => {
      const log: string[] = [];
      const r = await runCheck({ seedDir: root, checkouts: co, log: (l) => log.push(l) });
      expect(r.ok).toBe(false);
      expect(log.join('\n')).toMatch(re);
    };
    await fails(variant('nochk', () => {}), join(tmp, 'nowhere'), /source checkout unavailable/);
    const pinRoot = join(tmp, 'pinco');
    cpSync(checkouts, pinRoot, { recursive: true });
    const sess = join(pinRoot, `ww6@${WW6}`, 'src', 'lib', 'auth', 'session.ts');
    writeFileSync(sess, `${readFileSync(sess, 'utf8')}// drift\n`);
    await fails(variant('pin', () => {}), pinRoot, /pin broken: src\/lib\/auth\/session.ts: blob/);
    await fails(variant('tamper', (d) => writeFileSync(join(d, 'items.json'), readFileSync(join(d, 'items.json'), 'utf8').replace('"back": "', '"back": "X'))), checkouts, /items.json sha256 != manifest/);
    await fails(variant('forge', (d) => writeFileSync(join(d, 'validation.json'), readFileSync(join(d, 'validation.json'), 'utf8').replace(/"fingerprint": "[0-9a-f]{64}"/, `"fingerprint": "${'a'.repeat(64)}"`))), checkouts, /stale\/invalid stamp: seed fingerprint aaaaaaaaaaaa/);
    await fails(variant('nostamp', (d) => rmSync(join(d, 'validation.json'))), checkouts, /no validation.json stamp/);
  }, 240_000);

  it('--restamp (W7): a stale-fingerprint-only pack is restamped after a clean full re-validation; anything else is not', async () => {
    const copy = (n: string) => {
      const root = join(tmp, n);
      cpSync(join(seed, 'quests'), join(root, 'quests'), { recursive: true });
      return { root, dir: join(root, 'quests', 'ww6') };
    };
    const stale = (d: string) =>
      writeFileSync(join(d, 'validation.json'), readFileSync(join(d, 'validation.json'), 'utf8').replace(/"fingerprint": "[0-9a-f]{64}"/, `"fingerprint": "${'b'.repeat(64)}"`));
    // 1. stale only -> restamped, then a plain check passes
    const a = copy('restamp-ok');
    stale(a.dir);
    const plain = await runCheck({ seedDir: a.root, checkouts });
    expect(plain.ok).toBe(false); // without --restamp a stale stamp is a failure
    const r1 = await runCheck({ seedDir: a.root, checkouts, restamp: true });
    expect(r1.ok).toBe(true);
    expect(r1.packs[0]!.restamped).toBe(true);
    expect(readFileSync(join(a.dir, 'validation.json'), 'utf8')).not.toContain('b'.repeat(64));
    const again = await runCheck({ seedDir: a.root, checkouts });
    expect(again.ok).toBe(true);
    expect(again.packs[0]!.restamped).toBe(false);
    // 2. stale + a consistently re-hashed tampered item (only re-validation can catch it) -> NOT restamped
    const b = copy('restamp-tamper');
    stale(b.dir);
    const sha = (t: string) => createHash('sha256').update(t).digest('hex');
    const items = JSON.parse(readFileSync(join(b.dir, 'items.json'), 'utf8'));
    // a citation re-bound to a different file: schema-valid, hash-consistent, only re-resolution can catch it
    const it = items.items.find((i: { citations: { resolved?: string }[] }) => i.citations.some((c) => c.resolved));
    const c = it.citations.find((x: { resolved?: string }) => x.resolved);
    c.resolved = `${c.resolved}.moved`;
    const itemsBytes = JSON.stringify(items, null, 1) + String.fromCharCode(10);
    writeFileSync(join(b.dir, 'items.json'), itemsBytes);
    const man = JSON.parse(readFileSync(join(b.dir, 'manifest.json'), 'utf8'));
    man.items.sha256 = sha(itemsBytes);
    const manBytes = JSON.stringify(man, null, 1) + String.fromCharCode(10);
    writeFileSync(join(b.dir, 'manifest.json'), manBytes);
    const st = JSON.parse(readFileSync(join(b.dir, 'validation.json'), 'utf8'));
    st.itemsSha256 = sha(itemsBytes);
    st.manifestSha256 = sha(manBytes);
    writeFileSync(join(b.dir, 'validation.json'), JSON.stringify(st));
    const log: string[] = [];
    const r2 = await runCheck({ seedDir: b.root, checkouts, restamp: true, log: (l) => log.push(l) });
    expect(r2.ok).toBe(false);
    expect(r2.packs[0]!.restamped).toBe(false);
    expect(log.join(' | ')).toMatch(/NOT restamped/);
    expect(JSON.parse(readFileSync(join(b.dir, 'validation.json'), 'utf8')).fingerprint).toBe('b'.repeat(64));
  }, 240_000);

  it('canonical JSON ignores key order only', () => {
    expect(canonical({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonical({ a: [1, { c: 3, d: 2 }], b: 1 }));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
  });
});
