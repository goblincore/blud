// scripts/sdf-game-doom-gate.mjs — headless gate for sector levels (spec 2026-10-24-doom-sector-levels-design.md).
//   1. FIXTURE boot: webgpu, ready, no errors, geometry 'sectors'.
//   2. FIXTURE walk: up the 0.5 m step, stopped by the 1.0 m ledge, down into the pit, stopped by the column.
//   3. E1M1 (skipped if public/assets/levels/doom-e1m1.level.json is absent): boot, the ROUTE, budget, shots.
//   4. E1M1 pools and sector light (plan 2026-10-24-sector-levels-2): a hurt floor hurts (?god=0) and stops
//      hurting off it; the glow reads green; sector light lifts a bright sector's frame (A/B); the glow bounce
//      greens a wall near the big pool (G/R with the default bounceGain vs bounceGain 0).
//   5. E1M1 enemies (plan 2026-10-24-sector-levels-3a Task 6): spawns match the converter, bodies on their floors
//      at 3 s and 20 s, someone walks > 2 m, rounds from a soldier that sees the player stop at walls (followed frame
//      by frame), hidden behind a wall nobody fires and in the open someone does (?god=0), the exit completes the
//      level; the budget with enemies in view and SHOTS e1m1-enemies-*.png (report only).
//   6. Debris on sector floors (plan 2026-10-25-sector-levels-3b Task 15). 6a on the fixture: test chunks roll off
//      a ledge and into the pit and stop at a riser, the north wall and the column (followed frame by frame); a
//      blood burst over the C/B edge splats on both floors; a bundle rolls off C and rests on the floor under it;
//      a surface-blood burst stains a sector wall; a corpse lies on the pit floor. 6b on E1M1 (after 5.4b, so
//      casings exist): a soldier collapses, a blast gibs an actor on a non-zero floor, and every settled piece,
//      splat, casing, gun, kit piece, rope and pickup is on the floor under it (SHOTS e1m1-debris-0..1.png).
// Usage: LAB_TMP=.lab-tmp bash scripts/sdf-game-doom-gate.sh   (DOOM_GATE_ONLY_FIXTURE=1 skips 3–4; SHOTS=1 writes
// shots and .lab-tmp/doom/sector-light-sheet.png; TUNING=1 also writes the owner's .lab-tmp/doom/tuning-sheet.png)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
const OUT = '.lab-tmp/doom';

const VITE = Number(process.argv[2] ?? 5483);
const CDP = Number(process.argv[3] ?? 9483);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`ok   ${msg}`);
/** A collapsed body's posed lowest point minus the floor under it (6a, 6b). Calibrated 2026-10-25: a collapsed
 *  zombie reads about -0.15 m on a room level (the arena) and on the fixture's floors 0 and 0.5, -0.26 m in its pit. */
const CORPSE_LOW_BAND = [-0.3, 0.25];
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} });
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pending = new Map(); let consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  if (m.method === 'Runtime.exceptionThrown') consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 60000, expression.slice(0, 80));
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 720, deviceScaleFactor: 1, mobile: false });

async function boot(level, query = '') {
  consoleEvents = [];
  await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?level=${level}${query}` });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) {
    await sleep(500);
    ready = (await evaluate('window.__warmGate ? window.__warmGate.phase : null').catch(() => null)) === 'ready';
    if (consoleEvents.some((e) => e.type === 'error' || e.type === 'exception')) break;
  }
  if (!ready) { console.error(consoleEvents.slice(-8)); fail(`${level} did not boot to ready`); }
  if ((await evaluate('__sdfGame.backend')) !== 'webgpu') fail('backend is not webgpu');
  const info = await evaluate('__sdfGame.level()');
  if (info.geometry !== 'sectors') fail(`${level}: geometry ${info.geometry}, expected sectors`);
  pass(`boot: ${level} ready on webgpu, ${info.rooms.length} zones`);
}

/** Walk from `from` toward `to` for `ms`; return the final pose. y is set to the floor there first. */
async function walk(from, to, ms) {
  const floor = (await evaluate(`__sdfGame.ground(${from[0]}, ${from[1]})`)).floor;
  await evaluate(`__sdfGame.setPose(${from[0]}, ${from[1]}, 0, 0, ${floor})`);
  await evaluate(`__sdfGame.walkTo(${to[0]}, ${to[1]})`);
  await sleep(ms);
  const pos = (await evaluate('__sdfGame.pose()')).pos;
  await evaluate('__sdfGame.walkCancel()');
  return pos;
}

/** A screenshot from a pose (x, z, yaw) standing on the floor there. */
async function shot(file, x, z, yaw) {
  mkdirSync(OUT, { recursive: true });
  const f = (await evaluate(`__sdfGame.ground(${x}, ${z})`)).floor;
  await evaluate(`__sdfGame.setPose(${x}, ${z}, ${yaw}, 0, ${f})`);
  await sleep(1200);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${file}`, Buffer.from(s.result.data, 'base64'));
}

// 1–2. THE FIXTURE (see the plan's diagram)
await boot('fixtures/sectors');
let p = await walk([2.5, -6], [2.5, -10], 3000);
if (!(Math.abs(p[1] - 0.5) < 0.02 && p[2] < -8.3)) fail(`step: ended at ${p.map((v) => v.toFixed(2))}, expected on B (y 0.5, z < -8.3)`);
pass('fixture: walked up the 0.5 m step');
p = await walk([2.5, -10], [2.5, -14], 3000);
if (!(p[2] > -12 && Math.abs(p[1] - 0.5) < 0.02)) fail(`ledge: ended at ${p.map((v) => v.toFixed(2))}, expected stopped on B`);
pass(`fixture: stopped ${(p[2] + 12).toFixed(2)} m short of the 1.0 m ledge`);
p = await walk([2.5, -6], [6.5, -6], 3000);
if (!(Math.abs(p[1] + 1) < 0.02 && p[0] > 4.3)) fail(`pit: ended at ${p.map((v) => v.toFixed(2))}, expected in D (y -1)`);
pass('fixture: dropped into the pit');
// The autopilot strafes round a blocker when stuck, so the end pose says nothing: measure the closest approach
// to the column's footprint (x -1..1, z -5..-3) while walking at it, as sdf-game-flat-gate does.
await evaluate('__sdfGame.setPose(0, -1.2, 0, 0, 0)');
await evaluate('__sdfGame.walkTo(0, -6)');
let nearest = Infinity;
for (let i = 0; i < 12; i++) {
  await sleep(250);
  const [px, , pz] = (await evaluate('__sdfGame.pose()')).pos;
  nearest = Math.min(nearest, Math.hypot(Math.max(-1 - px, 0, px - 1), Math.max(-5 - pz, 0, pz + 3)));
}
await evaluate('__sdfGame.walkCancel()');
if (nearest < 0.28) fail(`column: came ${nearest.toFixed(2)} m from it (the radius is 0.32)`);
if (nearest > 0.45) fail(`column: never reached it (closest ${nearest.toFixed(2)} m)`);
pass(`fixture: stopped ${nearest.toFixed(2)} m from the column`);
// After the walks: right after boot the start overlay still covers the frame.
if (process.env.SHOTS === '1') {
  await shot('fixture.png', 0, -1.5, 0);                                // the start pose, facing -z
  await shot('fixture-steps.png', 2.5, -2, 0);                         // beside the column, facing the step up to B and the ledge to C
  await shot('fixture-pit.png', 7, -1, Math.atan2(-7, 9));             // from the pit, facing back toward B (0, -10)
  pass(`shots: ${OUT}/fixture*.png`);
}

