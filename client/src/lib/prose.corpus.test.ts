// qw H3 corpus guard: every Prose-rendered field shipped in content/packs/** and content/units/**
// must parse without a list that breaks off mid-item. The defect this pins: an authored item that
// wraps onto an indented line ("1. **x**\n   more") used to end its list after the first line, so
// the rest of the item, and every later item, ran on inside a paragraph as literal "2. …" text.
// New content is held to the same rule: wrapped list items are indented by at least one space.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseProse } from './prose';

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content');
/** the fields the client renders through Prose / ProseBlocks (Player, WrittenPane, Review) */
const PROSE_FIELDS = new Set(['instructions', 'prompt', 'question', 'modelAnswer', 'front', 'back']);
const ITEM_RE = /^\s{0,3}(?:[-*+]|\d{1,3}[.)]) +\S/;

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsonFiles(p);
    return name.endsWith('.json') && !/^(validation|manifest|quarantine|review-queue)\.json$/.test(name) ? [p] : [];
  });
}

function proseValues(v: unknown, key: string, out: string[]): void {
  if (typeof v === 'string') {
    if (PROSE_FIELDS.has(key) && v.includes('\n')) out.push(v);
  } else if (Array.isArray(v)) {
    for (const x of v) proseValues(x, key, out);
  } else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) proseValues(x, k, out);
  }
}

/** a list block followed by a paragraph that is really the list's continuation */
function brokenLists(src: string): string[] {
  const blocks = parseProse(src);
  const bad: string[] = [];
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    if ((b.kind !== 'list' && b.kind !== 'olist') || next?.kind !== 'p') return;
    if (/^\s+\S/.test(next.lines[0]!) || next.lines.some((l) => ITEM_RE.test(l))) bad.push(next.lines[0]!.trim().slice(0, 60));
  });
  return bad;
}

describe('prose corpus guard (content/packs, content/units)', () => {
  const files = ['packs', 'units'].flatMap((d) => jsonFiles(join(CONTENT, d)));

  it('finds the content (the guard is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(50);
    const values = files.flatMap((f) => {
      const out: string[] = [];
      proseValues(JSON.parse(readFileSync(f, 'utf8')), '', out);
      return out;
    });
    expect(values.length).toBeGreaterThan(1000);
    expect(values.filter((v) => parseProse(v).some((b) => b.kind === 'olist')).length).toBeGreaterThan(30);
  });

  it('no list ends mid-item: no list block is followed by an indented or marker-carrying paragraph', () => {
    const failures: string[] = [];
    for (const f of files) {
      const values: string[] = [];
      proseValues(JSON.parse(readFileSync(f, 'utf8')), '', values);
      for (const v of values) for (const line of brokenLists(v)) failures.push(`${relative(CONTENT, f)}: "${line}"`);
    }
    expect(failures).toEqual([]);
  });
});
