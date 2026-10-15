// B4: written-unit fixtures for the mock API (immutable answer first, then the model answer).
// The public half (unit, instructions, starter) is what GET /units/:id serves; the private half
// (modelAnswer, rubric) only ever leaves the mock through getModelAnswer AFTER an answer exists,
// exactly as the server does. The rubric is private too: a rubric line can quote the key.

import type { CompetencyId, UnitSummary } from '../types';

export interface WrittenFixture {
  unit: UnitSummary;
  code: string | null;
  competencies: CompetencyId[];
  instructions: string;
  starter: string | null;
  /** PRIVATE: served by getModelAnswer only, after the learner's answer is recorded */
  modelAnswer: string;
  /** PRIVATE until answered (GET /units/:id serves rubric: null before that) */
  rubric: { id: string; label: string }[];
}

export const writtenFixtures: Record<string, WrittenFixture> = {
  '112': {
    unit: { id: 112, key: 'jstrain/quiz-14-mixed-gauntlet/q45', trackId: 'js', kind: 'written', title: 'Spot the bug: a sort comparator', difficulty: 2, state: 'available', revealed: false, prerequisites: [] },
    code: 'JS-W-45',
    competencies: ['code-reading'],
    instructions: 'What is wrong with this comparator, and what is the rule it breaks?\n\n```js\nitems.sort((a, b) => a.score > b.score);\n```\n\nAnswer in your own words: name the bug, then the rule.',
    starter: null,
    modelAnswer:
      '**It returns a boolean, which converts to `1` or `0`, so it never says "a comes first", and the result is implementation-defined.**\n\nA comparator must return a *number*: negative to put `a` first, positive to put `b` first, zero for equal. Here:\n\n```js\nitems.sort((a, b) => a.score - b.score);\n```',
    rubric: [
      { id: 'answer', label: 'Gives the key answer: it returns a boolean (`1` or `0`), never a negative number, so the order is implementation-defined.' },
      { id: 'why', label: 'Names the underlying rule or reason, not just the result' },
    ],
  },
  '113': {
    unit: { id: 113, key: 'bootforge/engineering-practice/practice/reviews/review-task-patch', trackId: 'js', kind: 'written', title: 'Review a cross-organization task update', difficulty: 3, state: 'available', revealed: false, prerequisites: [] },
    code: 'JS-W-RV1',
    competencies: ['code-reading', 'communication'],
    instructions:
      'You review PR #42. Auth middleware verifies a session and sets `req.user={id,orgId}`. A task belongs to exactly one org.\nMembers may edit title/done of tasks in their own org; callers cannot reassign ownership.\n\nProposed handler (line numbers are part of the review):\n1 app.patch(\'/tasks/:id\', requireSession, async (req,res) => {\n2   const task = await repo.findOne({id:req.params.id});\n3   if (!task) return res.status(404).json({error:\'not found\'});\n4   const updated = await repo.updateOne({id:task.id}, req.body);\n5   return res.json(updated);\n6 });\n\nWrite a review with blocking findings, one concrete exploit scenario, and a merge recommendation.',
    starter: 'Recommendation:\n\nBlocking findings and evidence:\n\nRegression tests:\n',
    modelAnswer:
      'Recommendation: **request changes**.\n\nBlocking: line 2 looks the task up by id alone, so a member of org B can read and patch org A\'s task (cross-org IDOR). Line 4 passes `req.body` straight through, so `orgId` and `id` can be reassigned (mass assignment).\n\nFix: scope both predicates with `orgId: req.user.orgId` and allow-list `title` / `done`.',
    rubric: [
      { id: 'scope', label: 'Identifies the cross-org exploit at the unscoped lookup AND update.' },
      { id: 'allowlist', label: 'Explains mass assignment and proposes a validated title/done allowlist.' },
      { id: 'decision', label: 'Requests changes for concrete security reasons.' },
    ],
  },
};
