// For every quiz key present at BASE and at HEAD (content/seed/quests/*/items.json): report any change of
// answerKey (correct slot) or of choice order (the correct choice's position, plus the permutation of the
// distractors by base text where texts are unchanged). Usage: node slotcheck.cjs <repoRoot> <baseRef> [headRef|WORKTREE]
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const [root, base, head = 'WORKTREE'] = process.argv.slice(2);
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const packs = fs.readdirSync(path.join(root, 'content/seed/quests'));
const read = (ref, p) => { const f = `content/seed/quests/${p}/items.json`;
  try { return JSON.parse(ref === 'WORKTREE' ? fs.readFileSync(path.join(root, f), 'utf8') : git('show', `${ref}:${f}`)); } catch { return null; } };
let checked = 0, changedText = 0; const bad = [];
for (const p of packs) {
  const a = read(base, p), b = read(head, p); if (!a || !b) continue;
  const A = new Map((a.items || a).filter(x => x.kind === 'quiz').map(x => [x.key, x]));
  for (const y of (b.items || b).filter(x => x.kind === 'quiz')) {
    const x = A.get(y.key); if (!x) continue; checked++;
    const ta = x.check.choices, tb = y.check.choices;
    const same = JSON.stringify(ta) === JSON.stringify(tb);
    if (!same) changedText++;
    const ka = x.check.answerKey, kb = y.check.answerKey;
    const issues = [];
    if (ka !== kb) issues.push(`answerKey ${ka} -> ${kb}`);
    if (ta.length !== tb.length) issues.push(`choice count ${ta.length} -> ${tb.length}`);
    // distractor order: for each base distractor text that survives verbatim, its index must be unchanged
    ta.forEach((t, i) => { const j = tb.indexOf(t); if (j >= 0 && j !== i) issues.push(`"${t.slice(0, 40)}" moved ${i} -> ${j}`); });
    if (!same || issues.length) console.log(`${issues.length ? 'BAD ' : 'ok  '} ${p} ${y.key.slice(-16)} ${same ? '' : '(text edited)'} ${issues.join('; ')}`);
    if (issues.length) bad.push(y.key);
  }
}
console.log(`checked ${checked} surviving quizzes; ${changedText} with edited choice text; ${bad.length} BAD`);
process.exit(bad.length ? 1 : 0);
