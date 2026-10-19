// The reveal flow of the exercise player: the confirm that names what a reveal forfeits (0 XP
// forever, and for a promotion artifact / retest the promotion leg), then the solution view.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/context';
import { errorText } from '../../api/errors';
import type { CompetencyId, RevealResponse, UnitDetail, UnitKind } from '../../api/types';
import { Icon } from '../../components/Icon';
import { InlineProse } from '../../lib/prose';
import { competencyLabel } from '../../lib/view';

export type Solution = RevealResponse['solution'];

/** Project unit kinds: a solo pass on one is promotion leg (a), the artifact (shared PROJECT_UNIT_KINDS). */
const PROJECT_KINDS: readonly UnitKind[] = ['guided-project', 'http-lab', 'repo-task', 'program-unit'];

export type PromotionLeg = 'artifact' | 'retest';

/**
 * The three-leg promotion leg a submit on this unit writes evidence for, from what the unit
 * detail carries (the server's submitEvidenceKind: a project unit's submit is the artifact leg,
 * a changed-example retest's is the retest leg). A reveal makes every later attempt guided, and
 * a guided attempt never counts as a leg, so a reveal here forfeits that leg for good. A retest
 * already in practice mode (its artifact was revealed) has no leg left to lose. No competency =
 * no evidence = no promotion.
 */
export function promotionLeg(detail: UnitDetail): PromotionLeg | null {
  const { unit } = detail;
  if (unit.competencies.length === 0) return null;
  if (PROJECT_KINDS.includes(unit.kind)) return 'artifact';
  if (unit.kind === 'retest' && unit.variationOfUnitId !== null && detail.retestGate?.reason !== 'practice') return 'retest';
  return null;
}

const listLabels = (cs: CompetencyId[]): string => {
  const names = cs.map(competencyLabel);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

export function RevealPanel({
  unitId,
  leg,
  competencies,
  revealed,
  solution,
  onRevealed,
}: {
  unitId: number;
  leg: PromotionLeg | null;
  competencies: CompetencyId[];
  revealed: boolean;
  solution: Solution | null;
  onRevealed: (s: Solution) => void;
}) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variationUnitId, setVariationUnitId] = useState<number | null>(null);

  const act = async (kind: 'reveal' | 'fetch') => {
    setBusy(true);
    setError(null);
    try {
      // The solution only ever arrives AFTER the server has written the reveal row.
      const r = kind === 'reveal' ? await api.revealUnit(unitId) : await api.getSolution(unitId);
      onRevealed(r.solution);
      setVariationUnitId(r.variationUnitId);
      setConfirming(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const names = listLabels(competencies);
  return (
    <div className="reveal-box">
      {!revealed ? (
        <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)} disabled={busy}>
          <Icon name="warn" size={14} /> Reveal solution
        </button>
      ) : !solution ? (
        <button type="button" className="btn btn-sm" onClick={() => void act('fetch')} disabled={busy}>
          Show revealed solution
        </button>
      ) : (
        <SolutionView solution={solution} />
      )}
      {solution && variationUnitId !== null && (
        // reveal schedules the unit's pre-seeded changed example as practice (README: honesty model)
        <p className="small" data-testid="variation-link">
          A changed version of this exercise is waiting as practice:{' '}
          <Link to={`/play/${variationUnitId}`}>practice the changed example</Link>.
        </p>
      )}
      {confirming && (
        <div
          className="confirm"
          role="alertdialog"
          onKeyDown={(e) => e.key === 'Escape' && !busy && setConfirming(false)}
          aria-labelledby="reveal-title"
          aria-describedby={leg ? 'reveal-desc reveal-leg' : 'reveal-desc'}
        >
          <h3 id="reveal-title">Reveal the solution?</h3>
          <p id="reveal-desc">
            This exercise will be worth <strong>0 XP forever</strong>. Later submits still record, as guided attempts.
          </p>
          {leg === 'artifact' && (
            <p id="reveal-leg" data-testid="reveal-leg">
              It is also a <strong>promotion artifact</strong> for {names}. A revealed artifact can never count as the solo artifact leg, so{' '}
              <strong>this unit can never promote {competencies.length === 1 ? 'it' : 'them'}</strong> and its changed-example retest becomes
              practice only. This cannot be undone.
            </p>
          )}
          {leg === 'retest' && (
            <p id="reveal-leg" data-testid="reveal-leg">
              It is also the <strong>changed-example retest</strong> leg of a promotion for {names}. Once revealed, its attempts are guided and{' '}
              <strong>can never complete that promotion</strong>. This cannot be undone.
            </p>
          )}
          <div className="toolbar">
            <button type="button" className="btn" autoFocus onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void act('reveal')} disabled={busy}>
              {leg ? 'Reveal (0 XP forever, promotion leg forfeited)' : 'Reveal (0 XP forever)'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SolutionView({ solution }: { solution: Solution }) {
  return (
    <div className="solution" data-testid="solution">
      <h3 className="small">Reference solution (revealed)</h3>
      {solution.kind === 'code' && <pre className="code-block">{solution.code}</pre>}
      {solution.kind === 'output' && <pre className="code-block">{solution.expected}</pre>}
      {solution.kind === 'answer' && (
        <p>
          Answer: <InlineProse text={solution.choice ?? String(solution.answer)} />
        </p>
      )}
    </div>
  );
}
