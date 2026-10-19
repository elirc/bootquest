import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '../lib/keys';
import { PLAYER_SHORTCUTS } from '../lib/shortcuts';
import { Kbd } from './ui';

const DOCS = [...SHORTCUTS, ...PLAYER_SHORTCUTS];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    ref.current?.focus();
    // Capture phase on window runs before every page handler (they listen on window's bubble
    // phase). The overlay owns the keyboard while it is open: Escape closes it, and every other
    // key stops here so no page shortcut fires behind it (Enter submitting a quiz, 1-4 grading a
    // review card, "i" opening Learn more). Native behaviour is untouched: Tab still moves focus
    // and Enter/Space still activate the focused control, because nothing is preventDefault-ed.
    // "?" passes through: the shell's own handler toggles this overlay closed with it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== '?') e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose]);

  const scopes = [...new Set(DOCS.map((s) => s.scope))];
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="kb-title" tabIndex={-1} ref={ref}>
        <header className="dialog-head">
          <h2 id="kb-title">Keyboard shortcuts</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close <Kbd>Esc</Kbd>
          </button>
        </header>
        <div className="kb-grid">
          {scopes.map((scope) => (
            <section key={scope}>
              <h3 className="kb-scope">{scope}</h3>
              <dl className="kb-list">
                {DOCS.filter((s) => s.scope === scope).map((s) => (
                  <div key={s.label} className="kb-row">
                    <dt>{s.label}</dt>
                    <dd>
                      {s.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
