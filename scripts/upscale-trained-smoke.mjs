// scripts/upscale-trained-smoke.mjs — GPU smoke for trained-model loading, G1 parity on trained
// weights, and the in-game A/B key (docs/superpowers/plans/2026-09-11-neural-upscale-p3c-ingame.md).
// Needs a model in the dev store first:
//   npx tsx scripts/upscale-make-test-model.ts          (seeded random weights, for the plumbing)
//   or copy a real export directory to .upscale-models/<name>/
// Usage:
//   UPSCALE_SMOKE_MODEL=test-s8-rgbd LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-trained-smoke.mjs'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyShipDefaults, bootCloseupPage, connectGame, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
const NAME = process.env.UPSCALE_SMOKE_MODEL ?? 'test-s8-rgbd';
const STORE = process.env.UPSCALE_MODELS_DIR ?? join(process.cwd(), '.upscale-models');
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => fail('watchdog 20 min'), 20 * 60_000).unref();
const expected = JSON.parse(readFileSync(join(STORE, NAME, 'model.json'), 'utf8'));
const problems = [];
const page = (q) => `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&${q}`;

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__upErrs = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__upErrs.push(a.map(String).join(' ')); e(...a); };
    console.warn = (...a) => { window.__upErrs.push(a.map(String).join(' ')); w(...a); };
  })()`,
});
const label = () => evaluate(`document.getElementById('upscale-ab')?.textContent ?? ''`);
const pressU = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, code: 'KeyU', key: 'u', windowsVirtualKeyCode: 85, nativeVirtualKeyCode: 85 });
  }
  await evaluate('(() => { __sdfGame.step(6); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  return { info: await evaluate('__sdfGame.upscaleInfo()'), ab: await evaluate('__sdfGame.upscaleAb()'), scale: await evaluate('__sdfGame.sdfScale'), text: await label() };
};

// 1. boot with ?upscale=trained
await bootCloseupPage({ send, evaluate, fail, url: page(`upscale=trained&upscalemodel=${NAME}`) });
let info = await evaluate('__sdfGame.upscaleInfo()');
if (!info.on) fail(`the trained model did not enable at boot: ${JSON.stringify(info)}; console: ${JSON.stringify(await evaluate('window.__upErrs'))}`);
const matches = (i) => i.on && i.source === 'trained' && i.model === expected.id && i.inputs === expected.inputs && i.weightHash === expected.weightHash;
if (!matches(info)) problems.push(`boot info does not match ${NAME}/model.json: ${JSON.stringify(info)}`);
if (!(info.inSize?.width === 400 && info.inSize?.height === 300 && info.outSize?.width === 800 && info.outSize?.height === 600)) {
  problems.push(`sizes: ${JSON.stringify(info)}`);
}
if (!(await label()).includes(NAME)) problems.push(`label does not name the model: "${await label()}"`);
const listed = await evaluate('__sdfGame.upscaleModels()');
if (!listed.some((m) => m.name === NAME && m.weightHash === expected.weightHash)) problems.push(`upscaleModels() does not list ${NAME}`);

// 2. G1 parity on the trained weights (thresholds and staging from scripts/upscale-parity.mjs)
await applyShipDefaults(evaluate);
await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
await evaluate('(() => { performance.now = () => 100000; return 1; })()');
let baked = false;
for (let i = 0; i < 240 && !baked; i++) {
  baked = (await evaluate('(() => __sdfGame.roomProbesReady())()')) === true;
  if (!baked) await sleep(500);
}
if (!baked) fail('roomProbesReady never landed');
info = await evaluate(`__sdfGame.setUpscale({ trained: ${JSON.stringify(NAME)} })`);
if (!matches(info)) problems.push(`async setUpscale({ trained }) info: ${JSON.stringify(info)}`);
const staged = await evaluate(`(() => {
  __sdfGame.teleport(1);
  const z = __sdfGame.zombies().find((q) => q.room === 1);
  if (!z) return { error: 'no body in room 1' };
  __sdfGame.freeze(true);
  const ex = z.pos[0], ez = z.pos[2] + 2.5;
  const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
  __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)), 0);
  __sdfGame.step(30);
  __sdfGame.setRenderLock(true);
  return { body: z.id };
})()`);
if (staged?.error) fail(staged.error);
const r = await evaluate('__sdfGame.upscaleSelfCheck({ compareLayouts: true })', 600_000);
if (r.weightHash !== expected.weightHash) problems.push(`self-check ran on ${r.weightHash}, not the trained ${expected.weightHash}`);
if (!r.marchStable) problems.push('march target changed between renders (render lock not holding)');
for (const g of r.gpuVsCpu) {
  if (g.covered < 1000) problems.push(`${g.layout}: only ${g.covered} covered pixels — the body is not in frame`);
  if (g.maxRelRgb > 2e-3) problems.push(`${g.layout}: GPU vs CPU rgb ${g.maxRelRgb.toExponential(2)} > 2e-3`);
  if (g.coverageMismatchFar > 0) problems.push(`${g.layout}: ${g.coverageMismatchFar} coverage mismatches outside the band`);
  if (g.depthMismatch > 0) problems.push(`${g.layout}: ${g.depthMismatch} depth mismatches`);
}
if (r.layouts.maxRelRgb > 2e-3) problems.push(`sp vs dc rgb ${r.layouts.maxRelRgb.toExponential(2)} > 2e-3`);
console.log(`self-check: ${JSON.stringify(r.gpuVsCpu)} sp-vs-dc ${JSON.stringify(r.layouts)}`);

// 3. the A/B key: model -> native -> nearest -> model
const native = await pressU();
if (native.ab.mode !== 'native' || native.info.on || native.scale !== 1 || !native.text.includes('native')) problems.push(`U #1 (native): ${JSON.stringify(native)}`);
const nearest = await pressU();
if (nearest.ab.mode !== 'nearest' || nearest.info.model !== 'zero' || nearest.scale !== 0.5 || !nearest.text.includes('nearest')) problems.push(`U #2 (nearest): ${JSON.stringify(nearest)}`);
const back = await pressU();
if (back.ab.mode !== 'model' || !matches(back.info) || back.scale !== 0.5 || !back.text.includes(NAME)) problems.push(`U #3 (model): ${JSON.stringify(back)}`);

// 4. a missing model: the seam rejects; at boot the stage stays off with a console error
let rejected = false;
try { await evaluate(`__sdfGame.setUpscale({ trained: 'no-such-model' })`); } catch { rejected = true; }
if (!rejected) problems.push('setUpscale({ trained: "no-such-model" }) did not reject');
const shaderErrors = (await evaluate('window.__upErrs')).filter((t) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(t));
if (shaderErrors.length) problems.push(`${shaderErrors.length} shader console errors: ${shaderErrors[0].slice(0, 200)}`);
await bootCloseupPage({ send, evaluate, fail, url: page('upscale=trained&upscalemodel=no-such-model') });
const off = await evaluate('__sdfGame.upscaleInfo()');
const errs = await evaluate('window.__upErrs');
if (off.on) problems.push('a missing model at boot left the stage on');
if (!errs.some((t) => t.includes('not loaded'))) problems.push(`a missing model at boot logged no "not loaded" error: ${JSON.stringify(errs.slice(0, 3))}`);

for (const p of problems) console.log(`PROBLEM: ${p}`);
console.log(problems.length ? 'SMOKE: FAIL' : 'SMOKE: PASS');
process.exit(problems.length ? 1 : 0);
