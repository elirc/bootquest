// ab S4: Ctrl+K / Cmd+K "find a unit" palette over GET /api/units/search (unit key + title only,
// campaign quest units included). Keyboard-first: the input is a combobox over a listbox of hits,
// ↑/↓ move, Enter opens, Esc closes, Tab stays inside the dialog, focus returns to the opener.
//
// Honesty: a hit is a title, a key and a state. A locked hit is marked locked; opening it lands on
// the unit page, which applies the same track / act gate as every other link (nothing opens here).

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type { UnitSearchHit, UnitSearchResponse } from '../api/types';
import { isMod } from '../lib/keys';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { TRACK_SHORT } from '../lib/view';
import { Chip, Kbd } from './ui';

export const PALETTE_LIMIT = 30;
const DEBOUNCE_MS = 150;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Result = { q: string; data: UnitSearchResponse; error?: undefined } | { q: string; data?: undefined; error: string };

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const ids = useId();
  const titleId = `${ids}-title`;
  const listId = `${ids}-list`;
  const optionId = (i: number) => `${ids}-opt-${i}`;
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const navigated = useRef(false);
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), DEBOUNCE_MS);
  const [result, setResult] = useState<Result | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    opener.current = document.activeElement;
    input.current?.focus();
    return () => {
      // a navigation hands focus to the new page's title (AppShell); otherwise back to the opener
      if (!navigated.current && opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  useEffect(() => {
    if (query === '') {
      setResult(null);
      return;
    }
    let live = true;
    api.searchUnits(query, PALETTE_LIMIT).then(
      (data) => {
        if (!live) return;
        setResult({ q: query, data });
        setActive(0);
      },
      (e: unknown) => live && setResult({ q: query, error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [api, query]);

  const hits: UnitSearchHit[] = text.trim() === '' ? [] : (result?.data?.items ?? []);
  const at = Math.min(active, Math.max(0, hits.length - 1));

  useEffect(() => {
    if (hits.length > 0) document.getElementById(optionId(at))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, hits.length]);

  const open = (hit: UnitSearchHit | undefined) => {
    if (!hit) return;
    navigated.current = true;
    navigate(`/play/${hit.id}`);
    onClose();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // the palette owns the keyboard while open: no page shortcut (g-chords, quiz digits, review grades) fires behind it
    e.stopPropagation();
    const key = e.key;
    if (key === 'Escape' || (isMod(e.nativeEvent) && key.toLowerCase() === 'k')) {
      e.preventDefault();
      onClose();
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length === 0) return;
      setActive((at + (key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
      return;
    }
    if (key === 'Enter' && e.target === input.current) {
      e.preventDefault();
      open(hits[at]);
      return;
    }
    if (key !== 'Tab' || !ref.current) return;
    const nodes = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const stale = result !== null && result.q !== text.trim();
  const status =
    text.trim() === ''
      ? 'Type part of a unit title or key.'
      : result === null || (stale && hits.length === 0)
        ? 'Searching…'
        : result.error !== undefined
          ? result.error
          : result.data.total === 0
            ? 'No units match.'
            : result.data.total > hits.length
              ? `Showing ${hits.length} of ${result.data.total} matches. Keep typing to narrow.`
              : `${result.data.total} ${result.data.total === 1 ? 'match' : 'matches'}`;
  const announced = useDebouncedValue(status, 400);

  return (
    <div className="overlay overlay-palette" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref} onKeyDown={onKeyDown} data-testid="palette">
        <header className="dialog-head">
          <h2 id={titleId}>Find a unit</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close <Kbd>Esc</Kbd>
          </button>
        </header>
        <input
          ref={input}
          type="search"
          className="palette-input"
          role="combobox"
          aria-label="Search units by title or key"
          aria-autocomplete="list"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-activedescendant={hits.length > 0 ? optionId(at) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search units by title or key…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
        />
        <p className="palette-status muted small" data-testid="palette-count">
          {status}
        </p>
        <p className="sr-only" role="status">
          {announced}
        </p>
        <ul className="palette-list" id={listId} role="listbox" aria-label="Units">
          {hits.map((h, i) => (
            <li
              key={h.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === at}
              className={`palette-hit${i === at ? ' palette-hit-on' : ''}`}
              data-unit={h.id}
              data-state={h.state}
              // keep focus in the input: a click opens the hit, it never moves focus first
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => open(h)}
            >
              <span className={`track-badge track-${h.trackId}`}>{TRACK_SHORT[h.trackId]}</span>
              <span className="palette-main">
                <span className="palette-title">{h.title}</span>
                <span className="palette-key muted small">{h.key}</span>
              </span>
              <span className="palette-chips">
                {h.campaign && <Chip tone="info">campaign</Chip>}
                <Chip>{h.kind}</Chip>
                {h.state === 'done' && <Chip tone="success">done</Chip>}
                {h.state === 'locked' && <Chip tone="warning">locked</Chip>}
              </span>
            </li>
          ))}
        </ul>
        <p className="palette-foot muted small" aria-hidden="true">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>Esc</Kbd> close
        </p>
      </div>
    </div>
  );
}
