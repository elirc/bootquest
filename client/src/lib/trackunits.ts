// Track unit browser (Campaign page "Practice units"): pure grouping / filtering over the
// GET /api/tracks/:id/units payload. Repo / module labels are derived from the unit key alone,
// so the browser never needs anything beyond what TrackUnitsResponse already carries.
import type { UnitKind, UnitSummary } from '../api/types';
import { fundTopicIdOf, isFundKey } from './fundamentals';

export type UnitSection = 'drill' | 'explain-back' | 'other' | 'fundamentals';

export const SECTION_LABEL: Record<UnitSection, string> = {
  drill: 'Drills',
  'explain-back': 'Explain-backs',
  other: 'Other',
  fundamentals: 'Fundamentals',
};

/** The kind-filter bucket a unit kind belongs to. */
export function sectionOf(kind: UnitKind): UnitSection {
  if (kind === 'drill') return 'drill';
  if (kind === 'explain-back') return 'explain-back';
  return 'other';
}

/** fund wave: a Fundamentals unit (topic or drill) is filtered as its own section, whatever its kind. */
export function sectionOfUnit(u: Pick<UnitSummary, 'kind' | 'key'>): UnitSection {
  return isFundKey(u.key) ? 'fundamentals' : sectionOf(u.kind);
}

/** `01-estimation` -> `estimation`, `js-fundamentals` -> `js fundamentals`. */
function prettify(segment: string): string {
  return segment
    .replace(/^\d+[-_]?/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The group a unit is listed under:
 *   `ladder/<kind>/<repo>/<hash>`  -> repo
 *   `gh:<owner>/<name>:<code>`     -> name
 *   `<root>/<module>/<slug>...`    -> prettified module (`sysdrills/01-estimation/01-qps` -> `estimation`)
 *   anything else                  -> the kind section label (`Drills`, `Explain-backs`, `Other`)
 */
export function groupLabelOf(u: Pick<UnitSummary, 'key' | 'kind'>): string {
  const fallback = SECTION_LABEL[sectionOf(u.kind)];
  const key = u.key;
  // fund wave: a topic and its drills share one group, numbered so the groups sort in ladder order
  const topic = fundTopicIdOf(key);
  if (topic) return `Fundamentals ${topic.slice(0, 2)} · ${prettify(topic)}`;
  if (key.startsWith('ladder/')) {
    const repo = key.split('/')[2]?.trim();
    return repo ? repo : fallback;
  }
  const gh = /^gh:[^/:]+\/([^/:]+):/.exec(key);
  if (gh?.[1]) return gh[1];
  const parts = key.split('/');
  if (parts.length >= 3) {
    const label = prettify(parts[1] ?? '');
    if (label) return label;
  }
  return fallback;
}

export interface UnitGroup {
  label: string;
  /** In served order. */
  units: UnitSummary[];
  /** How many of `units` are done. */
  done: number;
}

export interface UnitFilter {
  section: UnitSection | 'all';
  query: string;
  hideDone: boolean;
}

export const NO_FILTER: UnitFilter = { section: 'all', query: '', hideDone: false };

/** Unit counts per kind bucket (unfiltered) for the kind-filter buttons. */
export function sectionCounts(units: readonly UnitSummary[]): Record<UnitSection | 'all', number> {
  const counts = { all: units.length, drill: 0, 'explain-back': 0, other: 0, fundamentals: 0 };
  for (const u of units) counts[sectionOfUnit(u)]++;
  return counts;
}

/** Per-group done/total over the UNFILTERED list: the headers show these even while filters
 *  narrow the rows, so they always agree with the global "Showing X of Y · Z done" line. */
export function groupTotals(units: readonly UnitSummary[]): ReadonlyMap<string, { done: number; total: number }> {
  const totals = new Map<string, { done: number; total: number }>();
  for (const u of units) {
    const label = groupLabelOf(u);
    let t = totals.get(label);
    if (!t) {
      t = { done: 0, total: 0 };
      totals.set(label, t);
    }
    t.total++;
    if (u.state === 'done') t.done++;
  }
  return totals;
}

/**
 * f52 U14: the module number of a numbered drill module key (`sysdrills/01-estimation/01-qps` -> 1),
 * else null (ladder / gh: repo keys, Fundamentals keys, short keys, unnumbered modules).
 */
export function moduleNumberOf(key: string): number | null {
  if (key.startsWith('ladder/') || key.startsWith('gh:') || fundTopicIdOf(key) !== null) return null;
  const parts = key.split('/');
  if (parts.length < 3) return null;
  const m = /^(\d+)/.exec(parts[1] ?? '');
  return m ? Number(m[1]) : null;
}

export type GroupTier = 'core' | 'repo';

/** Section headings for a track without campaign acts. */
export function tierLabels(trackId: string): Record<GroupTier, string> {
  return { core: 'Core drills', repo: trackId === 'sysdesign' ? 'Design a real system' : 'Real-repo practice' };
}

export interface GroupTierSection {
  tier: GroupTier;
  groups: UnitGroup[];
}

/**
 * f52 U14 (ordering only): numbered drill modules first, in module-number order, then every other
 * group (repo-based practice) in label order. Empty tiers are dropped.
 */
export function tierGroups(groups: readonly UnitGroup[]): GroupTierSection[] {
  const numbered: { n: number; g: UnitGroup }[] = [];
  const rest: UnitGroup[] = [];
  for (const g of groups) {
    const nums = g.units.map((u) => moduleNumberOf(u.key)).filter((n): n is number => n !== null);
    if (nums.length > 0) numbered.push({ n: Math.min(...nums), g });
    else rest.push(g);
  }
  numbered.sort((a, b) => a.n - b.n || a.g.label.localeCompare(b.g.label, 'en'));
  const out: GroupTierSection[] = [];
  if (numbered.length) out.push({ tier: 'core', groups: numbered.map((x) => x.g) });
  if (rest.length) out.push({ tier: 'repo', groups: rest });
  return out;
}

/**
 * Filter then group. The query matches (case-insensitively) the title, the group label or the key.
 * Groups are sorted by label; units keep the order the server served them in.
 */
export function groupUnits(units: readonly UnitSummary[], f: UnitFilter): UnitGroup[] {
  const q = f.query.trim().toLowerCase();
  const byLabel = new Map<string, UnitGroup>();
  for (const u of units) {
    if (f.section !== 'all' && sectionOfUnit(u) !== f.section) continue;
    if (f.hideDone && u.state === 'done') continue;
    const label = groupLabelOf(u);
    if (q && !u.title.toLowerCase().includes(q) && !label.toLowerCase().includes(q) && !u.key.toLowerCase().includes(q)) continue;
    let group = byLabel.get(label);
    if (!group) {
      group = { label, units: [], done: 0 };
      byLabel.set(label, group);
    }
    group.units.push(u);
    if (u.state === 'done') group.done++;
  }
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label, 'en'));
}
