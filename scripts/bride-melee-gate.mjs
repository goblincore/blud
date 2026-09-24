// scripts/bride-melee-gate.mjs — the bride FIGHTS in the game (Task 11 of
// docs/superpowers/plans/2026-09-24-bride-sword-enemy.md, Step 6).
//
// Headless gate on /sdf-game.html?spawn=bride: every non-soldier slot is a
// bride on the sword mind (enemy-mind.ts makeSwordMind). The player stands
// still ~5 m from one of them for 20 s of sim and the page is sampled every
// 100 ms (6 frames). Asserts:
//   1. fist-to-grip <= 3 cm at the guard AND on the swing frames — both the
//      SEATED gap (what renders) and the AUTHORED gap (the solved fist to the
//      grip where motion.ts put it, before game-actor re-seats the prop);
//   2. a lunge started beyond 2.2 m, and the distance then dropped by >= 0.8 m
//      within 1.2 s (the lunge's root advance reached the game);
//   3. at least one cleave or sweep;
//   4. __sdfGame.playerHits() >= 1 (contact reached the player feedback);
//   5. no carry but the guard at any swing start (the run-to-swing snap);
//   6. zero console errors / exceptions (pipeline errors included).
// Shoots the standing guard, a cleave's wind-up and its strike (the red hit
// flash on screen) into docs/dev-notes/2026-09-24-bride/game-melee-*.png.
//
// Usage (vite + a WebGPU Chrome already listening, e.g. scripts/lab-servers.sh):
//   node scripts/bride-melee-gate.mjs <vitePort> <cdpPort>
// Env: OUT (docs/dev-notes/2026-09-24-bride), ROOM (2), DIST (5), SIM_SEC (20).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5271);
const CDP = Number(process.argv[3] ?? 9271);
const OUT = process.env.OUT ?? 'docs/dev-notes/2026-09-24-bride';
const ROOM = Number(process.env.ROOM ?? 2);
const DIST = Number(process.env.DIST ?? 5);
const SIM_SEC = Number(process.env.SIM_SEC ?? 20);
const PITCH = 0.12;
// The frames turn the camera FRAME_YAW rad off her so she stands clear of the
// first-person shotgun (centre-right of the screen); the sim never reads yaw.
const FRAME_YAW = Number(process.env.FRAME_YAW ?? 0.3);
const FIST_MAX = 0.03;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`PASS: ${msg}`);
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);
}

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {}
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
    consoleEvents.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 60000,
    `evaluate: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
mkdirSync(OUT, { recursive: true });
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  console.log(`  shot ${file}`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?spawn=bride&seed=1&vhs=off` });

let backend = null;
for (let i = 0; i < 240 && !backend; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
}
if (backend !== 'webgpu') fail(`backend ${backend}, expected webgpu`);
for (let i = 0; i < 240; i++) {
  if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') === 'ready') break;
  await sleep(500);
}
if (await evaluate('window.__warmGate ? window.__warmGate.phase : "ready"') !== 'ready') fail('warm gate never reached ready');
await evaluate('__sdfGame.setLoopRunning(false)');
for (const p of ['woundPanel', 'gooPanel', 'vhsPanel']) {
  await evaluate(`typeof __sdfGame.${p} === "function" ? (__sdfGame.${p}(false), 1) : 0`);
}

