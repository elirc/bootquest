// npm run seed:campaign [-- --source <upskillorder dir>] [--out <dir>] [--check]
// Reads Desktop\upskillorder (READ-ONLY: assess/*.jsonl + INDEX.md + START-HERE.md) and writes
// content/campaign/{js,csharp,java}.json + manifest.json. --check rebuilds in memory and
// exits 1 unless the committed files are byte-identical (the source-hash re-verification).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { campaignSeederFingerprint } from '@bootquest/server/campaign-fingerprint';
import { buildCampaign } from './build.ts';
import { DEFAULT_UPSKILLORDER_DIR, readUpskillorder } from './source.ts';
import { diffCampaign, writeCampaign } from './write.ts';

export const DEFAULT_CAMPAIGN_OUT = fileURLToPath(new URL('../../../../content/campaign/', import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): number {
  const sourceDir = resolve(arg('source') ?? DEFAULT_UPSKILLORDER_DIR);
  const outDir = resolve(arg('out') ?? DEFAULT_CAMPAIGN_OUT);
  const check = process.argv.includes('--check');
  console.log(`[seed:campaign] source ${sourceDir}`);
  console.log(`[seed:campaign] out    ${outDir}${check ? ' (check only)' : ''}`);
  const built = buildCampaign(readUpskillorder(sourceDir), campaignSeederFingerprint());
  const m = built.manifest;
  const r = m.report;

  for (const t of m.tracks) {
    const file = built.tracks.get(t.track)!;
    console.log(`  ${t.track}: ${t.counts.acts} act(s), ${t.counts.quests} quests (${t.counts.studyQuests} study quests / ${t.counts.readingSteps} reading steps)`);
    for (const a of file.acts) {
      const s = t.perAct.find((p) => p.actNo === a.actNo)!;
      console.log(
        `    act ${a.actNo} ${a.title.padEnd(26)} study ${String(s.studyQuests).padStart(3)}  reading ${String(s.readingSteps).padStart(3)}  ` +
          `unlock: ${a.locked ? 'STATIC LOCK' : a.actNo === 1 ? 'open' : `>=${Math.round(a.unlockPct * 100)}% of act ${a.actNo - 1} core + level ${a.unlockLevel}`}`,
      );
    }
  }
  console.log(`  assessed ${r.assessed}: seeded ${r.seeded} quests, skip-absent ${r.skipAbsent}, no V1 track ${r.noTrack.length}, promoted to study ${r.promotedToStudy.length}`);
  console.log(`  promoted to study (${r.promotedToStudy.length}): ${r.promotedToStudy.map((p) => p.repo).join(', ') || '(none)'}`);
  console.log(`  no-track exclusions (${r.noTrack.length}): ${r.noTrack.map((x) => `${x.repo}[${x.stack}]`).join(', ')}`);
  console.log(`  anchor track overrides: ${r.anchorTrackOverrides.map((o) => `${o.repo} ${o.stack}->${o.track}`).join(', ') || '(none)'}`);
  for (const f of r.families) {
    console.log(
      `  family ${f.family}: picks ${f.picks.length} [${f.picks.join(', ')}]` +
        (f.picksNotSeeded.length ? `; picks not seeded: ${f.picksNotSeeded.map((p) => `${p.repo} (${p.why})`).join(', ')}` : '') +
        `; family-sampled (absent) ${f.familySampled.length}`,
    );
  }
  console.log(`  spot-the-fix twin pairs: ${r.twinPairs.map((p) => `${p.canonical}/${p.snapshot}`).join(', ')}`);
  console.log(`  seeder fingerprint ${m.seeder.fingerprint.slice(0, 16)}...`);

  if (check) {
    const diffs = diffCampaign(outDir, built);
    if (diffs.length) {
      console.error(`[seed:campaign] CHECK FAILED: ${diffs.join(', ')} differ from a fresh build`);
      return 1;
    }
    console.log('[seed:campaign] check ok: committed campaign packs equal a fresh build byte-for-byte');
    return 0;
  }
  const { written, removed } = writeCampaign(outDir, built);
  console.log(`  wrote ${written.join(', ')}${removed.length ? `; removed stale ${removed.join(', ')}` : ''}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`[seed:campaign] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
