// scripts/screen-emergence-check.mjs — headless check for the screen emergence lab spike (docs/superpowers/plans/2026-10-11-screen-emergence-lab-spike.md, Task 9).
//   1. COMPILE: load /sdf-screen-lab.html, wait for window.__screenLab.ready; FAIL on any console error, any warning that looks like a
//      WebGPU/WGSL validation message, any browser log entry of that kind, or any uncaught page error. Nothing in node compiles WGSL: this is it.
//   2. SHOTS: one frame per shot at its key time (glass-gives 2.0, push 5.5, crowning 8.0, out 10.0, settle 13.0) -> OUT/shot-<id>.png.
//   3. COST: median of three timeDraws(21), after a warm-up read, at push and crowning with the pass off / on / on + goo shadow. FAIL if the
//      pass-on frame is over 33 ms (only when the pass-off baseline at that shot is under 25 ms, else a loud note) or the pass adds over 8 ms.
//   4. SHEET: OUT/sheet.jpg — the animatic's key frames as the first row, then the five frames in two columns, labelled (Pillow, python3 -I).
// Usage: bash scripts/screen-emergence-check.sh        (starts its own servers). Direct: node scripts/screen-emergence-check.mjs <vitePort> <cdpPort> <outDir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VITE = Number(process.argv[2] ?? 5244);
const CDP = Number(process.argv[3] ?? 9244);
const OUT = resolve(process.argv[4] ?? '.lab-tmp/screen-emergence');
const ANIMATIC = resolve('docs/dev-notes/2026-10-01-flat-emergence-lookdev/keyframes.png');
const KEY_TIMES = [['glass-gives', 2.0], ['push', 5.5], ['crowning', 8.0], ['out', 10.0], ['settle', 13.0]];
const COST_SHOTS = [['push', 5.5], ['crowning', 8.0]];
const BUDGET_MS = 33, BASELINE_OK_MS = 25, PASS_COST_MS = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`ok   ${msg}`);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
// What a WebGPU / WGSL validation message looks like in Chrome's console and log (errors are always bad; warnings only if they look like these).
const GPU_MESSAGE = /webgpu|wgsl|validation|invalid (shader|bind|pipeline|render|texture|buffer)|shader ?module|pipeline|uncaptured|GPUError|dawn|error while parsing/i;

setTimeout(() => { console.error('FAIL: the check ran past its 420 s watchdog'); process.exit(1); }, 420000).unref();
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const problems = [];
const note = (kind, text) => { if (/favicon\.ico/.test(String(text))) return; /* the dev server has no favicon: a 404, not a fault */ if (!problems.some((p) => p.text === text)) problems.push({ kind, text: String(text).slice(0, 1200) }); };
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
const dumpProblems = () => { for (const p of problems) console.error(`  [${p.kind}] ${p.text}`); };
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

