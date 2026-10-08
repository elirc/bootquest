/**
 * The hand-reviewable campaign seed data (spec §3.3 + estate-contract §1.4/§1.5).
 * Everything here is part of the seeder fingerprint: editing it changes the
 * stamp, so the committed content/campaign packs must be re-seeded.
 *
 * Spec act lists are THEMED BUCKETS, not INDEX order (LEARNING.md R2): the
 * named anchors pin a repo to an act; every other study/skim repo on the
 * track is placed by the track's difficulty/kind band rule; inside an act
 * quests are ordered by INDEX rank.
 */

export type CampaignTrack = 'js' | 'csharp' | 'java';

/** stack -> V1 track. python / other have no V1 track (reported, never silently dropped). */
export const TRACK_FOR_STACK: Readonly<Record<string, CampaignTrack | null>> = {
  js: 'js',
  'ts-react-node': 'js',
  'csharp-dotnet': 'csharp',
  java: 'java',
  python: null,
  other: null,
};

/** Fraction of the previous act's CORE quests that must be done (spec §3.3). */
export const UNLOCK_PCT = 0.8;

/**
 * Minimum global level to ENTER an act (level curve 150·n^1.6, engines/level.ts):
 *   act 1 L1 (0 XP) · act 2 L4 (869 XP) · act 3 L8 (3,360) · act 4 L12 (6,967) · act 5 L16 (11,400).
 * The level is GLOBAL (both tracks + drills + reviews feed it). A study-quest pass pays
 * 50 XP, so 80% of JS act 1's 15 core quests is ~600 XP of quests alone, plus the drills
 * done alongside: L4 trails the 80% gate rather than dominating it. Later thresholds
 * grow with the act sizes; their job is to stop a track being raced through on one
 * act's quests without the daily practice the level reflects.
 */
export const UNLOCK_LEVELS: readonly [number, number, number, number, number] = [1, 4, 8, 12, 16];

export interface ActSpec {
  actNo: 1 | 2 | 3 | 4 | 5;
  title: string;
  theme: string;
  /** spec-named anchor repos (exact upskillorder names) pinned to this act */
  anchors: readonly string[];
}

export const JS_ACTS: readonly ActSpec[] = [
  {
    actNo: 1,
    title: 'Foundations',
    theme: 'grok-js, jstrain, finance-dashboard, trainjs, ship-it',
    // "jstrain" is not an INDEX name: jstrain2.2 (19) + 1jstrain2.2v2 (16) (estate-contract §0.3)
    anchors: ['grok-js', 'jstrain2.2', '1jstrain2.2v2', 'finance-dashboard', 'trainjs', 'ship-it'],
  },
  {
    actNo: 2,
    title: 'Building',
    theme: 'jsprojectlearn, newcodexjs, drill banks',
    // drill banks = START-HERE spine #4 + the daily-rep packs (jsdrill_sync is a skip verdict; jsdrillv2 wins its family)
    anchors: ['jsprojectlearn', 'newcodexjs', 'organized-js-training-react', 'jsdrillv2', 'unionboot'],
  },
  {
    actNo: 3,
    title: 'Products & teams',
    theme: 'relay-upskilling, signalpost, gitvg-astra, lucasrouter',
    anchors: ['relay-upskilling', 'signalpost-swe-bootcamp', 'gitvg-astra', 'lucasrouter'],
  },
  {
    actNo: 4,
    title: 'Flagship courses',
    theme: 'tracer -> harbor -> pulse, gitjira, spot-the-fix twin pairs',
    anchors: ['tracer', 'harbor', 'pulse', 'gitjira'],
  },
  {
    actNo: 5,
    title: 'Mastery',
    theme: 'skillforgejs, opusorganize guides, organized-study-* clone studies',
    anchors: ['skillforgejs', 'opusorganize'],
  },
];

export const CSHARP_ACTS: readonly ActSpec[] = [
  { actNo: 1, title: 'Foundations', theme: 'csbootcamp, csharp-tut, borrowbox', anchors: ['csbootcamp', 'csharp-tut', 'borrowbox'] },
  {
    actNo: 2,
    title: 'First APIs',
    theme: 'organized-dotnet-pastebin/trello, nettrello, dotnet-snapshot diff-reading',
    anchors: ['organized-dotnet-pastebin', 'organized-dotnet-trello', 'nettrello', 'dotnet-snapshot'],
  },
  {
    actNo: 3,
    title: 'Real services',
    theme: 'meterforge, harbor-swe-bootcamp, netcleanarch, nethris, campusops',
    anchors: ['meterforge-upskilling', 'meterforge', 'harbor-swe-bootcamp', 'netcleanarch', 'nethris', 'campusops'],
  },
  { actNo: 4, title: 'Flagship', theme: 'atlas 15-sprint course, *-net rebuilds, netgum/netzen', anchors: ['atlas', 'netgum', 'netzen'] },
  { actNo: 5, title: 'Mastery', theme: 'netopen1 eShop curriculum, buildsql, csharp-interview vault', anchors: ['netopen1', 'buildsql', 'csharp-interview'] },
];

export const JAVA_ACT = {
  actNo: 1 as const,
  title: 'Java (locked placeholder)',
  theme: 'the four ranked beginner Java repos; the Java track is greyed out in V1',
};

