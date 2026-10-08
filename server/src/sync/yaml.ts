/**
 * A deliberately tiny YAML SUBSET parser for curriculum.yaml (no new
 * dependency: spec §2 "pin anything new" — nothing new is pulled in).
 *
 * Supported: block mappings, block sequences (`- ` items, incl. a mapping
 * starting on the dash line), flow sequences of scalars (`[a, b]`), scalars
 * (plain, 'single', "double"-quoted, integers, true/false/null), full-line and
 * trailing ` #` comments. Indentation must be spaces.
 * Anything else (tabs, anchors/aliases, tags, multi-line scalars, flow
 * mappings, multiple documents) is REFUSED with a line-numbered error — the
 * Zod schema validates the resulting value afterwards.
 */

export class YamlSubsetError extends Error {
  constructor(line: number, message: string) {
    super(`curriculum.yaml line ${line}: ${message}`);
    this.name = 'YamlSubsetError';
  }
}

interface Line {
  no: number;
  indent: number;
  text: string;
}

function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || raw[i - 1] === ' ')) return raw.slice(0, i);
  }
  return raw;
}

function scalar(raw: string, no: number): unknown {
  const v = raw.trim();
  if (v === '') return null;
  if (/^[&*!|>{]/.test(v)) throw new YamlSubsetError(no, `unsupported YAML construct: ${v}`);
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new YamlSubsetError(no, 'unterminated flow sequence');
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((p) => {
      const item = scalar(p, no);
      if (Array.isArray(item)) throw new YamlSubsetError(no, 'nested flow sequences are not supported');
      return item;
    });
  }
  if (v.startsWith('"')) {
    if (!v.endsWith('"') || v.length < 2) throw new YamlSubsetError(no, 'unterminated double-quoted string');
    return JSON.parse(v) as string;
  }
  if (v.startsWith("'")) {
    if (!v.endsWith("'") || v.length < 2) throw new YamlSubsetError(no, 'unterminated single-quoted string');
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

function tokenize(src: string): Line[] {
  const out: Line[] = [];
  const raw = src.replace(/^﻿/, '').split(/\r?\n/);
  raw.forEach((l, i) => {
    const no = i + 1;
    if (/^\s*\t/.test(l)) throw new YamlSubsetError(no, 'tabs are not allowed for indentation');
    if (/^(---|\.\.\.)\s*$/.test(l)) {
      if (out.length > 0) throw new YamlSubsetError(no, 'multiple YAML documents are not supported');
      return;
    }
    const text = stripComment(l).replace(/\s+$/, '');
    if (text.trim() === '') return;
    out.push({ no, indent: text.length - text.trimStart().length, text: text.trimStart() });
  });
  return out;
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/;

export function parseYamlSubset(src: string): unknown {
  const lines = tokenize(src);
  if (lines.length === 0) return null;
  let pos = 0;

  function parseBlock(indent: number): unknown {
    const first = lines[pos]!;
    if (first.indent !== indent) throw new YamlSubsetError(first.no, `unexpected indentation (${first.indent}, expected ${indent})`);
    return first.text.startsWith('- ') || first.text === '-' ? parseSeq(indent) : parseMap(indent);
  }

  function parseMap(indent: number, seed?: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = seed ?? {};
    while (pos < lines.length && lines[pos]!.indent === indent) {
      const l = lines[pos]!;
      if (l.text.startsWith('- ')) throw new YamlSubsetError(l.no, 'sequence item where a mapping key was expected');
      const m = KEY_RE.exec(l.text);
      if (!m) throw new YamlSubsetError(l.no, `expected "key: value", got ${JSON.stringify(l.text)}`);
      const key = m[1]!;
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new YamlSubsetError(l.no, `duplicate key ${key}`);
      pos++;
      if (m[2] !== undefined && m[2].trim() !== '') {
        out[key] = scalar(m[2], l.no);
      } else if (pos < lines.length && lines[pos]!.indent > indent) {
        out[key] = parseBlock(lines[pos]!.indent);
      } else if (pos < lines.length && lines[pos]!.indent === indent && lines[pos]!.text.startsWith('- ')) {
        // "key:\n- item" (sequence at the same indent as its key) is valid YAML
        out[key] = parseSeq(indent);
      } else {
        out[key] = null;
      }
    }
    if (pos < lines.length && lines[pos]!.indent > indent) {
      throw new YamlSubsetError(lines[pos]!.no, 'unexpected indentation');
    }
    return out;
  }

  function parseSeq(indent: number): unknown[] {
    const out: unknown[] = [];
    while (pos < lines.length && lines[pos]!.indent === indent && (lines[pos]!.text.startsWith('- ') || lines[pos]!.text === '-')) {
      const l = lines[pos]!;
      const rest = l.text === '-' ? '' : l.text.slice(2);
      const itemIndent = indent + 2 + (rest.length - rest.trimStart().length);
      const restT = rest.trim();
      pos++;
      if (restT === '') {
        out.push(pos < lines.length && lines[pos]!.indent > indent ? parseBlock(lines[pos]!.indent) : null);
        continue;
      }
      const m = KEY_RE.exec(restT);
      if (m) {
        // mapping starting on the dash line: "- repo: x" then "  role: y" at itemIndent
        const seed: Record<string, unknown> = {};
        if (m[2] !== undefined && m[2].trim() !== '') seed[m[1]!] = scalar(m[2], l.no);
        else if (pos < lines.length && lines[pos]!.indent > itemIndent) seed[m[1]!] = parseBlock(lines[pos]!.indent);
        else seed[m[1]!] = null;
        out.push(pos < lines.length && lines[pos]!.indent === itemIndent ? parseMap(itemIndent, seed) : seed);
      } else {
        out.push(scalar(restT, l.no));
      }
    }
    return out;
  }

  const value = parseBlock(lines[0]!.indent);
  if (pos < lines.length) throw new YamlSubsetError(lines[pos]!.no, 'unexpected content after the document');
  return value;
}