// 1. COMPILE
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-screen-lab.html?nopass=0&res=1280x800` });
let ready = false;
for (let i = 0; i < 240 && !ready; i++) {
  await sleep(500);
  ready = (await evaluate('Boolean(window.__screenLab && window.__screenLab.ready)').catch(() => false)) === true;
  if (problems.length && !ready) { await sleep(1500); break; }     // a compile failure never reaches ready: do not wait out the clock
}
const settle = async () => { await sleep(1500); };                // validation errors arrive asynchronously, behind the frame that caused them
if (!ready) {
  await settle();
  console.error('the page never reached __screenLab.ready; messages:'); dumpProblems();
  const status = await evaluate("document.getElementById('status')?.innerText ?? ''").catch(() => '');
  if (status) console.error(`page status:\n${status}`);
  fail(problems.length ? 'console errors / WebGPU validation messages (above)' : 'the lab never reported ready');
}
await settle();
if ((await evaluate("document.getElementById('status')?.innerText ?? ''")).includes('backend: webgpu') === false) {
  fail('the lab is not on the webgpu backend');
}
if (problems.length) { console.error('console errors / WebGPU validation messages:'); dumpProblems(); fail('compile check'); }
pass('compile: the lab reached ready on webgpu with no console errors or validation messages');

const frames = (n) => evaluate(`new Promise((r) => { let n = ${n}; const f = () => (--n <= 0 ? r(1) : requestAnimationFrame(f)); requestAnimationFrame(f); setTimeout(() => r(0), 3000); })`);

// 2. SHOTS
mkdirSync(OUT, { recursive: true });
await evaluate('(() => { const s = window.__screenLab; s.setPass(true); s.setGooShadow(true); return 1; })()');
// Clean frames: hide every element that is not the canvas or one of its ancestors (the status, stats and shot-bar overlays).
await evaluate(`(() => { let n = document.querySelector('canvas'); while (n && n !== document.body) { for (const sib of n.parentElement.children) if (sib !== n) sib.style.display = 'none'; n = n.parentElement; } return 1; })()`);
await frames(2);
const rect = await evaluate('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()');
for (const [id, t] of KEY_TIMES) {
  await evaluate(`window.__screenLab.setT(${t})`);
  await frames(2);
  await sleep(700);                                              // the pose step, the goo replay and any first-use pipeline for this t
  await frames(2);
  const png = (await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } })).result.data;
  writeFileSync(`${OUT}/shot-${id}.png`, Buffer.from(png, 'base64'));
  console.log(`shot ${OUT}/shot-${id}.png  (${id}, t=${t})`);
}

// 3. COST
const CONFIGS = [['pass off', false, true], ['pass on, goo shadow off', true, false], ['pass on, goo shadow on', true, true]];
// timeDraws now and then never returns (its GPU fence, resolveTimestampsAsync, can go unanswered while the loop's own drain is in flight; seen
// in about one run in four, and it left the page hung for minutes). A fresh call recovers the page, so a read that does not come back in 20 s is
// dropped and asked again.
const read = async (n) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ms = await evaluate(`Promise.race([window.__screenLab.timeDraws(${n}), new Promise((r) => setTimeout(() => r(NaN), 20000))])`);
    if (Number.isFinite(ms)) return ms;
    console.warn(`timeDraws(${n}) did not come back in 20 s (attempt ${attempt + 1}); asking again`);
  }
  fail(`timeDraws(${n}) never came back`);
};
const measure = async () => {
  const cost = {};                                               // shot -> config -> ms
  for (const [id, t] of COST_SHOTS) {
    await evaluate(`window.__screenLab.setT(${t})`);
    cost[id] = {};
    for (const [label, on, shadow] of CONFIGS) {
      await evaluate(`(() => { const s = window.__screenLab; s.setPass(${on}); s.setGooShadow(${shadow}); return 1; })()`);
      await sleep(500);
      for (let i = 0; i < 3; i++) await read(21);   // warm: the pipelines, and the GPU clocks a pause lets drop (a first read right after a change catches both)
      const reads = [];
      for (let i = 0; i < 3; i++) reads.push(await read(21));
      cost[id][label] = median(reads);
    }
  }
  await evaluate('(() => { const s = window.__screenLab; s.setPass(true); s.setGooShadow(true); return 1; })()');
  return cost;
};
const pad = (s, n) => String(s).padEnd(n);
const judge = (cost) => {
  console.log(`\nframe cost, ms per frame (median of three timeDraws(21) after a warm-up; ${Math.round(rect.width)}x${Math.round(rect.height)}):`);
  console.log(`${pad('shot', 14)}${CONFIGS.map(([l]) => pad(l, 26)).join('')}pass cost (worst on - off)`);
  const failures = [], notes = [];
  for (const [id, t] of COST_SHOTS) {
    const c = cost[id];
    const base = c['pass off'];
    const worstOn = Math.max(c['pass on, goo shadow on'], c['pass on, goo shadow off']);
    const delta = worstOn - base;
    console.log(`${pad(`${id} t=${t}`, 14)}${CONFIGS.map(([l]) => pad(c[l].toFixed(2), 26)).join('')}${delta.toFixed(2)}`);
    if (delta > PASS_COST_MS) failures.push(`${id}: the pass adds ${delta.toFixed(2)} ms (> ${PASS_COST_MS} ms)`);
    if (base < BASELINE_OK_MS) {
      if (worstOn > BUDGET_MS) failures.push(`${id}: pass-on frame ${worstOn.toFixed(2)} ms > ${BUDGET_MS} ms (baseline ${base.toFixed(2)} ms)`);
    } else {
      notes.push(`NOTE ${id}: the pass-off baseline is ${base.toFixed(2)} ms (>= ${BASELINE_OK_MS} ms): the machine is loaded, or the goblin alone is already over budget; the ${BUDGET_MS} ms limit is NOT enforced here.`);
    }
  }
  return { failures, notes };
};
// A burst of GPU contention from another process lands inside one config's three reads and moves its median by ~10 ms (seen: the same
// scene read 24 ms and 35 ms in back-to-back runs), so a failing table is measured again, up to twice more; only a failure that holds fails.
let verdict;
for (let attempt = 1; attempt <= 3; attempt++) {
  verdict = judge(await measure());
  for (const n of verdict.notes) console.warn(n);
  if (!verdict.failures.length) break;
  if (attempt < 3) console.warn(`measuring again (attempt ${attempt} failed: ${verdict.failures.join('; ')})`);
}
await settle();
if (problems.length) { console.error('console errors / WebGPU validation messages during the run:'); dumpProblems(); fail('console / validation messages'); }
if (verdict.failures.length) fail(verdict.failures.join('; '));
pass(`cost: the pass adds at most ${PASS_COST_MS} ms and the on frame holds ${BUDGET_MS} ms where the baseline allows`);

// 4. SHEET (Pillow; paths as arguments, python3 -I so nothing is imported from the cwd)
const SHEET_PY = `
import sys
from PIL import Image, ImageDraw, ImageFont
out, animatic, *shots = sys.argv[1:]
COL, PAD, BAR = 960, 12, 34
font = ImageFont.load_default(size=22)
small = ImageFont.load_default(size=18)
cells = []
for spec in shots:
    sid, t, path = spec.split('|', 2)
    im = Image.open(path).convert('RGB')
    cells.append((f'{sid}   t = {t}', im.resize((COL, round(im.height * COL / im.width)), Image.LANCZOS)))
