// scripts/upscale4x-probe.mjs — offline 4x reconstruction experiment, step 0: FEASIBILITY PROBE.
//
// The question (owner, 2026-09-22): today the bodies march at 0.5 (400x300) and a trained 2x ESPCN
// (`t16-rgb`) reconstructs 800x600. If we marched at 0.25 (200x150 = a QUARTER of today's rays) and
// reconstructed 4x with a net that also sees the coarse march's DEPTH and NORMALS, would it match
// today's look? A lower march resolution is acceptable IF the reconstruction matches — so this is a
// purely visual question, and no engine work happens until the owner has seen frames.
//
// This script does NOT train anything. It answers the three questions that decide whether training
// is worth the capture + GPU time, on the SAME frozen frames:
//
//   1. REGISTRATION. Does a 0.25 march land on the 4x output grid the way 0.5 lands on the 2x grid?
//      If the coarse ray is not at the centre of its 4x4 output block, every downstream model is
//      learning to undo a shift and the dataset is wrong. Gated on linear DEPTH, not colour — the
//      same reason as G2 (upscale-registration.mjs): lit colour carries HDR highlights and sub-texel
//      detail whose in-block variance swamps the registration signal.
//
//   2. HEADROOM. How much worse is 0.25 than 0.5 *before* any network — i.e. the naive-bilinear
//      floor of each against the 16x supersampled truth. The gap between those two floors is what a
//      4x model has to make up; today's shipped t16 output sits somewhere above the 0.5 floor.
//
//   3. THE HARD PIXELS. What fraction of output pixels are SILHOUETTE (their 4x4 block is partly
//      flesh, partly not)? Those are the ones a sparse re-march would have to pay for, so this
//      number is the budget for the "silhouettes get a real ray" half of the proposal. Measured at
//      both 2x and 4x, because the 2x number is the one we already ship with.
//
// It also writes eyeball PNGs per frame (truth / 0.5-bilinear / 0.25-bilinear, plus a coarse-input
// view) so the owner can see what is actually lost at 0.25 before anyone trains a model.
//
// Usage:
//   LAB_VITE_PORT=5321 LAB_CDP_PORT=9321 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale4x-probe.mjs'
// Env: U4_OUT (default .lab-tmp/upscale4x), U4_VIEWS (default 6), U4_GRID (supersample grid, 4 = 16 samples).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writePng } from './lib/png-write.mjs';
import { bootCapturePage, readMarchNormals, readRefine, renderAt, stageBody } from './lib/upscale-capture.mjs';
import { stampMeleeWounds, woundPlan } from './lib/sdf-melee-stage.mjs';

// U4_WOUNDS=1: stamp wounds on each staged body (once per body, from the first view that frames it) so
// the splice preview can show how wounds read. Wounds are irreversible, so this writes to its own dir.
const WOUNDS = process.env.U4_WOUNDS === '1';
const woundedBodies = new Set();

const VITE = Number(process.env.LAB_VITE_PORT ?? 5321);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9321);
const OUT = process.env.U4_OUT ?? (process.env.U4_WOUNDS === '1' ? '.lab-tmp/upscale4x-wounded' : '.lab-tmp/upscale4x');
const GRID = Number(process.env.U4_GRID ?? 4);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => fail('watchdog 2 h'), 2 * 3600_000).unref();
mkdirSync(OUT, { recursive: true });

// A spread the owner would recognise: close-up melee range through room distance, a couple of rooms.
// Close distances first — the close-up march is what this whole perf line is about.
const VIEWS = [
  { room: 1, dist: 0.9, orbit: 0.0, pitchUp: 0.25 },
  { room: 1, dist: 1.4, orbit: 1.1, pitchUp: 0.2 },
  { room: 1, dist: 2.5, orbit: 0.0, pitchUp: 0.2 },
  { room: 2, dist: 1.2, orbit: -0.8, pitchUp: 0.22 },
  { room: 2, dist: 3.5, orbit: 2.0, pitchUp: 0.15 },
  { room: 4, dist: 5.0, orbit: 0.5, pitchUp: 0.1 },
].slice(0, Number(process.env.U4_VIEWS ?? 6));

const decodeF32 = (b64) => { const c = Buffer.from(Buffer.from(b64, 'base64')); return new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4); };
const isFlesh = (img, x, y) => img.data[(y * img.w + x) * 4 + 3] < 1;
const linearDepth = (clip, near, far) => (near * far) / (far - clip * (far - near));