// --- Stage: room 2, the nearest bride, the player DIST m off her, inside
//     the room (toward its centre), facing her.
await evaluate(`__sdfGame.teleport(${ROOM}); __sdfGame.step(2, 1 / 60);`);
const centre = await evaluate('__sdfGame.playerPos()');
const brides = (await evaluate('__sdfGame.brains()')).filter((b) => b.room === ROOM && b.kind !== 'soldier');
if (!brides.length) fail(`no bride in room ${ROOM}`);
const actors = await evaluate('__sdfGame.zombies()');
const posOf = (id) => actors.find((a) => a.id === id).pos;
brides.sort((a, b) => a.dist - b.dist);
const target = brides[0];
const tp = posOf(target.id);
console.log(`room ${ROOM}: ${brides.length} bride(s); target ${target.id} at ${tp.map((v) => v.toFixed(2)).join(', ')}`);
const yawTo = (from, to) => Math.atan2(to[0] - from[0], -(to[2] - from[2]));
let stand = null;
{
  const dx = centre[0] - tp[0], dz = centre[2] - tp[2], l = Math.hypot(dx, dz) || 1;
  for (const d of [DIST, DIST - 0.5, DIST - 1]) {
    const p = [tp[0] + dx / l * d, 0, tp[2] + dz / l * d];
    const key = await evaluate(`__sdfGame.placePlayer({ x: ${p[0]}, z: ${p[2]}, yaw: 0 })`);
    if (key === `room${ROOM}`) { stand = p; break; }
  }
}
if (!stand) fail(`could not stand the player ${DIST} m from bride ${target.id} inside room ${ROOM}`);
const place = (yaw, pitch = PITCH) => `__sdfGame.placePlayer({ x: ${stand[0]}, z: ${stand[2]}, yaw: ${yaw}, pitch: ${pitch} })`;
// Wake the room without hitting her: one barrel fired straight AWAY from her.
await evaluate(place(yawTo(stand, tp) + Math.PI));
await evaluate('__sdfGame.fire(1); __sdfGame.step(1, 1 / 60);');
await evaluate(place(yawTo(stand, tp)));
await sleep(5000); // the READY card fades on the wall clock
console.log(`player at ${stand.map((v) => v.toFixed(2)).join(', ')}, ${Math.hypot(stand[0] - tp[0], stand[2] - tp[2]).toFixed(2)} m from her`);

// --- Run SIM_SEC of sim, sampling every 6 frames.
const variants = new Set();
const lunges = [];          // { id, startDist, minDist, samplesLeft }
const guardFist = [], swingFist = [], guardAuth = [], swingAuth = [];
const startCarries = new Set();
const prev = new Map();
let shotGuard = false, shotWindup = false, shotStrike = false;
const faceBride = async (id) => {
  const p = (await evaluate('__sdfGame.zombies()')).find((a) => a.id === id).pos;
  await evaluate(place(yawTo(stand, p) + FRAME_YAW, 0));
};
const samples = Math.round(SIM_SEC * 10);
for (let i = 0; i < samples; i++) {
  await evaluate('__sdfGame.step(6, 1 / 60)');
  const bs = (await evaluate('__sdfGame.brains()')).filter((b) => b.room === ROOM && b.kind !== 'soldier');
  for (const b of bs) {
    const was = prev.get(b.id);
    const starting = b.state === 'attack' && (!was || was.state !== 'attack');
    if (b.state === 'attack') {
      variants.add(b.variant);
      if (b.fistGrip != null) { swingFist.push(b.fistGrip); swingAuth.push(b.fistGripAuthored); }
    } else if (b.alert && b.carry === 'swordGuard' && b.fistGrip != null) {
      guardFist.push(b.fistGrip); guardAuth.push(b.fistGripAuthored);
    }
    if (starting) {
      startCarries.add(b.carry);
      if (b.variant === 'lunge') lunges.push({ id: b.id, startDist: b.dist, minDist: b.dist, samplesLeft: 12 });
      console.log(`  t=${(i / 10).toFixed(1)}s bride ${b.id} ${b.variant} from ${b.dist.toFixed(2)} m (carry ${b.carry})`);
    }
    for (const l of lunges) if (l.id === b.id && l.samplesLeft > 0) { l.minDist = Math.min(l.minDist, b.dist); l.samplesLeft--; }
    prev.set(b.id, b);
  }
  // The standing guard: the target recovering near the player.
  const t = bs.find((b) => b.id === target.id);
  if (!shotGuard && t && t.state === 'recover' && t.dist < 3.2) {
    // A few frames after turning the camera: the renderer's temporal history
    // otherwise ghosts the previous view into the shot.
    await faceBride(t.id);
    await evaluate('__sdfGame.step(6, 1 / 60)');
    await shot('game-melee-guard');
    shotGuard = true;
  }
  // A cleave: its wind-up, then frame by frame to the hit (the flash).
  const c = bs.find((b) => b.state === 'attack' && b.variant === 'cleave' && b.swingT > 0.05 && b.swingT < 0.2 && b.dist < 2.3);
  if (c && !shotStrike) {
    await faceBride(c.id);
    await evaluate('__sdfGame.step(6, 1 / 60)');
    if (!shotWindup) { await shot('game-melee-cleave-windup'); shotWindup = true; }
    const hits0 = await evaluate('__sdfGame.playerHits()');
    for (let k = 0; k < 40; k++) {
      await evaluate('__sdfGame.step(1, 1 / 60)');
      if (await evaluate('__sdfGame.playerHits()') > hits0) {
        const me = (await evaluate('__sdfGame.brains()')).find((b) => b.id === c.id);
        console.log(`  hit on frame ${k + 1}: bride ${c.id} ${me.variant} swingT ${me.swingT.toFixed(3)}, fist-to-grip ${(me.fistGrip * 100).toFixed(2)} cm seated / ${(me.fistGripAuthored * 100).toFixed(2)} cm authored`);
        swingFist.push(me.fistGrip); swingAuth.push(me.fistGripAuthored);
        await shot('game-melee-cleave-strike');
        shotStrike = true;
        break;
      }
    }
  }
}

