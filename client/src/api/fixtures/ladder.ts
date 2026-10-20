// W6 mock fixtures: explain-back question sets, patch katas, evidence rows, campaign acts.
// PRIVATE halves (key points, seeded-defect keys) live here and only leave through the
// answer-first mock endpoints — never through getUnit.

import type { CampaignResponse, CompetencyId, EvidenceRowDto, PromotionProgress, StudyQuestPublic, TrackId, UnitSummary } from '../types';

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
  // leg (b) of the program unit 303 (see gatedLadderUnits): locked until 303 has a solo pass
  '304': {
    competencies: ['agentic-engineering'],
    questions: [
      { prompt: 'When does your loop stop, and why is that condition safe?', keyPoints: [{ text: 'It stops on a final answer (no tool calls) or at a step cap.', quote: null, cite: null }] },
      { prompt: 'How does a tool result get back to the model?', keyPoints: [{ text: 'Appended as a tool-result message tied to the call id.', quote: null, cite: null }] },
      { prompt: 'What happens when a tool throws?', keyPoints: [{ text: 'The error is returned as the tool result, not thrown out of the loop.', quote: null, cite: null }] },
    ],
    retest: null,
  },
};

/**
 * Ladder dead end #2 (mock parity): an explain-back that is promotion leg (b) of a project unit.
 * Unit 304 lists the program unit 303 as its prerequisite, so - by the server's rule
 * (artifactsAwaitingSoloPass) - answering 304 is refused (409 ARTIFACT_REQUIRED) and its detail
 * carries artifactRequired until 303 has a solo, verified, unrevealed pass. Agentic track, so the
 * JS / C# fixture counts the other pages assert stay as they were.
 */
export const GATED_ARTIFACT_ID = 303;
export const GATED_EXPLAIN_BACK_ID = 304;
export const gatedLadderUnits: UnitSummary[] = [
  { id: GATED_ARTIFACT_ID, key: 'agentic/harness-u01', trackId: 'agentic', kind: 'program-unit', title: 'Agent harness U01: the tool-call loop', difficulty: 3, state: 'available', revealed: false, prerequisites: [301] },
  { id: GATED_EXPLAIN_BACK_ID, key: 'agentic/explain-harness', trackId: 'agentic', kind: 'explain-back', title: 'Explain-back: the tool-call loop', difficulty: 2, state: 'available', revealed: false, prerequisites: [GATED_ARTIFACT_ID] },
];
/** The artifact's check: any change from the starter passes (the mock's generic drill rule). */
export const gatedArtifactFixture = {
  competencies: ['agentic-engineering'] as CompetencyId[],
  instructions: 'Implement runLoop(model, tools): call the model, run each requested tool, feed the results back, stop on a final answer.',
  starter: 'export async function runLoop(model, tools) {\n  // TODO\n}\n',
  /** PRIVATE: released by reveal only (a revealed artifact can never be leg (a), so it stops gating) */
  solution: 'export async function runLoop(model, tools) {\n  for (let step = 0; step < 8; step++) {\n    const reply = await model.next();\n    if (!reply.toolCalls.length) return reply.text;\n    for (const c of reply.toolCalls) model.push({ id: c.id, result: await tools[c.name](c.args) });\n  }\n}\n',
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
          { id: 11, kind: 'study-quest', title: 'jstrain M01–M04', repo: 'jstrain2.2', rank: 1, unitId: 101, state: 'done', core: true, contentPending: false, twinRepo: null, inProgress: false, prerequisites: [] },
          { id: 12, kind: 'study-quest', title: 'Group records with reduce', repo: 'jsprojectlearn', rank: 2, unitId: 102, state: 'available', core: true, contentPending: false, twinRepo: null, inProgress: true, prerequisites: [11] },
          { id: 13, kind: 'study-quest', title: 'signalpost guides', repo: 'signalpost-swe-bootcamp', rank: 3, unitId: 103, state: 'pending', core: true, contentPending: true, twinRepo: null, inProgress: false, prerequisites: [11] },
          { id: 14, kind: 'reading', title: 'Reading: microtasks vs macrotasks', repo: 'jsnotes', rank: 4, unitId: 104, state: 'available', core: false, contentPending: false, twinRepo: null, inProgress: false, prerequisites: [] },
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
        quests: [{ id: 21, kind: 'study-quest', title: 'HTTP lab: idempotent POST /orders', repo: 'vgslop', rank: 5, unitId: 108, state: 'locked', core: true, contentPending: true, twinRepo: null, inProgress: false, prerequisites: [12] }],
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
        progress: { coreDone: 0, coreTotal: 2 },
        quests: [
          { id: 31, kind: 'study-quest', title: 'LINQ: group orders by customer', repo: 'csbootcamp', rank: 1, unitId: 202, state: 'available', core: true, contentPending: false, twinRepo: null, inProgress: false, prerequisites: [] },
          { id: 32, kind: 'study-quest', title: 'borrowbox', repo: 'borrowbox', rank: 2, unitId: 206, state: 'available', core: true, contentPending: false, twinRepo: null, inProgress: false, prerequisites: [] },
        ],
      },
    ],
  },
  agentic: { track: { id: 'agentic', name: 'Agentic engineering', locked: false }, acts: [] },
  // the campaign-less System design track (migration 014): DESIGN IT explain-backs only, no acts
  sysdesign: { track: { id: 'sysdesign', name: 'System design', locked: false }, acts: [] },
  // the unlocked Java track (migration 011): 3 acts of core study quests; act 1 open, its quest packs
  // still content-pending except one, acts 2-3 behind the 80% + level rule
  java: {
    track: { id: 'java', name: 'Java', locked: false },
    acts: [
      {
        id: 9,
        title: 'Foundations',
        theme: 'plain-Java CLI apps: classes, single-responsibility layers, file persistence',
        ordinal: 1,
        unlocked: true,
        unlockRule: { previousCorePct: 0, level: 1, staticLock: false },
        progress: { coreDone: 0, coreTotal: 2 },
        quests: [
          { id: 91, kind: 'study-quest', title: 'organized-experiment-cli-to-do-manager', repo: 'organized-experiment-cli-to-do-manager', rank: 11, unitId: 601, state: 'pending', core: true, contentPending: true, twinRepo: null, inProgress: false, prerequisites: [] },
          { id: 92, kind: 'study-quest', title: 'organized-experiment-quiz-engine', repo: 'organized-experiment-quiz-engine', rank: 13, unitId: 602, state: 'pending', core: true, contentPending: true, twinRepo: null, inProgress: false, prerequisites: [] },
        ],
      },
      {
        id: 10,
        title: 'Money & validation',
        theme: 'BigDecimal money, input validation, CRUD with safe persistence',
        ordinal: 2,
        unlocked: false,
        unlockRule: { previousCorePct: 80, level: 4, staticLock: false },
        progress: { coreDone: 0, coreTotal: 1 },
        quests: [{ id: 93, kind: 'study-quest', title: 'j5', repo: 'j5', rank: 212, unitId: 603, state: 'locked', core: true, contentPending: true, twinRepo: null, inProgress: false, prerequisites: [] }],
      },
      {
        id: 11,
        title: 'Domain rules & consistency',
        theme: 'business rules, state transitions, history and atomic writes, regression tests',
        ordinal: 3,
        unlocked: false,
        unlockRule: { previousCorePct: 80, level: 8, staticLock: false },
        progress: { coreDone: 0, coreTotal: 1 },
        quests: [{ id: 94, kind: 'study-quest', title: 'j7', repo: 'j7', rank: 275, unitId: 604, state: 'locked', core: true, contentPending: true, twinRepo: null, inProgress: false, prerequisites: [] }],
      },
    ],
  },
};