/**
 * registerHalfRes generalised to an arbitrary integer factor (the shared one is hard-coded 2x and is
 * gated by G2, so it is left alone). Same idea: an aligned coarse ray for texel (x, y) passes through
 * the centre of its f x f output block, so its value should match that block's mean; shifting the
 * block worsens the match, and a quadratic through the 3x3 errors around (0, 0) gives sub-pixel.
 * Only INTERIOR texels count (the whole window every candidate shift reads is flesh in the truth),
 * so silhouette aliasing cannot enter and every shift is scored on the same texels.
 */
function registerFactor(lr, hr, { factor, radius = 2, near, far }) {
  if (hr.w !== factor * lr.w || hr.h !== factor * lr.h) throw new Error(`registerFactor: ${hr.w}x${hr.h} is not ${factor}x ${lr.w}x${lr.h}`);
  const texels = [];
  for (let y = 0; y < lr.h; y++) {
    for (let x = 0; x < lr.w; x++) {
      if (!isFlesh(lr, x, y)) continue;
      const X0 = factor * x - radius, X1 = factor * x + factor - 1 + radius;
      const Y0 = factor * y - radius, Y1 = factor * y + factor - 1 + radius;
      if (X0 < 0 || Y0 < 0 || X1 >= hr.w || Y1 >= hr.h) continue;
      let interior = true;
      for (let Y = Y0; Y <= Y1 && interior; Y++) for (let X = X0; X <= X1 && interior; X++) if (!isFlesh(hr, X, Y)) interior = false;
      if (interior) texels.push([x, y]);
    }
  }
  const mse = [];
  for (let oy = -radius; oy <= radius; oy++) {
    const row = [];
    for (let ox = -radius; ox <= radius; ox++) {
      let sum = 0;
      for (const [x, y] of texels) {
        let block = 0;
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            const X = factor * x + dx + ox, Y = factor * y + dy + oy;
            block += linearDepth(hr.data[(Y * hr.w + X) * 4 + 3], near, far);
          }
        }
        const d = linearDepth(lr.data[(y * lr.w + x) * 4 + 3], near, far) - block / (factor * factor);
        sum += d * d;
      }
      row.push(texels.length ? sum / texels.length : NaN);
    }
    mse.push(row);
  }
  // argmin, then a separable quadratic through its 3 neighbours for the sub-pixel offset (in COARSE
  // texels; multiply by `factor` for output px).
  let best = { ox: 0, oy: 0, v: Infinity };
  for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
    const v = mse[oy + radius][ox + radius];
    if (v < best.v) best = { ox, oy, v };
  }
  const vertex = (a, b, c) => (Number.isFinite(a) && Number.isFinite(c) && a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0);
  const gi = best.oy + radius, gj = best.ox + radius;
  const sx = gj > 0 && gj < 2 * radius ? vertex(mse[gi][gj - 1], mse[gi][gj], mse[gi][gj + 1]) : 0;
  const sy = gi > 0 && gi < 2 * radius ? vertex(mse[gi - 1][gj], mse[gi][gj], mse[gi + 1][gj]) : 0;
  return { texels: texels.length, argmin: { ox: best.ox, oy: best.oy }, subpixelOutputPx: { x: best.ox + sx, y: best.oy + sy }, mse };
}

/** Bilinear upsample of a coarse RGBA march to factor*size, sampling at output-pixel centres
 *  (the destination-centre -> source-grid mapping the composite's sharp-bilinear path uses).
 *  Alpha (clip depth) is carried from the NEAREST coarse texel, never averaged: a mean depth is a
 *  surface that exists nowhere. */
