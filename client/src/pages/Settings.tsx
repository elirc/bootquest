// rv wave C (REVIEW Wave 1b rows 3 + 8, R4-23 / R4 §5 CUT): the daily-slate settings moved off the dashboard.
// The learner's day shape (primary language, campaign step, senior rep: PUT /settings/learner) and the
// per-track drill sets ("Choose your focus", the ab A1 form: PUT /settings/slate). Every change takes effect
// tomorrow, except the first primary-language pick (the server says which day in its response).
import { useState } from 'react';
import { useApi } from '../api/context';
import { errorText } from '../api/errors';
import type { LearnerSettingsBody, PrimaryLanguage, SlateSettingsResponse } from '../api/types';
import { SlateFocus } from '../components/SlateFocus';
import { LoadState, PageHeader, Panel } from '../components/ui';
import { fmtShortDate } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { TRACK_LABEL } from '../lib/view';

const LANGUAGES: readonly PrimaryLanguage[] = ['js', 'csharp', 'java'];

export function SettingsPage() {
  const api = useApi();
  const q = useAsync(() => api.getSlateSettings(), [api]);
  return (
    <div className="page-col">
      <PageHeader eyebrow="Settings" title="Your day" />
      {q.status !== 'ready' ? (
        <LoadState error={q.error} onRetry={q.reload} minHeight={240} />
      ) : (
        <div className="settings">
          <LearnerPanel s={q.data} />
          <Panel title="Daily drill sets" labelledBy="p-drills">
            <p className="small muted">Off by default: the Fundamentals step and the senior rep carry the day. Turn a track on to add its drill set.</p>
            <SlateFocus q={q} />
          </Panel>
        </div>
      )}
    </div>
  );
}

function LearnerPanel({ s }: { s: SlateSettingsResponse }) {
  const api = useApi();
  const [cur, setCur] = useState(s);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const learner = cur.learner;
  if (!learner) {
    return (
      <Panel title="Your day" labelledBy="p-learner">
        <p className="small muted">This server has no learner settings yet.</p>
      </Panel>
    );
  }
  const t = learner.tomorrow;
  const save = (body: LearnerSettingsBody) => {
    setBusy(true);
    setNote(null);
    api.putLearnerSettings(body).then(
      (r) => {
        setCur(r);
        setBusy(false);
        setNote(r.learner && body.primaryLanguage !== undefined && r.learner.today.primaryLanguage === body.primaryLanguage ? 'Saved: applies today.' : `Saved: applies from ${fmtShortDate(r.effectiveDay)}.`);
      },
      (e: unknown) => {
        setBusy(false);
        setNote(errorText(e));
      },
    );
  };
  return (
    <Panel title="Your day" labelledBy="p-learner">
      <form className="settings-form" onSubmit={(e) => e.preventDefault()}>
        <label className="settings-row">
          <span>Primary language</span>
          <select
            value={t.primaryLanguage}
            disabled={busy}
            onChange={(e) => save({ primaryLanguage: e.target.value as PrimaryLanguage })}
            data-testid="settings-language"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {TRACK_LABEL[l]}
              </option>
            ))}
          </select>
          <span className="small muted">The hero&apos;s Fundamentals ladder and the slate&apos;s Fundamentals step.</span>
        </label>
        <label className="settings-row">
          <input type="checkbox" checked={t.seniorRep} disabled={busy} onChange={(e) => save({ seniorRep: e.target.checked })} data-testid="settings-senior" />
          <span>Senior rep</span>
          <span className="small muted">One DESIGN IT set, review kata or Fundamentals JS 21-33 unit a day (rotates by weekday; any of them counts).</span>
        </label>
        <label className="settings-row">
          <input type="checkbox" checked={t.campaignStep} disabled={busy} onChange={(e) => save({ campaignStep: e.target.checked })} data-testid="settings-campaign" />
          <span>Campaign step</span>
          <span className="small muted">A repo study quest from an unlocked act.</span>
        </label>
      </form>
      {note && (
        <p className="small" role="status" data-testid="settings-note">
          {note}
        </p>
      )}
    </Panel>
  );
}
