import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXPLANATION_LINT_EXEMPT, explanationLintFails, explanationLintReport, formatExplanationLintReport, isArtifactExplanation } from './explanation-lint.ts';

const quiz = (key: string, explanation: string) => ({ kind: 'quiz', key, explanation });

describe('isArtifactExplanation (campaign 2 review F5)', () => {
  it('matches the parser-label leaks and nothing that reads like an explanation', () => {
    for (const s of ['1 (inline list item)', '12 (inline list item)', '- (inline list item)', 'goal 2', ' 3 (inline list item) ']) expect(isArtifactExplanation(s), s).toBe(true);
    for (const s of ['', 'In docs/a.md:4, the guide pairs this Goal with this Check; ...', 'F3 (Medium)', 'Step 1 (inline list item) is wrong because', 'goal 2 fails when the cache is cold']) expect(isArtifactExplanation(s), s).toBe(false);
    expect(isArtifactExplanation(undefined)).toBe(false);
  });
});

describe('explanationLintReport over an estate on disk', () => {
  let root: string;
  const pack = (repo: string, items: unknown[]) => {
    mkdirSync(join(root, 'quests', repo), { recursive: true });
    writeFileSync(join(root, 'quests', repo, 'items.json'), JSON.stringify({ items }));
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bq-expl-lint-'));
    pack('clean', [quiz('c1', 'A real explanation.'), { kind: 'flashcard', key: 'f', explanation: '1 (inline list item)' }]);
    pack('leaky', [quiz('l1', '1 (inline list item)'), quiz('l2', 'fine'), quiz('l3', 'goal 3')]);
    pack('drafted', [quiz('d1', '2 (inline list item)')]);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('fails on a non-exempt pack, naming every offending quiz key (flashcards are not quizzes)', () => {
    const r = explanationLintReport(root, {});
    expect(r.scanned).toBe(3);
    expect(r.offenders.map((o) => [o.pack, o.keys])).toEqual([
      ['drafted', ['d1']],
      ['leaky', ['l1', 'l3']],
    ]);
    expect(explanationLintFails(r)).toBe(true);
    expect(formatExplanationLintReport(r).at(-1)).toBe('RESULT ARTIFACT');
  });

  it('an exempt pack that still has artifacts is reported but does not fail', () => {
    const r = explanationLintReport(root, { drafted: 'hand draft, owner fixing', leaky: 'x' });
    expect(r.offenders).toEqual([]);
    expect(r.exempted.map((o) => o.pack)).toEqual(['drafted', 'leaky']);
    expect(explanationLintFails(r)).toBe(false);
    expect(formatExplanationLintReport(r).at(-1)).toBe('RESULT OK');
  });

  it('an exemption whose pack no longer has an artifact (or no longer exists) FAILS: the list only shrinks', () => {
    const r = explanationLintReport(root, { drafted: 'x', leaky: 'x', clean: 'stale', gone: 'stale' });
    expect(r.staleExemptions).toEqual(['clean', 'gone']);
    expect(explanationLintFails(r)).toBe(true);
    expect(formatExplanationLintReport(r).filter((l) => l.startsWith('STALE'))).toHaveLength(2);
  });
});

describe('the real estate', () => {
  // the GATE: `npm run seed:lint:answers` runs this lint too, and the tools/seed suite fails with it
  it('GATE: no committed quest pack ships an artifact explanation outside EXPLANATION_LINT_EXEMPT, and no exemption is stale', () => {
    const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
    const seedDir = join(REPO, 'content', 'seed');
    expect(existsSync(join(seedDir, 'quests'))).toBe(true);
    const r = explanationLintReport(seedDir);
    expect(r.scanned).toBeGreaterThan(0);
    expect(r.offenders.map((o) => `${o.pack}: ${o.keys.join(', ')}`)).toEqual([]);
    expect(r.staleExemptions).toEqual([]);
    expect(Object.keys(EXPLANATION_LINT_EXEMPT).sort()).toEqual(r.exempted.map((o) => o.pack));
  });
});