/** "the four" = the four lowest-ranked Java study repos, ranks 11-14 (estate-contract §0.5). */
export const JAVA_PLACEHOLDER: readonly string[] = [
  'organized-experiment-cli-to-do-manager',
  'organized-experiment-library-book-tracker',
  'organized-experiment-quiz-engine',
  'organized-experiment-src',
];

/** Spec anchors whose assessed stack points elsewhere: the spec's explicit act list wins. */
export function anchorTrack(name: string): CampaignTrack | null {
  if (JS_ACTS.some((a) => a.anchors.includes(name))) return 'js';
  if (CSHARP_ACTS.some((a) => a.anchors.includes(name))) return 'csharp';
  return null;
}

export interface Placeable {
  name: string;
  stack: string;
  kind: string;
  difficulty: number;
}

/** Act + reason for a JS-track repo that no anchor pins (estate-contract §1.4.3 bands). */
export function placeJs(r: Placeable): [act: number, placement: string] {
  if (/^organized-study-/.test(r.name) && r.kind === 'clone-study') return [5, 'anchor:organized-study-* clone studies'];
  if (r.kind === 'clone-study') return [5, 'rule:clone-study'];
  if (r.kind === 'curriculum-docs' && r.difficulty >= 4) return [5, 'rule:d4+ curriculum-docs'];
  const practice = r.kind === 'exercise-pack' || r.kind === 'course' || r.kind === 'curriculum-docs';
  switch (r.difficulty) {
    case 1:
      return [1, 'rule:d1'];
    case 2:
      return practice ? [1, 'rule:d2 exercise-pack/course/docs'] : [2, 'rule:d2 app'];
    case 3:
      return r.kind === 'exercise-pack' || r.kind === 'curriculum-docs' ? [2, 'rule:d3 exercise-pack/docs'] : [3, 'rule:d3 app/course'];
    case 4:
      // d4 apps are capstone-grade: with them in act 3 that act held ~120 quests and act 4 ~20
      return [4, 'rule:d4 app/course'];
    default:
      return [4, 'rule:d5'];
  }
}

/** Act + reason for a C#-track repo that no anchor pins. */
export function placeCsharp(r: Placeable): [act: number, placement: string] {
  if (/-net$/.test(r.name)) return [4, 'anchor:*-net rebuilds'];
  switch (r.difficulty) {
    case 1:
    case 2:
      return r.kind === 'app' || r.kind === 'api' ? [2, 'rule:d1-2 app/api'] : [1, 'rule:d1-2 practice'];
    case 3:
      return [3, 'rule:d3'];
    case 4:
      return [4, 'rule:d4'];
    default:
      return [5, 'rule:d5'];
  }
}

// ---------------------------------------------------------------- template families (START-HERE + estate-contract §1.5)

export interface FamilySpec {
  id: string;
  rule: string;
  member(name: string): boolean;
  /** the named picks; every other study/skim member is absent ('family-sampled') */
  picks: readonly string[];
}

export const FAMILIES: readonly FamilySpec[] = [
  {
    id: 'astraupskill-e-d',
    rule: '~20 e*/d* repos sharing one 9-13 file astraupskill course -> finance-dashboard, e15, e12, e20',
    member: (n) => /^[de]\d+$/.test(n) || n === 'finance-dashboard',
    picks: ['finance-dashboard', 'e15', 'e12', 'e20'],
  },
  {
    id: 'ww-crud',
    rule: '~60 w*/ww*/x*/z*/zz* Desktop-backup CRUD apps with a 7-chapter fix course -> the batch-7 picks',
    member: (n) => /^(w|ww|x|z|zz)\d+$/.test(n),
    picks: ['w22', 'ww18', 'ww19', 'ww27', 'ww29', 'ww35', 'ww39', 'ww4', 'ww7', 'zz1', 'zz8'],
  },
  {
    id: 'organized-experiment',
    rule: '~40 organized-experiment-* learning-mode scaffolds -> the batch-5 picks by domain',
    member: (n) => n.startsWith('organized-experiment-'),
    picks: [
      'organized-experiment-support-hub',
      'organized-experiment-ww10',
      'organized-experiment-ww43',
      'organized-experiment-idempotent-payments-lab',
      'organized-experiment-lock-orchestrator-lab',
      'organized-experiment-temporal-lite-orchestrator',
      'organized-experiment-ww45',
    ],
  },
  {
    id: 'newcodex3',
    rule: '~25 newcodex3-NN-* folder copies -> the umbrella repo only',
    member: (n) => /^newcodex3(-.+)?$/.test(n),
    picks: ['newcodex3'],
  },
  { id: 'dynamo', rule: '37 dynamo-* expert benchmark tasks -> never', member: (n) => n.startsWith('dynamo-'), picks: [] },
  { id: 'jsdrill', rule: 'jsdrillv2 over jsdrill*', member: (n) => n.startsWith('jsdrill'), picks: ['jsdrillv2'] },
];

/** 3build* over build*: buildX is a family member whenever 3buildX exists (computed per input set). */
export const BUILD_FAMILY_RULE = '3build* over build*: build<X> absent whenever 3build<X> exists';

/**
 * Spot-the-fix twin pairs (estate-contract §1.5, spec JS act 4): canonical X vs
 * its organized-experiment-X snapshot, seeded as ONE reading step on the
 * canonical repo (the pair is read against each other), outside family sampling.
 */
export const TWIN_PAIRS: readonly string[] = ['ww48', 'ww49', 'zz6', 'zz7', 'ww13', 'ww17', 'zz4'];
export const TWIN_ACT = 4;