// 6a. DEBRIS ON THE FIXTURE (plan 3b Task 15 Step 1), same boot, after the walks. The independent floor is the
// fixture's own layout written out here (A x -4..4 z -8..0 floor 0 with the column hole x -1..1 z -5..-3; B z
// -12..-8 0.5; C z -16..-12 1.5; D x 4..8 z -8..0 -1): every check reads it AND __sdfGame.ground and fails if they
// disagree, so neither the game's ground nor a piece's own floorY is checked against itself. The sampler follows
// pieces on requestAnimationFrame (as section 5's rounds sampler) and judges every frame: a piece's lowest point
// never below the floor under it (it never entered a riser), never off the map (a wall or the column).
await evaluate(`(() => {
  const fx = (x, z) => {
    if (x > 4 && x < 8 && z > -8 && z < 0) return -1;
    if (!(x > -4 && x < 4)) return NaN;
    if (z > -8 && z < 0) return x > -1 && x < 1 && z > -5 && z < -3 ? NaN : 0;
    if (z > -12 && z < -8) return 0.5;
    if (z > -16 && z < -12) return 1.5;
    return NaN;
  };
  let st = null;
  const frame = () => {
    if (!st) return;
    const d = __sdfGame.debris();
    for (const c of d.chunks) {
      const t = st.chunks.get(c.id);
      if (!t) continue;
      const f = fx(c.pos[0], c.pos[2]), low = c.pos[1] - c.support;
      t.n++; t.last = { pos: c.pos, settled: c.settled, support: c.support, floorY: c.floorY };
      t.minZ = Math.min(t.minZ, c.pos[2]); t.maxZ = Math.max(t.maxZ, c.pos[2]);
      if (!Number.isFinite(f)) t.off.push(c.pos.map((v) => +v.toFixed(3)));
      else if (low < f - 0.02) t.sunk.push({ pos: c.pos.map((v) => +v.toFixed(3)), low: +low.toFixed(3), floor: f });
      if (c.pos[0] > -1 && c.pos[0] < 1 && c.pos[2] > -5 && c.pos[2] < -3) t.inColumn++;
    }
    for (const b of d.bundles) {
      const f = fx(b.pos[0], b.pos[2]), g = __sdfGame.ground(b.pos[0], b.pos[2]).floor;
      st.bundle.push({ pos: b.pos, vy: b.vel[1], f, g, t: performance.now() - st.t0 });
    }
    requestAnimationFrame(frame);
  };
  window.__dg = {
    fx,
    start(ids) { st = { t0: performance.now(), chunks: new Map(ids.map((id) => [id, { n: 0, last: null, minZ: Infinity, maxZ: -Infinity, off: [], sunk: [], inColumn: 0 }])), bundle: [] }; requestAnimationFrame(frame); },
    read() { return st ? { chunks: [...st.chunks.entries()].map(([id, t]) => ({ id, ...t, off: t.off.slice(0, 4), offN: t.off.length, sunk: t.sunk.slice(0, 4), sunkN: t.sunk.length })), bundle: st.bundle } : null; },
    stop() { const r = this.read(); st = null; return r; },
  };
  return true;
})()`);
const fx = (x, z) => evaluate(`__dg.fx(${x}, ${z})`);
/** Floor under (x, z) from the game's ground and from the fixture layout; fail if they disagree. */
const fixtureFloor = async (x, z, what) => {
  const g = (await evaluate(`__sdfGame.ground(${x}, ${z})`)).floor, f = await fx(x, z);
  if (!(Number.isFinite(g) && g === f)) fail(`debris ${what}: ground(${x.toFixed(3)}, ${z.toFixed(3)}).floor ${g} but the fixture layout says ${f}`);
  return g;
};
// 6a.3 BLOOD first, with nothing else in the level (a chunk bleeds as it rolls; those splats are judged below).
{
  const n = await evaluate('__sdfGame.bloodBurstAt(0, 1.8, -12.1)');
  if (!(n > 0)) fail(`debris blood: bloodBurstAt(0, 1.8, -12.1) made ${n} drops`);
  await sleep(4000);
  const d = await evaluate('__sdfGame.debris()');
  if (d.droplets !== 0) fail(`debris blood: ${d.droplets} drops still in the air 4 s after the burst`);
  if (!d.splats.length) fail('debris blood: no splats 4 s after the burst');
  const byFloor = {};
  let worst = 0;
  for (const s of d.splats) {
    const f = await fixtureFloor(s[0], s[2], 'blood splat');
    if (Math.abs(s[1] - f) > 0.01) fail(`debris blood: splat at ${s.map((v) => v.toFixed(3))} is ${(s[1] - f).toFixed(3)} m off its floor ${f}`);
    worst = Math.max(worst, Math.abs(s[1] - f));
    byFloor[f] = (byFloor[f] ?? 0) + 1;
  }
  if (!byFloor[1.5] || !byFloor[0.5]) fail(`debris blood: splats by floor ${JSON.stringify(byFloor)}, expected some on C (1.5) and on B (0.5)`);
  pass(`debris blood: ${n} drops over the C/B edge -> 0 in the air after 4 s, ${d.splats.length} splats on their floors (by floor ${JSON.stringify(byFloor)}, worst |y - floor| ${worst.toFixed(4)} m)`);
}
// 6a.5 SURFACE BLOOD ON SECTOR WALLS (the opt-in stains sweep ctx.world.levelGroup: the sector meshes).
{
  const on = await evaluate('__sdfGame.setSurfaceBlood(true)');
  if (!on?.enabled) fail(`debris surface blood: setSurfaceBlood(true) -> ${JSON.stringify(on)}`);
  const hit = await evaluate('__sdfGame.surfaceBloodBurst([0, 1, -1.5], [0, 1, 0.5], 24)');
  await sleep(300);
  const stains = (await evaluate('__sdfGame.surfaceBloodStains()')) ?? [];
  const wall = stains.filter((s) => s.receiver.startsWith('sector-wall'));
  if (!hit || !wall.length) fail(`debris surface blood: burst ${hit}, ${stains.length} stains, none on a sector-wall receiver (${JSON.stringify([...new Set(stains.map((s) => s.receiver))])})`);
  pass(`debris surface blood: ${wall.length}/${stains.length} stains on ${[...new Set(wall.map((s) => s.receiver))].join(', ')} (z ${Math.min(...wall.map((s) => s.pos[2])).toFixed(3)}..${Math.max(...wall.map((s) => s.pos[2])).toFixed(3)}, the north wall z 0)`);
  await evaluate('__sdfGame.setSurfaceBlood(false)');
}
// 6a.1–2 CHUNKS. spawnTestChunk draws with the first actor's view: one zombie in the pit (D), collapsed where it
// stands — it is also the corpse check (the posed body's lowest point against the pit floor).
{
  const spawned = await evaluate(`__sdfGame.spawnCrowd('zombie', 1, { region: { minX: 7.0, maxX: 7.6, minZ: -4.3, maxZ: -3.7 } })`);
  if (spawned?.ok !== 1) fail(`debris: could not spawn the pit zombie (${JSON.stringify(spawned)})`);
  await sleep(1500);
  const zid = (await evaluate('__sdfGame.actorList()'))[0]?.id;
  if (zid === undefined || !(await evaluate(`__sdfGame.collapseActor(${zid})`))) fail('debris: the pit zombie did not collapse');
  await evaluate('__sdfGame.setPose(0, -1.2, 0, 0, 0)');
  const specs = [
    ['ledge C->B', '0, 1.8, -12.6, 0.12, false, [0, 0, 2.5]'],
    ['A->pit D', '3.6, 0.3, -2, 0.12, false, [2.5, 0, 0]'],
    ['B riser', '1, 0.3, -6.5, 0.12, false, [0, 0, -6]'],
    ['north wall', '0, 1, -1, 0.12, false, [0, 2, 20]'],
    ['column', '0, 0.4, -1.8, 0.12, false, [0, 0, -6]'],
  ];
  const ids = [];
  for (const [, args] of specs) ids.push(await evaluate(`__sdfGame.spawnTestChunk(${args})`));
  if (new Set(ids).size !== specs.length || !ids.every(Number.isFinite)) fail(`debris chunks: spawnTestChunk ids ${JSON.stringify(ids)}`);
  await evaluate(`__dg.start(${JSON.stringify(ids)})`);
  await sleep(4000);
  const r = await evaluate('__dg.stop()');
  const T = Object.fromEntries(specs.map(([name], i) => [name, r.chunks.find((c) => c.id === ids[i])]));
  for (const [name, t] of Object.entries(T)) {
    if (!t || t.n < 30 || !t.last) fail(`debris chunk ${name}: followed ${t?.n ?? 0} frames (need >= 30)`);
    if (t.offN) fail(`debris chunk ${name}: ${t.offN} frames off the map (through a wall or into the column): ${JSON.stringify(t.off)}`);
    if (t.sunkN) fail(`debris chunk ${name}: ${t.sunkN} frames with its lowest point under the floor (inside a riser): ${JSON.stringify(t.sunk)}`);
    if (!t.last.settled) fail(`debris chunk ${name}: not settled after 4 s (last ${JSON.stringify(t.last)})`);
    const [x, y, z] = t.last.pos;
    const f = await fixtureFloor(x, z, `chunk ${name}`);
    t.floor = f; t.gap = y - t.last.support - f;
    if (!(t.gap >= -0.02 && t.gap <= 0.03)) fail(`debris chunk ${name}: settled at ${t.last.pos.map((v) => v.toFixed(3))}, pos.y - support - floor ${t.gap.toFixed(3)} (band -0.02..+0.03)`);
    if (t.last.floorY !== f) fail(`debris chunk ${name}: floorY ${t.last.floorY} but it rests over floor ${f}`);
  }
  const L = T['ledge C->B'], P = T['A->pit D'], W = T['B riser'], N = T['north wall'], C = T.column;
  if (!(L.last.pos[2] > -12 && L.floor === 0.5)) fail(`debris chunk ledge: rests at z ${L.last.pos[2].toFixed(3)} floor ${L.floor}, expected off C onto B (z > -12, floor 0.5)`);
  if (!(P.last.pos[0] > 4 && P.floor === -1)) fail(`debris chunk pit: rests at x ${P.last.pos[0].toFixed(3)} floor ${P.floor}, expected in D (floor -1)`);
  if (!(W.last.pos[2] > -8 && W.floor === 0 && W.minZ < -7.5)) fail(`debris chunk riser: rests at z ${W.last.pos[2].toFixed(3)} floor ${W.floor}, nearest the riser z ${W.minZ.toFixed(3)}; expected back on A (z > -8, floor 0) after reaching it (min z < -7.5)`);
  if (!(N.maxZ < 0 && N.maxZ > -0.95)) fail(`debris chunk north wall: max z ${N.maxZ.toFixed(3)}, expected it to fly at the wall from z -1 and stay south of it (-0.95 < max z < 0)`);
  if (C.inColumn || !(C.minZ < -2.6)) fail(`debris chunk column: ${C.inColumn} frames inside x -1..1 z -5..-3, nearest z ${C.minZ.toFixed(3)} (expected it to reach the face z -3 and stay out)`);
  for (const [name, t] of Object.entries(T)) pass(`debris chunk ${name}: settled at ${t.last.pos.map((v) => v.toFixed(2)).join(', ')} on floor ${t.floor} (pos.y - support - floor ${t.gap.toFixed(4)} m), z ${t.minZ.toFixed(2)}..${t.maxZ.toFixed(2)} over ${t.n} frames, never off the map or inside a riser`);
  // The pit corpse: the posed body's lowest point against the pit floor (calibration: a collapsed zombie on a room
  // level — the arena — and on the fixture's floors 0 and 0.5 reads about -0.15 m; see CORPSE_LOW_BAND).
  const cg = await evaluate(`__sdfGame.actorGround(${zid})`);
  const cf = await fixtureFloor(cg.feet[0], cg.feet[2], 'pit corpse');
  const clow = cg.bodyLowest - cf;
  if (!(cf === -1 && clow >= CORPSE_LOW_BAND[0] && clow <= CORPSE_LOW_BAND[1])) fail(`debris corpse: the pit zombie's lowest point ${clow.toFixed(3)} m off floor ${cf} (band ${CORPSE_LOW_BAND.join('..')})`);
  pass(`debris corpse: the pit zombie lies on floor ${cf} (posed body lowest - floor ${clow.toFixed(3)} m, band ${CORPSE_LOW_BAND.join('..')})`);
}
// 6a.4 BUNDLE off the C ledge (fuse 8 s, no impact detonation): it leaves C within 3 s, then every resting sample
// (vertical speed 0; it keeps sliding, kThing-style) is on the floor under it, and no sample is off the map or
// inside a riser.
{
  await evaluate('__dg.start([])');
  if (!(await evaluate('__sdfGame.throwTestBundle(0, 1.7, -13, 0, 0, 1.5, 8)'))) fail('debris bundle: throwTestBundle returned nothing');
  await sleep(7500);                                                     // stop before the fuse: the sampler reads the flight only
  const s = (await evaluate('__dg.stop()')).bundle;
  if (s.length < 60) fail(`debris bundle: ${s.length} samples in 7.5 s`);
  const leftAt = s.find((q) => q.pos[2] > -12);
  if (!leftAt || leftAt.t > 3000) fail(`debris bundle: never left C within 3 s (last z ${s[s.length - 1].pos[2].toFixed(3)})`);
  const after = s.filter((q) => q.t >= leftAt.t);
  const off = s.filter((q) => !Number.isFinite(q.f));
  if (off.length) fail(`debris bundle: ${off.length} samples off the map: ${JSON.stringify(off.slice(0, 3).map((q) => q.pos))}`);
  const mismatch = s.filter((q) => q.g !== q.f);
  if (mismatch.length) fail(`debris bundle: ground and the fixture layout disagree under it at ${JSON.stringify(mismatch.slice(0, 3).map((q) => [q.pos, q.g, q.f]))}`);
  const inside = s.filter((q) => q.pos[1] < q.f - 0.01);
  if (inside.length) fail(`debris bundle: ${inside.length} samples under the floor under it (inside a riser): ${JSON.stringify(inside.slice(0, 3).map((q) => [q.pos, q.f]))}`);
  const resting = after.filter((q) => q.vy === 0);
  if (resting.length < 30) fail(`debris bundle: only ${resting.length} resting samples after it left C`);
  const bad = resting.filter((q) => Math.abs(q.pos[1] - q.f) > 0.01);
  if (bad.length) fail(`debris bundle: ${bad.length} resting samples off the floor under them: ${JSON.stringify(bad.slice(0, 3).map((q) => [q.pos, q.f]))}`);
  const floors = [...new Set(resting.map((q) => q.f))].sort((a, b) => a - b);
  const end = s[s.length - 1];
  pass(`debris bundle: left C after ${(leftAt.t / 1000).toFixed(2)} s; ${resting.length} resting samples on floors ${floors.join(', ')} (worst |y - floor| ${Math.max(...resting.map((q) => Math.abs(q.pos[1] - q.f))).toFixed(4)} m), ${s.length} samples none off the map or inside a riser; at 7.5 s at ${end.pos.map((v) => v.toFixed(2))}`);
}
const debrisErrs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (debrisErrs.length) fail(`console errors (fixture debris): ${JSON.stringify(debrisErrs.slice(0, 4))}`);

// 3. E1M1
if (process.env.DOOM_GATE_ONLY_FIXTURE === '1') process.exit(0);
if (!existsSync('public/assets/levels/doom-e1m1.level.json')) {
  console.log('skip E1M1: run scripts/levels/doom_map.py <doomu.wad> E1M1 first');
  process.exit(0);
}
/** The page-side helper for the enemy checks: the level's own pure modules (sector-ray's sight test, the
 *  director's eye height 1.4 m over each floor and its 10 m / ±0.39π sight rule), a pose finder, and a sampler on
 *  requestAnimationFrame that counts shots (an actor's sinceFire resetting) and follows every enemy round by
 *  identity (__sdfGame.enemyRounds, the live list) testing each frame's step against the sector geometry. */
