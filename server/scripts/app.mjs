// `npm run app`: BootQuest from ONE terminal (ab wave S3). Run from the repo root:
//   npm run app            (= node --import tsx server/scripts/app.mjs)
//   npm run app -- --open  also opens the browser (Git Bash / cmd; PowerShell 5.1 drops the `--`)
//
// One process hosts both halves, so Ctrl+C (cmd, PowerShell, Git Bash / mintty, or closing the
// window) always stops both and nothing is left running:
//   - the API server: the same startServer() as `npm run serve` (same pack/campaign/seed defaults,
//     startup backup, stamp gate, local-only lockdown), on 127.0.0.1:BOOTQUEST_PORT (4178);
//   - the browser UI: the client's own Vite dev server (client/vite.config.ts, so its /api proxy and
//     its fs.deny list, which keeps content/packs answer keys off /@fs/, apply unchanged), on
//     BOOTQUEST_UI_PORT (5173), proxying /api to the server above.
// Refuses, before touching anything, when BOOTQUEST_DB is unset: there is no default DB.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLIENT = join(ROOT, 'client');
const DEFAULT_UI_PORT = 5173;

/** Why the launcher cannot start with this environment, or null. PURE (exported for the test). */
export function launchProblem(env) {
  if ((env.BOOTQUEST_DB ?? '').trim() === '') {
    return [
      'BOOTQUEST_DB is not set. BootQuest keeps everything in one DB file and never guesses its path.',
      'Set it in the same terminal, then run `npm run app` again:',
      '  cmd:         set BOOTQUEST_DB=C:\\Users\\Owner\\bootquest\\bootquest.db',
      '  PowerShell:  $env:BOOTQUEST_DB = "C:\\Users\\Owner\\bootquest\\bootquest.db"',
      '  Git Bash:    export BOOTQUEST_DB=/c/Users/Owner/bootquest/bootquest.db',
      'A file that does not exist yet (in an existing folder) starts a new, empty DB.',
    ].join('\n');
  }
  // a relative path would resolve against wherever npm happens to run the script (the repo root
  // here, server/ for `npm run serve`): two commands, two DBs. Refuse it rather than guess.
  const db = env.BOOTQUEST_DB.trim();
  if (db !== ':memory:' && !isAbsolute(db)) {
    return [
      `BOOTQUEST_DB must be an absolute path, got "${env.BOOTQUEST_DB}".`,
      'A relative path would name a different file depending on where the command runs.',
      '  e.g.  set BOOTQUEST_DB=C:\\Users\\Owner\\bootquest\\bootquest.db',
    ].join('\n');
  }
  for (const name of ['BOOTQUEST_PORT', 'BOOTQUEST_UI_PORT']) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') continue;
    const n = Number(raw);
    if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(n) || n < 1 || n > 65535) return `${name} must be an integer 1-65535, got "${raw}"`;
  }
  if (env.BOOTQUEST_PORT && env.BOOTQUEST_UI_PORT && Number(env.BOOTQUEST_PORT) === Number(env.BOOTQUEST_UI_PORT)) {
    return 'BOOTQUEST_PORT and BOOTQUEST_UI_PORT must differ (the API and the UI each need their own port)';
  }
  return null;
}

/** The client's OWN Vite (client/node_modules may pin a different version than the root's). */
async function importClientVite() {
  const req = createRequire(join(CLIENT, 'package.json'));
  const pkgPath = req.resolve('vite/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const entry = pkg.exports?.['.']?.import?.default ?? pkg.exports?.['.']?.import;
  if (typeof entry !== 'string') throw new Error(`cannot locate the Vite ESM entry in ${pkgPath}`);
  return import(pathToFileURL(join(dirname(pkgPath), entry)).href);
}

async function main() {
  const problem = launchProblem(process.env);
  if (problem) {
    console.error(`[app] ${problem.split('\n').join('\n[app] ')}`);
    process.exit(1);
  }
  const open = process.argv.slice(2).includes('--open');
  const uiPort = process.env.BOOTQUEST_UI_PORT?.trim() ? Number(process.env.BOOTQUEST_UI_PORT) : DEFAULT_UI_PORT;

  // the API server, exactly as `npm run serve` starts it (serve.ts invokedDirectly)
  const serve = await import('../src/api/serve.ts');
  const { DEFAULT_AUTHORED_UNITS } = await import('../src/store/ladder.ts');
  const env = { ...process.env };
  if (env.BOOTQUEST_PACKS === undefined) env.BOOTQUEST_PACKS = serve.defaultPackDirs().join(',');
  if (env.BOOTQUEST_CAMPAIGN === undefined) env.BOOTQUEST_CAMPAIGN = serve.defaultCampaignDir();
  if (env.BOOTQUEST_SEED_ITEMS === undefined) env.BOOTQUEST_SEED_ITEMS = serve.defaultSeedDirs().join(',');
  if (env.BOOTQUEST_AUTHORED_UNITS === undefined) {
    const def = DEFAULT_AUTHORED_UNITS(ROOT);
    env.BOOTQUEST_AUTHORED_UNITS = existsSync(def) ? def : '';
  }

  let running;
  try {
    running = await serve.startServer({ env });
  } catch (err) {
    console.error(`[app] the API server did not start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  for (const line of serve.backupSummary(running.backup)) console.log(line);
  for (const line of serve.startupSummary(running)) console.log(line);
  console.log(`[bootquest] API listening on http://${running.host}:${running.port} (db: ${running.db.path})`);

  // the UI: client/vite.config.ts reads BOOTQUEST_PORT for its /api proxy target
  process.env.BOOTQUEST_PORT = String(running.port);
  let vite;
  try {
    const { createServer } = await importClientVite();
    vite = await createServer({
      root: CLIENT,
      configFile: join(CLIENT, 'vite.config.ts'),
      server: { port: uiPort, strictPort: true, open },
      clearScreen: false,
    });
    await vite.listen();
  } catch (err) {
    console.error(`[app] the UI did not start: ${err instanceof Error ? err.message : String(err)}`);
    if (/port .* in use|EADDRINUSE/i.test(String(err))) console.error('[app] set BOOTQUEST_UI_PORT to a free port (default 5173).');
    await vite?.close().catch(() => {});
    await running.close();
    process.exit(1);
  }

  const url = vite.resolvedUrls?.local?.[0] ?? `http://localhost:${uiPort}/`;
  console.log('');
  console.log(`[app] BootQuest is running. Open ${url}`);
  console.log(`[app]   API ${`http://${running.host}:${running.port}`} · DB ${resolve(running.db.path)}`);
  console.log('[app]   Ctrl+C stops both.');

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[app] ${signal} received, shutting down the UI and the API server`);
    // never hang on shutdown: a hard exit after 5 s (the DB is closed first when it can be)
    setTimeout(() => process.exit(0), 5000).unref();
    void vite
      .close()
      .catch(() => {})
      .then(() => running.close())
      .then(() => process.exit(0), () => process.exit(1));
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.on(sig, () => stop(sig));
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`[app] failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
}