function bilinearUp(lr, factor) {
  const w = lr.w * factor, h = lr.h * factor, data = new Float32Array(w * h * 4);
  for (let Y = 0; Y < h; Y++) {
    const sy = (Y + 0.5) / factor - 0.5, y0 = Math.floor(sy), fy = sy - y0;
    for (let X = 0; X < w; X++) {
      const sx = (X + 0.5) / factor - 0.5, x0 = Math.floor(sx), fx = sx - x0;
      const cl = (v, m) => Math.min(Math.max(v, 0), m - 1);
      const px = [cl(x0, lr.w), cl(x0 + 1, lr.w)], py = [cl(y0, lr.h), cl(y0 + 1, lr.h)];
      // COVERAGE-AWARE: a miss texel holds the clear colour, not black, so only flesh taps blend
      // into a flesh pixel and a miss pixel is black (the network's rgb*hit convention, and what
      // the truth stores). Without this every silhouette gets a pale clear-colour halo.
      const nx = cl(Math.round(sx), lr.w), ny = cl(Math.round(sy), lr.h);
      const ownA = lr.data[(ny * lr.w + nx) * 4 + 3];
      data[(Y * w + X) * 4 + 3] = ownA;
      if (ownA >= 1) continue;
      const taps = [[px[0], py[0], (1 - fx) * (1 - fy)], [px[1], py[0], fx * (1 - fy)], [px[0], py[1], (1 - fx) * fy], [px[1], py[1], fx * fy]];
      let ws = 0;
      for (const [tx, ty, wt] of taps) {
        const k = (ty * lr.w + tx) * 4;
        if (lr.data[k + 3] >= 1) continue;
        ws += wt;
        for (let c = 0; c < 3; c++) data[(Y * w + X) * 4 + c] += wt * lr.data[k + c];
      }
      for (let c = 0; c < 3; c++) data[(Y * w + X) * 4 + c] /= ws || 1;
    }
  }
  return { w, h, data };
}

/** Depth-aware (joint-bilateral) upsample — the non-neural baseline (idea #6, 2026-09-22). Each
 *  output pixel blends the 4x4 nearest coarse texels, weighted by spatial distance AND by how close
 *  each texel's linear depth is to the nearest texel's, so colour does not bleed across depth edges
 *  (silhouettes, limb-over-torso). Non-flesh texels never contribute to a flesh pixel. Coverage and
 *  depth come from the nearest texel, as in bilinearUp. */
function bilateralUp(lr, factor, near, far, sigmaDepthM = 0.03) {
  const w = lr.w * factor, h = lr.h * factor, data = new Float32Array(w * h * 4);
  const cl = (v, m) => Math.min(Math.max(v, 0), m - 1);
  for (let Y = 0; Y < h; Y++) {
    const sy = (Y + 0.5) / factor - 0.5;
    for (let X = 0; X < w; X++) {
      const sx = (X + 0.5) / factor - 0.5;
      const nx = cl(Math.round(sx), lr.w), ny = cl(Math.round(sy), lr.h), ni = (ny * lr.w + nx) * 4;
      const o = (Y * w + X) * 4;
      data[o + 3] = lr.data[ni + 3];
      const flesh = lr.data[ni + 3] < 1;
      const d0 = flesh ? linearDepth(lr.data[ni + 3], near, far) : 0;
      let wr = 0, r = 0, g = 0, b = 0;
      for (let j = Math.floor(sy) - 1; j <= Math.floor(sy) + 2; j++) {
        for (let i = Math.floor(sx) - 1; i <= Math.floor(sx) + 2; i++) {
          const k = (cl(j, lr.h) * lr.w + cl(i, lr.w)) * 4;
          const kFlesh = lr.data[k + 3] < 1;
          if (kFlesh !== flesh) continue;
          const ds = (i - sx) ** 2 + (j - sy) ** 2;
          let wt = Math.exp(-ds / 0.8);
          if (flesh) { const dd = linearDepth(lr.data[k + 3], near, far) - d0; wt *= Math.exp(-(dd * dd) / (2 * sigmaDepthM * sigmaDepthM)); }
          wr += wt; r += wt * lr.data[k]; g += wt * lr.data[k + 1]; b += wt * lr.data[k + 2];
        }
      }
      if (!flesh) continue; // miss pixel: black, as in the truth
      if (wr > 0) { data[o] = r / wr; data[o + 1] = g / wr; data[o + 2] = b / wr; }
      else { data[o] = lr.data[ni]; data[o + 1] = lr.data[ni + 1]; data[o + 2] = lr.data[ni + 2]; }
    }
  }
  return { w, h, data };
}

/** Tonemap + gamma so the three eyeball PNGs are comparable, and so PSNR is measured in roughly the
 *  space the owner judges in — the march target is lit LINEAR rgb with highlights up to ~28, where a
 *  raw-linear PSNR is dominated by a handful of specular pixels nobody looks at. */
