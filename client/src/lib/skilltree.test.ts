import { describe, expect, it } from 'vitest';
import type { CampaignActDto, CampaignQuestDto } from '../api/types';
import { GEOM, actNodeState, columnsFor, defaultExpanded, layoutTree, neighbor, questActionable, questNodeState } from './skilltree';

let nextQuest = 1000;
function quest(over: Partial<CampaignQuestDto> = {}): CampaignQuestDto {
  const id = over.id ?? nextQuest++;
  return {
    id,
    kind: 'study-quest',
    title: `Quest ${id}`,
    repo: `repo-${id}`,
    rank: id,
    unitId: id + 50_000,
    state: 'available',
    core: true,
    contentPending: false,
    twinRepo: null,
    inProgress: false,
    prerequisites: [],
    ...over,
  };
}

function act(id: number, ordinal: number, quests: CampaignQuestDto[], over: Partial<CampaignActDto> = {}): CampaignActDto {
  return {
    id,
    title: `Act ${ordinal}`,
    theme: null,
    ordinal,
    unlocked: true,
    unlockRule: { previousCorePct: ordinal === 1 ? 0 : 80, level: 1, staticLock: false },
    progress: { coreDone: 0, coreTotal: quests.filter((q) => q.core).length },
    quests,
    ...over,
  };
}

const many = (n: number, over: Partial<CampaignQuestDto> = {}) => Array.from({ length: n }, () => quest(over));

describe('node states', () => {
  it('quest: done wins; a closed act or locked state is locked; pending stays pending; inProgress only on available', () => {
    expect(questNodeState(quest({ state: 'done' }), false)).toBe('done');
    expect(questNodeState(quest({ state: 'available' }), false)).toBe('locked');
    expect(questNodeState(quest({ state: 'available', inProgress: true }), false)).toBe('locked');
    expect(questNodeState(quest({ state: 'locked' }), true)).toBe('locked');
    expect(questNodeState(quest({ state: 'pending', inProgress: true }), true)).toBe('pending');
    expect(questNodeState(quest({ state: 'available', inProgress: true }), true)).toBe('in-progress');
    expect(questNodeState(quest({ state: 'available' }), true)).toBe('available');
  });

  it('quest is actionable only in an unlocked act, not locked, with a unit', () => {
    expect(questActionable(quest(), true)).toBe(true);
    expect(questActionable(quest(), false)).toBe(false);
    expect(questActionable(quest({ state: 'locked' }), true)).toBe(false);
    expect(questActionable(quest({ unitId: undefined }), true)).toBe(false);
  });

  it('act: locked / open / in-progress / complete', () => {
    expect(actNodeState(act(1, 1, many(2), { unlocked: false }))).toBe('locked');
    expect(actNodeState(act(1, 1, many(2)))).toBe('open');
    expect(actNodeState(act(1, 1, [quest({ inProgress: true }), quest()]))).toBe('in-progress');
    expect(actNodeState(act(1, 1, many(2), { progress: { coreDone: 1, coreTotal: 2 } }))).toBe('in-progress');
    expect(actNodeState(act(1, 1, many(2), { progress: { coreDone: 2, coreTotal: 2 } }))).toBe('complete');
    // zero core: never "complete" by vacuity
    expect(actNodeState(act(1, 1, [], { progress: { coreDone: 0, coreTotal: 0 } }))).toBe('open');
  });

  it('default expansion: unlocked, not-complete acts; else the last unlocked; else the first', () => {
    const a1 = act(1, 1, many(1), { progress: { coreDone: 1, coreTotal: 1 } });
    const a2 = act(2, 2, many(1));
    const a3 = act(3, 3, many(1), { unlocked: false });
    expect([...defaultExpanded([a3, a2, a1])]).toEqual([2]);
    expect([...defaultExpanded([a1, { ...a2, progress: { coreDone: 1, coreTotal: 1 } }, a3])]).toEqual([2]);
    expect([...defaultExpanded([{ ...a1, unlocked: false }, a3])]).toEqual([1]);
    expect([...defaultExpanded([])]).toEqual([]);
  });
});

describe('columnsFor', () => {
  it('is a single-column vertical path at phone width, filling the row', () => {
    expect(columnsFor(400)).toEqual({ cols: 1, cardW: 400 - GEOM.left });
    expect(columnsFor(GEOM.narrowMax).cols).toBe(1);
  });

  it('packs as many preferred-width cards as fit, capped, stretched to fill exactly', () => {
    for (const w of [600, 800, 1000, 1180, 2400]) {
      const { cols, cardW } = columnsFor(w);
      expect(cols).toBeGreaterThan(1);
      expect(cols).toBeLessThanOrEqual(GEOM.maxCols);
      expect(cardW).toBeGreaterThanOrEqual(GEOM.minCardW);
      expect(GEOM.left + cols * cardW + (cols - 1) * GEOM.gapX).toBeLessThanOrEqual(w);
    }
    expect(columnsFor(1180).cols).toBe(5);
  });
});

