// scripts/hit-profile.mjs — CPU-profile the frame in which a shot LANDS on the
// game page (Chrome DevTools Profiler over CDP). Prints the top self-time
// functions inside the sampled window. usage:
//   LAB_VITE_PORT=5340 LAB_CDP_PORT=9340 node scripts/hit-profile.mjs
import { execFileSync } from 'node:child_process';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5340);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9340);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120_000 }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 1200)); return r.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });
for (let i = 0; i < 240; i++) { const ok = await evaluate(`(async () => { const S = window.__sdfGame; if (!S?.resolveGpu) return false; try { await S.resolveGpu(); return true; } catch { return false; } })()`); if (ok) break; await sleep(250); }
await sleep(1500);
// Stage: zombie in the face, frozen, hand-stepped. Warm shot first so the
// first-use pipeline stall is out of the window. Then, under the profiler,
// each shot RE-AIMS (a landing shot staggers the zombie out of the line),
// fires when the reload gate accepts, and runs the landing frame inside
// window.__hitWindow so the profile can be cut to that frame's subtree.
await evaluate(`(async () => { const g = window.__sdfGame; g.woundPanel?.(false); g.gooPanel?.(false); g.setLoopRunning(false); g.teleport(1); g.step(2); g.freeze(true); function __hitWindow() { g.step(1); } window.__hitWindow = __hitWindow; window.__shotIdx = 0; window.__aimAndFire = async () => { const all = g.zombies(); const z = all[window.__shotIdx++ % all.length]; g.teleport(z.room); g.freeze(true); for (let i = 0; i < 6; i++) g.step(1); await g.resolveGpu(); const zb = g.zombie(z.id); for (const dz of [1.2, -1.2, 1.6, -1.6]) for (const yaw of [0, Math.PI]) for (const pitch of [-0.35, -0.2, 0, -0.5]) { g.setPose(z.pos[0], z.pos[2] + dz, yaw, pitch); for (let i = 0; i < 3; i++) g.step(1); await g.resolveGpu(); let n = 0; while (!g.fire(2) && n < 600) { g.step(1); if (++n % 15 === 0) await g.resolveGpu(); } await g.resolveGpu(); const before = zb.woundCount(); const t0 = performance.now(); window.__hitWindow(); const ms = +(performance.now() - t0).toFixed(1); const d = zb.woundCount() - before; for (let i = 0; i < 3; i++) g.step(1); await g.resolveGpu(); if (d > 0) return { ms, wounds: d, dz, yaw, pitch }; } return null; }; const warm = await window.__aimAndFire(); return warm; })()`).then(w => console.log('warm shot:', JSON.stringify(w)));
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 100 });
await send('Profiler.start');
const timing = await evaluate(`(async () => { const out = []; for (let s = 0; s < 6; s++) out.push(await window.__aimAndFire()); return out; })()`);
console.log('landing frames:', JSON.stringify(timing));
const prof = (await send('Profiler.stop')).result.profile;
await send('Profiler.disable');
console.log('hit-frame cpu ms per shot:', JSON.stringify(timing));
// Restrict to samples whose stack passes through __hitWindow (the landing frame).
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parentOf = new Map(); for (const n of prof.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
const inWindow = (id) => { let cur = id; while (cur !== undefined) { if (byId.get(cur).callFrame.functionName === '__hitWindow') return true; cur = parentOf.get(cur); } return false; };
const dt = prof.timeDeltas ?? [];
const self = new Map(); let winTotal = 0;
for (let i = 0; i < prof.samples.length; i++) { const id = prof.samples[i]; if (!inWindow(id)) continue; const ms = (dt[i] ?? 100) / 1000; winTotal += ms; self.set(id, (self.get(id) ?? 0) + ms); }
const agg = new Map();
for (const [id, ms] of self) { const cf = byId.get(id).callFrame; const key = `${cf.functionName || '(anon)'}  ${cf.url.replace(/^.*\/src\//, 'src/').replace(/^.*\/deps\//, 'three/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`; agg.set(key, (agg.get(key) ?? 0) + ms); }
console.log(`__hitWindow subtree total ${winTotal.toFixed(1)} ms over ${timing.filter(Boolean).length} landing frames; top self-time:`);
for (const [k, ms] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${ms.toFixed(1).padStart(7)} ms  ${k}`);
const incl = new Map();
for (const [id, ms] of self) { let cur = id; const seen = new Set(); while (cur !== undefined) { const nm = byId.get(cur).callFrame.functionName || '(anon)'; if (!seen.has(nm)) { incl.set(nm, (incl.get(nm) ?? 0) + ms); seen.add(nm); } cur = parentOf.get(cur); } }
console.log('inclusive within the landing frames (by function name):');
for (const [k, ms] of [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45)) console.log(`${ms.toFixed(1).padStart(7)} ms  ${k}`);
process.exit(0);
