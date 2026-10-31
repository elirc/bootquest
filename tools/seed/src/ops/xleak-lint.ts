// seed:lint:leaks, second half: the PARAPHRASE leaks the token lint (leak-lint.ts, guards.ts
// explainBackKeyLeaks) cannot see (review 2026-10-30 V3/V7; ab wave S7, RULINGS R3.3 + R4 "B2/B3").
//
// The token lint compares an explain-back key point with the same-repo quiz CHOICE keys only. A key
// point that sits (nearly) verbatim inside a quiz explanation, a flashcard back, a Learn-more note
// body or another explain-back set's key point of the same repo is handed to the learner before the
// explain-back gate (the ladder serves the study quest, its notes and its cards first), and that
// lint reports 0. This one compares, per repo:
//   EB-quiz  kp text vs quiz keyed answer + explanation
//   EB-fc    kp text vs flashcard back
//   EB-note  kp text vs note title + body
//   EB-EB    kp text vs every kp of another explain-back pack (other units, sibling sets, G2 briefs)
// with content-word CONTAINMENT over the smaller token set (>= XLEAK_CONTAIN with >= XLEAK_MIN_SHARED
// shared tokens; council C3: token-Jaccard suits short quiz keys but misses a 20-word kp inside a
// 150-word note), so the score is symmetric (both directions are one check). Plus:
//   FC-quiz  a flashcard back that contains a same-pack quiz's keyed answer at token boundaries (V7:
//            the card is enrolled into FSRS on the first pass and answers the gate item on every retake)
//   weights  a DESIGN IT or G2 set with a key point that carries no [wN] prefix (the weighted gate,
//            shared/src/eb-weight.ts, needs every point weighted)
//
// Known pairs live in a SHRINK-ONLY baseline (xleak-baseline.json): pairs frozen on both sides (each
// side byte-identical to the item present at 9b7f0ea3, AGENTS.md "existing items stay byte-identical",
// RULINGS R3.3) and overlaps SEEDING §8 already accepts by id. Each entry pins both sides' text by hash:
// an entry that no longer fires, names a side that is gone, or whose side text changed is STALE and
// fails (delete it, or re-justify the changed side). Anything not in the baseline fails. There is no
// CLI to add entries: a new pair is fixed by rewriting the editable side and re-seeding.
// Read-only (no stamps touched). Lives in ops/ so it is outside the fingerprint walk.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { kpWeight } from '@bootquest/shared/eb-weight';
import { EB_LEAK_OPTIONS } from '../factory/guards.ts';
import { prepareLeakKey, prepareLeakText } from '../factory/leak.ts';
import { sha256 } from '../factory/util.ts';

/** containment over the smaller content-token set (review R2 §2, leak.mjs measured setting) */
export const XLEAK_CONTAIN = 0.55;
/** a pair needs at least this many shared content tokens (short texts stay a human-review item) */
export const XLEAK_MIN_SHARED = 7;
export const XLEAK_BASELINE_FORMAT = 'bootquest-xleak-baseline@1' as const;
export const DEFAULT_XLEAK_BASELINE = resolve(import.meta.dirname, 'xleak-baseline.json');

const G2_PROMPT = /^G2 BRIEF\b/;
const DESIGN_PROMPT = /^DESIGN IT\b/;

export type XleakKind ='EB-quiz' | 'EB-fc' | 'EB-note' | 'EB-EB' | 'FC-quiz';

const STOP = new Set(
  'the a an and or of to in on for with that this is are be was were it its as at by from into than then so not no when which who what where while each every one two also only ever never still just more most same other another such over under before after about against between through during without within because if but out up down off any all both make made makes making take takes taken use used uses using like there their they them these those have has had having does did doing done can could would should will may might must shall own very per via how why whether'.split(
    ' ',
  ),
);

