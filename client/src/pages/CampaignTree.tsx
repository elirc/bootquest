// B3: the Campaign page's skill-tree view (spec §6.1 / §10 "campaign map / skill tree per track").
// Layout and navigation math are pure (lib/skilltree.ts); this file only renders them.
//
// Honesty: the tree renders ONLY the GET /tracks/:id/campaign payload (titles, kinds,
// derived states) — exactly what the list view shows. A locked node is never a link
// and nothing the locked-act gate withholds (quiz, checks, starter, refs) is fetched.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { CampaignActDto, CampaignQuestDto } from '../api/types';
import { Icon } from '../components/Icon';
import { toRoman } from '../lib/format';
import {
  GEOM,
  defaultExpanded,
  isNavKey,
  layoutTree,
  neighbor,
  questActionable,
  type ActBox,
  type QuestBox,
  type QuestNodeState,
} from '../lib/skilltree';

// ---------------------------------------------------------------- view toggle (persisted)

export type CampaignViewMode = 'list' | 'tree';
export const CAMPAIGN_VIEW_KEY = 'bootquest:campaign-view';

function readView(): CampaignViewMode {
  try {
    return window.localStorage.getItem(CAMPAIGN_VIEW_KEY) === 'tree' ? 'tree' : 'list';
  } catch {
    return 'list'; // storage blocked (private mode, sandbox): the default view, nothing persisted
  }
}

/** The list/tree choice, remembered across visits in localStorage (failures are ignored). */
export function useCampaignView(): [CampaignViewMode, (v: CampaignViewMode) => void] {
  const [view, setView] = useState<CampaignViewMode>(readView);
  const set = useCallback((v: CampaignViewMode) => {
    setView(v);
    try {
      window.localStorage.setItem(CAMPAIGN_VIEW_KEY, v);
    } catch {
      /* not persisted; the in-memory choice still applies */
    }
  }, []);
  return [view, set];
}

