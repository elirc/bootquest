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
//     indented and fenced bullets stay code. Ordered "1." lists are not parsed (literal text).
// It builds React nodes only (never innerHTML), so every character of the source is rendered
// as text. No markdown library: anything it does not understand stays literal text.

import { Fragment, type ReactNode } from 'react';

export type ProseBlock = { kind: 'p'; lines: string[] } | { kind: 'code'; text: string; lang: string | null } | { kind: 'list'; items: string[] };

const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*([\w#+.-]*)\s*$/;
const INDENT_RE = /^( {4}|\t)/;
const NUMBERED_RE = /^(\d{1,3}) +\S/;
const NUMBER_PREFIX_RE = /^\d{1,3} +/;
const CLOSE_FENCE_RE = /^\s{0,3}(```+|~~~+)\s*$/;
const CODE_CHAR_RE = /[({;=]/;
const LIST_RE = /^\s{0,3}[-*+] +(\S.*)$/;

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
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]!);
        if (!m) break;
        items.push(m[1]!.trimEnd());
        i++;
      }
      out.push({ kind: 'list', items });
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
    case 'p':
      return <p key={key}>{renderLines(b.lines)}</p>;
    default: {
      const never: never = b;
      return never;
    }
  }
}

/** Already-parsed blocks: paragraphs (<p>), bullet lists (<ul class="prose-list">) and code blocks (<pre class="code-block">). */
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
