import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILE, ConfigError, findConfigPath, loadConfig, parseConfig, resolveSubmissionFile } from '../src/config.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bq-cli-config-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('findConfigPath (walk-up)', () => {
  it('finds .bootquest.json in the start dir', () => {
    writeFileSync(join(root, CONFIG_FILE), '{"unitId": 1}');
    expect(findConfigPath(root)).toBe(join(root, CONFIG_FILE));
  });

  it('walks up from a nested directory', () => {
    writeFileSync(join(root, CONFIG_FILE), '{"unitId": 1}');
    const deep = join(root, 'src', 'lib', 'deep');
    mkdirSync(deep, { recursive: true });
    expect(findConfigPath(deep)).toBe(join(root, CONFIG_FILE));
  });

  it('the nearest config wins', () => {
    writeFileSync(join(root, CONFIG_FILE), '{"unitId": 1}');
    const sub = join(root, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, CONFIG_FILE), '{"unitId": 2}');
    expect(findConfigPath(join(sub))).toBe(join(sub, CONFIG_FILE));
    expect(loadConfig(sub)?.unitId).toBe(2);
  });

  it('ignores a DIRECTORY named .bootquest.json', () => {
    mkdirSync(join(root, 'p', CONFIG_FILE), { recursive: true });
    writeFileSync(join(root, CONFIG_FILE), '{"unitId": 9}');
    expect(findConfigPath(join(root, 'p'))).toBe(join(root, CONFIG_FILE));
  });

  it('returns null when nothing exists up to the filesystem root (injected fs)', () => {
    const fs = { existsSync: () => false, isFile: () => false, readFileSync: () => '' };
    expect(findConfigPath(join(root, 'a', 'b'), fs)).toBeNull();
    expect(loadConfig(join(root, 'a', 'b'), fs)).toBeNull();
  });
});

describe('parseConfig', () => {
  const P = 'C:/proj/.bootquest.json';

  it('accepts unitKey + file', () => {
    const c = parseConfig('{"unitKey": " k/1 ", "file": "src/a.js"}', P);
    expect(c).toMatchObject({ unitKey: 'k/1', file: 'src/a.js', path: P });
    expect(c.unitId).toBeUndefined();
  });

  it('accepts unitId alone and tolerates a UTF-8 BOM', () => {
    expect(parseConfig('\uFEFF{"unitId": 42}', P).unitId).toBe(42);
  });

  it.each([
    ['malformed JSON', '{"unitId": 1,', /not valid JSON/],
    ['empty file', '', /not valid JSON/],
    ['array', '[1]', /must contain a JSON object/],
    ['null', 'null', /must contain a JSON object/],
    ['neither key', '{"file": "a.js"}', /exactly one of "unitKey" or "unitId"/],
    ['both keys', '{"unitKey": "k", "unitId": 1}', /exactly one/],
    ['unknown key', '{"unitId": 1, "server": "x"}', /unknown key\(s\): server/],
    ['empty unitKey', '{"unitKey": "  "}', /non-empty string/],
    ['string unitId', '{"unitId": "12"}', /positive integer/],
    ['zero unitId', '{"unitId": 0}', /positive integer/],
    ['fractional unitId', '{"unitId": 1.5}', /positive integer/],
    ['absolute file', '{"unitId": 1, "file": "C:/abs/x.js"}', /must be relative/],
    ['empty file', '{"unitId": 1, "file": ""}', /"file" must be a non-empty string/],
  ])('rejects %s with a ConfigError naming the file', (_name, text, msg) => {
    let caught: unknown;
    try {
      parseConfig(text, P);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toMatch(msg);
    expect((caught as ConfigError).message).toContain(P);
  });

  it('loadConfig surfaces malformed JSON on disk as ConfigError', () => {
    writeFileSync(join(root, CONFIG_FILE), '{ nope');
    expect(() => loadConfig(root)).toThrow(ConfigError);
  });
});

describe('resolveSubmissionFile', () => {
  it('an explicit path is relative to the cwd', () => {
    const cfg = parseConfig('{"unitId": 1, "file": "src/a.js"}', join(root, CONFIG_FILE));
    expect(resolveSubmissionFile('other.js', join(root, 'src'), cfg)).toBe(join(root, 'src', 'other.js'));
  });

  it('config "file" is relative to the config dir, not the cwd', () => {
    const cfg = parseConfig('{"unitId": 1, "file": "src/a.js"}', join(root, CONFIG_FILE));
    expect(resolveSubmissionFile(undefined, join(root, 'deep', 'er'), cfg)).toBe(join(root, 'src', 'a.js'));
  });

  it('missing file everywhere is a ConfigError with guidance', () => {
    const cfg = parseConfig('{"unitId": 1}', join(root, CONFIG_FILE));
    expect(() => resolveSubmissionFile(undefined, root, cfg)).toThrow(/add "file" to/);
    expect(() => resolveSubmissionFile(undefined, root, null)).toThrow(/create \.bootquest\.json/);
  });
});