old = Image.open(animatic).convert('RGB')
old = old.resize((COL, round(old.height * COL / old.width)), Image.LANCZOS)
rows = [[('the old Blender animatic (key frames)', old), None]]
for i in range(0, len(cells), 2):
    rows.append([cells[i], cells[i + 1] if i + 1 < len(cells) else None])
heights = [max((c[1].height for c in r if c), default=0) + BAR for r in rows]
W = 2 * COL + 3 * PAD
H = sum(heights) + PAD * (len(rows) + 1)
sheet = Image.new('RGB', (W, H), (14, 12, 16))
d = ImageDraw.Draw(sheet)
y = PAD
for r, h in zip(rows, heights):
    for ci, cell in enumerate(r):
        if not cell: continue
        x = PAD + ci * (COL + PAD)
        d.text((x + 4, y + 5), cell[0], fill=(235, 225, 200), font=font)
        sheet.paste(cell[1], (x, y + BAR))
    y += h + PAD
d.text((PAD + COL + PAD + 4, PAD + BAR + 8), 'the lab (this check): one key frame per shot, in order, left to right then down', fill=(150, 145, 135), font=small)
sheet.save(out, quality=90)
print(f'sheet {out} {W}x{H}')
`;
execFileSync('python3', ['-I', '-c', SHEET_PY, `${OUT}/sheet.jpg`, ANIMATIC, ...KEY_TIMES.map(([id, t]) => `${id}|${t.toFixed(1)}|${OUT}/shot-${id}.png`)], { stdio: 'inherit' });

console.log('PASS screen-emergence-check');
process.exit(0);
