import fs from 'node:fs';
import path from 'node:path';
const root = 'C:/Users/Owner/Desktop/selfboot/tools/seed/authoring';
const banks = ['csdrills','javadrills','sysdrills'];
const out = [];
const lint = [];
for (const bank of banks) {
  const dir = path.join(root, bank);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  let total = 0;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out.push(`\n## ${bank}/${j.module} — ${j.title} (${j.exercises.length})`);
    for (const ex of j.exercises) {
      total++;
      const h3 = (ex.hints||[])[2] || '';
      const codey = /[;=>()]|return /.test(h3);
      let ntests;
      if (Array.isArray(ex.tests)) ntests = ex.tests.length;
      else if (typeof ex.tests === 'string') ntests = (ex.tests.match(/Test\(/g)||[]).length;
      else if (ex.starter) ntests = (ex.starter.match(/\btest\(/g)||[]).length;
      out.push(`| ${ex.slug} | ${ex.title} | d${ex.difficulty} | ${(ex.skills||[]).join(', ')} | t${ntests} |`);
      if (codey) lint.push(`${bank}/${j.module}/${ex.slug}: hint3 code-like: ${h3.slice(0,120)}`);
      // "Your task" handing over formula: look for backtick formula with operators in instructions after "Your task"
      const yt = ex.instructions.split('**Your task').slice(1).join('');
      const formulaMatch = yt.match(/`[^`]*[×*\/+\-][^`]*`/g);
      if (formulaMatch && bank==='sysdrills') lint.push(`${bank}/${j.module}/${ex.slug}: task-formula: ${formulaMatch.slice(0,3).join(' | ').slice(0,160)}`);
    }
  }
  out.push(`\n### ${bank} total: ${total}`);
}
fs.mkdirSync('C:/Users/Owner/Desktop/selfboot/elihandoff/review-2026-10-30/scripts/out', { recursive: true });
fs.writeFileSync('C:/Users/Owner/Desktop/selfboot/elihandoff/review-2026-10-30/scripts/out/topicmap.md', out.join('\n'));
fs.writeFileSync('C:/Users/Owner/Desktop/selfboot/elihandoff/review-2026-10-30/scripts/out/lint.txt', lint.join('\n'));
console.log(out.join('\n'));
console.log('\n=== LINT ===\n' + lint.length + ' items');
