// node-test-file workspace sweeper. Run from the repo root:
//   npm run sweep:ntf      (= node server/scripts/sweep-ntf.mjs)
// The runner keeps every per-run workspace under a per-PROCESS parent
// (os.tmpdir()/bq-ntf-<pid>/bq-ntf-XXXXXX) and removes it in a finally — but a
// hard kill (taskkill of the whole tree, power loss) can orphan the parent.
// This sweeper:
//   - REMOVES every bq-ntf-<pid> parent whose pid is no longer alive
//     (nothing can still be using it);
//   - FLAGS (never deletes) everything else that looks stale: a live-pid parent
//     or a legacy flat bq-ntf-* workspace older than MAX_AGE_MS — a live pid may
//     be a reused pid, and deleting under a running grader would corrupt a run.
// Exit 0 always (a sweep never fails the caller); prints one line per action.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h: nothing in these workspaces legitimately lives this long

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = alive but not ours; anything else (ESRCH) = gone
    return err.code === 'EPERM';
  }
}

const root = tmpdir();
let removed = 0;
let flagged = 0;
let kept = 0;
for (const name of readdirSync(root)) {
  if (!name.startsWith('bq-ntf-')) continue;
  const abs = join(root, name);
  let st;
  try {
    st = statSync(abs);
  } catch {
    continue; // vanished between readdir and stat
  }
  if (!st.isDirectory()) continue;
  const m = /^bq-ntf-(\d+)$/.exec(name);
  if (m && !pidAlive(Number(m[1]))) {
    try {
      rmSync(abs, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      removed++;
      console.log(`REMOVED ${name} (pid ${m[1]} is dead)`);
    } catch (err) {
      flagged++;
      console.log(`FLAGGED ${name} (pid ${m[1]} is dead but removal failed: ${err.code ?? err.message})`);
    }
    continue;
  }
  const ageMs = Date.now() - st.mtimeMs;
  if (ageMs > MAX_AGE_MS) {
    flagged++;
    const why = m ? `pid ${m[1]} is alive (or reused)` : 'legacy flat workspace';
    console.log(`FLAGGED ${name} (${why}; untouched for ${(ageMs / 3_600_000).toFixed(1)}h) — inspect before deleting`);
  } else {
    kept++;
  }
}
console.log(`[sweep:ntf] removed ${removed} dead-pid dir(s), flagged ${flagged}, kept ${kept} recent/live`);