const toneByte = (v) => {
  const t = v / (1 + v);
  return Math.min(255, Math.max(0, Math.round(255 * Math.pow(t, 1 / 2.2))));
};
function toPng(img) {
  const px = new Uint8Array(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) {
    const hit = img.data[i * 4 + 3] < 1;
    for (let c = 0; c < 3; c++) px[i * 4 + c] = hit ? toneByte(img.data[i * 4 + c]) : 0;
    px[i * 4 + 3] = 255;
  }
  return px;
}

/** PSNR in tonemapped 0..1, over a mask (null = every pixel). */
function psnr(a, b, mask) {
  let se = 0, n = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    if (mask && !mask[i]) continue;
    const ha = a.data[i * 4 + 3] < 1, hb = b.data[i * 4 + 3] < 1;
    for (let c = 0; c < 3; c++) {
      const d = (ha ? toneByte(a.data[i * 4 + c]) : 0) / 255 - (hb ? toneByte(b.data[i * 4 + c]) : 0) / 255;
      se += d * d;
    }
    n += 3;
  }
  return n ? 10 * Math.log10(1 / (se / n)) : NaN;
}

/** Per output pixel: is its factor x factor coarse-aligned block a SILHOUETTE block in the truth
 *  (partly flesh, partly not)? Returns { mask, frac } over the whole frame, and the flesh mask. */
function silhouette(hr, factor) {
  const n = hr.w * hr.h, mask = new Uint8Array(n), flesh = new Uint8Array(n);
  let sil = 0, fl = 0;
  const bw = hr.w / factor, bh = hr.h / factor;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let hit = 0;
      for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) if (isFlesh(hr, factor * bx + dx, factor * by + dy)) hit++;
      const mixed = hit > 0 && hit < factor * factor;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = (factor * by + dy) * hr.w + factor * bx + dx;
          if (mixed) { mask[i] = 1; sil++; }
          if (isFlesh(hr, factor * bx + dx, factor * by + dy)) { flesh[i] = 1; fl++; }
        }
      }
    }
  }
  return { mask, flesh, frac: sil / n, fleshFrac: fl / n };
}

// ---- boot -----------------------------------------------------------------
const { evaluate } = await bootCapturePage({ vite: VITE, cdp: CDP, fail, query: 'frozen=1&vhs=off&upscale=0&upscalenormals=1&refine=1' });
const { near, far } = await evaluate('__sdfGame.upscaleInfo()');
console.log(`near ${near} far ${far}`);
// Temporal ray start makes the march converge asymptotically, so reads at two scales of the "same"
// frame are not comparable. G2 turns it off for exactly this; do it up front rather than on failure.
await evaluate('(() => { __sdfGame.setTemporalStart(false); return 1; })()');
// The refine pass is band-gated to 1.5-3.5 m in the game (run 5b); open it to every distance so the
// interior-ceiling column exists for the close-up views too.
await evaluate('(() => { __sdfGame.setRefineBand({ near: 0, far: 1000 }); return 1; })()');

async function readSupersampled() {
  await evaluate(`(() => { __sdfGame.setUpscale(null); __sdfGame.setFieldStyle('off'); __sdfGame.setSdfScale(1.0); __sdfGame.step(4); return 1; })()`);
  // The TRUTH has no hit tolerance (owner 2026-09-22: a perf side-effect, not the look). Before this
  // the truth was fattened by it and every tolerance-off leg read as 'missing' 3-6 % of the body.
  await setAaLeg('off', 1.0);
  const r = await evaluate(`__sdfGameDebug.readSupersampledTarget(${GRID})`, 900_000);
  await setAaLeg('ship', 1.0);
  return { w: r.w, h: r.h, data: decodeF32(r.target) };
}

const cover = (img) => { let n = 0; for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4 + 3] < 1) n++; return n; };

/**
 * A SETTLED read: render twice at the same scale and require the coverage to agree and to be
 * non-empty. WHY THIS EXISTS — the dispatch-a-frame-then-read-it-back pattern races three's async
 * render submission under load and hands back the LAST LANDED frame, which is all-zero shortly after
 * boot (the standing warning on sdf-closeup-stage.mjs; it broke march-hash for two days). The first
 * run of this probe hit it with another session's vitest on the machine: every view came back with
 * zero flesh and an identical PSNR, which is the signature of constant frames. A probe that reports
 * 0 instead of failing is worse than one that crashes, so this asserts rather than warns.
 */