const installEnemyHelper = () => evaluate(`(async () => {
  const sj = await import('/src/lab/sdf-zombie/webgpu/sector-json.ts');
  const sgr = await import('/src/lab/sdf-zombie/webgpu/sector-ground.ts');
  const sr = await import('/src/lab/sdf-zombie/webgpu/sector-ray.ts');
  const map = sj.parseLevel(await (await fetch('/assets/levels/doom-e1m1.level.json')).json()).sectors;
  const ground = sgr.buildSectorGround(map);
  const EYE = 1.4;
  const eye = (p) => [p[0], p[1] + EYE, p[2]];
  const blocked = (a, b) => sr.sectorSegmentHit(map, ground, a, b) !== null;
  const sees = (from, to) => !blocked(eye(from), eye(to));
  const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  /** A player can stand at (x, z): floor finite and level within 0.3 m 0.35 m round, 2 m headroom. */
  const stand = (x, z) => {
    const g = __sdfGame.ground(x, z);
    if (!Number.isFinite(g.floor) || g.ceil - g.floor < 2) return null;
    for (const [dx, dz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) {
      const h = __sdfGame.ground(x + dx, z + dz);
      if (!Number.isFinite(h.floor) || Math.abs(h.floor - g.floor) > 0.3) return null;
    }
    return [x, g.floor, z];
  };
  const inFov = (a, p) => {
    const bearing = Math.atan2(p[0] - a.pos[0], p[2] - a.pos[2]);
    return Math.abs(Math.atan2(Math.sin(bearing - a.yaw), Math.cos(bearing - a.yaw))) < Math.PI * 0.39;
  };
  const yawTo = (from, to) => Math.atan2(to[0] - from[0], -(to[2] - from[2]));
  /** Ring candidates round an actor, r 2.5..5 m. */
  const ring = (a) => {
    const out = [];
    for (const r of [2.5, 3.25, 4, 4.75]) for (let k = 0; k < 32; k++) {
      const t = (k / 32) * Math.PI * 2, q = stand(a.pos[0] + Math.sin(t) * r, a.pos[2] + Math.cos(t) * r);
      if (q) out.push(q);
    }
    return out;
  };
  /** HIDDEN: a soldier within 2.5..5 m (fire range 6 m) that cannot see it, and nobody within 12 m can; OPEN:
   *  within 4 m of it, in that soldier's sight and field of view, nobody else within 10 m. */
  const sightPoses = () => {
    const actors = __sdfGame.actorList();
    let best = null;
    for (const s of actors) {
      if (s.kind !== 'soldier') continue;
      const cands = ring(s);
      const hidden = cands.filter((h) => actors.every((a) => flat(a.pos, h) > 12 || !sees(a.pos, h)) && actors.every((a) => a.id === s.id || flat(a.pos, h) > flat(s.pos, h)));
      const open = cands.filter((o) => sees(s.pos, o) && inFov(s, o) && actors.every((a) => a.id === s.id || flat(a.pos, o) > 10));
      for (const h of hidden) for (const o of open) {
        // Prefer the open pose 4 m or more off the soldier (its rounds spread: some miss and fly on to the walls).
        const d = flat(h, o), score = d - 3 * Math.min(flat(s.pos, o), 4.5);
        if (d <= 4 && (!best || score < best.score)) best = { score, d, soldier: s.id, soldierAt: s.pos, hidden: { x: h[0], y: h[1], z: h[2], yaw: yawTo(h, s.pos) }, open: { x: o[0], y: o[1], z: o[2], yaw: yawTo(o, s.pos) } };
      }
    }
    return best;
  };
  /** In-view poses for shots and the busy budget: one per spawn cluster (actors within 8 m of each other), 4..6.5 m
   *  from its first actor, in sight of it, facing it; the clusters' floors differ where they can. */
  const viewPoses = (n) => {
    const actors = __sdfGame.actorList(), used = new Set(), out = [];
    const order = [...actors].sort((a, b) => a.pos[1] - b.pos[1]);   // lowest floors and highest ledges first and last
    const pick = [order[0], order[order.length - 1], ...actors];
    for (const a of pick) {
      if (out.length >= n || used.has(a.id)) continue;
      let q = null;
      for (const r of [5, 4, 6, 6.5]) {
        for (let k = 0; k < 32 && !q; k++) {
          const t = a.yaw + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 16;   // in front of it first
          const c = stand(a.pos[0] + Math.sin(t) * r, a.pos[2] + Math.cos(t) * r);
          if (c && sees(a.pos, c)) q = c;
        }
        if (q) break;
      }
      if (!q) continue;
      const near = actors.filter((b) => flat(b.pos, a.pos) < 8);
      for (const b of near) used.add(b.id);
      out.push({ x: q[0], y: q[1], z: q[2], yaw: yawTo(q, [a.pos[0], 0, a.pos[2]]), actor: a.id, kind: a.kind, floor: a.pos[1], cluster: near.length });
    }
    return out;
  };
  /** Bodies drawn this frame (the render cull) against bodies the eye can see through sector space. */
  const cullReport = () => {
    const p = __sdfGame.pose().pos, e = [p[0], p[1] + 1.6, p[2]];
    const actors = __sdfGame.actorList();
    const onScreen = (a) => { const s = __sdfGame.screenPosOf(a.pos[0], a.pos[1] + 1.2, a.pos[2]); return Math.abs(s.x) <= 1.1 && Math.abs(s.y) <= 1.1 && s.z < 1; };
    const framed = actors.filter(onScreen);
    const seen = framed.filter((a) => !blocked(e, [a.pos[0], a.pos[1] + 1.2, a.pos[2]])).length;
    return { drawn: __sdfGame.bodiesOnScreen(), framed: framed.length, inSight: seen, total: actors.length };
  };
  // THE SAMPLER
  const ROUND_LIFE = (await import('/src/lab/sdf-zombie/webgpu/game-weapon.ts')).GRAPESHOT.lifeSec;   // expired() ages rounds out here
  let st = null;
  const frame = () => {
    if (!st) return;
    const now = performance.now();
    if (st.lastT !== null) st.maxDt = Math.max(st.maxDt, (now - st.lastT) / 1000);
    st.lastT = now;
    const pp = __sdfGame.pose().pos;
    const list = __sdfGame.actorList();
    for (const b of __sdfGame.brains()) {
      const prev = st.since.get(b.id);
      if (prev !== undefined && b.sinceFire + 1e-6 < prev) {
        const a = list.find((q) => q.id === b.id);
        st.shots.push({ id: b.id, kind: b.kind, at: a.pos.map((v) => +v.toFixed(2)), los: sees(a.pos, pp), ducked: st.dodging, dist: +flat(a.pos, pp).toFixed(2) });
      }
      st.since.set(b.id, b.sinceFire);
    }
    const live = new Set();
    for (const r of __sdfGame.enemyRounds()) {
      live.add(r);
      const t = st.rounds.get(r);
      if (!t) {
        st.seen++;
        // DODGE: a round is in the air at the open pose: duck to the hiding place, so it flies on past where the
        // player stood into whatever is behind (back in 0.7 s).
        if (st.dodge && !st.dodging) {
          const h = st.dodge.hide;
          __sdfGame.setPose(h.x, h.z, h.yaw, 0, h.y);
          st.dodging = true; st.dodges++;
          setTimeout(() => { if (!st) return; const o = st.dodge.back; __sdfGame.setPose(o.x, o.z, o.yaw, 0, o.y); st.dodging = false; }, 700);
        }
        // Its shooter: the nearest actor; the eye-to-first-sample leg must be open too.
        let sh = null;
        for (const a of list) if (!sh || flat(a.pos, r.pos) < flat(sh.pos, r.pos)) sh = a;
        const hit = sh ? sr.sectorSegmentHit(map, ground, eye(sh.pos), r.pos) : null;
        if (hit) st.passed.push({ leg: 'eye->first', shooter: sh.id, kind: hit.kind, hit: hit.point.map((v) => +v.toFixed(2)), pos: r.pos.map((v) => +v.toFixed(2)) });
        st.rounds.set(r, { last: [...r.pos], vel: [...r.vel], age: r.ageSec });
        continue;
      }
      const hit = sr.sectorSegmentHit(map, ground, t.last, r.pos);
      if (hit) st.passed.push({ leg: 'step', kind: hit.kind, hit: hit.point.map((v) => +v.toFixed(2)), pos: r.pos.map((v) => +v.toFixed(2)), age: +r.ageSec.toFixed(2) });
      t.last = [...r.pos]; t.vel = [...r.vel]; t.age = r.ageSec;
    }
    // Gone: stopped by the player (its last step ended within 0.9 m of the player's axis, inside its height); stopped
    // by the WORLD only when it went young (age < lifeSec − 2 × the slowest frame) AND sector geometry lies within two
    // frames' flight ahead of its last sample (last → last + vel·2·dt); anything else is 'expired' or 'other'.
    for (const [r, t] of st.tracked) if (!live.has(r)) {
      st.tracked.delete(r);
      const dt = Math.max(st.maxDt, 1 / 60);
      const ahead = [t.last[0] + t.vel[0] * 2 * dt, t.last[1] + t.vel[1] * 2 * dt, t.last[2] + t.vel[2] * 2 * dt];
      if (flat(t.last, pp) < 0.9 && t.last[1] > pp[1] - 0.3 && t.last[1] < pp[1] + 2.1) st.atPlayer++;
      else if (t.age < ROUND_LIFE - 2 * dt && sr.sectorSegmentHit(map, ground, t.last, ahead)) st.atWorld++;
      else if (t.age >= ROUND_LIFE - 2 * dt) st.expired++;
      else st.other++;
    }
    for (const r of live) st.tracked.set(r, st.rounds.get(r));
    st.frames++;
    requestAnimationFrame(frame);
  };
  const sampler = {
    start(opts = {}) { st = { dodge: opts.dodge ?? null, dodging: false, dodges: 0, lastT: null, maxDt: 0, other: 0, since: new Map(), shots: [], rounds: new WeakMap(), tracked: new Map(), seen: 0, atPlayer: 0, atWorld: 0, expired: 0, passed: [], frames: 0 }; requestAnimationFrame(frame); },
    read() { return st ? { shots: st.shots, seen: st.seen, atPlayer: st.atPlayer, atWorld: st.atWorld, expired: st.expired, inFlight: st.tracked.size, passed: st.passed.slice(0, 6), passedCount: st.passed.length, frames: st.frames, dodges: st.dodges, other: st.other, maxFrameMs: +(st.maxDt * 1000).toFixed(1) } : null; },
    stop() { const r = sampler.read(); st = null; return r; },
  };
  window.__eg = { sees, stand, sightPoses, viewPoses, cullReport, sampler, yawTo, ground };
  return true;
})()`);
const flatGap = (p, q) => Math.hypot(p.x - q[0], p.z - q[2]);
const navLog = () => consoleEvents.find((e) => e.text.includes('[sector-nav] built'))?.text ?? '(no [sector-nav] line)';
const loadAvg = () => loadavg()[0].toFixed(1);
/** Draw calls and median frame ms at the current pose (as the start budget above). */
async function budgetHere() {
  await sleep(800);
  await evaluate('__sdfGame.timeDraws(15)');
  await evaluate('__sdfGame.drawStats(true)');
  await evaluate('__sdfGame.timeDraws(1)');
  const calls = (await evaluate('__sdfGame.drawStats(true)')).drawCalls;
  const r = [];
  for (let i = 0; i < 3; i++) r.push(await evaluate('__sdfGame.timeDraws(21)'));
  const cull = await evaluate('__eg.cullReport()');
  return { calls, ms: [...r].sort((a, b) => a - b)[1], readings: r, cull, split: await frameSplit() };
}
/** The frame split with the rAF loop STOPPED (__sdfGame.frameSplit): tick CPU + draw CPU + the GPU fence wait.
 *  timeDraws above runs with the loop on, so each sample also waits out whatever loop frame lands inside its
 *  fence: with a ~17 ms loop frame (E1M1's 29 actors) its readings sit on the 30 Hz cap's 33 ms steps. */
async function frameSplit() {
  const s = await evaluate('__sdfGame.frameSplit(21)');
  return { ...s, fullMs: s.tickMs + s.drawMs + s.fenceMs, line: `split (loop stopped): tick ${s.tickMs.toFixed(1)} + draw ${s.drawMs.toFixed(1)} + GPU wait ${s.fenceMs.toFixed(1)} = ${(s.tickMs + s.drawMs + s.fenceMs).toFixed(1)} ms; draw + GPU alone ${s.drawOnlyMs.toFixed(1)} ms` };
}

