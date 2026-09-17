// scripts/sdf-game-tracer-light-check.mjs — DO GUNFIRE'S TRACERS ACTUALLY LIGHT
// THE ROOM, and at what gain can you see it?
//
// THE QUESTION (owner, 2026-09-10): "i cant tell if the tracers light up the
// room or not... maybe they need to be amped up a bit so i can see."
//
// WHY IT IS ANSWERABLE AT ALL. The tracer->probe path has three joints
// (tracerGatherLights -> the gather's packed light list -> the dynamic probe
// layer the march reads), and "I can't see it" does not say WHICH joint is
// quiet. So this measures all three:
//
//   gates.lights       does a volley in flight actually PUT lights in the
//                      gather's list? (no extra = the plumbing is dead, and no
//                      gain will ever fix it)
//   the probe layer    the raw 6400-float dynamic layer, diffed across gains:
//                      how many probes moved and by how much. Generation truth.
//   the presented PNG  the canvas, 8-bit, as the owner sees it, diffed across
//                      gains: how many PIXELS moved. Display truth, and the one
//                      that answers "can I see it".
//
// THE TRICK THAT MAKES IT A MEASUREMENT: ONE BOOT, ONE VOLLEY, FROZEN MID-FLIGHT.
// The first version of this rig fired a fresh volley in a fresh page per gain and
// compared the captures ACROSS BOOTS. That FAILED, and the failure is worth
// recording: two gain-0 boots matched BIT FOR BIT in the probe layer (0/6400
// floats) and still differed in 27.6% of the FRAME's pixels, max channel delta
// 17 — the cross-boot render-state difference the 2026-09-10 pass-off calls the
// two-state branch. Any cross-boot pixel diff is mostly that, and cannot price a
// subtle light.
//
// So the volley is fired ONCE, stepped to mid-flight, then LOCKED
// (`setRenderLock(true)`: tick() mutates nothing, so the pellets hang in the air
// exactly where they are, indefinitely). Every rung of the gain ladder is taken
// from that same frozen frame — same pellets, same camera, same state — with
// `step(2)` between rungs to force ONE gather dispatch at the new gain. What is
// left is the tracer light and nothing else. The ladder ENDS on gain 0 again:
// that pair is the noise floor, in-boot.
//
// Two more pins, both load-bearing:
//   ?dynblend=1&dynfall=1 (`setProbeBlend`/`setProbeFall`) make the dynamic layer
//     THIS frame's estimate instead of an EMA, so a layer diff is not polluted
//     by how many frames the run dispatched before the read.
//   ?vhs=off removes the VHS pass's temporal blend — the one thing `setDemoHold`
//     cannot pin, and a direct source of frame-to-frame noise.
//
// HONEST LIMITS.
//  1. `?vhs=off` + a frozen volley is NOT the shipped look. This prices the
//     LIGHTING contribution with the post chain's own noise removed. A tracer
//     invisible here is not automatically invisible in play; one visible here is
//     definitely visible in play.
//  2. The pixel diff is 8-BIT (the canvas is sRGB, so sub-LSB differences do not
//     exist). A light that moves the probes but not the top 8 bits of a pixel is
//     "not visible", which is the question being asked.
//  3. ONE moment of flight, on room 1's lane. A tracer crosses that lane in
//     ~250 ms and its light travels with it; this is not an average over a burst.
//
// Usage (needs servers; scripts/lab-servers.sh owns them, or use the .sh):
//   TRACER_GAINS=0,2,8,20,60 TRACER_SLOTS=8 TRACER_STEPS=4 \
//     LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-game-tracer-light-check.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? process.env.LAB_VITE_PORT ?? 5277);
const CDP = Number(process.argv[3] ?? process.env.LAB_CDP_PORT ?? 9277);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-tracer-light';
// The ladder brackets the SHIPPED gain (6, raised from 2 on 2026-09-10), the old
// shipped value (2) and two extremes, and it ENDS on 0 again for the noise floor.
const GAINS = (process.env.TRACER_GAINS ?? '0,2,6,8,20,0').split(',').map(Number);
// TRACER_SLOTS unset = LEAVE THE PAGE'S SHIPPED CAP ALONE, so the rig verifies
// the shipped configuration by default instead of a seam value of its own.
const SLOTS = process.env.TRACER_SLOTS ? Number(process.env.TRACER_SLOTS) : null;
// TRACER_LADDER=slots:gain,... — varies BOTH seams per rung. This is how the
// before/after pair is made comparable: the shipped configuration before
// 2026-09-10 was (2 slots, gain 2) and after it is (4, 6), and comparing those
// across two BOOTS would fold in the two-state branch (see the header). In one
// boot the only difference is the two numbers.
const LADDER = process.env.TRACER_LADDER
  ? process.env.TRACER_LADDER.split(',').map((tok) => {
    const [sl, g] = tok.split(':').map(Number);
    if (!Number.isFinite(sl) || !Number.isFinite(g)) fail(`bad TRACER_LADDER token "${tok}" (want slots:gain)`);
    return { slots: sl, gain: g };
  })
  : GAINS.map((gain) => ({ slots: SLOTS, gain }));
