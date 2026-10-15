/**
 * seed:notes — "Learn more" readings and explanations for a quest pack (the shared draft
 * contract bootquest-notes-draft@1, content/seed-drafts/notes/<pack>.json).
 *
 * Validator (every rule of the contract, deterministic, no LLM):
 *   - id ^[a-z0-9][a-z0-9-]{2,63}$, unique in the draft;
 *   - target 'pack' or the exact key of a quiz / flashcard / reading-step of the quest pack;
 *     an 'after' note MUST target a quiz, and there is exactly ONE per quiz (coverage);
 *   - title 8-90 chars; body 60-300 words (after: 60-250), markdown, no HTML, no images;
 *   - 1-4 excerpts: repo-root path at the pinned sha, lineStart <= lineEnd within the file, a
 *     quote of >= 20 chars found verbatim in those lines after collapsing whitespace runs;
 *   - 0-4 readMore: the path exists at the sha, an optional line range in range, why 8-200 chars;
 *   - nothing cites, quotes or names an excluded file; no secret pattern anywhere;
 *   - 'before' notes never leak a keyed answer of ANY quiz in the pack: no normalized
 *     (token-boundary) substring of a keyed answer in title / body / excerpt quotes, token-
 *     Jaccard < 0.5 against every sentence and every answer-sized window of them, and no
 *     excerpt / readMore range that overlaps a finding-location quiz's keyed file:line;
 *   - coverage (pack level, blocks the stamp): 2-4 accepted 'before' notes targeting 'pack' and
 *     exactly one accepted 'after' note per quiz of the pack.
 * The notes pack binds the quest pack's items.json bytes (sha256 in the manifest inputs): a
 * re-seeded quest pack makes the notes stale until seed:notes runs again.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTE_PACK_TARGET, SeedItem, type NotesDraftNote, type SeedItem as SeedItemT, type SeedNoteItem, type SeedQuizItem } from '@bootquest/shared';
import { pinFile, readTracked, type Checkout } from '../checkout.ts';
import type { Exclusions } from '../exclusions.ts';
import { loadSeedPack } from '../pack.ts';
import { checkProvenance, type ItemVerdict } from '../quests/validate.ts';
import { normCompare, normWs, sha256, stableKey, tokenJaccard } from '../util.ts';

export const NOTE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const TITLE_MIN = 8;
export const TITLE_MAX = 90;
export const BODY_MIN_WORDS = 60;
export const BODY_MAX_WORDS = { before: 300, after: 250 } as const;
export const EXCERPTS_MIN = 1;
export const EXCERPTS_MAX = 4;
export const READMORE_MAX = 4;
export const QUOTE_MIN = 20;
export const WHY_MIN = 8;
export const WHY_MAX = 200;
/** a before-note segment this similar to a keyed answer gives it away */
export const LEAK_JACCARD = 0.5;
export const PACK_BEFORE_MIN = 2;
export const PACK_BEFORE_MAX = 4;

/** The quest pack a notes pack annotates (read-only view; its own stamp is checked by seed:check). */
export interface QuestPackView {
  name: string;
  dir: string;
  repo: string;
  sha: string;
  /** sha256 of the quest pack's items.json bytes (bound into the notes manifest) */
  itemsSha256: string;
  quizzes: SeedQuizItem[];
  /** every targetable key -> its kind */
  targets: Map<string, SeedItemT['kind']>;
}

export const questsBinding = (q: Pick<QuestPackView, 'name' | 'itemsSha256'>): string => `quests:${q.name}@items-sha256:${q.itemsSha256}`;
export const BINDING_RE = /^quests:([^@]+)@items-sha256:([0-9a-f]{64})$/;

/**
 * Load the quest pack the notes target. Its bytes are verified (manifest + items sha256, schema,
 * counts); a stale-fingerprint-only stamp is tolerated here (seed:check --restamp re-validates
 * the quest pack itself), an absent or bytes-mismatched stamp is not.
 */
export function loadQuestPackView(dir: string): QuestPackView {
  if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`quest pack ${dir} not found (notes annotate an existing stamped seed:quests pack)`);
  const pack = loadSeedPack(dir, { requireStamp: true, allowStaleFingerprint: true });
  if (pack.manifest.generator !== 'quests') throw new Error(`${dir} is a ${pack.manifest.generator} pack, not seed:quests`);
  const quizzes: SeedQuizItem[] = [];
  const targets = new Map<string, SeedItemT['kind']>();
  for (const it of pack.items) {
    targets.set(it.key, it.kind);
    if (it.kind === 'quiz') quizzes.push(it);
  }
  return {
    name: pack.manifest.name,
    dir,
    repo: pack.manifest.source.repo,
    sha: pack.manifest.source.sha,
    itemsSha256: sha256(readFileSync(join(dir, 'items.json'), 'utf8')),
    quizzes,
    targets,
  };
}

