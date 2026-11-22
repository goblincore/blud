// scripts/first-chunk-stall-probe.mjs — WHAT THE FIRST DEBRIS CHUNK COMPILES, AND HOW LONG rAF STOPS FOR IT.
//
// Boots ?level=fixtures/sectors, waits for the loader gate, spawns the doom gate's pit zombie and two test chunks in
// view, and reports the longest rAF gap from the spawn on, plus every pipeline created after the spawn. Then it looks
// at the zombie and reports that apart: the body march is another program.
// A warm Metal cache still lists the creations, so WHICH pipeline needs no cold run; HOW LONG does. The Metal cache
// is machine-global, so a cold run needs changed shader text: edit a literal the march uses (march/math.wgsl.ts hash13's
// 0.1031) to a value no run has used, run this, revert. Never commit that edit.
//
// Usage: node scripts/first-chunk-stall-probe.mjs <vitePort> <cdpPort> [--no-wait] [--out path]
//   default    waits for the background gib compile to settle, then spawns.
//   --no-wait  spawns as soon as the gate is ready, as a player (or the doom gate) can.
// Env: PROBE_LEVEL='' for the ring testbed (default 'level=fixtures/sectors&'), PROBE_SPAWN=headpop|detonate, WATCH_MS,
// LOOK_MS.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const VITE = Number(process.argv[2] ?? 5484);
const CDP = Number(process.argv[3] ?? 9484);
const args = process.argv.slice(4);
const NO_WAIT = args.includes('--no-wait');
const outAt = args.indexOf('--out');
const OUT = outAt >= 0 ? args[outAt + 1] : '.lab-tmp/first-chunk/probe.json';
const WATCH_MS = Number(process.env.WATCH_MS ?? 12000);
const LEVEL = process.env.PROBE_LEVEL ?? 'level=fixtures/sectors&';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
// A cold synchronous compile blocks the page, and an evaluate with it: no short timeout here on purpose.
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });
// Gaps BETWEEN animation frames: a stall inside GPU-process-blocked work is not a long task, only a missing frame.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const p = window.__rafGap = { last: 0, max: 0, maxAt: 0, over250: [], session: [], frames: 0 };
  const tick = (t) => {
    const now = performance.now();
    if (p.last) { const g = now - p.last; if (g > p.max) { p.max = g; p.maxAt = now; } if (g > 250) { p.over250.push([Math.round(now), Math.round(g)]); p.session.push([Math.round(now), Math.round(g)]); } }
    p.last = now; p.frames++; requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();` });

// Pixels, so a piece that compiled nothing because it never drew cannot pass for a fix.
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT.replace(/\.json$/, `-${name}.png`), Buffer.from(r.result.data, 'base64'));
};
const t0 = Date.now();
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${LEVEL}seed=7&pipelinelog=1` });
let phase = null;
for (let i = 0; i < 1200 && phase === null; i++) { await sleep(500); phase = await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null); }
const result = { noWait: NO_WAIT, gate: phase, readyWallMs: Date.now() - t0, warm: await evaluate('JSON.stringify(window.__warmDone?.phases ?? null)'), bgAtReady: await evaluate('__sdfGame.warmBackground()') };

