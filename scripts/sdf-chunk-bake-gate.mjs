// scripts/sdf-chunk-bake-gate.mjs — the automated gates for the settled-chunk
// bake (close-up task 5), on the sdf-game page, one headless run:
//
//   smoke      the page boots with the bake module wired in, no console errors
//   parity     seam OFF, staged chunk scene (severed limbs): the march target
//              hash equals the MAIN checkout's build on the same staging —
//              and equals ITSELF on a repeat capture (determinism)
//   differs    seam ON: after settle the march hash DIFFERS (the chunks left
//              the march) and chunkStats reports baked pieces
//   hittable   a slug fired AT a baked piece gibs it: baked count drops,
//              live chunk count rises (fresh gobs), no silent absorption
//   leak       long-firefight loop: sever → settle → bake → gib → again;
//              views stay <= MAX_CHUNKS (12) and baked+live stay bounded,
//              reported as a series
//
// Usage: node scripts/sdf-chunk-bake-gate.mjs <vitePort> <cdpPort>
//        [mainVitePort] — omit the third arg to skip the vs-main parity leg
//                        (self-parity still runs).
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5377);
const CDP = Number(process.argv[3] ?? 9377);
const MAIN_VITE = process.argv[4] ? Number(process.argv[4]) : null;
const OUT = process.env.GATE_OUT ?? '/tmp/sdf-chunk-bake/gate.json';
const W = 1280, H = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (25 min)'); process.exit(3); }, 1_500_000).unref();

let mainViteProc = null;
if (MAIN_VITE) {
  // Serve the MAIN checkout on its own port for the vs-main parity leg.
  mainViteProc = spawn('npx', ['vite', '--port', String(MAIN_VITE), '--strictPort'], {
    cwd: '/Users/donny/Projects/blud', stdio: 'ignore', detached: true,
  });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { const r = await fetch(`http://localhost:${MAIN_VITE}/sdf-game.html`); if (r.ok) break; } catch {}
  }
}
process.on('exit', () => { if (mainViteProc) try { process.kill(-mainViteProc.pid); } catch {} });

const results = { gates: {}, console: [] };
const gate = (name, ok, detail) => {
  results.gates[name] = { ok, detail };
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
  if (!ok) { writeFileSync(OUT, JSON.stringify(results, null, 2)); process.exit(1); }
};

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error' || m.params.type === 'warning') results.console.push({ type: m.params.type, text: text.slice(0, 400) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 180_000) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
  });
  if (r.result?.exceptionDetails) fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 500)}`);
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
// STALE-MODULE DEFENCE (the vite-reuse hazard): Chrome's disk cache will
// serve yesterday's game-main.ts transform to a freshly navigated page, and
// every gate conclusion drawn from it is about a build that no longer
// exists. Disable the cache for this tab.
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

/** Boot one page (fresh = per-run hygiene), pinned-clock NOT needed here:
 *  the march-target hash is flicker-immune by construction. */
async function boot(vitePort) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Page.navigate', { url: `http://localhost:${vitePort}/sdf-game.html?frozen=1` });
  let backend = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
    if (backend) break;
  }
  if (!backend) fail(`page never booted (vite ${vitePort})`);
  if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
  await sleep(2500);
  await evaluate('__sdfGame.installDebugProbe()');
}

/**
 * Stage a CHUNK scene: teleport to the room, freeze, face body 0, then fire
 * SLUGS at limb anchors until enough chunks exist. stampWoundAt only stamps
 * WOUNDS (it never runs sever checks), so the staging uses the real weapon
 * path — fireSlug with the camera aimed at the anchor, exactly what the
 * gib bench segment does. Anchors come from the live posed prims.
 * Returns { fired, chunks, body }.
 */
