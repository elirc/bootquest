import { useState } from 'react';
import { useApi } from '../../api/context';
import { errorText } from '../../api/errors';
import type { NoteCategory } from '../../api/types';

/** Mirrors NOTE_CATEGORIES in shared/src/api-ext.ts, with the labels the learner sees. */
export const NOTE_CATEGORY_LABEL: Record<NoteCategory, string> = {
  misread: 'Misread the question',
  'concept-gap': 'Concept gap',
  'edge-case': 'Missed an edge case',
  'api-or-syntax': 'API or syntax',
  slip: 'Careless slip',
  other: 'Other',
};

/**
 * rv2 S1 (PLAN F6): the error notebook line after a failed submit. Optional and never blocking: it is folded, it
 * pays 0 XP, and nothing waits on it. Saved, it becomes a review card tomorrow whose front is this line.
 */
export function NotebookLine({ unitId, attemptId }: { unitId: number; attemptId?: number }) {
  const api = useApi();
  const [line, setLine] = useState('');
  const [category, setCategory] = useState<NoteCategory>('concept-gap');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (saved) {
    return (
      <p className="small muted" role="status" data-testid="notebook-saved">
        Saved to your notebook: it comes back as a card tomorrow.
      </p>
    );
  }
  const save = async () => {
    if (busy || line.trim().length < 3) return;
    setBusy(true);
    try {
      await api.addNote({ unitId, ...(attemptId !== undefined ? { attemptId } : {}), line: line.trim(), category });
      setSaved(true);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="notebook-line small" data-testid="notebook-line">
      <summary>Note what went wrong (optional, one line)</summary>
      <label htmlFor={`note-${unitId}`}>In your own words</label>
      <input id={`note-${unitId}`} className="input" maxLength={200} value={line} onChange={(e) => setLine(e.target.value)} />
      <label htmlFor={`note-cat-${unitId}`}>Category</label>
      <select id={`note-cat-${unitId}`} value={category} onChange={(e) => setCategory(e.target.value as NoteCategory)}>
        {(Object.keys(NOTE_CATEGORY_LABEL) as NoteCategory[]).map((c) => (
          <option key={c} value={c}>
            {NOTE_CATEGORY_LABEL[c]}
          </option>
        ))}
      </select>{' '}
      <button type="button" className="btn btn-sm" onClick={() => void save()} disabled={busy || line.trim().length < 3}>
        Save to notebook
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
