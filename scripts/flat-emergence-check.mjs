// scripts/flat-emergence-check.mjs — headless check for the egg emerging in the Flat (docs/superpowers/plans/2026-10-16-emergence-in-the-flat.md, Task 8).
// ONE boot of /sdf-game.html?level=flat-early&emergence=1&res=320 (320 x 240), one Chrome, no loops, no soak:
//   1. COMPILE: wait for the warm gate; FAIL on any console error, any warning that looks like a WebGPU/WGSL validation message, any browser log
//      entry of that kind, or any uncaught page error (nothing in node compiles WGSL: this is it).
//   2. RUNTIME: the sequence autostarts; FAIL unless the puppet is built, its errors are empty, and the pass proxy is in the SDF layer's late scene.
//   3. SHOTS: the clock held at the five key times (glass-gives 2.0, push 5.5, crowning 8.0, out 10.0, settle 13.0) -> OUT/shot-<id>.png; FAIL
//      unless the proxy is visible at each and the puppet is visible at each.
//   4. HAND-OFF: skipEmergence, then FAIL unless the phase is done, the sequence is inactive, the puppet is hidden and the player stands on the
//      hand-off spot (within 0.3 m) after the rise.
//   5. COST: the runtime's CPU ms for the puppet and the pass, and the widest frame gap while the sequence ran. RECORDED, not gated.
//   6. SHEET: OUT/sheet.jpg — the five frames, labelled (Pillow, python3 -I).
// Usage: bash scripts/flat-emergence-check.sh        (starts its own servers). Direct: node scripts/flat-emergence-check.mjs <vitePort> <cdpPort> <outDir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VITE = Number(process.argv[2] ?? 5246);
const CDP = Number(process.argv[3] ?? 9246);
const OUT = resolve(process.argv[4] ?? '.lab-tmp/flat-emergence');
const KEY_TIMES = [['glass-gives', 2.0], ['push', 5.5], ['crowning', 8.0], ['out', 10.0], ['settle', 13.0]];
const GPU_MESSAGE = /webgpu|wgsl|validation|invalid (shader|bind|pipeline|render|texture|buffer)|shader ?module|pipeline|uncaptured|GPUError|dawn|error while parsing/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); dumpProblems(); process.exit(1); };
const pass = (msg) => console.log(`ok   ${msg}`);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);

mkdirSync(OUT, { recursive: true });
setTimeout(() => { console.error('FAIL: the check ran past its 600 s watchdog (a cold shader cache can take 3 minutes to warm)'); process.exit(1); }, 600000).unref();
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const problems = [];
const note = (kind, text) => { if (/favicon\.ico/.test(String(text))) return; if (!problems.some((p) => p.text === text)) problems.push({ kind, text: String(text).slice(0, 600) }); };
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error') note('console.error', text);
    else if (m.params.type === 'warning' && GPU_MESSAGE.test(text)) note('console.warn', text);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    note('uncaught', d.exception?.description ?? d.text ?? JSON.stringify(d));
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error' || (e.level === 'warning' && GPU_MESSAGE.test(e.text))) note(`log.${e.level}`, `${e.text}${e.url ? ` (${e.url})` : ''}`);
  }
};
const send = (method, params = {}) => new Promise((resolveMsg) => { const id = ++seq; pending.set(id, resolveMsg); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 120000, expression.slice(0, 80));
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
function dumpProblems() { for (const p of problems) console.error(`  [${p.kind}] ${p.text}`); }
const frames = (n) => evaluate(`new Promise((r) => { let n = ${n}; const f = () => (--n <= 0 ? r(1) : requestAnimationFrame(f)); requestAnimationFrame(f); setTimeout(() => r(0), 5000); })`);

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 480, deviceScaleFactor: 1, mobile: false });

