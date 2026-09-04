// scripts/sdf-game-crowd-gate.mjs — headless gate for zombie crowd separation
// and the chase/attack brain on sdf-game.html. No-deps CDP, same pattern as
// scripts/sdf-game-shorty-gate.mjs (which owns the plumbing this copies).
//
//   1. THE CROWD: four room-4 bodies converge for two simulated seconds and
//      the worst pairwise centre distance stays above half the touch distance.
//   2. THE CHASE: every zombie in the player's room notices him (alert).
//   3. THE SWING: the nearest body reaches melee range and swings.
//   4. NEGATIVE CONTROL: with the player out of every room, all go calm.
//   5. THE MELEE RING: at most `tokens` bodies engaged, holders >= 90 deg
//      apart, and no arm interpenetration between the bodies fighting over
//      the player (the owner's 2026-09-04 screenshot, as a number).
//
// Usage: LAB_VITE_PORT=5281 LAB_CDP_PORT=9281 node scripts/sdf-game-crowd-gate.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5281);
const CDP = Number(process.argv[3] ?? 9281);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-game-crowd';
const W = Number(process.env.GAME_W ?? 800);
const H = Number(process.env.GAME_H ?? 600);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

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
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      type: m.params.type,
      text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

/** A crashed/tab-busy target never answers a CDP request — every await needs
 *  a bound, or the driver hangs forever with zero diagnostics. */
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}

