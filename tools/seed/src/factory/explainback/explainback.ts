/**
 * seed:explainback — 3 questions + 5-8 key points each, from a unit's source text.
 *
 * Two inputs, one validator:
 *   --draft <file.json>  an LLM-authored set (seed sessions): {questions:[{prompt, keyPoints:[{text, quote?, cite?}]}]}
 *   (no draft)           a deterministic scaffold: the first three H2 sections with >= 5
 *                        quotable sentences; each key point quotes its sentence verbatim.
 * Validator (spec §7 "key points must quote or cite the source material"):
 *   - exactly 3 questions, prompts pairwise distinct (not near-duplicates);
 *   - 5..8 key points per question;
 *   - every key point quotes the source (whitespace-normalized substring, >= 12 chars)
 *     or cites a file:line that resolves at the pinned sha (P4 resolver: root-relative,
 *     guide-relative, unique suffix); the accepted item stores the RESOLVED repo-root path
 *     (an unresolvable or directory cite is refused, an excluded resolved file drops the set);
 *   - no duplicate / near-duplicate key points anywhere in the set;
 *   - a cite into an excluded file drops the set (counted).
 */
import type { SeedExplainBackItem } from '@bootquest/shared';
import { SeedItem } from '@bootquest/shared';
import { pinFile, type Checkout } from '../checkout.ts';
import { resolveAt } from '../cite.ts';
import type { Exclusions } from '../exclusions.ts';
import type { ItemVerdict } from '../quests/validate.ts';
import { checkProvenance } from '../quests/validate.ts';
import { headings, scanLines } from '../quests/parse.ts';
import { nearDuplicate, normWs, stableKey } from '../util.ts';

export const QUESTIONS = 3;
export const MIN_POINTS = 5;
export const MAX_POINTS = 8;
export const MIN_QUOTE = 12;

export interface DraftQuestion {
  prompt: string;
  keyPoints: Array<{ text: string; quote?: string; cite?: { path: string; lineStart: number; lineEnd: number } }>;
}

/** Paragraph / list-item texts of one line range (no fences, tables or headings). */
function blocks(lines: ReturnType<typeof scanLines>, from: number, to: number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(cur.join(' '));
    cur = [];
  };
  for (const l of lines) {
    if (l.n < from || l.n > to) continue;
    const t = l.text;
    if (l.fence || t.trim() === '' || /^\s*#{1,6}\s/.test(t) || t.trim().startsWith('|') || /^\s*>/.test(t)) {
      flush();
      continue;
    }
    const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(t);
    if (li) {
      flush();
      cur.push(li[1]!.trim());
      continue;
    }
    cur.push(t.trim());
  }
  flush();
  return out;
}