// HALO TEST (2026-09-22). The accept tolerance is t * aaCfg.x * strength, with aaCfg.x = ONE MARCH
// PIXEL (applySdfScale refreshes it) and strength = GAME_AA 1 far / GAME_AA_NEAR 6 up close. At 0.25 a
// march pixel is 4 screen pixels, so a close-up ray accepts ~24 screen px of slack and the silhouette
// fattens into a pale rim. Legs: 'ship' as shipped; 'screen' scales both strengths by the scale (the
// tolerance becomes one SCREEN pixel, identical to multiplying aaCfg.x); 'off' = footprint accept off
// (the 1.2 mm literal). Every render restores ship after itself.
const AA_SHIP = { far: 1, near: 6, fadeM: 3 };
async function setAaLeg(leg, scale) {
  const m = leg === 'screen' ? scale : leg === 'off' ? 0 : 1;
  await evaluate(`(() => { __sdfGame.setAa(${AA_SHIP.far * m}); __sdfGame.setAaDistance(${AA_SHIP.near * m}, ${AA_SHIP.fadeM}); return 1; })()`);
}
async function settledRender(scale, label, leg = 'ship') {
  let prev = -1;
  for (let attempt = 0; attempt < 8; attempt++) {
    await evaluate(`(() => { __sdfGame.setUpscale(null); __sdfGame.setFieldStyle('off'); __sdfGame.setSdfScale(${scale}); return 1; })()`);
    await setAaLeg(leg, scale);
    const img = await renderAt(evaluate, scale);
    await setAaLeg('ship', scale);
    const n = cover(img);
    if (n > 200 && n === prev) return img;
    prev = n;
  }
  fail(`${label}: march at scale ${scale} never settled on a non-empty frame (last coverage ${prev} texels) — machine under load? see the stale-frame warning in scripts/lib/sdf-closeup-stage.mjs`);
}