if (!NO_WAIT) {
  for (let i = 0; i < 1200; i++) {
    const s = await evaluate('__sdfGame.warmBackground().gib');
    if (s === 'ready' || s === 'failed') break;
    await sleep(500);
  }
  result.bgAtSpawn = await evaluate('__sdfGame.warmBackground()');
  result.gibSettledWallMs = Date.now() - t0;
}
// spawnTestChunk borrows the first actor's view, and the fixture boots with no actors: the pit zombie, as in 6a.
result.zombieT = Math.round(await evaluate('performance.now()'));
result.zombie = await evaluate(`__sdfGame.spawnCrowd('zombie', 1, { region: { minX: 7.0, maxX: 7.6, minZ: -4.3, maxZ: -3.7 } })`);
await sleep(Number(process.env.ZOMBIE_SETTLE_MS ?? 1500));
result.bgAtSpawnChunk = await evaluate('__sdfGame.warmBackground()');
result.gapAfterZombie = await evaluate('Math.round(window.__rafGap.max)');
const spawnT = await evaluate(`(() => { const p = window.__rafGap; p.max = 0; p.maxAt = 0; p.over250 = []; return performance.now(); })()`);
// In view and fast, so the shutter layer selects the moving piece: that is the program's second target. Forward on the
// floor plane is (sin yaw, -cos yaw). The bake is off and the eye looks down, so the one dropped straight down stays a
// live marched piece in frame for the screenshot.
await evaluate(`(() => { __sdfGame.setChunkBake(false); const p = __sdfGame.pose(); __sdfGame.setPose(p.pos[0], p.pos[2], p.yaw, -0.9); return 1; })()`);
await sleep(300);
await shot('before');
// PROBE_SPAWN: 'headpop' is the real gore route (onGoreDispatch -> spawnChunkPiece), resting in front of the player;
// 'detonate' is a real blast on the pit zombie, whose pieces are offline meshes unless a part is missing.
const SPAWN = process.env.PROBE_SPAWN;
const ids = SPAWN === 'detonate' ? await evaluate('__sdfGame.detonate(7.3, -0.5, -4)')
  : SPAWN === 'headpop' ? await evaluate('__sdfGame.headPopShowcase(__sdfGame.actorList()[0].id)')
  : await evaluate(`(() => {
  const p = __sdfGame.pose(); const fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const x = p.pos[0] + fx * 0.6, z = p.pos[2] + fz * 0.6, y = p.pos[1] - 0.5;
  return [__sdfGame.spawnTestChunk(x, y, z, 0.12, false, [fz * 6, 1, -fx * 6]), __sdfGame.spawnTestChunk(x - fz * 0.15, y, z + fx * 0.15, 0.12, true)];
})()`);
const wallSpawn = Date.now();
await sleep(1500);
await shot('after-spawn');
await sleep(WATCH_MS);
// A job that was still compiling when the chunk spawned settles later: follow it, or the first draw is unwatched.
for (let i = 0; i < 1200; i++) {
  const s = await evaluate('__sdfGame.warmBackground().gib');
  if (s === 'ready' || s === 'failed') break;
  await sleep(500);
}
await sleep(4000);
await shot('settled');
result.ids = ids;
result.chunkCounts = await evaluate('__sdfGame.chunkCounts()');
// The body march is a program of its own: look at the zombie and report what THAT costs, apart from the chunk's numbers.
result.rafGapChunk = await evaluate('(() => { const p = window.__rafGap; const r = { maxMs: Math.round(p.max), over250: p.over250, frames: p.frames, sinceLastFrameMs: Math.round(performance.now() - p.last) }; p.max = 0; p.over250 = []; return r; })()');
result.lookT = Math.round(await evaluate('performance.now()'));
await evaluate(`(() => { const p = __sdfGame.pose(); const dx = 7.3 - p.pos[0], dz = -4 - p.pos[2]; __sdfGame.setPose(p.pos[0], p.pos[2], Math.atan2(dx, -dz), -0.1); return 1; })()`);
await sleep(Number(process.env.LOOK_MS ?? 6000));
result.rafGapLook = await evaluate('(() => { const p = window.__rafGap; return { maxMs: Math.round(p.max), over250: p.over250, frames: p.frames, sinceLastFrameMs: Math.round(performance.now() - p.last) }; })()');
result.spawnToLastSampleMs = Date.now() - wallSpawn;
result.bgEnd = await evaluate('__sdfGame.warmBackground()');
result.rafGap = await evaluate('(() => { const p = window.__rafGap; return { maxMs: Math.round(p.max), maxAt: Math.round(p.maxAt), over250: p.over250, sessionOver250: p.session }; })()');
result.spawnT = Math.round(spawnT);
const census = await evaluate('__sdfGame.pipelineCensus()');
result.warmDone = await evaluate('JSON.stringify(window.__warmDone?.phases?.backgroundDone ?? null)');
const row = (e) => ({ kind: e.kind, name: e.name, ms: Math.round(e.ms), async: e.async, via: e.via, t: Math.round(e.t), fragBytes: e.fragmentBytes ?? e.fragmentShaderBytes ?? null, mat: e.material, obj: `${e.objectType}:${e.objectName}`, sig: String(e.sig ?? '').slice(0, 220), key: e.threeKey ?? e.cacheKey ?? null });
result.afterSpawn = census.entries.filter((e) => e.t >= spawnT && e.t < result.lookT).map(row);
result.afterLook = census.entries.filter((e) => e.t >= result.lookT).map(row);
result.afterReady = census.entries.filter((e) => e.t >= result.zombieT).map(row);
result.bigAll = census.entries.filter((e) => e.ms >= 200 || (e.fragmentBytes ?? e.fragmentShaderBytes ?? 0) > 100000).map(row);
result.errors = errors;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ zombie: result.zombie, zombieT: result.zombieT, gapBeforeChunk: result.gapAfterZombie, bgAtSpawnChunk: result.bgAtSpawnChunk, gate: result.gate, readyWallMs: result.readyWallMs, gibSettledWallMs: result.gibSettledWallMs, ids: result.ids, chunks: result.chunkCounts,  bgAtReady: result.bgAtReady, bgEnd: result.bgEnd, bgDoneMs: result.warmDone, rafGapChunk: result.rafGapChunk, rafGapLook: result.rafGapLook, sessionOver250: result.rafGap.sessionOver250, spawnT: result.spawnT, lookT: result.lookT, afterSpawn: result.afterSpawn.map((e) => [e.name, e.fragBytes, e.async ? 'async' : 'SYNC', e.t, e.sig.match(/T:[^|]*/)?.[0]]), afterLook: result.afterLook.map((e) => [e.name, e.fragBytes, e.async ? 'async' : 'SYNC', e.t, e.sig.match(/T:[^|]*/)?.[0]]), bigAll: result.bigAll.map((e) => [e.name, e.fragBytes, e.async ? 'async' : 'SYNC', e.t, e.sig.match(/T:[^|]*/)?.[0]]), errors }, null, 1));
ws.close();
process.exit(0);
