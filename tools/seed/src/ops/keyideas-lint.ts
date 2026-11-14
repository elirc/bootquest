// seed:lint:keyideas (rv2 S2, PLAN §2.1): the key-ideas side files content/keyideas/<section>.json.
// They are server-local (never stamped, never fingerprinted; the server reader is store/keyideas.ts),
// so nothing else checks them. This lint holds every file to the bootquest-keyideas@1 contract:
//   - schema (strict), section id = file name, ids unique and kebab-case, 5-12 ideas per section
//     (the sysdrills bank: exactly one per module, 18), word limits (idea <= 30, answer <= 60),
//     >= 1 tag, >= 1 source, 0-3 siblings;
//   - every scope / sources / siblings key resolves to a LIVE unit of the estate (a scope key ending in
//     "/" is a prefix, as in content/paths/*.json, and must cover >= 1 live unit), and none is archived
//     (content/archive.json); sources and siblings must be exact keys, siblings must be drills;
//   - the xleak rule: an idea's prompt + answer may restate a keyed answer only when that item belongs
//     to a unit in the idea's own `sources` (the card is enrolled after that unit is passed). Two
//     matchers, both the estate's existing ones: the token rule of seed:lint:leaks part 1
//     (factory/leak.ts leakMatchPrepared with guards.ts EB_LEAK_JACCARD / EB_LEAK_OPTIONS) against every
//     quiz keyed answer (quest packs, Fundamentals gates, code-pack quiz units), and the containment rule
//     of seed:lint:leaks part 2 (xleak-lint.ts xleakScore / xleakFires) against every explain-back key
//     point. 0 leaks, no baseline.
// The unit universe is derived from the content files with the server's own key rules (cited per family
// below), so the lint needs no DB and no server boot. Read-only. Lives in ops/, outside the fingerprint walk.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { EB_LEAK_JACCARD, EB_LEAK_OPTIONS } from '../factory/guards.ts';
import { leakMatchPrepared, prepareLeakKey, prepareLeakText, type LeakKey } from '../factory/leak.ts';
import { xleakFires, xleakScore, xleakTokens } from './xleak-lint.ts';

export const KEYIDEAS_FORMAT = 'bootquest-keyideas@1' as const;
export const IDEA_MAX_WORDS = 30;
export const ANSWER_MAX_WORDS = 60;
export const MIN_IDEAS = 5;
export const MAX_IDEAS = 12;
/** the sysdrills section is one idea per module (PLAN §2.1) */
export const FIXED_IDEA_COUNT: Readonly<Record<string, number>> = { sysdrills: 18 };
export const MAX_SIBLINGS = 3;

const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case');
export const KeyIdea = z
  .object({
    id: kebab,
    idea: z.string().min(1),
    why: z.string().min(1),
    prompt: z.string().min(1),
    answer: z.string().min(1),
    tags: z.array(kebab).min(1),
    sources: z.array(z.string().min(1)).min(1),
    siblings: z.array(z.string().min(1)).max(MAX_SIBLINGS),
  })
  .strict();
export const KeyIdeasFile = z
  .object({
    format: z.literal(KEYIDEAS_FORMAT),
    section: kebab,
    title: z.string().min(1),
    track: z.string().min(1),
    _note: z.string().optional(),
    scope: z.array(z.string().min(1)).min(1),
    // a fraction in (0, 1] of the scope's live units, or a whole count >= 2 (campaign sections: any 3 sources passed);
    // the same rule as the server reader (store/keyideas.ts RecapAfter)
    recapAfter: z.number().positive().refine((n) => n <= 1 || Number.isInteger(n), 'a fraction <= 1 or a whole count >= 2').optional(),
    ideas: z.array(KeyIdea),
  })
  .strict();
export type KeyIdeasFile = z.infer<typeof KeyIdeasFile>;

export const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

// ---------------------------------------------------------------- the unit universe

