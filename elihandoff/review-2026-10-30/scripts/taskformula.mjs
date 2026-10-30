import fs from 'node:fs';
const root = 'C:/Users/Owner/Desktop/selfboot/tools/seed/authoring';
for (const bank of ['sysdrills','csdrills','javadrills']) {
  const per = {};
  const examples = [];
  for (const f of fs.readdirSync(`${root}/${bank}`).filter(f=>f.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(`${root}/${bank}/${f}`,'utf8'));
    let n = 0;
    for (const ex of j.exercises) {
      const yt = ex.instructions.split(/\*\*Your task/)[1] || '';
      // arrow followed by backticked arithmetic (× ÷ or * / between operands), or words like 'ceil(' 'max('
      const m = yt.match(/→\s*`[^`]*(?:[×÷]|\s[*\/+]\s|ceil\(|floor\(|max\(|min\()[^`]*`/g);
      if (m) { n++; if (examples.length < 3 || f.startsWith('1')) examples.push(`${j.module}/${ex.slug}: ${m[0].slice(0,100)}`); }
    }
    per[j.module] = `${n}/${j.exercises.length}`;
  }
  console.log(bank, JSON.stringify(per, null, 0));
  if (bank==='sysdrills') console.log(examples.filter(e=>/^1[5-8]/.test(e)).join('\n'));
}
