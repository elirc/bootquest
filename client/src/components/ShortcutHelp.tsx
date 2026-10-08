import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '../lib/keys';
import { Kbd } from './ui';

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose]);

  const scopes = [...new Set(SHORTCUTS.map((s) => s.scope))];
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
                {SHORTCUTS.filter((s) => s.scope === scope).map((s) => (
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
