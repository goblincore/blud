// scripts/refine-smoke.mjs — run-5 refine smoke + Gate-1 look.
//
// Boots the game frozen at `?frozen=1&vhs=off&upscale=0&refine=1`, stages the
// standard close-up (room 1, ship defaults, the same wall-clock/probe pins
// scripts/march-hash.mjs applies for a deterministic frame), turns the refine
// pass on, and reads BOTH refine attachments plus the low-res march target.
//
// Checks (each one FAILs loudly — do not loosen to make it pass):
//   * accepted > 0                  — the pass wrote something (c.w < 1 accepts)
//   * outsideHit === 0              — every accepted output texel's march texel
//                                     (x>>1, y>>1), or one of its 8 neighbours,
//                                     is itself a hit (m.w < 1); an accepted
//                                     pixel away from the marched body means the
//                                     refine twins are drawing where the march
//                                     found nothing. `strictOutside` (reported,
//                                     not gated) is the same count without the
//                                     one-texel silhouette allowance — the
//                                     half-res march necessarily misses the rim
//                                     the output-res twins recover.
//   * badNormal <= accepted*0.001   — accepted world normals are unit length
//   * nonFinite === 0               — accepted rgb is finite
//
// Pictures (into $REFINE_SMOKE_OUT, default .lab-tmp/refine-smoke):
//   refine-c.png            accepted: linear rgb -> gamma 1/2.2 -> 8-bit; rejected dark blue
//   refine-n.png            world normal, n*0.5+0.5
//   frame-refine-view.png   the presented frame with setRefineView(true) — the Gate-1 picture
//   frame-shipped.png       the same frame with the refine view off
//
// Output: one JSON line, any PROBLEM lines, then `REFINE SMOKE: PASS|FAIL`.
// Env: LAB_VITE_PORT / LAB_CDP_PORT (default 5325 / 9325), REFINE_SMOKE_OUT.
// Run inside lab-servers (see scripts/lab-servers.sh).
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5325);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9325);
const OUT = process.env.REFINE_SMOKE_OUT ?? '.lab-tmp/refine-smoke';
const fail = (msg) => { console.error(`FAIL: ${msg}`); console.log('REFINE SMOKE: FAIL'); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 6 min'); process.exit(3); }, 6 * 60_000).unref();

/** Minimal PNG encoder (rgb8, one IDAT). rgb: Uint8Array of w*h*3. */
function png(w, h, rgb) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, cc]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const floats = (blob) => { const b = Buffer.from(blob.rgba32f, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

mkdirSync(OUT, { recursive: true });

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({
  send, evaluate, fail,
  url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&upscale=0&refine=1`,
});
await applyShipDefaults(evaluate);
// Same deterministic-frame pins as scripts/march-hash.mjs: the dungeon flicker
// lights read performance.now() in the draw path, and the room probes run a
// temporal afterglow whose state depends on the frame count.
await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
// Fields OFF. The ship default 'bodies' interlaces the march target — at scale
// 0.5 on an 800x600 canvas it is 400x150, not 400x300, and its rows alternate
// parity per frame, so an output texel's march texel is NOT (x>>1, y>>1) and the
// coverage check below would be meaningless. The upscale stage forces fields off
// for the same reason; run 5 lives in that regime.
await evaluate("(() => { __sdfGame.setFieldStyle('off'); return __sdfGame.fieldStyle; })()");
const staged = await stageCloseUp(evaluate, { room: 1 }, fail);
await evaluate('(() => { __sdfGame.setSdfScale(0.5); return 1; })()');
const info = await evaluate('(() => { __sdfGame.setRefine(true); return __sdfGame.refineInfo(); })()');
if (!info || !info.allocated) fail(`refine not allocated by the boot: ${JSON.stringify(info)}`);
if (!info.on) fail(`setRefine(true) did not take: ${JSON.stringify(info)}`);
await evaluate('(() => { __sdfGame.step(6); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');

const refine = await evaluate('__sdfGameDebug.readRefine()', 180_000);
if (!refine) fail('readRefine() returned null — the layer allocated no refine target');
const march = await evaluate('__sdfGameDebug.readMarchTarget()', 180_000);

const { c, n } = refine;
const cf = floats(c), nf = floats(n), mf = floats(march);
const w = c.w, h = c.h;
if (n.w !== w || n.h !== h) fail(`refine attachments disagree: c ${w}x${h} vs n ${n.w}x${n.h}`);
if (march.w * 2 !== w || march.h * 2 !== h) fail(`march target ${march.w}x${march.h} is not half of the refine target ${w}x${h} (fields on? sdfScale != 0.5?)`);

let accepted = 0, outsideHit = 0, strictOutside = 0, badNormal = 0, nonFinite = 0;
const rgbC = new Uint8Array(w * h * 3);
const rgbN = new Uint8Array(w * h * 3);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!(cf[i * 4 + 3] < 1)) { // rejected
      rgbC[i * 3] = 12; rgbC[i * 3 + 1] = 12; rgbC[i * 3 + 2] = 40;
      rgbN[i * 3] = 12; rgbN[i * 3 + 1] = 12; rgbN[i * 3 + 2] = 40;
      continue;
    }
    accepted++;
    // Coverage: the accepted texel's own march texel, or — the silhouette
    // allowance — any of its 8 neighbours. The half-res march necessarily
    // misses a thin rim the output-res refine twins rasterize, and recovering
    // exactly that rim is the point of the pass; what this check is for is
    // twins drawing in genuinely empty space, which is not one texel wide.
    const mx = x >> 1, my = y >> 1;
    if (!(mf[(my * march.w + mx) * 4 + 3] < 1)) {
      strictOutside++;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const jx = mx + dx, jy = my + dy;
          if (jx < 0 || jy < 0 || jx >= march.w || jy >= march.h) continue;
          if (mf[(jy * march.w + jx) * 4 + 3] < 1) { near = true; break; }
        }
      }
      if (!near) outsideHit++;
    }
    const nx = nf[i * 4], ny = nf[i * 4 + 1], nz = nf[i * 4 + 2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(Math.abs(len - 1) < 1e-3)) badNormal++;
    for (let k = 0; k < 3; k++) {
      const v = cf[i * 4 + k];
      if (!Number.isFinite(v)) nonFinite++;
      rgbC[i * 3 + k] = u8(Math.pow(Math.max(0, Number.isFinite(v) ? v : 0), 1 / 2.2));
    }
    rgbN[i * 3] = u8(nx * 0.5 + 0.5); rgbN[i * 3 + 1] = u8(ny * 0.5 + 0.5); rgbN[i * 3 + 2] = u8(nz * 0.5 + 0.5);
  }
}
writeFileSync(`${OUT}/refine-c.png`, png(w, h, rgbC));
writeFileSync(`${OUT}/refine-n.png`, png(w, h, rgbN));

// Gate-1 pictures: the refine view replaces the composite source, then off again.
await evaluate('(() => { __sdfGame.setRefineView(true); __sdfGame.step(2); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
writeFileSync(`${OUT}/frame-refine-view.png`, Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));
await evaluate('(() => { __sdfGame.setRefineView(false); __sdfGame.step(2); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
writeFileSync(`${OUT}/frame-shipped.png`, Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));

console.log(JSON.stringify({ staged, w, h, accepted, outsideHit, strictOutside, badNormal, nonFinite, out: OUT }));
const problems = [];
if (accepted === 0) problems.push('accepted === 0 — the refine pass wrote nothing');
if (outsideHit > 0) problems.push(`${outsideHit} accepted texels sit outside a march hit`);
if (badNormal > accepted * 0.001) problems.push(`${badNormal} non-unit accepted normals (> 0.1% of ${accepted})`);
if (nonFinite > 0) problems.push(`${nonFinite} non-finite accepted colour components`);
for (const p of problems) console.log(`PROBLEM: ${p}`);
console.log(problems.length ? 'REFINE SMOKE: FAIL' : 'REFINE SMOKE: PASS');
process.exit(problems.length ? 1 : 0);