// 1. COMPILE
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=flat-early&emergence=1&res=320` });
let phase = null;
for (let i = 0; i < 1100 && phase !== 'ready'; i++) {
  await sleep(500);
  phase = await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null);
  if (phase && phase !== 'ready') break;
  if (problems.length) break;
}
if (phase !== 'ready') fail(`the warm gate did not reach ready (phase ${phase})`);
// Clean frames: hide every DOM element that is not the canvas or one of its ancestors.
await evaluate(`(() => { let n = document.querySelector('canvas'); while (n && n !== document.body) { for (const sib of n.parentElement.children) if (sib !== n) sib.style.display = 'none'; n = n.parentElement; } return 1; })()`);
await evaluate(`(() => { window.__gaps = []; let last = performance.now(); const f = () => { const now = performance.now(); window.__gaps.push(Math.round(now - last)); last = now; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`);

// 2. RUNTIME
let st = null;
for (let i = 0; i < 60; i++) { st = await evaluate('__sdfGame.emergence()'); if (st && st.phase === 'playing') break; await sleep(500); }
if (!st || st.phase !== 'playing') fail(`the emergence did not autostart (state ${JSON.stringify(st)})`);
if (!st.puppetBuilt) fail('the goblin puppet was not built');
if (st.errors.length) fail(`the runtime reported errors: ${st.errors.join(' | ')}`);
if (!st.proxyInLateScene) fail('the screen pass proxy is not in the SDF layer\'s late scene');
pass(`booted and started: puppet built, proxy in the late scene, shot ${st.shot}`);

// 3. SHOTS
const rect = await evaluate('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()');
for (const [id, t] of KEY_TIMES) {
  if (!(await evaluate(`__sdfGame.emergenceSetT(${t})`))) fail(`emergenceSetT(${t}) was refused`);
  await frames(4); await sleep(400); await frames(2);
  const s = await evaluate('__sdfGame.emergence()');
  if (!s.proxyVisible) fail(`the pass proxy is hidden at ${t} s (${id})`);
  if (!s.puppetVisible) fail(`the puppet is hidden at ${t} s (${id})`);
  const png = (await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } })).result.data;
  writeFileSync(`${OUT}/shot-${id}.png`, Buffer.from(png, 'base64'));
  pass(`${id} at ${s.t.toFixed(2)} s: ${s.clip}, shot ${s.shot}, cpu puppet ${s.cpuMs.puppet} ms pass ${s.cpuMs.pass} ms`);
}

// 4. HAND-OFF
if (!(await evaluate('__sdfGame.skipEmergence()'))) fail('skipEmergence was refused');
for (let i = 0; i < 40; i++) { await sleep(250); st = await evaluate('__sdfGame.emergence()'); if (st.phase === 'done' && !st.rising) break; }
await sleep(1500); await frames(3);
st = await evaluate('__sdfGame.emergence()');
if (st.phase !== 'done') fail(`the hand-off did not finish (phase ${st.phase})`);
if (st.sequenceActive) fail('the sequence is still active after the hand-off');
if (st.puppetVisible) fail('the puppet is still visible after the hand-off');
const [fx, , fz] = st.handoff.feet, [px, , pz] = st.player.pos;
const off = Math.hypot(px - fx, pz - fz);
if (off > 0.3) fail(`the player stands ${off.toFixed(2)} m from the hand-off spot (${st.player.pos} vs ${st.handoff.feet})`);
pass(`hand-off: control with the player ${off.toFixed(2)} m from the spot, puppet hidden, sequence inactive`);

// 5. COST (recorded)
const gaps = await evaluate('window.__gaps');
console.log(`note frames ${gaps.length}, widest gap ${Math.max(0, ...gaps)} ms, median ${[...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]} ms (recorded, not gated)`);

if (problems.length) fail('the console had problems');
pass('no console errors or WebGPU validation messages');

// 6. SHEET
const SHEET_PY = `
import sys
from PIL import Image, ImageDraw
out, cells = sys.argv[1], [a.split('|') for a in sys.argv[2:]]
ims = [(c[0], c[1], Image.open(c[2]).convert('RGB')) for c in cells]
w, h = ims[0][2].size
BAR = 14
sheet = Image.new('RGB', (w * 3, (h + BAR) * 2), (14, 12, 16))
d = ImageDraw.Draw(sheet)
for i, (id_, t, im) in enumerate(ims):
    x, y = (i % 3) * w, (i // 3) * (h + BAR)
    d.text((x + 4, y + 2), f'{id_}  t={t}', fill=(255, 255, 255))
    sheet.paste(im, (x, y + BAR))
sheet.save(out, quality=90)
print(f'sheet {out} {sheet.width}x{sheet.height}')
`;
execFileSync('python3', ['-I', '-c', SHEET_PY, `${OUT}/sheet.jpg`, ...KEY_TIMES.map(([id, t]) => `${id}|${t.toFixed(1)}|${OUT}/shot-${id}.png`)], { stdio: 'inherit' });
console.log('PASS flat emergence check');
process.exit(0);