const STEPS = Number(process.env.TRACER_STEPS ?? 4);
// Frames to step between ladder rungs. Must be EVEN (same field parity as the
// reference rung) and large enough to refill every HELD row — see the rung loop.
const FLUSH = Number(process.env.TRACER_FLUSH ?? 8);
const BBL = Number(process.env.TRACER_BARRELS ?? 2);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 30 min'); process.exit(3); }, 30 * 60_000).unref();

// ROOM 1'S LANE, measured by scripts/sdf-game-tracer-look.mjs: the room is the
// 8 m square x,z in [-8.8, -0.8] and standing at its centre facing +z (yaw pi)
// is the longest UNOBSTRUCTED shot on the level (~250 ms of pellet flight,
// against ~50 ms from the corners where the furniture eats the volley).
const POSE = `__sdfGame.setPose(-4.8, -4.8, ${Math.PI}, 0.06)`;

mkdirSync(OUT, { recursive: true });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;

// The console at load: a pipeline failure prints its cause there and nowhere else.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__tracerConsole = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__tracerConsole.push(['error', a.map(String).join(' ')]); e(...a); };
    console.warn = (...a) => { window.__tracerConsole.push(['warn', a.map(String).join(' ')]); w(...a); };
  })()`,
});

await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off` });
await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); return 1; })()');
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); return 1; })()');
await evaluate('(() => { performance.now = () => 100000; return 1; })()');

for (let i = 0; i < 60; i++) { if (await evaluate('__sdfGame.gunReady')) break; await sleep(250); }
if (!(await evaluate('__sdfGame.gunReady'))) fail('gun GLB never reported ready');
let baked = false;
for (let i = 0; i < 240; i++) {
  if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) { baked = true; break; }
  await sleep(500);
}
if (!baked) fail('roomProbesReady never landed');

