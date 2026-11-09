// Minimal headless-Chrome driver used for the fable52docs review (no dependencies, Node >= 22).
// usage (Git Bash):  SCRATCH=C:/some/empty/folder node fable52docs/tools/cdp.mjs steps.json
//   SCRATCH must contain a 'shots' folder (screenshots land there) and gets a 'chrome' profile folder.
//   Chrome is expected at C:/Program Files/Google/Chrome/Application/chrome.exe (edit below if not).
// Tips: wait ~5 s after the first goto (Vite cold start). 'clickText' matches by substring, so
//   'Submit' also matches 'Load my last submitted code': use an 'eval' step with startsWith for that.
// Only drive a SANDBOX server (see ../README.md): submits write append-only attempts.
// script: [{goto:url},{wait:ms},{shot:name},{eval:js},{click:selector},{clickText:text},{type:text},{key:key},{size:[w,h]},{text:true}]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const S = process.env.SCRATCH;
const port = 9333;
const steps = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/chrome`, '--window-size=1440,900', '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = l.find((t) => t.type === 'page'); if (target) break; } catch {} await sleep(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)); else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 300)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
await send('Page.enable'); await send('Runtime.enable');
let W = 1440, H = 900;
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
for (const s of steps) {
  if (s.size) { [W, H] = s.size; await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 }); }
  if (s.goto) { await send('Page.navigate', { url: s.goto }); await sleep(s.ms ?? 1800); }
  if (s.wait) await sleep(s.wait);
  if (s.eval) console.log('EVAL>', JSON.stringify(await ev(s.eval)));
  if (s.click) console.log('CLICK', s.click, await ev(`(()=>{const e=document.querySelector(${JSON.stringify(s.click)}); if(!e) return 'NOT FOUND'; e.click(); return 'ok'})()`));
  if (s.clickText) console.log('CLICKTEXT', s.clickText, await ev(`(()=>{const t=${JSON.stringify(s.clickText)}; const e=[...document.querySelectorAll('button,a,[role=button],label,summary,[role=tab]')].find(x=>x.textContent.trim().toLowerCase().includes(t.toLowerCase())); if(!e) return 'NOT FOUND'; e.click(); return 'ok: '+e.tagName})()`));
  if (s.type) await send('Input.insertText', { text: s.type });
  if (s.key) { const [k, mod] = Array.isArray(s.key) ? s.key : [s.key, 0]; const code = k.length === 1 ? 'Key' + k.toUpperCase() : k; const vk = k.length === 1 ? k.toUpperCase().charCodeAt(0) : ({ Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38 })[k]; for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers: mod, text: type === 'keyDown' && k.length === 1 && !mod ? k : (k === 'Enter' && type === 'keyDown' ? '\r' : undefined) }); await sleep(300); }
  if (s.text) console.log('TEXT>', (await ev(typeof s.text === 'string' ? `document.querySelector(${JSON.stringify(s.text)})?.innerText` : 'document.body.innerText'))?.slice(0, s.max ?? 3000));
  if (s.shot) { let clip; if (s.full) { const m = await send('Page.getLayoutMetrics'); const c = m.result.cssContentSize; clip = { x: 0, y: 0, width: c.width, height: Math.min(c.height, 6000), scale: 1 }; console.log('PAGE', c.width, 'x', c.height); } const r = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: !!s.full }); writeFileSync(`${S}/shots/${s.shot}.png`, Buffer.from(r.result.data, 'base64')); console.log('SHOT', s.shot); }
}
if (logs.length) console.log('CONSOLE>', [...new Set(logs)].join('\n'));
ws.close(); chrome.kill();
