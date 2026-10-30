import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = 'C:/Users/Owner/Desktop/selfboot/tools/seed/authoring/sysdrills';
const tmp = path.resolve('./tmpmods'); fs.mkdirSync(tmp, { recursive: true });
let pass = 0, fail = 0, starterPass = 0; const fails = [];
for (const f of fs.readdirSync(root).filter(f => f.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  for (const ex of j.exercises) {
    for (const [kind, src] of [['solution', ex.solution], ['starter', ex.starter]]) {
      const p = path.join(tmp, `${j.module}__${ex.slug}__${kind}.mjs`);
      fs.writeFileSync(p, src);
      let mod;
      try { mod = await import(pathToFileURL(p).href); } catch (e) { if (kind==='solution') { fail++; fails.push(`${j.module}/${ex.slug}: solution import error ${e.message}`); } continue; }
      let allOk = true;
      for (const t of ex.tests) {
        try { const fn = new (Object.getPrototypeOf(async function(){}).constructor)('mod','assert', t.code); await fn(mod, assert); }
        catch (e) { allOk = false; if (kind==='solution') { fail++; fails.push(`${j.module}/${ex.slug} [${t.name}]: ${e.message.split('\n')[0]}`); } }
      }
      if (kind==='solution' && allOk) pass++;
      if (kind==='starter' && allOk) { starterPass++; fails.push(`${j.module}/${ex.slug}: STARTER PASSES ALL TESTS`); }
    }
  }
}
console.log(`solutions passing all tests: ${pass}; failing tests: ${fail}; starters passing: ${starterPass}`);
console.log(fails.join('\n'));
