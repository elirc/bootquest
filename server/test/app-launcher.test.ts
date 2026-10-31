import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script (no declaration file); launchProblem is its one pure export
import { launchProblem } from '../scripts/app.mjs';

/**
 * ab wave S3: `npm run app` (server/scripts/app.mjs) starts the API server and the UI from one
 * terminal. Its refusals happen before anything is opened; the real start is verified by hand
 * against a temp DB copy on other ports (never :4178), see the S3 stop report.
 */
const SCRIPT = fileURLToPath(new URL('../scripts/app.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const check = launchProblem as (env: Record<string, string | undefined>) => string | null;

describe('npm run app: refusals (ab wave S3)', () => {
  it('BOOTQUEST_DB unset or blank: refuses with how to set it in cmd, PowerShell and Git Bash', () => {
    for (const db of [undefined, '', '   ']) {
      const msg = check({ BOOTQUEST_DB: db });
      expect(msg).toMatch(/^BOOTQUEST_DB is not set/);
      expect(msg).toContain('set BOOTQUEST_DB=');
      expect(msg).toContain('$env:BOOTQUEST_DB');
      expect(msg).toContain('export BOOTQUEST_DB=');
    }
  });

  it('bad or clashing ports are refused; a DB alone is enough', () => {
    expect(check({ BOOTQUEST_DB: 'x.db' })).toBeNull();
    expect(check({ BOOTQUEST_DB: 'x.db', BOOTQUEST_PORT: '4999', BOOTQUEST_UI_PORT: '5999' })).toBeNull();
    expect(check({ BOOTQUEST_DB: 'x.db', BOOTQUEST_UI_PORT: 'abc' })).toMatch(/BOOTQUEST_UI_PORT must be an integer/);
    expect(check({ BOOTQUEST_DB: 'x.db', BOOTQUEST_PORT: '70000' })).toMatch(/BOOTQUEST_PORT must be an integer/);
    expect(check({ BOOTQUEST_DB: 'x.db', BOOTQUEST_PORT: '5000', BOOTQUEST_UI_PORT: '5000' })).toMatch(/must differ/);
  });

  it('the real entrypoint exits 1 with that message and starts nothing when BOOTQUEST_DB is unset', () => {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.BOOTQUEST_DB;
    const r = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('[app] BOOTQUEST_DB is not set');
    expect(r.stdout).not.toContain('listening');
  });
});