/** Sentences outside code spans; keeps the exact source characters (quotable). */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let code = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '`') code = !code;
    if (code) continue;
    if ((c === '.' || c === '!' || c === '?') && (i + 1 === text.length || (text[i + 1] === ' ' && /[A-Z`("*[]/.test(text[i + 2] ?? '')))) {
      out.push(text.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

const plain = (s: string): string => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/** Deterministic scaffold from the source (no LLM): null when the source is too thin. */
export function scaffoldQuestions(text: string): { questions: DraftQuestion[]; lines: { start: number; end: number } } | null {
  const lines = scanLines(text);
  const hs = headings(lines).filter((h) => h.level === 2);
  const last = lines.length;
  const picked: Array<{ q: DraftQuestion; from: number; to: number }> = [];
  const taken: string[] = [];
  // consecutive H2 sections are grouped until the group has >= MIN_POINTS quotable sentences
  let group: { titles: string[]; from: number; kps: DraftQuestion['keyPoints'] } | null = null;
  for (let k = 0; k < hs.length && picked.length < QUESTIONS; k++) {
    const h = hs[k]!;
    const to = (hs[k + 1]?.line ?? last + 1) - 1;
    group ??= { titles: [], from: h.line, kps: [] };
    group.titles.push(h.text);
    const kps = group.kps;
    for (const b of blocks(lines, h.line + 1, to)) {
      for (const s of sentences(b)) {
        const words = s.split(/\s+/).length;
        if (s.length < 24 || s.length > 300 || words < 4 || s.endsWith(':')) continue;
        if ([...taken, ...kps.map((x) => x.text)].some((t) => nearDuplicate(t, plain(s)))) continue;
        kps.push({ text: plain(s), quote: s });
        if (kps.length >= MAX_POINTS) break;
      }
      if (kps.length >= MAX_POINTS) break;
    }
    if (kps.length < MIN_POINTS) continue;
    taken.push(...kps.map((x) => x.text));
    const topic = group.titles.map((t) => `"${t}"`).join(' and ');
    picked.push({ q: { prompt: `Explain ${topic} in your own words: what does the source claim, and why does it matter?`, keyPoints: kps }, from: group.from, to });
    group = null;
  }
  if (picked.length < QUESTIONS) return null;
  return { questions: picked.map((p) => p.q), lines: { start: picked[0]!.from, end: picked[picked.length - 1]!.to } };
}

export function buildExplainBackItem(co: Checkout, unitPath: string, questions: DraftQuestion[], lines: { start: number; end: number }, origin: string): SeedExplainBackItem {
  return {
    kind: 'explain-back',
    key: stableKey('explainback', co.repo, 'explain-back', [unitPath, origin]),
    provenance: { repo: co.repo, sha: co.sha, path: unitPath, lines },
    citations: [],
    questions: questions.map((q) => ({
      prompt: q.prompt,
      keyPoints: q.keyPoints.map((kp) => ({ text: kp.text, ...(kp.quote !== undefined ? { quote: kp.quote } : {}), ...(kp.cite ? { cite: kp.cite } : {}) })),
    })),
  };
}

export function validateExplainBack(co: Checkout, ex: Exclusions, sourceText: string, candidate: unknown): ItemVerdict {
  const parsed = SeedItem.safeParse(candidate);
  if (!parsed.success) return { verdict: 'reject', reason: `schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  const item = parsed.data;
  if (item.kind !== 'explain-back') return { verdict: 'reject', reason: `seed:explainback cannot emit ${item.kind}` };
  const prov = checkProvenance(co, ex, item.provenance);
  if (prov.excluded) return { verdict: 'drop', reason: prov.excluded };
  const why: string[] = [];
  if (prov.error) why.push(prov.error);
  if (item.questions.length !== QUESTIONS) why.push(`needs exactly ${QUESTIONS} questions, got ${item.questions.length}`);
  for (let i = 0; i < item.questions.length; i++) {
    for (let j = i + 1; j < item.questions.length; j++) {
      if (nearDuplicate(item.questions[i]!.prompt, item.questions[j]!.prompt)) why.push(`questions ${i + 1} and ${j + 1} are (near-)duplicates`);
    }
  }
  // The quote rule matches against the WHOLE unit file, not just provenance.lines: scoping it to the
  // provenance range was measured on 2026-10-19 and rejects 18 shipped key points in 9 packs (G2
  // briefs whose rubric quotes the guide outside the brief's section, grok-js, trainjs), so it needs a
  // content pass on those drafts first (widen `lines` or re-quote) before the rule can tighten.
  const src = normWs(sourceText);
  const all: Array<{ q: number; k: number; text: string }> = [];
  // the shipped item stores every cite at its RESOLVED repo-root path (the schema's promise and what
  // the client renders): a guide-relative or suffix cite as written would point nowhere when shown
  const resolvedCites = new Map<string, string>();
  item.questions.forEach((q, qi) => {
    const n = q.keyPoints.length;
    if (n < MIN_POINTS || n > MAX_POINTS) why.push(`question ${qi + 1} has ${n} key points (needs ${MIN_POINTS}-${MAX_POINTS})`);
    q.keyPoints.forEach((kp, ki) => {
      const tag = `q${qi + 1}.kp${ki + 1}`;
      all.push({ q: qi, k: ki, text: kp.text });
      if (kp.quote === undefined && !kp.cite) {
        why.push(`${tag} neither quotes nor cites the source`);
        return;
      }
      if (kp.quote !== undefined) {
        const qn = normWs(kp.quote);
        if (qn.length < MIN_QUOTE) why.push(`${tag} quote is too short to be evidence (${qn.length} < ${MIN_QUOTE} chars)`);
        else if (!src.includes(qn)) why.push(`${tag} quote is not in the source (whitespace-normalized): "${qn.slice(0, 80)}"`);
      }
      if (kp.cite) {
        const hit = ex.path(co.repo, kp.cite.path);
        if (hit) {
          why.push(`__drop__${tag} cites ${kp.cite.path}: ${hit.reason}`);
          return;
        }
        const r = resolveAt(co, item.provenance.path, { path: kp.cite.path, lineStart: kp.cite.lineStart, lineEnd: kp.cite.lineEnd, form: 'path-line', raw: `${kp.cite.path}:${kp.cite.lineStart}-${kp.cite.lineEnd}`, source: { file: item.provenance.path, line: 1, column: 1 }, group: 0 });
        if (r.status === 'error') why.push(`${tag} cite ${kp.cite.path}:${kp.cite.lineStart}-${kp.cite.lineEnd} -> ${r.reason}: ${r.message}`);
        else if (r.kind !== 'file') why.push(`${tag} cite ${kp.cite.path}:${kp.cite.lineStart}-${kp.cite.lineEnd} resolves to a directory (${r.file}), not a file`);
        else {
          const hitResolved = ex.path(co.repo, r.file);
          if (hitResolved) {
            why.push(`__drop__${tag} cites ${r.file}: ${hitResolved.reason}`);
            return;
          }
          pinFile(co, r.file);
          resolvedCites.set(`${qi}.${ki}`, r.file);
        }
      }
    });
  });
  for (let a = 0; a < all.length; a++) {
    for (let b = a + 1; b < all.length; b++) {
      if (nearDuplicate(all[a]!.text, all[b]!.text)) why.push(`duplicate key points: q${all[a]!.q + 1}.kp${all[a]!.k + 1} ~ q${all[b]!.q + 1}.kp${all[b]!.k + 1}`);
    }
  }
  const drop = why.find((w) => w.startsWith('__drop__'));
  if (drop) return { verdict: 'drop', reason: drop.slice('__drop__'.length) };
  if (why.length) return { verdict: 'reject', reason: why.join(' ; ') };
  const bound: SeedExplainBackItem = {
    ...item,
    questions: item.questions.map((q, qi) => ({
      ...q,
      keyPoints: q.keyPoints.map((kp, ki) => (kp.cite ? { ...kp, cite: { ...kp.cite, path: resolvedCites.get(`${qi}.${ki}`)! } } : kp)),
    })),
  };
  return { verdict: 'accept', item: bound };
}