// Settle transients with the sim LIVE (~90 frames for head-bob and the weapon
// spring), from the lane pose, BEFORE the volley.
await evaluate(`(() => { ${POSE}; __sdfGame.step(90); return 1; })()`);
// History-free dynamic layer (see the header).
await evaluate('(() => { __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
if (SLOTS !== null) await evaluate(`(() => __sdfGame.setTracerLightSlots(${SLOTS}))()`);
const shippedSlots = await evaluate('__sdfGame.tracerLightSlots');
const lightsIdle = await evaluate('(() => __sdfGame.probeDynamic.gates?.lights ?? null)()');

// Trigger, waiting for a loaded off-cooldown gun (the look rig's own lesson: the
// gun holds two shells and a capture that just calls fire() gets silent no-ops).
let fired = false;
for (let i = 0; i < 60; i++) {
  if (await evaluate(`__sdfGame.fire(${BBL})`)) { fired = true; break; }
  await sleep(250);
}
if (!fired) fail(`the trigger never pulled (shells ${await evaluate('__sdfGame.shells')})`);
await evaluate(`(() => { __sdfGame.step(${STEPS}); return 1; })()`);
const inFlight = await evaluate('(() => __sdfGame.projectiles().length)()');
if (!inFlight) {
  fail('no projectile survived to the capture: the volley died early, so the ladder would measure the '
    + 'muzzle flash alone. Try a smaller TRACER_STEPS (or check the lane pose).');
}
// FREEZE THE VOLLEY MID-FLIGHT. After this tick() mutates nothing: the pellets
// hang where they are, and every rung below differs only by the tracer gain.
await evaluate('(() => { __sdfGame.freeze(true); __sdfGame.setRenderLock(true); return __sdfGame.renderLock; })()');
console.log(`staged: ${inFlight} projectiles in flight, frozen. idle lights ${lightsIdle}, tracer slots ${shippedSlots}`);

const READ = `(async () => {
  const dyn = await __sdfGame.probeDynReadback();
  const u = new Uint32Array(dyn.buffer, dyn.byteOffset, dyn.length);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < u.length; i++) {
    const b = u[i];
    h = Math.imul(h ^ (b & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((b >>> 8) & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((b >>> 16) & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((b >>> 24) & 0xff), 0x01000193) >>> 0;
  }
  let nonZero = 0, maxAbs = 0;
  for (let i = 0; i < dyn.length; i++) { const v = dyn[i]; if (v !== 0) nonZero++; const a = Math.abs(v); if (a > maxAbs) maxAbs = a; }
  const g = __sdfGame.probeDynamic?.gates ?? null;
  return {
    digest: h >>> 0, floats: Array.from(dyn), nonZero, maxAbs,
    lights: g ? g.lights : null, capsules: g ? g.capsules : null,
    projectiles: __sdfGame.projectiles().length,
    shot: __sdfGame.presentedShot(),
  };
})()`;

const rungs = [];
for (let i = 0; i < LADDER.length; i++) {
  const { slots, gain } = LADDER[i];
  // RESOLVE THE GPU BEFORE READING, or the reading belongs to the PREVIOUS rung.
  // Measured the hard way on this rig's first in-boot attempt: without the fence
  // the rung that set gain 0 reported eight lights' worth of layer (the rung
  // before it) and gain 8 came back with gain 0's digest byte for byte. The
  // frame hash does the same thing for the same reason (`demoScenario` calls
  // handle.resolveGpu() before every hashFrame).
  // FLUSH EVERY HELD ROW WITH THE NEW GAIN BEFORE CAPTURING. The interlaced
  // march composites FRESH rows with rows HELD from the previous frame, so a
  // capture taken one or two frames after a gain change is a MIX of the new
  // lighting and the last rung's: measured on this rig's second in-boot attempt,
  // the gain-0/gain-0 noise-floor pair differed in 448k pixels while the probe
  // layer was BIT-IDENTICAL — the difference was the previous rung (gain 60)
  // still sitting in the held rows. TRACER_FLUSH frames (8 = four field cycles at
  // the shipped field count, and four gathers at probeGatherRate 2) is the
  // smallest number that reliably clears it.
  if (slots !== null) await evaluate(`(() => __sdfGame.setTracerLightSlots(${slots}))()`);
  await evaluate(`(() => { __sdfGame.setTracerLight(${gain}); __sdfGame.step(${FLUSH}); return __sdfGame.tracerLight; })()`);
  await evaluate('__sdfGame.resolveGpu()');
  const r = await evaluate(READ);
  const name = `${String(i).padStart(2, '0')}-slots${slots ?? 'page'}-gain${String(gain).padStart(3, '0')}`;
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.shot, 'base64'));
  const zoom = await send('Page.captureScreenshot', {
    format: 'png', clip: { x: 1280 / 2 - 220, y: 800 / 2 - 150, width: 440, height: 300, scale: 2 },
  });
  writeFileSync(`${OUT}/${name}-zoom.png`, Buffer.from(zoom.result.data, 'base64'));
  console.log(`slots ${String(slots ?? 'page').padStart(4)} gain ${String(gain).padStart(3)}: lights ${r.lights} (idle ${lightsIdle})  `
    + `projectiles ${r.projectiles}  layer nonzero ${r.nonZero}/6400 maxAbs ${r.maxAbs.toExponential(3)} digest ${r.digest.toString(16)}`);
  rungs.push({ slots, gain, ...r, name });
}

// ---------------------------------------------------------------------------
// The diffs, all in-boot. Rung 0 is the reference; the LAST rung is gain 0 again.
// ---------------------------------------------------------------------------
const readPng = (name) => decodePng(readFileSync(`${OUT}/${name}.png`));

function pixelDiff(a, b) {
  if (a.w !== b.w || a.h !== b.h || a.ch !== b.ch) throw new Error('frame size changed between captures');
  let changed = 0, over2 = 0, maxDelta = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * a.ch;
      let d = 0;
      for (let c = 0; c < 3; c++) { const dd = Math.abs(a.data[i + c] - b.data[i + c]); if (dd > d) d = dd; }
      if (d > 0) {
        changed++;
        if (d > 2) {
          over2++;
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        }
        if (d > maxDelta) maxDelta = d;
      }
    }
  }
  return { changed, over2, maxDelta, box: bx1 >= 0 ? [bx0, by0, bx1, by1] : null, pixels: a.w * a.h };
}