const rows = [];
for (const [i, view] of VIEWS.entries()) {
  const tag = `v${i}-r${view.room}-d${view.dist}`;
  console.log(`\n=== ${tag} ===`);
  const staged = await stageBody(evaluate, fail, view, view.pitchUp);
  if (WOUNDS && !woundedBodies.has(staged.body)) {
    await evaluate('(() => { __sdfGame.setRenderLock(false); return 1; })()');
    const w = await stampMeleeWounds(evaluate, woundPlan(1, 5), { ids: [staged.body] }, fail);
    console.log(`wounds on body ${staged.body}: ${w.landed}/${w.planned} landed${w.severed ? ' (severed a limb)' : ''}`);
    woundedBodies.add(staged.body);
    await stageBody(evaluate, fail, view, view.pitchUp); // re-frame: the stamp moved the camera
  }

  const lr4 = await settledRender(0.25, tag);
  if (lr4.w !== 200 || lr4.h !== 150) fail(`0.25 march is ${lr4.w}x${lr4.h}, expected 200x150`);
  const lr4screen = await settledRender(0.25, tag, 'screen');
  const lr4off = await settledRender(0.25, tag, 'off');
  const lr2screen = await settledRender(0.5, tag, 'screen');
  // Owner 2026-09-22: the hit tolerance is a perf side-effect — quality legs run with it OFF.
  const lr2off = await settledRender(0.5, tag, 'off');
  const lr35off = await settledRender(0.35, tag, 'off');
  console.log(`0.35 march is ${lr35off.w}x${lr35off.h}`);
  // SPLICE PREVIEW (2026-09-22): a native single-ray full-res march (tolerance off) = what an in-engine
  // refine would give the hard pixels, plus the head / wound screen circles to build the face mask.
  const lr1off = await settledRender(1.0, tag, 'off');
  // Part IDs for the splice's material-boundary mask: march debug mode 11 returns
  // (hitSlot, foldDistort, hitBest, band) in rgba instead of colour. Read at both coarse scales with the
  // tolerance off, the same state as lr35off / lr4off; the hit mask still comes from those reads.
  const readIds = async (scale) => {
    await setAaLeg('off', scale);
    await evaluate('(() => { __sdfGame.setMarchDebugMode(11); return 1; })()');
    try { return await renderAt(evaluate, scale); } finally {
      await evaluate('(() => { __sdfGame.setMarchDebugMode(0); return 1; })()');
      await setAaLeg('ship', scale);
    }
  };
  const id35 = await readIds(0.35), id25 = await readIds(0.25);
  // INTERIOR CEILING (idea 3): the run-5 refine pass takes depth from the CURRENT march grid, Newton-
  // refines per OUTPUT pixel and shades at output res. At 0.25 that is 'coarse geometry, full-res
  // shading'. c.rgb = re-lit colour, c.w = clip depth (accepted where < 1). Tolerance off, as the rest.
  const readRefined = async (scale) => {
    await settledRender(scale, tag, 'off');
    await setAaLeg('off', scale);
    await evaluate('(() => { __sdfGame.setRefine(true); return 1; })()');
    try { await renderAt(evaluate, scale); return (await readRefine(evaluate)).c; } finally {
      await evaluate('(() => { __sdfGame.setRefine(false); return 1; })()');
      await setAaLeg('ship', scale);
    }
  };
  const ref25 = await readRefined(0.25), ref35 = await readRefined(0.35);
  const refCover = (img) => { let n = 0; for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4 + 3] < 1) n++; return n; };
  console.log(`refine accepted px: 0.25 -> ${refCover(ref25)}  0.35 -> ${refCover(ref35)}  (${ref25.w}x${ref25.h})`);
  const annotations = await evaluate('__sdfGame.captureAnnotations(800, 600)');
  writeFileSync(join(OUT, `${tag}-annotations.json`), JSON.stringify(annotations));
  const nrm4 = await readMarchNormals(evaluate); // proves the coarse normals/depth the model would eat exist at 0.25
  const lr2 = await settledRender(0.5, tag);
  if (lr2.w !== 400 || lr2.h !== 300) fail(`0.5 march is ${lr2.w}x${lr2.h}, expected 400x300`);
  const gt = await readSupersampled();
  if (gt.w !== 800 || gt.h !== 600) fail(`target is ${gt.w}x${gt.h}, expected 800x600`);

  const sil4 = silhouette(gt, 4), sil2 = silhouette(gt, 2);
  // The truth must contain the same body the coarse reads saw. A supersampled target that came back
  // empty (or wildly smaller than the 0.5 read predicts) is the stale-frame race, not a framing miss.
  const expect = 4 * cover(lr2);
  if (!(sil4.fleshFrac > 0)) fail(`${tag}: supersampled target has no flesh (coarse 0.5 read had ${cover(lr2)} texels) — stale frame`);
  if (sil4.fleshFrac * gt.w * gt.h < 0.5 * expect) fail(`${tag}: target flesh ${Math.round(sil4.fleshFrac * gt.w * gt.h)} px vs ~${expect} expected from the 0.5 read — frames disagree`);
  const up4 = bilinearUp(lr4, 4), up2 = bilinearUp(lr2, 2), bil4 = bilateralUp(lr4, 4, near, far);
  const reg4 = registerFactor(lr4, gt, { factor: 4, near, far });
  const reg2 = registerFactor(lr2, gt, { factor: 2, near, far });

  const row = {
    tag, view,
    coarseNormals: { w: nrm4.w, h: nrm4.h },
    coverage: { fleshFrac: sil4.fleshFrac, silhouetteFrac4x: sil4.frac, silhouetteFrac2x: sil2.frac },
    // The silhouette fraction OF THE BODY is the number that sizes a sparse re-march, since only
    // flesh blocks are marched at all.
    silhouetteShareOfFlesh: { at4x: sil4.frac / (sil4.fleshFrac || 1), at2x: sil2.frac / (sil2.fleshFrac || 1) },
    registration: {
      from025: { texels: reg4.texels, argmin: reg4.argmin, subpixelOutputPx: reg4.subpixelOutputPx },
      from05: { texels: reg2.texels, argmin: reg2.argmin, subpixelOutputPx: reg2.subpixelOutputPx },
    },
    bilinearFloorPsnrDb: {
      from025: { all: psnr(up4, gt, null), flesh: psnr(up4, gt, sil4.flesh), silhouette: psnr(up4, gt, sil4.mask) },
      from05: { all: psnr(up2, gt, null), flesh: psnr(up2, gt, sil2.flesh), silhouette: psnr(up2, gt, sil2.mask) },
      from025DepthAware: { all: psnr(bil4, gt, null), flesh: psnr(bil4, gt, sil4.flesh), silhouette: psnr(bil4, gt, sil4.mask) },
    },
  };
  rows.push(row);
  console.log(JSON.stringify(row, null, 2));

  writeFileSync(join(OUT, `${tag}-truth.png`), writePng(gt.w, gt.h, toPng(gt)));
  writeFileSync(join(OUT, `${tag}-from05-bilinear.png`), writePng(up2.w, up2.h, toPng(up2)));
  writeFileSync(join(OUT, `${tag}-from025-bilinear.png`), writePng(up4.w, up4.h, toPng(up4)));
  writeFileSync(join(OUT, `${tag}-from025-depthaware.png`), writePng(bil4.w, bil4.h, toPng(bil4)));
  const up4s = bilinearUp(lr4screen, 4), up4o = bilinearUp(lr4off, 4), up2s = bilinearUp(lr2screen, 2);
  row.haloPsnrDb = {
    from025: { ship: row.bilinearFloorPsnrDb.from025, screen: { flesh: psnr(up4s, gt, sil4.flesh), silhouette: psnr(up4s, gt, sil4.mask) }, off: { flesh: psnr(up4o, gt, sil4.flesh), silhouette: psnr(up4o, gt, sil4.mask) } },
    from05: { ship: row.bilinearFloorPsnrDb.from05, screen: { flesh: psnr(up2s, gt, sil2.flesh), silhouette: psnr(up2s, gt, sil2.mask) } },
  };
  row.coverageTexels = { gtPx: Math.round(sil4.fleshFrac * gt.w * gt.h), lr4ship: cover(lr4) * 16, lr4screen: cover(lr4screen) * 16, lr4off: cover(lr4off) * 16, lr2ship: cover(lr2) * 4, lr2screen: cover(lr2screen) * 4, lr2off: cover(lr2off) * 4, lr35off: Math.round(cover(lr35off) * (gt.w * gt.h) / (lr35off.w * lr35off.h)) };
  console.log('halo', JSON.stringify(row.coverageTexels));
  writeFileSync(join(OUT, `${tag}-from025-screenaa.png`), writePng(up4s.w, up4s.h, toPng(up4s)));
  writeFileSync(join(OUT, `${tag}-from025-aaoff.png`), writePng(up4o.w, up4o.h, toPng(up4o)));
  writeFileSync(join(OUT, `${tag}-from05-screenaa.png`), writePng(up2s.w, up2s.h, toPng(up2s)));
  // Raw float dumps for offline reconstruction (t16 via the CPU reference; later the 4x model).
  for (const [k, img] of Object.entries({ ref25, ref35, id35, id25, lr2, lr2screen, lr2off, lr35off, lr1off, lr4, lr4screen, lr4off, gt })) writeFileSync(join(OUT, `${tag}-${k}.f32`), Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength));
  writeFileSync(join(OUT, `${tag}-coarse025.png`), writePng(lr4.w, lr4.h, toPng(lr4)));
}

