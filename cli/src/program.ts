import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import type { UnitDetailResponse } from '@bootquest/shared/api';
import { ApiClient, DEFAULT_SERVER, UsageError, type FetchLike } from './client.ts';
import { ConfigError, loadConfig, resolveSubmissionFile, type ProjectConfig } from './config.ts';
import { formatDashboard, formatError, formatProject, formatRun, formatSubmit, formatSync } from './format.ts';
import { classifyUnit, resolveUnit, type Delivery } from './units.ts';

/**
 * Exit codes (scripts depend on these):
 *   0  success; for run/submit: the check PASSED (incl. an already-awarded re-pass)
 *   1  run/submit completed but did not pass (fail / todo / crashed / timeout / error verdict)
 *   2  could not do the job: usage error, bad .bootquest.json, server unreachable,
 *      server refused (error envelope), unit kind the CLI does not deliver
 */
export const EXIT = { OK: 0, NOT_PASSED: 1, ERROR: 2 } as const;

/** Mirrors MAX_CODE_CHARS in shared/src/api.ts (cli/test/units.test.ts asserts they agree). */
export const MAX_CODE_CHARS = 100_000;

/** `bootquest sync` may download several tarballs on a first run. */
export const SYNC_TIMEOUT_MS = 600_000;

export interface CliIo {
  cwd: string;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  out(text: string): void;
  err(text: string): void;
  version?: string;
}

interface GlobalOpts {
  server?: string;
}

function serverUrl(opts: GlobalOpts, env: CliIo['env']): string {
  return opts.server ?? (env.BOOTQUEST_SERVER?.trim() ? env.BOOTQUEST_SERVER : undefined) ?? DEFAULT_SERVER;
}

function requireConfig(cwd: string): ProjectConfig {
  const cfg = loadConfig(cwd);
  if (!cfg) {
    throw new ConfigError(
      `no .bootquest.json found in ${cwd} or any parent directory. Create one in your project: {"unitKey": "<unit key>", "file": "<file to submit>"}`,
    );
  }
  return cfg;
}