// God mode: the level has enemies now, and the route walks past them.
await boot('doom-e1m1', '&god=1');
console.log(`nav: ${navLog()}`);
await installEnemyHelper();
const start = await evaluate('__sdfGame.ground(0, 0)');
if (start.floor !== 0) fail(`E1M1 start floor ${start.floor}, expected 0`);
// ROUTE: [x, z] waypoints along the main path (DOOM_ROUTE overrides). Each leg must end within 0.6 m of
// its target, standing on the floor the ground reports there. The default is derived numbers, not WAD data:
// a grid search over the generated level (step 0.75 m, headroom 1.9 m, 0.45 m clear of every blocking line,
// no nukage) for straight legs. Start room (floor -0.5..0) north, out its north-east door, the bent corridor
// (zone 7), across the window room (zone 2), the corridor east down a 0.25 m step, onto the zigzag
// walkway over the nukage (zone 9, floor -0.75).
const DEFAULT_ROUTE = [[0, 0], [0, -17], [5.75, -22.75], [8.5, -34], [30.25, -33.75], [32.75, -31.25], [49.75, -31.25], [57.75, -23.25]];
const ROUTE = process.env.DOOM_ROUTE ? JSON.parse(process.env.DOOM_ROUTE) : DEFAULT_ROUTE;
if (ROUTE.length < 4) fail('E1M1: ROUTE needs at least 4 waypoints (DOOM_ROUTE env, see the plan Task 7 Step 3)');
for (let i = 1; i < ROUTE.length; i++) {
  // Walk speed 3.4 m/s: allow the leg's length at ~2.4 m/s plus 2 s, so legs up to ~22 m fit.
  const len = Math.hypot(ROUTE[i][0] - ROUTE[i - 1][0], ROUTE[i][1] - ROUTE[i - 1][1]);
  const q = await walk(ROUTE[i - 1], ROUTE[i], Math.max(6000, 2000 + (len / 2.4) * 1000));
  const gap = Math.hypot(q[0] - ROUTE[i][0], q[2] - ROUTE[i][1]);
  const floor = (await evaluate(`__sdfGame.ground(${q[0]}, ${q[2]})`)).floor;
  if (gap > 0.6) fail(`E1M1 leg ${i}: stopped ${gap.toFixed(2)} m short of ${ROUTE[i]}`);
  if (Math.abs(q[1] - floor) > 0.02) fail(`E1M1 leg ${i}: feet ${q[1].toFixed(2)} but floor ${floor}`);
  pass(`E1M1 leg ${i}: reached ${ROUTE[i]} on floor ${floor}`);
}

await evaluate('__sdfGame.setPose(0, 0, 0, 0, 0)');
await sleep(800);
await evaluate('__sdfGame.timeDraws(15)');                              // warm: the pipelines for what this pose sees
// One frame's draws: reset the counters, draw one frame, read them (a bare drawStats(true) after boot read 0).
await evaluate('__sdfGame.drawStats(true)');
await evaluate('__sdfGame.timeDraws(1)');
const drawCalls = (await evaluate('__sdfGame.drawStats(true)')).drawCalls;
const readings = [];
for (let i = 0; i < 3; i++) readings.push(await evaluate('__sdfGame.timeDraws(21)'));
const frameMs = readings.sort((a, b) => a - b)[1];
const lights = await evaluate('JSON.stringify(__sdfGame.levelProbes?.lights ?? null)').catch(() => 'n/a');
const startCull = await evaluate('__eg.cullReport()');
const startSplit = await frameSplit();
const startLoad = loadAvg();
console.log(`budget: ${drawCalls} draw calls, ${frameMs.toFixed(2)} ms a frame at the start (readings ${readings.map((v) => v.toFixed(1)).join(', ')}; level lights per room ${lights}); `
  + `bodies drawn ${startCull.drawn} / in frame ${startCull.framed} / in sight ${startCull.inSight} / ${startCull.total}; load ${startLoad}`);
console.log(`budget at the start, ${startSplit.line}`);

