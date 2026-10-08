import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Resumable per-exercise journal for seed:validate (JSON Lines, NOT committed —
 * .seed-journal/ is gitignored). One line is appended as soon as an exercise's
 * verdict is final, so an interrupted sweep (10-minute shell cap, memory
 * reaper) resumes where it stopped. An entry only counts while its `hash`
 * matches the current exercise + grader bytes; edits invalidate it.
 */

export const JournalVerdict = z.enum(['pass', 'fail', 'carve-out']);
export type JournalVerdict = z.infer<typeof JournalVerdict>;

export const JournalEntry = z
  .object({
    key: z.string().min(1),
    course: z.string().min(1),
    type: z.enum(['code', 'quiz', 'output', 'written']),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    verdict: JournalVerdict,
    reasons: z.array(z.string()),
    /** grader executions (a timeout flake is retried once) */
    attempts: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
    at: z.string(),
  })
  .strict();
export type JournalEntry = z.infer<typeof JournalEntry>;

export interface JournalReadResult {
  entries: Map<string, JournalEntry>;
  /** unparsable lines skipped (e.g. a line torn by a killed process) */
  skipped: number;
}

/** Read a journal; the LAST line for a key wins. A missing file is an empty journal. */
export function readJournal(path: string): JournalReadResult {
  const entries = new Map<string, JournalEntry>();
  let skipped = 0;
  if (!existsSync(path)) return { entries, skipped };
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JournalEntry.parse(JSON.parse(line));
      entries.set(e.key, e);
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
}

export function appendJournal(path: string, entry: JournalEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  const line = `${JSON.stringify(JournalEntry.parse(entry))}\n`;
  // torn-line guard: if a previous writer died mid-line, start on a fresh line
  appendFileSync(path, endsMidLine(path) ? `\n${line}` : line);
}

function endsMidLine(path: string): boolean {
  if (!existsSync(path)) return false;
  const size = statSync(path).size;
  if (size === 0) return false;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}
