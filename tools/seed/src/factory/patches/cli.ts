// npm run seed:patches -- <katas-draft.json> --checkout <dir> --sha <sha> [--repo <name>] [--out <dir>]
// Defective-patch katas from real findings. Validator: defect key non-empty; every
// evidence file:line resolves (repo at the pinned sha, or the patched context);
// the diff applies cleanly (git apply --check in a temp dir); a provided test passes
// on the context and fails on the defective version (real runner: drill-js, or drill-cs
// through the warm C# runner in .cache/factory-csharp — shut down before exit).
import { withFactoryHarness } from '../harness/harness.ts';
import { finish, parseArgs } from '../report.ts';
import { runPatches } from './run.ts';

finish('seed:patches', async () => {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const draft = positional[0];
  const checkout = opts.get('checkout');
  const sha = opts.get('sha');
  if (!draft || !checkout || !sha) throw new Error('usage: seed:patches <katas-draft.json> --checkout <dir> --sha <sha> [--repo <name>] [--out <dir>]');
  return withFactoryHarness((harness) =>
    runPatches({
      draft,
      checkout,
      sha,
      harness,
      ...(opts.has('repo') ? { repo: opts.get('repo')! } : {}),
      ...(opts.has('out') ? { out: opts.get('out')! } : {}),
      ...(opts.has('exclusions') ? { exclusionsPath: opts.get('exclusions')! } : {}),
    }),
  );
});
