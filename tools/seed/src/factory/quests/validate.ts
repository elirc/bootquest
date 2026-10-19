/**
 * seed:quests validator (spec §7, verbatim requirements):
 *   - every cited path / file:line resolves in the repo at the pinned sha via
 *     the P4 citations resolver (root-relative, md-relative, unambiguous
 *     suffix; line <= file length) — any failure rejects the item;
 *   - inheritAmbiguous continuation refs that resolve "ok" are NOT a pass:
 *     the item is held in the review queue for a human;
 *   - quizzes are single-keyed: exactly one choice passes the app's quiz
 *     grader, no two choices are (near-)duplicates, no distractor shares
 *     evidence with the key (multi-keyable), the prompt does not reveal the key;
 *   - an item whose source or any cited file is excluded by the registry is
 *     dropped (counted), never shipped.
 */
import { SeedItem, type SeedCitation, type SeedProvenance, type SeedQuizItem } from '@bootquest/shared';
import { gradeDeterministic } from '@bootquest/server/runners';
import { pinFile, type Checkout } from '../checkout.ts';
import { asCitation, resolveAt } from '../cite.ts';
import type { Exclusions } from '../exclusions.ts';
import { nearDuplicate, normCompare } from '../util.ts';

export type ItemVerdict =
  | { verdict: 'accept'; item: SeedItem }
  | { verdict: 'reject'; reason: string }
  | { verdict: 'review'; item: SeedItem; warnings: string[] }
  | { verdict: 'drop'; reason: string };

export interface CitationCheck {
  /** citations with `resolved` bound (whitelisted ones unchanged) */
  bound: SeedCitation[];
  errors: string[];
  warnings: string[];
  /** first exclusion hit among the resolved files */
  excluded: string | null;
  /** count of citations that resolved ok (whitelisted not counted) */
  ok: number;
  /** citations exempted by the registry's citationWhitelist (recorded on the citation) */
  whitelisted: number;
}

/** Resolve an item's citations at the pinned sha (shared by every generator that cites). */
export function checkCitations(co: Checkout, ex: Exclusions, guide: string, citations: readonly SeedCitation[]): CitationCheck {
  const out: CitationCheck = { bound: [], errors: [], warnings: [], excluded: null, ok: 0, whitelisted: 0 };
  for (const c of citations) {
    const where = `${guide}:${c.sourceLine}`;
    const wl = c.path !== null ? ex.citationWhitelistHit(co.repo, c.path) : null;
    if (wl) {
      // visible exemption: recorded on the citation, never counted as resolved (W7)
      out.whitelisted++;
      const { resolved: _r, ...rest } = c;
      out.bound.push({ ...rest, whitelisted: wl });
      continue;
    }
    const r = resolveAt(co, guide, asCitation(c, guide));
    if (r.status === 'error') {
      const guess = c.crossBlockFrom !== undefined ? ` (orphan continuation; the cross-block guess from ${guide}:${c.crossBlockFrom} fails too)` : '';
      out.errors.push(`citation \`${c.raw}\` at ${where} -> ${r.reason}: ${r.message}${r.candidates ? ` [${r.candidates.slice(0, 5).join(', ')}]` : ''}${guess}`);
      out.bound.push(c);
      continue;
    }
    out.ok++;
    if (c.resolved !== undefined && c.resolved !== r.file) out.errors.push(`citation \`${c.raw}\` at ${where} was bound to ${c.resolved} but now resolves to ${r.file}`);
    if (r.kind === 'file') pinFile(co, r.file);
    const hit = ex.path(co.repo, r.file);
    if (hit && !out.excluded) out.excluded = `cites ${r.file}: ${hit.reason}`;
    if (c.crossBlockFrom !== undefined) {
      out.warnings.push(`cross-block continuation: \`${c.raw}\` at ${where} has no file in its own block; bound to ${c.path} cited at ${guide}:${c.crossBlockFrom} (a guess: verify)`);
    } else if (c.inheritAmbiguous) {
      out.warnings.push(`inheritAmbiguous: \`${c.raw}\` at ${where} bound to ${c.path} (block also cites ${c.inheritAmbiguous.filter((f) => f !== c.path).join(', ')})`);
    }
    out.bound.push({ ...c, resolved: r.file });
  }
  return out;
}

