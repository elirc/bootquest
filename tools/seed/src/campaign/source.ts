import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads the upskillorder study map (READ-ONLY): assess/batch-N.jsonl is the
 * structured source INDEX.md was generated from (rank.mjs); INDEX.md supplies
 * the rank. LEARNING.md R2: seed from the jsonl (stack/kind/confidence), join
 * the INDEX rank, dedupe by first-seen name in batch order (as rank.mjs does).
 */

export const DEFAULT_UPSKILLORDER_DIR = 'C:/Users/Owner/Desktop/upskillorder';

export interface AssessRow {
  name: string;
  stack: string;
  kind: string;
  difficulty: number;
  richness: number;
  verdict: 'study' | 'skim' | 'skip';
  confidence: 'high' | 'med' | 'low' | null;
  focus: string;
  rank: number;
  file: string;
  line: number;
  lineSha256: string;
}

export interface SourceFile {
  file: string;
  sha256: string;
  lines: number;
}

export interface UpskillorderInput {
  rows: AssessRow[];
  sources: SourceFile[];
}

export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

/** INDEX.md entry grammar (estate-contract §1.2; the separators are U+2014 em dashes). */
export const INDEX_LINE = /^(\d+)\. \[part-(\d\d)\] \*\*([^*]+)\*\* \u2014 d([1-5])\/r([0-5]) (study|skim|skip) \u2014 (.*)$/;

export class CampaignSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignSourceError';
  }
}

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const lineCount = (s: string): number => s.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')).length;

function batchOrder(a: string, b: string): number {
  const n = (f: string) => Number(/^batch-(\d+)\.jsonl$/.exec(f)?.[1] ?? NaN);
  return n(a) - n(b);
}

export function readUpskillorder(dir: string = DEFAULT_UPSKILLORDER_DIR): UpskillorderInput {
  const sources: SourceFile[] = [];

  const indexText = stripBom(readFileSync(join(dir, 'INDEX.md'), 'utf8'));
  sources.push({ file: 'INDEX.md', sha256: sha256(readFileSync(join(dir, 'INDEX.md'))), lines: lineCount(indexText) });
  const startHere = readFileSync(join(dir, 'START-HERE.md'));
  sources.push({ file: 'START-HERE.md', sha256: sha256(startHere), lines: lineCount(startHere.toString('utf8')) });

  const index = new Map<string, { rank: number; difficulty: number; richness: number; verdict: string }>();
  for (const raw of indexText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = INDEX_LINE.exec(line);
    if (!m) continue;
    if (index.has(m[3]!)) throw new CampaignSourceError(`INDEX.md lists ${m[3]} twice`);
    index.set(m[3]!, { rank: Number(m[1]), difficulty: Number(m[4]), richness: Number(m[5]), verdict: m[6]! });
  }

  const files = readdirSync(join(dir, 'assess'))
    .filter((f) => /^batch-\d+\.jsonl$/.test(f))
    .sort(batchOrder);
  if (files.length === 0) throw new CampaignSourceError(`no assess/batch-N.jsonl files under ${dir}`);

  const rows: AssessRow[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const bytes = readFileSync(join(dir, 'assess', f));
    const text = stripBom(bytes.toString('utf8'));
    sources.push({ file: `assess/${f}`, sha256: sha256(bytes), lines: lineCount(text) });
    text.split('\n').forEach((raw, i) => {
      const line = raw.replace(/\r$/, '');
      if (!line.trim()) return;
      let r: Record<string, unknown>;
      try {
        r = JSON.parse(line) as Record<string, unknown>;
      } catch {
        throw new CampaignSourceError(`assess/${f}:${i + 1} is not valid JSON`);
      }
      const name = r.name;
      if (typeof name !== 'string' || !name) throw new CampaignSourceError(`assess/${f}:${i + 1} has no name`);
      if (seen.has(name)) return; // first-seen wins (rank.mjs)
      seen.add(name);
      const idx = index.get(name);
      if (!idx) throw new CampaignSourceError(`${name} (assess/${f}:${i + 1}) is not in INDEX.md`);
      const verdict = r.skip_or_study;
      if (verdict !== 'study' && verdict !== 'skim' && verdict !== 'skip') throw new CampaignSourceError(`${name}: verdict ${String(verdict)}`);
      const difficulty = Number(r.difficulty);
      const richness = Number(r.upskill_richness);
      // INDEX.md was generated from these rows: any disagreement means the inputs drifted apart
      if (idx.verdict !== verdict || idx.difficulty !== difficulty || idx.richness !== richness) {
        throw new CampaignSourceError(`${name}: assess row (${verdict} d${difficulty}/r${richness}) disagrees with INDEX.md (${idx.verdict} d${idx.difficulty}/r${idx.richness})`);
      }
      const confidence = r.confidence === 'high' || r.confidence === 'med' || r.confidence === 'low' ? r.confidence : null;
      rows.push({
        name,
        stack: String(r.stack ?? ''),
        kind: String(r.kind ?? ''),
        difficulty,
        richness,
        verdict,
        confidence,
        focus: String(r.study_focus ?? r.summary ?? ''),
        rank: idx.rank,
        file: `assess/${f}`,
        line: i + 1,
        lineSha256: sha256(line),
      });
    });
  }
  if (rows.length !== index.size) {
    const missing = [...index.keys()].filter((n) => !seen.has(n));
    throw new CampaignSourceError(`INDEX.md has ${index.size} entries but assess has ${rows.length} rows (missing: ${missing.slice(0, 5).join(', ')})`);
  }
  rows.sort((a, b) => a.rank - b.rank);
  return { rows, sources };
}
