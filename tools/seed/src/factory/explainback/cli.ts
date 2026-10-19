// npm run seed:explainback -- <unit-source> --checkout <dir> --sha <sha> [--repo <name>] [--draft <set.json>] [--out <dir>] [--force-replace]
// 3 questions x 5-8 key points from the unit's source; every key point must quote
// (whitespace-normalized substring) or cite (resolvable file:line) the source.
// Without --draft: a deterministic scaffold (first three H2 sections, verbatim sentences).
import { finish, parseArgs } from '../report.ts';
import { runExplainBack } from './run.ts';

finish('seed:explainback', () => {
  const { positional, opts, flags } = parseArgs(process.argv.slice(2));
  const unit = positional[0];
  const checkout = opts.get('checkout');
  const sha = opts.get('sha');
  if (!unit || !checkout || !sha) throw new Error('usage: seed:explainback <unit-source> --checkout <dir> --sha <sha> [--repo <name>] [--draft <set.json>] [--out <dir>]');
  return runExplainBack({
    unit,
    checkout,
    sha,
    ...(opts.has('repo') ? { repo: opts.get('repo')! } : {}),
    ...(opts.has('draft') ? { draft: opts.get('draft')! } : {}),
    ...(opts.has('out') ? { out: opts.get('out')! } : {}),
    ...(opts.has('exclusions') ? { exclusionsPath: opts.get('exclusions')! } : {}),
    forceReplace: flags.has('force-replace'),
  });
});
