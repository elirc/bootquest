import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Answer-leak guard for hand-authored quest drafts (campaign 2 act-3 review; release wave
 * factory-3 rewrite after campaign 2 review F1/F2).
 *
 * Hash-seeded choice order fixes WHERE the key sits, but not a length tell: if the keyed
 * answer is usually the longest choice, "pick the longest" clears the 80% study-quest gate
 * without reading the guides. The same goes for an answer that is usually the shortest
 * (review F2), a key that is typically much longer or shorter than its rivals (median
 * answer/longest-distractor ratio), a key that keeps the same length RANK, a phrasing/format
 * frame only the key uses, and a stamped pack that never keys some answer slot.
 *
 * EVERY draft in content/seed-drafts/quests that has quizzes runs EVERY guard below; there
 * is no allow-list. The only escape hatch is EXEMPT: draft -> the guards it fails TODAY.
 * An exempt guard must still fail (so an exemption is removed the moment its draft is
 * fixed and the map can only shrink), and a guard not listed for a draft must pass. Do NOT
 * raise a threshold or add an exemption to admit a draft; rewrite its choices.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const DRAFTS = join(ROOT, 'content', 'seed-drafts', 'quests');

const MAX_LONGEST_SHARE = 0.35;
/** campaign 2 review F2: the shortest-choice tell (ankijs 0.42, ...) is guarded for every draft too. */
const MAX_SHORTEST_SHARE = 0.4;
/** Median of answer length / longest-distractor length must sit in this band. */
const MEDIAN_RATIO_MIN = 0.8;
const MEDIAN_RATIO_MAX = 1.2;
/**
 * No single length rank may dominate: if the key is (say) the second-longest choice in most quizzes,
 * "pick the second-longest" becomes the tell (rebalance-3 review: 58% in react and jsdrill_sync).
 * Rank = 1 + number of distractors strictly longer than the key, so ties never count against the guard's author.
 */
const MAX_RANK_SHARE = 0.5;
/**
 * Format tells (REBALANCE-1 fix pass). A key written as "Verdict: reason" next
 * to distractors written as "Verdict, because reason" leaks just like length
 * does. Each blind strategy below keeps only the choices that have (or lack) a
 * surface feature and guesses among them; its expected score over a draft must
 * stay near chance (0.25 for four choices). An item where every choice, or no
 * choice, has the feature gives the strategy nothing, so it scores 1/n there.
 */
const MAX_FORMAT_SHARE = 0.35;

type Guard = 'longest' | 'shortest' | 'median-ratio' | 'rank' | 'format' | 'slots';

/**
 * draft -> the guards it currently FAILS. One group per release-wave content agent (the
 * agent that owns those drafts), sorted inside each group; drafts no agent owns are in the
 * UNASSIGNED group. Remove a guard (and then the draft) as soon as its draft is rewritten
 * and re-seeded: an exempt guard that passes fails this suite.
 */
const EXEMPT: Record<string, Guard[]> = {
  // CONTENT-1

  // CONTENT-2

  // CONTENT-3

  // CONTENT-4
  'ankijs': ['shortest'],
  'elihyper': ['median-ratio', 'format'],
  'grok-build-hr': ['median-ratio', 'format'],
  'jobtrack': ['format'],
  'master': ['rank', 'format'],
  'mobiletagalog': ['format'],
  'organized-anti-emponb': ['format'],
  'organized-dotnet-trello': ['format'],
  'organized-js-training-react': ['format'],
  'ship-it': ['format'],
  'ww35': ['median-ratio', 'rank', 'format'],

  // CONTENT-5
  'astra-learning-studio': ['rank', 'format'],
  'elihyper2': ['format'],
  'grok-build-order': ['longest', 'format'],
  'js1': ['format'],
  'master3': ['longest', 'format'],
  'nethris': ['longest', 'rank', 'format'],
  'organized-anti-helpdesk': ['longest', 'format', 'slots'],
  'organized-dotnet-vg': ['longest', 'format'],
  'organized-js-training-trainjs': ['format'],
  'signalpost-swe-bootcamp': ['format'],
  'ww39': ['median-ratio', 'format'],

  // CONTENT-6
  'bootlocalopusv2': ['format'],
  'fableopusrecallv2': ['format'],
  'grok-build-team': ['longest', 'rank', 'format', 'slots'],
  'jsdrillv2': ['rank', 'format'],
  'master7': ['format'],
  'netpastebin': ['format'],
  'organized-app-eliapplybot': ['rank', 'format'],
  'organized-experiment-support-hub': ['median-ratio'],
  'organized-study-support-desk-crm': ['median-ratio', 'format'],
  'storefront': ['format'],
  'ww4': ['median-ratio', 'format'],

  // CONTENT-7
  'buildgum': ['rank'],
  'finance-dashboard': ['rank'],
  'grokjs-dotnet-learning-lab': ['rank'],
  'jsprojectlearn': ['format'],
  'masterrnative': ['rank', 'format'],
  'netslack': ['rank'],
  'organized-build-crmpyjs': ['format'],
  'organized-experiment-ww45': ['format'],
  'recipegen-app': ['format'],
  'trainjs': ['format'],
  'zz1': ['median-ratio', 'rank', 'format'],

  // UNASSIGNED
  'dotnet-ramp': ['format'],
  'master4': ['format'],
  'organized-app-job-track': ['format'],
};