export interface CatalogUnit {
  key: string;
  family: 'pack' | 'fundamentals' | 'explain-back' | 'g2' | 'kata' | 'retest' | 'study' | 'campaign' | 'authored';
  kind: string;
  track: string;
  title: string;
  repo?: string;
  /** a campaign quest with no quest pack stays content-pending (store/study-quests.ts): not playable */
  playable: boolean;
}

const rd = (f: string): any => JSON.parse(readFileSync(f, 'utf8'));
const h12 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);
// server/src/store/ladder.ts `slug` / `h12` and the *UnitKey helpers
const slug = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-');
const G2_PROMPT = /^G2 BRIEF\b/;
const DESIGN_PROMPT = /^DESIGN IT\b/;
const dirs = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort().filter((n) => statSync(join(d, n)).isDirectory()) : []);
const seedItems = (d: string): any[] => (existsSync(join(d, 'items.json')) ? (rd(join(d, 'items.json')).items ?? []) : []);

export interface Estate {
  units: Map<string, CatalogUnit>;
  archived: Set<string>;
  archivedPrefixes: string[];
  /** keyed answers: quiz keys (token rule) and explain-back key points (containment rule), each with its unit */
  quizKeys: Array<{ id: string; unit: string; answer: string; key: LeakKey }>;
  kps: Array<{ id: string; unit: string; text: string; tokens: Set<string> }>;
}

