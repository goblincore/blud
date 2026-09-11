// scripts/sdf-march-occupancy.mjs — WHERE THE MARCH'S PIXELS GO.
//
// The question this answers, and why it is the right one: every step-side lever
// on this march is already spent (plain sphere tracing at omega 1.0, wound step
// 1.0, the secant last step, footprint AA — and the step-budget cut measured
// FLAT). The repo's own recorded conclusion from the step-budget sweep is why:
// **cost is per-PIXEL, not per-step**, so what matters is how many marched
// pixels are FLESH and how many are marched for nothing. `__sdfGame.occupancy()`
// is the existing seam that measures exactly that (march debug mode 4: the march
// target's channels become r=steps, g=hit, b=rasterised, a=t for one frame), and
// this script drives it across rooms and states so the number is comparable
// rather than anecdotal.
//
// WHAT IT REPORTS, per room and per state:
//   coverage    fraction of the SDF target the march TOUCHED at all
//               (1 - coverage = pixels never marched: the sky, and anything the
//               proxy boxes culled)
//   occupancy   of the pixels it DID march, the fraction that hit flesh.
//               **1 - occupancy is the waste**, and it is the addressable market
//               for anything that marches fewer pixels (a tighter hull, a
//               visibility/reprojection scheme).
//   steps       mean steps on hit rays vs miss rays, and the SHARE of all steps
//               spent on rays that hit nothing — the step-side view, for when a
//               proposal claims to save steps.
//
// THE CAVEAT THE SEAM ITSELF STATES: reported occupancy is a LOWER BOUND on the
// waste. Depth-testing means only the front-most body writes each pixel, so
// overlapping proxy boxes hide fragment invocations this cannot see.
//
// Usage (needs servers; scripts/lab-servers.sh owns them, or use the .sh):
//   LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-march-occupancy.mjs
//   MARCH_OCC_ROOMS=1,2,3,4,5 MARCH_OCC_BURST=1 ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? process.env.LAB_VITE_PORT ?? 5277);
const CDP = Number(process.argv[3] ?? process.env.LAB_CDP_PORT ?? 9277);
const OUT = process.env.GAME_OUT ?? '/tmp/sdf-march-occupancy';
const ROOMS = (process.env.MARCH_OCC_ROOMS ?? '1,2,3,4,5').split(',').map(Number);
// Whether to ALSO measure after a burst. The wound path is the march's most
// expensive state (the bench's fire/gib segments), so a walk-state number alone
// would understate the case the owner actually cares about.
const BURST = process.env.MARCH_OCC_BURST !== '0';
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 30 min'); process.exit(3); }, 30 * 60_000).unref();

mkdirSync(OUT, { recursive: true });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__occConsole = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__occConsole.push(['error', a.map(String).join(' ')]); e(...a); };
    console.warn = (...a) => { window.__occConsole.push(['warn', a.map(String).join(' ')]); w(...a); };
  })()`,
});

await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });
await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); return 1; })()');
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); return 1; })()');
for (let i = 0; i < 60; i++) { if (await evaluate('__sdfGame.gunReady')) break; await sleep(250); }
let baked = false;
for (let i = 0; i < 240; i++) {
  if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) { baked = true; break; }
  await sleep(500);
}
if (!baked) fail('roomProbesReady never landed');

const target = await evaluate('(() => { const t = __sdfGame.__marchTargetSize?.() ?? null; return t; })()').catch(() => null);
void target;

const rows = [];
async function measure(room, state) {
  // `occupancy()` toggles the render loop itself (loop off, one stepped frame,
  // resolve, read back) and restores the previous debug mode, so it is safe to
  // call between other staging — but it must NOT be called with the loop
  // already stopped by us, hence no setRenderLock around it.
  const r = await evaluate('__sdfGame.occupancy()');
  if (!r || !r.screenPx) fail(`occupancy() returned ${JSON.stringify(r)?.slice(0, 160)}`);
  rows.push({ room, state, ...r });
  console.log(`room ${room} ${state.padEnd(5)}: coverage ${(100 * r.coverage).toFixed(1)}%  `
    + `occupancy ${(100 * r.occupancy).toFixed(1)}%  (waste ${(100 * (1 - r.occupancy)).toFixed(1)}%)  `
    + `rasterised ${r.rasterised}  hits ${r.hits}  bodies ${r.bodiesOnScreen}  `
    + `stepsHit ${r.meanStepsHit.toFixed(1)} stepsMiss ${r.meanStepsMiss.toFixed(1)} `
    + `missStepShare ${(100 * r.missStepShare).toFixed(1)}%`);
}

for (const room of ROOMS) {
  // Teleport rather than setPose: it aims the player at the room's own staged
  // subject (the bench census tuned it), so "is there flesh on screen" is the
  // room's answer and not my guess at a vantage.
  await evaluate(`(() => __sdfGame.teleport(${room}))()`);
  await evaluate('(() => { __sdfGame.step(60); return 1; })()');   // settle: transients + hull build
  await measure(room, 'walk');
  if (BURST) {
    // A burst, then settle just past the muzzle flash (0.14 s) so what is left on
    // screen is the WOUND state rather than the flash itself.
    for (let i = 0; i < 20; i++) { if (await evaluate('(() => __sdfGame.fire(2))()')) break; await sleep(250); }
    await evaluate('(() => { __sdfGame.step(12); return 1; })()');
    await measure(room, 'burst');
    await evaluate('(() => { __sdfGame.step(90); return 1; })()');  // let the wounds stop dominating
  }
}

const logged = await evaluate('(() => window.__occConsole ?? [])()').catch(() => []);
const bad = (logged ?? []).filter(([k, t]) => k === 'error' || /TSL|WGSL|Tint|pipeline/i.test(String(t)));
console.log(`\nconsole errors: ${bad.length}`);
for (const [k, t] of bad.slice(0, 8)) console.log(`  [${k}] ${String(t).slice(0, 200)}`);

console.log('\n=== SUMMARY ===');
const walk = rows.filter(r => r.state === 'walk');
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
console.log(`walk-state mean coverage ${(100 * mean(walk.map(r => r.coverage))).toFixed(1)}%  `
  + `mean occupancy ${(100 * mean(walk.map(r => r.occupancy))).toFixed(1)}%  `
  + `=> mean waste ${(100 * (1 - mean(walk.map(r => r.occupancy)))).toFixed(1)}% of marched pixels`);
console.log(`mean steps: hit ${mean(rows.map(r => r.meanStepsHit)).toFixed(1)}, `
  + `miss ${mean(rows.map(r => r.meanStepsMiss)).toFixed(1)}, `
  + `miss share of all steps ${(100 * mean(rows.map(r => r.missStepShare))).toFixed(1)}%`);

const file = `${OUT}/occupancy.json`;
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), rooms: ROOMS, rows }, null, 2));
console.log(`\nwrote ${file}`);
process.exit(bad.length ? 2 : 0);
