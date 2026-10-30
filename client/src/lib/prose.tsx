// W9 (ui-audit #2/#3): a TINY, escape-safe prose renderer for unit instructions, quiz prompts,
// choices and review cards. It understands exactly what the content packs use:
//   - ``` fenced code blocks (optional language tag), with or without surrounding blank lines
//   - 4-space / tab indented code blocks (after a blank line or at the start)
//   - line-numbered listings ("1 app.patch(...)", "2   const x = ...") — consecutive lines
//     numbered 1, 2, 3 … — kept verbatim as code (review tasks cite those numbers). W10: a run
//     counts as code only with 3+ lines or a code-like character ( ( { ; = ) in some line, so
//     a two-step prose list ("1 Read the guide" / "2 Take the quiz") stays prose
//   - W10: a fence closes only on a line that is EXACTLY a marker of the same character and at
//     least the opening length (CommonMark), so a ``` inside a code line does not end the block
//   - inline `code` and **bold**
//   - a line ending in two spaces is a hard break; other single newlines are soft wraps
//   - "- item" / "* item" / "+ item" bullet lines (≤3 leading spaces): one <li> per line; a
//     bullet line interrupts a paragraph (the sysdrills "Steps:\n- a\n- b" shape). 4-space
//     indented and fenced bullets stay code.
//   - "1. item" / "1) item" ordered lines (≤3 leading spaces): one <li> per line in an <ol>
//     (start kept when ≠ 1). Same discipline as bullets, except an ordered line interrupts a
//     paragraph only when it starts at 1 (CommonMark), so "12. see the appendix" mid-paragraph
//     stays prose. "1 app.patch(" (space after the number) is the numbered LISTING, not a list.
//   - qw: a list item may wrap: a following line indented by 1 to (marker width + 3) spaces that
//     is not itself a list or fence line joins the item ("1. **x**\n   more"). Any other non-blank
//     run (unindented, or deeper than that cap) joins an ORDERED item only when the list's next
//     item follows before a blank line (a lazy continuation); otherwise it ends the list as
//     before, so the width + 3 cap binds only when no next item follows. Ordered lists
//     separated only by blank lines merge when the numbering continues ("1. a\n\n2. b" = one <ol>).
// It builds React nodes only (never innerHTML), so every character of the source is rendered
// as text. No markdown library: anything it does not understand stays literal text.

import { Fragment, type ReactNode } from 'react';

export type ProseBlock =
  | { kind: 'p'; lines: string[] }
  | { kind: 'code'; text: string; lang: string | null }
  | { kind: 'list'; items: string[] }
  | { kind: 'olist'; items: string[]; start: number };