function readCode(file: string): string {
  if (!existsSync(file)) throw new UsageError(`file not found: ${file}`);
  let code: string;
  try {
    code = readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (err) {
    throw new UsageError(`cannot read ${file} (${err instanceof Error ? err.message : String(err)})`);
  }
  if (code.length > MAX_CODE_CHARS) {
    throw new UsageError(`${file} is ${code.length} characters; the server accepts at most ${MAX_CODE_CHARS}`);
  }
  return code;
}

function display(cwd: string, file: string): string {
  const rel = relative(cwd, file);
  return rel && !rel.startsWith('..') ? rel : file;
}

/** What run/submit send: exactly one of the API's submission shapes. */
type Payload = { code: string } | { port: number } | { repoPath: string };

interface Prepared {
  client: ApiClient;
  detail: UnitDetailResponse;
  payload: Payload;
  /** what was checked, for the output's "File:/Target:/Repo:" line */
  source: string;
  label: 'File' | 'Target' | 'Repo';
}

interface DeliveryOpts {
  port?: string;
  repo?: string;
}

/** --port value: an integer 1-65535. */
export function parsePort(raw: string): number {
  const t = raw.trim();
  const n = /^\d{1,5}$/.test(t) ? Number(t) : NaN;
  if (!(n >= 1 && n <= 65535)) throw new UsageError(`--port must be an integer 1-65535 (got "${raw}")`);
  return n;
}

/** Shared run/submit front half: config -> unit -> kind gate -> payload. Returns null when refused. */
async function prepare(
  io: CliIo,
  opts: GlobalOpts,
  pathArg: string | undefined,
  command: 'run' | 'submit',
  d: DeliveryOpts,
): Promise<Prepared | null> {
  const client = new ApiClient(serverUrl(opts, io.env), io.fetch);
  const config = requireConfig(io.cwd);
  const detail = await resolveUnit(client, config);
  const delivery = classifyUnit(detail, command);
  if (delivery.mode === 'refuse') {
    io.err(`bootquest ${command}: ${delivery.reason}`);
    return null;
  }
  const kind = `"${detail.unit.title}" is a ${delivery.checkType} unit`;
  if (delivery.mode === 'code') {
    if (d.port !== undefined || d.repo !== undefined) {
      throw new UsageError(`${kind}: send a file (bootquest ${command} [path]); --port is for http units and --repo for repo units`);
    }
    const file = resolveSubmissionFile(pathArg, io.cwd, config);
    return { client, detail, payload: { code: readCode(file) }, source: display(io.cwd, file), label: 'File' };
  }
  if (delivery.mode === 'http') {
    if (pathArg !== undefined || d.repo !== undefined) {
      throw new UsageError(`${kind}: it checks your running server - use bootquest ${command} --port <n> (no file path, no --repo)`);
    }
    const port = d.port !== undefined ? parsePort(d.port) : delivery.portHint;
    if (port === null) throw new UsageError(`${kind}: pass --port <n>, the port your server listens on`);
    return {
      client,
      detail,
      payload: { port },
      source: `localhost:${port} (the BootQuest server sends the requests over loopback)${d.port === undefined ? ' - port from the unit hint; override with --port' : ''}`,
      label: 'Target',
    };
  }
  if (pathArg !== undefined || d.port !== undefined) {
    throw new UsageError(`${kind}: it checks a git repo - use bootquest ${command} [--repo <dir>] (default: ${config.dir}, the directory holding .bootquest.json)`);
  }
  const repoPath = d.repo !== undefined ? resolve(io.cwd, d.repo) : config.dir;
  let isDir = false;
  try {
    isDir = statSync(repoPath).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new UsageError(`--repo ${repoPath} is not a directory`);
  return { client, detail, payload: { repoPath }, source: repoPath, label: 'Repo' };
}

export function buildProgram(io: CliIo, setExit: (code: number) => void): Command {
  const program = new Command();
  program
    .name('bootquest')
    .description(
      'BootQuest CLI: check and submit the project you are coding in your own editor.\n' +
        'The current unit comes from .bootquest.json (searched from the cwd upwards).',
    )
    .version(io.version ?? '0.1.0', '-V, --version')
    .option('--server <url>', `BootQuest server URL (env BOOTQUEST_SERVER, default ${DEFAULT_SERVER})`)
    .showHelpAfterError('(run bootquest --help for usage)')
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.out(s.replace(/\n$/, '')), writeErr: (s) => io.err(s.replace(/\n$/, '')) });

  program
    .command('status')
    .description('dashboard summary (streak, XP/level, reviews due, next up) + the current project unit, if any')
    .action(async (_o: unknown, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOpts>();
      const client = new ApiClient(serverUrl(opts, io.env), io.fetch);
      io.out(formatDashboard(await client.dashboard(), client.server));
      const config = loadConfig(io.cwd); // a malformed config throws -> exit 2 after the dashboard printed
      if (!config) {
        io.out('Project: none (no .bootquest.json here or above)');
        return;
      }
      const detail = await resolveUnit(client, config);
      const delivery = classifyUnit(detail, 'submit');
      const file = config.file !== undefined ? resolveSubmissionFile(undefined, io.cwd, config) : null;
      const how: Record<Delivery['mode'], string> = {
        code: 'run / submit from here',
        http: `run / submit --port <n> while your server is running${delivery.mode === 'http' && delivery.portHint !== null ? ` (default ${delivery.portHint})` : ''}`,
        repo: `run / submit [--repo <dir>] (default ${config.dir})`,
        refuse: 'not delivered by the CLI (see `bootquest submit` for why)',
      };
      io.out('');
      io.out(formatProject(detail, config.path, file ? { path: display(io.cwd, file), exists: existsSync(file) } : null, how[delivery.mode]));
    });

  const PORT_HELP = 'http units: the local port your server listens on (default: the unit\'s port hint)';
  const REPO_HELP = 'repo units: the git working tree to check (default: the directory holding .bootquest.json)';

  program
    .command('run [path]')
    .description(
      'free check of the current unit (not recorded, no XP). Code units: path defaults to "file" in .bootquest.json; ' +
        'http units: --port; repo units: --repo',
    )
    .option('--port <n>', PORT_HELP)
    .option('--repo <dir>', REPO_HELP)
    .action(async (pathArg: string | undefined, o: DeliveryOpts, cmd: Command) => {
      const p = await prepare(io, cmd.optsWithGlobals<GlobalOpts>(), pathArg, 'run', o);
      if (!p) return setExit(EXIT.ERROR);
      const { result } = await p.client.run(p.detail.unit.id, p.payload);
      io.out(formatRun(p.detail, result, p.source, p.label));
      setExit(result.pass ? EXIT.OK : EXIT.NOT_PASSED);
    });

  program
    .command('submit [path]')
    .description('submit the current unit (recorded; XP on pass). Exit 0 only when the check passes')
    .option('--port <n>', PORT_HELP)
    .option('--repo <dir>', REPO_HELP)
    .option('--assisted', 'honor system: you had help (AI, a friend, the docs answer) - recorded as an assisted attempt')
    .action(async (pathArg: string | undefined, o: DeliveryOpts & { assisted?: boolean }, cmd: Command) => {
      const p = await prepare(io, cmd.optsWithGlobals<GlobalOpts>(), pathArg, 'submit', o);
      if (!p) return setExit(EXIT.ERROR);
      const resp = await p.client.submit(p.detail.unit.id, { ...p.payload, selfAssisted: o.assisted === true });
      io.out(formatSubmit(p.detail, resp, p.source, p.label));
      setExit(resp.verdict === 'pass' ? EXIT.OK : EXIT.NOT_PASSED);
    });

  program
    .command('sync')
    .description(
      'GitHub curriculum sync (W4): the server walks every repo in curriculum.yaml at its HEAD (per-SHA tarball cache), ' +
        'upserts content refs, registers program.json units and queues new stable_keys for the next seed session. ' +
        'Exit 0 when every repo synced, 1 when any repo failed (e.g. offline with nothing cached)',
    )
    .option('--repo <owner/name...>', 'sync only these registered repos')
    .action(async (o: { repo?: string[] }, cmd: Command) => {
      // a first sync downloads tarballs: allow it far longer than a grade
      const client = new ApiClient(serverUrl(cmd.optsWithGlobals<GlobalOpts>(), io.env), io.fetch, SYNC_TIMEOUT_MS);
      const report = await client.sync(o.repo);
      io.out(formatSync(report, await client.seedQueue(20), client.server));
      setExit(report.ok ? EXIT.OK : EXIT.NOT_PASSED);
    });

  return program;
}

/** Parse + execute; never throws, always resolves to an exit code. `argv` excludes node + script. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let code: number = EXIT.OK;
  const program = buildProgram(io, (c) => {
    code = c;
  });
  if (argv.length === 0) {
    io.out(program.helpInformation().replace(/\n$/, ''));
    return EXIT.OK;
  }
  try {
    await program.parseAsync(argv, { from: 'user' });
    return code;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help / --version exit 0; unknown command/option, missing arg: usage error
      return err.exitCode === 0 ? EXIT.OK : EXIT.ERROR;
    }
    io.err(formatError(err));
    return EXIT.ERROR;
  }
}
