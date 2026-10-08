// W6 mock fixtures: explain-back question sets, patch katas, evidence rows, campaign acts.
// PRIVATE halves (key points, seeded-defect keys) live here and only leave through the
// answer-first mock endpoints — never through getUnit.

import type { CampaignResponse, CompetencyId, EvidenceRowDto, PromotionProgress, TrackId } from '../types';

export interface ExplainBackFixture {
  competencies: CompetencyId[];
  questions: { prompt: string; keyPoints: { text: string; quote: string | null; cite: { path: string; lineStart: number; lineEnd: number } | null }[] }[];
  /** retest the passing self-score schedules (null = no variation seeded) */
  retest: { unitId: number; title: string; artifactUnitId: number } | null;
}

export interface KataFixture {
  competencies: CompetencyId[];
  title: string;
  diff: string;
  contextFiles: { path: string; content: string }[];
  defects: { scenario: string; evidence: { path: string; lineStart: number; lineEnd: number; in: 'repo' | 'patched' }; consequence: string }[];
}

export const explainBackFixtures: Record<string, ExplainBackFixture> = {
  '105': {
    competencies: ['language-fluency'],
    questions: [
      {
        prompt: 'What does a closure capture, and when is that binding read?',
        keyPoints: [
          { text: 'A closure captures the variable binding, not a snapshot of its value.', quote: 'closures capture bindings', cite: null },
          { text: 'The binding is read when the inner function runs.', quote: null, cite: { path: 'notes/closures.md', lineStart: 12, lineEnd: 14 } },
        ],
      },
      {
        prompt: 'Why does a var loop counter surprise callbacks?',
        keyPoints: [
          { text: 'var is function-scoped, so every callback shares one i.', quote: 'var is function scoped', cite: null },
          { text: 'let creates a fresh binding per iteration.', quote: 'let creates a new binding each iteration', cite: null },
        ],
      },
      {
        prompt: 'Name one real use of closures in the project you built.',
        keyPoints: [{ text: 'Private state behind a factory function (encapsulation).', quote: null, cite: { path: 'src/counter.js', lineStart: 1, lineEnd: 9 } }],
      },
    ],
    retest: { unitId: 102, title: 'Changed example: group records by key length', artifactUnitId: 106 },
  },
  '204': {
    competencies: ['language-fluency'],
    questions: [
      { prompt: 'Records vs classes: equality?', keyPoints: [{ text: 'Records use value equality.', quote: 'value-based equality', cite: null }] },
      { prompt: 'With-expressions?', keyPoints: [{ text: 'with creates a modified copy.', quote: 'non-destructive mutation', cite: null }] },
      { prompt: 'When prefer a class?', keyPoints: [{ text: 'Mutable identity-bearing entities.', quote: 'identity', cite: null }] },
    ],
    retest: null,
  },
};

export const kataFixtures: Record<string, KataFixture> = {
  '109': {
    competencies: ['code-reading', 'agentic-engineering'],
    title: 'Orders API: "simplify" the ownership check',
    diff: [
      'diff --git a/src/orders.js b/src/orders.js',
      '--- a/src/orders.js',
      '+++ b/src/orders.js',
      '@@ -10,7 +10,6 @@ export async function getOrder(req, res) {',
      '   const order = await db.orders.find(req.params.id);',
      '-  if (order.ownerId !== req.user.id) return res.status(404).end();',
      '+  // ownership is checked by the gateway',
      '   res.json(order);',
      ' }',
    ].join('\n'),
    contextFiles: [{ path: 'src/orders.js', content: 'export async function getOrder(req, res) {\n  const order = await db.orders.find(req.params.id);\n  res.json(order);\n}\n' }],
    defects: [
      {
        scenario: 'User A requests /orders/<id of user B>.',
        evidence: { path: 'src/orders.js', lineStart: 11, lineEnd: 11, in: 'patched' },
        consequence: 'IDOR: any signed-in user reads any order.',
      },
      {
        scenario: 'An order id that does not exist.',
        evidence: { path: 'src/orders.js', lineStart: 10, lineEnd: 10, in: 'patched' },
        consequence: 'order is null and res.json(null) answers 200 instead of 404.',
      },
    ],
  },
};

const D = (iso: string) => Date.parse(iso);

export const evidenceFixtures: EvidenceRowDto[] = [
  { id: 412, competency: 'language-fluency', kind: 'explain-back', intention: 'explain-back with the code hidden', observation: '7/8 key points covered (87.5%)', assistance: 'none', assessor: 'self', rating: null, verified: false, score: 0.875, attemptId: 8812, unitId: 105, unitTitle: 'Explain-back: closures', createdAt: D('2026-10-06T19:21:00Z') },
  { id: 411, competency: 'language-fluency', kind: 'artifact', intention: 'project artifact js:u01', observation: 'check passed', assistance: 'none', assessor: 'pipeline', rating: null, verified: true, score: 1, attemptId: 8811, unitId: 106, unitTitle: 'signalpost U01 — health + routing skeleton', createdAt: D('2026-10-06T18:01:00Z') },
  { id: 409, competency: 'feature-delivery', kind: 'submit', intention: 'submit drill', observation: 'check passed', assistance: 'self', assessor: 'pipeline', rating: null, verified: true, score: 1, attemptId: 8809, unitId: 101, unitTitle: 'jstrain M01–M04: values, scope, closures', createdAt: D('2026-10-05T17:22:00Z') },
  { id: 407, competency: 'data-http', kind: 'explain-back', intention: 'explain-back with the code hidden', observation: '3/5 key points covered (60%)', assistance: 'none', assessor: 'self', rating: null, verified: false, score: 0.6, attemptId: 8807, unitId: 105, unitTitle: 'Explain-back: closures', createdAt: D('2026-10-04T20:35:00Z') },
];

