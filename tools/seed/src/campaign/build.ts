import {
  CAMPAIGN_FORMAT,
  CampaignManifest,
  CampaignTrackFile,
  type CampaignAct,
  type CampaignQuest,
  type QuestProvenance,
} from '@bootquest/shared';
import { sha256, type AssessRow, type UpskillorderInput } from './source.ts';
import {
  anchorTrack,
  BUILD_FAMILY_RULE,
  CSHARP_ACTS,
  FAMILIES,
  JAVA_ACT,
  JAVA_PLACEHOLDER,
  JS_ACTS,
  placeCsharp,
  placeJs,
  TRACK_FOR_STACK,
  TWIN_ACT,
  TWIN_PAIRS,
  UNLOCK_LEVELS,
  UNLOCK_PCT,
  type ActSpec,
  type CampaignTrack,
} from './rules.ts';

/**
 * Pure campaign builder: upskillorder rows -> track files + manifest. Same
 * input -> byte-identical output (no clock, no randomness, rank-sorted, stable
 * JSON). Every assessed repo lands in exactly one bucket, asserted at the end:
 *   skip (absent) | no V1 track | Java beyond the placeholder | family-sampled |
 *   twin snapshot (consumed by a spot-the-fix pair) | seeded quest.
 */

export class CampaignBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignBuildError';
  }
}

export interface BuiltCampaign {
  /** file name -> exact bytes to write (track files + manifest.json) */
  files: Map<string, string>;
  manifest: CampaignManifest;
  tracks: Map<CampaignTrack, CampaignTrackFile>;
}

const stableJson = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

const prov = (r: AssessRow): QuestProvenance => ({ file: r.file, line: r.line, lineSha256: r.lineSha256 });

function oneLine(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= 280 ? t : `${t.slice(0, 279)}…`;
}

interface Placed {
  row: AssessRow;
  act: number;
  placement: string;
  family: string | null;
  familyPick: boolean;
  twin: AssessRow | null;
}

function makeQuest(track: CampaignTrack, p: Placed, inert: boolean): CampaignQuest {
  const r = p.row;
  if (r.verdict === 'skip') throw new CampaignBuildError(`skip repo ${r.name} reached quest construction`);
  const study = r.verdict === 'study';
  const key = `campaign/${track}/${r.name}`;
  const title = p.twin ? `${r.name} vs ${p.twin.name}` : r.name;
  const unitTitle = p.twin ? `Spot the fix: ${r.name} vs ${p.twin.name}` : study ? `Study quest: ${r.name}` : `Reading: ${r.name}`;
  return {
    key,
    kind: study ? 'study-quest' : 'reading',
    repo: r.name,
    title,
    rank: r.rank,
    verdict: r.verdict,
    confidence: r.confidence,
    difficulty: r.difficulty,
    richness: r.richness,
    stack: r.stack,
    repoKind: r.kind,
    core: study,
    contentPending: study,
    family: p.family,
    familyPick: p.familyPick,
    twinRepo: p.twin?.name ?? null,
    placement: p.placement,
    focus: oneLine(r.focus),
    unit: inert ? null : { key, kind: study ? 'study' : 'reading', title: unitTitle, difficulty: r.difficulty },
    provenance: p.twin ? [prov(r), prov(p.twin)] : [prov(r)],
  };
}

function buildActs(track: CampaignTrack, specs: readonly ActSpec[], placed: Placed[]): CampaignAct[] {
  return specs.map((s, i) => ({
    actNo: s.actNo,
    title: s.title,
    theme: s.theme,
    unlockPct: UNLOCK_PCT,
    unlockLevel: UNLOCK_LEVELS[i]!,
    locked: false,
    quests: placed
      .filter((p) => p.act === s.actNo)
      .sort((a, b) => a.row.rank - b.row.rank)
      .map((p) => makeQuest(track, p, false)),
  }));
}

function counts(file: CampaignTrackFile) {
  const qs = file.acts.flatMap((a) => a.quests);
  return {
    acts: file.acts.length,
    quests: qs.length,
    studyQuests: qs.filter((q) => q.kind === 'study-quest').length,
    readingSteps: qs.filter((q) => q.kind === 'reading').length,
    units: qs.filter((q) => q.unit !== null).length,
  };
}