/** "Verdict: reason": a colon + space early in the choice, outside code braces/brackets. */
const colonLed = (s: string): boolean => /^[^{[]{1,60}?:\s/.test(s);
const causal = (s: string): boolean => /\b(because|since)\b/i.test(s);
const absolute = (s: string): boolean =>
  /\b(always|never|only|all|every|none|no|any|must|cannot|entirely|completely|whole)\b/i.test(s);
const semicolon = (s: string): boolean => s.includes(';');

/** Expected score of "guess uniformly among the choices that pass `keep`". */
const keepScore = (q: DraftQuiz, keep: (s: string) => boolean): number => {
  const choices = [q.answer, ...q.distractors];
  let pool = choices.filter(keep);
  if (pool.length === 0) pool = choices;
  return pool.includes(q.answer) ? 1 / pool.length : 0;
};
/** The reviewer's combined strategy: drop because/since choices, then prefer colon-led ones. */
const comboScore = (q: DraftQuiz): number => {
  const choices = [q.answer, ...q.distractors];
  let pool = choices.filter((c) => !causal(c));
  if (pool.length === 0) pool = choices;
  const colon = pool.filter(colonLed);
  if (colon.length > 0) pool = colon;
  return pool.includes(q.answer) ? 1 / pool.length : 0;
};
const FORMAT_STRATEGIES: Array<[string, (q: DraftQuiz) => number]> = [];
for (const [name, f] of [['colon-led', colonLed], ['because/since', causal], ['absolute-word', absolute], ['semicolon', semicolon]] as const) {
  FORMAT_STRATEGIES.push([`prefer ${name}`, (q) => keepScore(q, f)]);
  FORMAT_STRATEGIES.push([`eliminate ${name}`, (q) => keepScore(q, (s) => !f(s))]);
}
FORMAT_STRATEGIES.push(['drop because/since then prefer colon-led', comboScore]);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

interface DraftQuiz { id: string; kind: 'quiz'; answer: string; distractors: string[] }
interface PackQuiz { kind: string; label?: string; check: { answerKey: number }; choices: unknown[] }

const quizzes = (draft: string): DraftQuiz[] => {
  const d = JSON.parse(readFileSync(join(DRAFTS, `${draft}.json`), 'utf8')) as { items: Array<{ kind: string }> };
  return d.items.filter((i): i is DraftQuiz => i.kind === 'quiz');
};

/** Every draft with at least one quiz (the drafts path writes its pack to content/seed/quests/<draft>). */
const ALL_DRAFTS = readdirSync(DRAFTS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length))
  .filter((d) => quizzes(d).length > 0)
  .sort();

const pct = (x: number) => x.toFixed(2);
const keyRank = (q: DraftQuiz) => 1 + q.distractors.filter((d) => d.length > q.answer.length).length;

/** Each guard: null when the draft passes, else why it fails. */
const GUARDS: Record<Guard, (draft: string) => string | null> = {
  longest: (draft) => {
    const qs = quizzes(draft);
    const hit = qs.filter((q) => q.answer.length > Math.max(...q.distractors.map((d) => d.length)));
    const share = hit.length / qs.length;
    return share <= MAX_LONGEST_SHARE ? null : `key strictly longest in ${hit.length}/${qs.length} (${pct(share)} > ${MAX_LONGEST_SHARE}): ${hit.map((q) => q.id).join(', ')}`;
  },
  shortest: (draft) => {
    const qs = quizzes(draft);
    const hit = qs.filter((q) => q.answer.length < Math.min(...q.distractors.map((d) => d.length)));
    const share = hit.length / qs.length;
    return share <= MAX_SHORTEST_SHARE ? null : `key strictly shortest in ${hit.length}/${qs.length} (${pct(share)} > ${MAX_SHORTEST_SHARE}): ${hit.map((q) => q.id).join(', ')}`;
  },
  'median-ratio': (draft) => {
    const m = median(quizzes(draft).map((q) => q.answer.length / Math.max(...q.distractors.map((d) => d.length))));
    return m >= MEDIAN_RATIO_MIN && m <= MEDIAN_RATIO_MAX ? null : `median key/longest-distractor ratio ${pct(m)} outside [${MEDIAN_RATIO_MIN}, ${MEDIAN_RATIO_MAX}]`;
  },
  rank: (draft) => {
    const qs = quizzes(draft);
    const byRank = new Map<number, string[]>();
    for (const q of qs) byRank.set(keyRank(q), [...(byRank.get(keyRank(q)) ?? []), q.id]);
    const [rank, ids] = [...byRank].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0]!;
    return ids.length / qs.length <= MAX_RANK_SHARE ? null : `key is length rank ${rank} in ${ids.length}/${qs.length} (> ${MAX_RANK_SHARE}): ${ids.join(', ')}`;
  },
  format: (draft) => {
    const qs = quizzes(draft);
    const bad = FORMAT_STRATEGIES.map(([name, score]) => [name, qs.reduce((acc, q) => acc + score(q), 0) / qs.length] as const).filter(([, s]) => s > MAX_FORMAT_SHARE);
    return bad.length === 0 ? null : `format strategies beat chance: ${bad.map(([n, s]) => `"${n}" ${pct(s)}`).join(', ')} (> ${MAX_FORMAT_SHARE})`;
  },
  slots: (draft) => {
    const pack = JSON.parse(readFileSync(join(ROOT, 'content', 'seed', 'quests', draft, 'items.json'), 'utf8')) as { items: PackQuiz[] };
    const qs = pack.items.filter((i) => i.kind === 'quiz');
    const width = Math.min(...qs.map((q) => q.choices.length));
    const used = new Set(qs.map((q) => q.check.answerKey));
    const missing = Array.from({ length: width }, (_, s) => s).filter((s) => !used.has(s));
    return missing.length === 0 ? null : `stamped pack never keys answer slot(s) ${missing.join(', ')}`;
  },
};
const GUARD_NAMES = Object.keys(GUARDS) as Guard[];

