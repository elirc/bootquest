/**
 * seed:quests + hand-authored drafts (W5c). The seed-time LLM writes extra
 * quiz items / flashcards for a repo as a draft file; this runner feeds them
 * through the SAME seed:quests validator as the generator's candidates and
 * writes ONE pack (content/seed/quests/<repo>/), so seed:check re-validates
 * every hand-authored item with the unchanged validator (validateQuestItem)
 * on every run. Nothing here weakens a gate:
 *   - draft repo/sha must equal the checkout's; the draft is secret-scanned;
 *   - every hand item must carry >= 1 citation (stricter than the validator,
 *     which only demands one for flashcards) — refused items are quarantined;
 *   - keys are stableKey('quests', repo, kind, ['hand-authored', id]) and must
 *     not collide with generator keys;
 *   - quiz choice order is hash-seeded like the generator's (no RNG).
 * The draft file is recorded in the manifest inputs as `draft:<name>`.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { SeedCitation, SeedFlashcardItem, SeedItem, SeedQuizItem } from '@bootquest/shared';
import { CheckoutError, openCheckout, type Checkout } from '../factory/checkout.ts';
import { Exclusions, UnregisteredSecretError } from '../factory/exclusions.ts';
import { emptyOutcome, writeSeedPack } from '../factory/pack.ts';
import { bucket, DEFAULT_SEED_DIR, refusal, summarize, type RunReport } from '../factory/report.ts';
import { generateQuestCandidates } from '../factory/quests/generate.ts';
import { validateQuestItem } from '../factory/quests/validate.ts';
import { hashOrder, stableKey } from '../factory/util.ts';

export const QUEST_DRAFTS_FORMAT = 'bootquest-quest-drafts@1' as const;

const Range = z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).strict();
const Cite = z.object({ path: z.string().min(1), lineStart: z.number().int().positive(), lineEnd: z.number().int().positive() }).strict();
const Source = z.object({ path: z.string().min(1), lines: Range }).strict();

const DraftQuiz = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._-]+$/),
    kind: z.literal('quiz'),
    source: Source,
    cites: z.array(Cite),
    /** what the quiz drills (seed-pack SeedQuizItem.variety); hand items default to 'concept' */
    variety: z.enum(['concept', 'goal-check', 'finding-location']).optional(),
    prompt: z.string().min(1),
    answer: z.string().min(1),
    distractors: z.array(z.string().min(1)).min(2).max(4),
    explanation: z.string().min(1),
  })
  .strict();

const DraftFlashcard = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._-]+$/),
    kind: z.literal('flashcard'),
    source: Source,
    cites: z.array(Cite),
    /** the finding shape it was written from (seed-pack SeedFlashcardItem.shape); default 'hand-authored' */
    shape: z.enum(['hand-authored', 'f-table', 'numbered', 'r-heading']).optional(),
    severity: z.string().optional(),
    front: z.string().min(1),
    back: z.string().min(1),
  })
  .strict();

export const QuestDrafts = z
  .object({
    format: z.literal(QUEST_DRAFTS_FORMAT),
    repo: z.string().min(1),
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    /** the guides the generator half of the run reads (repo-relative) */
    guides: z.array(z.string().min(1)).min(1),
    /** optional index exclusions passed through to openCheckout */
    excludeDirs: z.array(z.string().min(1)).optional(),
    items: z.array(z.discriminatedUnion('kind', [DraftQuiz, DraftFlashcard])),
  })
  .strict();
export type QuestDrafts = z.infer<typeof QuestDrafts>;
type DraftItem = QuestDrafts['items'][number];

const citation = (c: z.infer<typeof Cite>, sourceLine: number): SeedCitation => ({
  raw: `${c.path}:${c.lineStart}${c.lineEnd !== c.lineStart ? `-${c.lineEnd}` : ''}`,
  path: c.path,
  lineStart: c.lineStart,
  lineEnd: c.lineEnd,
  form: 'path-line',
  sourceLine,
});

/** Draft entry → the SeedItem candidate the validator judges. */
export function buildDraftItem(co: Checkout, d: DraftItem): SeedItem {
  const key = stableKey('quests', co.repo, d.kind, ['hand-authored', d.id]);
  const provenance = { repo: co.repo, sha: co.sha, path: d.source.path, lines: d.source.lines };
  const citations = d.cites.map((c) => citation(c, d.source.lines.start));
  if (d.kind === 'flashcard') {
    const fc: SeedFlashcardItem = {
      kind: 'flashcard',
      key,
      provenance,
      citations,
      shape: d.shape ?? 'hand-authored',
      label: d.id,
      ...(d.severity ? { severity: d.severity } : {}),
      front: d.front,
      back: d.back,
      observation: 'read-derived',
      aiTag: false,
    };
    return fc;
  }
  const files = [...new Set(d.cites.map((c) => c.path))].sort();
  const answer = { text: d.answer, evidence: files };
  const choices = hashOrder([answer, ...d.distractors.map((t) => ({ text: t, evidence: [] as string[] }))], `${key}:order`, (c) => c.text);
  const q: SeedQuizItem = {
    kind: 'quiz',
    key,
    provenance,
    citations,
    variety: d.variety ?? 'concept',
    prompt: d.prompt,
    choices,
    check: { type: 'quiz', itemKey: key, grading: 'choice', answerKey: choices.indexOf(answer), choices: choices.map((c) => c.text) },
    explanation: d.explanation,
  };
  return q;
}

