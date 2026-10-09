/**
 * Script-mode snippet runner (W3c) for predict-output checks with
 * `runAs: 'script'` — jstrain2.2's quiz bank captured its "what does this
 * print?" answers by running each snippet as a plain `node snippet.js`:
 * CommonJS (sloppy-mode `this`, `require`, nextTick before promise jobs) with
 * node's module-syntax detection for snippets that use `import`. BootForge's
 * grade-core runSnippet runs ESM (.mjs) and would change those answers, so
 * this runner writes `snippet.js` next to a package.json WITHOUT a "type"
 * field (the nearest package.json decides; the temp dir must not inherit one).
 * Same process discipline as the self-run runner: no shell, minimal env,
 * wall-clock timeout => tree kill.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { childEnv, spawnCapture } from './index.ts';

export const SNIPPET_TIMEOUT_MS = 10_000;

export interface ScriptSnippetResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export async function runScriptSnippet(code: string, timeoutMs: number = SNIPPET_TIMEOUT_MS): Promise<ScriptSnippetResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'bq-snippet-'));
  try {
    await writeFile(path.join(dir, 'package.json'), '{}\n');
    await writeFile(path.join(dir, 'snippet.js'), code, 'utf8');
    const r = await spawnCapture(['snippet.js'], { cwd: dir, env: childEnv(), timeoutMs });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.code, timedOut: r.timedOut };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
