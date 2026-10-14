// W9 (ui-audit #2/#3): a TINY, escape-safe prose renderer for unit instructions, quiz prompts,
// choices and review cards. It understands exactly what the content packs use:
//   - ``` fenced code blocks (optional language tag), with or without surrounding blank lines
//   - 4-space / tab indented code blocks (after a blank line or at the start)
//   - line-numbered listings ("1 app.patch(...)", "2   const x = ...") — 2+ consecutive lines
//     numbered 1, 2, 3 … — kept verbatim as code (review tasks cite those numbers)
//   - inline `code` and **bold**
//   - a line ending in two spaces is a hard break; other single newlines are soft wraps
// It builds React nodes only (never innerHTML), so every character of the source is rendered
// as text. No markdown library: anything it does not understand stays literal text.

import { Fragment, type ReactNode } from 'react';

export type ProseBlock = { kind: 'p'; lines: string[] } | { kind: 'code'; text: string; lang: string | null };

const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*([\w#+.-]*)\s*$/;
const INDENT_RE = /^( {4}|\t)/;
const NUMBERED_RE = /^(\d{1,3}) +\S/;

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
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) body.push(lines[i++]!);
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
    // a numbered listing: "1 …", "2 …" … on consecutive lines (at least two)
    if (numberAt(line) === 1 && numberAt(lines[i + 1] ?? '') === 2) {
      flush();
      const body: string[] = [];
      let n = 1;
      while (i < lines.length && numberAt(lines[i]!) === n) {
        body.push(lines[i++]!);
        n++;
      }
      out.push({ kind: 'code', text: body.join('\n'), lang: null });
      continue;
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

/** Already-parsed blocks: paragraphs (<p>) and code blocks (<pre class="code-block">). */
export function ProseBlocks({ blocks }: { blocks: ProseBlock[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === 'code' ? (
          <pre key={i} className="code-block" data-lang={b.lang ?? undefined}>
            {b.text}
          </pre>
        ) : (
          <p key={i}>{renderLines(b.lines)}</p>
        ),
      )}
    </>
  );
}

/** Block prose from source text. */
export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`prose${className ? ` ${className}` : ''}`}>
      <ProseBlocks blocks={parseProse(text)} />
    </div>
  );
}

/** Split a quiz / predict prompt into a heading line and what follows it (code, more prose). */
export function splitPrompt(text: string): { heading: string; rest: ProseBlock[] } {
  const blocks = parseProse(text);
  const at = blocks.findIndex((b) => b.kind === 'p');
  if (at === -1) return { heading: '', rest: blocks };
  const head = blocks[at] as Extract<ProseBlock, { kind: 'p' }>;
  return { heading: head.lines.join('\n'), rest: blocks.filter((_, i) => i !== at) };
}

/** Split prose into chunks at blank lines OUTSIDE ``` fences (a fence may contain blank lines). */
export function proseChunks(src: string): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    const f = FENCE_RE.exec(line);
    if (fence === null && f) fence = f[1]!;
    else if (fence !== null && line.trim().startsWith(fence)) fence = null;
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
