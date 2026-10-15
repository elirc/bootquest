// npm run seed:notes -- <checkout> --draft content/seed-drafts/notes/<pack>.json [--quests <dir>] [--out <dir>] [--allow-quarantine]
// "Learn more" notes for one quest pack (contract bootquest-notes-draft@1): before-notes
// (readings, never leak a keyed answer) and after-notes (one explanation per quiz, released
// only after an answer). Every excerpt quotes its lines verbatim at the pinned sha.
// Writes content/seed/notes/<pack>/ (items, manifest, quarantine, validation stamp).
import { finish, parseArgs } from '../report.ts';
import { runNotes } from './run.ts';

finish('seed:notes', () => {
  const { positional, opts, flags } = parseArgs(process.argv.slice(2));
  const checkout = positional[0];
  const draft = opts.get('draft');
  if (!checkout || !draft) throw new Error('usage: seed:notes <checkout> --draft <notes-draft.json> [--quests <dir>] [--out <dir>] [--allow-quarantine]');
  return runNotes({
    checkout,
    draft,
    ...(opts.has('quests') ? { questsDir: opts.get('quests')! } : {}),
    ...(opts.has('out') ? { out: opts.get('out')! } : {}),
    ...(opts.has('exclusions') ? { exclusionsPath: opts.get('exclusions')! } : {}),
    ...(flags.has('allow-quarantine') ? { allowQuarantine: true } : {}),
  });
});
