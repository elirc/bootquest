import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { API_MODE } from '../api/client';
import { useApi } from '../api/context';
import { CHORD_WINDOW_MS, GO_CHORDS, hasModifier, isEditableTarget, useKeydown } from '../lib/keys';
import { useAsync } from '../lib/useAsync';
import { TracksProvider, useTracks } from '../lib/tracks';
import { progressLabel, progressTitle, TRACK_PLACEHOLDER, TRACK_SHORT } from '../lib/view';
import { Icon, type IconName } from './Icon';
import { ShortcutHelp } from './ShortcutHelp';
import { Kbd } from './ui';

const NAV: { to: string; label: string; icon: IconName; chord: string; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'grid', chord: 'd', end: true },
  { to: '/campaign', label: 'Campaign', icon: 'map', chord: 'c' },
  { to: '/review', label: 'Review', icon: 'cards', chord: 'r' },
  { to: '/stats', label: 'Stats', icon: 'chart', chord: 's' },
];

/**
 * W11: the Review page reports the server's `remainingDue` after each grade so the nav badge
 * counts down during a session (it was only re-read on navigation, so it sat at the starting
 * count while the learner graded). Outside the shell it is a no-op.
 */
const DueReportContext = createContext<(remaining: number) => void>(() => undefined);
export const useDueReport = () => useContext(DueReportContext);

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TracksProvider>
      <Shell>{children}</Shell>
    </TracksProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const api = useApi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingG, setPendingG] = useState(false);
  const gAt = useRef(0);

  const tracks = useTracks();
  // Re-read the due count on every navigation so a finished review session is reflected.
  // `count` is the total due regardless of `limit` (no separate count route).
  const due = useAsync(() => api.getReviewQueue(1), [api, pathname]);
  // a live count reported on this page (W11); a navigation re-reads the server count instead
  const [reported, setReported] = useState<{ path: string; n: number } | null>(null);
  const reportDue = useCallback((n: number) => setReported({ path: pathname, n }), [pathname]);
  useEffect(() => setReported(null), [pathname]); // leaving and coming back re-reads the server count
  const dueCount = reported && reported.path === pathname ? reported.n : due.data?.count;

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
              {n.to === '/review' && dueCount !== undefined && dueCount > 0 && (
                <span className="nav-badge" aria-label={`${dueCount} due`}>
                  {dueCount}
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
          <ul className="track-list" aria-busy={tracks.status === 'loading'}>
            {/* W9 (ui-audit #4): placeholder rows while loading (no empty TRACKS header, no layout shift) */}
            {tracks.status === 'loading' &&
              TRACK_PLACEHOLDER.map((t) => (
                <li key={t.id} aria-hidden="true">
                  <span className={`track-link track-skel${t.locked ? ' track-locked' : ''}`}>
                    <span className={`track-badge${t.locked ? '' : ` track-${t.id}`}`}>{TRACK_SHORT[t.id]}</span>
                    <span className="track-name">{t.name}</span>
                    <span className="track-count">…</span>
                  </span>
                </li>
              ))}
            {tracks.status === 'error' && (
              <li>
                <button type="button" className="linkish small" onClick={tracks.reload}>
                  Tracks failed to load — retry
                </button>
              </li>
            )}
            {(tracks.data?.tracks ?? []).map((t) => (
              <li key={t.id}>
                {t.locked ? (
                  <NavLink
                    to={`/campaign/${t.id}`}
                    className="track-link track-locked"
                    title="Locked"
                  >
                    <span className="track-badge">{TRACK_SHORT[t.id]}</span>
                    <span className="track-name">{t.name}</span>
                    <Icon name="lock" size={14} label="Locked" />
                  </NavLink>
                ) : (
                  // campaign 2 B2 (ui-audit #26): the server's shared TrackProgress, explained in the tooltip
                  <NavLink to={`/campaign/${t.id}`} className="track-link" title={progressTitle(t.progress)}>
                    <span className={`track-badge track-${t.id}`}>{TRACK_SHORT[t.id]}</span>
                    <span className="track-name">{t.name}</span>
                    <span className="track-count" data-testid={`track-pct-${t.id}`}>
                      {progressLabel(t.progress)}
                    </span>
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
        <DueReportContext.Provider value={reportDue}>
          <div className="main-inner">{children}</div>
        </DueReportContext.Provider>
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