// Shots before the budget verdict, so an over-budget run still leaves pictures to look at.
if (process.env.SHOTS === '1') {
  const at = ROUTE[0][0] === 0 && ROUTE[0][1] === 0 ? ROUTE : [[0, 0], ...ROUTE];   // e1m1-<i>-<k>: waypoint i, yaw k (-z, +x, +z, -x)
  for (const [i, [x, z]] of at.entries()) {
    for (const [k, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) await shot(`e1m1-${i}-${k}.png`, x, z, yaw);
  }
  pass(`shots: ${OUT}/e1m1-*.png`);
}
// With enemies (plan 3a Task 6): fail only over 50 ms at a load average under 8; otherwise report.
if (frameMs > 50 && Number(startLoad) < 8) fail(`frame ${frameMs.toFixed(2)} ms > 50 ms at load ${startLoad}`);
if (frameMs > 50) console.log(`WARN E1M1 budget: ${frameMs.toFixed(2)} ms > 50 ms, not judged at load ${startLoad} (>= 8)`);
else pass(`E1M1 budget: ${frameMs.toFixed(2)} ms with enemies (fails only over 50 ms at load < 8)`);

// 4. POOLS AND SECTOR LIGHT
const sleepSettle = 1200;
/** A screenshot as base64 PNG (no file). */
const grab = async () => (await send('Page.captureScreenshot', { format: 'png' })).result.data;
/** Decode a PNG in the page and average a centred crop (fraction of width and height): channel means 0..255. */
const measure = (b64, crop = 1) => evaluate(`(async () => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,${b64}')).blob());
  const cw = Math.max(1, Math.round(bmp.width * ${crop})), ch = Math.max(1, Math.round(bmp.height * ${crop}));
  const c = new OffscreenCanvas(cw, ch); const g = c.getContext('2d');
  g.drawImage(bmp, (bmp.width - cw) / 2, (bmp.height - ch) / 2, cw, ch, 0, 0, cw, ch);
  const d = g.getImageData(0, 0, cw, ch).data; let r = 0, gr = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return { r: r / n, g: gr / n, b: b / n, grey: (r + gr + b) / 3 / n, lum: (0.2126 * r + 0.7152 * gr + 0.0722 * b) / n };
})()`);
const save = (file, b64) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${file}`, Buffer.from(b64, 'base64')); };
/** Compose a labelled grid in the page: cells[row][col] base64 PNGs (or null), drawn at cellW wide. */
async function sheet(file, title, rowLabels, colLabels, cells, notes = cells.map((r) => r.map(() => ''))) {
  const cellW = 400, cellH = 300, left = 190, top = 64;
  await evaluate('window.__sheetCells = []');
  for (const [r, row] of cells.entries()) for (const [c, b64] of row.entries()) {
    if (b64) await evaluate(`window.__sheetCells.push([${r}, ${c}, '${b64}'])`);
  }
  const out = await evaluate(`(async () => {
    const rows = ${JSON.stringify(rowLabels)}, cols = ${JSON.stringify(colLabels)}, notes = ${JSON.stringify(notes)};
    const cv = document.createElement('canvas'); cv.width = ${left} + cols.length * ${cellW}; cv.height = ${top} + rows.length * ${cellH};
    const g = cv.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#fff'; g.font = 'bold 20px sans-serif'; g.fillText(${JSON.stringify(title)}, 10, 26);
    g.font = '16px sans-serif';
    cols.forEach((t, c) => g.fillText(t, ${left} + c * ${cellW} + 8, 54));
    rows.forEach((t, r) => t.split('\\n').forEach((line, k) => g.fillText(line, 8, ${top} + r * ${cellH} + 24 + k * 20)));
    for (const [r, c, b64] of window.__sheetCells) {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const x = ${left} + c * ${cellW}, y = ${top} + r * ${cellH};
      g.drawImage(bmp, x + 2, y + 2, ${cellW} - 4, ${cellH} - 4);
      if (notes[r][c]) { g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x + 2, y + ${cellH} - 30, ${cellW} - 4, 28); g.fillStyle = '#ff0'; g.fillText(notes[r][c], x + 8, y + ${cellH} - 10); g.fillStyle = '#fff'; }
    }
    window.__sheetCells = [];
    return cv.toDataURL('image/png').split(',')[1];
  })()`);
  save(file, out);
}

const raw = JSON.parse(readFileSync('public/assets/levels/doom-e1m1.level.json', 'utf8'));
// 5. E1M1 ENEMIES (plan 2026-10-24-sector-levels-3a Task 6): spawned per the converter, standing on their floors,
// walking sector space, rounds stopped by walls, budget and shots with enemies in view, the exit. (5.4, walls block
// sight, needs health: it runs on the ?god=0 boot below.)
await boot('doom-e1m1', '&god=1');
console.log(`nav: ${navLog()}`);
await installEnemyHelper();
// 5.1 SPAWNED: the live roster by character equals the converter's spawns by kind.
const want = {};
for (const s of raw.spawns ?? []) want[s.kind] = (want[s.kind] ?? 0) + 1;
const got = {};
for (const b of await evaluate('__sdfGame.brains()')) got[b.character] = (got[b.character] ?? 0) + 1;
const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort();
if (!Object.keys(want).length) fail('enemies: the level JSON has no spawns (regenerate E1M1 with doom_map.py)');
if (keys.some((k) => want[k] !== got[k])) fail(`enemies: spawned ${JSON.stringify(got)}, the level has ${JSON.stringify(want)}`);
pass(`enemies spawned: ${keys.map((k) => `${k} ${got[k]}`).join(', ')} (= the converter's ${raw.spawns.length})`);
// 5.2–5.3 ON THEIR FLOORS, then WALKING. The feet (actorList pos y, the motion's eased floorY) within 0.08 m of the floor
// under them and that floor finite catches an unwired floorAt or a body in the void; it cannot catch a body drawn off
// its feet (pos y eases toward the same floorAt). So the POSED body's lowest point (actorGround.bodyLowest, the
// capsules' lowest ends) minus the floor must sit in BODY_LOW_BAND too — calibrated from the first runs (-0.04..+0.17 m).
const BODY_LOW_BAND = [-0.15, 0.25];
const floorsCheck = async (what) => {
  // The floor a body stands on is the disc floor under it (floorUnder at SECTOR_BODY_RADIUS_M 0.34, the rule
  // game-actor.ts uses since plan 3b Task 6): a body whose disc overlaps a lip up to a step high stands on the lip, so
  // the centre's floorAt can read a step lower. Judge against the disc floor (the JSON-built ground's floorUnder).
  const list = await evaluate('__sdfGame.actorList().map((a) => ({ id: a.id, kind: a.kind, pos: a.pos, g: __sdfGame.ground(a.pos[0], a.pos[2]), under: __eg.ground.floorUnder(a.pos[0], a.pos[2], 0.34), low: __sdfGame.actorGround(a.id).bodyLowest }))');
  for (const a of list) a.f = a.under;
  const bad = list.filter((a) => !Number.isFinite(a.g.floor) || !Number.isFinite(a.f) || Math.abs(a.pos[1] - a.f) > 0.08);
  if (bad.length) fail(`enemies ${what}: ${bad.length} off their floor: ${JSON.stringify(bad.slice(0, 4).map((a) => ({ id: a.id, pos: a.pos.map((v) => +v.toFixed(2)), floorUnder: a.f, centreFloor: a.g.floor })))}`);
  const worst = Math.max(...list.map((a) => Math.abs(a.pos[1] - a.f)));
  const onLip = list.filter((a) => a.f !== a.g.floor).length;
  const low = list.map((a) => a.low - a.f).filter(Number.isFinite);
  if (!low.length) fail(`enemies ${what}: no finite posed-body lowest point (actorGround)`);
  const lowBad = list.filter((a) => Number.isFinite(a.low - a.f) && (a.low - a.f < BODY_LOW_BAND[0] || a.low - a.f > BODY_LOW_BAND[1]));
  if (lowBad.length) fail(`enemies ${what}: ${lowBad.length} posed bodies sunk or floating (lowest − floor outside ${BODY_LOW_BAND.join('..')} m): ${JSON.stringify(lowBad.slice(0, 4).map((a) => ({ id: a.id, kind: a.kind, gap: +(a.low - a.f).toFixed(3), floor: a.f })))}`);
  const floors = [...new Set(list.map((a) => a.f))].sort((a, b) => a - b);
  pass(`enemies ${what}: ${list.length} on their floors (disc floor; ${onLip} on a lip above the centre's floor; worst feet gap ${worst.toFixed(3)} m; floors ${floors.join(', ')}; posed body lowest − floor ${Math.min(...low).toFixed(2)}..${Math.max(...low).toFixed(2)} m over ${low.length}, band ${BODY_LOW_BAND.join('..')})`);
  return list;
};
await evaluate('__sdfGame.setPose(0, 0, 0, 0, 0)');
await sleep(3000);
const at3 = await floorsCheck('after 3 s');
await sleep(17000);
const at20 = await floorsCheck('after 20 s');
const moved = at20.map((a) => { const b = at3.find((q) => q.id === a.id); return { id: a.id, d: b ? Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) : 0 }; }).sort((a, b) => b.d - a.d);
if (!(moved[0].d > 2)) fail(`enemies walk: none moved > 2 m in 17 s (most ${moved[0].d.toFixed(2)} m, actor ${moved[0].id})`);
pass(`enemies walk: ${moved.filter((m) => m.d > 2).length} moved > 2 m in 17 s (most ${moved[0].d.toFixed(2)} m, actor ${moved[0].id})`);
// 5.4b ROUNDS STOP AT WALLS: stand in a soldier's sight (god mode) for 8 s and follow every enemy round frame by frame.
// The player ducks behind the wall as each volley leaves (the sampler's dodge), so the rounds miss and fly on
// into the walls behind the open pose: they must stop there, not step through.
const sp = await evaluate('__eg.sightPoses()');
if (!sp) fail("rounds: no pose in a soldier's sight with a hiding place near it");
console.log(`sight poses: ${JSON.stringify(sp)}`);
await evaluate(`__eg.sampler.start({ dodge: { hide: ${JSON.stringify(sp.hidden)}, back: ${JSON.stringify(sp.open)} } })`);
await evaluate(`__sdfGame.setPose(${sp.open.x}, ${sp.open.z}, ${sp.open.yaw}, 0, ${sp.open.y})`);
await sleep(8000);
const rounds = await evaluate('__eg.sampler.stop()');
console.log(`rounds: ${JSON.stringify({ ...rounds, shots: rounds.shots.length, shotsLos: rounds.shots.filter((s) => s.los).length, shooters: [...new Set(rounds.shots.map((s) => s.id))] })}`);
if (rounds.shots.length === 0 || rounds.seen === 0) fail(`rounds: no enemy fired in 8 s in soldier ${sp.soldier}'s sight (${rounds.shots.length} shots, ${rounds.seen} rounds)`);
if (rounds.passedCount > 0) fail(`rounds: ${rounds.passedCount} round steps went through sector geometry: ${JSON.stringify(rounds.passed)}`);
if (rounds.atWorld === 0) fail(`rounds: no round stopped at a wall, floor or ceiling (${rounds.atPlayer} at the player, ${rounds.expired} expired) — nothing tested`);
// A shot decided on the frame the player ducked can read blind (the director saw the open pose, the sampler the
// hiding place): shots fired while ducked are reported, not judged.
const blind = rounds.shots.filter((s) => !s.los && !s.ducked);
const duckedShots = rounds.shots.filter((s) => s.ducked);
if (blind.length) fail(`rounds: ${blind.length} shots from actors without sight of the player: ${JSON.stringify(blind.slice(0, 4))}`);
pass(`rounds: ${rounds.shots.length} shots (${rounds.dodges} dodged; ${duckedShots.length} fired while ducked, ${duckedShots.filter((s) => !s.los).length} of them blind, not judged), ${rounds.seen} rounds followed over ${rounds.frames} frames — ${rounds.atPlayer} stopped at the player, ${rounds.atWorld} at walls/floors/ceilings (geometry within two frames ahead), ${rounds.expired} expired in flight, ${rounds.other} other; slowest frame ${rounds.maxFrameMs} ms; 0 stepped through sector geometry`);
// 5.6 BUDGET WITH ENEMIES IN VIEW (report only): the first cluster pose, facing it.
const views = await evaluate('__eg.viewPoses(4)');
console.log(`view poses: ${JSON.stringify(views)}`);
if (views.length) {
  const v = views[0];
  await evaluate(`__sdfGame.setPose(${v.x}, ${v.z}, ${v.yaw}, -0.05, ${v.y})`);
  const b = await budgetHere();
  console.log(`budget near a cluster (actor ${v.actor}, ${v.cluster} near): ${b.calls} draw calls, ${b.ms.toFixed(2)} ms (readings ${b.readings.map((x) => x.toFixed(1)).join(', ')}); bodies drawn ${b.cull.drawn} / in frame ${b.cull.framed} / in sight ${b.cull.inSight} / ${b.cull.total}; load ${loadAvg()}; ${b.split.line}`);
  // Same pose facing away: what the bodies in frame cost (report only).
  await evaluate(`__sdfGame.setPose(${v.x}, ${v.z}, ${v.yaw + Math.PI}, -0.05, ${v.y})`);
  const back = await budgetHere();
  console.log(`budget same pose facing away: ${back.calls} draw calls, ${back.ms.toFixed(2)} ms (readings ${back.readings.map((x) => x.toFixed(1)).join(', ')}); bodies drawn ${back.cull.drawn} / in frame ${back.cull.framed} / in sight ${back.cull.inSight}; ${back.split.line}`);
}
// The pit corridor pose of the 3a notes' run 1 (40.9, 13.1), looking down the corridor (yaw 1.1): ten bodies
// stood in that frustum behind sector walls, all drawn before the render culls learned the walls (report only).
{
  const f = (await evaluate('__sdfGame.ground(40.9, 13.1)')).floor;
  await evaluate(`__sdfGame.setPose(40.9, 13.1, 1.1, -0.05, ${f})`);
  const c = await budgetHere();
  console.log(`budget pit corridor (40.9, 13.1) yaw 1.1: ${c.calls} draw calls, ${c.ms.toFixed(2)} ms (readings ${c.readings.map((x) => x.toFixed(1)).join(', ')}); bodies drawn ${c.cull.drawn} / in frame ${c.cull.framed} / in sight ${c.cull.inSight}; ${c.split.line}`);
}
// 5.7 SHOTS with enemies in view.
if (process.env.SHOTS === '1') {
  for (const [k, v] of views.entries()) {
    mkdirSync(OUT, { recursive: true });
    await evaluate(`__sdfGame.setPose(${v.x}, ${v.z}, ${v.yaw}, -0.18, ${v.y})`);   // pitched down a little: the feet in frame
    await sleep(1200);
    const cull = await evaluate('__eg.cullReport()');
    save(`e1m1-enemies-${k}.png`, await grab());
    console.log(`shot e1m1-enemies-${k}.png: actor ${v.actor} (${v.kind}) on floor ${v.floor}, cluster of ${v.cluster}; bodies drawn ${cull.drawn} / in frame ${cull.framed} / in sight ${cull.inSight}`);
  }
  pass(`shots: ${OUT}/e1m1-enemies-*.png`);
}
// 6b. DEBRIS ON E1M1 (plan 3b Task 15 Step 2), this boot, after 5.4b (a soldier fired: its casings are on the floor).
// The soldier collapses; a blast beside another actor on a floor |y| >= 0.25 gibs it (chunks, blood, entrails, its
// gun); 8 s later every piece that has stopped is judged against the floor under it at its own x/z, read twice — the
// game's ground (__sdfGame.ground) and a ground the page builds from the level JSON (__eg.ground, sector-ground.ts)
// — and a disagreement fails. Chunk bake is off for the 8 s (bake swaps a settled piece's mesh and drops it from
// the debris seam's live list; the physics is the same), so every chunk stays readable.
{
  const shooters = [...new Set(rounds.shots.map((s) => s.id))];
  const listNow = await evaluate('__sdfGame.actorList()');
  const soldier = listNow.find((a) => shooters.includes(a.id) && a.kind === 'soldier') ?? listNow.find((a) => shooters.includes(a.id));
  if (!soldier) fail(`debris: none of the 5.4b shooters ${JSON.stringify(shooters)} is still in the level`);
  if (!(await evaluate(`__sdfGame.collapseActor(${soldier.id})`))) fail(`debris: collapseActor(${soldier.id}) refused (already down or gone)`);
  // The blast target: an actor (not the soldier) on a floor |y| >= 0.25, with a point 0.6 m beside it on the same
  // floor; a soldier first, then the most isolated (the blast is meant to gib one body, not a cluster).
  const site = await evaluate(`(() => {
    const list = __sdfGame.actorList().filter((a) => a.id !== ${soldier.id});
    const out = [];
    for (const a of list) {
      const f = __sdfGame.ground(a.pos[0], a.pos[2]).floor;
      if (!Number.isFinite(f) || Math.abs(f) < 0.25) continue;
      let at = null;
      for (let k = 0; k < 8 && !at; k++) {
        const t = (k / 8) * Math.PI * 2, x = a.pos[0] + Math.sin(t) * 0.6, z = a.pos[2] + Math.cos(t) * 0.6;
        if (__sdfGame.ground(x, z).floor === f && __eg.ground.floorAt(x, z) === f) at = [x, z];
      }
      if (!at) continue;
      const near = Math.min(Infinity, ...list.filter((b) => b.id !== a.id).map((b) => Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2])));
      out.push({ id: a.id, kind: a.kind, pos: a.pos, floor: f, at, near });
    }
    // A soldier first (its gun and kit drop as the body comes apart), then the most isolated.
    return out.sort((p, q) => (q.kind === 'soldier') - (p.kind === 'soldier') || q.near - p.near)[0] ?? null;
  })()`);
  if (!site) fail('debris: no actor on a floor |y| >= 0.25 to blast beside');
  // Watch from a pose 2.5..4 m off the site, in sight of it, facing it (the SHOTS frame and the player's place).
  const watch = await evaluate(`(() => {
    const s = [${site.at[0]}, ${site.floor}, ${site.at[1]}];
    for (const r of [3, 2.5, 3.5, 4]) for (let k = 0; k < 16; k++) {
      const t = (k / 16) * Math.PI * 2, q = __eg.stand(s[0] + Math.sin(t) * r, s[2] + Math.cos(t) * r);
      if (q && __eg.sees(q, s)) return { x: q[0], y: q[1], z: q[2], yaw: __eg.yawTo(q, s), r, t };
    }
    return null;
  })()`);
  if (watch) await evaluate(`__sdfGame.setPose(${watch.x}, ${watch.z}, ${watch.yaw}, -0.5, ${watch.y})`);
  await evaluate('__sdfGame.setChunkBake(false)');
  const blast = await evaluate(`__sdfGame.detonate(${site.at[0]}, ${site.floor + 0.5}, ${site.at[1]})`);
  console.log(`debris site: actor ${site.id} (${site.kind}) at ${site.pos.map((v) => v.toFixed(2))} on floor ${site.floor} (nearest other actor ${site.near.toFixed(1)} m); detonate(${site.at[0].toFixed(2)}, ${(site.floor + 0.5).toFixed(2)}, ${site.at[1].toFixed(2)}) -> ${JSON.stringify(blast)}; collapsed soldier ${soldier.id}; watching from ${watch ? `${watch.x.toFixed(2)}, ${watch.z.toFixed(2)}` : 'nowhere (no pose in sight)'}`);
  await sleep(8000);
  // Judge in the page: every item with its x/z, its y, and the floor there from both grounds.
  const J = await evaluate(`(() => {
    const d = __sdfGame.debris();
    const fl = (x, z) => { const a = __sdfGame.ground(x, z).floor, b = __eg.ground.floorAt(x, z); return { f: a, agree: a === b || (Number.isNaN(a) && Number.isNaN(b)), b }; };
    const rows = [], moving = {};
    const add = (kind, x, z, y, lo, hi, extra = {}) => { const g = fl(x, z); rows.push({ kind, x, z, y, f: g.f, agree: g.agree, other: g.b, gap: y - g.f, lo, hi, ...extra }); };
    const still = (kind) => { moving[kind] = (moving[kind] ?? 0) + 1; };
    for (const c of d.chunks) c.settled ? add('chunk', c.pos[0], c.pos[2], c.pos[1] - c.support, -0.02, 0.03, { id: c.id, tag: c.tag }) : still('chunk');
    for (const c of d.meshGibs) c.settled ? add('meshGib', c.pos[0], c.pos[2], c.pos[1] - c.support, -0.02, 0.03, { id: c.id, tag: c.tag }) : still('meshGib');
    // Sprite pieces: the physics (pos.y - support) is judged; the DRAWN mesh's lowest vertex is the independent
    // twin, reported below (a carved piece whose support spheres do not match its mesh draws off the floor).
    const drawn = [];
    for (const p of d.sprites) {
      if (!p.settled) { still('sprite'); continue; }
      add('sprite', p.pos[0], p.pos[2], p.pos[1] - p.support, -0.02, 0.03, { id: p.id, piece: p.kind });
      if (p.render === 'mesh' && p.drawnLowY !== null) drawn.push({ id: p.id, piece: p.kind, limb: p.limb, gap: p.drawnLowY - rows[rows.length - 1].f, support: p.support });
    }
    for (const s of d.splats) add('splat', s[0], s[2], s[1], -0.01, 0.01);
    for (const e of d.equipment) {
      for (const c of e.casings) c.resting ? add('casing', c.pos[0], c.pos[2], c.pos[1] - 0.012, -0.01, 0.01, { actor: e.actor }) : still('casing');
      if (e.prop) e.prop.resting ? add('gun', e.prop.pos[0], e.prop.pos[2], e.prop.pos[1] - 0.03, -0.02, 0.02, { actor: e.actor }) : still('gun');
      for (const k of e.kit) k.resting ? add('kit', k.x, k.z, k.minY - 0.01, -0.02, 0.03, { actor: e.actor }) : still('kit');
    }
    for (const r of d.guts) {
      if (!r.settled) { still('rope'); continue; }
      // Every node >= its floor - 0.01; the lowest node (over the floor under it) <= 0.1.
      let lowest = Infinity;
      for (const n of r.nodes) { add('ropeNode', n[0], n[2], n[1], -0.01, Infinity, { actor: r.actor }); lowest = Math.min(lowest, rows[rows.length - 1].gap); }
      rows.push({ kind: 'ropeLowest', actor: r.actor, gap: lowest, lo: -Infinity, hi: 0.1, agree: true, f: NaN, y: NaN, x: NaN, z: NaN });
    }
    for (const p of d.pickups) add('pickup', p.pos[0], p.pos[2], p.pos[1] - 0.25, -0.001, 0.001, { id: p.id });
    return { rows, moving, drawn, droplets: d.droplets, bundles: d.bundles.length };
  })()`);
  await evaluate('__sdfGame.setChunkBake(true)');
  const rows = J.rows;
  const disagree = rows.filter((r) => !r.agree);
  if (disagree.length) fail(`debris: the game's ground and the JSON-built ground disagree under ${disagree.length} items: ${JSON.stringify(disagree.slice(0, 4))}`);
  const offMap = rows.filter((r) => r.kind !== 'ropeLowest' && !Number.isFinite(r.f));
  if (offMap.length) fail(`debris: ${offMap.length} items off the map: ${JSON.stringify(offMap.slice(0, 4).map((r) => ({ kind: r.kind, at: [r.x, r.y, r.z].map((v) => +v.toFixed(3)) })))}`);
  const out = rows.filter((r) => !(r.gap >= r.lo && r.gap <= r.hi));
  const kinds = {};
  for (const r of rows) {
    const k = (kinds[r.kind] ??= { n: 0, floors: new Set(), worst: 0 });
    k.n++; if (Number.isFinite(r.f)) k.floors.add(r.f);
    k.worst = Math.max(k.worst, r.kind === 'ropeNode' || r.kind === 'ropeLowest' ? Math.max(0, -r.gap) : Math.abs(r.gap));
  }
  const summary = Object.entries(kinds).map(([k, v]) => `${k} ${v.n} on ${[...v.floors].sort((a, b) => a - b).join('/') || '-'} (worst ${v.worst.toFixed(3)})`).join('; ');
  console.log(`debris E1M1 after 8 s: ${summary}; still moving (reported, not judged) ${JSON.stringify(J.moving)}; ${J.droplets} drops in the air, ${J.bundles} bundles`);
  if (out.length) fail(`debris: ${out.length} items out of band: ${JSON.stringify(out.slice(0, 6).map((r) => ({ kind: r.kind, at: [r.x, r.y, r.z].map((v) => +(+v).toFixed(3)), floor: r.f, gap: +r.gap.toFixed(4), band: [r.lo, r.hi], ...(r.actor !== undefined ? { actor: r.actor } : {}), ...(r.id !== undefined ? { id: r.id } : {}) })))}`);
  const need = { gib: (kinds.chunk?.n ?? 0) + (kinds.meshGib?.n ?? 0) + (kinds.sprite?.n ?? 0), splat: kinds.splat?.n ?? 0, casing: kinds.casing?.n ?? 0, gun: kinds.gun?.n ?? 0, pickup: kinds.pickup?.n ?? 0 };
  const missing = Object.entries(need).filter(([, n]) => n === 0).map(([k]) => k);
  if (missing.length) fail(`debris: nothing judged for ${missing.join(', ')} (${JSON.stringify(need)}) — the check would pass vacuously`);
  // The drawn twin (report, WARN): a settled carved piece's lowest drawn vertex against the floor under it.
  const DRAWN_BAND = [-0.03, 0.05];
  const drawnOut = J.drawn.filter((q) => !(q.gap >= DRAWN_BAND[0] && q.gap <= DRAWN_BAND[1]));
  if (J.drawn.length) console.log(`debris E1M1 drawn: ${J.drawn.length} settled carved pieces, lowest drawn vertex - floor ${Math.min(...J.drawn.map((q) => q.gap)).toFixed(3)}..${Math.max(...J.drawn.map((q) => q.gap)).toFixed(3)} m`);
  if (drawnOut.length) console.log(`WARN debris E1M1 drawn: ${drawnOut.length} carved pieces draw off the floor though their physics rests on it (band ${DRAWN_BAND.join('..')}; not judged — the same on room levels): ${JSON.stringify(drawnOut.map((q) => ({ ...q, gap: +q.gap.toFixed(3), support: +q.support.toFixed(3) })))}`);
  const nonZero = [...new Set(rows.filter((r) => r.kind !== 'pickup' && Number.isFinite(r.f) && r.f !== 0).map((r) => r.f))].sort((a, b) => a - b);
  if (!nonZero.length) fail('debris: every judged fight item rests on floor 0 — no raised or sunken floor tested');
  pass(`debris E1M1: ${rows.length - (kinds.ropeLowest?.n ?? 0)} items on the floor under them (${summary}); fight debris on non-zero floors ${nonZero.join(', ')}`);
  // The collapsed soldier: its posed body's lowest point against the disc floor under its feet (floorUnder, the
  // rule bodies stand by), from the JSON-built ground.
  const sg = await evaluate(`(() => { const g = __sdfGame.actorGround(${soldier.id}); return g ? { ...g, under: __eg.ground.floorUnder(g.feet[0], g.feet[2], 0.34), centre: __sdfGame.ground(g.feet[0], g.feet[2]).floor } : null; })()`);
  if (!sg) fail(`debris corpse: soldier ${soldier.id} left the level`);
  const slow = sg.bodyLowest - sg.under;
  if (!(Number.isFinite(slow) && slow >= CORPSE_LOW_BAND[0] && slow <= CORPSE_LOW_BAND[1])) fail(`debris corpse: soldier ${soldier.id} lowest point ${slow.toFixed(3)} m off floorUnder ${sg.under} (band ${CORPSE_LOW_BAND.join('..')})`);
  pass(`debris corpse: soldier ${soldier.id} lies at ${sg.feet.map((v) => v.toFixed(2))} (floorUnder ${sg.under}, centre floor ${sg.centre}; posed body lowest - floor ${slow.toFixed(3)} m, band ${CORPSE_LOW_BAND.join('..')})`);
  if (process.env.SHOTS === '1') {
    // Frame where the gibs came to rest (the blast throws them metres off the site): the median settled gib piece,
    // from two opposite sides 2.5..4.5 m off, standing where the player can, in sight of it.
    const gibs = rows.filter((r) => r.kind === 'chunk' || r.kind === 'meshGib' || r.kind === 'sprite');
    const med = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
    const c = [med(gibs.map((r) => r.x)), 0, med(gibs.map((r) => r.z))];
    c[1] = (await evaluate(`__sdfGame.ground(${c[0]}, ${c[2]})`)).floor;
    const views = await evaluate(`(() => {
      const s = ${JSON.stringify(c)}, out = [];
      for (const side of [0, Math.PI]) {
        let v = null;
        for (const r of [3, 2.5, 3.5, 4, 4.5]) for (let k = 0; k < 16 && !v; k++) {
          const t = side + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 8, q = __eg.stand(s[0] + Math.sin(t) * r, s[2] + Math.cos(t) * r);
          if (q && __eg.sees(q, s)) v = { x: q[0], y: q[1], z: q[2], yaw: __eg.yawTo(q, s), r };
        }
        if (v) out.push(v);
      }
      return out;
    })()`);
    if (!views.length) fail(`debris shots: no pose in sight of the gib pile at ${c.map((v) => v.toFixed(2))}`);
    for (const [k, v] of views.entries()) {
      mkdirSync(OUT, { recursive: true });
      await evaluate(`__sdfGame.setPose(${v.x}, ${v.z}, ${v.yaw}, -0.5, ${v.y})`);
      await sleep(1200);
      save(`e1m1-debris-${k}.png`, await grab());
      console.log(`shot e1m1-debris-${k}.png: from ${v.x.toFixed(2)}, ${v.y}, ${v.z.toFixed(2)} facing the gib pile's median ${c.map((q) => q.toFixed(2))} (${v.r} m off; ${gibs.length} pieces, blast site ${site.at.map((q) => q.toFixed(2))}), pitch -0.5`);
    }
    pass(`shots: ${OUT}/e1m1-debris-*.png`);
  }
}
// 5.5 THE EXIT: into the trigger box -> the level completes.
const exit = (raw.triggers ?? []).find((t) => t.event === raw.completeOn);
if (!exit) fail(`exit: no trigger fires ${raw.completeOn}`);
if (await evaluate('__sdfGame.levelComplete()')) fail('exit: complete before the exit');
const ex = (exit.min[0] + exit.max[0]) / 2, ez = (exit.min[2] + exit.max[2]) / 2;
await evaluate(`__sdfGame.setPose(${ex}, ${ez}, 0, 0, __sdfGame.ground(${ex}, ${ez}).floor)`);
let done = false;
for (let i = 0; i < 20 && !done; i++) { await sleep(150); done = await evaluate('__sdfGame.levelComplete()'); }
if (!done) fail(`exit: stood in trigger ${exit.id} at (${ex}, ${ez}) and the level did not complete`);
pass(`exit: trigger ${exit.id} (${exit.event}) completes the level`);
const enemyErrs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (enemyErrs.length) fail(`console errors (enemy boot): ${JSON.stringify(enemyErrs.slice(0, 4))}`);

