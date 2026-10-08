import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { API_MODE } from '../api/client';
import { useApi } from '../api/context';
import { CHORD_WINDOW_MS, GO_CHORDS, hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { useAsync } from '../lib/useAsync';
import { Icon, type IconName } from './Icon';
import { ShortcutHelp } from './ShortcutHelp';
import { Kbd } from './ui';

const NAV: { to: string; label: string; icon: IconName; chord: string; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'grid', chord: 'd', end: true },
  { to: '/campaign', label: 'Campaign', icon: 'map', chord: 'c' },
  { to: '/review', label: 'Review', icon: 'cards', chord: 'r' },
  { to: '/stats', label: 'Stats', icon: 'chart', chord: 's' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const api = useApi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingG, setPendingG] = useState(false);
  const gAt = useRef(0);

  const tracks = useAsync(() => api.getTracks(), [api]);
  // Re-read the due count on every navigation so a finished review session is reflected.
  const due = useAsync(() => api.getReviewQueueCount(), [api, pathname]);

  useKeydown((e) => {
    if (e.defaultPrevented || hasModifier(e) || isEditableTarget(e.target)) return;
    if (e.key === '?') {
      e.preventDefault();
      setHelpOpen((o) => !o);
      return;
    }
    if (helpOpen) return;
    const now = Date.now();
    if (pendingG && now - gAt.current <= CHORD_WINDOW_MS) {
      setPendingG(false);
      const target = GO_CHORDS[e.key.toLowerCase()];
      if (target) {
        e.preventDefault();
        navigate(target.path);
      }
      return;
    }
    if (e.key === 'g') {
      gAt.current = now;
      setPendingG(true);
    }
  });

  // Keyboard users land on the page title after each route change (screen readers announce it).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const h = document.querySelector<HTMLElement>('[data-page-title]');
    h?.focus({ preventScroll: true });
    document.querySelector('.main')?.scrollTo?.({ top: 0 });
  }, [pathname]);

  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span className="brand-name">BootQuest</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              <Icon name={n.icon} />
              <span className="nav-label">{n.label}</span>
              {n.to === '/review' && due.data && due.data.due > 0 && (
                <span className="nav-badge" aria-label={`${due.data.due} due`}>
                  {due.data.due}
                </span>
              )}
              <span className="nav-chord" aria-hidden="true">
                g {n.chord}
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="side-section">
          <h2 className="side-title">Tracks</h2>
          <ul className="track-list">
            {(tracks.data ?? []).map((t) => (
              <li key={t.id}>
                {t.status === 'locked' ? (
                  <NavLink
                    to={`/campaign/${t.id}`}
                    className="track-link track-locked"
                    title={t.lockedReason ?? 'Locked'}
                  >
                    <span className="track-badge">{t.short}</span>
                    <span className="track-name">{t.name}</span>
                    <Icon name="lock" size={14} label="Locked" />
                  </NavLink>
                ) : (
                  <NavLink to={`/campaign/${t.id}`} className="track-link">
                    <span className={`track-badge track-${t.id}`}>{t.short}</span>
                    <span className="track-name">{t.name}</span>
                    <span className="track-count">{Math.round((t.unitsDone / Math.max(1, t.unitsTotal)) * 100)}%</span>
                  </NavLink>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="side-foot">
          <button type="button" className="linkish" onClick={() => setHelpOpen(true)}>
            <Icon name="keyboard" /> Shortcuts <Kbd>?</Kbd>
          </button>
          <span className={`mode mode-${API_MODE}`} title="Which API implementation is bound (src/api/client.ts)">
            {API_MODE === 'mock' ? 'mock data' : 'live'}
          </span>
        </div>
      </aside>

      <main id="main" className="main">
        <div className="main-inner">{children}</div>
      </main>

      <div className={`chord-hint${pendingG ? ' chord-hint-on' : ''}`} aria-live="polite">
        {pendingG ? (
          <>
            <Kbd>g</Kbd> then{' '}
            {Object.entries(GO_CHORDS).map(([k, v]) => (
              <span key={k}>
                <Kbd>{k}</Kbd> {v.label}{' '}
              </span>
            ))}
          </>
        ) : null}
      </div>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
