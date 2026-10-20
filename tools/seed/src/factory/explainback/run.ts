/** seed:explainback end to end: unit source at a pinned sha → (draft | scaffold) → validator → pack + stamp. */
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import { CheckoutError, openCheckout, readTracked } from '../checkout.ts';
import { Exclusions, UnregisteredSecretError } from '../exclusions.ts';
import { emptyOutcome, writeSeedPack } from '../pack.ts';
import { bucket, DEFAULT_SEED_DIR, refusal, summarize, type RunReport } from '../report.ts';
import { buildExplainBackItem, scaffoldQuestions, validateExplainBack, type DraftQuestion } from './explainback.ts';

export const ExplainBackDraft = z
  .object({
    questions: z.array(
      z.object({
        prompt: z.string(),
        keyPoints: z.array(
          z.object({ text: z.string(), quote: z.string().optional(), cite: z.object({ path: z.string(), lineStart: z.number().int(), lineEnd: z.number().int() }).strict().optional() }).strict(),
        ),
      }).strict(),
    ),
    /** source lines the set covers (default: the whole unit file) */
    lines: z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).strict().optional(),
  })
  .strict();

export interface ExplainBackOptions {
  checkout: string;
  sha: string;
  repo?: string;
  /** unit source (markdown / lesson file), repo-relative or absolute inside the checkout */
  unit: string;
  draft?: string;
  out?: string;
  exclusionsPath?: string;
  /** replace a pack built from another source (scaffold vs another draft); see pack.ts replaceRefusal */
  forceReplace?: boolean;
  /**
   * stamp although no same-repo quest pack exists under the pack's seed root (<out>/../..) to run the
   * eb-leak guard against (--allow-no-quests: for repos that have no quest pack at all)
   */
  allowNoQuests?: boolean;
}

export function runExplainBack(o: ExplainBackOptions): RunReport {
  const head = ['[seed:explainback]'];
  let ex: Exclusions;
  let co;
  try {
    ex = Exclusions.load(o.exclusionsPath);
    co = openCheckout({ root: o.checkout, sha: o.sha, ...(o.repo ? { repo: o.repo } : {}) });
  } catch (err) {
    if (err instanceof CheckoutError) return refusal('explainback', head, err.message);
    throw err;
  }
  const unit = (isAbsolute(o.unit) ? relative(co.root, o.unit) : o.unit).replace(/\\/g, '/');
  head[0] = `[seed:explainback] repo ${co.repo} @ ${co.sha} (pin ${co.pin}) unit ${unit}${o.draft ? ` draft ${o.draft}` : ' (deterministic scaffold)'}`;
  const repoHit = ex.repo(co.repo);
  if (repoHit) return refusal('explainback', head, `repo ${co.repo} is ${repoHit.reason}: ${repoHit.entry.note}`);
  const hit = ex.path(co.repo, unit);
  if (hit) return refusal('explainback', head, `unit source ${unit} is ${hit.reason} — refusing to ingest it (${hit.entry.note})`);
  if (!co.fullIndex.files.has(unit)) return refusal('explainback', head, `unit source ${unit} not found in the checkout`);

  let text: string;
  let questions: DraftQuestion[];
  let lines: { start: number; end: number };
  try {
    text = readTracked(co, unit);
    ex.admit(co.repo, unit, text);
    const total = text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
    if (o.draft) {
      const raw = readFileSync(o.draft, 'utf8');
      const secrets = ex.scan(raw);
      if (secrets.length) throw new UnregisteredSecretError('draft', o.draft, secrets);
      const d = ExplainBackDraft.parse(JSON.parse(raw));
      questions = d.questions;
      lines = d.lines ?? { start: 1, end: Math.max(1, total) };
    } else {
      const s = scaffoldQuestions(text);
      if (!s) return refusal('explainback', head, `insufficient source material in ${unit}: need 3 H2 sections with >= 5 quotable sentences each`);
      questions = s.questions;
      lines = s.lines;
    }
  } catch (err) {
    if (err instanceof UnregisteredSecretError) return refusal('explainback', head, err.message);
    if (err instanceof z.ZodError) return refusal('explainback', head, `draft is malformed: ${err.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    throw err;
  }
  const item = buildExplainBackItem(co, unit, questions, lines, o.draft ? 'draft' : 'scaffold');
  const outcome = emptyOutcome();
  bucket(outcome, item.key, validateExplainBack(co, ex, text, item));
  const name = `${co.repo}--${unit.replace(/[^A-Za-z0-9._-]+/g, '-')}`;
  const outDir = o.out ?? join(DEFAULT_SEED_DIR, 'explainback', name);
  const write = writeSeedPack({ dir: outDir, generator: 'explainback', name, checkout: co, inputs: [unit, ...(o.draft ? [`draft:${o.draft.replace(/\\/g, '/').split('/').pop()}`] : [])], outcome, exclusions: ex, forceReplace: o.forceReplace === true, allowNoQuests: o.allowNoQuests === true });
  return summarize('explainback', head, outcome, write, outDir, false);
}
