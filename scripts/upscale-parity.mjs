// scripts/upscale-parity.mjs — G1-parity for the neural upscale stage
// (docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md, Gates).
//
// One boot, one staged frozen frame. For each model x input set: enable the stage
// (random weights, seed 1), run __sdfGame.upscaleSelfCheck({ compareLayouts: true }),
// which compares BOTH layouts against the CPU twin (float16 storage emulated) and
// against each other, in-page. Exit 1 if any gate fails. Thresholds are the spec's;
// do not loosen them here.
//
// Usage (owns nothing; run inside lab-servers):
//   LAB_VITE_PORT=5311 LAB_CDP_PORT=9311 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-parity.mjs'
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5311);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9311);
const OUT = process.env.UPSCALE_OUT ?? '/tmp/upscale-parity';
const ROOM = Number(process.env.UPSCALE_ROOM ?? 1);
const DIST = Number(process.env.UPSCALE_DIST ?? 2.5);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 40 min'); process.exit(3); }, 40 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const conn = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
const { send, evaluate } = conn;
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__upConsole = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__upConsole.push(['error', a.map(String).join(' ')]); e(...a); };
    console.warn = (...a) => { window.__upConsole.push(['warn', a.map(String).join(' ')]); w(...a); };
  })()`,
});
await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off` });
await applyShipDefaults(evaluate);
// The gather's shipped afterglow (blend 0.6 / fall 0.12) is a slow temporal
// filter whose state depends on how many frames the run has dispatched; pin it
// to the pure per-frame estimate (the R1 dispatch configuration) so the march
// target is a function of the frozen scene alone and two reads are comparable.
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
await evaluate('(() => { performance.now = () => 100000; return 1; })()');
let baked = false;
for (let i = 0; i < 240; i++) {
  if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) { baked = true; break; }
  await sleep(500);
}
if (!baked) fail('roomProbesReady never landed');

const staged = await evaluate(`(async () => {
  __sdfGame.teleport(${ROOM});
  const z = __sdfGame.zombies().find(q => q.room === ${ROOM});
  if (!z) return { error: 'no body in room ${ROOM}' };
  __sdfGame.freeze(true);
  const d = ${DIST};
  const ex = z.pos[0], ez = z.pos[2] + d;
  const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
  __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)), 0);
  __sdfGame.step(30);
  __sdfGame.setRenderLock(true);
  return { body: z.id };
})()`);
if (staged?.error) fail(staged.error);
console.log(`staged: room ${ROOM}, body ${staged.body}, ${DIST} m`);

const CONFIGS = [
  { model: 'zero', inputs: 'rgb' },
  { model: 's8', inputs: 'rgb' }, { model: 's8', inputs: 'rgbd' },
  { model: 's16', inputs: 'rgb' }, { model: 's16', inputs: 'rgbd' },
  { model: 's32', inputs: 'rgb' }, { model: 's32', inputs: 'rgbd' },
];
const rows = [];
let failed = false;
console.log('\nmodel inputs | layout  covered   maxRelRgb  covMis  covMisFar  depthMis | sp-vs-dc maxRelRgb covMis | ms');
for (const c of CONFIGS) {
  const cfg = { ...c, layout: 'sp', seed: 1 };
  const r = await evaluate(`(async () => {
    __sdfGame.setUpscale(${JSON.stringify(cfg)});
    return await __sdfGame.upscaleSelfCheck({ compareLayouts: true });
  })()`, 600_000);
  const problems = [];
  if (!r.marchStable) problems.push('march target changed between renders (render lock not holding)');
  if (r.marchSize.width !== 400 || r.marchSize.height !== 300) problems.push(`march is ${r.marchSize.width}x${r.marchSize.height}, not 400x300`);
  for (const g of r.gpuVsCpu) {
    if (g.covered < 500) problems.push(`${g.layout}: only ${g.covered} covered pixels — the staged body is not in frame`);
    if (g.maxRelRgb > 2e-3) problems.push(`${g.layout}: GPU vs CPU rgb ${g.maxRelRgb.toExponential(2)} > 2e-3`);
    if (g.coverageMismatchFar > 0) problems.push(`${g.layout}: ${g.coverageMismatchFar} coverage mismatches outside the threshold band`);
    if (g.depthMismatch > 0) problems.push(`${g.layout}: ${g.depthMismatch} depth mismatches`);
    if (c.model === 'zero' && (g.coverageMismatch > 0 || g.maxRelRgb > 1e-6)) problems.push(`${g.layout}: zero model is not exactly nearest`);
  }
  if (r.layouts.maxRelRgb > 2e-3) problems.push(`sp vs dc rgb ${r.layouts.maxRelRgb.toExponential(2)} > 2e-3`);
  if (r.layouts.coverageMismatch > 0.005 * r.layouts.pixels) problems.push(`sp vs dc coverage mismatches ${r.layouts.coverageMismatch} > 0.5%`);
  for (const g of r.gpuVsCpu) {
    console.log(`${c.model.padEnd(5)} ${c.inputs.padEnd(6)} | ${g.layout.padEnd(6)} ${String(g.covered).padStart(8)}  ${g.maxRelRgb.toExponential(2).padStart(9)}  ${String(g.coverageMismatch).padStart(6)}  ${String(g.coverageMismatchFar).padStart(9)}  ${String(g.depthMismatch).padStart(8)} | ${r.layouts.maxRelRgb.toExponential(2).padStart(17)} ${String(r.layouts.coverageMismatch).padStart(6)} | ${Math.round(r.ms)}`);
  }
  for (const p of problems) console.log(`   PROBLEM: ${p}`);
  if (problems.length) failed = true;
  rows.push({ cfg, result: r, problems });
}
await evaluate('(() => { __sdfGame.setUpscale(null); return 1; })()');

const logged = await evaluate('(() => window.__upConsole ?? [])()').catch(() => []);
const bad = (logged ?? []).filter(([k, t]) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(String(t)) || k === 'error');
console.log(`\nconsole errors/shader warnings: ${bad.length}`);
for (const [k, t] of bad.slice(0, 8)) console.log(`  [${k}] ${String(t).slice(0, 300)}`);
if (bad.some(([, t]) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(String(t)))) failed = true;

writeFileSync(`${OUT}/parity.json`, JSON.stringify({ when: new Date().toISOString(), room: ROOM, dist: DIST, rows, console: bad }, null, 2));
console.log(`\n${failed ? 'G1-PARITY: FAIL' : 'G1-PARITY: PASS'}  (json: ${OUT}/parity.json)`);
process.exit(failed ? 1 : 0);
