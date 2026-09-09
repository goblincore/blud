// scripts/sdf-game-tracer-look.mjs — LOOK capture for the shot tracers on
// sdf-game.html. Not a pass/fail gate: it fires down an empty stretch and
// burst-captures the streaks so the change can be judged by eye, plus a
// muzzle-adjacent frame that pins the thing this replaced (a 10 cm ball filling
// the screen for the first frames of flight).
//
// Same no-deps CDP pattern as scripts/sdf-game-grapeshot.mjs.
//
// Usage: LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-game-tracer-look.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5277);
const CDP = Number(process.argv[3] ?? 9277);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-game-tracer-look';
const W = Number(process.env.GAME_W ?? 900);
const H = Number(process.env.GAME_H ?? 640);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', closeTabUrl], { stdio: 'ignore' }); } catch {}
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
    consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 400) });
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms)),
  ]);
}
const evaluate = async (expression, ms = 30000) => {
  const r = await withTimeout(
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    ms, `evaluate timed out: ${expression.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

mkdirSync(OUT, { recursive: true });
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(s.result.data, 'base64');
  writeFileSync(`${OUT}/${name}.png`, buf);
  console.log(`  shot ${name}.png (${buf.length} bytes)`);
}
/** A 3x blow-up of the reticle neighbourhood. A tracer is a few pixels wide at
 *  room range, so the full frame cannot settle whether it reads as a streak. */
async function zoomShot(name) {
  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: W / 2 - 150, y: H / 2 - 110, width: 300, height: 220, scale: 3 },
  });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.result.data, 'base64'));
  console.log(`  zoom ${name}.png`);
}

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// ?frozen holds the wander at the spawn points. Without it the room's zombies
// close on the player during the boot settle and stand ON the muzzle, and every
// volley dies in a body two frames out — which is a fine gore capture and a
// useless flight capture.
const url = `http://localhost:${VITE}/sdf-game.html?frozen`;
console.log(`game ${url}`);
await send('Page.navigate', { url });

// A busy machine (another lab Chrome next door, a build running) can leave the
// boot probe unanswered for well over the default bound while the page is
// merely SLOW, not wedged. Swallow the timeouts and keep polling — the loop's
// own 240 tries is the real deadline.
let api = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  try {
    api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null', 10000);
  } catch { api = null; }
  if (api) break;
}
if (!api) {
  console.error('console tail:', consoleEvents.slice(-8));
  fail('game page never booted (__sdfGame absent)');
}
console.log(`backend: ${api}`);
for (let i = 0; i < 40; i++) {
  if (await evaluate('window.__sdfGame.gunReady')) break;
  await sleep(250);
}
if (!(await evaluate('window.__sdfGame.gunReady'))) fail('gun GLB never reported ready');
console.log('gun: ready');

await sleep(2500);

// THE LANE. Room1 is the 8 m square x,z in [-8.8, -0.8]; standing at its
// centre facing +z (yaw pi) is the longest UNOBSTRUCTED shot on the level —
// measured, not guessed: a probe over six poses had pellets alive for ~250 ms
// there against ~50 ms from the corners, where the room's furniture eats the
// volley almost immediately.
const LANE = 'window.__sdfGame.setPose(-4.8, -4.8, Math.PI, 0.06)';

/** The gun holds two shells and reloads itself dry, so a capture that just
 *  calls fire() gets silent no-ops for its second and third volley. Wait for
 *  a loaded, off-cooldown gun and assert the trigger actually pulled. */
async function pull(expr, what) {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(expr)) return;
    await sleep(250);
  }
  fail(`${what} never fired (shells ${await evaluate('__sdfGame.shells')})`);
}

// --- Volley down the lane, burst-captured through the whole flight ----------
await evaluate(LANE);
await sleep(500);
await shot('00-before');
await pull('__sdfGame.fire(1)', 'one barrel');
for (const [k, wait] of [['a', 25], ['b', 25], ['c', 30], ['d', 35], ['e', 45], ['f', 60]]) {
  await sleep(wait);
  console.log(`  t+${k}: projectiles ${await evaluate('__sdfGame.projectiles().length')}`);
  await shot(`01-flight-${k}`);
  await zoomShot(`01-flight-${k}-zoom`);
}
await sleep(1500);

// --- Double barrel: more streaks at once ------------------------------------
await evaluate(LANE);
await pull('__sdfGame.fire(2)', 'double barrel');
await sleep(35);
await shot('02-double-a');
await zoomShot('02-double-a-zoom');
await sleep(45);
await shot('02-double-b');
await zoomShot('02-double-b-zoom');
await sleep(1500);

// --- CROSS VIEW: the shape itself ------------------------------------------
// A shot fired down the view axis is foreshortened to nearly a point, which is
// true of real tracers and useless for judging the sprite. Fire down the lane,
// then whip the view 60 deg off it so the volley crosses the screen broadside.
// Aimed UP so the volley clears the room's standing soldier (the flat lane
// puts him in the way and the streaks die before the turn lands).
await evaluate('window.__sdfGame.setPose(-4.8, -4.8, Math.PI, 0.34)');
await sleep(400);
await pull('__sdfGame.fire(2)', 'cross-view volley');
await sleep(18);
// Teleport to a vantage 3 m to the side of the lane, looking across it (-x),
// so the volley travels left-to-right through the frame. Rolling the view in
// place is not enough: 40 ms out the pellets are barely a metre from the eye
// and any turn wide enough to see them broadside puts them outside the
// frustum.
await evaluate('window.__sdfGame.setPose(-1.8, -3.0, -Math.PI / 2, 0.24)');
for (const [k, wait] of [['a', 12], ['b', 18], ['c', 25], ['d', 35]]) {
  await sleep(wait);
  console.log(`  cross+${k}: projectiles ${await evaluate('__sdfGame.projectiles().length')}`);
  await shot(`04-cross-${k}`);
  await zoomShot(`04-cross-${k}-zoom`);
}
await sleep(1500);

// --- Slug: the fat single streak -------------------------------------------
await evaluate(LANE);
await pull('__sdfGame.fireSlug()', 'slug');
await sleep(35);
await shot('03-slug-a');
await zoomShot('03-slug-a-zoom');
await sleep(50);
await shot('03-slug-b');
await zoomShot('03-slug-b-zoom');
await sleep(1200);

const errs = consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');
if (errs.length) {
  console.error('console errors:', errs.slice(0, 5));
  fail(`${errs.length} console error(s) during the capture`);
}
console.log(`OK — frames in ${OUT}`);
process.exit(0);
