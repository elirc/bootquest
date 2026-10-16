import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAMPAIGN_FORMAT, CampaignManifest, CampaignTrackFile, type CampaignQuest } from '@bootquest/shared';
import { campaignSeederFingerprint } from '../src/store/campaign-fingerprint.ts';

/**
 * A small hand-built campaign pack (the server cannot depend on tools/seed),
 * stamped with the REAL seeder fingerprint so the loader accepts it:
 *   js     act 1: study A (rank 1), reading R1 (2), reading R2 (3)
 *          act 2: study B (4), reading R3 (5)      [unlock 80% of act 1 core + level 2]
 *   csharp act 1: study C (6), reading CR (7)
 *   java   act 1 (static lock): inert study J (8) — synthetic; the shipped Java campaign is
 *          unlocked, this act keeps the static-lock path (still supported by the schema) under test
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let line = 0;

export function quest(track: 'js' | 'csharp' | 'java', repo: string, kind: 'study-quest' | 'reading', rank: number, inert = false): CampaignQuest {
  const study = kind === 'study-quest';
  const key = `campaign/${track}/${repo}`;
  line += 1;
  return {
    key,
    kind,
    repo,
    title: repo,
    rank,
    verdict: study ? 'study' : 'skim',
    confidence: 'high',
    difficulty: 2,
    richness: 4,
    stack: track === 'csharp' ? 'csharp-dotnet' : track === 'java' ? 'java' : 'js',
    repoKind: 'app',
    core: study,
    contentPending: study,
    family: null,
    familyPick: false,
    twinRepo: null,
    placement: 'rule:test',
    focus: `focus for ${repo}`,
    unit: inert ? null : { key, kind: study ? 'study' : 'reading', title: `${study ? 'Study quest' : 'Reading'}: ${repo}`, difficulty: 2 },
    provenance: [{ file: 'assess/batch-0.jsonl', line, lineSha256: sha(repo) }],
  };
}

export type FixtureTracks = Record<'js' | 'csharp' | 'java', CampaignTrackFile>;

export function defaultFixtureTracks(): FixtureTracks {
  const act = (actNo: number, quests: CampaignQuest[], over: { unlockLevel?: number; locked?: boolean } = {}) => ({
    actNo,
    title: `Act ${actNo}`,
    theme: `theme ${actNo}`,
    unlockPct: 0.8,
    unlockLevel: over.unlockLevel ?? 1,
    locked: over.locked ?? false,
    quests,
  });
  return {
    js: {
      format: CAMPAIGN_FORMAT,
      track: 'js',
      acts: [
        act(1, [quest('js', 'study-a', 'study-quest', 1), quest('js', 'read-r1', 'reading', 2), quest('js', 'read-r2', 'reading', 3)]),
        act(2, [quest('js', 'study-b', 'study-quest', 4), quest('js', 'read-r3', 'reading', 5)], { unlockLevel: 2 }),
      ],
    },
    csharp: { format: CAMPAIGN_FORMAT, track: 'csharp', acts: [act(1, [quest('csharp', 'study-c', 'study-quest', 6), quest('csharp', 'read-cr', 'reading', 7)])] },
    java: { format: CAMPAIGN_FORMAT, track: 'java', acts: [act(1, [quest('java', 'java-j', 'study-quest', 8, true)], { locked: true })] },
  };
}

/** Write manifest + track files into dir (exact bytes + hashes), return the dir. */
export function writeCampaignFixture(dir: string, tracks: FixtureTracks = defaultFixtureTracks(), over: { fingerprint?: string } = {}): string {
  mkdirSync(dir, { recursive: true });
  const manifestTracks: CampaignManifest['tracks'] = [];
  for (const t of ['js', 'csharp', 'java'] as const) {
    const file = CampaignTrackFile.parse(tracks[t]);
    const bytes = `${JSON.stringify(file, null, 2)}\n`;
    writeFileSync(join(dir, `${t}.json`), bytes);
    const qs = file.acts.flatMap((a) => a.quests);
    manifestTracks.push({
      track: t,
      file: `${t}.json`,
      sha256: sha(bytes),
      counts: {
        acts: file.acts.length,
        quests: qs.length,
        studyQuests: qs.filter((q) => q.kind === 'study-quest').length,
        readingSteps: qs.filter((q) => q.kind === 'reading').length,
        units: qs.filter((q) => q.unit !== null).length,
      },
      perAct: file.acts.map((a) => ({
        actNo: a.actNo,
        studyQuests: a.quests.filter((q) => q.kind === 'study-quest').length,
        readingSteps: a.quests.filter((q) => q.kind === 'reading').length,
      })),
    });
  }
  const manifest = CampaignManifest.parse({
    format: CAMPAIGN_FORMAT,
    seeder: { name: 'seed:campaign', fingerprint: over.fingerprint ?? campaignSeederFingerprint() },
    sources: [{ file: 'INDEX.md', sha256: sha('index'), lines: 1 }],
    tracks: manifestTracks,
    report: {
      assessed: 8,
      skipAbsent: 0,
      noTrack: [],
      promotedToStudy: [],
      families: [],
      twinPairs: [],
      anchorTrackOverrides: [],
      seeded: manifestTracks.reduce((n, t) => n + t.counts.quests, 0),
    },
  });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
