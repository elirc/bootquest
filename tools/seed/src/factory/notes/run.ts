/** seed:notes end to end: notes draft + quest pack + checkout at the pinned sha -> validator -> pack + stamp. */
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import { NotesDraft, type SeedNoteItem } from '@bootquest/shared';
import { CheckoutError, openCheckout } from '../checkout.ts';
import { Exclusions } from '../exclusions.ts';
import { emptyOutcome, writeSeedPack } from '../pack.ts';
import { bucket, DEFAULT_SEED_DIR, refusal, summarize, type RunReport } from '../report.ts';
import { buildNoteItem, loadQuestPackView, notesCoverageProblems, questsBinding, validateNote, type QuestPackView } from './notes.ts';

export interface NotesOptions {
  /** source checkout (.cache/checkouts/<repo>@<sha>) */
  checkout: string;
  /** content/seed-drafts/notes/<pack>.json */
  draft: string;
  /** quest packs root (default content/seed/quests) */
  questsDir?: string;
  /** output dir (default content/seed/notes/<pack>) */
  out?: string;
  exclusionsPath?: string;
  /** stamp even though some notes were quarantined (coverage must still hold) */
  allowQuarantine?: boolean;
}

export function runNotes(o: NotesOptions): RunReport {
  const head = [`[seed:notes] draft ${o.draft}`];
  let raw: string;
  let draft: NotesDraft;
  try {
    raw = readFileSync(o.draft, 'utf8');
    draft = NotesDraft.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof z.ZodError) return refusal('notes', head, `draft is malformed: ${err.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    if (err instanceof SyntaxError) return refusal('notes', head, `draft is not JSON: ${err.message}`);
    throw err;
  }
  let ex: Exclusions;
  try {
    ex = Exclusions.load(o.exclusionsPath);
  } catch (err) {
    return refusal('notes', head, `exclusion registry: ${err instanceof Error ? err.message : String(err)}`);
  }
  const secrets = ex.scan(raw);
  if (secrets.length) return refusal('notes', head, `UNREGISTERED SECRET: draft ${o.draft} matches secret pattern(s) ${secrets.join(', ')}`);
  const repoHit = ex.repo(draft.repo);
  if (repoHit) return refusal('notes', head, `repo ${draft.repo} is ${repoHit.reason}: ${repoHit.entry.note}`);

  let quests: QuestPackView;
  const questDir = resolve(o.questsDir ?? join(DEFAULT_SEED_DIR, 'quests'), draft.pack);
  try {
    quests = loadQuestPackView(questDir);
  } catch (err) {
    return refusal('notes', head, `quest pack ${draft.pack}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (quests.repo !== draft.repo) return refusal('notes', head, `draft repo ${draft.repo} != quest pack ${draft.pack} source.repo ${quests.repo}`);
  if (quests.sha !== draft.sha) return refusal('notes', head, `draft sha ${draft.sha} != quest pack ${draft.pack} source.sha ${quests.sha}`);

  let co;
  try {
    co = openCheckout({ root: o.checkout, sha: draft.sha, repo: draft.repo });
  } catch (err) {
    if (err instanceof CheckoutError) return refusal('notes', head, err.message);
    throw err;
  }
  head[0] = `[seed:notes] pack ${draft.pack}: repo ${co.repo} @ ${co.sha} (pin ${co.pin}); ${draft.notes.length} draft note(s); quest pack ${quests.quizzes.length} quiz(zes), items sha256 ${quests.itemsSha256.slice(0, 12)}`;

  const outcome = emptyOutcome();
  const seenIds = new Set<string>();
  const afterFor = new Set<string>();
  draft.notes.forEach((n, i) => {
    const item = buildNoteItem(co, draft.pack, n);
    if (seenIds.has(n.id)) {
      outcome.rejected.push({ key: `${item.key}#dup-${i + 1}`, reason: `duplicate note id ${n.id} (note ${i + 1}); ids are unique per draft` });
      return;
    }
    seenIds.add(n.id);
    const v = validateNote(co, ex, quests, item);
    if (v.verdict === 'accept' && n.phase === 'after') {
      if (afterFor.has(n.target)) {
        outcome.rejected.push({ key: item.key, reason: `second after note for quiz ${n.target} (exactly one per quiz)` });
        return;
      }
      afterFor.add(n.target);
    }
    bucket(outcome, item.key, v);
  });
  const blockers = notesCoverageProblems(outcome.accepted as SeedNoteItem[], quests);
  const outDir = o.out ?? join(DEFAULT_SEED_DIR, 'notes', draft.pack);
  const write = writeSeedPack({
    dir: outDir,
    generator: 'notes',
    name: draft.pack,
    checkout: co,
    inputs: [`draft:${basename(o.draft.replace(/\\/g, '/'))}`, questsBinding(quests)],
    outcome,
    ...(o.allowQuarantine ? { allowQuarantine: true } : {}),
    blockers,
  });
  const report = summarize('notes', head, outcome, write, outDir, o.allowQuarantine === true);
  const at = report.lines.findIndex((l) => l.startsWith('COUNTS'));
  report.lines.splice(at < 0 ? report.lines.length : at, 0, ...blockers.map((b) => `  COVERAGE ${b}`));
  return report;
}