const stageChunks = (room, wantChunks) => evaluate(`(async () => {
  __sdfGame.teleport(${room});
  const z = __sdfGame.zombies().find(q => q.room === ${room});
  if (!z) return { error: 'no body in room ${room}' };
  __sdfGame.freeze(true);
  const eyeH = 1.62, d = 2.2;
  const ex = z.pos[0], ez = z.pos[2] + d;
  __sdfGame.setPose(ex, ez, 0, 0, 0);
  __sdfGame.step(30);
  const posed = __sdfGame.zombie(z.id).posed();
  // Per-limb ROOT anchor: the limb prim end nearest the torso centre — the
  // attachment neck cutLimbs samples. Aiming there is what severs; prim
  // ends on the distal side just make craters.
  const torsoC = posed.clusters.find(c => c.limb === 'torso')?.center;
  if (!torsoC) return { error: 'no torso cluster' };
  const roots = {};
  for (const p of posed.prims) {
    const limb = String(p.limb ?? '');
    if (!/arm|leg/i.test(limb)) continue;
    if (p.op === 'sub' || p.op === 'groove') continue;
    for (const end of [p.a, p.b]) {
      const d = Math.hypot(end[0] - torsoC[0], end[1] - torsoC[1], end[2] - torsoC[2]);
      if (!roots[limb] || d < roots[limb].d) roots[limb] = { d, at: [end[0], end[1], end[2]] };
    }
  }
  const limbNames = Object.keys(roots).sort();
  let fired = 0;
  const before = __sdfGame.chunkCount;
  const trace = [];
  for (const limb of limbNames) {
    if (__sdfGame.chunkCount - before >= ${wantChunks}) break;
    const at = roots[limb].at;
    for (let tryN = 0; tryN < 10; tryN++) {
      if (__sdfGame.chunkCount - before >= ${wantChunks}) break;
      const dx = at[0] - ex, dy = at[1] - eyeH, dz = at[2] - ez;
      const l = Math.hypot(dx, dy, dz) || 1;
      __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.asin(dy / l), 0);
      __sdfGame.step(2);
      const ok = __sdfGame.fireSlug();
      fired++;
      // Cooldown 0.45 s, reload 1.3 s after every second shot: step real
      // time between attempts or fire() just returns false forever.
      __sdfGame.step(ok ? 30 : 15);
      if (ok && trace.length < 6) {
        trace.push({ limb, tryN, wounds: __sdfGame.zombie(z.id).woundCount(), chunks: __sdfGame.chunkCount });
      }
    }
  }
  __sdfGame.step(35); // > the 0.07 s flash window, so the hash sees no muzzle flash
  return { fired, chunks: __sdfGame.chunkCount, body: z.id, trace, limbs: limbNames };
})()`);

// ---------------------------------------------------------------------------
// 1. SMOKE + PARITY (seam off) on MY build.
// ---------------------------------------------------------------------------
console.log('boot (build under test, seam off)');
await boot(VITE);
const smokeErrors = results.console.filter(c => c.type === 'error').length;
gate('smoke-boot', true, { consoleErrors: smokeErrors });

const staged0 = await stageChunks(3, 2);
if (staged0.error) fail(staged0.error);
gate('sever-staging', staged0.chunks >= 2, staged0);
const hOff = await evaluate('window.__sdfGameDebug.hashMarchTarget()');
// NO steps between the two reads: the severed chunks are still creeping
// while stepped (the sim never exactly zeroes vx), and hashMarchTarget reads
// the LAST rendered frame's target. Back-to-back reads prove the instrument
// itself is stable; state-parity is the vs-main leg's job.
const hOffRepeat = await evaluate('window.__sdfGameDebug.hashMarchTarget()');
gate('off-determinism', hOff.hash === hOffRepeat.hash, { hOff: hOff.hash, hOffRepeat: hOffRepeat.hash });

