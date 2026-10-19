// npm run seed:quests:drafts -- <repo-checkout-dir> --draft <content/seed-drafts/quests/<repo>.json> [--out <dir>] [--allow-quarantine] [--force-replace]
// --force-replace: overwrite a pack another writer / draft built (refused by default: pack.ts replaceRefusal)
// seed:quests over the draft's guide list PLUS the draft's hand-authored quiz items /
// flashcards, every candidate judged by the unchanged seed:quests validator, one pack
// written to content/seed/quests/<repo>/ and stamped only when the validator vouched.
import { finish, parseArgs } from '../factory/report.ts';
import { runQuestsWithDrafts } from './quests.ts';

finish('seed:quests:drafts', () => {
  const { positional, opts, flags } = parseArgs(process.argv.slice(2));
  const root = positional[0];
  const draft = opts.get('draft');
  if (!root || !draft) throw new Error('usage: seed:quests:drafts <repo-checkout-dir> --draft <drafts.json> [--out <dir>] [--allow-quarantine]');
  return runQuestsWithDrafts({
    root,
    draft,
    ...(opts.has('out') ? { out: opts.get('out')! } : {}),
    ...(opts.has('exclusions') ? { exclusionsPath: opts.get('exclusions')! } : {}),
    allowQuarantine: flags.has('allow-quarantine'),
    forceReplace: flags.has('force-replace'),
  });
});
