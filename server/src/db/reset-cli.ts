// `npm run reset -- --yes-really` (root) — see reset.ts for the guards. Exit 0 / 1 / 2.
import { runReset } from './reset.ts';

process.exitCode = await runReset(process.argv.slice(2), {
  env: process.env,
  now: () => new Date(),
  out: (l) => console.log(l),
  err: (l) => console.error(l),
});
