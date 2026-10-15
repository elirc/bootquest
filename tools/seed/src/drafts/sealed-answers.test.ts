import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Honesty guard for study-quest content (ACT3-CS fix pass): a source repo's
// sealed reference answers (`training/_answers/...`, "don't open before
// attempting") must never feed a quest pack. Using them as a guide turns the
// repo's own diagnosis exercise into reading steps and keys quizzes to the
// answer sheet. A brief may still NAME the sealed file (a path-only pointer in
// a reading step's citations), but nothing may be read from or keyed to it.

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DRAFTS = join(REPO_ROOT, 'content', 'seed-drafts', 'quests');
const PACKS = join(REPO_ROOT, 'content', 'seed', 'quests');

export const SEALED = /(^|\/)_answers\//;
const sealed = (p: string) => SEALED.test(p.replace(/\\/g, '/'));

interface DraftItem { id: string; kind: string; source: { path: string }; cites: { path: string }[] }
interface Draft { repo: string; guides: string[]; items: DraftItem[] }
interface PackItem {
  key: string;
  kind: string;
  provenance: { path: string };
  citations: { path: string; resolved?: string | null; lineStart: number | null }[];
}

function draftViolations(d: Draft): string[] {
  const out: string[] = [];
  for (const g of d.guides ?? []) if (sealed(g)) out.push(`${d.repo}: guide ${g}`);
  for (const it of d.items ?? []) {
    if (sealed(it.source.path)) out.push(`${d.repo}/${it.id}: source ${it.source.path}`);
    for (const c of it.cites ?? []) if (sealed(c.path)) out.push(`${d.repo}/${it.id}: cite ${c.path}`);
  }
  return out;
}

function packViolations(repo: string, items: PackItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (sealed(it.provenance.path)) out.push(`${repo}/${it.key}: provenance ${it.provenance.path}`);
    for (const c of it.citations ?? []) {
      const p = c.resolved ?? c.path;
      if (!sealed(p)) continue;
      // a reading step framing a task may point at the sealed file by name only
      if (it.kind === 'reading-step' && c.lineStart === null) continue;
      out.push(`${repo}/${it.key}: citation ${p}`);
    }
  }
  return out;
}

describe('sealed reference answers never feed a quest pack', () => {
  it('the detectors catch guides, sources, cites and line-bound pack citations', () => {
    const draft: Draft = {
      repo: 'x',
      guides: ['docs/a.md', 'training/_answers/001.md'],
      items: [
        { id: 'q1', kind: 'quiz', source: { path: '_answers/002.md' }, cites: [{ path: 'docs/a.md' }] },
        { id: 'q2', kind: 'quiz', source: { path: 'docs/a.md' }, cites: [{ path: 'training\\_answers\\003.md' }] },
        { id: 'q3', kind: 'quiz', source: { path: 'docs/my_answers/ok.md' }, cites: [{ path: 'docs/a.md' }] },
      ],
    };
    expect(draftViolations(draft)).toEqual([
      'x: guide training/_answers/001.md',
      'x/q1: source _answers/002.md',
      'x/q2: cite training\\_answers\\003.md',
    ]);
    const pack: PackItem[] = [
      { key: 'r1', kind: 'reading-step', provenance: { path: 'training/incidents/001.md' }, citations: [{ path: 'training/_answers/001.md', resolved: 'training/_answers/001.md', lineStart: null }] },
      { key: 'r2', kind: 'reading-step', provenance: { path: 'training/_answers/001.md' }, citations: [] },
      { key: 'q1', kind: 'quiz', provenance: { path: 'docs/a.md' }, citations: [{ path: 'training/_answers/001.md', resolved: 'training/_answers/001.md', lineStart: null }] },
      { key: 'r3', kind: 'reading-step', provenance: { path: 'docs/a.md' }, citations: [{ path: 'training/_answers/001.md', lineStart: 4 }] },
    ];
    expect(packViolations('x', pack)).toEqual([
      'x/r2: provenance training/_answers/001.md',
      'x/q1: citation training/_answers/001.md',
      'x/r3: citation training/_answers/001.md',
    ]);
  });

  it('no committed quest draft uses a sealed answer file', () => {
    expect(existsSync(DRAFTS)).toBe(true);
    const files = readdirSync(DRAFTS).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    const bad = files.flatMap((f) => draftViolations(JSON.parse(readFileSync(join(DRAFTS, f), 'utf8')) as Draft));
    expect(bad).toEqual([]);
  });

  it('no stamped quest pack reads from or keys to a sealed answer file', () => {
    expect(existsSync(PACKS)).toBe(true);
    const repos = readdirSync(PACKS).filter((r) => existsSync(join(PACKS, r, 'items.json')));
    expect(repos.length).toBeGreaterThan(0);
    const bad = repos.flatMap((r) => {
      const doc = JSON.parse(readFileSync(join(PACKS, r, 'items.json'), 'utf8')) as { items: PackItem[] };
      return packViolations(r, doc.items);
    });
    expect(bad).toEqual([]);
  });
});