/**
 * A LOCKED track's campaign (createMockApi({ lockedTracks })): the server still supports a locked
 * track and a statically locked act with inert quests (no unitId); no shipped track uses it since
 * Java unlocked, so the lock rendering is tested against this fixture.
 */
export const lockedCampaignFixtures: Partial<Record<TrackId, Omit<CampaignResponse, 'level'>>> = {
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
        progress: { coreDone: 0, coreTotal: 2 },
        // inert quests: no unitId, never playable (a statically locked act)
        quests: [
          { id: 91, kind: 'study-quest', title: 'Java language tour', repo: 'javatrain', rank: 1, state: 'locked', core: true, contentPending: true, twinRepo: null, inProgress: false, prerequisites: [] },
          { id: 92, kind: 'study-quest', title: 'Spring Boot REST service', repo: 'springdesk', rank: 2, state: 'locked', core: true, contentPending: true, twinRepo: null, inProgress: false, prerequisites: [91] },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------- W8 study quests

export interface StudyQuestFixture {
  unit: UnitSummary;
  /** PUBLIC half (reading list + questions with choices) */
  public: StudyQuestPublic;
  /** PRIVATE: choice index per question (never leaves through getUnit / submit) */
  keys: number[];
}

export const studyQuestFixtures: Record<string, StudyQuestFixture> = {
  '206': {
    unit: { id: 206, key: 'campaign/csharp/borrowbox', trackId: 'csharp', kind: 'study', title: 'Study quest: borrowbox', difficulty: 2, state: 'available', revealed: false, prerequisites: [] },
    public: {
      repo: 'borrowbox',
      sha: '0123456789abcdef0123456789abcdef01234567',
      passPct: 80,
      readingSteps: [
        { key: 'seed:quests:borrowbox/reading-step/a1', title: 'Concepts: locking a loan', headingPath: ['Concepts', 'Locking a loan'], path: 'docs/02-CONCEPTS.md', lines: { start: 40, end: 72 }, url: 'https://github.com/elirc/borrowbox/blob/0123456789abcdef0123456789abcdef01234567/docs/02-CONCEPTS.md#L40-L72' },
        { key: 'seed:quests:borrowbox/reading-step/a2', title: 'API: the loans endpoint', headingPath: ['API', 'Loans'], path: 'docs/03-API.md', lines: { start: 1, end: 30 }, url: 'https://github.com/elirc/borrowbox/blob/0123456789abcdef0123456789abcdef01234567/docs/03-API.md#L1-L30' },
      ],
      questions: [
        { itemKey: 'seed:quests:borrowbox/quiz/q1', prompt: 'Which object does LoanService lock on?', choices: ['the service', 'the item being lent', 'a static gate'] },
        { itemKey: 'seed:quests:borrowbox/quiz/q2', prompt: 'What does POST /loans answer for an item already on loan?', choices: ['200', '409', '404'] },
        { itemKey: 'seed:quests:borrowbox/quiz/q3', prompt: 'Where is the due date computed?', choices: ['the controller', 'the domain', 'the database'] },
        { itemKey: 'seed:quests:borrowbox/quiz/q4', prompt: 'Which test proves double-lending is refused?', choices: ['LoanTests.Twice', 'ItemTests.New', 'none'] },
        { itemKey: 'seed:quests:borrowbox/quiz/q5', prompt: 'What does a return of an unknown loan id produce?', choices: ['404', '500', '204'] },
      ],
      flashcards: 2,
    },
    keys: [1, 1, 1, 0, 0],
  },
};
