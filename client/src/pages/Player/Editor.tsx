// The code editor of the exercise player: a textarea with a line gutter and code-editor Tab /
// Shift+Tab indenting (Esc, then Tab, leaves it: no keyboard trap).
import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

type Edit = { value: string; start: number; end: number };

/** Line-start offsets of every line the selection [start, end) touches. */
function selectedLineStarts(v: string, start: number, end: number): number[] {
  const first = v.lastIndexOf('\n', start - 1) + 1;
  // a selection ending right after a newline does not include the next line
  const last = end > start && v[end - 1] === '\n' ? end - 1 : end;
  const starts = [first];
  for (let i = v.indexOf('\n', first); i !== -1 && i < last; i = v.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** Tab: a caret or a one-line selection inserts one indent; a multi-line selection indents every line. */
function indentText(v: string, start: number, end: number, unit: string): Edit {
  if (!v.slice(start, end).includes('\n')) {
    return { value: v.slice(0, start) + unit + v.slice(end), start: start + unit.length, end: start + unit.length };
  }
  const starts = selectedLineStarts(v, start, end);
  let out = v;
  for (const s of [...starts].reverse()) out = out.slice(0, s) + unit + out.slice(s);
  return { value: out, start: start + unit.length, end: end + unit.length * starts.length };
}

/** Shift+Tab: remove up to one indent (spaces, or one tab) from the start of every touched line. */
function outdentText(v: string, start: number, end: number, unit: string): Edit {
  const starts = selectedLineStarts(v, start, end);
  let out = v;
  let newStart = start;
  let newEnd = end;
  for (const s of [...starts].reverse()) {
    const lead = out.slice(s, s + unit.length);
    const n = lead.startsWith('\t') ? 1 : lead.length - lead.trimStart().length;
    if (n === 0) continue;
    out = out.slice(0, s) + out.slice(s + n);
    // shift the selection ends that sit after the removed characters
    if (start > s) newStart -= Math.min(n, start - s);
    if (end > s) newEnd -= Math.min(n, end - s);
  }
  return { value: out, start: newStart, end: newEnd };
}

/** Indent unit per language: 4 spaces for C# / Java (their conventions), 2 for JS / TS and the rest. */
const indentFor = (language: string) => (/^(c#|java)$/i.test(language.trim()) ? '    ' : '  ');

/**
 * The code editor: a plain textarea with a line gutter. Tab / Shift+Tab indent and outdent like a
 * code editor; to keep the keyboard path out of the editor (WCAG 2.1.2, no keyboard trap) Escape
 * arms the next Tab to move focus as usual (the CodeMirror convention), as the hint above says.
 */
export function CodeEditor({ value, onChange, language, describedBy }: { value: string; onChange: (v: string) => void; language: string; describedBy?: string }) {
  const lines = Math.max(value.split('\n').length, 12);
  const gutter = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const escaped = useRef(false);
  const pendingSelection = useRef<[number, number] | null>(null);
  const unit = indentFor(language);

  // a programmatic edit replaces the value: put the caret / selection where the edit says
  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    if (sel && text.current) {
      text.current.setSelectionRange(sel[0], sel[1]);
      pendingSelection.current = null;
    }
  }, [value]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      escaped.current = true;
      return;
    }
    if (e.key !== 'Tab') {
      if (e.key !== 'Shift') escaped.current = false;
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || escaped.current) {
      escaped.current = false; // Esc then Tab (or a modified Tab): the browser moves focus
      return;
    }
    e.preventDefault();
    const el = e.currentTarget;
    const edit = (e.shiftKey ? outdentText : indentText)(el.value, el.selectionStart, el.selectionEnd, unit);
    if (edit.value === el.value) return;
    pendingSelection.current = [edit.start, edit.end];
    onChange(edit.value);
  };

  return (
    <div className="editor">
      <div className="editor-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <textarea
        ref={text}
        className="editor-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          escaped.current = false;
        }}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={`Code editor (${language})`}
        aria-describedby={describedBy}
        rows={lines}
      />
    </div>
  );
}