/** The keyed choice TEXT of a single-keyed quiz. */
export function keyedAnswer(q: SeedQuizItem): string {
  const choices = q.check.choices ?? q.choices.map((c) => c.text);
  return typeof q.check.answerKey === 'number' ? (choices[q.check.answerKey] ?? String(q.check.answerKey)) : String(q.check.answerKey);
}

const tokens = (s: string): string[] => normCompare(s).split(' ').filter(Boolean);

/** sentences / lines of a text (the units a leak is measured over) */
function segments(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?;:])\s+/)
    .map((s) => s.trim())
    .filter((s) => tokens(s).length > 0);
}

/** finding-location keys: "path/file.ts:12" or "file.ts:12-14" */
const LOCATION = /^([^\s:]+):(\d+)(?:-(\d+))?$/;

const sameFile = (path: string, keyFile: string): boolean => path === keyFile || path.endsWith(`/${keyFile}`) || keyFile.endsWith(`/${path}`);

export interface LeakSubject {
  title: string;
  body: string;
  excerpts: readonly { path: string; lineStart: number; lineEnd: number; quote: string }[];
  readMore: readonly { path: string; lineStart: number | null; lineEnd: number | null }[];
}

/**
 * Every way a READING would give away a keyed answer of the pack (empty = safe to show
 * before answering). Shared by seed:notes, seed:check and the server's tests.
 */
export function noteLeaks(note: LeakSubject, quizzes: readonly SeedQuizItem[]): string[] {
  const why: string[] = [];
  const fields: Array<{ name: string; text: string }> = [
    { name: 'title', text: note.title },
    { name: 'body', text: note.body },
    ...note.excerpts.map((e, i) => ({ name: `excerpt ${i + 1}`, text: e.quote })),
  ];
  for (const q of quizzes) {
    const key = keyedAnswer(q);
    const nk = tokens(key).join(' ');
    if (!nk) continue;
    const short = q.key.split('/').pop();
    let hit = false;
    for (const f of fields) {
      if (hit) break;
      if (` ${tokens(f.text).join(' ')} `.includes(` ${nk} `)) {
        why.push(`${f.name} contains the keyed answer of quiz ${short} ("${key.slice(0, 60)}")`);
        hit = true;
        break;
      }
      const n = tokens(key).length;
      for (const seg of segments(f.text)) {
        const st = tokens(seg);
        let worst = tokenJaccard(seg, key);
        // answer-sized windows: a long sentence cannot hide a near-verbatim answer inside it
        for (const w of [n, n + 2]) {
          if (st.length <= w) continue;
          for (let i = 0; i + w <= st.length; i++) worst = Math.max(worst, tokenJaccard(st.slice(i, i + w).join(' '), key));
        }
        if (worst >= LEAK_JACCARD) {
          why.push(`${f.name} overlaps the keyed answer of quiz ${short} (token-Jaccard ${worst.toFixed(2)} >= ${LEAK_JACCARD}): "${seg.slice(0, 60)}"`);
          hit = true;
          break;
        }
      }
    }
    if (hit) continue;
    const loc = LOCATION.exec(key.trim());
    if (q.variety === 'finding-location' && loc) {
      const a = Number(loc[2]);
      const b = loc[3] !== undefined ? Number(loc[3]) : a;
      const ranges = [
        ...note.excerpts.map((e) => ({ what: 'excerpt', path: e.path, s: e.lineStart, e: e.lineEnd })),
        ...note.readMore.map((r) => ({ what: 'readMore', path: r.path, s: r.lineStart ?? 1, e: r.lineEnd ?? Number.MAX_SAFE_INTEGER })),
      ];
      const over = ranges.find((r) => sameFile(r.path, loc[1]!) && r.s <= b && r.e >= a);
      if (over) why.push(`${over.what} ${over.path}:${over.s}${over.e === Number.MAX_SAFE_INTEGER ? '' : `-${over.e}`} points at the keyed location of quiz ${short} (${key})`);
    }
  }
  return why;
}

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** markdown with code spans / fences removed (HTML / image checks look at prose only) */
const prose = (md: string): string => md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');

/** path-like tokens a body names (checked against the exclusion registry) */
const PATHISH = /[A-Za-z0-9_.\-/]*[A-Za-z0-9_\-]\.[A-Za-z0-9]{1,8}\b/g;

