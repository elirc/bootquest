import { afterEach, describe, expect, it } from 'vitest';
import { activationOwnedByFocus, bareKeyBlocked, enterActsOnFocus, keysOwnedByFocus, shortcutBlocked, typingOrChord } from './shortcuts';

const ev = (key: string, target: EventTarget, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, ...init });
  Object.defineProperty(e, 'target', { value: target });
  return e;
};

const el = (html: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('lib/shortcuts: composable gates', () => {
  it('shortcutBlocked: repeat, handled, or any overlay (dialog, alertdialog, aria-modal, open <dialog>)', () => {
    expect(shortcutBlocked(ev('1', document.body))).toBe(false);
    expect(shortcutBlocked(ev('1', document.body, { repeat: true }))).toBe(true);
    for (const html of ['<div role="dialog"></div>', '<div role="alertdialog"></div>', '<div aria-modal="true"></div>', '<dialog open></dialog>']) {
      const host = el(html);
      expect(shortcutBlocked(ev('1', document.body))).toBe(true);
      host.remove();
    }
  });

  it('typingOrChord: modifiers and editable targets', () => {
    const host = el('<input type="text"><input type="radio">');
    const [text, radio] = Array.from(host.querySelectorAll('input'));
    expect(typingOrChord(ev('1', text!))).toBe(true);
    expect(typingOrChord(ev('1', radio!))).toBe(false);
    expect(typingOrChord(ev('1', document.body, { ctrlKey: true }))).toBe(true);
    expect(typingOrChord(ev('1', document.body))).toBe(false);
  });

  it('activationOwnedByFocus is stricter than enterActsOnFocus (radios and any input own Space / Enter)', () => {
    const host = el('<input type="radio"><button>b</button>');
    const radio = host.querySelector('input')!;
    const button = host.querySelector('button')!;
    expect(enterActsOnFocus(radio)).toBe(false);
    expect(activationOwnedByFocus(radio)).toBe(true);
    expect(activationOwnedByFocus(button)).toBe(true);
    expect(activationOwnedByFocus(document.body)).toBe(false);
  });

  it('keysOwnedByFocus / bareKeyBlocked: digits inside a radiogroup or listbox belong to the widget', () => {
    const host = el('<div role="radiogroup"><span id="r"></span></div><div role="listbox"><span id="l"></span></div><a href="#x" id="a">a</a>');
    const r = host.querySelector('#r')!;
    const l = host.querySelector('#l')!;
    const a = host.querySelector('#a')!;
    expect(keysOwnedByFocus(r)).toBe(true);
    expect(keysOwnedByFocus(l)).toBe(true);
    expect(bareKeyBlocked(ev('1', r))).toBe(true);
    expect(bareKeyBlocked(ev('1', document.body))).toBe(false);
    // a focused link owns Space / Enter, not digits
    expect(bareKeyBlocked(ev(' ', a))).toBe(true);
    expect(bareKeyBlocked(ev('Enter', a))).toBe(true);
    expect(bareKeyBlocked(ev('2', a))).toBe(false);
    expect(bareKeyBlocked(ev('2', document.body, { altKey: true }))).toBe(true);
  });
});
