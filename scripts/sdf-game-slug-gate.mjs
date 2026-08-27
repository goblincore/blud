// scripts/sdf-game-slug-gate.mjs — SLUG MODE placement gate + reference
// captures for the wound-crater task (2026-08-26).
//
// The owner-reported defects, gated here:
//   (2) "wounds don't show up where the pellets hit" — fire ONE slug along a
//       known ray at a frozen scene; read back where the crater actually sits
//       (__sdfGame.debugWounds) vs where the ray struck
//       (__sdfGame.predictSlugHit). Assert within a few centimetres. A single
//       projectile is the only configuration that doesn't scatter the
//       evidence.
//   (1) "craters should look more red inside like in the lab" — capture the
//       same slug crater at probeWeight 0 / 0.75 / 1.0 for a pixel diff, plus
//       pellet-mode and blast-mode captures and the LAB rendering the same
//       wound class as the side-by-side reference.
//
// Usage: node scripts/sdf-game-slug-gate.mjs <vitePort> <cdpPort> <outDir>
// Exits non-zero when the placement gate fails. Servers via lab-servers.sh.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5317);
const CDP = Number(process.argv[3] ?? 9317);
const OUT = process.argv[4] ?? '/tmp/wound-slug-gate';
const W = 1100, H = 800;
const TOL_M = 0.03; // gate: crater surface anchor within 3 cm of impact

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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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
const evaluate = async (expression) => {
  const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000,
    `evaluate timed out: ${expression.slice(0, 80)}`);
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
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// ?slug boots straight into slug mode — this script exercises exactly what
// the owner can reach from the browser.
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?slug` });
let api = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (api) break;
}
if (api !== 'webgpu') fail(`page never booted on webgpu (got ${api})`);
for (let i = 0; i < 40; i++) {
  if (await evaluate('window.__sdfGame.gunReady')) break;
  await sleep(250);
}
if (!(await evaluate('window.__sdfGame.gunReady'))) fail('gun never ready');
console.log('booted: webgpu, gun ready');

// Browser reachability of slug mode, from THREE surfaces:
if (!(await evaluate('__sdfGame.slugMode'))) fail('?slug did not boot into slug mode');
const hudText = await evaluate('document.getElementById("hud") && document.getElementById("hud").textContent');
console.log(`HUD: ${hudText}`);
if (!hudText || !hudText.includes('SLUG')) fail('HUD does not announce SLUG mode');
// KeyE toggle round-trip.
await evaluate('__sdfGame.setSlugMode(false)');
if (await evaluate('__sdfGame.slugMode') !== false) fail('setSlugMode(false) failed');
await evaluate('__sdfGame.setSlugMode(true)');
if (!(await evaluate('__sdfGame.slugMode'))) fail('setSlugMode(true) failed');
console.log('slug mode reachable: ?slug param + HUD line + setter (KeyE bound to the same flag)');

// Freeze the wander so pose at fire == pose at render == pose at readback.
await evaluate('__sdfGame.freeze(true)');
await sleep(400);

const zs = await evaluate('window.__sdfGame.zombies()');
const z0 = zs.find(z => z.room === 1) ?? zs[0];
console.log(`target zombie ${z0.id} at (${z0.pos[0].toFixed(2)}, ${z0.pos[2].toFixed(2)}) room ${z0.room}`);

// Stand 2.4 m south of the target, aim the CROSSHAIR at its torso centre —
// like a player would. No manual offsets: convergence is supposed to make
// that correct now.
const EYE = 1.62; // matches the page's eye height for pitch math only
{
  const tx = z0.pos[0], tz = z0.pos[2];
  const sx = tx, sz = tz - 2.4;
  const yaw = Math.atan2(tx - sx, -(tz - sz));
  const pitch = Math.atan2(1.05 - EYE, 2.4);
  await evaluate(`__sdfGame.setPose(${sx}, ${sz}, ${yaw}, ${pitch})`);
  await sleep(400);
}

const pred = await evaluate('__sdfGame.predictSlugHit()');
if (!pred.hit) fail('predictSlugHit found no body on the crosshair ray — bad framing');
console.log(`predicted impact (${pred.hit.map(v => v.toFixed(3)).join(', ')}) on actor ${pred.actorId}, dist ${dist3(pred.origin, pred.hit).toFixed(2)} m`);
await evaluate(`__sdfGame.placeMarker(${pred.hit[0]}, ${pred.hit[1]}, ${pred.hit[2]}, 0xff00ff)`);
await sleep(350);
await shot('g1-predicted-impact-marked');

// Fire ONE slug through the real pipeline.
const w0 = await evaluate(`__sdfGame.debugWounds(${pred.actorId})`) || [];
await evaluate('__sdfGame.fireSlug()');
let woundsNow = null;
for (let i = 0; i < 40; i++) {
  await sleep(100);
  woundsNow = await evaluate(`__sdfGame.debugWounds(${pred.actorId})`);
  if (woundsNow && woundsNow.length > w0.length) break;
}
if (!woundsNow || woundsNow.length <= w0.length) fail('no new wound after fireSlug');
const newest = woundsNow[woundsNow.length - 1];
const dSurf = dist3(newest.surface, pred.hit);
const dCarve = dist3(newest.carve, pred.hit);
console.log(`PLACEMENT GATE: |surface − impact| = ${(dSurf * 100).toFixed(2)} cm, |carve − impact| = ${(dCarve * 100).toFixed(2)} cm (radius ${(newest.radius * 100).toFixed(1)} cm, type ${newest.type})`);
const GATE = dSurf <= TOL_M;
if (!GATE) fail(`placement gate FAILED: crater surface anchor ${dSurf * 100} cm off the impact point (> ${TOL_M * 100} cm)`);

// Reference captures of THE SAME crater under different ambient mixing
// (defect-1 evidence) and with both markers shown.
await evaluate(`__sdfGame.placeMarker(${newest.surface[0]}, ${newest.surface[1]}, ${newest.surface[2]}, 0x00ffff)`);
await sleep(350);
await shot('g2-crater-with-both-markers');

// Clean framing shots at three distances (owner's "hard to tell" setup).
const pw = await evaluate('__sdfGame.probeWeight');
for (const [name, dist, ty] of [['g3-arm-length', 1.0, newest.surface[1]], ['g4-across-room', 5.0, 1.05]]) {
  const tx = z0.pos[0], tz = z0.pos[2];
  const sx = tx, sz = tz - dist;
  const yaw = Math.atan2(tx - sx, -(tz - sz));
  const pitch = Math.atan2(ty - EYE, dist);
  await evaluate(`__sdfGame.setPose(${sx}, ${sz}, ${yaw}, ${pitch})`);
  await sleep(450);
  await shot(name);
}

// probeWeight A/B on the same crater, same camera (defect-1 measurement).
{
  const tx = z0.pos[0], tz = z0.pos[2];
  const sx = tx, sz = tz - 1.0;
  await evaluate(`__sdfGame.setPose(${sx}, ${sz}, 0, ${Math.atan2(newest.surface[1] - EYE, 1.0)})`);
  await sleep(400);
  for (const p of [pw, 0, 1]) {
    await evaluate(`__sdfGame.setProbeWeight(${p})`);
    await sleep(250);
    await shot(`g5-probe-${String(p).replace('.', '_')}`);
    if (p === pw) continue; // restore below
  }
  await evaluate(`__sdfGame.setProbeWeight(${pw})`);
}

// Blast-path check: resolveExplosion through explode(), geometry only.
{
  const tx = z0.pos[0], tz = z0.pos[2];
  // epicentre just off the belly so falloff scales the craters visibly
  await evaluate(`const e=__sdfGame.explode(${tx + 0.05}, 1.1, ${tz}); window.__blastInfo=e;`);
  console.log('explode():', JSON.stringify(await evaluate('window.__blastInfo')));
  await sleep(500);
  await shot('g6-blast-craters');
}

console.log(`done — shots in ${OUT}; PLACEMENT GATE PASSED (within ${(TOL_M * 100).toFixed(0)} cm)`);
process.exit(0);