function fileLines(co: Checkout, rel: string): string[] {
  const text = readTracked(co, rel);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function buildNoteItem(co: Checkout, pack: string, n: NotesDraftNote): SeedNoteItem {
  const first = n.excerpts[0];
  return {
    kind: 'note',
    key: stableKey('notes', co.repo, 'note', [pack, n.id]),
    provenance: {
      repo: co.repo,
      sha: co.sha,
      path: first?.path ?? '(none)',
      lines: { start: first?.lineStart ?? 1, end: Math.max(first?.lineEnd ?? 1, first?.lineStart ?? 1) },
    },
    citations: [],
    noteId: n.id,
    pack,
    target: n.target,
    phase: n.phase,
    title: n.title,
    body: n.body,
    excerpts: n.excerpts.map((e) => ({ path: e.path, lineStart: e.lineStart, lineEnd: e.lineEnd, quote: e.quote })),
    readMore: n.readMore.map((r) => ({ path: r.path, lineStart: r.lineStart, lineEnd: r.lineEnd, why: r.why })),
  };
}

/** Validate ONE note (seed:notes and seed:check). Pack-level coverage is notesCoverageProblems. */
export function validateNote(co: Checkout, ex: Exclusions, quests: QuestPackView, candidate: unknown): ItemVerdict {
  const raw = candidate as { noteId?: unknown };
  if (typeof raw?.noteId === 'string' && !NOTE_ID.test(raw.noteId)) return { verdict: 'reject', reason: `id "${raw.noteId}" must match ${NOTE_ID.source}` };
  const parsed = SeedItem.safeParse(candidate);
  if (!parsed.success) return { verdict: 'reject', reason: `schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  const item = parsed.data;
  if (item.kind !== 'note') return { verdict: 'reject', reason: `seed:notes cannot emit ${item.kind}` };
  const why: string[] = [];
  if (item.pack !== quests.name) why.push(`note belongs to pack ${item.pack}, validated against ${quests.name}`);
  if (quests.repo !== co.repo || quests.sha !== co.sha) why.push(`quest pack ${quests.name} is ${quests.repo}@${quests.sha.slice(0, 12)}, checkout is ${co.repo}@${co.sha.slice(0, 12)}`);
  if (item.key !== stableKey('notes', co.repo, 'note', [item.pack, item.noteId])) why.push('key is not the stable key of (repo, pack, id)');

  // ---- target
  if (item.target !== NOTE_PACK_TARGET) {
    const kind = quests.targets.get(item.target);
    if (!kind) why.push(`target ${item.target} is not an item key of content/seed/quests/${quests.name}/items.json`);
    else if (kind !== 'quiz' && kind !== 'flashcard' && kind !== 'reading-step') why.push(`target ${item.target} is a ${kind}`);
    else if (item.phase === 'after' && kind !== 'quiz') why.push(`an after note must target a quiz; ${item.target} is a ${kind}`);
  } else if (item.phase === 'after') why.push('an after note must target a quiz key, not the whole pack');

  // ---- title / body
  const tl = item.title.trim().length;
  if (tl < TITLE_MIN || tl > TITLE_MAX) why.push(`title is ${tl} chars (needs ${TITLE_MIN}-${TITLE_MAX})`);
  if (item.title !== item.title.trim() || /\n/.test(item.title)) why.push('title must be one trimmed line');
  const wc = words(item.body);
  const max = BODY_MAX_WORDS[item.phase];
  if (wc < BODY_MIN_WORDS || wc > max) why.push(`body is ${wc} words (a ${item.phase} note needs ${BODY_MIN_WORDS}-${max})`);
  const p = prose(item.body);
  if (/<\/?[A-Za-z!][^>]*>/.test(p) || /<!--/.test(p)) why.push('body contains HTML (markdown only)');
  if (/!\[[^\]]*\]\(/.test(p)) why.push('body contains an image (text only)');

  // ---- secrets + excluded names anywhere in the note's own text
  const own = [item.title, item.body, ...item.excerpts.map((e) => e.quote), ...item.readMore.map((r) => r.why)].join('\n');
  const secrets = ex.scan(own);
  if (secrets.length) why.push(`note text matches secret pattern(s) ${secrets.join(', ')}`);
  for (const tok of new Set([item.title, item.body, ...item.readMore.map((r) => r.why)].join(' ').match(PATHISH) ?? [])) {
    const hit = ex.path(co.repo, tok.replace(/^\.?\//, ''));
    if (hit) why.push(`names ${tok}: ${hit.reason}`);
  }

  // ---- provenance (= first excerpt) + excerpts
  const n = item.excerpts.length;
  if (n < EXCERPTS_MIN || n > EXCERPTS_MAX) why.push(`${n} excerpts (needs ${EXCERPTS_MIN}-${EXCERPTS_MAX})`);
  const first = item.excerpts[0];
  if (first && (item.provenance.path !== first.path || item.provenance.lines.start !== first.lineStart || item.provenance.lines.end !== Math.max(first.lineEnd, first.lineStart))) {
    why.push('provenance must be the first excerpt');
  }
  item.excerpts.forEach((e, i) => {
    const tag = `excerpt ${i + 1} (${e.path}:${e.lineStart}-${e.lineEnd})`;
    const hit = ex.path(co.repo, e.path);
    if (hit) {
      why.push(`${tag} cites an excluded file: ${hit.reason}`);
      return;
    }
    if (!co.fullIndex.files.has(e.path)) {
      why.push(`${tag}: no such file at ${co.sha.slice(0, 12)} (paths are repo-root relative)`);
      return;
    }
    if (e.lineStart > e.lineEnd) {
      why.push(`${tag}: lineStart > lineEnd`);
      return;
    }
    const lines = fileLines(co, e.path);
    if (e.lineEnd > lines.length) {
      why.push(`${tag}: line out of range (the file has ${lines.length} lines)`);
      return;
    }
    const q = normWs(e.quote);
    if (q.length < QUOTE_MIN) why.push(`${tag}: quote is ${q.length} chars (needs >= ${QUOTE_MIN})`);
    else if (!normWs(lines.slice(e.lineStart - 1, e.lineEnd).join('\n')).includes(q)) why.push(`${tag}: quote is not verbatim in those lines (whitespace-normalized): "${q.slice(0, 80)}"`);
  });
  if (first && !why.some((w) => w.startsWith('excerpt 1 '))) {
    const prov = checkProvenance(co, ex, item.provenance);
    if (prov.error) why.push(prov.error);
    if (prov.excluded) why.push(prov.excluded);
  }

  // ---- readMore
  if (item.readMore.length > READMORE_MAX) why.push(`${item.readMore.length} readMore entries (max ${READMORE_MAX})`);
  item.readMore.forEach((r, i) => {
    const tag = `readMore ${i + 1} (${r.path})`;
    const wl = r.why.trim().length;
    if (wl < WHY_MIN || wl > WHY_MAX) why.push(`${tag}: why is ${wl} chars (needs ${WHY_MIN}-${WHY_MAX})`);
    const hit = ex.path(co.repo, r.path);
    if (hit) {
      why.push(`${tag} points at an excluded file: ${hit.reason}`);
      return;
    }
    if (!co.fullIndex.files.has(r.path)) {
      why.push(`${tag}: no such file at ${co.sha.slice(0, 12)}`);
      return;
    }
    pinFile(co, r.path);
    if ((r.lineStart === null) !== (r.lineEnd === null)) {
      why.push(`${tag}: give both lineStart and lineEnd, or neither`);
      return;
    }
    if (r.lineStart !== null && r.lineEnd !== null) {
      const len = fileLines(co, r.path).length;
      if (r.lineStart > r.lineEnd) why.push(`${tag}: lineStart > lineEnd`);
      else if (r.lineEnd > len) why.push(`${tag}: line out of range (the file has ${len} lines)`);
    }
  });

  // ---- answer-first: a reading never gives a key away
  if (item.phase === 'before') {
    for (const l of noteLeaks(item, quests.quizzes)) why.push(`leaks an answer: ${l}`);
  }

  if (why.length) return { verdict: 'reject', reason: why.join(' ; ') };
  return { verdict: 'accept', item };
}

/** Pack-level contract: 2-4 pack 'before' notes, exactly one 'after' note per quiz. */
export function notesCoverageProblems(accepted: readonly SeedNoteItem[], quests: QuestPackView): string[] {
  const out: string[] = [];
  const packBefore = accepted.filter((n) => n.phase === 'before' && n.target === NOTE_PACK_TARGET).length;
  if (packBefore < PACK_BEFORE_MIN || packBefore > PACK_BEFORE_MAX) out.push(`coverage: ${packBefore} accepted before note(s) targeting "pack" (needs ${PACK_BEFORE_MIN}-${PACK_BEFORE_MAX})`);
  const after = new Map<string, number>();
  for (const n of accepted) if (n.phase === 'after') after.set(n.target, (after.get(n.target) ?? 0) + 1);
  const missing = quests.quizzes.filter((q) => !after.has(q.key)).map((q) => q.key);
  if (missing.length) out.push(`coverage: ${missing.length} quiz(zes) without an accepted after note: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}`);
  const dup = [...after].filter(([, c]) => c > 1).map(([k]) => k);
  if (dup.length) out.push(`coverage: more than one after note for ${dup.join(', ')}`);
  return out;
}