await boot('doom-e1m1', '&god=0');
// The flashlight adds its own light on top of the sector term; switch it off where the seam exists.
const flashOff = async () => evaluate('__sdfGame.setFlashlight ? __sdfGame.setFlashlight(false) : null');
const hz = await evaluate('__sdfGame.hazardPoint()');
if (!hz) fail('E1M1: no hurt sector (hazardPoint null)');
const hurtPerSec = raw.sectors[hz.sector].hurtPerSec;
await evaluate(`__sdfGame.setPose(${hz.pos[0]}, ${hz.pos[2]}, 0, 0, ${hz.pos[1]})`);
// Timed on the SIM clock (__sdfGame.simTime, the dt the hurt floor steps by): under load the dt clamp runs the sim
// behind the wall clock, and 3.2 s of wall time landed one tick. 3.2 sim s on the floor must land >= 2 ticks (the first
// after 0.5 s, then one a second; a scratch run read 100 -> 90 in 3.20 sim s = 4.33 wall s).
const h0 = await evaluate('__sdfGame.health()');
const sim0 = await evaluate('__sdfGame.simTime()'), wall0 = Date.now();
let simNow = sim0;
while (simNow - sim0 < 3.2 && Date.now() - wall0 < 30000) { await sleep(100); simNow = await evaluate('__sdfGame.simTime()'); }
const h1 = await evaluate('__sdfGame.health()');
const hzSim = simNow - sim0, hzWall = (Date.now() - wall0) / 1000;
if (!(hzSim >= 3.2)) fail(`hazard: the sim clock advanced only ${hzSim.toFixed(2)} s in ${hzWall.toFixed(1)} s of wall time`);
if (!(h0 - h1 >= 2 * hurtPerSec)) fail(`hazard: health ${h0} -> ${h1} in ${hzSim.toFixed(2)} sim s (${hzWall.toFixed(2)} wall s) on sector ${hz.sector}, expected a drop of >= ${2 * hurtPerSec} (2 ticks)`);
if (!(h1 > 0)) fail(`hazard: the player died (${h1})`);
pass(`hazard: sector ${hz.sector} (${hz.glow}, ${hurtPerSec}/s) took health ${h0} -> ${h1} in ${hzSim.toFixed(2)} sim s (${hzWall.toFixed(2)} wall s)`);
// Off the pool (the start pose): health holds.
await evaluate('__sdfGame.setPose(0, 0, 0, 0, 0)');
await sleep(300);
const h2 = await evaluate('__sdfGame.health()');
await sleep(2000);
const h3 = await evaluate('__sdfGame.health()');
if (h3 < h2) fail(`hazard: still hurting off the pool (${h2} -> ${h3})`);
pass(`hazard: off the pool health holds (${h2} -> ${h3})`);
// boot() resets the console log: check the ?god=0 boot's errors first.
const hazardErrs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (hazardErrs.length) fail(`console errors (?god=0 boot): ${JSON.stringify(hazardErrs.slice(0, 4))}`);
// 5.4 WALLS BLOCK SIGHT (this ?god=0 boot: health counts): 6 s hidden from a soldier 2.5..5 m off behind a wall
// (nobody within 12 m can see the pose) — no shot, health holds; then step into its sight — fire within 6 s.
await installEnemyHelper();
const sight = await evaluate('__eg.sightPoses()');
if (!sight) fail('sight: no hidden pose near a soldier with an open pose beside it');
console.log(`sight poses: ${JSON.stringify(sight)}`);
await evaluate('__eg.sampler.start()');
await evaluate(`__sdfGame.setPose(${sight.hidden.x}, ${sight.hidden.z}, ${sight.hidden.yaw}, 0, ${sight.hidden.y})`);
await sleep(300);
const hHid0 = await evaluate('__sdfGame.health()');
await sleep(6000);
const hHid1 = await evaluate('__sdfGame.health()');
const hid = await evaluate('__eg.sampler.read()');
if (hid.shots.length || hid.seen) fail(`sight: ${hid.shots.length} shots, ${hid.seen} rounds while hidden behind a wall from soldier ${sight.soldier}: ${JSON.stringify(hid.shots.slice(0, 4))}`);
if (hHid1 < hHid0) fail(`sight: health ${hHid0} -> ${hHid1} while hidden`);
pass(`sight: hidden ${flatGap(sight.hidden, sight.soldierAt).toFixed(2)} m from soldier ${sight.soldier} behind a wall for 6 s — 0 shots, health ${hHid0} -> ${hHid1}`);
await evaluate(`__sdfGame.setPose(${sight.open.x}, ${sight.open.z}, ${sight.open.yaw}, 0, ${sight.open.y})`);
const tOpen = Date.now();
let firstFire = null, hOpen = hHid1;
while (Date.now() - tOpen < 6000 && firstFire === null) {
  await sleep(100);
  const r = await evaluate('__eg.sampler.read()');
  hOpen = await evaluate('__sdfGame.health()');
  if (r.shots.some((s) => s.id === sight.soldier)) firstFire = { ms: Date.now() - tOpen, shots: r.shots, health: hOpen };
}
const openRead = await evaluate('__eg.sampler.stop()');
if (!firstFire) fail(`sight: in soldier ${sight.soldier}'s sight ${flatGap(sight.open, sight.soldierAt).toFixed(2)} m off for 6 s and it never fired (health ${hOpen}; other shots ${JSON.stringify(openRead.shots.slice(0, 4))})`);
pass(`sight: stepped ${sight.d.toFixed(2)} m into soldier ${sight.soldier}'s sight — it fired after ${(firstFire.ms / 1000).toFixed(1)} s (all shooters ${[...new Set(firstFire.shots.map((s) => s.id))].join(', ') || 'n/a'}, health ${hHid1} -> ${firstFire.health}; ${openRead.passedCount} rounds through geometry)`);
if (openRead.passedCount) fail(`sight: rounds through sector geometry: ${JSON.stringify(openRead.passed)}`);
const sightErrs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (sightErrs.length) fail(`console errors (?god=0 boot, sight): ${JSON.stringify(sightErrs.slice(0, 4))}`);
// The look work: a fresh boot with god mode on, so no hurt flash tints the pool frames and nobody dies mid-sheet.
await boot('doom-e1m1', '&god=1');
// The glow, looking down at the pool.
await evaluate(`__sdfGame.setPose(${hz.pos[0]}, ${hz.pos[2]}, 0, -1.2, ${hz.pos[1]})`);
await sleep(sleepSettle);
const poolDown = await grab();
const gm = await measure(poolDown, 0.3);
console.log(`glow: centre-30% mean R ${gm.r.toFixed(1)} G ${gm.g.toFixed(1)} B ${gm.b.toFixed(1)}, G/R ${(gm.g / Math.max(gm.r, 1e-6)).toFixed(2)}`);
if (!(gm.g > 1.4 * gm.r && gm.g > 40)) fail(`glow: G ${gm.g.toFixed(1)} vs R ${gm.r.toFixed(1)} (need G > 1.4 R and G > 40)`);
pass('glow: the pool reads green');
await evaluate(`__sdfGame.setPose(${hz.pos[0]}, ${hz.pos[2]}, 0.6, -0.5, ${hz.pos[1]})`);
await sleep(sleepSettle);
const poolRim = await grab();