/** Provenance must point at real lines of a non-excluded source at the pinned sha. */
export function checkProvenance(co: Checkout, ex: Exclusions, p: SeedProvenance): { error?: string; excluded?: string } {
  if (p.repo !== co.repo) return { error: `provenance repo ${p.repo} != checkout ${co.repo}` };
  if (p.sha !== co.sha) return { error: `provenance sha ${p.sha} != pinned ${co.sha}` };
  const hit = ex.path(co.repo, p.path);
  if (hit) return { excluded: `source ${p.path}: ${hit.reason}` };
  const r = resolveAt(co, p.path, { path: p.path, lineStart: p.lines.start, lineEnd: p.lines.end, form: 'path-line', raw: p.path, source: { file: p.path, line: 1, column: 1 }, group: 0 });
  if (r.status === 'error') return { error: `provenance ${p.path}:${p.lines.start}-${p.lines.end} -> ${r.reason}: ${r.message}` };
  if (r.file !== p.path) return { error: `provenance ${p.path} is not a repo-root path (resolved to ${r.file})` };
  pinFile(co, p.path);
  return {};
}

/** Single-keyed quiz rules (shared with seed:check). Returns the reasons it is NOT single-keyed. */
export function singleKeyedProblems(q: SeedQuizItem): string[] {
  const why: string[] = [];
  const c = q.check;
  if (c.type !== 'quiz' || c.grading !== 'choice' || typeof c.answerKey !== 'number' || !c.choices) return ['quiz check must be a single-keyed choice item'];
  if (c.itemKey !== q.key) why.push(`check.itemKey ${c.itemKey} != item key`);
  if (JSON.stringify(c.choices) !== JSON.stringify(q.choices.map((x) => x.text))) why.push('check.choices do not mirror choices[].text');
  if (c.answerKey >= c.choices.length) {
    why.push(`answerKey ${c.answerKey} out of range (${c.choices.length} choices)`);
    return why;
  }
  for (let i = 0; i < c.choices.length; i++) {
    for (let j = i + 1; j < c.choices.length; j++) {
      if (nearDuplicate(c.choices[i]!, c.choices[j]!)) why.push(`ambiguous: choices ${i} and ${j} are (near-)duplicates`);
    }
  }
  // multi-keyable (a distractor backed by the key's evidence) needs evidence on EVERY choice, so its
  // applicability is decided explicitly, never by an empty array silently passing:
  //   - every choice carries evidence (generator goal-check / finding-location quizzes, authored
  //     quizzes whose author gave per-choice evidence): the rule APPLIES;
  //   - a hand-authored CONCEPT quiz (seed:quests:drafts) with evidence on the KEY ONLY: the key
  //     carries the cited files, the distractors are invented wrong answers with no source item
  //     behind them, so there is nothing to share — the rule does NOT apply (its single-key
  //     protections are the near-duplicate rule, the grader, and the pack-level blind-pass /
  //     quiz-balance guards);
  //   - no choice carries evidence (an authored quiz whose author gave none): the rule does NOT apply;
  //   - anything else (evidence on some distractors but not all) is refused: it would judge the rule
  //     on part of the choices and pass the rest by default.
  const withEv = q.choices.map((ch, i) => (ch.evidence.length > 0 ? i : -1)).filter((i) => i >= 0);
  const keyOnly = withEv.length === 1 && withEv[0] === c.answerKey;
  if (withEv.length === q.choices.length) {
    const keyEv = new Set(q.choices[c.answerKey]!.evidence);
    q.choices.forEach((ch, i) => {
      if (i === c.answerKey) return;
      const shared = ch.evidence.filter((e) => keyEv.has(e));
      if (shared.length) why.push(`multi-keyable: choice ${i} shares evidence with the key (${shared.slice(0, 3).join(', ')})`);
    });
  } else if (withEv.length > 0 && !(keyOnly && q.variety === 'concept')) {
    why.push(`multi-keyable cannot be judged: ${withEv.length}/${q.choices.length} choices carry evidence (a quiz needs evidence on every choice, on none, or — a hand concept quiz — on the key only)`);
  }
  if (!gradeDeterministic(c, { answer: c.answerKey })?.pass) why.push('the answer key does not pass the quiz grader');
  const alsoPass = c.choices.map((_, i) => i).filter((i) => i !== c.answerKey && gradeDeterministic(c, { answer: i })?.pass);
  if (alsoPass.length) why.push(`choices ${alsoPass.join(',')} also pass the grader (not single-keyed)`);
  const keyText = normCompare(c.choices[c.answerKey]!);
  if (keyText.length >= 12 && normCompare(q.prompt).includes(keyText)) why.push('the prompt reveals the key');
  if (q.variety === 'finding-location') {
    const m = /^([^:]+):(\d+)/.exec(c.choices[c.answerKey]!);
    const base = m ? m[1]!.split('/').pop()! : '';
    if (base && q.prompt.includes(`${base}:${m![2]}`)) why.push(`the prompt reveals the keyed location ${base}:${m![2]}`);
  }
  return why;
}