export function ViewToggle({ view, onChange }: { view: CampaignViewMode; onChange: (v: CampaignViewMode) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Campaign view">
      {(['list', 'tree'] as const).map((v) => (
        <button key={v} type="button" className="btn btn-sm" aria-pressed={view === v} onClick={() => onChange(v)}>
          <Icon name={v === 'list' ? 'map' : 'grid'} size={14} />
          {v === 'list' ? 'List' : 'Tree'}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the tree

const QUEST_LABEL: Record<QuestNodeState, string> = {
  done: 'Done',
  'in-progress': 'In progress',
  available: 'Available',
  pending: 'Content pending',
  locked: 'Locked',
};

const FALLBACK_WIDTH = 960; // jsdom / first paint before the box is measured

/**
 * The tree box's width. `measured` turns true once the box has been measured (or found
 * unmeasurable, as in jsdom): until then the layout is the FALLBACK_WIDTH guess, and any node
 * position read from it (a scroll target) is wrong at phone width.
 */
function useWidth(ref: RefObject<HTMLElement>): { width: number; measured: boolean } {
  const [state, setState] = useState({ width: FALLBACK_WIDTH, measured: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setState((prev) => {
        const width = w > 0 ? w : prev.width;
        return prev.measured && prev.width === width ? prev : { width, measured: true };
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return state;
}

export function SkillTree({
  acts,
  trackLocked,
  level,
  targetQuestId,
}: {
  acts: readonly CampaignActDto[];
  trackLocked: boolean;
  level: number;
  /** W11: a quest to reveal (its act is expanded), focus and mark — the Campaign page's `?unit=` target */
  targetQuestId?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { width, measured } = useWidth(boxRef);
  const targetAct = targetQuestId === undefined ? undefined : acts.find((a) => a.quests.some((q) => q.id === targetQuestId));
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const open = defaultExpanded(acts);
    if (targetAct) open.add(targetAct.id);
    return open;
  });
  const layout = useMemo(() => layoutTree(acts, { width, expanded }), [acts, width, expanded]);
  const actById = useMemo(() => new Map(acts.map((a) => [a.id, a])), [acts]);
  const questById = useMemo(() => new Map(acts.flatMap((a) => a.quests.map((q) => [q.id, q] as const))), [acts]);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState<string>(() => {
    if (targetAct) return `q:${targetQuestId}`;
    const first = layout.quests.find((q) => q.state === 'in-progress' || q.state === 'available');
    return first?.key ?? layout.rows[0]?.[0] ?? '';
  });
  const pendingFocus = useRef<string | null>(targetAct ? `q:${targetQuestId}` : null);

  // a collapsed act drops its cards: the roving stop falls back to that act's gate
  const allKeys = useMemo(() => new Set(layout.rows.flat()), [layout]);
  const activeKey = allKeys.has(active) ? active : (() => {
    const q = Number(active.slice(2));
    const owner = acts.find((a) => a.quests.some((x) => x.id === q));
    return owner ? `a:${owner.id}` : layout.rows[0]?.[0] ?? '';
  })();

  useEffect(() => {
    // wait for the measured-width layout: scrolling to a node placed by the fallback layout
    // left a phone-width target ~2,000px below the fold once the real layout settled (W11 fix)
    if (pendingFocus.current === null || !measured) return;
    const el = nodes.current.get(pendingFocus.current);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: 'center' });
    pendingFocus.current = null;
  });

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !isNavKey(e.key)) return;
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-node]')?.dataset.node;
    if (!from) return;
    const to = neighbor(layout, from, e.key);
    e.preventDefault();
    if (!to) return;
    setActive(to);
    const el = nodes.current.get(to);
    if (el) el.focus();
    else pendingFocus.current = to;
  };

  const register = (key: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(key, el);
    else nodes.current.delete(key);
  };

  const narrow = layout.cols === 1;
  return (
    <div className={`skilltree${narrow ? ' skilltree-narrow' : ''}${trackLocked ? ' skilltree-locked' : ''}`} ref={boxRef}>
      <div className="tree-bar">
        <Legend />
        <div className="tree-bar-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded(new Set(acts.map((a) => a.id)))}>
            Expand all
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded(new Set())}>
            Collapse all
          </button>
        </div>
      </div>
      <div
        className="tree-canvas"
        role="group"
        aria-label="Skill tree: arrow keys move between nodes, Enter opens a quest or expands an act"
        style={{ height: layout.height }}
        onKeyDown={onKeyDown}
        data-testid="skilltree"
        data-cols={layout.cols}
      >
        <svg className="tree-edges" width={layout.width} height={layout.height} aria-hidden="true" focusable="false">
          <defs>
            <marker id="tree-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" className="tree-arrow-head" />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            <path
              key={`${edge.kind}:${edge.from}>${edge.to}`}
              d={edge.d}
              className={`edge edge-${edge.kind}${edge.open ? ' edge-open' : ''}`}
              data-edge={edge.kind}
              data-from={edge.from}
              data-to={edge.to}
              markerEnd={edge.kind === 'prereq' ? 'url(#tree-arrow)' : undefined}
            />
          ))}
        </svg>
        {layout.acts.map((box) => {
          const act = actById.get(box.id)!;
          return (
            <ActNode
              key={box.key}
              box={box}
              act={act}
              level={level}
              width={layout.width}
              headH={layout.headH}
              tabIndex={box.key === activeKey ? 0 : -1}
              nodeRef={register(box.key)}
              onFocus={() => setActive(box.key)}
              onToggle={() => toggle(box.id)}
            />
          );
        })}
        {layout.quests.map((box) => {
          const quest = questById.get(box.id)!;
          const act = actById.get(box.actId)!;
          return (
            <QuestNode
              key={box.key}
              box={box}
              quest={quest}
              actUnlocked={act.unlocked}
              target={box.id === targetQuestId}
              tabIndex={box.key === activeKey ? 0 : -1}
              nodeRef={register(box.key)}
              onFocus={() => setActive(box.key)}
            />
          );
        })}
      </div>
    </div>
  );
}

function unlockLine(act: CampaignActDto, level: number): string | null {
  if (act.unlocked) return null;
  const r = act.unlockRule;
  if (r.staticLock) return 'locked: content arrives after V1';
  const parts: string[] = [];
  if (r.previousCorePct > 0) parts.push(`${r.previousCorePct}% of act ${act.ordinal - 1} core`);
  if (r.level > 1) parts.push(level >= r.level ? `level ${r.level} (reached)` : `level ${r.level} (you: ${level})`); // W11: met = reached
  return parts.length ? `unlocks at ${parts.join(' + ')}` : null;
}

