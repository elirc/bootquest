// npm run seed:audit:explanations [-- --track js|csharp|java|sysdrills|all] [--check] [--items] [--listed]
//   [--rule Q1] [--out <file>] [--authoring <dir>] [--sysdrills <dir>] [--sections <file>] [--node-check]
// rv3 PLAN §2 (ops/explain-audit.ts): scores every Fundamentals quiz explanation, drill explanation + hints and
// lesson, and every sysdrills explanation + hints, against the measurable bar; prints the summary table and
// writes the full per-item audit to --out (default .cache/rv3/explain-audit.json, git-ignored).
// --check: exit 1 when any GATE rule fails on the selected tracks. --items: one line per failing item.
// --listed: also the reading lists (D2, D3 claim sentences, L2, L3). --node-check: L4 for js (node --check
// on every ```js lesson block). Read-only apart from --out.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, REPO_ROOT } from '../factory/report.ts';
import { AUDIT_TRACKS, auditGateFailures, formatAuditItems, formatAuditSummary, jsBlocks, runAudit, type AuditTrack } from './explain-audit.ts';


const { opts, flags } = parseArgs(process.argv.slice(2));
const which = opts.get('track') ?? 'all';
const tracks: AuditTrack[] = which === 'all' ? [...AUDIT_TRACKS] : which.split(',').map((t) => {
  if (!(AUDIT_TRACKS as readonly string[]).includes(t)) throw new Error(`--track ${t}: want ${AUDIT_TRACKS.join(' | ')} | all`);
  return t as AuditTrack;
});
const fundamentalsAuthoring = resolve(opts.get('authoring') ?? join(REPO_ROOT, 'tools', 'seed', 'authoring', 'fundamentals'));
const audit = runAudit(
  {
    fundamentalsAuthoring,
    sysdrillsAuthoring: resolve(opts.get('sysdrills') ?? join(REPO_ROOT, 'tools', 'seed', 'authoring', 'sysdrills')),
    sectionsFile: resolve(opts.get('sections') ?? join(REPO_ROOT, 'content', 'fundamentals', 'sections.json')),
  },
  tracks,
);
const out = resolve(opts.get('out') ?? join(REPO_ROOT, '.cache', 'rv3', 'explain-audit.json'));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(audit, null, 1)}\n`);

console.log(`seed:audit:explanations — rv3 PLAN §2 bar, tracks ${tracks.join(', ')} (full audit: ${out})`);
if (flags.has('items') || flags.has('listed') || opts.has('rule')) for (const l of formatAuditItems(audit, { rule: opts.get('rule'), listed: flags.has('listed') })) console.log(l);
for (const l of formatAuditSummary(audit)) console.log(l);

if (flags.has('node-check') && tracks.includes('js')) {
  // L4 (js): every ```js lesson block must parse (node --check, as an ES module)
  const tmp = mkdtempSync(join(tmpdir(), 'bq-l4-'));
  let blocks = 0;
  const bad: string[] = [];
  try {
    const dir = join(fundamentalsAuthoring, 'js');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const t = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      jsBlocks(String(t.lesson ?? '')).forEach((code, i) => {
        blocks++;
        const file = join(tmp, `${t.topic}-${i + 1}.mjs`);
        writeFileSync(file, code);
        try {
          execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        } catch (err) {
          const msg = String((err as { stderr?: Buffer }).stderr ?? '').split('\n').find((l) => /Error/.test(l)) ?? 'does not parse';
          bad.push(`L4 fund/js/${t.topic} block ${i + 1}: ${msg.trim()}`);
        }
      });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const b of bad) console.log(b);
  console.log(`L4 (js lessons): ${blocks - bad.length}/${blocks} \`\`\`js block(s) pass node --check`);
}

const failures = auditGateFailures(audit);
console.log(`${audit.quiz.length} quiz item(s), ${audit.drills.length} drill(s), ${audit.lessons.length} lesson(s): ${failures} item(s) fail a gate rule`);
if (flags.has('check')) {
  console.log(`RESULT ${failures ? 'BELOW THE BAR' : 'OK'}`);
  process.exit(failures ? 1 : 0);
}
