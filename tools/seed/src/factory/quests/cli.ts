// npm run seed:quests -- <repo-checkout-dir> --sha <sha> [--repo <name>] [--guides a.md,b.md]
//                        [--out <dir>] [--exclude-dir <d1,d2>] [--allow-quarantine] [--exclusions <file>] [--force-replace]
// --force-replace: overwrite a pack a drafts / authored run built (refused by default: its hand
// items would be silently replaced; pack.ts replaceRefusal)
// Reads the repo's refined guides (Goal/**Check** exercises, senior-review findings),
// emits quiz items / finding-flashcards / reading steps, validates every one
// (citations resolve at the pinned sha; quizzes single-keyed; excluded files dropped),
// writes content/seed/quests/<repo>/ and stamps it only when the validator vouched.
// Exit 0 = stamped with nothing quarantined (or --allow-quarantine); 1 otherwise.
import { finish, parseArgs } from '../report.ts';
import { runQuests } from './run.ts';

finish('seed:quests', () => {
  const { positional, opts, flags } = parseArgs(process.argv.slice(2));
  const root = positional[0];
  const sha = opts.get('sha');
  if (!root || !sha) throw new Error('usage: seed:quests <repo-checkout-dir> --sha <sha> [--repo <name>] [--guides a.md,b.md] [--out <dir>] [--allow-quarantine]');
  return runQuests({
    root,
    sha,
    ...(opts.has('repo') ? { repo: opts.get('repo')! } : {}),
    ...(opts.has('guides') ? { guides: opts.get('guides')!.split(',').filter(Boolean) } : {}),
    ...(opts.has('out') ? { out: opts.get('out')! } : {}),
    ...(opts.has('exclude-dir') ? { excludeDirs: opts.get('exclude-dir')!.split(',').filter(Boolean) } : {}),
    ...(opts.has('exclusions') ? { exclusionsPath: opts.get('exclusions')! } : {}),
    allowQuarantine: flags.has('allow-quarantine'),
    forceReplace: flags.has('force-replace'),
  });
});
