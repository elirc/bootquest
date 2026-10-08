import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { campaignSeederFingerprint } from '@bootquest/server/campaign-fingerprint';
import type { CampaignQuest } from '@bootquest/shared';
import { buildCampaign, CampaignBuildError } from './build.ts';
import { CSHARP_ACTS, FAMILIES, JAVA_PLACEHOLDER, JS_ACTS, TWIN_PAIRS } from './rules.ts';
import { CampaignSourceError, DEFAULT_UPSKILLORDER_DIR, readUpskillorder } from './source.ts';
import { diffCampaign, writeCampaign } from './write.ts';

interface Row {
  name: string;
  stack: string;
  kind: string;
  difficulty: number;
  richness: number;
  verdict: 'study' | 'skim' | 'skip';
}

const r = (name: string, stack: string, verdict: Row['verdict'], difficulty = 2, kind = 'app', richness = 4): Row => ({ name, stack, kind, difficulty, richness, verdict });

/** Every name the rules require, plus probe rows for each verdict / bucket. */
function fixtureRows(): Row[] {
  const rows: Row[] = [];
  const add = (row: Row) => {
    if (!rows.some((x) => x.name === row.name)) rows.push(row);
  };
  // java placeholder first: they must be the four best-ranked java study repos
  for (const n of JAVA_PLACEHOLDER) add(r(n, 'java', 'study', 1, 'exercise-pack'));
  const special: Record<string, string> = { 'gitvg-astra': 'other', opusorganize: 'python', 'dotnet-snapshot': 'ts-react-node', buildsql: 'ts-react-node', e15: 'python' };
  for (const a of JS_ACTS) for (const n of a.anchors) add(r(n, special[n] ?? 'js', 'study', a.actNo === 5 ? 4 : 2, 'course'));
  for (const a of CSHARP_ACTS) for (const n of a.anchors) add(r(n, special[n] ?? 'csharp-dotnet', 'study', 3, 'course'));
  for (const f of FAMILIES) for (const n of f.picks) add(r(n, special[n] ?? 'ts-react-node', 'study', 3));
  for (const n of TWIN_PAIRS) {
    add(r(n, 'ts-react-node', 'skim', 3));
    add(r(`organized-experiment-${n}`, 'ts-react-node', 'skim', 4));
  }
  // probes
  add(r('probe-skip', 'js', 'skip'));
  add(r('probe-python', 'python', 'study'));
  add(r('probe-other', 'other', 'skim'));
  add(r('probe-java-extra', 'java', 'skim'));
  add(r('ww99', 'ts-react-node', 'skim', 3)); // ww-crud non-pick
  add(r('organized-experiment-probe', 'ts-react-node', 'study', 3)); // organized-experiment non-pick
  add(r('newcodex3-01-probe', 'ts-react-node', 'skim', 3)); // newcodex3 non-pick
  add(r('jsdrill', 'ts-react-node', 'skim', 3)); // jsdrill non-pick
  add(r('e3', 'ts-react-node', 'study', 4)); // astraupskill non-pick
  add(r('3buildprobe', 'ts-react-node', 'study', 3));
  add(r('buildprobe', 'ts-react-node', 'skim', 3)); // build* loses to 3build*
  add(r('probe-js-app', 'js', 'study', 2, 'app')); // rule: d2 app -> act 2
  add(r('probe-js-pack', 'js', 'skim', 1, 'exercise-pack')); // rule: d1 -> act 1 (a reading step)
  add(r('probe-cs-app', 'csharp-dotnet', 'skim', 3, 'app')); // rule: d3 -> act 3
  add(r('probe-rebuild-net', 'csharp-dotnet', 'study', 3, 'api')); // *-net -> act 4
  add(r('organized-study-probe', 'ts-react-node', 'study', 3, 'clone-study')); // -> act 5
  return rows;
}