export function readEstate(contentDir: string): Estate {
  const units = new Map<string, CatalogUnit>();
  const add = (u: CatalogUnit): void => {
    if (!units.has(u.key)) units.set(u.key, u);
  };
  const quizKeys: Estate['quizKeys'] = [];
  const kps: Estate['kps'] = [];
  const quiz = (id: string, unit: string, answer: string): void => {
    if (answer) quizKeys.push({ id, unit, answer, key: prepareLeakKey(answer) });
  };

  // stamped code packs: content/packs/<source>/<course>.json units[].unit (store/packs.ts)
  const packsDir = join(contentDir, 'packs');
  for (const src of dirs(packsDir)) {
    for (const f of readdirSync(join(packsDir, src)).sort()) {
      if (!f.endsWith('.json') || ['manifest.json', 'validation.json', 'quarantine.json'].includes(f)) continue;
      const j = rd(join(packsDir, src, f));
      for (const e of j.units ?? []) {
        const u = e.unit;
        add({ key: u.key, family: 'pack', kind: u.kind, track: u.track, title: u.title, playable: true });
        for (const c of u.checks ?? []) {
          const s = c.spec;
          if (s?.type === 'quiz' && Array.isArray(s.choices) && typeof s.answerKey === 'number') quiz(`pack:${u.key}`, u.key, String(s.choices[s.answerKey] ?? ''));
        }
      }
    }
  }

  // Fundamentals topics: one study unit fund/<track>/<topic> (store/fundamentals.ts), gate items fund:<track>/<topic>/qNN
  const fundDir = join(contentDir, 'fundamentals');
  for (const track of dirs(fundDir)) {
    const f = join(fundDir, track, 'topics.json');
    if (!existsSync(f)) continue;
    for (const t of rd(f).topics ?? []) {
      const key = `fund/${track}/${t.id}`;
      add({ key, family: 'fundamentals', kind: 'study', track, title: t.title, playable: true });
      for (const q of t.quiz ?? []) quiz(q.key, key, String(q.choices?.[q.answer] ?? ''));
    }
  }

  // campaign quests: content/campaign/<track>.json acts[].quests[].unit (store/campaign.ts); a study quest is
  // playable when a quest pack of its repo has >= 1 quiz item (store/study-quests.ts)
  const seedDir = join(contentDir, 'seed');
  const questPacks = new Map<string, any[]>();
  for (const p of dirs(join(seedDir, 'quests'))) {
    const m = join(seedDir, 'quests', p, 'manifest.json');
    if (!existsSync(m)) continue;
    const repo = rd(m).source?.repo as string | undefined;
    if (repo) questPacks.set(repo, seedItems(join(seedDir, 'quests', p)));
  }
  const studyQuestRepos = new Set<string>();
  const campDir = join(contentDir, 'campaign');
  const questUnitByRepo = new Map<string, string>();
  if (existsSync(campDir)) {
    for (const f of readdirSync(campDir).sort()) {
      if (!f.endsWith('.json') || f === 'manifest.json') continue;
      const c = rd(join(campDir, f));
      for (const a of c.acts ?? []) {
        for (const q of a.quests ?? []) {
          if (!q.unit) continue;
          const study = q.kind === 'study-quest';
          if (study) studyQuestRepos.add(q.repo);
          const hasQuiz = study && (questPacks.get(q.repo) ?? []).some((i) => i.kind === 'quiz');
          add({ key: q.unit.key, family: 'campaign', kind: q.unit.kind, track: c.track, title: q.unit.title, repo: q.repo, playable: !study || hasQuiz });
          if (study) questUnitByRepo.set(q.repo, q.unit.key);
        }
      }
    }
  }
  // quest-pack quiz keys belong to the repo's study quest, else to its standalone ladder study unit
  for (const [repo, items] of questPacks) {
    const quizzes = items.filter((i) => i.kind === 'quiz');
    if (!quizzes.length) continue;
    let unit = studyQuestRepos.has(repo) ? questUnitByRepo.get(repo) : undefined;
    if (!unit) {
      unit = `ladder/study/${slug(repo)}/${h12(quizzes.map((i) => i.key).join('\u0000'))}`;
      add({ key: unit, family: 'study', kind: 'study', track: '?', title: `Study reference: ${repo}`, repo, playable: true });
    }
    for (const q of quizzes) {
      const choices: string[] = q.check?.choices ?? (q.choices ?? []).map((c: { text: string }) => c.text);
      const answer = typeof q.check?.answerKey === 'number' ? choices[q.check.answerKey] : q.check?.answerKey;
      quiz(q.key, unit, String(answer ?? ''));
    }
  }

  // explain-back / G2 / DESIGN IT sets (store/ladder.ts explainBackUnitKey)
  for (const p of dirs(join(seedDir, 'explainback'))) {
    for (const it of seedItems(join(seedDir, 'explainback', p))) {
      if (it.kind !== 'explain-back') continue;
      const q0 = it.questions?.[0]?.prompt ?? '';
      const g2 = G2_PROMPT.test(q0);
      const key = `ladder/${g2 ? 'g2' : 'explain-back'}/${slug(it.provenance.repo)}/${h12(it.key)}`;
      add({ key, family: g2 ? 'g2' : 'explain-back', kind: 'explain-back', track: g2 ? 'agentic' : DESIGN_PROMPT.test(q0) ? 'sysdesign' : '?', title: `${g2 ? 'G2' : DESIGN_PROMPT.test(q0) ? 'DESIGN IT' : 'Explain back'}: ${it.provenance.repo} ${it.set ? `(set ${String(it.set).toUpperCase()})` : ''}`.trim(), repo: it.provenance.repo, playable: true });
      (it.questions ?? []).forEach((q: { keyPoints: Array<{ text: string }> }, qi: number) =>
        q.keyPoints.forEach((kp, ki) => kps.push({ id: `eb:${p} q${qi + 1}.kp${ki + 1}`, unit: key, text: kp.text, tokens: xleakTokens(kp.text) })),
      );
    }
  }
  // patch katas (kataUnitKey) and changed-example retests (retestUnitKey)
  for (const p of dirs(join(seedDir, 'patches'))) {
    for (const it of seedItems(join(seedDir, 'patches', p))) add({ key: `ladder/kata/${slug(it.provenance.repo)}/${h12(it.key)}`, family: 'kata', kind: 'patch-kata', track: 'agentic', title: `Kata: ${it.title}`, repo: it.provenance.repo, playable: true });
  }
  for (const p of dirs(join(seedDir, 'variants'))) {
    for (const it of seedItems(join(seedDir, 'variants', p))) add({ key: `ladder/retest/${slug(it.provenance.repo)}/${h12(it.key)}`, family: 'retest', kind: 'retest', track: '?', title: 'Changed-example retest', repo: it.provenance.repo, playable: true });
  }
  // authored units (content/units/*.json, store/ladder.ts readAuthoredUnits)
  const unitsDir = join(contentDir, 'units');
  if (existsSync(unitsDir)) {
    for (const f of readdirSync(unitsDir).sort()) {
      if (!f.endsWith('.json')) continue;
      for (const u of rd(join(unitsDir, f)).units ?? []) add({ key: u.key, family: 'authored', kind: u.kind, track: u.track, title: u.title, playable: true });
    }
  }

  const archived = new Set<string>();
  const archivedPrefixes: string[] = [];
  const af = join(contentDir, 'archive.json');
  if (existsSync(af)) for (const g of rd(af).groups ?? []) for (const k of g.keys ?? []) (k.endsWith('/') ? archivedPrefixes.push(k) : archived.add(k));
  return { units, archived, archivedPrefixes, quizKeys, kps };
}