writeFileSync(join(OUT, 'probe.json'), JSON.stringify({ near, far, grid: GRID, rows }, null, 2));
const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
console.log('\n=== SUMMARY over', rows.length, 'views ===');
console.log(`bilinear floor vs 16x truth (tonemapped PSNR dB, flesh only): 0.5 -> ${mean((r) => r.bilinearFloorPsnrDb.from05.flesh).toFixed(2)}   0.25 -> ${mean((r) => r.bilinearFloorPsnrDb.from025.flesh).toFixed(2)}   0.25 depth-aware -> ${mean((r) => r.bilinearFloorPsnrDb.from025DepthAware.flesh).toFixed(2)}`);
console.log(`silhouette share of body pixels: 2x ${(100 * mean((r) => r.silhouetteShareOfFlesh.at2x)).toFixed(1)} %   4x ${(100 * mean((r) => r.silhouetteShareOfFlesh.at4x)).toFixed(1)} %`);
console.log(`registration sub-pixel (output px) from 0.25: x ${mean((r) => r.registration.from025.subpixelOutputPx.x).toFixed(3)} y ${mean((r) => r.registration.from025.subpixelOutputPx.y).toFixed(3)}`);
console.log(`registration sub-pixel (output px) from 0.5 : x ${mean((r) => r.registration.from05.subpixelOutputPx.x).toFixed(3)} y ${mean((r) => r.registration.from05.subpixelOutputPx.y).toFixed(3)}`);
console.log(`frames in ${OUT}`);
// The CDP websocket keeps the event loop alive: without this the probe never exits and anything
// chained after it (`&& npx tsx scripts/upscale4x-splice.ts`) silently never runs.
process.exit(0);