/** Write a synthetic upskillorder dir: assess/batch-0..1.jsonl, INDEX.md (em dashes), START-HERE.md. */
function writeFixtureDir(dir: string, rows: Row[] = fixtureRows()): void {
  mkdirSync(join(dir, 'assess'), { recursive: true });
  const half = Math.ceil(rows.length / 2);
  const json = (x: Row) =>
    JSON.stringify({ name: x.name, stack: x.stack, size_kb: 10, pushed: '2026-01-01', kind: x.kind, upskill_richness: x.richness, teaching_assets: [], difficulty: x.difficulty, summary: `summary ${x.name}`, study_focus: `focus ${x.name}`, skip_or_study: x.verdict, confidence: 'high' });
  writeFileSync(join(dir, 'assess', 'batch-0.jsonl'), `${rows.slice(0, half).map(json).join('\n')}\n`);
  // CRLF + a duplicate (first-seen wins) in the second batch
  writeFileSync(join(dir, 'assess', 'batch-1.jsonl'), `${[...rows.slice(half), rows[0]!].map(json).join('\r\n')}\r\n`);
  const index = rows.map((x, i) => `${i + 1}. [part-01] **${x.name}** — d${x.difficulty}/r${x.richness} ${x.verdict} — focus ${x.name}`);
  writeFileSync(join(dir, 'INDEX.md'), `# Study order\n\n${index.join('\n')}\n`);
  writeFileSync(join(dir, 'START-HERE.md'), '# Start here\n');
}

const FP = 'a'.repeat(64);
const all = (q: Map<string, { acts: { actNo: number; quests: CampaignQuest[] }[] }>, track: 'js' | 'csharp' | 'java') => q.get(track)!.acts.flatMap((a) => a.quests.map((x) => ({ ...x, actNo: a.actNo })));

