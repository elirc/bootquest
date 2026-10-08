import { describe, expect, it } from 'vitest';
import {
  ASSESSORS,
  ASSISTANCE,
  ATTEMPT_MODES,
  ATTEMPT_OUTCOMES,
  CHECK_TYPES,
  COMPETENCY_IDS,
  CONTENT_REF_KINDS,
  CONTENT_REF_ORIGINS,
  CONTENT_REF_PROVENANCE,
  CONTENT_REF_STATUS,
  EVIDENCE_KINDS,
  PROJECT_UNIT_KINDS,
  REVIEW_GRADES,
  RUN_VERDICTS,
  TRACK_IDS,
  UNIT_KINDS,
  XP_KINDS,
  XP_ZERO_REASONS,
} from '@bootquest/shared';
import { useTempDb } from './helpers.ts';

/**
 * W1a audit #16: every shared enum mirrors a SQL CHECK (... IN (...)). The
 * value list is parsed out of the live schema (sqlite_master) per column.
 */
const PAIRS: [table: string, column: string, values: readonly string[]][] = [
  ['track', 'id', TRACK_IDS],
  ['unit', 'kind', UNIT_KINDS],
  ['check', 'type', CHECK_TYPES],
  ['content_ref', 'kind', CONTENT_REF_KINDS],
  ['content_ref', 'provenance', CONTENT_REF_PROVENANCE],
  ['content_ref', 'origin', CONTENT_REF_ORIGINS],
  ['content_ref', 'status', CONTENT_REF_STATUS],
  ['attempt', 'mode', ATTEMPT_MODES],
  ['attempt', 'assistance_source', ASSISTANCE],
  ['attempt', 'outcome', ATTEMPT_OUTCOMES],
  ['run', 'verdict', RUN_VERDICTS],
  ['evidence', 'kind', EVIDENCE_KINDS],
  ['evidence', 'assistance', ASSISTANCE],
  ['evidence', 'assessor', ASSESSORS],
  ['xp_event', 'kind', XP_KINDS],
  ['xp_event', 'reason', XP_ZERO_REASONS],
  ['review_log', 'rating', REVIEW_GRADES],
];

function sqlInList(tableSql: string, column: string): string[] {
  // first "<column> ... IN (...)" inside a CHECK on that column's line
  const re = new RegExp(`\\b${column}\\b[^\\n]*?\\bIN\\s*\\(([^)]*)\\)`, 's');
  const lines = tableSql.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s*"?${column}"?\\s+(TEXT|INTEGER)`).test(l));
  if (start < 0) throw new Error(`column ${column} not found`);
  // the IN list may wrap onto following lines; scan until the closing paren
  const chunk = lines.slice(start, start + 6).join('\n');
  const m = re.exec(chunk);
  if (!m) throw new Error(`no IN (...) check for ${column}`);
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

describe('shared enums stay in sync with SQL CHECK constraints', () => {
  const ctx = useTempDb();

  it.each(PAIRS)('%s.%s', (table, column, values) => {
    const sql = ctx.db.get<{ sql: string }>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, table)!.sql;
    expect(sqlInList(sql, column).sort()).toEqual([...values].sort());
  });

  it('seeded competencies equal COMPETENCY_IDS', () => {
    const ids = ctx.db.all<{ id: string }>('SELECT id FROM competency').map((r) => r.id);
    expect(ids.sort()).toEqual([...COMPETENCY_IDS].sort());
  });

  it('PROJECT_UNIT_KINDS is a subset of UNIT_KINDS', () => {
    for (const k of PROJECT_UNIT_KINDS) expect(UNIT_KINDS).toContain(k);
  });
});