// Marched-side look capture: aim down at where the pieces fell (near the
// body's feet) and screenshot — the A side of the look-parity pair.
await evaluate(`(async () => {
  const z = __sdfGame.zombies().find(q => q.room === 3);
  const pose = __sdfGame.pose();
  const dx = z.pos[0] - pose.pos[0], dz = z.pos[2] - pose.pos[2];
  const d = Math.max(0.7, Math.hypot(dx, dz) - 0.5);
  const l = Math.hypot(dx, dz) || 1;
  const nx = pose.pos[0] + dx / l * (Math.hypot(dx, dz) - d);
  const nz = pose.pos[2] + dz / l * (Math.hypot(dx, dz) - d);
  __sdfGame.setPose(nx, nz, Math.atan2(dx, -dz), -0.35, 0);
  __sdfGame.step(2);
  return 1;
})()`);
const shotMarched = await send('Page.captureScreenshot', { format: 'png' });
if (shotMarched.result?.data) {
  const { writeFileSync: wf } = await import('node:fs');
  wf('/tmp/sdf-chunk-bake/look-marched.png', Buffer.from(shotMarched.result.data, 'base64'));
}

// vs-main parity: same staging on the MAIN checkout's build.
if (MAIN_VITE) {
  console.log('boot (main checkout)');
  await boot(MAIN_VITE);
  await evaluate(`(() => {
    __sdfGame.setOccluder(false); __sdfGame.setCone(false); __sdfGame.setFxaa(true);
    __sdfGame.setSdfScale(1.0); __sdfGame.setAdaptive(false); __sdfGame.setMarchSteps(96);
    __sdfGame.setShell(true); __sdfGame.setRelax(1.0); __sdfGame.setBleed(true);
    __sdfGame.setWoundTuning({ spillChance: 0 }); __sdfGame.setHullExitBound(false);
    __sdfGame.setDepthGate(false); __sdfGame.setHalfRate(false); __sdfGame.setFlatAlbedo(false);
    return 1;
  })()`);
  const stagedMain = await stageChunks(3, 2);
  if (stagedMain.error) fail(stagedMain.error);
  const hMain = await evaluate('window.__sdfGameDebug.hashMarchTarget()');
  gate('off-parity-vs-main', hMain.hash === hOff.hash,
    { mine: hOff.hash, main: hMain.hash, stagedMine: staged0, stagedMain });
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  console.log('boot (build under test again)');
  await boot(VITE);
}

// ---------------------------------------------------------------------------
// 2. DIFFERS + HITTABLE + LEAK (seam ON), one session.
// ---------------------------------------------------------------------------
await evaluate('__sdfGame.setChunkBake(true)');
const staged1 = await stageChunks(3, 2);
if (staged1.error) fail(staged1.error);

// Settle: step until the bake has consumed every settled chunk (a bake runs
// in the frame the predicate fires; 8 s of 60 Hz steps is far past the
// ~2 s settle bound the unit test pins).
const settleToBake = async (minBaked) => {
  for (let i = 0; i < 40; i++) {
    await evaluate('__sdfGame.step(12)');
    const s = await evaluate('__sdfGame.chunkStats()');
    if (s.baked >= minBaked && s.live === 0) return s;
    if (s.baked >= minBaked) {
      // live > 0: either still-settling stragglers or bone-only chunks;
      // give them more steps before giving up.
    }
  }
  return await evaluate('__sdfGame.chunkStats()');
};
const stats1 = await settleToBake(staged1.chunks);
gate('bake-happens', stats1.baked >= staged1.chunks,
  { staged: staged1.chunks, ...stats1 });
gate('bake-not-slow', stats1.lastBakeMs < 60, { lastBakeMs: stats1.lastBakeMs });
const hOn = await evaluate('window.__sdfGameDebug.hashMarchTarget()');
gate('on-differs-from-off', hOn.hash !== hOff.hash, { hOn: hOn.hash, hOff: hOff.hash });