/** content tokens: lower-cased alphanumeric words of >= 4 chars, minus stop words and the [wN] prefix */
export function xleakTokens(s: string): Set<string> {
  return new Set(
    String(s)
      .toLowerCase()
      .replace(/\[w\d\]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

/** containment of the smaller set in the larger and the shared-token count */
export function xleakScore(a: ReadonlySet<string>, b: ReadonlySet<string>): { score: number; shared: number } {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const t of small) if (big.has(t)) shared++;
  return { score: small.size ? shared / small.size : 0, shared };
}

export const xleakFires = (s: { score: number; shared: number }): boolean => s.shared >= XLEAK_MIN_SHARED && s.score >= XLEAK_CONTAIN;

interface Side {
  id: string;
  repo: string;
  pack: string;
  text: string;
  tokens: Set<string>;
}

export interface XleakPair {
  kind: XleakKind;
  a: string;
  b: string;
  score: number;
  shared: number;
  aText: string;
  bText: string;
}

export interface XleakEstate {
  ebs: Side[];
  /** quiz / fc / note sides by id */
  others: Map<string, Side & { kind: 'quiz' | 'fc' | 'note' }>;
  /** every side's text by id (for baseline hashes) */
  texts: Map<string, string>;
  pairs: XleakPair[];
  weightProblems: string[];
  scanned: { ebPacks: number; questPacks: number; notesPacks: number };
}

const short = (key: string): string => key.split('/').pop()!;
export const textHash = (s: string): string => sha256(s).slice(0, 16);

function packDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .filter((n) => statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, 'items.json')) && existsSync(join(dir, n, 'manifest.json')));
}
const readItems = (dir: string): any[] => (JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')) as { items?: any[] }).items ?? [];

/** Read the estate under <seedDir> and compute every firing pair (no baseline applied). */
export function xleakEstate(seedDir: string): XleakEstate {
  const ebs: Side[] = [];
  const others = new Map<string, Side & { kind: 'quiz' | 'fc' | 'note' }>();
  const texts = new Map<string, string>();
  const weightProblems: string[] = [];
  const pairs: XleakPair[] = [];
  const fcQuizPairs: XleakPair[] = [];

  const ebPacks = packDirs(join(seedDir, 'explainback'));
  for (const pack of ebPacks) {
    for (const it of readItems(join(seedDir, 'explainback', pack))) {
      if (it.kind !== 'explain-back') continue;
      const repo = it.provenance.repo as string;
      const qs = it.questions as Array<{ prompt: string; keyPoints: Array<{ text: string }> }>;
      // as the server reads them (store/ladder.ts isG2 / isDesignIt: the Q1 prompt prefix); the g2-brief--
      // pack name also counts, so a G2 brief whose prompt lost its prefix is still held to weights
      const g2 = G2_PROMPT.test(qs[0]?.prompt ?? '') || pack.startsWith('g2-brief--');
      const weighted = g2 || DESIGN_PROMPT.test(qs[0]?.prompt ?? '');
      qs.forEach((q, qi) =>
        q.keyPoints.forEach((kp, ki) => {
          const id = `eb:${pack} q${qi + 1}.kp${ki + 1}`;
          ebs.push({ id, repo, pack, text: kp.text, tokens: xleakTokens(kp.text) });
          texts.set(id, kp.text);
          if (weighted && kpWeight(kp.text) === null) weightProblems.push(`${id}: a ${g2 ? 'G2' : 'DESIGN IT'} key point with no [w1]/[w2]/[w3] prefix (the weighted gate needs every point weighted)`);
        }),
      );
    }
  }

  const questPacks = packDirs(join(seedDir, 'quests'));
  for (const pack of questPacks) {
    const items = readItems(join(seedDir, 'quests', pack));
    const keys: Array<{ id: string; answer: string }> = [];
    const backs: Array<{ id: string; back: string }> = [];
    for (const it of items) {
      const repo = it.provenance.repo as string;
      if (it.kind === 'quiz') {
        const choices: string[] = it.check?.choices ?? it.choices.map((c: { text: string }) => c.text);
        const answer = typeof it.check?.answerKey === 'number' ? (choices[it.check.answerKey] ?? '') : String(it.check?.answerKey ?? '');
        const text = `${answer} ${it.explanation ?? ''}`;
        const id = `quiz:${pack}/${short(it.key)}`;
        others.set(id, { id, repo, pack, kind: 'quiz', text, tokens: xleakTokens(text) });
        texts.set(id, text);
        if (answer) keys.push({ id, answer });
      } else if (it.kind === 'flashcard') {
        const id = `fc:${pack}/${short(it.key)}`;
        others.set(id, { id, repo, pack, kind: 'fc', text: it.back, tokens: xleakTokens(it.back) });
        texts.set(id, it.back);
        backs.push({ id, back: it.back });
      }
    }
    // FC-quiz (V7): the keyed answer verbatim (token boundaries) inside a same-pack flashcard back.
    // EB_LEAK_OPTIONS' 3-token floor: a 1-2 token key ("200", "throw;") is a human-review item.
    for (const k of keys) {
      const lk = prepareLeakKey(k.answer);
      if (lk.tokens.length < (EB_LEAK_OPTIONS.minContainTokens ?? 3)) continue;
      for (const f of backs) {
        if (prepareLeakText(f.back).padded.includes(lk.padded)) fcQuizPairs.push({ kind: 'FC-quiz', a: f.id, b: k.id, score: 1, shared: lk.tokens.length, aText: f.back, bText: k.answer });
      }
    }
  }

  const notesPacks = packDirs(join(seedDir, 'notes'));
  for (const pack of notesPacks) {
    for (const it of readItems(join(seedDir, 'notes', pack))) {
      if (it.kind !== 'note') continue;
      const id = `note:${pack}/${it.noteId}`;
      const text = `${it.title} ${it.body}`;
      others.set(id, { id, repo: it.provenance.repo, pack, kind: 'note', text, tokens: xleakTokens(text) });
      texts.set(id, text);
    }
  }

  const ebByRepo = new Map<string, Side[]>();
  for (const e of ebs) ebByRepo.set(e.repo, [...(ebByRepo.get(e.repo) ?? []), e]);
  const otherByRepo = new Map<string, Array<Side & { kind: 'quiz' | 'fc' | 'note' }>>();
  for (const o of others.values()) otherByRepo.set(o.repo, [...(otherByRepo.get(o.repo) ?? []), o]);

  for (const e of ebs) {
    for (const f of ebByRepo.get(e.repo) ?? []) {
      if (f.pack <= e.pack) continue; // other packs only, each unordered pair once
      const s = xleakScore(e.tokens, f.tokens);
      if (xleakFires(s)) pairs.push({ kind: 'EB-EB', a: e.id, b: f.id, ...s, aText: e.text, bText: f.text });
    }
    for (const o of otherByRepo.get(e.repo) ?? []) {
      const s = xleakScore(e.tokens, o.tokens);
      if (xleakFires(s)) pairs.push({ kind: `EB-${o.kind}` as XleakKind, a: e.id, b: o.id, ...s, aText: e.text, bText: o.text });
    }
  }
  pairs.push(...fcQuizPairs);
  return { ebs, others, texts, pairs, weightProblems, scanned: { ebPacks: ebPacks.length, questPacks: questPacks.length, notesPacks: notesPacks.length } };
}

export interface XleakBaselineEntry {
  kind: XleakKind;
  a: string;
  b: string;
  /** textHash of each side's compared text when the entry was recorded */
  aHash: string;
  bHash: string;
  /** frozen@9b7f0ea3 (both sides) or the SEEDING §8 acceptance it rests on */
  why: string;
}
export interface XleakBaseline {
  format: typeof XLEAK_BASELINE_FORMAT;
  entries: XleakBaselineEntry[];
}

export function loadXleakBaseline(file: string): XleakBaseline {
  const b = JSON.parse(readFileSync(file, 'utf8')) as XleakBaseline;
  if (b.format !== XLEAK_BASELINE_FORMAT || !Array.isArray(b.entries)) throw new Error(`${file}: not a ${XLEAK_BASELINE_FORMAT} file`);
  return b;
}

export const pairId = (p: Pick<XleakPair, 'kind' | 'a' | 'b'>): string => `${p.kind} ${p.a} ~ ${p.b}`;

export interface XleakReport {
  scanned: XleakEstate['scanned'];
  kps: number;
  pairs: number;
  known: number;
  fresh: XleakPair[];
  stale: string[];
  weightProblems: string[];
  baselineSize: number;
}

export function xleakReport(seedDir: string, baseline: XleakBaseline): XleakReport {
  const est = xleakEstate(seedDir);
  const fired = new Map(est.pairs.map((p) => [pairId(p), p]));
  const listed = new Set<string>();
  const stale: string[] = [];
  for (const e of baseline.entries) {
    const id = pairId(e);
    if (listed.has(id)) stale.push(`${id}: listed twice`);
    listed.add(id);
    const at = est.texts.get(e.a);
    const bt = est.texts.get(e.b);
    if (at === undefined || bt === undefined) stale.push(`${id}: ${at === undefined ? e.a : e.b} is no longer in the estate — delete the entry`);
    else if (textHash(at) !== e.aHash || textHash(bt) !== e.bHash) stale.push(`${id}: ${textHash(at) !== e.aHash ? e.a : e.b} changed since it was baselined — re-check the pair; a changed side is no longer frozen`);
    else if (!fired.has(id)) stale.push(`${id}: no longer fires — delete the entry (the baseline only shrinks)`);
  }
  const fresh = est.pairs.filter((p) => !listed.has(pairId(p)));
  return { scanned: est.scanned, kps: est.ebs.length, pairs: est.pairs.length, known: est.pairs.length - fresh.length, fresh, stale, weightProblems: est.weightProblems, baselineSize: baseline.entries.length };
}

export const xleakFailed = (r: XleakReport): boolean => r.fresh.length > 0 || r.stale.length > 0 || r.weightProblems.length > 0;

export function formatXleakReport(r: XleakReport): string[] {
  const out = [`seed:lint:leaks (xleak) — explain-back key points vs same-repo quiz explanations, flashcard backs, notes and other EB sets (containment >= ${XLEAK_CONTAIN}, >= ${XLEAK_MIN_SHARED} shared tokens); flashcard backs vs same-pack quiz keys; DESIGN IT/G2 weights`];
  for (const p of r.fresh) out.push(`XLEAK        ${p.kind} ${p.score.toFixed(2)} n=${p.shared} ${p.a} ~ ${p.b}: "${p.aText.slice(0, 90)}" ~ "${p.bText.slice(0, 90)}"`);
  for (const s of r.stale) out.push(`STALE        xleak-baseline ${s}`);
  for (const w of r.weightProblems) out.push(`UNWEIGHTED   ${w}`);
  out.push(
    `${r.scanned.ebPacks} explain-back / ${r.scanned.questPacks} quest / ${r.scanned.notesPacks} notes pack(s), ${r.kps} key point(s): ${r.pairs} pair(s), ${r.known} baselined (baseline ${r.baselineSize}), ${r.fresh.length} new, ${r.stale.length} stale, ${r.weightProblems.length} unweighted`,
  );
  out.push(`RESULT ${xleakFailed(r) ? 'XLEAKS' : 'OK'}`);
  return out;
}
