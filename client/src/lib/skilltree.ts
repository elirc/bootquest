// B3 skill tree: PURE layout + navigation math for the Campaign page's tree view.
// No DOM, no React — everything here is unit-tested in skilltree.test.ts.
//
// Shape (per track): a vertical SPINE of act gates (the act chain: act N+1's gate
// hangs under act N's), and per EXPANDED act a BUS from its gate that every quest
// card of the act hangs off (all quests of an unlocked act are playable: the act
// gate is their one structural prerequisite). Quests sit in a grid of `cols`
// columns in rank order; at phone width cols = 1 and the act becomes a vertical
// path. unit_prerequisite edges (quest -> quest) are drawn on top; an end inside a
// collapsed act attaches to that act's gate instead.

import type { CampaignActDto, CampaignQuestDto } from '../api/types';

export type QuestNodeState = 'locked' | 'pending' | 'available' | 'in-progress' | 'done';
export type ActNodeState = 'locked' | 'open' | 'in-progress' | 'complete';

/** What a quest node shows. The act gate wins over everything except a recorded done. */
export function questNodeState(q: CampaignQuestDto, actUnlocked: boolean): QuestNodeState {
  if (q.state === 'done') return 'done';
  if (!actUnlocked || q.state === 'locked') return 'locked';
  if (q.state === 'pending') return 'pending';
  return q.inProgress ? 'in-progress' : 'available';
}

/** True only when the node may link to the player (same rule as the list view). */
export function questActionable(q: CampaignQuestDto, actUnlocked: boolean): boolean {
  return actUnlocked && q.state !== 'locked' && q.unitId !== undefined;
}

export function actNodeState(act: CampaignActDto): ActNodeState {
  if (!act.unlocked) return 'locked';
  const { coreDone, coreTotal } = act.progress;
  if (coreTotal > 0 && coreDone >= coreTotal) return 'complete';
  const touched = coreDone > 0 || act.quests.some((q) => q.state === 'done' || q.inProgress);
  return touched ? 'in-progress' : 'open';
}

/**
 * The acts open by default: every unlocked act that is not complete. If none
 * qualifies, the last unlocked act; if no act is unlocked, the first act (so a
 * locked track still shows its titles — titles are not withheld content).
 */
export function defaultExpanded(acts: readonly CampaignActDto[]): Set<number> {
  const sorted = [...acts].sort((a, b) => a.ordinal - b.ordinal);
  const open = sorted.filter((a) => a.unlocked && actNodeState(a) !== 'complete').map((a) => a.id);
  if (open.length > 0) return new Set(open);
  const unlocked = sorted.filter((a) => a.unlocked);
  if (unlocked.length > 0) return new Set([unlocked[unlocked.length - 1]!.id]);
  return new Set(sorted.length > 0 ? [sorted[0]!.id] : []);
}

// ---------------------------------------------------------------- geometry

export const GEOM = {
  /** act gate circle diameter; its centre sits on the spine */
  gateD: 40,
  spineX: 20,
  /** the bus runs down here, between the spine and the cards */
  busX: 52,
  /** left edge of the act header text and the quest cards */
  left: 68,
  headH: 56,
  /** phone: the act meta line may wrap to two lines */
  headHNarrow: 68,
  cardH: 66,
  /** phone: one-line titles, so shorter cards keep the vertical path compact */
  cardHNarrow: 50,
  /** preferred card width on wide layouts (cards stretch to fill the row) */
  cardW: 196,
  minCardW: 150,
  gapX: 12,
  gapY: 10,
  /** vertical gap between act blocks (the chain segment crosses it) */
  actGap: 28,
  /** height of the "no quests seeded" line inside an expanded empty act */
  emptyH: 32,
  /** at or below this width the tree is a single-column vertical path */
  narrowMax: 560,
  maxCols: 6,
} as const;

export function columnsFor(width: number): { cols: number; cardW: number } {
  const avail = Math.max(GEOM.minCardW, Math.floor(width) - GEOM.left);
  if (width <= GEOM.narrowMax) return { cols: 1, cardW: avail };
  const cols = Math.max(1, Math.min(GEOM.maxCols, Math.floor((avail + GEOM.gapX) / (GEOM.cardW + GEOM.gapX))));
  return { cols, cardW: Math.floor((avail - GEOM.gapX * (cols - 1)) / cols) };
}

