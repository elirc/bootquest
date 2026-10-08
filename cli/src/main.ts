import { readFileSync } from 'node:fs';
import { runCli } from './program.ts';

/**
 * Entry: `node --import tsx cli/src/main.ts` (root script `npm run bootquest -- <args>`),
 * or bin/bootquest.cmd -> cli/bootquest.mjs from anywhere.
 *
 * Working directory: `npm run` switches the cwd to the repo root, so when
 * invoked as the root "bootquest" script the caller's directory (npm's
 * INIT_CWD) is used for .bootquest.json discovery and relative paths.
 */
function callerCwd(env: NodeJS.ProcessEnv): string {
  if (env.npm_lifecycle_event === 'bootquest' && env.INIT_CWD) return env.INIT_CWD;
  return process.cwd();
}

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const code = await runCli(process.argv.slice(2), {
  cwd: callerCwd(process.env),
  env: process.env,
  fetch: (url, init) => fetch(url, init),
  out: (t) => process.stdout.write(`${t}\n`),
  err: (t) => process.stderr.write(`${t}\n`),
  version,
});
process.exitCode = code;
