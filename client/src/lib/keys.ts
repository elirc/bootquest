import { useEffect, useRef } from 'react';

/** True when the key event should be left to a text field (inputs, textareas, contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(type);
  }
  return false;
}

export const hasModifier = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey || e.altKey;
/** Ctrl on Windows/Linux, Cmd on macOS. */
export const isMod = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

/**
 * Window-level keydown listener. The handler is kept in a ref so callers can pass an
 * inline closure without re-binding on every render.
 */
export function useKeydown(handler: (e: KeyboardEvent) => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const listener = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [enabled]);
}

/** Two-key "g <x>" navigation chords, GitHub style. */
export const GO_CHORDS: Record<string, { path: string; label: string }> = {
  d: { path: '/', label: 'Dashboard' },
  c: { path: '/campaign', label: 'Campaign' },
  r: { path: '/review', label: 'Review' },
  s: { path: '/stats', label: 'Stats' },
};

export const CHORD_WINDOW_MS = 1200;

export interface ShortcutDoc {
  keys: string[];
  label: string;
  scope: string;
}

export const SHORTCUTS: ShortcutDoc[] = [
  ...Object.entries(GO_CHORDS).map(([k, v]) => ({ keys: ['g', k], label: `Go to ${v.label}`, scope: 'Global' })),
  { keys: ['?'], label: 'Toggle this help', scope: 'Global' },
  { keys: ['j', 'k'], label: 'Next / previous step', scope: 'Campaign' },
  { keys: ['v'], label: 'Toggle list / skill-tree view', scope: 'Campaign' },
  { keys: ['↑', '↓', '←', '→'], label: 'Move between skill-tree nodes', scope: 'Campaign' },
  { keys: ['←', '→'], label: 'Switch track tab', scope: 'Campaign' },
  { keys: ['Ctrl', 'Enter'], label: 'Run checks', scope: 'Exercise' },
  { keys: ['Ctrl', 'Shift', 'Enter'], label: 'Submit attempt', scope: 'Exercise' },
  { keys: ['1–4'], label: 'Pick quiz answer', scope: 'Exercise' },
  { keys: ['i'], label: 'Learn more: readings, explanations after you answer', scope: 'Exercise' },
  { keys: ['Space'], label: 'Show answer', scope: 'Review' },
  { keys: ['1', '2', '3', '4'], label: 'Again / Hard / Good / Easy', scope: 'Review' },
  { keys: ['i'], label: 'Learn more about the card (after showing the answer)', scope: 'Review' },
];