describe('the EXEMPT map is well-formed', () => {
  it('names only real drafts with quizzes and real guards, each at most once, never an empty list', () => {
    for (const [draft, guards] of Object.entries(EXEMPT)) {
      expect(ALL_DRAFTS, `${draft} is not a draft with quizzes`).toContain(draft);
      expect(guards.length, draft).toBeGreaterThan(0);
      expect(new Set(guards).size, `${draft} lists a guard twice`).toBe(guards.length);
      for (const g of guards) expect(GUARD_NAMES, `${draft}: unknown guard ${g}`).toContain(g);
    }
  });

  it('every draft has a quiz pack big enough to judge', () => {
    expect(ALL_DRAFTS.length).toBeGreaterThan(0);
    for (const d of ALL_DRAFTS) expect(quizzes(d).length, d).toBeGreaterThanOrEqual(10);
  });
});

describe('hand-authored quiz drafts do not leak the key by length, rank, format or position', () => {
  for (const draft of ALL_DRAFTS) {
    const exempt = new Set(EXEMPT[draft] ?? []);
    for (const guard of GUARD_NAMES) {
      if (exempt.has(guard)) {
        it(`${draft}: still fails ${guard} (remove it from EXEMPT once fixed)`, () => {
          expect(GUARDS[guard](draft), `${draft} now passes ${guard}: delete that exemption`).not.toBeNull();
        });
      } else {
        it(`${draft}: ${guard}`, () => {
          expect(GUARDS[guard](draft)).toBeNull();
        });
      }
    }
  }
});

describe('format-tell strategies detect the tells they name', () => {
  const mk = (answer: string, distractors: string[]): DraftQuiz => ({ id: 'x', kind: 'quiz', answer, distractors });
  const score = (name: string, qs: DraftQuiz[]): number => {
    const s = FORMAT_STRATEGIES.find(([n]) => n === name);
    if (!s) throw new Error(`no strategy ${name}`);
    return qs.reduce((acc, q) => acc + s[1](q), 0) / qs.length;
  };
  // The REBALANCE-1 review's shape: "Verdict: reason" keys, "Verdict, because reason" distractors.
  const leaky = Array.from({ length: 10 }, () =>
    mk('400 Validation failed: PUT parses with the create schema', [
      '200 with the task updated, since PUT accepts partial bodies',
      '404 Task not found, because the service swallows the error',
      '500 Failed to update task, because the column is unknown',
    ]),
  );
  const uniform = Array.from({ length: 10 }, () =>
    mk('400 Validation failed: PUT parses with the create schema', [
      '200 with the task updated: PUT accepts partial bodies',
      '404 Task not found: the service swallows the error',
      '500 Failed to update task: the column is unknown',
    ]),
  );

  it('scores a colon-key / because-distractor draft far above the cap', () => {
    expect(score('prefer colon-led', leaky)).toBe(1);
    expect(score('eliminate because/since', leaky)).toBe(1);
    expect(score('drop because/since then prefer colon-led', leaky)).toBe(1);
  });

  it('scores a uniformly framed draft at chance', () => {
    for (const [name] of FORMAT_STRATEGIES) expect(score(name, uniform)).toBeCloseTo(0.25);
  });

  it('does not read a colon inside a code object literal as a verdict frame', () => {
    expect(colonLed('Status 200 with { data: deletedTask }')).toBe(false);
    expect(colonLed('Nowhere: it is defined but never used')).toBe(true);
  });
});
