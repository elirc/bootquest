import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A rule left without its closing brace makes the browser swallow every rule after it, and
 * nothing in jsdom notices: app.css shipped that way from W10 (7cb7192) until the Learn-more
 * drawer screenshot showed an unstyled panel. Every stylesheet must close every block.
 */
const STYLES = dirname(fileURLToPath(import.meta.url));

/** Line of each `{` still open at the end of the file (comments and strings ignored). */
function unclosedBlocks(source: string): number[] {
  const open: number[] = [];
  let line = 1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n') line++;
    else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j++) if (source[j] === '\n') line++;
      i = stop - 1;
    } else if (ch === '"' || ch === "'") {
      const close = source.indexOf(ch, i + 1);
      i = close === -1 ? source.length : close;
    } else if (ch === '{') open.push(line);
    else if (ch === '}') {
      if (open.length === 0) return [-line];
      open.pop();
    }
  }
  return open;
}

describe('stylesheets', () => {
  const sheets = readdirSync(STYLES).filter((f) => f.endsWith('.css'));

  it('there are stylesheets to check', () => expect(sheets.length).toBeGreaterThan(0));

  for (const sheet of sheets) {
    it(`${sheet}: every block is closed`, () => {
      expect(unclosedBlocks(readFileSync(join(STYLES, sheet), 'utf8'))).toEqual([]);
    });
  }

  it('the checker catches the W10 shape (a rule that never closes)', () => {
    expect(unclosedBlocks('.a {\n  color: red;\n\n.b {\n  color: blue;\n}\n')).toEqual([1]);
    expect(unclosedBlocks('.a { content: "{"; }\n/* { */\n')).toEqual([]);
  });
});