// Poses for the A/B: the game's own pure modules pick sectors; a march along __sdfGame.ground picks a yaw facing
// a wall 2.5..6 m off (a rise > 0.6 m or a ceiling under 1.9 m above the feet counts as a wall).
const poses = await evaluate(`(async () => {
  const sj = await import('/src/lab/sdf-zombie/webgpu/sector-json.ts');
  const sg = await import('/src/lab/sdf-zombie/webgpu/sector-geometry.ts');
  const map = sj.parseLevel(await (await fetch('/assets/levels/doom-e1m1.level.json')).json()).sectors;
  const wallYaw = (x, z, f0) => {
    let best = null;
    for (let k = 0; k < 16; k++) {
      const yaw = -Math.PI + (k * Math.PI) / 8, dx = Math.sin(yaw), dz = -Math.cos(yaw);
      let d = 0.25;
      for (; d < 14; d += 0.25) {
        const g = __sdfGame.ground(x + dx * d, z + dz * d);
        if (!Number.isFinite(g.floor) || g.floor - f0 > 0.6 || g.ceil - f0 < 1.9) break;
      }
      const score = d >= 2.5 && d <= 6 ? d : d >= 1.5 ? 50 + d : 1e9;
      if (best === null || score < best.score) best = { yaw, d, score };
    }
    return best;
  };
  const cands = [];
  map.sectors.forEach((s, i) => {
    if (s.glow !== null || s.special !== 'none' || s.ceil - s.floor < 2.2) return;
    const p = sg.sectorInteriorPoint(map, i); if (!p) return;
    const w = wallYaw(p[0], p[1], s.floor); if (!w || w.score > 1e8) return;
    cands.push({ i, zone: s.zone, light: s.light, sky: s.materials.ceil === 'sky', x: p[0], z: p[1], y: s.floor, yaw: w.yaw, wall: w.d, score: w.score });
  });
  const indoor = cands.filter((c) => !c.sky);
  const top = Math.max(...indoor.map((c) => c.light));
  const bright = indoor.filter((c) => c.light === top).sort((a, b) => a.score - b.score);
  const second = bright.find((c) => c.zone !== bright[0].zone) ?? bright[1];
  const low = Math.min(...cands.map((c) => c.light));
  const dark = cands.filter((c) => c.light === low).sort((a, b) => a.score - b.score)[0];
  return { bright: [bright[0] ?? null, second ?? null], dark: dark ?? null };
})()`);
console.log(`poses: ${JSON.stringify(poses)}`);
if (!poses.bright[0]) fail('A/B: no bright pose (no indoor non-special sector with 2.2 m headroom facing a wall 1.5..14 m off)');
if (!poses.dark) fail('A/B: no dark pose (no walkable non-special sector at the lowest light facing a wall)');
if ((process.env.SHOTS === '1' || process.env.TUNING === '1') && !poses.bright[1]) fail('sheets: no second bright pose');
const poseAt = async (q, pitch = -0.1) => evaluate(`__sdfGame.setPose(${q.x}, ${q.z}, ${q.yaw}, ${pitch}, ${q.y})`);
const flash = await flashOff();
console.log(`flashlight: setFlashlight(false) -> ${flash === null ? 'no seam on this level (on as authored)' : flash}`);
const DEFAULT_CURVE = await evaluate('__sdfGame.sectorLight()');
const shotWith = async (patch) => { await evaluate(`__sdfGame.sectorLight(${JSON.stringify(patch)})`); await flashOff(); await sleep(sleepSettle); return grab(); };
const restore = () => evaluate(`__sdfGame.sectorLight(${JSON.stringify({ on: DEFAULT_CURVE.on, max: DEFAULT_CURVE.max, gamma: DEFAULT_CURVE.gamma, glowGain: DEFAULT_CURVE.glowGain, bounceGain: DEFAULT_CURVE.bounceGain })})`);
/** On/off frames at a pose for a curve: luminance means and the ratio. */
async function ab(q, curve) {
  await poseAt(q);
  const on = await shotWith({ on: true, ...curve });
  const off = await shotWith({ on: false });
  await restore();
  const a = (await measure(on)).lum, b = (await measure(off)).lum;
  return { on, off, a, b, ratio: a / Math.max(b, 1e-6) };
}
const fmt = (r) => `on ${r.a.toFixed(2)} / off ${r.b.toFixed(2)} = ${r.ratio.toFixed(3)}`;
const TUNED = { max: 0.07, gamma: 2.2 };   // the pre-owner-pick default, for comparison
const bright = await ab(poses.bright[0], { max: DEFAULT_CURVE.max, gamma: DEFAULT_CURVE.gamma });
console.log(`sector light A/B, bright sector ${poses.bright[0].i} (light ${poses.bright[0].light}), default curve max ${DEFAULT_CURVE.max} γ${DEFAULT_CURVE.gamma}: ${fmt(bright)}`);
// The assertion is on the shipped default curve; the old default (max 0.07 γ2.2) is measured for comparison (report only).
const abPass = bright;
const abCurve = `default max ${DEFAULT_CURVE.max} γ${DEFAULT_CURVE.gamma}`;
const tunedBright = await ab(poses.bright[0], TUNED);
console.log(`sector light A/B, bright sector ${poses.bright[0].i}, max ${TUNED.max} γ${TUNED.gamma}: ${fmt(tunedBright)} (report only)`);
const dark = await ab(poses.dark, { max: DEFAULT_CURVE.max, gamma: DEFAULT_CURVE.gamma });
console.log(`sector light A/B, darkest sector ${poses.dark.i} (light ${poses.dark.light}), default curve: ${fmt(dark)} (report only)`);
// GLOW BOUNCE (hand-off item 2b): the wall near the hazard pool that sector-bounce.ts lights most, seen from
// 3.5 m in front of it at eye height, and a wide view of the pool room from across it facing the pool.
const bouncePoses = await evaluate(`(async () => {
  const sj = await import('/src/lab/sdf-zombie/webgpu/sector-json.ts');
  const sg = await import('/src/lab/sdf-zombie/webgpu/sector-geometry.ts');
  const sb = await import('/src/lab/sdf-zombie/webgpu/sector-bounce.ts');
  const map = sj.parseLevel(await (await fetch('/assets/levels/doom-e1m1.level.json')).json()).sectors;
  const pool = ${hz.sector};
  const sgr = (await import('/src/lab/sdf-zombie/webgpu/sector-ground.ts')).buildSectorGround(map);
  const src = sb.glowSources(map).find((s) => s.sector === pool);
  if (!src) return { wall: null, wide: null };
  const b = sb.createGlowBounce(map, [src]);              // this pool's bounce only
  const walkable = (x, z) => { const g = __sdfGame.ground(x, z); return Number.isFinite(g.floor) ? g : null; };
  const yawTo = (dx, dz) => Math.atan2(dx, -dz);
  let wall = null;
  for (const q of sg.wallQuads(map)) {
    if (q.sector === pool || map.sectors[q.sector].glow !== null || q.y1 - q.y0 < 2) continue;
    const dx = q.b[0] - q.a[0], dz = q.b[1] - q.a[1], len = Math.hypot(dx, dz);
    if (len < 2) continue;
    const nx = -dz / len, nz = dx / len, mx = (q.a[0] + q.b[0]) / 2, mz = (q.a[1] + q.b[1]) / 2;
    if (sb.nearestOnPool(src, mx, mz).d > 8) continue;
    const fl = map.sectors[q.sector].floor, sx = mx + nx * 3.5, sz = mz + nz * 3.5;
    const g = walkable(sx, sz);
    if (!g || g.floor > fl + 0.8 || g.floor < fl - 0.8 || g.ceil - g.floor < 2) continue;
    // The camera must see the wall: nothing (a column, a raised block, a low soffit) on the way to it.
    let clear = true;
    for (let d = 0.25; d < 3.4 && clear; d += 0.25) {
      const h = walkable(mx + nx * d, mz + nz * d);
      if (!h || h.floor > g.floor + 1.0 || h.ceil < g.floor + 1.8) clear = false;
    }
    if (!clear) continue;
    const c = b.at([mx, fl + 1.5, mz], [nx, 0, nz], [nx, nz]);
    if (!wall || c[1] > wall.g) wall = { x: sx, z: sz, y: g.floor, yaw: yawTo(-nx, -nz), g: c[1], sector: q.sector, len, mx, mz, nx, nz };
  }
  // Wide: back from that wall (the farthest walkable of 9..5 m, the pool included: the look boot is god mode),
  // facing it across the room.
  let wide = null;
  for (const r of [9, 8, 7, 6, 5]) {
    if (!wall) break;
    const x = wall.mx + wall.nx * r, z = wall.mz + wall.nz * r, g = walkable(x, z), si = sgr.sectorAt(x, z);
    if (!g || si < 0 || g.ceil - g.floor < 2) continue;
    wide = { x, z, y: g.floor, yaw: wall.yaw, r };
    break;
  }
  return { wall, wide };
})()`);
console.log(`bounce poses: ${JSON.stringify(bouncePoses)}`);
if (!bouncePoses.wall) fail('bounce: no wall near the pool to look at');
const gr = (m) => m.g / Math.max(m.r, 1e-6);
await poseAt(bouncePoses.wall, 0);
const wallShots = [];
for (const k of [0, 0.5, 1, 2]) wallShots.push(await shotWith({ bounceGain: DEFAULT_CURVE.bounceGain * k }));
await restore();
const [bounceOff, , bounceOn] = wallShots;
const wallMeans = [];
for (const b64 of wallShots) wallMeans.push(await measure(b64, 0.3));
console.log(`bounce: wall crop G/R at bounceGain × 0 / ½ / 1 / 2: ${wallMeans.map((m) => gr(m).toFixed(2)).join(' / ')}`);
const bmOn = wallMeans[2], bmOff = wallMeans[0];
console.log(`bounce: wall crop (centre 30%) at bounceGain ${DEFAULT_CURVE.bounceGain}: R ${bmOn.r.toFixed(1)} G ${bmOn.g.toFixed(1)} B ${bmOn.b.toFixed(1)} G/R ${gr(bmOn).toFixed(2)}; `
  + `bounceGain 0: R ${bmOff.r.toFixed(1)} G ${bmOff.g.toFixed(1)} B ${bmOff.b.toFixed(1)} G/R ${gr(bmOff).toFixed(2)}`);
