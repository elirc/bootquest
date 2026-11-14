import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/context';
import { errorText } from '../../api/errors';
import type { RedoRunResponse } from '../../api/types';
import { Icon } from '../../components/Icon';

/**
 * rv2 S1 (PLAN §2.1 item 5): the redo entry. Opened from a redo card (/play/:unitId?redo=<itemId>), the drill is
 * worked in PRACTICE mode: "Run as redo" runs the code through the free grader and grades only the card (a pass =
 * Good, a fail = Again). No attempt, no XP beyond the card's review XP, no evidence, nothing unlocks. Submit stays
 * the ordinary graded submit, separate from the redo.
 */
export function RedoBar({ itemId, code }: { itemId: number; code: string }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RedoRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (busy || res) return;
    setBusy(true);
    try {
      setRes(await api.runRedo(itemId, code));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel redo-bar" data-testid="redo-bar">
      <p className="small">
        <strong>Redo (practice mode).</strong> Solve it again from memory, then run it as your redo: a pass rates the card Good, a fail rates it Again. Nothing
        else is recorded.
      </p>
      {res ? (
        <p className={`small ${res.grade === 'good' ? 'pos' : ''}`} role="status" data-testid="redo-result">
          <Icon name={res.grade === 'good' ? 'check' : 'warn'} size={14} /> {res.result.pass ? 'Passed' : 'Not yet'}: the card is rated {res.grade === 'good' ? 'Good' : 'Again'}
          {res.xp.amount > 0 ? ` (+${res.xp.amount} XP)` : ''}. <Link to="/review">Back to review</Link>
        </p>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => void go()} disabled={busy || code.trim() === ''} data-testid="redo-run">
          {busy ? 'Running…' : 'Run as redo'}
        </button>
      )}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
