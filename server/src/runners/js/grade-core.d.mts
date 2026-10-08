// Type declarations for the plain-ESM grader (grade-core.mjs, ported verbatim from BootForge).

export interface GradeTest {
  name: string;
  /** Body of an async function invoked as fn(mod, assert); assert is node:assert/strict. */
  code: string;
  /** Author-supplied case metadata, shown (inspected) on failure. */
  input?: unknown;
}

export interface GradeResult {
  name: string;
  pass: boolean;
  message?: string;
  input?: string;
  expected?: string;
  actual?: string;
  operator?: string;
}

export interface GradeOutcome {
  pass: boolean;
  results: GradeResult[];
  stdout?: string;
  stderr?: string;
}

export interface SnippetOutcome {
  stdout: string;
  stderr: string;
  timedOut: boolean;
  exitCode: number | null;
  error?: string;
}

export function gradeCode(code: string, language: 'js' | 'ts', tests: GradeTest[]): Promise<GradeOutcome>;
export function runSnippet(code: string, language?: 'js' | 'ts'): Promise<SnippetOutcome>;
export function normalizeOutput(s: string): string;
export const _internal: { TIMEOUT_MS: number; CHILD_FLAGS: string[] };