// generous timeouts: the first build pays module warm-up, and this machine is often saturated
describe('seed:campaign builder (synthetic upskillorder)', { timeout: 30_000 }, () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bq-campaign-'));
    writeFixtureDir(join(dir, 'src'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is deterministic: two runs are byte-identical, and a written campaign re-checks clean', () => {
    const a = buildCampaign(readUpskillorder(join(dir, 'src')), FP);
    const b = buildCampaign(readUpskillorder(join(dir, 'src')), FP);
    expect([...a.files.keys()].sort()).toEqual(['csharp.json', 'java.json', 'js.json', 'manifest.json']);
    expect([...b.files]).toEqual([...a.files]);
    writeCampaign(join(dir, 'out1'), a);
    writeCampaign(join(dir, 'out2'), b);
    for (const f of a.files.keys()) expect(readFileSync(join(dir, 'out2', f))).toEqual(readFileSync(join(dir, 'out1', f)));
    expect(diffCampaign(join(dir, 'out1'), a)).toEqual([]);
    writeFileSync(join(dir, 'out1', 'js.json'), `${readFileSync(join(dir, 'out1', 'js.json'), 'utf8')} `);
    expect(diffCampaign(join(dir, 'out1'), a)).toEqual(['js.json']);
    expect(a.files.get('manifest.json')).not.toMatch(/20\d\d-\d\d-\d\dT/); // no timestamps
  });

  it('verdicts: study -> core study-quest (content pending, study unit); skim -> one non-core reading step; skip -> absent', () => {
    const b = buildCampaign(readUpskillorder(join(dir, 'src')), FP);
    const js = all(b.tracks, 'js');
    const study = js.find((q) => q.repo === 'probe-js-app')!;
    expect(study).toMatchObject({ kind: 'study-quest', core: true, contentPending: true, verdict: 'study', actNo: 2, placement: 'rule:d2 app' });
    expect(study.unit).toEqual({ key: 'campaign/js/probe-js-app', kind: 'study', title: 'Study quest: probe-js-app', difficulty: 2 });
    const reading = js.find((q) => q.repo === 'probe-js-pack')!;
    expect(reading).toMatchObject({ kind: 'reading', core: false, contentPending: false, actNo: 1 });
    expect(reading.unit!.kind).toBe('reading');
    expect(js.some((q) => q.repo === 'probe-skip')).toBe(false);
    expect(b.manifest.report.skipAbsent).toBe(1);
    // provenance = the assess jsonl file + line
    expect(study.provenance).toHaveLength(1);
    expect(study.provenance[0]!.file).toMatch(/^assess\/batch-[01]\.jsonl$/);
    // every act is in strict rank order
    for (const t of ['js', 'csharp'] as const) {
      for (const act of b.tracks.get(t)!.acts) expect(act.quests.map((q) => q.rank)).toEqual([...act.quests.map((q) => q.rank)].sort((x, y) => x - y));
    }
  });

  it('template families: only the named picks are seeded; the rest is absent and listed as family-sampled', () => {
    const b = buildCampaign(readUpskillorder(join(dir, 'src')), FP);
    const repos = new Set(all(b.tracks, 'js').map((q) => q.repo));
    for (const n of ['ww99', 'organized-experiment-probe', 'newcodex3-01-probe', 'jsdrill', 'e3', 'buildprobe']) expect(repos.has(n)).toBe(false);
    for (const n of ['ww19', 'organized-experiment-support-hub', 'newcodex3', 'jsdrillv2', 'e12', '3buildprobe']) expect(repos.has(n)).toBe(true);
    const fam = Object.fromEntries(b.manifest.report.families.map((f) => [f.family, f]));
    expect(fam['ww-crud']!.familySampled).toEqual(['ww99']);
    expect(fam['organized-experiment']!.familySampled).toEqual(['organized-experiment-probe']);
    expect(fam['newcodex3']!.familySampled).toEqual(['newcodex3-01-probe']);
    expect(fam['jsdrill']!.familySampled).toEqual(['jsdrill']);
    expect(fam['astraupskill-e-d']!.familySampled).toEqual(['e3']);
    expect(fam['build-3build']).toMatchObject({ picks: ['3buildprobe'], familySampled: ['buildprobe'] });
    // e15 is a named pick but python: reported as a pick not seeded, never silently dropped
    expect(fam['astraupskill-e-d']!.picksNotSeeded).toEqual([{ repo: 'e15', why: 'stack python has no V1 track' }]);
    for (const f of b.manifest.report.families) expect(f.picks.length).toBeLessThanOrEqual(11);
    const ww19 = all(b.tracks, 'js').find((q) => q.repo === 'ww19')!;
    expect(ww19).toMatchObject({ family: 'ww-crud', familyPick: true });
  });

  it('no-track exclusions are reported with counts; Java keeps only the locked four-repo placeholder (inert quests)', () => {
    const b = buildCampaign(readUpskillorder(join(dir, 'src')), FP);
    const rep = b.manifest.report;
    expect(rep.noTrack.map((x) => x.repo).sort()).toEqual(['e15', 'probe-other', 'probe-python']);
    expect(rep.noTrack.every((x) => x.provenance.line > 0)).toBe(true);
    expect(rep.javaBeyondPlaceholder.map((x) => x.repo)).toEqual(['probe-java-extra']);
    const java = b.tracks.get('java')!;
    expect(java.acts).toHaveLength(1);
    expect(java.acts[0]!.locked).toBe(true);
    expect(java.acts[0]!.quests.map((q) => [q.repo, q.unit])).toEqual(JAVA_PLACEHOLDER.map((n) => [n, null]));
    // accounting: every assessed repo exactly once
    const twins = rep.twinPairs.length;
    const sampled = rep.families.reduce((n, f) => n + f.familySampled.length, 0);
    expect(rep.skipAbsent + rep.noTrack.length + rep.javaBeyondPlaceholder.length + sampled + twins + rep.seeded).toBe(rep.assessed);
  });

  it('spot-the-fix twins: one reading step on the canonical repo in act 4 with both provenance lines', () => {
    const b = buildCampaign(readUpskillorder(join(dir, 'src')), FP);
    const js = all(b.tracks, 'js');
    const pair = js.find((q) => q.repo === 'ww48')!;
    expect(pair).toMatchObject({ kind: 'reading', actNo: 4, twinRepo: 'organized-experiment-ww48', title: 'ww48 vs organized-experiment-ww48', family: 'spot-the-fix-twins' });
    expect(pair.provenance).toHaveLength(2);
    expect(js.some((q) => q.repo === 'organized-experiment-ww48')).toBe(false);
  });

  it('spec anchors pin track + act over the stack; band rules place the rest', () => {
    const b = buildCampaign(readUpskillorder(join(dir, 'src')), FP);
    const js = all(b.tracks, 'js');
    const cs = all(b.tracks, 'csharp');
    expect(js.find((q) => q.repo === 'opusorganize')).toMatchObject({ actNo: 5, placement: 'anchor:opusorganize' });
    expect(js.find((q) => q.repo === 'gitvg-astra')).toMatchObject({ actNo: 3 });
    expect(cs.find((q) => q.repo === 'buildsql')).toMatchObject({ actNo: 5 });
    expect(cs.find((q) => q.repo === 'dotnet-snapshot')).toMatchObject({ actNo: 2 });
    expect(b.manifest.report.anchorTrackOverrides.map((o) => o.repo).sort()).toEqual(['buildsql', 'dotnet-snapshot', 'gitvg-astra', 'opusorganize']);
    expect(cs.find((q) => q.repo === 'probe-cs-app')).toMatchObject({ actNo: 3, kind: 'reading' });
    expect(cs.find((q) => q.repo === 'probe-rebuild-net')).toMatchObject({ actNo: 4, placement: 'anchor:*-net rebuilds' });
    expect(js.find((q) => q.repo === 'organized-study-probe')).toMatchObject({ actNo: 5 });
    expect(js.find((q) => q.repo === 'tracer')).toMatchObject({ actNo: 4 });
  });

  it('fails loudly on a missing anchor and on assess/INDEX drift', () => {
    const rows = fixtureRows().filter((x) => x.name !== 'lucasrouter');
    writeFixtureDir(join(dir, 'missing'), rows);
    expect(() => buildCampaign(readUpskillorder(join(dir, 'missing')), FP)).toThrow(CampaignBuildError);
    expect(() => buildCampaign(readUpskillorder(join(dir, 'missing')), FP)).toThrow(/lucasrouter is not in the assessed set/);

    writeFixtureDir(join(dir, 'drift'));
    const p = join(dir, 'drift', 'INDEX.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/(\*\*probe-js-app\*\* — d2\/r4) study/, '$1 skim'));
    expect(() => readUpskillorder(join(dir, 'drift'))).toThrow(CampaignSourceError);
  });
});

const REAL = existsSync(join(DEFAULT_UPSKILLORDER_DIR, 'assess'));

describe.skipIf(!REAL)('seed:campaign on the REAL upskillorder (read-only)', { timeout: 60_000 }, () => {
  it('accounts for all 749 repos and the committed content/campaign equals a fresh build byte-for-byte', () => {
    const built = buildCampaign(readUpskillorder(), campaignSeederFingerprint());
    const rep = built.manifest.report;
    expect(rep.assessed).toBe(749);
    // 54 study/skim repos have no V1 track by stack; 2 of them (gitvg-astra, opusorganize) are pinned to JS by spec anchors
    expect(rep.noTrack.length + rep.anchorTrackOverrides.filter((o) => o.stack === 'python' || o.stack === 'other').length).toBe(54);
    const committed = fileURLToPath(new URL('../../../../content/campaign/', import.meta.url));
    expect(diffCampaign(committed, built)).toEqual([]);
  });
});
