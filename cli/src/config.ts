import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * `.bootquest.json` — the per-project marker that tells the CLI which unit the
 * working project belongs to. Found by walking up from the cwd (like git).
 *
 *   { "unitKey": "bootforge/js-fundamentals/values/variables/swap", "file": "src/swap.js" }
 *   { "unitId": 12 }
 *
 * Exactly one of unitKey / unitId. `file` (optional) is the file `run` / `submit`
 * send when no path argument is given; it is RELATIVE to the config file's
 * directory, so the project (and the BootQuest repo) can move freely.
 */
export const CONFIG_FILE = '.bootquest.json';

const ALLOWED_KEYS = new Set(['unitKey', 'unitId', 'file']);

export interface ProjectConfig {
  /** absolute path of the .bootquest.json that was read */
  path: string;
  /** its directory (the project root) */
  dir: string;
  unitKey?: string;
  unitId?: number;
  /** relative to `dir` */
  file?: string;
}

export class ConfigError extends Error {
  readonly configPath: string | undefined;
  constructor(message: string, configPath?: string) {
    super(message);
    this.name = 'ConfigError';
    this.configPath = configPath;
  }
}

export interface ConfigFs {
  existsSync(p: string): boolean;
  isFile(p: string): boolean;
  readFileSync(p: string): string;
}

export const nodeFs: ConfigFs = {
  existsSync,
  isFile: (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
  readFileSync: (p) => readFileSync(p, 'utf8'),
};

/** Walk up from `startDir` to the filesystem root; first `.bootquest.json` file wins. */
export function findConfigPath(startDir: string, fs: ConfigFs = nodeFs): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILE);
    if (fs.existsSync(candidate) && fs.isFile(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Validate the parsed JSON (hand-rolled: the CLI's only runtime dependency is commander). */
export function parseConfig(text: string, configPath: string): ProjectConfig {
  const where = configPath;
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new ConfigError(`${where} is not valid JSON (${err instanceof Error ? err.message : String(err)})`, configPath);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${where} must contain a JSON object like {"unitKey": "...", "file": "src/main.js"}`, configPath);
  }
  const obj = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknownKeys.length) {
    throw new ConfigError(`${where} has unknown key(s): ${unknownKeys.join(', ')} (allowed: unitKey, unitId, file)`, configPath);
  }
  const hasKey = obj.unitKey !== undefined;
  const hasId = obj.unitId !== undefined;
  if (hasKey === hasId) {
    throw new ConfigError(`${where} must set exactly one of "unitKey" or "unitId"`, configPath);
  }
  const cfg: ProjectConfig = { path: configPath, dir: dirname(configPath) };
  if (hasKey) {
    if (typeof obj.unitKey !== 'string' || obj.unitKey.trim() === '') {
      throw new ConfigError(`${where}: "unitKey" must be a non-empty string`, configPath);
    }
    cfg.unitKey = obj.unitKey.trim();
  } else {
    if (typeof obj.unitId !== 'number' || !Number.isSafeInteger(obj.unitId) || obj.unitId < 1) {
      throw new ConfigError(`${where}: "unitId" must be a positive integer`, configPath);
    }
    cfg.unitId = obj.unitId;
  }
  if (obj.file !== undefined) {
    if (typeof obj.file !== 'string' || obj.file.trim() === '') {
      throw new ConfigError(`${where}: "file" must be a non-empty string`, configPath);
    }
    if (isAbsolute(obj.file)) {
      throw new ConfigError(`${where}: "file" must be relative to the project (got absolute path ${obj.file})`, configPath);
    }
    cfg.file = obj.file;
  }
  return cfg;
}

/** Find + read + validate. `null` when no .bootquest.json exists up the tree. */
export function loadConfig(startDir: string, fs: ConfigFs = nodeFs): ProjectConfig | null {
  const path = findConfigPath(startDir, fs);
  if (path === null) return null;
  let text: string;
  try {
    text = fs.readFileSync(path);
  } catch (err) {
    throw new ConfigError(`cannot read ${path} (${err instanceof Error ? err.message : String(err)})`, path);
  }
  return parseConfig(text, path);
}

/**
 * The file to send: explicit path argument (relative to cwd) wins, else the
 * config's `file` (relative to the config dir). Throws ConfigError when neither.
 */
export function resolveSubmissionFile(pathArg: string | undefined, cwd: string, config: ProjectConfig | null): string {
  if (pathArg !== undefined && pathArg.trim() !== '') return resolve(cwd, pathArg);
  if (config?.file !== undefined) return resolve(config.dir, config.file);
  throw new ConfigError(
    config
      ? `no file to send: pass a path (bootquest submit src/main.js) or add "file" to ${config.path}`
      : `no file to send: pass a path, or create ${CONFIG_FILE} with {"unitKey": "...", "file": "..."}`,
    config?.path,
  );
}