const wideShots = [];
if (bouncePoses.wide) {
  await poseAt(bouncePoses.wide, -0.15);
  for (const k of [0, 0.5, 1, 2]) wideShots.push(await shotWith({ bounceGain: DEFAULT_CURVE.bounceGain * k }));
  await restore();
}
if (process.env.SHOTS === '1') {
  save('e1m1-bounce-wall-on.png', bounceOn); save('e1m1-bounce-wall-off.png', bounceOff);
  if (wideShots.length) { save('e1m1-pool-room-off.png', wideShots[0]); save('e1m1-pool-room-on.png', wideShots[2]); }
  save('e1m1-pool.png', poolRim); save('e1m1-pool-down.png', poolDown);
  save('e1m1-bright-on.png', abPass.on); save('e1m1-bright-off.png', abPass.off);
  const second = await ab(poses.bright[1], { max: DEFAULT_CURVE.max, gamma: DEFAULT_CURVE.gamma });
  const tunedDark = await ab(poses.dark, TUNED);
  const tunedSecond = await ab(poses.bright[1], TUNED);
  const lab = (q, what) => `${what}\nsector ${q.i}, light ${q.light}\nwall ${q.wall.toFixed(1)} m`;
  await sheet('sector-light-sheet.png', `Sector light on/off (on = ${abCurve}; pool at glowGain ${DEFAULT_CURVE.glowGain})`,
    [lab(poses.bright[0], 'bright A'), lab(poses.bright[1], 'bright B'), lab(poses.dark, 'darkest'), 'pool\n(pitch -0.5, -1.2)'],
    ['on', 'off', 'on, old max 0.07 γ2.2'],
    [[abPass.on, abPass.off, tunedBright.on], [second.on, second.off, tunedSecond.on], [dark.on, dark.off, tunedDark.on], [poolRim, poolDown, null]],
    [[abPass.a.toFixed(1), abPass.b.toFixed(1), tunedBright.a.toFixed(1)], [second.a.toFixed(1), second.b.toFixed(1), tunedSecond.a.toFixed(1)], [dark.a.toFixed(1), dark.b.toFixed(1), tunedDark.a.toFixed(1)], ['', `G/R ${(gm.g / Math.max(gm.r, 1e-6)).toFixed(2)}`, '']]);
  pass(`shots: ${OUT}/e1m1-pool.png, e1m1-bright-on/off.png, sector-light-sheet.png`);
}
if (process.env.TUNING === '1') {
  // The owner's sheet: rows = poses, columns = curves (light rows) or glowGain (pool row); mean grey per cell.
  const curves = [['off', { on: false }], ['max 0.07 γ2.2 (old)', { on: true, max: 0.07, gamma: 2.2 }], ['max 0.35 γ1.6 (default)', { on: true, max: 0.35, gamma: 1.6 }],
    ['max 0.6 γ1.2', { on: true, max: 0.6, gamma: 1.2 }], ['max 1.0 γ1.0', { on: true, max: 1, gamma: 1 }]];
  const gains = [1, 0.6, 0.35, 0.2];
  const rows = [poses.bright[0], poses.bright[1], poses.dark];
  const cells = [], notes = [], table = [];
  for (const q of rows) {
    await poseAt(q);
    const r = [], n = [];
    for (const [label, patch] of curves) {
      const b64 = await shotWith(patch); const m = await measure(b64);
      r.push(b64); n.push(`grey ${m.grey.toFixed(1)}`); table.push({ sector: q.i, light: q.light, curve: label, grey: +m.grey.toFixed(2) });
    }
    cells.push(r); notes.push(n);
  }
  await restore();
  await evaluate(`__sdfGame.setPose(${hz.pos[0]}, ${hz.pos[2]}, 0.6, -0.5, ${hz.pos[1]})`);
  const pr = [], pn = [];
  for (const k of gains) {
    const b64 = await shotWith({ glowGain: k }); const m = await measure(b64);
    pr.push(b64); pn.push(`grey ${m.grey.toFixed(1)} G/R ${(m.g / Math.max(m.r, 1e-6)).toFixed(2)}`);
    table.push({ sector: hz.sector, pool: true, glowGain: k, grey: +m.grey.toFixed(2), r: +m.r.toFixed(1), g: +m.g.toFixed(1), b: +m.b.toFixed(1) });
  }
  pr.push(null); pn.push('');
  cells.push(pr); notes.push(pn);
  await restore();
  // The bounce row: the pool room wide, bounceGain off / half / default / double.
  if (wideShots.length) {
    const bn = [];
    for (const [k, b64] of wideShots.entries()) {
      const m = await measure(b64);
      bn.push(`G/R ${gr(m).toFixed(2)} grey ${m.grey.toFixed(1)}`);
      table.push({ bounceGain: DEFAULT_CURVE.bounceGain * [0, 0.5, 1, 2][k], grey: +m.grey.toFixed(2), gr: +gr(m).toFixed(3) });
    }
    cells.push([...wideShots, null]); notes.push([...bn, '']);
  }
  const lab = (q, what) => `${what}\nsector ${q.i}\nDoom light ${q.light}\nwall ${q.wall.toFixed(1)} m`;
  await sheet('tuning-sheet.png', `E1M1 tuning sheet — light rows: columns = sector light curve; pool row: columns = glowGain 1.0 | 0.6 | 0.35 (default) | 0.2 (flashlight ${flash === null ? 'ON (no seam)' : 'off'})`,
    [lab(rows[0], 'bright A'), lab(rows[1], 'bright B'), lab(rows[2], 'darkest'), `pool\nsector ${hz.sector}\npitch -0.5\ncols: glowGain`,
      ...(wideShots.length ? [`bounce: pool room\nwide, cols: bounceGain\n0 | ½ | ${DEFAULT_CURVE.bounceGain} (default) | 2×`] : [])],
    curves.map(([l]) => l), cells, notes);
  console.log(`tuning: ${JSON.stringify(table)}`);
  pass(`tuning sheet: ${OUT}/tuning-sheet.png`);
}
if (!(bmOff.r > 1 && bmOn.g - bmOff.g > 2)) fail(`bounce: wall crop too dark to judge or no green added (off R ${bmOff.r.toFixed(1)}, G ${bmOff.g.toFixed(1)} -> ${bmOn.g.toFixed(1)}; need off R > 1 and G up > 2)`);
if (!(gr(bmOn) >= gr(bmOff) * 1.3)) fail(`bounce: wall G/R ${gr(bmOn).toFixed(2)} on vs ${gr(bmOff).toFixed(2)} off (need on >= off × 1.3)`);
pass(`bounce: wall G/R ${gr(bmOn).toFixed(2)} on vs ${gr(bmOff).toFixed(2)} off at bounceGain ${DEFAULT_CURVE.bounceGain}`);
if (!(abPass.ratio > 1.05)) fail(`sector light A/B: ${fmt(abPass)} at ${abCurve} (need > 1.05)`);
pass(`sector light A/B: ${fmt(abPass)} at ${abCurve}`);
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors: ${JSON.stringify(errs.slice(0, 4))}`);
process.exit(0);