const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*([\w#+.-]*)\s*$/;
const INDENT_RE = /^( {4}|\t)/;
const NUMBERED_RE = /^(\d{1,3}) +\S/;
const NUMBER_PREFIX_RE = /^\d{1,3} +/;
const CLOSE_FENCE_RE = /^\s{0,3}(```+|~~~+)\s*$/;
const CODE_CHAR_RE = /[({;=]/;
const LIST_RE = /^\s{0,3}[-*+] +(\S.*)$/;
// an ordered-list item: "1. x" / "2) x". Provably disjoint from NUMBERED_RE (the listing): a
// listing line has a SPACE directly after the digits, a list item has "." or ")" there.
const OLIST_RE = /^\s{0,3}(\d{1,3})[.)] +(\S.*)$/;

/** W10: does `line` close a fence opened with `marker` (same character, same or longer run)? */
export function closesFence(line: string, marker: string): boolean {
  const m = CLOSE_FENCE_RE.exec(line);
  return m !== null && m[1]![0] === marker[0] && m[1]!.length >= marker.length;
}

/** Split prose into paragraph and code blocks. Pure; exported for tests. */
export function parseProse(src: string): ProseBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: ProseBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', lines: para });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !closesFence(lines[i]!, marker)) body.push(lines[i++]!);
      i++; // the closing fence (or EOF: an unclosed fence runs to the end)
      out.push({ kind: 'code', text: body.join('\n'), lang: fence[2] || null });
      continue;
    }
    if (line.trim() === '') {
      flush();
      i++;
      continue;
    }
    // indented code: only where a paragraph could not be continuing (start / after a blank)
    if (para.length === 0 && INDENT_RE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (INDENT_RE.test(lines[i]!) || (lines[i]!.trim() === '' && INDENT_RE.test(lines[i + 1] ?? '')))) {
        body.push(lines[i++]!);
      }
      out.push({ kind: 'code', text: dedent(body), lang: null });
      continue;
    }
    // a bullet list: after the fence / blank / indented-code branches, so a 4-space-indented or
    // fenced "- x" stays code. A bullet line interrupts a paragraph; one item per line.
    if (LIST_RE.test(line)) {
      flush();
      const items: string[] = [];
      let width = 0;
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]!);
        if (m) {
          items.push(m[1]!.trimEnd());
          width = lines[i]!.length - m[1]!.length;
        } else {
          const more = continuation(lines[i]!, width);
          if (more === null) break;
          items[items.length - 1] += ` ${more}`;
        }
        i++;
      }
      out.push({ kind: 'list', items });
      continue;
    }
    // an ordered list: "1. item" / "2) item". Same discipline as bullets (after the fence / blank /
    // indented-code branches). It interrupts a paragraph only when it starts at 1 (CommonMark), so a
    // prose line like "12. see the appendix" mid-paragraph stays prose. Disjoint from the numbered
    // LISTING heuristic below: a listing line has a SPACE after the number ("1 app.patch("), a list
    // item has "." or ")".
    const ol = OLIST_RE.exec(line);
    if (ol && (para.length === 0 || ol[1] === '1')) {
      flush();
      const start = Number(ol[1]);
      const items: string[] = [];
      let width = 0;
      while (i < lines.length) {
        const m = OLIST_RE.exec(lines[i]!);
        if (m) {
          items.push(m[2]!.trimEnd());
          width = lines[i]!.length - m[2]!.length;
        } else {
          const more = continuation(lines[i]!, width);
          if (more !== null) {
            items[items.length - 1] += ` ${more}`;
          } else {
            // a LAZY (unindented) continuation joins the item only when the next item of this
            // list follows before any blank line; otherwise the line ends the list
            const j = lazyRun(lines, i, start + items.length);
            if (j === i) break;
            items[items.length - 1] += ` ${lines.slice(i, j).map((l) => l.trim()).join(' ')}`;
            i = j;
            continue;
          }
        }
        i++;
      }
      // a loose list ("1. a", blank, "2. b"): only blank lines can separate it from the previous
      // ordered list (any other line would have produced a block in between), and its numbering
      // continues that list, so it is the same <ol>
      const prev = out[out.length - 1];
      if (prev?.kind === 'olist' && start === prev.start + prev.items.length) prev.items.push(...items);
      else out.push({ kind: 'olist', items, start });
      continue;
    }
    // a numbered listing: "1 …", "2 …" … on consecutive lines. W10: code only when the run has
    // 3+ lines or a code-like character after a number; otherwise the lines stay prose
    if (numberAt(line) === 1 && numberAt(lines[i + 1] ?? '') === 2) {
      const run: string[] = [];
      for (let j = i, n = 1; j < lines.length && numberAt(lines[j]!) === n; j++, n++) run.push(lines[j]!);
      if (run.length >= 3 || run.some((l) => CODE_CHAR_RE.test(l.replace(NUMBER_PREFIX_RE, '')))) {
        flush();
        out.push({ kind: 'code', text: run.join('\n'), lang: null });
        i += run.length;
        continue;
      }
    }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

/**
 * qw: a wrapped list item's next line ("1. **x**\n   more text"). A non-blank line indented by 1 to
 * (marker width + 3) spaces continues the current item, unless it is itself a list item or a fence
 * line; `width` is the column where the item's text starts. Returns the trimmed text, or null.
 */
function continuation(line: string, width: number): string | null {
  if (line.trim() === '' || LIST_RE.test(line) || OLIST_RE.test(line) || FENCE_RE.test(line)) return null;
  const indent = /^ */.exec(line)![0].length;
  return indent >= 1 && indent <= width + 3 ? line.trim() : null;
}

/**
 * Lines i..j-1 (at any indent: the width + 3 cap does not apply here) are a lazy continuation of an
 * ordered item when they are non-blank, start no list or
 * fence, and line j is the list's NEXT item (numbered `next`). Returns j, or i when that is not so.
 */
function lazyRun(lines: string[], i: number, next: number): number {
  let j = i;
  while (j < lines.length && lines[j]!.trim() !== '' && !LIST_RE.test(lines[j]!) && !FENCE_RE.test(lines[j]!)) {
    const m = OLIST_RE.exec(lines[j]!);
    if (m) return j > i && Number(m[1]) === next ? j : i;
    j++;
  }
  return i;
}

function numberAt(line: string): number | null {
  const m = NUMBERED_RE.exec(line);
  return m ? Number(m[1]) : null;
}

function dedent(lines: string[]): string {
  const ind = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => (l.startsWith('\t') ? 1 : /^ */.exec(l)![0].length)));
  return lines.map((l) => (l.startsWith('\t') ? l.slice(1) : l.slice(Math.min(ind, 4)))).join('\n');
}

/** Inline spans: `code` and **bold**; everything else is literal text. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // code spans first (their contents are never further parsed), then bold in the gaps
  const re = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const code = m[2]!;
      // CommonMark: one leading+trailing space is stripped when both are present
      out.push(<code key={k++}>{/^ .* $/s.test(code) && code.trim() !== '' ? code.slice(1, -1) : code}</code>);
    } else {
      out.push(<strong key={k++}>{renderInline(m[3]!)}</strong>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Paragraph lines → inline nodes; "  " line ends are hard breaks, other newlines soft. */
function renderLines(lines: string[]): ReactNode[] {
  return lines.map((l, i) => {
    const hard = / {2,}$/.test(l);
    const body = renderInline(hard ? l.replace(/ +$/, '') : l);
    const sep = i === lines.length - 1 ? null : hard ? <br /> : ' ';
    return (
      <Fragment key={i}>
        {body}
        {sep}
      </Fragment>
    );
  });
}

/** One parsed block → its element. Exhaustive over ProseBlock['kind'] (a new kind fails typecheck). */
function renderBlock(b: ProseBlock, key: number): ReactNode {
  switch (b.kind) {
    case 'code':
      return (
        <pre key={key} className="code-block" data-lang={b.lang ?? undefined}>
          {b.text}
        </pre>
      );
    case 'list':
      return (
        <ul key={key} className="prose-list">
          {b.items.map((t, j) => (
            <li key={j}>{renderInline(t)}</li>
          ))}
        </ul>
      );
    case 'olist':
      return (
        <ol key={key} className="prose-list" {...(b.start !== 1 ? { start: b.start } : {})}>
          {b.items.map((t, j) => (
            <li key={j}>{renderInline(t)}</li>
          ))}
        </ol>
      );
    case 'p':
      return <p key={key}>{renderLines(b.lines)}</p>;
    default: {
      const never: never = b;
      return never;
    }
  }
}

/** Already-parsed blocks: paragraphs (<p>), bullet lists (<ul class="prose-list">), ordered lists (<ol class="prose-list">) and code blocks (<pre class="code-block">). */
export function ProseBlocks({ blocks }: { blocks: ProseBlock[] }) {
  return <>{blocks.map(renderBlock)}</>;
}

/** Block prose from source text. */
export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`prose${className ? ` ${className}` : ''}`}>
      <ProseBlocks blocks={parseProse(text)} />
    </div>
  );
}

/**
 * Split a quiz / predict prompt into a heading line and what follows it (code, more prose).
 * W10: only a LEADING paragraph becomes the heading. A prompt that opens with code keeps its
 * source order under the caller's fallback heading (heading ''), so prose written AFTER the
 * code is never hoisted above it.
 */
export function splitPrompt(text: string): { heading: string; rest: ProseBlock[] } {
  const blocks = parseProse(text);
  const first = blocks[0];
  if (!first || first.kind !== 'p') return { heading: '', rest: blocks };
  return { heading: first.lines.join('\n'), rest: blocks.slice(1) };
}

/** Split prose into chunks at blank lines OUTSIDE ``` fences (a fence may contain blank lines). */
export function proseChunks(src: string): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    const f = FENCE_RE.exec(line);
    if (fence === null && f) fence = f[1]!;
    else if (fence !== null && closesFence(line, fence)) fence = null;
    if (fence === null && line.trim() === '' && !f) {
      if (cur.length) chunks.push(cur.join('\n'));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks;
}

/** One-line inline prose (choices, headings, card fronts): newlines are kept as soft wraps. */
export function InlineProse({ text }: { text: string }) {
  return <>{renderLines(text.replace(/\r\n?/g, '\n').split('\n'))}</>;
}
