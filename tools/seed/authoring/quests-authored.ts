// Seed-session authoring path for seed:quests (NOT part of the fingerprinted factory).
//   node --import tsx tools/seed/authoring/quests-authored.ts <draft.json> [--out <dir>]
//
// W5a's seed:quests reads guide shapes only (Goal/**Check**, F-tables, numbered/R
// findings); it has no input for hand-authored items. Repos whose refined guides use
// other shapes (tutorials, interview vaults, stub-rebuilt learner guides) yield reading
// steps but no quizzes. This tool runs the SAME generator over the listed guides, adds
// the session's hand-authored quizzes, and puts EVERY candidate through the factory's
// own validateQuestItem (citations resolve at the pinned sha; single-keyed; exclusions)
// before writePack/stamp — so seed:check re-verifies these packs exactly like generator
// output. Authored items are bound to a guide line range; their citations are the
// parser's citations inside that range (never typed by hand). Extra authoring rule
// beyond the validator: a finding-location key/distractor written as path:line must
// itself resolve at the pinned sha.
//
// draft: { repo, sha, checkout, guides: string[], excludeDirs?: string[],
//          authored: [{ id, guide, lines: {start,end} | find: string, span?: number,
//                       variety: 'goal-check'|'finding-location', prompt,
//                       choices: [{ text, evidence?: string[] }], answer, explanation? }] }
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SeedQuizItem } from '@bootquest/shared';
import { parseCitations } from '../src/citations/parse.ts';
import { openCheckout, readTracked } from '../src/factory/checkout.ts';
import { resolveAt, seedCitations } from '../src/factory/cite.ts';
import { Exclusions } from '../src/factory/exclusions.ts';
import { emptyOutcome, writeSeedPack } from '../src/factory/pack.ts';
import { generateQuestCandidates } from '../src/factory/quests/generate.ts';
import { headings, scanLines } from '../src/factory/quests/parse.ts';
import { validateQuestItem } from '../src/factory/quests/validate.ts';
import { bucket, DEFAULT_SEED_DIR, finish, parseArgs, summarize } from '../src/factory/report.ts';
import { stableKey } from '../src/factory/util.ts';

interface AuthoredQuiz {
  id: string;
  guide: string;
  lines?: { start: number; end: number };
  find?: string;
  span?: number;
  variety: 'goal-check' | 'finding-location';
  prompt: string;
  choices: Array<{ text: string; evidence?: string[] }>;
  answer: number;
  explanation?: string;
}
interface Draft {
  repo: string;
  sha: string;
  checkout: string;
  guides: string[];
  excludeDirs?: string[];
  authored: AuthoredQuiz[];
}

const LOC = /^([^\s:]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?$/;

finish('seed:quests(authored)', () => {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const draftPath = positional[0];
  if (!draftPath) throw new Error('usage: quests-authored.ts <draft.json> [--out <dir>]');
  const d = JSON.parse(readFileSync(draftPath, 'utf8')) as Draft;
  const ex = Exclusions.load();
  const co = openCheckout({ root: resolve(d.checkout), sha: d.sha, repo: d.repo, ...(d.excludeDirs ? { excludeDirs: d.excludeDirs } : {}) });
  const head = [`[seed:quests(authored)] repo ${co.repo} @ ${co.sha} (pin ${co.pin}); generator guides ${d.guides.length}; authored ${d.authored.length}`];
  const repoHit = ex.repo(co.repo);
  if (repoHit) throw new Error(`repo ${co.repo} is ${repoHit.reason}`);
  const outcome = emptyOutcome();
  if (d.guides.length) {
    const cand = generateQuestCandidates(co, d.guides, ex);
    outcome.skipped.push(...cand.excludedGuides);
    for (const g of cand.guides) {
      outcome.skipped.push(...g.skipped);
      for (const item of g.items) bucket(outcome, item.key, validateQuestItem(co, ex, item));
    }
  }
  const authoredProblems: string[] = [];
  const seen = new Set<string>();
  for (const a of d.authored) {
    if (seen.has(a.id)) authoredProblems.push(`duplicate authored id ${a.id}`);
    seen.add(a.id);
    const text = readTracked(co, a.guide);
    let lines = a.lines;
    if (!lines) {
      const i = text.indexOf(a.find!);
      if (i < 0 || text.indexOf(a.find!, i + 1) >= 0) {
        authoredProblems.push(`${a.id}: find text ${i < 0 ? 'not found' : 'not unique'} in ${a.guide}`);
        continue;
      }
      const start = text.slice(0, i).split('\n').length;
      lines = { start, end: start + (a.span ?? a.find!.split('\n').length) - 1 };
    }
    const sl = scanLines(text);
    const cites = seedCitations(parseCitations(text, a.guide).citations, headings(sl)).filter((c) => c.sourceLine >= lines!.start && c.sourceLine <= lines!.end);
    if (a.variety === 'finding-location') {
      for (const ch of a.choices) {
        const m = LOC.exec(ch.text.trim());
        if (!m) {
          authoredProblems.push(`${a.id}: location choice "${ch.text}" is not path:line`);
          continue;
        }
        const r = resolveAt(co, a.guide, { path: m[1]!, lineStart: Number(m[2]), lineEnd: Number(m[3] ?? m[2]), form: 'path-line', raw: ch.text, source: { file: a.guide, line: lines.start, column: 1 }, group: 0 });
        if (r.status === 'error') authoredProblems.push(`${a.id}: location choice ${ch.text} -> ${r.reason}: ${r.message}`);
      }
    }
    const key = stableKey('quests', co.repo, 'quiz', ['authored', a.id]);
    const item: SeedQuizItem = {
      kind: 'quiz',
      key,
      provenance: { repo: co.repo, sha: co.sha, path: a.guide, lines },
      citations: cites,
      variety: a.variety,
      prompt: a.prompt,
      choices: a.choices.map((c) => ({ text: c.text, evidence: c.evidence ?? [] })),
      check: { type: 'quiz', itemKey: key, grading: 'choice', answerKey: a.answer, choices: a.choices.map((c) => c.text) },
      explanation: a.explanation ?? '',
    };
    bucket(outcome, key, validateQuestItem(co, ex, item));
  }
  if (authoredProblems.length) throw new Error(`authoring rule failures:\n  ${authoredProblems.join('\n  ')}`);
  const outDir = opts.get('out') ?? join(DEFAULT_SEED_DIR, 'quests', co.repo);
  const inputs = [...new Set([...d.guides, ...d.authored.map((a) => a.guide)])].concat(`draft:${draftPath.replace(/\\/g, '/').split('/').pop()}`);
  const write = writeSeedPack({ dir: outDir, generator: 'quests', name: co.repo, checkout: co, inputs, outcome });
  const r = summarize('quests', head, outcome, write, outDir, false);
  const quizzes = outcome.accepted.filter((i) => i.kind === 'quiz').length;
  r.lines.splice(r.lines.length - 1, 0, `QUIZZES shipped ${quizzes} (generator + authored)`);
  return r;
});
