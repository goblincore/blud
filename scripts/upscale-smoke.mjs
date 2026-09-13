// scripts/upscale-smoke.mjs — compile smoke for the neural upscale stage: boots the
// game page with ?upscale flags and fails on any TSL/WGSL/pipeline console error.
// Usage:
//   LAB_VITE_PORT=5310 LAB_CDP_PORT=9310 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-smoke.mjs'
import { connectGame, bootCloseupPage } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5310);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9310);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => fail('watchdog 15 min'), 15 * 60_000).unref();

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__upErrs = [];
    const e = console.error, w = console.warn;
    console.error = (...a) => { window.__upErrs.push(a.map(String).join(' ')); e(...a); };
    console.warn = (...a) => { window.__upErrs.push(a.map(String).join(' ')); w(...a); };
  })()`,
});
const QUERIES = [
  'upscale=zero',
  'upscale=s8',
  'upscale=s16&upscalelayout=sp&upscaleinputs=rgbd',
  'upscale=s32&upscalelayout=dc&upscaleinputs=rgbd',
  // Runtime normals (2026-09-12): the march's second attachment feeds the first pass.
  'upscale=s8&upscaleinputs=rgbn',
  'upscale=s64d&upscalelayout=sp&upscaleinputs=rgbdn',   // dc is refused at 64 wide (17 textures)
  'upscale=t16&upscaleinputs=rgbn',   // dilated 3-layer ladder (run 3)
  'upscale=s8&upscaleinputs=rgbn&upscalehead=1',   // run-4 full-res head (H1/H2 over the detail field)
  'upscale=s8&upscalesharpen=0.5',   // post-sharpen pass (UPSCALE_SHARPEN_WGSL)
  'upscale=s8&upscalesharpen=1.5&upscalesharpenmode=unsharp',
];
let bad = false;
for (const q of QUERIES) {
  await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&${q}` });
  await evaluate('(() => { __sdfGame.step(12); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  const info = await evaluate('__sdfGame.upscaleInfo()');
  const errs = (await evaluate('window.__upErrs')).filter((t) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(t));
  console.log(`${q}\n  info ${JSON.stringify(info)}\n  shader errors: ${errs.length}`);
  for (const t of errs.slice(0, 5)) console.log(`    ${t.slice(0, 300)}`);
  const ok = info.on
    && info.inSize?.width === 400 && info.inSize?.height === 300
    && info.outSize?.width === 800 && info.outSize?.height === 600
    && errs.length === 0;
  if (!ok) bad = true;
}
console.log(bad ? 'SMOKE: FAIL' : 'SMOKE: PASS');
process.exit(bad ? 1 : 0);
