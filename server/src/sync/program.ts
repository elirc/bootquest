import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type CompetencyId } from '@bootquest/shared';
import { SignalpostProgram, type RecordedCheck, type SignalpostMilestone } from '@bootquest/shared/sync';
import type { NodeTestFileCheck } from '@bootquest/shared';
import type { z } from 'zod';
import type { Db } from '../db/database.ts';

/**
 * First-class curriculum: a repo carrying a signalpost-style
 * docs/curriculum/program.json (v2, validated by the schema BORROWED from the
 * repo's own scripts/check-curriculum.ts). Each milestone becomes a unit:
 *  - milestones with a row in the recorded check-spec table (U01-U03 for
 *    signalpost) -> kind 'program-unit' with a node-test-file check pinned by
 *    repo + sha + sha256 + blob sha + expected test names;
 *  - every other milestone (U04-U12) -> kind 'study' (no machine check).
 * Competencies are free text upstream; competency_alias maps each to one of
 * the seven ladder competencies. An unmapped alias is a sync error, never a
 * silent drop.
 */

export class ProgramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgramError';
  }
}

export function parseProgramJson(text: string): SignalpostProgram {
  return SignalpostProgram.parse(JSON.parse(text.replace(/^﻿/, '')) as unknown);
}

export function readProgram(absPath: string): { program: SignalpostProgram; text: string } {
  const text = readFileSync(absPath, 'utf8');
  return { program: parseProgramJson(text), text };
}

/** 1-based line of a milestone's `"code": "Uxx"` inside program.json (a citable anchor line). */
export function milestoneLine(text: string, code: string): number | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const re = new RegExp(`^\\s*"code"\\s*:\\s*"${code}"`);
  const i = lines.findIndex((l) => re.test(l));
  return i < 0 ? null : i + 1;
}

export function programUnitKey(repo: string, code: string): string {
  return `gh:${repo}:${code}`;
}

export function programRefKey(code: string): string {
  return `jp:milestones[code=${code}]`;
}

/** Free-text competencies -> ladder competency ids via competency_alias (deduped, in order). */
export function mapCompetencies(db: Db, aliases: readonly string[]): CompetencyId[] {
  const out: CompetencyId[] = [];
  for (const a of aliases) {
    const row = db.get<{ c: CompetencyId }>('SELECT competency_id AS c FROM competency_alias WHERE alias = ?', a);
    if (!row) throw new ProgramError(`competency "${a}" has no competency_alias mapping (add one in a migration)`);
    if (!out.includes(row.c)) out.push(row.c);
  }
  return out;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex');
}

/** The node-test-file check spec for a recorded table row, pinned at the table's sha. */
export function recordedCheckSpec(repo: string, sha: string, r: RecordedCheck): z.input<typeof NodeTestFileCheck> {
  return {
    type: 'node-test-file',
    repo,
    sha,
    checkPath: r.path,
    learnerPath: r.learner_path,
    checkSha256: r.sha256,
    blobSha: r.blob_sha,
    tsx: r.needs_tsx,
    ...(r.tsc_project !== undefined ? { tscProject: r.tsc_project } : {}),
    timeoutMs: r.timeout_ms,
    moduleType: r.module_type,
    expectedTests: r.expected_tests,
  };
}

export type { SignalpostMilestone };
