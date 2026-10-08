import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { Command, CommanderError } from 'commander';
import type { UnitDetailResponse } from '@bootquest/shared/api';
import { ApiClient, DEFAULT_SERVER, UsageError, type FetchLike } from './client.ts';
import { ConfigError, loadConfig, resolveSubmissionFile, type ProjectConfig } from './config.ts';
import { formatDashboard, formatError, formatProject, formatRun, formatSubmit, formatSync } from './format.ts';
import { classifyUnit, resolveUnit } from './units.ts';

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

interface Prepared {
  client: ApiClient;
  detail: UnitDetailResponse;
  file: string;
  code: string;
}

/** Shared run/submit front half: config -> unit -> kind gate -> file. Returns null when refused. */
async function prepare(io: CliIo, opts: GlobalOpts, pathArg: string | undefined, command: 'run' | 'submit'): Promise<Prepared | null> {
  const client = new ApiClient(serverUrl(opts, io.env), io.fetch);
  const config = requireConfig(io.cwd);
  const detail = await resolveUnit(client, config);
  const delivery = classifyUnit(detail, command);
  if (delivery.mode === 'refuse') {
    io.err(`bootquest ${command}: ${delivery.reason}`);
    return null;
  }
  const file = resolveSubmissionFile(pathArg, io.cwd, config);
  return { client, detail, file, code: readCode(file) };
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
      io.out('');
      io.out(
        formatProject(
          detail,
          config.path,
          file ? { path: display(io.cwd, file), exists: existsSync(file) } : null,
          delivery.mode === 'code' ? 'run / submit from here' : 'not delivered by the CLI (see `bootquest submit` for why)',
        ),
      );
    });

  program
    .command('run [path]')
    .description('free check of the current unit (not recorded, no XP); path defaults to "file" in .bootquest.json')
    .action(async (pathArg: string | undefined, _o: unknown, cmd: Command) => {
      const p = await prepare(io, cmd.optsWithGlobals<GlobalOpts>(), pathArg, 'run');
      if (!p) return setExit(EXIT.ERROR);
      const { result } = await p.client.run(p.detail.unit.id, { code: p.code });
      io.out(formatRun(p.detail, result, display(io.cwd, p.file)));
      setExit(result.pass ? EXIT.OK : EXIT.NOT_PASSED);
    });

  program
    .command('submit [path]')
    .description('submit the current unit (recorded; XP on pass). Exit 0 only when the check passes')
    .option('--assisted', 'honor system: you had help (AI, a friend, the docs answer) - recorded as an assisted attempt')
    .action(async (pathArg: string | undefined, o: { assisted?: boolean }, cmd: Command) => {
      const p = await prepare(io, cmd.optsWithGlobals<GlobalOpts>(), pathArg, 'submit');
      if (!p) return setExit(EXIT.ERROR);
      const resp = await p.client.submit(p.detail.unit.id, { code: p.code, selfAssisted: o.assisted === true });
      io.out(formatSubmit(p.detail, resp, display(io.cwd, p.file)));
      setExit(resp.verdict === 'pass' ? EXIT.OK : EXIT.NOT_PASSED);
    });

  program
    .command('sync')
    .description('PLACEHOLDER until W4: checks the server is up and prints its loaded unit/check counts (no GitHub sync yet)')
    .action(async (_o: unknown, cmd: Command) => {
      const client = new ApiClient(serverUrl(cmd.optsWithGlobals<GlobalOpts>(), io.env), io.fetch);
      const health = await client.health();
      io.out(formatSync(health, await client.tracks(), client.server));
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