/**
 * A seed:quests:drafts HAND item: a 'concept' quiz or a 'hand-authored' flashcard (the drafts path
 * refuses any other variety / shape on a hand item, and neither the guide parser nor
 * quests-authored.ts emits these two). Its citations carry no guide line (see validateQuestItem).
 */
export const isHandDraftItem = (item: SeedItem): boolean => (item.kind === 'quiz' && item.variety === 'concept') || (item.kind === 'flashcard' && item.shape === 'hand-authored');

export function validateQuestItem(co: Checkout, ex: Exclusions, candidate: unknown): ItemVerdict {
  const parsed = SeedItem.safeParse(candidate);
  if (!parsed.success) return { verdict: 'reject', reason: `schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  const item = parsed.data;
  if (item.kind !== 'quiz' && item.kind !== 'flashcard' && item.kind !== 'reading-step') return { verdict: 'reject', reason: `seed:quests cannot emit ${item.kind}` };
  const prov = checkProvenance(co, ex, item.provenance);
  if (prov.excluded) return { verdict: 'drop', reason: prov.excluded };
  const cc = checkCitations(co, ex, item.provenance.path, item.citations);
  if (cc.excluded) return { verdict: 'drop', reason: cc.excluded };
  if (item.kind === 'quiz' && item.variety === 'finding-location') {
    for (const ch of item.choices) {
      for (const f of ch.evidence) {
        const hit = ex.path(co.repo, f);
        if (hit) return { verdict: 'drop', reason: `a choice points at ${f}: ${hit.reason}` };
      }
    }
  }
  const reasons: string[] = [];
  if (prov.error) reasons.push(prov.error);
  reasons.push(...cc.errors);
  // sourceLine is the GUIDE line a citation was written on. Parser citations (generator items,
  // quests-authored items) carry the real line, so "outside the item's source lines" is a real check.
  // A seed:quests:drafts HAND item's cites are file:line ranges its author verified against, not text
  // of the guide: they have no guide line, and buildDraftItem pins sourceLine to source.lines.start by
  // convention. For those the range rule does NOT apply; instead the convention itself is asserted, so
  // a hand item can never smuggle in a citation that claims a guide location it does not have.
  const hand = isHandDraftItem(item);
  for (const c of item.citations) {
    if (hand) {
      if (c.sourceLine !== item.provenance.lines.start) reasons.push(`hand-authored citation \`${c.raw}\` claims guide line ${c.sourceLine}; a draft cite has no guide line (sourceLine must be source.lines.start ${item.provenance.lines.start})`);
    } else if (c.sourceLine < item.provenance.lines.start || c.sourceLine > item.provenance.lines.end) {
      reasons.push(`citation \`${c.raw}\` (line ${c.sourceLine}) lies outside the item's source lines`);
    }
  }
  if (item.kind === 'quiz') reasons.push(...singleKeyedProblems(item));
  if (item.kind === 'flashcard') {
    if (cc.ok === 0) reasons.push('finding has no resolvable citation (findings need >= 1 file:line)');
    if (normCompare(item.front) === normCompare(item.back)) reasons.push('front and back are the same text');
    else if (normCompare(item.back).length > 0 && normCompare(item.front).includes(normCompare(item.back))) reasons.push('back is contained in the front (nothing to recall)');
  }
  if (reasons.length) return { verdict: 'reject', reason: reasons.join(' ; ') };
  const bound = { ...item, citations: cc.bound } as SeedItem;
  if (cc.warnings.length) return { verdict: 'review', item: bound, warnings: cc.warnings };
  return { verdict: 'accept', item: bound };
}