/** A COARSE SPATIAL MAP of the change, because "how many pixels moved" does
 *  not say WHERE the light landed and the interesting distinction is a uniform
 *  sub-visible lift (the whole frame nudged 1-2 levels) against a localised
 *  brightening (the floor and lower walls down the lane). Ten columns by six
 *  rows; each cell is the MEAN absolute channel delta, marked `*` when some pixel
 *  in it moved by 10 levels or more. */
function mapCells(a, b, cols = 10, rows = 6) {
  const cw = Math.floor(a.w / cols), chh = Math.floor(a.h / rows);
  const out = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      let sum = 0, max = 0, n = 0;
      for (let y = r * chh; y < (r + 1) * chh; y++) {
        for (let x = c * cw; x < (c + 1) * cw; x++) {
          const i = (y * a.w + x) * a.ch;
          let d = 0;
          for (let k = 0; k < 3; k++) { const dd = Math.abs(a.data[i + k] - b.data[i + k]); if (dd > d) d = dd; }
          sum += d; n++; if (d > max) max = d;
        }
      }
      const mean = sum / n;
      line += (mean < 0.5 ? '.' : mean < 2 ? ':' : mean < 5 ? '+' : mean < 12 ? '#' : '@') + (max >= 10 ? '*' : ' ');
    }
    out.push(line);
  }
  return out;
}

const ref = rungs[0];
console.log(`\nreference: rung 0, gain ${ref.gain}`);
console.log('\n=== PROBE LAYER: each rung against rung 0 ===');
for (const r of rungs) {
  let moved = 0, maxAbs = 0;
  for (let i = 0; i < r.floats.length; i++) {
    const d = Math.abs(r.floats[i] - ref.floats[i]);
    if (d !== 0) moved++;
    if (d > maxAbs) maxAbs = d;
  }
  const perUnit = r.gain ? ` (${(maxAbs / r.gain).toFixed(4)} per gain unit)` : '';
  console.log(`slots ${String(r.slots ?? 'page').padStart(4)} gain ${String(r.gain).padStart(3)}: probes moved ${String(moved).padStart(4)}/6400  `
    + `maxAbs delta ${maxAbs.toExponential(3)}${perUnit}  digest ${r.digest.toString(16)}`);
}

console.log('\n=== PRESENTED FRAME: each rung against rung 0 (same frozen volley) ===');
for (const r of rungs) {
  const d = pixelDiff(readPng(ref.name), readPng(r.name));
  console.log(`slots ${String(r.slots ?? 'page').padStart(4)} gain ${String(r.gain).padStart(3)}: pixels changed ${String(d.changed).padStart(6)}/${d.pixels} `
    + `(${(100 * d.changed / d.pixels).toFixed(2)}%)  by >2 levels ${String(d.over2).padStart(6)}  `
    + `max channel delta ${String(d.maxDelta).padStart(3)}  box ${d.box ? d.box.join(',') : '-'}`);
}

console.log('\n=== WHERE THE LIGHT LANDS (mean |delta| per cell; . <0.5  : <2  + <5  # <12  @ >=12; * = a pixel moved >=10) ===');
console.log('    columns = x, rows = y, top-left is the frame origin');
for (const r of rungs) {
  console.log(`  slots ${r.slots ?? 'page'} gain ${r.gain} (rung ${r.name}):`);
  for (const line of mapCells(readPng(ref.name), readPng(r.name))) console.log(`    ${line}`);
}

const last = rungs[rungs.length - 1];
if (last.gain === ref.gain) {
  const d = pixelDiff(readPng(ref.name), readPng(last.name));
  let dl = 0;
  for (let i = 0; i < last.floats.length; i++) if (last.floats[i] !== ref.floats[i]) dl++;
  console.log(`\nNOISE FLOOR (rung 0 vs the repeated gain-${ref.gain} rung, same boot, same frozen volley): `
    + `${d.changed} pixels changed, ${d.over2} by >2 levels, max delta ${d.maxDelta}; layer floats moved ${dl}/6400.`);
  console.log('Anything at or below that is not signal; anything well above it is the tracer light.');
}

const logged = await evaluate('(() => window.__tracerConsole ?? [])()').catch(() => []);
const bad = (logged ?? []).filter(([k, t]) => k === 'error' || /TSL|WGSL|Tint|pipeline/i.test(String(t)));
console.log(`\nconsole errors: ${bad.length}`);
for (const [k, t] of bad.slice(0, 10)) console.log(`  [${k}] ${String(t).slice(0, 200)}`);
console.log(`\nPNGs (full frame + zoom) in ${OUT}`);
process.exit(0);
