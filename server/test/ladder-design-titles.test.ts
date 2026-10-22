import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SeedExplainBackItem } from '@bootquest/shared';
import { loadSeedDerivedContent } from '../src/api/serve.ts';
import { Db } from '../src/db/database.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { designTopic, explainBackUnitKey, isDesignIt } from '../src/store/ladder.ts';
import { mapSeedItemStore } from '../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from './helpers.ts';
import fixture from './fixtures/ladder-fixture.json' with { type: 'json' };

/**
 * DESIGN IT unit titles (store/ladder.ts designTopic): a DESIGN IT set is titled
 * `DESIGN IT: <repo> — <topic>` from its Q1 prompt's topic (an alternate set keeps the
 * ` (set B)` suffix); an unparseable prompt falls back to the source-file label. G2 and ordinary
 * explain-back titles are unchanged. Titles are re-derived on every load (no migration).
 */

const BASE = fixture.seedItems.find((i) => i.kind === 'explain-back') as unknown as SeedExplainBackItem;

function ebItem(repo: string, tag: string, firstPrompt: string, extra: { path?: string; set?: string } = {}): SeedExplainBackItem {
  const it = structuredClone(BASE);
  return {
    ...it,
    key: `seed:explainback:${repo}/explain-back/${tag}`,
    provenance: { ...it.provenance, repo, path: extra.path ?? `docs/${tag}.md` },
    questions: [{ ...it.questions[0]!, prompt: firstPrompt }, ...it.questions.slice(1)],
    ...(extra.set !== undefined ? { set: extra.set } : {}),
  };
}

const q1 = (prompt: string): SeedExplainBackItem => ebItem('r', 'x', prompt);

// the three real Q1 prompt shapes (verbatim prefixes from content/seed)
const SHAPE_SENIOR_LEADING =
  'DESIGN IT — [senior] cache coherence across layers for a storefront (bazaar, docs/adr/0006-multi-layer-cache-coherence.md). Requirements: 40,000 product pages, each rendered in 3 locales and 3 currencies, are served through a CDN.';
const SHAPE_MID_TRAILING =
  'DESIGN IT — OAuth login end-to-end for a web app [senior] (dotnet-auth, docs2/03-oauth-from-the-code.md). Scenario: you run the identity provider behind "NetLinear".';
const SHAPE_JAVABOOTCAMP =
  'DESIGN IT — Dynamo-style key-value store (javabootcamp System Design, guide astraupskill/03-SYSTEM-DESIGN.md §4.6; blocks from modules 09, 11 and 13). Requirements: get(key) and put(key, value).';
const SHAPE_SET_B =
  'DESIGN IT — [senior] personalized pricing on a cached storefront (bazaar, docs/adr/0006-multi-layer-cache-coherence.md). Scenario: the storefront introduces logged-in customer price groups.';
const LONG_NETSLACK_B =
  'DESIGN IT — [senior] the offline delivery leg for a team chat: mobile push notifications and unread badges layered onto the existing real-time hub (netslack, docs/architecture.md). Scenario: after an acquisition the workspace grows to 25,000 users.';

describe('designTopic', () => {
  it('reads the topic from the three real prompt shapes', () => {
    expect(designTopic(q1(SHAPE_SENIOR_LEADING))).toBe('cache coherence across layers for a storefront');
    expect(designTopic(q1(SHAPE_MID_TRAILING))).toBe('OAuth login end-to-end for a web app');
    expect(designTopic(q1(SHAPE_JAVABOOTCAMP))).toBe('Dynamo-style key-value store');
  });

  it('strips a level tag in either position, accepts en dash / hyphen separators, collapses whitespace', () => {
    expect(designTopic(q1('DESIGN IT — [mid] a  thing\tto   build (repo, p.md).'))).toBe('a thing to build');
    expect(designTopic(q1('DESIGN IT — a thing to build [mid] (repo, p.md).'))).toBe('a thing to build');
    expect(designTopic(q1('DESIGN IT – [staff] en dash topic (repo, p.md).'))).toBe('en dash topic');
    expect(designTopic(q1('DESIGN IT - hyphen topic (repo, p.md).'))).toBe('hyphen topic');
    // a bracket in the middle of the topic is kept (only leading / trailing tags are level tags)
    expect(designTopic(q1('DESIGN IT — keys [and] values (repo, p.md).'))).toBe('keys [and] values');
  });

  it('no parenthetical (or no DESIGN IT prefix) -> null', () => {
    expect(designTopic(q1('DESIGN IT — Dynamo-style key-value store. Write your design before you look.'))).toBeNull();
    // the topic may not run across a line break into a later parenthetical
    expect(designTopic(q1('DESIGN IT — topic on line one\nthen (a parenthetical later).'))).toBeNull();
    expect(designTopic(q1('Explain the module (repo, p.md).'))).toBeNull();
    expect(designTopic({ ...q1('x'), questions: [] })).toBeNull();
  });

  it('empty topic (or a bare level tag) -> null', () => {
    expect(designTopic(q1('DESIGN IT — (repo, p.md).'))).toBeNull();
    expect(designTopic(q1('DESIGN IT — [senior] (repo, p.md).'))).toBeNull();
    expect(designTopic(q1('DESIGN IT — [senior]   [mid] (repo, p.md).'))).toBeNull();
  });

  it('a topic over 90 chars is cut at a word boundary with an ellipsis; 90 exactly is kept', () => {
    const t = designTopic(q1(LONG_NETSLACK_B))!;
    expect(t).toBe('the offline delivery leg for a team chat: mobile push notifications and unread badges…');
    expect(t.length).toBeLessThanOrEqual(90);
    const ninety = 'a'.repeat(40) + ' ' + 'b'.repeat(49);
    expect(ninety).toHaveLength(90);
    expect(designTopic(q1(`DESIGN IT — ${ninety} (repo, p.md).`))).toBe(ninety);
    const ninetyOne = ninety + 'b';
    expect(designTopic(q1(`DESIGN IT — ${ninetyOne} (repo, p.md).`))).toBe(`${'a'.repeat(40)}…`);
  });
});

