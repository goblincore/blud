// scripts/upscale-pairs-capture.mjs — paired frozen-frame capture for the neural upscale, P2 smoke
// format (docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md §7, gate G2). P3 capture v2
// is scripts/upscale-capture-v2.mjs; both share scripts/lib/upscale-capture.mjs.
//
// For each frame, ONE frozen simulation state is rendered twice:
//   input  = sdfScale 0.5, fields off -> march target 400x300 (rgb + clip depth)
//   target = sdfScale 1.0, fields off -> march target 800x600 (native progressive)
// setRenderLock(true) makes step(n) pure re-renders; the sim advances only between frames.
//
// Usage:
//   LAB_VITE_PORT=5313 LAB_CDP_PORT=9313 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-pairs-capture.mjs'
// Env: UPSCALE_OUT (default .upscale-data/<stamp>), UPSCALE_SEQS ("room:dist:orbit,..."),
//      UPSCALE_FRAMES (20), UPSCALE_ADVANCE (6 sim frames between captures), UPSCALE_PITCH_UP (0.2 rad),
//      UPSCALE_DUMP_CHECK=1 (save the frames the G2 checks score, for scripts/upscale-g2-diag.py)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeNpy } from './lib/npy.mjs';
import { bootCapturePage, coverage, renderAt, runG2Checks, stageBody } from './lib/upscale-capture.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5313);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9313);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = process.env.UPSCALE_OUT ?? `.upscale-data/${STAMP}`;
const SEQS = (process.env.UPSCALE_SEQS ?? '1:2.5:0,3:3.0:1.2,4:2.0:-0.8').split(',').map((s) => {
  const [room, dist, orbit] = s.split(':').map(Number);
  return { room, dist, orbit };
});
const FRAMES = Number(process.env.UPSCALE_FRAMES ?? 20);
const ADVANCE = Number(process.env.UPSCALE_ADVANCE ?? 6);
const PITCH_UP = Number(process.env.UPSCALE_PITCH_UP ?? 0.2);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 60 min'); process.exit(3); }, 60 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const { evaluate } = await bootCapturePage({ vite: VITE, cdp: CDP, fail });

// ---- G2 checks on the first staged frame -------------------------------------
const g2 = await runG2Checks(evaluate, fail, { seq: SEQS[0], pitchUp: PITCH_UP });
const { checks } = g2;
if (process.env.UPSCALE_DUMP_CHECK) {
  writeFileSync(`${OUT}/check-in.npy`, encodeNpy(g2.lr.data, [g2.lr.h, g2.lr.w, 4]));
  writeFileSync(`${OUT}/check-target.npy`, encodeNpy(g2.hr.data, [g2.hr.h, g2.hr.w, 4]));
}
console.log('G2 checks:', JSON.stringify(checks, null, 2));
if (g2.failures.length) {
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ created: new Date().toISOString(), checks, g2Failures: g2.failures, frames: [] }, null, 2));
  fail(`G2: ${g2.failures.join('; ')}`);
}
const { near, far } = checks.nearFar;

// ---- capture ---------------------------------------------------------------------
const checkout = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
const frames = [];
for (let s = 0; s < SEQS.length; s++) {
  const seq = SEQS[s];
  const staged = await stageBody(evaluate, fail, seq, 0);
  mkdirSync(`${OUT}/seq${s}`, { recursive: true });
  for (let f = 0; f < FRAMES; f++) {
    if (f > 0) {
      await evaluate(`(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.step(${ADVANCE}); __sdfGame.freeze(true); __sdfGame.setRenderLock(true); return 1; })()`);
    }
    const input = await renderAt(evaluate, 0.5);
    const target = await renderAt(evaluate, 1.0);
    const inPath = `seq${s}/frame${String(f).padStart(3, '0')}-in.npy`;
    const tgPath = `seq${s}/frame${String(f).padStart(3, '0')}-target.npy`;
    writeFileSync(`${OUT}/${inPath}`, encodeNpy(input.data, [input.h, input.w, 4]));
    writeFileSync(`${OUT}/${tgPath}`, encodeNpy(target.data, [target.h, target.w, 4]));
    const cov = coverage(input).frac;
    frames.push({ seq: s, frame: f, room: seq.room, body: staged.body, dist: seq.dist, orbit: seq.orbit, input: inPath, target: tgPath, inputCoverage: cov });
    process.stdout.write(`seq${s} frame ${f}: coverage ${(100 * cov).toFixed(2)}%${cov < 0.01 ? '  (WARN: body mostly out of frame)' : ''}\n`);
  }
}
await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.setSdfScale(1.0); __sdfGame.setFieldStyle("bodies"); return 1; })()');

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  created: new Date().toISOString(),
  spec: 'docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md',
  checkout,
  page: 'sdf-game.html?frozen=1&vhs=off',
  input: { w: 400, h: 300, sdfScale: 0.5, fieldStyle: 'off' },
  target: { w: 800, h: 600, sdfScale: 1.0, fieldStyle: 'off' },
  channels: ['r', 'g', 'b', 'clipDepth (>= 1.0 means no flesh)'],
  dtype: 'float32 little-endian, shape (H, W, 4)',
  rowOrder: 'row 0 = texel row 0 = top of the rendered image (verified by checks.orientation)',
  depth: 'WebGPU [0,1] clip depth; linear = near*far / (far - d*(far - near))',
  near, far,
  temporalStart: checks.temporalStart,
  content: 'flesh layer only, tracked public/assets/lab/* — no Blood placeholder assets',
  checks,
  frames,
}, null, 2));
console.log(`\nG2: PASS — ${frames.length} pairs in ${OUT}`);
process.exit(0);