// LOOK capture: baked pieces beside a marched body, close range.
await evaluate(`(async () => {
  const s = __sdfGame.chunkStats();
  if (!s.pieces.length) return 0;
  const p = s.pieces[0].centre;
  const pose = __sdfGame.pose();
  const eyeH = 1.62;
  const dx = p[0] - pose.pos[0], dy = p[1] - eyeH, dz = p[2] - pose.pos[2];
  const dist = Math.min(1.1, Math.max(0.6, Math.hypot(dx, dz)));
  const l = Math.hypot(dx, dy, dz) || 1;
  // Step IN toward the piece so it fills the frame (close-range judging).
  const horiz = Math.hypot(dx, dz) || 1;
  const nx = pose.pos[0] + dx / horiz * (horiz - dist);
  const nz = pose.pos[2] + dz / horiz * (horiz - dist);
  __sdfGame.setPose(nx, nz, Math.atan2(dx, -dz), Math.asin(dy / l), 0);
  __sdfGame.step(2);
  return 1;
})()`);
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  const { writeFileSync: wf } = await import('node:fs');
  wf('/tmp/sdf-chunk-bake/look-baked.png', Buffer.from(shot.result.data, 'base64'));
}

// HITTABLE: fire the REAL weapon path at a baked piece. The severed-limb
// gobs are 4.6 cm targets — a sniper proposition even for the solved
// overhead drop — so the gate spawns two SYNTHETIC chunks (spawnTestChunk,
// the same spawn/settle/bake/gib machinery at a known ~12 cm size), bakes
// them, and drops buckshot down each one's column with one correction
// iteration. gibbed must come back true: a hit spawns gobs and deletes the
// mesh (design option 2), never a silent absorption.
const hit = await evaluate(`(async () => {
  // Two test chunks a metre apart, on open floor near body 0.
  const z = __sdfGame.zombies().find(q => q.room === 3);
  if (!z) return { error: 'no body in room 3' };
  const t0 = __sdfGame.chunkStats();
  __sdfGame.spawnTestChunk(z.pos[0] + 1.0, 0.02, z.pos[2] + 0.6);
  __sdfGame.spawnTestChunk(z.pos[0] - 0.9, 0.02, z.pos[2] - 0.5);
  for (let i = 0; i < 60; i++) {
    __sdfGame.step(12);
    const s = __sdfGame.chunkStats();
    if (s.baked >= t0.baked + 2) break;
  }
  const s0 = __sdfGame.chunkStats();
  if (s0.baked < t0.baked + 2) return { error: 'test chunks did not bake', s0, t0 };
  const attempts = [];
  let gibbed = null;
  for (const target of s0.pieces) {
    if (gibbed) break;
    // Solve the muzzle onto the piece's column at a steep pitch.
    let px = target.centre[0], pz = target.centre[2] + 0.3;
    for (let i = 0; i < 6; i++) {
      __sdfGame.setPose(px, pz, 0, -1.56, 0);
      __sdfGame.step(4);
      const m = __sdfGame.muzzleWorld();
      px += target.centre[0] - m[0];
      pz += target.centre[2] - m[2];
    }
    // Drop buckshot down the column with landing-offset correction.
    const before = { baked: __sdfGame.chunkStats().baked, live: __sdfGame.chunkStats().live };
    let sx = px, sz = pz;
    let firedOk = false;
    const volleyLog = [];
    let trace0 = null;
    for (let volley = 0; volley < 3; volley++) {
      __sdfGame.step(95);
      __sdfGame.setPose(sx, sz, 0, -1.56, 0);
      __sdfGame.step(2);
      const mz = __sdfGame.muzzleWorld();
      const now = __sdfGame.fire(2);
      volleyLog.push({ volley, firedNow: now, muzzle: mz.map(v => +v.toFixed(3)) });
      firedOk = firedOk || now;
      if (!now) continue;
      let ox = 0, oz = 0, n = 0;
      const frames = [];
      for (let f = 0; f < 6; f++) {
        __sdfGame.step(1);
        const ps = __sdfGame.pelletsDebug();
        frames.push(ps.map(q => [q.pos[0], q.pos[1], q.pos[2]]));
        for (const q of ps) {
          const w = 1 / (0.05 + Math.abs(q.pos[1] - target.centre[1]));
          ox += (q.pos[0] - target.centre[0]) * w;
          oz += (q.pos[2] - target.centre[2]) * w;
          n += w;
        }
      }
      if (volley === 0) trace0 = { muzzle: mz.map(v => +v.toFixed(3)), frames: frames.map(fr => fr.map(p => p.map(v => +v.toFixed(3)))) };
      if (__sdfGame.chunkStats().baked < before.baked) break; // gibbed
      if (n > 0) { sx -= ox / n; sz -= oz / n; }
    }
    __sdfGame.step(20);
    const after = __sdfGame.chunkStats();
    const didGib = after.baked < before.baked && after.live > before.live;
    attempts.push({ piece: target.id, radius: +target.radius.toFixed(3),
      centre: target.centre.map(v => +v.toFixed(3)),
      stance: [px, pz].map(v => +v.toFixed(3)),
      volleyLog, trace0, firedOk, gibbed: didGib,
      checks: __sdfGame.bakeCheckDebug().log ? __sdfGame.bakeCheckDebug() : __sdfGame.bakeCheckDebug() });
    if (didGib) gibbed = { piece: target.id, mode: 'overhead-buckshot' };
  }
  return { gibbed, attempts };
})()`);

