import { useState } from 'react';

/**
 * rv B (owner decision D6): "Copy prompt for Claude". The app NEVER calls a model: this builds a plain-text
 * prompt from what is already on screen (the question, the learner's own answer, the keyed answer or rubric,
 * the lesson section) and puts it on the clipboard for the learner's own Claude session. No network.
 */

export interface MissPrompt {
  /** where the item comes from, e.g. "Fundamentals · JS · 01 Values, types & coercion" */
  source: string;
  question: string;
  choices?: readonly string[];
  /** what the learner answered (a choice text, or their prose) */
  mine: string;
  /** the keyed answer, or the rubric key points */
  keyed: string;
  explanation?: string | null;
  /** the lesson section that teaches it (heading + text), when known */
  lesson?: string | null;
}

/** One prompt for a missed quiz question / an explain-back set; deterministic and newline-joined. */
export function buildClaudePrompt(items: readonly MissPrompt[], intent = 'I got this wrong in my study app. Help me understand it.'): string {
  const parts: string[] = [
    `${intent} Explain the idea behind the right answer, why my answer misses it, and give me one new question like it to check myself (do not just restate the answer).`,
  ];
  items.forEach((it, i) => {
    const block: string[] = [`--- ${items.length > 1 ? `Item ${i + 1} · ` : ''}${it.source}`, `Question: ${it.question}`];
    if (it.choices && it.choices.length > 0) block.push(`Choices:\n${it.choices.map((c, k) => `  ${String.fromCharCode(65 + k)}. ${c}`).join('\n')}`);
    block.push(`My answer: ${it.mine || '(blank)'}`, `Keyed answer: ${it.keyed}`);
    if (it.explanation) block.push(`Explanation: ${it.explanation}`);
    if (it.lesson) block.push(`Lesson section:\n${it.lesson}`);
    parts.push(block.join('\n'));
  });
  return parts.join('\n\n');
}

/**
 * The lesson section under `heading` (a `##` / `###` line of the markdown), up to the next heading of the same or
 * a higher level; null when the heading is not found.
 */
export function lessonSection(markdown: string | null | undefined, heading: string | null | undefined): string | null {
  if (!markdown || !heading) return null;
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^#{2,3}\s/.test(l) && l.replace(/^#{2,3}\s+/, '').trim() === heading.trim());
  if (start < 0) return null;
  const level = /^(#+)/.exec(lines[start]!)![1]!.length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i]!);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

/** Copies `text()` to the clipboard; if the clipboard is unavailable, shows the text to copy by hand. */
export function CopyPromptButton({ text, label = 'Copy prompt for Claude', testId = 'copy-prompt' }: { text: () => string; label?: string; testId?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [manual, setManual] = useState('');
  const copy = async () => {
    const t = text();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(t);
      setState('copied');
    } catch {
      setManual(t);
      setState('manual');
    }
  };
  return (
    <span className="copy-prompt" data-testid={testId}>
      <button type="button" className="btn btn-sm" onClick={() => void copy()} title="Copies a prompt for your own Claude session. The app never sends anything anywhere.">
        {label}
      </button>
      {state === 'copied' && (
        <span className="muted small" role="status">
          {' '}
          Copied. Paste it into your own Claude session.
        </span>
      )}
      {state === 'manual' && (
        <textarea className="answer-text copy-prompt-text" readOnly rows={6} value={manual} aria-label="Prompt to copy" onFocus={(e) => e.currentTarget.select()} />
      )}
    </span>
  );
}
