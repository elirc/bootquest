// npm run seed:checkout -- --repo <repo> --sha <sha> [--cache <dir>] [--fetch]
// THE checkout recipe (docs/SEEDING.md §2): writes <cache>/checkouts/<repo>@<sha> from
// the mirror <cache>/repos/<repo> (or <cache>/sources/<repo>) byte-for-byte from git's
// blobs — never `git archive` (it applies core.autocrlf, which this machine's SYSTEM
// gitconfig sets to true) — into a fresh temp dir renamed into place, so no stale file
// from an older extraction can survive. An existing checkout that already hashes
// clean against the tree is left alone. --fetch first runs the mirror commands
// (gh repo clone --depth 1 when the mirror is absent; git fetch --depth 1 origin <sha>).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkTreeShape, extractTree, fetchHint, findMirror, gitTree, mirrorRoots } from '../factory/pins.ts';
import { parseArgs, REPO_ROOT } from '../factory/report.ts';

const { opts, flags } = parseArgs(process.argv.slice(2));
const repo = opts.get('repo');
const sha = opts.get('sha');
const cacheDir = resolve(opts.get('cache') ?? resolve(REPO_ROOT, '.cache'));
if (!repo || !sha || !/^[0-9a-f]{40}$/.test(sha)) {
  console.error('usage: npm run seed:checkout -- --repo <repo> --sha <40-hex sha> [--cache <dir>] [--fetch]');
  process.exit(2);
}
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'inherit', windowsHide: true });

let m = findMirror(repo, sha, mirrorRoots(cacheDir));
if (!m.found && flags.has('fetch')) {
  const mirror = join(cacheDir, 'repos', repo);
  if (!existsSync(mirror)) run('gh', ['repo', 'clone', `elirc/${repo}`, mirror, '--', '--depth', '1', '-q']);
  run('git', ['-c', 'core.autocrlf=false', '-C', mirror, 'fetch', '--quiet', '--depth', '1', 'origin', sha]);
  m = findMirror(repo, sha, mirrorRoots(cacheDir));
}
if (!m.found) {
  console.error(`[seed:checkout] no mirror holding ${repo}@${sha.slice(0, 12)} (${m.why}). Fetch it (Git Bash), or re-run with --fetch:\n  ${fetchHint(repo, sha, cacheDir)}`);
  process.exit(1);
}
const tree = gitTree(m.mirror, m.commit);
const dest = join(cacheDir, 'checkouts', `${repo}@${sha}`);
if (existsSync(dest) && checkTreeShape(dest, tree, { deep: true }).length === 0) {
  console.log(`[seed:checkout] ${dest} already byte-identical to ${repo}@${sha.slice(0, 12)} (${tree.size} blob(s)); left alone`);
  process.exit(0);
}
const r = extractTree(m.mirror, m.commit, dest);
const bad = checkTreeShape(dest, tree, { deep: true });
if (bad.length) {
  console.error(`[seed:checkout] extracted ${dest} but it still differs from git: ${bad.slice(0, 5).join('; ')}`);
  process.exit(1);
}
console.log(`[seed:checkout] ${dest}: ${r.files} file(s), ${r.bytes} byte(s), byte-identical to ${repo}@${sha.slice(0, 12)} from ${m.mirror}`);
