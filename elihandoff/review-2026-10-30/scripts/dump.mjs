import fs from 'node:fs';
import path from 'node:path';
const root = 'C:/Users/Owner/Desktop/selfboot/content/seed/explainback';
const co = 'C:/Users/Owner/Desktop/selfboot/.cache/checkouts';
const showCite = process.env.CITES === '1';
const coDirs = fs.readdirSync(co);
for (const pat of process.argv.slice(2)) {
  const dirs = fs.readdirSync(root).filter(d => d.startsWith(pat));
  for (const d of dirs) {
    const it = JSON.parse(fs.readFileSync(path.join(root, d, 'items.json'), 'utf8'));
    for (const item of it.items) {
      const coDir = coDirs.find(x => x.startsWith(item.provenance.repo + '@' + item.provenance.sha.slice(0, 8)));
      console.log(`\n######## ${d} [set ${item.set || 'A'}] key=${item.key.split('/').pop()} unit=${item.provenance.path} L${item.provenance.lines.start}-${item.provenance.lines.end}`);
      item.questions.forEach((q, qi) => {
        console.log(`\n--- Q${qi}: ${q.prompt}`);
        q.keyPoints.forEach((k, ki) => {
          let src = '';
          if (k.quote) src = `  «${k.quote.replace(/\s+/g, ' ').slice(0, 140)}»`;
          if (k.cite) {
            src = `  @${k.cite.path}:${k.cite.lineStart}-${k.cite.lineEnd}`;
            if (showCite && coDir) {
              try {
                const lines = fs.readFileSync(path.join(co, coDir, k.cite.path), 'utf8').split(/\r?\n/);
                const s = Math.max(1, k.cite.lineStart), e = Math.min(lines.length, k.cite.lineEnd ?? s);
                src += '\n' + lines.slice(s - 1, e).map((l, i) => `      ${s + i}: ${l.slice(0, 150)}`).join('\n');
              } catch (err) { src += ' [UNREADABLE ' + err.message.slice(0, 60) + ']'; }
            }
          }
          console.log(`  kp${ki}: ${k.text}${src}`);
        });
      });
    }
  }
}