describe('ladder load: DESIGN IT titles', () => {
  let tmp: TempDb;
  const clock = fixedClock(localNoon(2026, 10, 1));
  beforeEach(() => {
    tmp = makeTempDb();
  });
  afterEach(() => tmp.cleanup());

  const PATH = 'docs/adr/0006-multi-layer-cache-coherence.md';
  const PRIMARY = ebItem('bazaar', 'design-cache', SHAPE_SENIOR_LEADING, { path: PATH });
  const SIBLING = ebItem('bazaar', 'design-cache-b', SHAPE_SET_B, { path: PATH, set: 'b' });
  const UNPARSEABLE = ebItem('javabootcamp', 'design-kv', 'DESIGN IT — Dynamo-style key-value store. Write your design before you look.', { path: 'bootcamp/11-partitioning-and-ids/README.md' });
  const G2 = ebItem('questrepo', 'g2', 'G2 BRIEF — questrepo. Write the delegation brief. (Mentions DESIGN IT later, not as the prefix.)');
  const ORDINARY = ebItem('questrepo', 'plain', 'Why does the suite test that a VIEWER cannot trigger an allocation run?');
  const ORDINARY_B = ebItem('questrepo', 'plain-b', 'Why is the allocation run idempotent?', { path: 'docs/plain.md', set: 'b' });
  const ALL = [PRIMARY, SIBLING, UNPARSEABLE, G2, ORDINARY, ORDINARY_B];

  const titleOf = (db: Db, it: SeedExplainBackItem): string | undefined =>
    db.get<{ title: string }>('SELECT title FROM unit WHERE key = ?', explainBackUnitKey(it))?.title;

  it('DESIGN IT primary + set-B sibling titled by topic; unparseable falls back to the file label; G2 and ordinary unchanged', () => {
    expect(ALL.filter(isDesignIt)).toEqual([PRIMARY, SIBLING, UNPARSEABLE]);
    loadSeedDerivedContent(tmp.db, { seedItems: mapSeedItemStore(ALL), authored: null }, clock);
    expect(titleOf(tmp.db, PRIMARY)).toBe('DESIGN IT: bazaar — cache coherence across layers for a storefront');
    expect(titleOf(tmp.db, SIBLING)).toBe('DESIGN IT: bazaar — personalized pricing on a cached storefront (set B)');
    expect(titleOf(tmp.db, UNPARSEABLE)).toBe('DESIGN IT: javabootcamp — 11-partitioning-and-ids/README.md');
    expect(titleOf(tmp.db, G2)).toBe('G2 delegation brief: questrepo');
    expect(titleOf(tmp.db, ORDINARY)).toBe('Explain back: questrepo — plain.md');
    expect(titleOf(tmp.db, ORDINARY_B)).toBe('Explain back: questrepo — plain.md (set B)');
  });

  it('a unit stored under its OLD title is retitled in place on load; a second load inserts nothing', () => {
    const inputs = { seedItems: mapSeedItemStore(ALL), authored: null };
    expect(loadSeedDerivedContent(tmp.db, inputs, clock).ladder.inserted).toBe(ALL.length);
    // simulate a DB written by the previous loader (pre-change titles)
    const key = explainBackUnitKey(PRIMARY);
    const sibKey = explainBackUnitKey(SIBLING);
    tmp.db.run('UPDATE unit SET title = ? WHERE key = ?', `Explain back: bazaar — 0006-multi-layer-cache-coherence.md`, key);
    tmp.db.run('UPDATE unit SET title = ? WHERE key = ?', `Explain back: bazaar — 0006-multi-layer-cache-coherence.md (set B)`, sibKey);
    const ids = tmp.db.all<{ id: number; key: string }>('SELECT id, key FROM unit ORDER BY id');

    const again = loadSeedDerivedContent(tmp.db, inputs, clock).ladder;
    expect(again.inserted).toBe(0);
    expect(titleOf(tmp.db, PRIMARY)).toBe('DESIGN IT: bazaar — cache coherence across layers for a storefront');
    expect(titleOf(tmp.db, SIBLING)).toBe('DESIGN IT: bazaar — personalized pricing on a cached storefront (set B)');
    // same rows, same ids: replaced in place
    expect(tmp.db.all<{ id: number; key: string }>('SELECT id, key FROM unit ORDER BY id')).toEqual(ids);

    expect(loadSeedDerivedContent(tmp.db, inputs, clock).ladder.inserted).toBe(0);
    expect(titleOf(tmp.db, PRIMARY)).toBe('DESIGN IT: bazaar — cache coherence across layers for a storefront');
  });
});
