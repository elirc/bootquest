// npm run seed:sync [-- --repo <owner/name> ...] [--offline] [--queue [N]]
//
// Seed-session entry point for the GitHub curriculum sync (spec §7 `seed:sync`:
// "refresh content_refs; list new stable_keys needing seeding"). Runs the SAME
// job as POST /api/sync / `bootquest sync` (server/src/sync/job.ts) directly
// against BOOTQUEST_DB, then prints the pending seed queue.
//   BOOTQUEST_DB            (required) the DB file
//   BOOTQUEST_CURRICULUM    default <repo>/curriculum.yaml
//   BOOTQUEST_CHECK_SPECS   default <repo>/content/sync/check-specs.json
//   BOOTQUEST_GITHUB_CACHE  default <repo>/.cache/github
//   BOOTQUEST_OFFLINE=1     (or --offline) cache only, never the network
// Exit 0 when every repo synced, 1 when any repo failed, 2 on usage/config errors.
import { openDb, resolveDbPath } from '@bootquest/server/db';
import { createSyncService, resolveSyncPaths, seedQueue } from '@bootquest/server/sync';

function args(): { repos: string[]; offline: boolean; queue: number } {
  const argv = process.argv.slice(2);
  const repos: string[] = [];
  let offline = false;
  let queue = 20;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--repo') {
      const v = argv[++i];
      if (!v) throw new Error('--repo needs owner/name');
      repos.push(v);
    } else if (a === '--offline') offline = true;
    else if (a === '--queue') {
      const v = argv[i + 1];
      if (v !== undefined && /^\d+$/.test(v)) {
        queue = Number(v);
        i++;
      } else queue = 1_000_000;
    } else throw new Error(`unknown argument ${a}`);
  }
  return { repos, offline, queue };
}

async function main(): Promise<number> {
  const a = args();
  const env = { ...process.env, ...(a.offline ? { BOOTQUEST_OFFLINE: '1' } : {}) };
  const paths = resolveSyncPaths(env);
  const db = openDb({ path: resolveDbPath({ env }), env: {} });
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    console.log(`[seed:sync] registry ${paths.curriculum}`);
    console.log(`[seed:sync] cache    ${paths.cacheRoot}${paths.offline ? ' (OFFLINE)' : ''}`);
    const svc = createSyncService(paths);
    const report = await svc.run(db, () => new Date(Date.now()), {
      ...(a.repos.length ? { repos: a.repos } : {}),
      log: (l) => console.log(l),
    });
    const q = seedQueue(db, { status: 'pending', limit: a.queue });
    console.log(`[seed:sync] sync #${report.syncId}: ${report.repos.filter((r) => r.error === null).length}/${report.repos.length} repo(s) ok`);
    console.log(`[seed:sync] seed queue: ${q.count} pending stable_key(s)`);
    for (const it of q.items) console.log(`  ${it.reason.padEnd(7)} ${it.repo} ${it.stableKey} ${it.path}${it.anchor ? `#${it.anchor}` : ''} "${it.title}"`);
    if (q.count > q.items.length) console.log(`  ... and ${q.count - q.items.length} more (--queue to list all)`);
    return report.ok ? 0 : 1;
  } finally {
    db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[seed:sync] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);