const hits = await evaluate('__sdfGame.playerHits()');
const contacts = (await evaluate('__sdfGame.brains()')).filter((b) => b.meleeContacts > 0).map((b) => `${b.kind} ${b.id}: ${b.meleeContacts}`);
console.log(`melee contacts by actor: ${contacts.join(', ') || 'none'}`);
const maxOf = (a) => (a.length ? Math.max(...a) : NaN);
const cm = (v) => `${(v * 100).toFixed(2)} cm`;
console.log(`variants: ${[...variants].sort().join(', ') || 'none'}; swing-start carries: ${[...startCarries].join(', ')}`);
console.log(`lunges: ${lunges.map((l) => `${l.startDist.toFixed(2)} -> ${l.minDist.toFixed(2)} m`).join('; ') || 'none'}`);
console.log(`fist-to-grip max: guard ${cm(maxOf(guardFist))} seated / ${cm(maxOf(guardAuth))} authored (${guardFist.length} samples); ` +
  `swing ${cm(maxOf(swingFist))} seated / ${cm(maxOf(swingAuth))} authored (${swingFist.length} samples)`);
console.log(`playerHits: ${hits}`);

let failed = false;
const check = (ok, msg) => { if (ok) pass(msg); else { console.error(`FAIL: ${msg}`); failed = true; } };
check(guardFist.length > 0 && maxOf(guardFist) <= FIST_MAX && maxOf(guardAuth) <= FIST_MAX,
  `fist-to-grip at the guard <= 3 cm (${cm(maxOf(guardFist))} seated, ${cm(maxOf(guardAuth))} authored)`);
check(swingFist.length > 0 && maxOf(swingFist) <= FIST_MAX && maxOf(swingAuth) <= FIST_MAX,
  `fist-to-grip on the swing frames <= 3 cm (${cm(maxOf(swingFist))} seated, ${cm(maxOf(swingAuth))} authored)`);
const good = lunges.filter((l) => l.startDist > 2.2 && l.startDist - l.minDist >= 0.8);
check(good.length > 0, `a lunge from beyond 2.2 m closed >= 0.8 m within 1.2 s (${good.map((l) => `${l.startDist.toFixed(2)} m, -${(l.startDist - l.minDist).toFixed(2)} m`).join('; ') || 'none'})`);
check(variants.has('cleave') || variants.has('sweep'), `a cleave or sweep (${[...variants].sort().join(', ')})`);
check(hits >= 1, `playerHits >= 1 (${hits})`);
check([...startCarries].every((c) => c === 'swordGuard'), `every swing starts from the guard carry (${[...startCarries].join(', ')})`);
check(shotGuard && shotWindup && shotStrike, `frames: guard ${shotGuard}, cleave wind-up ${shotWindup}, cleave strike ${shotStrike}`);
const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
check(errs.length === 0, `no console errors / pipeline errors (${errs.length}${errs.length ? `: ${errs.slice(0, 3).map((e) => e.text).join(' | ')}` : ''})`);
process.exit(failed ? 1 : 0);