export const promotionFixtures: Partial<Record<CompetencyId, PromotionProgress>> = {
  'language-fluency': {
    targetRating: 4,
    eligible: false,
    artifact: { state: 'done', evidenceId: 411, unitId: 106 },
    explainBack: { state: 'done', evidenceId: 412, coverage: 0.875 },
    retest: { state: 'scheduled', evidenceId: null, dueAt: D('2026-10-09T18:01:00Z'), unitId: 102 },
    missing: ['retest: no unassisted, run-verified changed-example retest of the artifact\'s unit >= 2 days after artifact + explain-back'],
  },
  'data-http': {
    targetRating: 4,
    eligible: false,
    artifact: { state: 'done', evidenceId: 406, unitId: 108 },
    explainBack: { state: 'failed', evidenceId: 407, coverage: 0.6 },
    retest: { state: 'pending', evidenceId: null, dueAt: null, unitId: null },
    missing: ["explain-back: none of the artifact's explain-backs reaches 80% unassisted coverage"],
  },
};

export const emptyPromotion = (rating: number): PromotionProgress => ({
  targetRating: rating >= 5 ? null : rating + 1,
  eligible: false,
  artifact: { state: 'pending', evidenceId: null, unitId: null },
  explainBack: { state: 'pending', evidenceId: null, coverage: null },
  retest: { state: 'pending', evidenceId: null, dueAt: null, unitId: null },
  missing: ['artifact: no unassisted, run-verified project artifact since the last rating change'],
});

export const campaignFixtures: Record<TrackId, Omit<CampaignResponse, 'level'>> = {
  js: {
    track: { id: 'js', name: 'JS/TS + React', locked: false },
    acts: [
      {
        id: 1,
        title: 'Foundations',
        theme: 'Language core, async, the event loop',
        ordinal: 1,
        unlocked: true,
        unlockRule: { previousCorePct: 0, level: 1, staticLock: false },
        progress: { coreDone: 1, coreTotal: 3 },
        quests: [
          { id: 11, kind: 'study-quest', title: 'jstrain M01–M04', repo: 'jstrain2.2', rank: 1, unitId: 101, state: 'done', core: true, contentPending: false, twinRepo: null },
          { id: 12, kind: 'study-quest', title: 'Group records with reduce', repo: 'jsprojectlearn', rank: 2, unitId: 102, state: 'available', core: true, contentPending: false, twinRepo: null },
          { id: 13, kind: 'study-quest', title: 'signalpost guides', repo: 'signalpost-swe-bootcamp', rank: 3, unitId: 103, state: 'pending', core: true, contentPending: true, twinRepo: null },
          { id: 14, kind: 'reading', title: 'Reading: microtasks vs macrotasks', repo: 'jsnotes', rank: 4, unitId: 104, state: 'available', core: false, contentPending: false, twinRepo: null },
        ],
      },
      {
        id: 2,
        title: 'APIs and data',
        theme: 'HTTP, validation, SQL',
        ordinal: 2,
        unlocked: false,
        unlockRule: { previousCorePct: 80, level: 4, staticLock: false },
        progress: { coreDone: 0, coreTotal: 1 },
        quests: [{ id: 21, kind: 'study-quest', title: 'HTTP lab: idempotent POST /orders', repo: 'vgslop', rank: 5, unitId: 108, state: 'locked', core: true, contentPending: true, twinRepo: null }],
      },
    ],
  },
  csharp: {
    track: { id: 'csharp', name: 'C#/.NET', locked: false },
    acts: [
      {
        id: 3,
        title: 'C# foundations',
        theme: null,
        ordinal: 1,
        unlocked: true,
        unlockRule: { previousCorePct: 0, level: 1, staticLock: false },
        progress: { coreDone: 0, coreTotal: 1 },
        quests: [{ id: 31, kind: 'study-quest', title: 'LINQ: group orders by customer', repo: 'csbootcamp', rank: 1, unitId: 202, state: 'available', core: true, contentPending: false, twinRepo: null }],
      },
    ],
  },
  agentic: { track: { id: 'agentic', name: 'Agentic engineering', locked: false }, acts: [] },
  java: {
    track: { id: 'java', name: 'Java', locked: true },
    acts: [
      {
        id: 9,
        title: 'Java placeholder',
        theme: null,
        ordinal: 1,
        unlocked: false,
        unlockRule: { previousCorePct: 0, level: 1, staticLock: true },
        progress: { coreDone: 0, coreTotal: 0 },
        quests: [],
      },
    ],
  },
};
