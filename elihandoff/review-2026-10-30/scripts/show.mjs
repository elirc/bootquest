import fs from 'node:fs';
const root = 'C:/Users/Owner/Desktop/selfboot/tools/seed/authoring';
for (const spec of process.argv.slice(2)) {
  const [bank, mod, slug] = spec.split('/');
  const file = `${root}/${bank}/${mod}.json`;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const idx = j.exercises.findIndex(e => e.slug === slug);
  const ex = j.exercises[idx];
  if (!ex) { console.log(`!! ${spec} not found`); continue; }
  // approximate line of the slug in the file
  const text = fs.readFileSync(file, 'utf8');
  const line = text.slice(0, text.indexOf(`"slug": "${slug}"`)).split('\n').length;
  console.log(`\n==================== ${spec}  (file line ~${line}, exercise #${idx+1}, d${ex.difficulty}) ====================`);
  console.log(`TITLE: ${ex.title}\nSKILLS: ${(ex.skills||[]).join(', ')}`);
  console.log(`\n--- INSTRUCTIONS ---\n${ex.instructions}`);
  if (ex.starter) console.log(`\n--- STARTER ---\n${ex.starter}`);
  if (ex.starterHead) console.log(`\n--- STARTER HEAD ---\n${ex.starterHead}`);
  if (ex.solution) console.log(`\n--- SOLUTION ---\n${ex.solution}`);
  if (ex.solutionHead) console.log(`\n--- SOLUTION HEAD ---\n${ex.solutionHead}`);
  if (ex.tail) console.log(`\n--- TAIL ---\n${ex.tail}`);
  if (ex.solutionTail) console.log(`\n--- SOLUTION TAIL ---\n${ex.solutionTail}`);
  if (typeof ex.tests === 'string') console.log(`\n--- TESTS ---\n${ex.tests}`);
  if (Array.isArray(ex.tests)) { console.log(`\n--- TESTS ---`); for (const t of ex.tests) console.log(`[${t.name}]\n${t.code}\n`); }
  console.log(`\n--- EXPLANATION ---\n${ex.explanation}`);
  console.log(`\n--- HINTS ---\n${(ex.hints||[]).map((h,i)=>`${i+1}. ${h}`).join('\n')}`);
}