export interface QuestDraftOptions {
  root: string;
  draft: string;
  out?: string;
  exclusionsPath?: string;
  allowQuarantine?: boolean;
}

export function runQuestsWithDrafts(o: QuestDraftOptions): RunReport {
  const head = [`[seed:quests:drafts] draft ${o.draft}`];
  let ex: Exclusions;
  let drafts: QuestDrafts;
  try {
    ex = Exclusions.load(o.exclusionsPath);
    const raw = readFileSync(o.draft, 'utf8');
    const secrets = ex.scan(raw);
    if (secrets.length) throw new UnregisteredSecretError('draft', o.draft, secrets);
    drafts = QuestDrafts.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof UnregisteredSecretError) return refusal('quests', head, err.message);
    if (err instanceof z.ZodError) return refusal('quests', head, `draft is malformed: ${err.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    throw err;
  }
  let co: Checkout;
  try {
    co = openCheckout({ root: o.root, sha: drafts.sha, repo: drafts.repo, ...(drafts.excludeDirs ? { excludeDirs: drafts.excludeDirs } : {}) });
  } catch (err) {
    if (err instanceof CheckoutError) return refusal('quests', head, err.message);
    throw err;
  }
  head.push(`[seed:quests:drafts] repo ${co.repo} @ ${co.sha} (pin ${co.pin}) root ${co.root}`);
  const repoHit = ex.repo(co.repo);
  if (repoHit) return refusal('quests', head, `repo ${co.repo} is ${repoHit.reason}: ${repoHit.entry.note}`);
  const guides = drafts.guides.map((g) => g.replace(/\\/g, '/'));
  for (const g of guides) {
    const hit = ex.path(co.repo, g);
    if (hit) return refusal('quests', head, `requested guide ${g} is ${hit.reason} — refusing to ingest it (${hit.entry.note})`);
    // only markdown is guide material: a non-.md file would be "parsed" into one
    // contentless '(untitled guide)' reading step (parse.ts readingSections) — refuse instead
    if (!g.toLowerCase().endsWith('.md')) return refusal('quests', head, `requested guide ${g} is not a markdown (.md) file — seed:quests reads markdown guides only`);
    // the FULL index: excludeDirs/snapshot pruning only narrows suffix matching, it must not hide a listed guide
    if (!co.fullIndex.files.has(g)) return refusal('quests', head, `requested guide ${g} not found in the checkout`);
  }
  head.push(`[seed:quests:drafts] guides ${guides.length}: ${guides.join(', ')}; hand-authored drafts ${drafts.items.length}`);
  let cand;
  try {
    cand = generateQuestCandidates(co, guides, ex);
  } catch (err) {
    if (err instanceof UnregisteredSecretError) return refusal('quests', head, err.message);
    throw err;
  }
  const outcome = emptyOutcome();
  outcome.skipped.push(...cand.excludedGuides);
  const seen = new Set<string>();
  for (const g of cand.guides) {
    outcome.skipped.push(...g.skipped);
    for (const item of g.items) {
      seen.add(item.key);
      bucket(outcome, item.key, validateQuestItem(co, ex, item));
    }
  }
  const ids = new Set<string>();
  for (const d of drafts.items) {
    const item = buildDraftItem(co, d);
    if (ids.has(d.id) || seen.has(item.key)) {
      outcome.rejected.push({ key: item.key, reason: `hand-authored id ${d.id} collides with another item key` });
      continue;
    }
    ids.add(d.id);
    seen.add(item.key);
    if (d.cites.length === 0) {
      outcome.rejected.push({ key: item.key, reason: `hand-authored ${d.kind} ${d.id} carries no citation (every hand item must cite file:lines it was verified against)` });
      continue;
    }
    bucket(outcome, item.key, validateQuestItem(co, ex, item));
  }
  const outDir = o.out ?? join(DEFAULT_SEED_DIR, 'quests', co.repo);
  const inputs = [...guides.filter((g) => !cand.excludedGuides.some((s) => s.subject === g)), `draft:${basename(o.draft)}`];
  const write = writeSeedPack({ dir: outDir, generator: 'quests', name: co.repo, checkout: co, inputs, outcome, allowQuarantine: o.allowQuarantine ?? false });
  return summarize('quests', head, outcome, write, outDir, o.allowQuarantine ?? false);
}