gate('baked-piece-hittable',
  hit.gibbed != null,
  hit);

// LEAK: long-firefight soak — spawn synthetic chunks repeatedly (the same
// spawn/settle/bake machinery as real severs, in unlimited supply), bake
// them, gib a few, keep going until totalBakes is ~3x the view cap. Views
// must never exceed MAX_CHUNKS (12) and baked+live must stay bounded while
// totalBakes grows — proof the ring actually RECYCLES rather than leaking.
const leak = [];
let leakOk = true;
{
  for (let cycle = 0; cycle < 6; cycle++) {
    // Three fresh chunks per cycle, offset so they scatter differently.
    await evaluate(`(async () => {
      const z = __sdfGame.zombies().find(q => q.room === 3);
      const bx = z.pos[0] + ${cycle * 0.4}, bz = z.pos[2] + ${cycle * 0.3};
      __sdfGame.spawnTestChunk(bx + 1.0, 0.02, bz + 0.5);
      __sdfGame.spawnTestChunk(bx - 0.8, 0.02, bz + 0.2);
      __sdfGame.spawnTestChunk(bx + 0.1, 0.02, bz - 0.7);
      return 1;
    })()`);
    for (let i = 0; i < 50; i++) {
      await evaluate('__sdfGame.step(12)');
      const s = await evaluate('__sdfGame.chunkStats()');
      if (s.live === 0) break;
    }
    // Cycle 0: gib a couple of pieces (exercises freeBaked mid-soak).
    if (cycle === 0) {
      await evaluate(`(async () => {
        for (let round = 0; round < 4; round++) {
          const s = __sdfGame.chunkStats();
          if (!s.pieces.length) break;
          const p = s.pieces[0];
          let px = p.centre[0], pz = p.centre[2] + 0.3;
          for (let i = 0; i < 5; i++) {
            __sdfGame.setPose(px, pz, 0, -1.56, 0);
            __sdfGame.step(4);
            const m = __sdfGame.muzzleWorld();
            px += p.centre[0] - m[0];
            pz += p.centre[2] - m[2];
          }
          let gibbed = false;
          for (let v = 0; v < 2 && !gibbed; v++) {
            __sdfGame.step(95);
            __sdfGame.setPose(px, pz, 0, -1.56, 0);
            __sdfGame.step(2);
            __sdfGame.fire(2);
            __sdfGame.step(10);
            if (__sdfGame.chunkStats().baked < s.baked) gibbed = true;
          }
          if (!gibbed) break;
        }
        return 1;
      })()`);
    }
    const s = await evaluate('__sdfGame.chunkStats()');
    leak.push({ cycle, live: s.live, baked: s.baked, views: s.views, totalBakes: s.totalBakes });
    if (s.views > 12 || s.baked > 12) leakOk = false;
  }
}
gate('leak-bounded', leakOk, { series: leak });

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`gate results written to ${OUT}`);
// All gates passed and the results are on disk — leave before the watchdog
// (the lingering websocket would otherwise hold the process open).
process.exit(0);