export interface ActBox {
  key: string; // `a:<id>`
  id: number;
  ordinal: number;
  /** block top (gate top, header top) */
  y: number;
  /** gate centre */
  cx: number;
  cy: number;
  expanded: boolean;
  /** bottom of the whole act block */
  bottom: number;
  state: ActNodeState;
}

export interface QuestBox {
  key: string; // `q:<id>`
  id: number;
  actId: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  state: QuestNodeState;
}

export type EdgeKind = 'chain' | 'bus' | 'prereq';

export interface Edge {
  kind: EdgeKind;
  from: string;
  to: string;
  /** SVG path data */
  d: string;
  /** chain: the act it leads INTO is unlocked; bus: its act is unlocked; prereq: the prerequisite is done */
  open: boolean;
}

export interface TreeLayout {
  width: number;
  height: number;
  /** act header height used (taller on phones) */
  headH: number;
  cols: number;
  cardW: number;
  acts: ActBox[];
  quests: QuestBox[];
  edges: Edge[];
  /** navigation rows, top to bottom: each row is node keys left to right */
  rows: string[][];
}

export function layoutTree(acts: readonly CampaignActDto[], opts: { width: number; expanded: ReadonlySet<number> }): TreeLayout {
  const width = Math.max(GEOM.left + GEOM.minCardW, Math.floor(opts.width));
  const { cols, cardW } = columnsFor(width);
  const sorted = [...acts].sort((a, b) => a.ordinal - b.ordinal);
  const r = GEOM.gateD / 2;
  const headH = cols === 1 ? GEOM.headHNarrow : GEOM.headH;
  const cardH = cols === 1 ? GEOM.cardHNarrow : GEOM.cardH;
  const actBoxes: ActBox[] = [];
  const questBoxes: QuestBox[] = [];
  const edges: Edge[] = [];
  const rows: string[][] = [];
  const nodeOfQuest = new Map<number, QuestBox>();
  const actOfQuest = new Map<number, ActBox>();

  let y = 0;
  for (const act of sorted) {
    const expanded = opts.expanded.has(act.id);
    const box: ActBox = {
      key: `a:${act.id}`,
      id: act.id,
      ordinal: act.ordinal,
      y,
      cx: GEOM.spineX,
      cy: y + headH / 2,
      expanded,
      bottom: y + headH,
      state: actNodeState(act),
    };
    actBoxes.push(box);
    rows.push([box.key]);
    let bottom = y + headH;
    if (expanded && act.quests.length === 0) bottom += GEOM.emptyH;
    if (expanded && act.quests.length > 0) {
      const top = bottom + GEOM.gapY;
      const rowYs: number[] = [];
      act.quests.forEach((q, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const qx = GEOM.left + col * (cardW + GEOM.gapX);
        const qy = top + row * (cardH + GEOM.gapY);
        if (col === 0) {
          rowYs.push(qy + cardH / 2);
          rows.push([]);
        }
        const qb: QuestBox = {
          key: `q:${q.id}`,
          id: q.id,
          actId: act.id,
          row,
          col,
          x: qx,
          y: qy,
          w: cardW,
          h: cardH,
          cx: qx + cardW / 2,
          cy: qy + cardH / 2,
          state: questNodeState(q, act.unlocked),
        };
        questBoxes.push(qb);
        rows[rows.length - 1]!.push(qb.key);
        nodeOfQuest.set(q.id, qb);
      });
      const nRows = rowYs.length;
      bottom = top + nRows * cardH + (nRows - 1) * GEOM.gapY;
      // the bus: out of the gate's right side, down the bus line, one stub into each row
      const last = rowYs[rowYs.length - 1]!;
      const d = [`M ${GEOM.spineX + r} ${box.cy} H ${GEOM.busX} V ${last}`, ...rowYs.map((ry) => `M ${GEOM.busX} ${ry} H ${GEOM.left}`)].join(' ');
      edges.push({ kind: 'bus', from: box.key, to: box.key, d, open: act.unlocked });
    }
    for (const q of act.quests) actOfQuest.set(q.id, box);
    box.bottom = bottom;
    y = bottom + GEOM.actGap;
  }

  // the act chain: gate N bottom -> gate N+1 top, open when N+1 is unlocked
  for (let i = 0; i + 1 < actBoxes.length; i++) {
    const a = actBoxes[i]!;
    const b = actBoxes[i + 1]!;
    edges.push({ kind: 'chain', from: a.key, to: b.key, d: `M ${GEOM.spineX} ${a.cy + r} V ${b.cy - r}`, open: sorted[i + 1]!.unlocked });
  }

  // unit_prerequisite edges (deduped; an end in a collapsed act attaches to its gate)
  const seen = new Set<string>();
  const doneQuest = new Set(sorted.flatMap((a) => a.quests.filter((q) => q.state === 'done').map((q) => q.id)));
  const anchor = (questId: number): { key: string; x: number; top: number; bottom: number } | null => {
    const qb = nodeOfQuest.get(questId);
    if (qb) return { key: qb.key, x: qb.cx, top: qb.y, bottom: qb.y + qb.h };
    const ab = actOfQuest.get(questId);
    return ab ? { key: ab.key, x: ab.cx, top: ab.cy - r, bottom: ab.cy + r } : null;
  };
  for (const act of sorted) {
    for (const q of act.quests) {
      for (const p of q.prerequisites) {
        const from = anchor(p);
        const to = anchor(q.id);
        if (!from || !to || from.key === to.key) continue;
        const id = `${from.key}>${to.key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        edges.push({ kind: 'prereq', from: from.key, to: to.key, d: prereqPath(from, to), open: doneQuest.has(p) });
      }
    }
  }

  const height = actBoxes.length === 0 ? 0 : actBoxes[actBoxes.length - 1]!.bottom;
  return { width, height, headH, cols, cardW, acts: actBoxes, quests: questBoxes, edges, rows };
}

function prereqPath(from: { x: number; top: number; bottom: number }, to: { x: number; top: number; bottom: number }): string {
  // downward: bottom of the prerequisite -> top of the dependant; upward: the reverse ends
  const down = to.top >= from.bottom;
  const y1 = down ? from.bottom : from.top;
  const y2 = down ? to.top : to.bottom;
  const bend = Math.max(24, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
  return `M ${from.x} ${y1} C ${from.x} ${y1 + bend} ${to.x} ${y2 - bend} ${to.x} ${y2}`;
}

// ---------------------------------------------------------------- keyboard navigation

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export function isNavKey(k: string): k is NavKey {
  return k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End';
}

/**
 * The node a key moves focus to, or null to stay. Rows are visual rows (an act
 * gate is a row of its own). Left/Right walk within a row; Left from the first
 * card of a row returns to the act gate, Right from a gate enters its first card.
 * Up/Down move one row and keep the column as close as the target row allows.
 */
export function neighbor(layout: TreeLayout, from: string, key: NavKey): string | null {
  const all = layout.rows.flat();
  if (all.length === 0) return null;
  if (key === 'Home') return all[0]!;
  if (key === 'End') return all[all.length - 1]!;
  const ri = layout.rows.findIndex((row) => row.includes(from));
  if (ri === -1) return all[0]!;
  const row = layout.rows[ri]!;
  const ci = row.indexOf(from);
  const isGate = from.startsWith('a:');
  if (key === 'ArrowRight') {
    if (ci + 1 < row.length) return row[ci + 1]!;
    if (isGate) return layout.rows[ri + 1]?.[0]?.startsWith('q:') ? layout.rows[ri + 1]![0]! : null;
    return null;
  }
  if (key === 'ArrowLeft') {
    if (ci > 0) return row[ci - 1]!;
    if (isGate) return null;
    const actId = layout.quests.find((q) => q.key === from)?.actId;
    return actId === undefined ? null : `a:${actId}`;
  }
  const target = layout.rows[key === 'ArrowDown' ? ri + 1 : ri - 1];
  if (!target) return null;
  const col = isGate ? 0 : ci;
  return target[Math.min(col, target.length - 1)]!;
}