mkdirSync(OUT, { recursive: true });
let shotCount = 0;
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  shotCount++;
  console.log(`  shot ${name}.png (${buf.length} bytes)`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html`;
console.log(`game ${url}`);
await send('Page.navigate', { url });

let api = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (api) break;
}
if (!api) {
  console.error('console tail:', consoleEvents.slice(-8));
  fail('game page never booted (__sdfGame absent)');
}

// 1. BOOT GATE — webgpu backend, no console errors, the gun actually loaded.
const backend = await evaluate('__sdfGame.backend');
if (backend !== 'webgpu') fail(`backend ${backend}, expected webgpu`);
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) fail(`console errors at boot: ${JSON.stringify(errs.slice(0, 3))}`);

// --- 1. THE CROWD. Room 4 holds four bodies in an 8x8 m interior: the worst
//     clumping case in the level, and the reason this gate exists.
await evaluate('typeof __sdfGame.woundPanel === "function" ? (__sdfGame.woundPanel(false), 1) : 0');
await evaluate('typeof __sdfGame.gooPanel === "function" ? (__sdfGame.gooPanel(false), 1) : 0');
await evaluate('__sdfGame.setLoopRunning(false)');

// Stand in room 4's doorway looking in. Step once so the pose is staged.
await evaluate('__sdfGame.setPose(-4.8, 2.0, 0, 0)');
await evaluate('__sdfGame.step(1, 1 / 60)');
await shot('room4-enter');

// setPose's 5th argument is an eye HEIGHT, so a raised, pitched-down camera
// is the top-down the spec asks for -- one frame that shows the whole pack's
// footprint at once, which an FPV shot from the doorway cannot.
const TOPDOWN = "__sdfGame.setPose(-4.8, 4.8, 0, -1.35, 7)";
const FPV = "__sdfGame.setPose(-4.8, 2.0, 0, 0, 0)";
await evaluate(TOPDOWN);
await evaluate('__sdfGame.step(1, 1 / 60)');
await shot('room4-topdown-before');
await evaluate(FPV);

// Two seconds of simulated time: long enough for four bodies to notice and
// converge, short enough that they have not all reached melee range. The
// worst pairwise centre distance is tracked across THIS window and the melee
// pile-up below -- the convergence alone is too early to contain a stack
// (measured: bodies are still ~1.3 m apart at the 2 s mark, nudge on or off,
// so a gate that only sampled here could never fail).
const TOUCH = 0.70;   // two 0.35 m bodies touching
let worst = Infinity;
for (let i = 0; i < 8; i++) {
  await evaluate('__sdfGame.step(15, 1 / 60)');
  const d = await evaluate('__sdfGame.crowdMinDist()');
  if (typeof d === 'number' && d < worst) worst = d;
}
await shot('room4-converged');
await evaluate(TOPDOWN);
await evaluate('__sdfGame.step(1, 1 / 60)');
await shot('room4-topdown-after');
await evaluate(FPV);

// --- 2. THE CHASE. Every zombie in the player's room must have noticed him
//     and be closing, not wandering.
const brains = await evaluate('__sdfGame.brains()');
const room4 = brains.filter((b) => b.room === 4);
if (room4.length === 0) fail('no room-4 actors in brains() — is the room lookup wired?');
const asleep = room4.filter((b) => !b.alert);
if (asleep.length === room4.length) {
  fail(`no room-4 zombie noticed the player: ${JSON.stringify(room4)}`);
}
console.log(`chase: ${room4.length - asleep.length}/${room4.length} alert`);

// --- 3. THE SWING. Let the nearest one arrive and prove it actually swings,//     and keep sampling the crowd through the whole melee window: the pack
//     converging on one doorway point is where stacking actually happens.
let swung = false;
for (let i = 0; i < 40 && !swung; i++) {
  await evaluate('__sdfGame.step(10, 1 / 60)');
  const d = await evaluate('__sdfGame.crowdMinDist()');
  if (typeof d === 'number' && d < worst) worst = d;
  const bs = await evaluate('__sdfGame.brains()');
  // (b.mode, from the 2026-09-04 three-mode brain, is b.state since the
  //  2026-09-05 seven-state machine — same read: mid-swing, progress > 0.)
  const mid = bs.find((b) => b.state === 'attack' && b.swingT > 0);
  swung = !!mid;
  if (mid) {
    // SHOOT THE SWING WHERE IT HAPPENS. The first version of this gate took
    // its swing frame after the 3.3 s ring-settle loop below, from the
    // doorway -- by then the swing was long over and the frame showed a
    // zombie standing several metres down a tunnel. The assertion (brains()
    // state) was right and the picture was of something else entirely.
    // Place the camera 1.6 m from THIS zombie, looking at it, and take the
    // frame on the next step while the swing is still in flight.
    const zs = await evaluate('__sdfGame.zombies()');
    const me = zs.find((z) => z.id === mid.id);
    if (me) {
      // Stand off along -x/-z from the body and face it. Player forward is
      // [sin yaw, 0, -cos yaw] (game-player.ts), so yaw = atan2(dx, -dz).
      const cx = me.pos[0] - 1.6;
      const cz = me.pos[2] - 1.6;
      const yaw = Math.atan2(me.pos[0] - cx, -(me.pos[2] - cz));
      await evaluate(`__sdfGame.setPose(${cx}, ${cz}, ${yaw}, -0.12, 0)`);
      await evaluate('__sdfGame.step(1, 1 / 60)');
      await shot('fpv-swing');
      const still = await evaluate('__sdfGame.brains()');
      const s2 = still.find((b) => b.id === mid.id);
      console.log(`swing frame: zombie ${mid.id} state=${s2?.state} swingT=${s2?.swingT?.toFixed(3)}`);
      if (!(s2 && s2.state === 'attack' && s2.swingT > 0)) {
        fail(`the swing frame was captured after zombie ${mid.id} finished swinging ` +
             `(state=${s2?.state}, swingT=${s2?.swingT}) -- the picture does not show what it claims`);
      }
      await evaluate(FPV);
    }
  }
}
// After the first swing, give the rest of the alert pack ~3.3 s to arrive,
// so the pair distances measured here are melee-ring distances, not approach
// distances.
for (let i = 0; i < 20; i++) {
  await evaluate('__sdfGame.step(10, 1 / 60)');
  const d = await evaluate('__sdfGame.crowdMinDist()');
  if (typeof d === 'number' && d < worst) worst = d;
}
await shot('room4-melee-ring');
if (!swung) fail('no zombie ever reached melee range and swung');
console.log('swing: a zombie reached melee range and swung');

console.log(`crowd: worst pairwise centre distance ${worst.toFixed(3)} m (touching = ${TOUCH})`);

// The gate. Separation is SOFT, so a shove may leave a shallow overlap for a
// frame; a body standing INSIDE another is what this forbids. Half the touch
// distance is one radius: at that point the two centres are closer than one
// body is wide, which is the visual defect the owner reported.
if (!(worst > TOUCH * 0.5)) {
  fail(`zombies interpenetrating: worst centre distance ${worst.toFixed(3)} m ` +
       `(< ${(TOUCH * 0.5).toFixed(3)}). Separation is not running, or the ` +
       'nudge is being overwritten by the wander step.');
}

// --- 4. SEPARATION PROBE. The pair metric above can stay above the floor
//     even with separation disconnected: the engage halt alone keeps
//     chasers a ring-radius apart (measured nudge-off: 0.542 m), and the
//     player capsule (stepPlayer) resolves the player out of any body he
//     stands on. The nudge's exclusive domain is ZOMBIE-vs-ZOMBIE pairs, so
//     the probe tests exactly that: teleport one alert zombie ONTO another
//     (the zombieNudge seam -- the same clamp path the separation nudge
//     uses, so setup works in both builds), then step. Engaged brains halt
//     both bodies, so nothing else can move them: a wired separate()->nudge
//     chain slides the pair apart to the touch distance (~0.70 m) within
//     frames; a broken chain leaves them coincident at 0.000 forever.
const now4 = (await evaluate('__sdfGame.brains()')).filter((b) => b.room === 4 && b.alert);
if (now4.length < 2) {
  fail(`separation probe needs two alert zombies in room 4, got ${now4.length}`);
}
const [pa, pb] = now4;
const spots2 = await evaluate('__sdfGame.zombies()');
const za = spots2.find((z) => z.id === pa.id);
const zb = spots2.find((z) => z.id === pb.id);
await evaluate(`__sdfGame.zombieNudge(${pb.id}, ${za.pos[0] - zb.pos[0]}, ${za.pos[2] - zb.pos[2]})`);
for (let i = 0; i < 45; i++) {
  await evaluate('__sdfGame.step(1, 1 / 60)');
}
const after2 = await evaluate('__sdfGame.zombies()');
const fa = after2.find((z) => z.id === pa.id);
const fb = after2.find((z) => z.id === pb.id);
const pairDist = Math.hypot(fa.pos[0] - fb.pos[0], fa.pos[2] - fb.pos[2]);
console.log(`probe: zombies ${pa.id}+${pb.id} teleported coincident settled at ${pairDist.toFixed(3)} m apart`);
if (!(pairDist > 0.5)) {
  fail(`separation is not running: zombies ${pa.id} and ${pb.id} are still ` +
       `${pairDist.toFixed(3)} m apart after being teleported onto each ` +
       'other. The nudge is not reaching the actors.');
}

// --- 4. NEGATIVE CONTROL. A gate that cannot fail proves nothing. With the
//     player in a tunnel (no room), nothing may be alert after the grace.
await evaluate('__sdfGame.setPose(-4.8, 0.0, 0, 0)');   // tunnel 4-1 mouth
await evaluate('__sdfGame.step(360, 1 / 60)');          // 6 s > loseGrace
const calm = await evaluate('__sdfGame.brains()');
if (calm.some((b) => b.alert)) {
  fail(`zombies stayed alert with the player out of the room: ${JSON.stringify(calm.filter((b) => b.alert))}`);
}
console.log('lock: everything went calm once the player left the room');

// --- 5. THE MELEE RING. Three claims, one per line of the 2026-09-05 spec.
//     Walk back into room 4 and let the pack settle into the ring.
await evaluate(FPV);
// WAKE THE WHOLE ROOM FIRST. Only 2 of room 4's 4 bodies notice the player on
// their own (the other two are outside the facing cone when he walks in), and
// a ring check that only ever sees two claimants cannot exercise the token
// cap -- it would pass trivially. A shot bypasses the cone for every body in
// the room, which is what puts four claimants on a two-token ring.
await evaluate('__sdfGame.fire(1)');
await evaluate('__sdfGame.step(240, 1 / 60)');
const awake = (await evaluate('__sdfGame.brains()')).filter((b) => b.room === 4 && b.alert);
if (awake.length < 3) {
  fail(`only ${awake.length} room-4 bodies woke after a shot in the room; the ring ` +
       'check needs at least 3 claimants to mean anything');
}
const ring = await evaluate('__sdfGame.ringTuning()');
const ATTACK_STATES = ['engage', 'attack', 'recover'];

let worstGap = Infinity;
let maxSwinging = 0;
let worstSpread = Math.PI;
// 5a's measure, computed over RING-RELEVANT pairs only (at least one body of
// the pair in an attack state), because minHandGap()'s all-bodies aperture
// measures bodies this claim is not about: on every run it went negative for
// exactly one pair -- z5+z6, two IDLE bodies parked shoulder-to-shoulder in
// room 3, 10+ m from the fight, whose hanging arm prims graze around zero as
// soft separation settles idle neighbours near touch distance. Measured on
// the wired build: every pair with a body engaged stayed >= 0.18 m clear, the
// cap held at 2 and the spread at 147 deg, so neither of the plan's two
// diagnoses (minSlotAngle too small / arbitration not reaching the actors)
// held -- the instrument, not the ring, was wrong. The ARITHMETIC is
// unchanged from the minHandGap() seam (endpoint-to-endpoint minus both
// radii, a conservative under-estimate: it can cry wolf, it cannot miss a
// clip); only the subset is narrowed to the bodies the ring governs. The
// mutation below (every body forced to hold a token) still fails this: four
// claimants pack the ring with nothing spreading their bearings, and all
// four read as an attack state, tripping 5b as well.
const RING_GAP = `(() => {
  const ATTACK = ['engage', 'attack', 'recover'];
  const ids = __sdfGame.brains().filter((b) => ATTACK.includes(b.state)).map((b) => b.id);
  const arms = ids.map((id) => {
    const pts = [];
    for (const prim of __sdfGame.zombie(id).posed().prims) {
      if (prim.limb !== 'armL' && prim.limb !== 'armR') continue;
      pts.push({ p: prim.a, r: prim.radius }, { p: prim.b, r: prim.radius });
    }
    return pts;
  });
  let best = Infinity;
  for (let i = 0; i < arms.length; i++) {
    for (let j = i + 1; j < arms.length; j++) {
      for (const u of arms[i]) {
        for (const v of arms[j]) {
          const g = Math.hypot(u.p[0] - v.p[0], u.p[1] - v.p[1], u.p[2] - v.p[2]) - u.r - v.r;
          if (g < best) best = g;
        }
      }
    }
  }
  return best;
})()`;
for (let i = 0; i < 30; i++) {
  await evaluate('__sdfGame.step(6, 1 / 60)');
  const bs = await evaluate('__sdfGame.brains()');
  const gap = await evaluate(RING_GAP);
  if (typeof gap === 'number' && Number.isFinite(gap) && gap < worstGap) worstGap = gap;

  const swinging = bs.filter((b) => ATTACK_STATES.includes(b.state));
  if (swinging.length > maxSwinging) maxSwinging = swinging.length;

  // Every pair of token holders must clear minSlotAngle.
  const holders = bs.filter((b) => b.hasToken);
  for (let a = 0; a < holders.length; a++) {
    for (let c = a + 1; c < holders.length; c++) {
      let d = holders[a].bearing - holders[c].bearing;
      while (d <= -Math.PI) d += 2 * Math.PI;
      while (d > Math.PI) d -= 2 * Math.PI;
      if (Math.abs(d) < worstSpread) worstSpread = Math.abs(d);
    }
  }
}
await shot('melee-ring');
console.log(
  `ring: worst arm gap ${worstGap.toFixed(3)} m · most engaged at once ${maxSwinging}` +
  ` · tightest holder spread ${((worstSpread * 180) / Math.PI).toFixed(1)} deg`,
);

// 5a. THE OWNER'S DEFECT, AS A NUMBER. Arms on different bodies must not
//     interpenetrate. The measure is conservative (endpoint-to-endpoint minus
//     both radii, an under-estimate of the true capsule gap), so a pass here
//     is a real pass; a small negative could in principle be a false alarm,
//     which is why the floor is 0 and not a padded value.
if (!(worstGap > 0)) {
  fail(`arms interpenetrating: closest arm-prim gap between two bodies was ` +
       `${worstGap.toFixed(3)} m. Ring arbitration is not limiting who engages, ` +
       'or minSlotAngle is too small for the arm reach.');
}
// 5b. The token cap.
if (maxSwinging > ring.tokens) {
  fail(`${maxSwinging} bodies were in an attack state at once, cap is ${ring.tokens}`);
}
// 5c. Angular spacing between holders.
if (worstSpread < ring.minSlotAngle - 1e-3) {
  fail(`two token holders were only ${((worstSpread * 180) / Math.PI).toFixed(1)} deg apart, ` +
       `minimum is ${((ring.minSlotAngle * 180) / Math.PI).toFixed(1)} deg`);
}
console.log('ring: cap and spacing hold, no arm interpenetration');

await evaluate('__sdfGame.setLoopRunning(true)');
const errs2 = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs2.length) fail(`console errors during the run: ${JSON.stringify(errs2.slice(0, 3))}`);
console.log(`[crowd] OK — ${shotCount} shots in ${OUT}`);
process.exit(0);