function ActNode({
  box,
  act,
  level,
  width,
  headH,
  tabIndex,
  nodeRef,
  onFocus,
  onToggle,
}: {
  box: ActBox;
  act: CampaignActDto;
  level: number;
  width: number;
  headH: number;
  tabIndex: number;
  nodeRef: (el: HTMLElement | null) => void;
  onFocus: () => void;
  onToggle: () => void;
}) {
  const r = GEOM.gateD / 2;
  const { coreDone, coreTotal } = act.progress;
  const n = act.quests.length;
  const gate = unlockLine(act, level);
  const stateText = { locked: 'locked', open: 'unlocked', 'in-progress': 'in progress', complete: 'complete' }[box.state];
  const label = `Act ${act.ordinal}: ${act.title}, ${stateText}, core ${coreDone} of ${coreTotal}, ${n} quest${n === 1 ? '' : 's'}${gate ? `, ${gate}` : ''}`;
  return (
    <>
      <button
        type="button"
        ref={nodeRef}
        className={`tree-gate tree-gate-${box.state}`}
        style={{ left: box.cx - r, top: box.cy - r, width: GEOM.gateD, height: GEOM.gateD }}
        aria-expanded={box.expanded}
        aria-label={label}
        data-node={box.key}
        tabIndex={tabIndex}
        onFocus={onFocus}
        onClick={onToggle}
      >
        {box.state === 'locked' ? <Icon name="lock" size={14} /> : box.state === 'complete' ? <Icon name="check" size={16} /> : toRoman(act.ordinal)}
      </button>
      <div className={`tree-act-head tree-act-${box.state}`} style={{ left: GEOM.left, top: box.y, width: width - GEOM.left, height: headH }} aria-hidden="true">
        <span className="tree-act-title">
          Act {act.ordinal}: {act.title}
        </span>
        <span className="tree-act-meta">
          core {coreDone}/{coreTotal} · {n} quest{n === 1 ? '' : 's'}
          {gate && <span className="tree-act-gate"> · {gate}</span>}
          {!box.expanded && n > 0 && <span className="tree-act-hint"> · collapsed</span>}
        </span>
      </div>
      {box.expanded && n === 0 && (
        <p className="tree-act-empty" style={{ left: GEOM.left, top: box.y + headH }}>
          No quests seeded in this act yet.
        </p>
      )}
    </>
  );
}

function QuestNode({
  box,
  quest,
  actUnlocked,
  target = false,
  tabIndex,
  nodeRef,
  onFocus,
}: {
  box: QuestBox;
  quest: CampaignQuestDto;
  actUnlocked: boolean;
  target?: boolean;
  tabIndex: number;
  nodeRef: (el: HTMLElement | null) => void;
  onFocus: () => void;
}) {
  const style = { left: box.x, top: box.y, width: box.w, height: box.h };
  const cls = `tree-quest tree-q-${box.state}${target ? ' tree-q-target' : ''}`;
  const meta = quest.kind === 'reading' ? 'reading' : quest.core ? 'core' : 'optional';
  const body = (
    <>
      <span className={`tree-marker tree-marker-${box.state}`} aria-hidden="true">
        {box.state === 'done' && <Icon name="check" size={11} />}
        {box.state === 'locked' && <Icon name="lock" size={10} />}
        {box.state === 'in-progress' && <Icon name="dot" size={12} />}
      </span>
      <span className="tree-q-text">
        <span className="tree-q-title">{quest.title}</span>
        <span className="tree-q-meta">
          {meta}
          {quest.contentPending && <span className="tree-badge">content pending</span>}
        </span>
      </span>
      <span className="sr-only">, {QUEST_LABEL[box.state]}</span>
    </>
  );
  const common = {
    ref: nodeRef,
    className: cls,
    style,
    title: `${quest.title} (${quest.repo})`,
    'data-node': box.key,
    'data-step': '',
    'data-state': quest.state,
    'data-quest': quest.id,
    'aria-current': target ? ('location' as const) : undefined,
    tabIndex,
    onFocus,
  };
  return questActionable(quest, actUnlocked) ? (
    <Link to={`/play/${quest.unitId}`} {...common}>
      {body}
    </Link>
  ) : (
    <div {...common} aria-disabled="true">
      {body}
    </div>
  );
}

function Legend() {
  const items: [QuestNodeState, string][] = [
    ['done', 'Done'],
    ['in-progress', 'In progress'],
    ['available', 'Available'],
    ['pending', 'Content pending'],
    ['locked', 'Locked'],
  ];
  return (
    <ul className="tree-legend" aria-label="Legend">
      {items.map(([s, label]) => (
        <li key={s}>
          <span className={`tree-marker tree-marker-${s}`} aria-hidden="true" />
          {label}
        </li>
      ))}
      <li>
        <svg width="22" height="10" aria-hidden="true" focusable="false">
          <path d="M1 5 H16" className="edge edge-prereq" />
          <path d="M14 1 L21 5 L14 9 z" className="tree-arrow-head" />
        </svg>
        Prerequisite
      </li>
    </ul>
  );
}