describe('layoutTree', () => {
  const big = [act(1, 1, many(44)), act(2, 2, many(74)), act(3, 3, many(10), { unlocked: false })];

  it('a 44-quest act fits a grid of rows of `cols`, in rank order, inside the width, no overlaps', () => {
    const l = layoutTree(big, { width: 1180, expanded: new Set([1]) });
    expect(l.cols).toBe(5);
    const qs = l.quests;
    expect(qs).toHaveLength(44);
    expect(qs.map((q) => q.id)).toEqual(big[0]!.quests.map((q) => q.id));
    expect(Math.max(...qs.map((q) => q.row))).toBe(Math.ceil(44 / 5) - 1);
    for (const q of qs) {
      expect(q.x).toBeGreaterThanOrEqual(GEOM.left);
      expect(q.x + q.w).toBeLessThanOrEqual(l.width);
    }
    for (let i = 0; i < qs.length; i++)
      for (let j = i + 1; j < qs.length; j++) {
        const a = qs[i]!;
        const b = qs[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
  });

  it('collapsed acts contribute only their header; blocks stack top to bottom with a gap', () => {
    const collapsed = layoutTree(big, { width: 1180, expanded: new Set() });
    expect(collapsed.quests).toHaveLength(0);
    expect(collapsed.acts.map((a) => a.y)).toEqual([0, GEOM.headH + GEOM.actGap, 2 * (GEOM.headH + GEOM.actGap)]);
    expect(collapsed.height).toBe(3 * GEOM.headH + 2 * GEOM.actGap);
    const open = layoutTree(big, { width: 1180, expanded: new Set([1, 2, 3]) });
    expect(open.quests).toHaveLength(128);
    for (let i = 0; i + 1 < open.acts.length; i++) expect(open.acts[i + 1]!.y).toBe(open.acts[i]!.bottom + GEOM.actGap);
    const last = open.quests[open.quests.length - 1]!;
    expect(open.height).toBe(last.y + last.h);
  });

  it('at 400px every act is a vertical path: one card per row, full width', () => {
    const l = layoutTree(big, { width: 400, expanded: new Set([1]) });
    expect(l.cols).toBe(1);
    expect(new Set(l.quests.map((q) => q.x))).toEqual(new Set([GEOM.left]));
    expect(l.quests.every((q) => q.x + q.w === 400)).toBe(true);
    expect(l.quests.map((q) => q.row)).toEqual(l.quests.map((_, i) => i));
    // phone geometry: taller act header (meta wraps), shorter one-line cards
    expect(l.headH).toBe(GEOM.headHNarrow);
    expect(l.quests.every((q) => q.h === GEOM.cardHNarrow)).toBe(true);
    expect(l.acts[0]!.cy).toBe(GEOM.headHNarrow / 2);
    const wide = layoutTree(big, { width: 1180, expanded: new Set([1]) });
    expect(wide.headH).toBe(GEOM.headH);
    expect(wide.quests.every((q) => q.h === GEOM.cardH)).toBe(true);
  });

  it('edges: one chain segment per consecutive act pair (open iff the target act is unlocked), one bus per expanded non-empty act', () => {
    const l = layoutTree(big, { width: 1180, expanded: new Set([1, 3]) });
    const chain = l.edges.filter((e) => e.kind === 'chain');
    expect(chain.map((e) => [e.from, e.to, e.open])).toEqual([
      ['a:1', 'a:2', true],
      ['a:2', 'a:3', false],
    ]);
    const bus = l.edges.filter((e) => e.kind === 'bus');
    expect(bus.map((e) => [e.from, e.open])).toEqual([
      ['a:1', true],
      ['a:3', false],
    ]);
    // the bus has one stub per row of cards
    const rows1 = Math.ceil(44 / l.cols);
    expect((bus[0]!.d.match(new RegExp(`H ${GEOM.left}`, 'g')) ?? []).length).toBe(rows1);
  });

  it('prerequisite edges connect quest cards; an end inside a collapsed act attaches to its gate; duplicates collapse', () => {
    const a = quest({ id: 1, state: 'done' });
    const b = quest({ id: 2, prerequisites: [1] });
    const c = quest({ id: 3, prerequisites: [1, 2] });
    const d = quest({ id: 4, prerequisites: [2, 999] }); // 999: not on this tree -> ignored
    const acts = [act(1, 1, [a, b]), act(2, 2, [c, d])];
    const open = layoutTree(acts, { width: 1180, expanded: new Set([1, 2]) });
    const pre = (l: ReturnType<typeof layoutTree>) => l.edges.filter((e) => e.kind === 'prereq').map((e) => [e.from, e.to, e.open]);
    expect(pre(open)).toEqual([
      ['q:1', 'q:2', true],
      ['q:1', 'q:3', true],
      ['q:2', 'q:3', false],
      ['q:2', 'q:4', false],
    ]);
    const half = layoutTree(acts, { width: 1180, expanded: new Set([1]) });
    expect(pre(half)).toEqual([
      ['q:1', 'q:2', true],
      ['q:1', 'a:2', true],
      ['q:2', 'a:2', false],
    ]);
    // both ends collapsed into one gate: no self-loop
    expect(pre(layoutTree([act(1, 1, [a, b])], { width: 1180, expanded: new Set() }))).toEqual([]);
  });

  it('prerequisite paths start and end on node edges (down: bottom -> top)', () => {
    const a = quest({ id: 1 });
    const b = quest({ id: 2, prerequisites: [1] });
    const l = layoutTree([act(1, 1, [a]), act(2, 2, [b])], { width: 1180, expanded: new Set([1, 2]) });
    const [qa, qb] = l.quests;
    const e = l.edges.find((x) => x.kind === 'prereq')!;
    expect(e.d.startsWith(`M ${qa!.cx} ${qa!.y + qa!.h} `)).toBe(true);
    expect(e.d.endsWith(` ${qb!.cx} ${qb!.y}`)).toBe(true);
  });

  it('an expanded act with no quests reserves its empty line and has no bus', () => {
    const l = layoutTree([act(1, 1, [])], { width: 800, expanded: new Set([1]) });
    expect(l.acts[0]!.bottom).toBe(GEOM.headH + GEOM.emptyH);
    expect(l.edges).toEqual([]);
  });
});

describe('neighbor (arrow-key navigation)', () => {
  const acts = [act(1, 1, many(7)), act(2, 2, many(2))];
  const l = layoutTree(acts, { width: 1000, expanded: new Set([1, 2]) }); // 4 columns
  const ids1 = acts[0]!.quests.map((q) => `q:${q.id}`);
  const ids2 = acts[1]!.quests.map((q) => `q:${q.id}`);

  it('rows: gate, then card rows of `cols`, per act', () => {
    expect(l.cols).toBe(4);
    expect(l.rows).toEqual([['a:1'], ids1.slice(0, 4), ids1.slice(4), ['a:2'], ids2]);
  });

  it('left/right walk a row; Left from the first card returns to the gate; Right from a gate enters its first card', () => {
    expect(neighbor(l, ids1[0]!, 'ArrowRight')).toBe(ids1[1]);
    expect(neighbor(l, ids1[3]!, 'ArrowRight')).toBeNull();
    expect(neighbor(l, ids1[1]!, 'ArrowLeft')).toBe(ids1[0]);
    expect(neighbor(l, ids1[4]!, 'ArrowLeft')).toBe('a:1');
    expect(neighbor(l, 'a:1', 'ArrowRight')).toBe(ids1[0]);
    expect(neighbor(l, 'a:1', 'ArrowLeft')).toBeNull();
  });

  it('up/down keep the column, clamp to shorter rows, and cross act boundaries via the gates', () => {
    expect(neighbor(l, 'a:1', 'ArrowDown')).toBe(ids1[0]);
    expect(neighbor(l, ids1[2]!, 'ArrowDown')).toBe(ids1[6]); // row 2 has 3 cards: clamp
    expect(neighbor(l, ids1[6]!, 'ArrowUp')).toBe(ids1[2]);
    expect(neighbor(l, ids1[6]!, 'ArrowDown')).toBe('a:2');
    expect(neighbor(l, 'a:2', 'ArrowUp')).toBe(ids1[4]);
    expect(neighbor(l, ids2[1]!, 'ArrowDown')).toBeNull();
    expect(neighbor(l, 'a:1', 'ArrowUp')).toBeNull();
  });

  it('Home / End jump to the first / last node; an unknown key restarts at the top', () => {
    expect(neighbor(l, ids1[3]!, 'Home')).toBe('a:1');
    expect(neighbor(l, 'a:1', 'End')).toBe(ids2[1]);
    expect(neighbor(l, 'q:-1', 'ArrowDown')).toBe('a:1');
  });

  it('collapsed acts are a single gate row: Down walks gate to gate', () => {
    const c = layoutTree(acts, { width: 1000, expanded: new Set() });
    expect(c.rows).toEqual([['a:1'], ['a:2']]);
    expect(neighbor(c, 'a:1', 'ArrowDown')).toBe('a:2');
    expect(neighbor(c, 'a:1', 'ArrowRight')).toBeNull();
  });

  it('at 400px Down walks the vertical path one quest at a time', () => {
    const n = layoutTree(acts, { width: 400, expanded: new Set([1]) });
    let at = 'a:1';
    const walk = [at];
    for (let i = 0; i < 9; i++) {
      const next = neighbor(n, at, 'ArrowDown');
      if (!next) break;
      walk.push((at = next));
    }
    expect(walk).toEqual(['a:1', ...ids1, 'a:2']);
  });
});