export function buildCampaign(input: UpskillorderInput, seederFingerprint: string): BuiltCampaign {
  const { rows } = input;
  const byName = new Map(rows.map((r) => [r.name, r]));
  const need = (name: string, why: string): AssessRow => {
    const r = byName.get(name);
    if (!r) throw new CampaignBuildError(`${why}: ${name} is not in the assessed set`);
    return r;
  };

  // every named anchor / pick / twin must exist: a typo must fail loudly, never thin the map silently
  for (const a of [...JS_ACTS, ...CSHARP_ACTS]) {
    for (const n of a.anchors) {
      if (need(n, `act anchor (${a.title})`).verdict === 'skip') throw new CampaignBuildError(`act anchor ${n} is a skip verdict`);
    }
  }
  for (const f of FAMILIES) for (const n of f.picks) need(n, `family ${f.id} pick`);
  for (const n of JAVA_PLACEHOLDER) need(n, 'java placeholder');
  for (const n of TWIN_PAIRS) {
    need(n, 'twin canonical');
    need(`organized-experiment-${n}`, 'twin snapshot');
  }
  // "the four" are the four best-ranked Java study repos (ranks 11-14 today): re-derive, don't trust the list
  const javaStudy = rows.filter((r) => r.stack === 'java' && r.verdict === 'study').slice(0, 4).map((r) => r.name);
  if (JSON.stringify([...javaStudy].sort()) !== JSON.stringify([...JAVA_PLACEHOLDER].sort())) {
    throw new CampaignBuildError(`the four best-ranked Java study repos are now ${javaStudy.join(', ')}, not the placeholder list`);
  }

  const buildFamilyMembers = new Set<string>();
  for (const r of rows) {
    const m = /^build(.+)$/.exec(r.name);
    if (m && byName.has(`3build${m[1]}`)) {
      buildFamilyMembers.add(r.name);
      buildFamilyMembers.add(`3build${m[1]}`);
    }
  }

  const report: CampaignManifest['report'] = {
    assessed: rows.length,
    skipAbsent: 0,
    noTrack: [],
    javaBeyondPlaceholder: [],
    families: [
      ...FAMILIES.map((f) => ({ family: f.id, rule: f.rule, picks: [...f.picks], picksNotSeeded: [] as { repo: string; why: string }[], familySampled: [] as string[] })),
      {
        family: 'build-3build',
        rule: BUILD_FAMILY_RULE,
        picks: [...buildFamilyMembers].filter((n) => n.startsWith('3build')).sort(),
        picksNotSeeded: [],
        familySampled: [],
      },
    ],
    twinPairs: [],
    anchorTrackOverrides: [],
    seeded: 0,
  };
  const familyReport = (id: string) => report.families.find((f) => f.family === id)!;
  const excluded = (r: AssessRow) => ({ repo: r.name, rank: r.rank, stack: r.stack, verdict: r.verdict as 'study' | 'skim', provenance: prov(r) });

  const placed: Record<'js' | 'csharp', Placed[]> = { js: [], csharp: [] };
  const javaPlaced: Placed[] = [];
  const twinCanonical = new Set(TWIN_PAIRS);
  const twinSnapshot = new Set(TWIN_PAIRS.map((n) => `organized-experiment-${n}`));
  let twinConsumed = 0;
  let sampled = 0;

  for (const r of rows) {
    if (r.verdict === 'skip') {
      report.skipAbsent++;
      continue;
    }
    // 1. track: a spec act anchor wins over the assessed stack
    if (!(r.stack in TRACK_FOR_STACK)) throw new CampaignBuildError(`${r.name}: unknown stack "${r.stack}" (add it to TRACK_FOR_STACK)`);
    const pinned = anchorTrack(r.name);
    const byStack = TRACK_FOR_STACK[r.stack] ?? null;
    const track = pinned ?? byStack;
    if (pinned && pinned !== byStack) report.anchorTrackOverrides.push({ repo: r.name, stack: r.stack, track: pinned });
    if (track === null) {
      report.noTrack.push(excluded(r));
      for (const f of FAMILIES) if (f.picks.includes(r.name)) familyReport(f.id).picksNotSeeded.push({ repo: r.name, why: `stack ${r.stack} has no V1 track` });
      continue;
    }
    // 2. Java: only the locked four-repo placeholder act
    if (track === 'java') {
      if (JAVA_PLACEHOLDER.includes(r.name)) javaPlaced.push({ row: r, act: 1, placement: 'anchor:java placeholder (the four ranked beginner repos)', family: null, familyPick: false, twin: null });
      else report.javaBeyondPlaceholder.push(excluded(r));
      continue;
    }
    // 3. spot-the-fix twin pairs (one reading step on the canonical repo)
    if (twinSnapshot.has(r.name)) {
      twinConsumed++;
      continue;
    }
    if (twinCanonical.has(r.name)) {
      const snap = byName.get(`organized-experiment-${r.name}`)!;
      if (track !== 'js' || snap.verdict === 'skip') throw new CampaignBuildError(`twin pair ${r.name}: needs a js canonical and a non-skip snapshot`);
      report.twinPairs.push({ canonical: r.name, snapshot: snap.name });
      placed.js.push({ row: r, act: TWIN_ACT, placement: 'anchor:spot-the-fix twin pairs', family: 'spot-the-fix-twins', familyPick: true, twin: snap });
      continue;
    }
    // 4. template families: named picks only
    const fam = FAMILIES.find((f) => f.member(r.name)) ?? (buildFamilyMembers.has(r.name) ? { id: 'build-3build', picks: report.families.at(-1)!.picks } : null);
    if (fam && !fam.picks.includes(r.name)) {
      if (pinned) throw new CampaignBuildError(`act anchor ${r.name} is an unpicked member of family ${fam.id}`);
      familyReport(fam.id).familySampled.push(r.name);
      sampled++;
      continue;
    }
    // 5. act placement
    const specs = track === 'js' ? JS_ACTS : CSHARP_ACTS;
    const anchorAct = specs.find((a) => a.anchors.includes(r.name));
    const [act, placement] = anchorAct ? [anchorAct.actNo as number, `anchor:${r.name}`] : track === 'js' ? placeJs(r) : placeCsharp(r);
    placed[track].push({ row: r, act, placement, family: fam ? fam.id : null, familyPick: fam !== null, twin: null });
  }

  for (const n of TWIN_PAIRS) if (!report.twinPairs.some((p) => p.canonical === n)) throw new CampaignBuildError(`twin pair ${n} was not seeded`);

  const files = new Map<string, string>();
  const tracks = new Map<CampaignTrack, CampaignTrackFile>();
  const trackFiles: [CampaignTrack, CampaignTrackFile][] = [
    ['js', { format: CAMPAIGN_FORMAT, track: 'js', acts: buildActs('js', JS_ACTS, placed.js) }],
    ['csharp', { format: CAMPAIGN_FORMAT, track: 'csharp', acts: buildActs('csharp', CSHARP_ACTS, placed.csharp) }],
    [
      'java',
      {
        format: CAMPAIGN_FORMAT,
        track: 'java',
        acts: [
          {
            actNo: JAVA_ACT.actNo,
            title: JAVA_ACT.title,
            theme: JAVA_ACT.theme,
            unlockPct: UNLOCK_PCT,
            unlockLevel: UNLOCK_LEVELS[0],
            locked: true,
            quests: javaPlaced.sort((a, b) => a.row.rank - b.row.rank).map((p) => makeQuest('java', p, true)),
          },
        ],
      },
    ],
  ];
  const manifestTracks: CampaignManifest['tracks'] = [];
  for (const [track, raw] of trackFiles) {
    const file = CampaignTrackFile.parse(raw);
    const bytes = stableJson(file);
    files.set(`${track}.json`, bytes);
    tracks.set(track, file);
    manifestTracks.push({
      track,
      file: `${track}.json`,
      sha256: sha256(bytes),
      counts: counts(file),
      perAct: file.acts.map((a) => ({
        actNo: a.actNo,
        studyQuests: a.quests.filter((q) => q.kind === 'study-quest').length,
        readingSteps: a.quests.filter((q) => q.kind === 'reading').length,
      })),
    });
  }

  for (const f of report.families) f.familySampled.sort();
  report.noTrack.sort((a, b) => a.rank - b.rank);
  report.javaBeyondPlaceholder.sort((a, b) => a.rank - b.rank);
  report.seeded = manifestTracks.reduce((n, t) => n + t.counts.quests, 0);

  // accounting: every assessed repo exactly once
  const accounted = report.skipAbsent + report.noTrack.length + report.javaBeyondPlaceholder.length + sampled + twinConsumed + report.seeded;
  if (accounted !== rows.length) {
    throw new CampaignBuildError(`accounting mismatch: ${accounted} bucketed vs ${rows.length} assessed`);
  }

  const manifest = CampaignManifest.parse({
    format: CAMPAIGN_FORMAT,
    seeder: { name: 'seed:campaign', fingerprint: seederFingerprint },
    sources: input.sources,
    tracks: manifestTracks,
    report,
  });
  files.set('manifest.json', stableJson(manifest));
  return { files, manifest, tracks };
}
