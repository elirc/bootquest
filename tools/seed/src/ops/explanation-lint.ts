// Campaign 2 review F5 seed-time LINT: quiz explanations that are generator ARTIFACTS.
//
// Until the factory-3 fix, seed:quests used a goal-check's raw parser label as its explanation
// ("1 (inline list item)", "- (inline list item)", "goal 2"), and the learner saw that text on the
// back of the review card after a miss. generate.ts now writes a real explanation; this lint keeps
// such text out of every shipped quest pack, whichever path (generator, drafts, authored) put it there.
//
// EXPLANATION_LINT_EXEMPT names packs that still carry such explanations from HAND drafts (content
// agents own those and remove the entry when they fix the draft and re-seed). An exempt pack that
// no longer has an artifact explanation FAILS the lint too, so the list can only shrink.
//
// Deliberately OUTSIDE the fingerprinted factory: it only READS items.json and changes nothing.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The F5 shape (`^\d+ \(.*item\)$`) plus its two sibling label leaks. */
export const ARTIFACT_EXPLANATION_PATTERNS: readonly RegExp[] = [/^\d+ \(.*item\)$/, /^- \(.*item\)$/, /^goal \d+$/i];

/** quest pack name -> why it is exempt for now. Empty: no hand draft carries an artifact explanation. */
export const EXPLANATION_LINT_EXEMPT: Readonly<Record<string, string>> = {};

export const isArtifactExplanation = (s: string | undefined): boolean => ARTIFACT_EXPLANATION_PATTERNS.some((re) => re.test((s ?? '').trim()));

export interface ExplanationLintRow {
  pack: string;
  /** item keys whose explanation is an artifact */
  keys: string[];
  exempt: boolean;
}

export interface ExplanationLintReport {
  scanned: number;
  /** non-exempt packs with artifact explanations */
  offenders: ExplanationLintRow[];
  /** exempt packs that no longer have any (the exemption must be removed) */
  staleExemptions: string[];
  /** exempt packs that still have them (reported, not failing) */
  exempted: ExplanationLintRow[];
}

export function explanationLintReport(seedDir: string, exempt: Readonly<Record<string, string>> = EXPLANATION_LINT_EXEMPT): ExplanationLintReport {
  const dir = join(seedDir, 'quests');
  const names = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'items.json')))
        .map((e) => e.name)
        .sort()
    : [];
  const rows: ExplanationLintRow[] = names.map((pack) => {
    const doc = JSON.parse(readFileSync(join(dir, pack, 'items.json'), 'utf8')) as { items?: { kind?: string; key?: string; explanation?: string }[] };
    const keys = (doc.items ?? []).filter((i) => i.kind === 'quiz' && isArtifactExplanation(i.explanation)).map((i) => i.key ?? '?');
    return { pack, keys, exempt: Object.hasOwn(exempt, pack) };
  });
  return {
    scanned: rows.length,
    offenders: rows.filter((r) => r.keys.length && !r.exempt),
    exempted: rows.filter((r) => r.keys.length && r.exempt),
    staleExemptions: Object.keys(exempt)
      .filter((p) => !rows.some((r) => r.pack === p && r.keys.length))
      .sort(),
  };
}

export const explanationLintFails = (r: ExplanationLintReport): boolean => r.offenders.length > 0 || r.staleExemptions.length > 0;

export function formatExplanationLintReport(r: ExplanationLintReport): string[] {
  return [
    `seed:lint:answers — quiz explanations that are generator label artifacts (${ARTIFACT_EXPLANATION_PATTERNS.map(String).join(' ')})`,
    ...r.offenders.map((o) => `ARTIFACT    quests/${o.pack}: ${o.keys.length} quiz(zes): ${o.keys.join(', ')}`),
    ...r.exempted.map((o) => `exempt      quests/${o.pack}: ${o.keys.length} quiz(zes) (${EXPLANATION_LINT_EXEMPT[o.pack] ?? 'exempt'})`),
    ...r.staleExemptions.map((p) => `STALE       quests/${p}: exempt but has no artifact explanation left — remove it from EXPLANATION_LINT_EXEMPT`),
    `${r.scanned} pack(s) scanned, ${r.offenders.length} with artifact explanations, ${r.staleExemptions.length} stale exemption(s)`,
    `RESULT ${explanationLintFails(r) ? 'ARTIFACT' : 'OK'}`,
  ];
}
