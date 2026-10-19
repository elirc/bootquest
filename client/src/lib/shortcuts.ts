// The ONE gate every page-level keyboard shortcut goes through before it acts.
//
// A window keydown handler sees every key press on the page, including ones meant for a
// focused button, a dialog in front of the page, or an auto-repeating held key. Acting on
// those recorded real attempts the learner never asked for (Tab to "Back to campaign" +
// Enter submitted the quiz; Enter on the reveal confirm's Cancel submitted the quiz behind
// it; holding Enter re-recorded the same wrong answer). Every page shortcut checks
// shortcutBlocked() first, and Enter-to-submit additionally checks enterActsOnFocus().
import type { ShortcutDoc } from './keys';

/** Anything rendered as a dialog in front of the page: the shortcut help, the Learn-more drawer, inline confirms. */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"]';

export const overlayOpen = (): boolean => typeof document !== 'undefined' && document.querySelector(OVERLAY_SELECTOR) !== null;

/**
 * True when a page shortcut must leave this key event alone: another handler already took it,
 * it is an auto-repeat of a held key, or a dialog / overlay owns the keyboard.
 */
export function shortcutBlocked(e: KeyboardEvent): boolean {
  return e.defaultPrevented || e.repeat || overlayOpen();
}

const ACTIVATING = 'a[href], button, summary, select, textarea, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"]';
const ACTIVATING_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'file', 'color', 'image']);

/**
 * True when Enter on the focused element already means something (a button or link activates,
 * a select opens, a textarea gets a newline, a checkbox toggles): an Enter-to-submit shortcut
 * must then do nothing and let the focused control act. Radios and text inputs are NOT
 * activating: Enter there is free for the page's own "submit the answer" meaning.
 */
export function enterActsOnFocus(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) return ACTIVATING_INPUTS.has(target.type);
  return target.closest(ACTIVATING) !== null;
}

/** Shortcut-help rows for the player keys documented here (merged into the help overlay). */
export const PLAYER_SHORTCUTS: ShortcutDoc[] = [
  { keys: ['Enter'], label: 'Check the quiz answer (when focus is not on a button or link)', scope: 'Exercise' },
  { keys: ['Tab'], label: 'Indent in the code editor (Shift+Tab outdents)', scope: 'Exercise' },
  { keys: ['Esc', 'Tab'], label: 'Leave the code editor (Esc first, then Tab / Shift+Tab)', scope: 'Exercise' },
];
