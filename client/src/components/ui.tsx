// Small presentational primitives shared by every screen.
import type { ReactNode } from 'react';
import { pct } from '../lib/format';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Panel({
  title,
  aside,
  children,
  className = '',
  labelledBy,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section className={`panel ${className}`} aria-labelledby={labelledBy}>
      {title !== undefined && (
        <header className="panel-head">
          <h2 className="panel-title" id={labelledBy}>
            {title}
          </h2>
          {aside && <div className="panel-aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function ProgressBar({
  value,
  max,
  label,
  tone = 'accent',
}: {
  value: number;
  max: number;
  label: string;
  tone?: 'accent' | 'success' | 'info';
}) {
  return (
    <div
      className={`bar bar-${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className="bar-fill" style={{ width: `${pct(value, max)}%` }} />
    </div>
  );
}

/** 1..5 rating as five pips; null renders as "unrated". */
export function RatingPips({ rating, target }: { rating: number | null; target?: number }) {
  const label = rating === null ? 'Not rated' : `Rating ${rating} of 5${target ? `, promoting to ${target}` : ''}`;
  return (
    <span className="pips" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`pip${rating !== null && n <= rating ? ' pip-on' : ''}${target === n ? ' pip-target' : ''}`}
        />
      ))}
      <span className="pips-num">{rating ?? '–'}</span>
    </span>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function PageHeader({
  title,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title" tabIndex={-1} data-page-title>
          {title}
        </h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Loading / error placeholder that occupies the same box as the content it replaces. */
export function LoadState({ error, onRetry, minHeight = 240 }: { error?: Error; onRetry?: () => void; minHeight?: number }) {
  if (error) {
    return (
      <div className="loadstate loadstate-error" role="alert" style={{ minHeight }}>
        <p>{error.message}</p>
        {onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }
  return <div className="loadstate skeleton" aria-busy="true" aria-label="Loading" style={{ minHeight }} />;
}