export const isArchived = (e: Estate, key: string): boolean => e.archived.has(key) || e.archivedPrefixes.some((p) => key.startsWith(p));
/** live = known, playable and not archived */
export const isLive = (e: Estate, key: string): boolean => {
  const u = e.units.get(key);
  return !!u && u.playable && !isArchived(e, key);
};
/** the live units a scope key covers (a key ending in "/" is a prefix) */
export function scopeUnits(e: Estate, key: string): string[] {
  if (!key.endsWith('/')) return isLive(e, key) ? [key] : [];
  return [...e.units.keys()].filter((k) => k.startsWith(key) && isLive(e, k));
}

// ---------------------------------------------------------------- the lint

export interface KeyIdeasProblem {
  file: string;
  idea?: string;
  message: string;
}
export interface KeyIdeasReport {
  files: number;
  ideas: number;
  perSection: Array<{ section: string; ideas: number; scopeUnits: number }>;
  problems: KeyIdeasProblem[];
  leaks: number;
}

export function keyIdeasReport(contentDir: string, estate: Estate = readEstate(contentDir)): KeyIdeasReport {
  const dir = join(contentDir, 'keyideas');
  const problems: KeyIdeasProblem[] = [];
  const perSection: KeyIdeasReport['perSection'] = [];
  let ideas = 0;
  let leaks = 0;
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    const p = (message: string, idea?: string): void => void problems.push({ file: f, idea, message });
    let raw: unknown;
    try {
      raw = rd(join(dir, f));
    } catch (err) {
      p(`not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const parsed = KeyIdeasFile.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues.slice(0, 20)) p(`schema: ${i.path.join('.')}: ${i.message}`);
      continue;
    }
    const s = parsed.data;
    if (`${s.section}.json` !== basename(f)) p(`section "${s.section}" does not match the file name`);
    const want = FIXED_IDEA_COUNT[s.section];
    if (want !== undefined ? s.ideas.length !== want : s.ideas.length < MIN_IDEAS || s.ideas.length > MAX_IDEAS)
      p(`${s.ideas.length} ideas (want ${want !== undefined ? want : `${MIN_IDEAS}-${MAX_IDEAS}`})`);
    const covered = new Set<string>();
    for (const k of s.scope) {
      if (isArchived(estate, k)) p(`scope key ${k} is archived`);
      const us = scopeUnits(estate, k);
      if (!us.length) p(`scope key ${k} resolves to no live unit`);
      us.forEach((u) => covered.add(u));
    }
    perSection.push({ section: s.section, ideas: s.ideas.length, scopeUnits: covered.size });
    if (s.recapAfter !== undefined && s.recapAfter > 1 && s.recapAfter > covered.size) p(`recapAfter ${s.recapAfter} is more than the ${covered.size} live scope unit(s)`);
    const ids = new Set<string>();
    for (const it of s.ideas) {
      ideas++;
      const q = (m: string): void => p(m, it.id);
      if (ids.has(it.id)) q('duplicate id');
      ids.add(it.id);
      if (wordCount(it.idea) > IDEA_MAX_WORDS) q(`idea has ${wordCount(it.idea)} words (max ${IDEA_MAX_WORDS})`);
      if (wordCount(it.answer) > ANSWER_MAX_WORDS) q(`answer has ${wordCount(it.answer)} words (max ${ANSWER_MAX_WORDS})`);
      for (const [field, keys] of [['sources', it.sources], ['siblings', it.siblings]] as const) {
        if (new Set(keys).size !== keys.length) q(`${field} lists a key twice`);
        for (const k of keys) {
          if (k.endsWith('/')) q(`${field} key ${k} is a prefix (exact unit keys only)`);
          else if (!estate.units.has(k)) q(`${field} key ${k} is not a unit of the estate`);
          else if (isArchived(estate, k)) q(`${field} key ${k} is archived`);
          else if (!isLive(estate, k)) q(`${field} key ${k} is not playable (content-pending)`);
        }
      }
      for (const k of it.siblings) {
        const u = estate.units.get(k);
        if (u && u.kind !== 'drill') q(`sibling ${k} is a ${u.kind}, not a drill`);
        if (it.sources.includes(k)) q(`sibling ${k} is also a source`);
      }
      // xleak: prompt + answer vs every keyed answer outside the idea's sources
      const own = new Set(it.sources);
      for (const [field, text] of [['prompt', it.prompt], ['answer', it.answer]] as const) {
        const t = prepareLeakText(text);
        const present = new Set(t.padded.trim().split(' '));
        for (const z of estate.quizKeys) {
          if (own.has(z.unit)) continue;
          // necessary condition for both rules (contains: every key token; Jaccard >= 0.5 against the key's
          // token set: at least half of them), so the exact matcher only runs on candidates
          let shared = 0;
          for (const tok of z.key.set) if (present.has(tok)) shared++;
          if (shared * 2 < z.key.set.size) continue;
          const m = leakMatchPrepared(t, z.key, EB_LEAK_JACCARD, EB_LEAK_OPTIONS);
          if (m) {
            leaks++;
            q(`LEAK ${field} ${m.kind === 'contains' ? 'contains' : `overlaps (${m.score.toFixed(2)})`} the keyed answer of ${z.id} (unit ${z.unit}, not a source): "${z.answer.slice(0, 80)}"`);
          }
        }
      }
      const tokens = xleakTokens(`${it.prompt} ${it.answer}`);
      for (const kp of estate.kps) {
        if (own.has(kp.unit)) continue;
        const sc = xleakScore(tokens, kp.tokens);
        if (xleakFires(sc)) {
          leaks++;
          q(`LEAK prompt+answer restates ${kp.id} (unit ${kp.unit}, not a source; containment ${sc.score.toFixed(2)}, ${sc.shared} shared): "${kp.text.slice(0, 90)}"`);
        }
      }
    }
  }
  return { files: files.length, ideas, perSection, problems, leaks };
}

export const keyIdeasFailed = (r: KeyIdeasReport): boolean => r.problems.length > 0;

export function formatKeyIdeasReport(r: KeyIdeasReport): string[] {
  const out = ['seed:lint:keyideas — content/keyideas/*.json: schema, idea counts, word limits, live non-archived keys, xleak (prompt + answer vs keyed answers outside sources)'];
  for (const x of r.problems) out.push(`${x.message.startsWith('LEAK') ? 'LEAK   ' : 'PROBLEM'} ${x.file}${x.idea ? ` ${x.idea}` : ''}: ${x.message.replace(/^LEAK /, '')}`);
  for (const s of r.perSection) out.push(`  ${s.section}: ${s.ideas} idea(s), scope ${s.scopeUnits} live unit(s)`);
  out.push(`${r.files} side file(s), ${r.ideas} idea(s): ${r.problems.length} problem(s), ${r.leaks} leak(s)`);
  out.push(`RESULT ${keyIdeasFailed(r) ? 'PROBLEMS' : 'OK'}`);
  return out;
}
