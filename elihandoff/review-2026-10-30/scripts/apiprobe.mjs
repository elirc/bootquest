// Read-only probe of the running BootQuest API: shape + sizes, never bodies in full.
const base = 'http://127.0.0.1:4178/api';
const paths = process.argv.slice(2);
const summarize = (v, depth = 0) => {
  if (Array.isArray(v)) return `array(${v.length})` + (v.length && depth < 2 ? ` of ${summarize(v[0], depth + 1)}` : '');
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth >= 2) return `{${keys.slice(0, 12).join(',')}${keys.length > 12 ? ',…' : ''}}`;
    return '{ ' + keys.slice(0, 40).map((k) => `${k}: ${summarize(v[k], depth + 1)}`).join('; ') + (keys.length > 40 ? '; …' : '') + ' }';
  }
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 57) + '...' : v);
  return String(v);
};
for (const p of paths) {
  const res = await fetch(base + p, { headers: { Host: '127.0.0.1:4178' } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`\n### GET ${p} -> ${res.status} (${text.length} bytes)`);
  if (process.env.FULL) console.log(JSON.stringify(body, null, 1).slice(0, Number(process.env.FULL)));
  else console.log(summarize(body));
}
