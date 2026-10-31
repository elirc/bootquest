import { useState } from 'react';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type { SlateSettingsResponse, SlateTrackShape } from '../api/types';
import { fmtShortDate } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { TRACK_LABEL, isTrackId } from '../lib/view';

/**
 * ab A1 "Choose your focus": the learner picks which tracks give a daily drill set and how many
 * new drills each asks for (GET/PUT /api/settings/slate). Shown open while no choice was ever saved
 * (day one: every track gives 1 drill); afterwards a one-line summary of tomorrow's slate with a
 * Change link that reopens the same form. A save takes effect TOMORROW: the server never reshapes
 * today's slate, so nothing on the rest of the dashboard changes when it is saved.
 */
export function SlateFocus() {
  const api = useApi();
  const q = useAsync(() => api.getSlateSettings(), [api]);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<SlateSettingsResponse | null>(null);
  if (q.status === 'loading') return null;
  if (q.status === 'error') {
    return (
      <p className="slate-focus-line small muted" data-testid="slate-focus-error">
        Daily slate settings could not be loaded: {errorText(q.error)}{' '}
        <button type="button" className="link-btn" onClick={q.reload}>
          Retry
        </button>
      </p>
    );
  }
  const s = saved ?? q.data;
  if (!s.configured || editing) {
    return (
      <FocusForm
        s={s}
        first={!s.configured}
        onSaved={(r) => {
          setSaved(r);
          setEditing(false);
        }}
        onCancel={s.configured ? () => setEditing(false) : undefined}
      />
    );
  }
  const on = s.tomorrowTracks.filter((t) => t.enabled);
  return (
    <p className="slate-focus-line small" data-testid="slate-focus-summary">
      {saved && (
        <span className="pos" role="status">
          Saved.{' '}
        </span>
      )}
      <span className="muted">Daily slate from {fmtShortDate(s.effectiveDay)}: </span>
      {on.map((t) => `${label(t)} ×${t.size}`).join(' · ')}{' '}
      <button type="button" className="link-btn" onClick={() => setEditing(true)}>
        Change daily slate
      </button>
    </p>
  );
}

const label = (t: SlateTrackShape): string => (isTrackId(t.trackId) ? TRACK_LABEL[t.trackId] : t.name);

function FocusForm({
  s,
  first,
  onSaved,
  onCancel,
}: {
  s: SlateSettingsResponse;
  first: boolean;
  onSaved: (r: SlateSettingsResponse) => void;
  onCancel?: () => void;
}) {
  const api = useApi();
  const [rows, setRows] = useState(() => s.tomorrowTracks.map((t) => ({ trackId: t.trackId, enabled: t.enabled, size: t.size })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noneOn = !rows.some((r) => r.enabled);
  const sizes = Array.from({ length: s.maxSize - s.minSize + 1 }, (_, i) => s.minSize + i);
  const set = (trackId: string, patch: Partial<{ enabled: boolean; size: number }>) =>
    setRows((rs) => rs.map((r) => (r.trackId === trackId ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.putSlateSettings({
          tracks: rows.map((r) => ({ trackId: r.trackId, enabled: r.enabled, ...(r.enabled ? { size: r.size } : {}) })),
        }),
      );
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <section className="panel slate-focus" aria-labelledby="p-focus" data-testid="slate-focus">
      <header className="panel-head">
        <h2 className="panel-title" id="p-focus">
          {first ? 'Choose your focus' : 'Daily slate settings'}
        </h2>
      </header>
      <p className="small muted">
        Pick the tracks you are preparing for and how many new drills each one asks for a day.
        {first && ` Until you choose, every track gives ${s.defaultSize} drill${s.defaultSize === 1 ? '' : 's'} a day.`}
      </p>
      <ul className="slate-focus-tracks">
        {s.tomorrowTracks.map((t) => {
          const row = rows.find((r) => r.trackId === t.trackId)!;
          return (
            <li key={t.trackId} className={`slate-focus-track${row.enabled ? '' : ' slate-focus-off'}`}>
              <label className="check">
                <input type="checkbox" checked={row.enabled} onChange={(e) => set(t.trackId, { enabled: e.target.checked })} disabled={busy} />
                {label(t)}
              </label>
              <select
                value={row.size}
                aria-label={`${label(t)} drills per day`}
                onChange={(e) => set(t.trackId, { size: Number(e.target.value) })}
                disabled={busy || !row.enabled}
              >
                {sizes.map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'drill' : 'drills'}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      {error && (
        <div className="verdict verdict-error" role="alert">
          {error}
        </div>
      )}
      <div className="slate-focus-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy || noneOn}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <span className="small muted" data-testid="slate-focus-when">
          {noneOn
            ? 'Keep at least one track on.'
            : `Takes effect tomorrow (${fmtShortDate(s.effectiveDay)}); today's slate stays as it is.`}
        </span>
      </div>
    </section>
  );
}
