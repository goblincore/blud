// scripts/lib/upscale-capture.mjs — shared plumbing for the neural upscale captures:
// boot + pins, march readback, render-at-scale, body staging, and the G2 checks
// (docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md). Used by scripts/upscale-pairs-capture.mjs
// (P2 format) and scripts/upscale-capture-v2.mjs (P3 dataset v2).
import { applyShipDefaults, bootCloseupPage, connectGame, sleep } from './sdf-closeup-stage.mjs';
import { registerHalfRes } from './upscale-registration.mjs';

/** Connect, boot sdf-game.html, apply ship defaults and capture pins, wait for the probe bake. */
export async function bootCapturePage({ vite, cdp, fail, query = 'frozen=1&vhs=off' }) {
  const conn = await connectGame({ vite, cdp, width: 1280, height: 800, onFail: fail });
  const { send, evaluate } = conn;
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__capConsole = [];
      const e = console.error, w = console.warn;
      console.error = (...a) => { window.__capConsole.push(['error', a.map(String).join(' ')]); e(...a); };
      console.warn = (...a) => { window.__capConsole.push(['warn', a.map(String).join(' ')]); w(...a); };
    })()`,
  });
  await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${vite}/sdf-game.html?${query}` });
  await applyShipDefaults(evaluate);
  // Pin the probe gather to its per-frame estimate: its afterglow (blend 0.6, fall 0.12) makes the
  // march converge asymptotically, so render-locked reads would never be bit-stable (g1-parity.md).
  await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); __sdfGame.installDebugProbe(); return 1; })()');
  await evaluate('(() => { performance.now = () => 100000; return 1; })()');
  for (let i = 0; i < 240; i++) {
    if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) return conn;
    await sleep(500);
  }
  fail('roomProbesReady never landed');
  return conn;
}

/** The march target as { w, h, data: Float32Array } (row 0 = texel row 0). */
export async function readMarch(evaluate) {
  const r = await evaluate('__sdfGameDebug.readMarchTarget()', 300_000);
  const copy = Buffer.from(Buffer.from(r.rgba32f, 'base64'));
  return { w: r.w, h: r.h, data: new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4) };
}

/** Render the current (render-locked) state at an SDF scale, fields and upscale off, and read it. */
export async function renderAt(evaluate, scale) {
  await evaluate(`(() => { __sdfGame.setUpscale(null); __sdfGame.setFieldStyle('off'); __sdfGame.setSdfScale(${scale}); __sdfGame.step(4); return 1; })()`);
  await evaluate('__sdfGame.resolveGpu()');
  return readMarch(evaluate);
}

export const maxAbsDiff = (a, b) => {
  if (a.data.length !== b.data.length) return Infinity;
  let m = 0;
  for (let k = 0; k < a.data.length; k++) {
    const d = Math.abs(a.data[k] - b.data[k]);
    if (d > m) m = d;
  }
  return m;
};

export const coverage = (img) => {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] < 1) { n++; sx += x + 0.5; sy += y + 0.5; }
    }
  }
  return { n, frac: n / (img.w * img.h), cx: n ? sx / n : NaN, cy: n ? sy / n : NaN };
};

export const linear = (d, near, far) => (near * far) / (far - d * (far - near));

/** P2 staging: teleport to a room, pick its nearest body, frame it at seq.dist / seq.orbit. */
export async function stageBody(evaluate, fail, seq, pitchUp) {
  const r = await evaluate(`(async () => {
    __sdfGame.setRenderLock(false);
    __sdfGame.teleport(${seq.room});
    const z = __sdfGame.zombies().find(q => q.room === ${seq.room});
    if (!z) return { error: 'no body in room ${seq.room}' };
    __sdfGame.freeze(true);
    const d = ${seq.dist}, a = ${seq.orbit};
    const ex = z.pos[0] + Math.sin(a) * d, ez = z.pos[2] + Math.cos(a) * d;
    const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
    __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)) + ${pitchUp}, 0);
    __sdfGame.step(30);
    __sdfGame.setRenderLock(true);
    return { body: z.id, pose: [ex, ez] };
  })()`);
  if (r?.error) fail(r.error);
  return r;
}

/**
 * The G2 checks on one staged frame: determinism (with a temporal-start-off fallback), linear-depth
 * registration, coverage IoU, orientation (body staged below centre) and depth sanity.
 * Returns { checks, failures, lr, hr, temporalStartOff }.
 */
export async function runG2Checks(evaluate, fail, { seq = { room: 1, dist: 2.5, orbit: 0 }, pitchUp = 0.2 } = {}) {
  const checks = {};
  // Pitched UP so the body sits below screen centre, which the orientation check needs.
  await stageBody(evaluate, fail, seq, pitchUp);
  const { near, far } = await evaluate('__sdfGame.upscaleInfo()');
  checks.nearFar = { near, far };

  const lrA = await renderAt(evaluate, 0.5);
  if (lrA.w !== 400 || lrA.h !== 300) fail(`input march is ${lrA.w}x${lrA.h}, expected 400x300`);
  const lrB = await renderAt(evaluate, 0.5);
  const hrA = await renderAt(evaluate, 1.0);
  if (hrA.w !== 800 || hrA.h !== 600) fail(`target march is ${hrA.w}x${hrA.h}, expected 800x600`);
  const hrB = await renderAt(evaluate, 1.0);
  const lrC = await renderAt(evaluate, 0.5);
  checks.determinism = {
    sameScaleInput: maxAbsDiff(lrA, lrB),
    sameScaleTarget: maxAbsDiff(hrA, hrB),
    scaleRoundTrip: maxAbsDiff(lrA, lrC),
  };
  let temporalStartOff = false;
  if (Object.values(checks.determinism).some((v) => v > 1e-6)) {
    console.log('determinism failed with temporal start ON:', checks.determinism, '— retrying with setTemporalStart(false)');
    await evaluate('(() => { __sdfGame.setTemporalStart(false); return 1; })()');
    temporalStartOff = true;
    const a = await renderAt(evaluate, 0.5);
    const b = await renderAt(evaluate, 0.5);
    const h1 = await renderAt(evaluate, 1.0);
    const h2 = await renderAt(evaluate, 1.0);
    const c = await renderAt(evaluate, 0.5);
    checks.determinismTemporalStartOff = { sameScaleInput: maxAbsDiff(a, b), sameScaleTarget: maxAbsDiff(h1, h2), scaleRoundTrip: maxAbsDiff(a, c) };
    if (Object.values(checks.determinismTemporalStartOff).some((v) => v > 1e-6)) fail(`G2 determinism: ${JSON.stringify(checks)}`);
  }
  checks.temporalStart = temporalStartOff ? 'off (needed for determinism)' : 'on (shipped)';

  const lr = await renderAt(evaluate, 0.5);
  const hr = await renderAt(evaluate, 1.0);
  const cl = coverage(lr);
  const ch = coverage(hr);
  if (cl.n < 500) fail(`G2: only ${cl.n} flesh pixels at 400x300 — the staged body is not in frame`);
  // ALIGNMENT = registration of LINEAR DEPTH on interior flesh. Colour registration and the
  // coverage centroid are reported, never gated (g2-pairs.md: both misread aliasing).
  const reg = registerHalfRes(lr, hr, { mode: 'depth', near, far });
  const regColour = registerHalfRes(lr, hr, { mode: 'rgb' });
  checks.alignment = {
    inputCoverage: cl.frac,
    targetCoverage: ch.frac,
    registration: { mode: 'depth', texels: reg.texels, argmin: reg.argmin, subpixelOutputPx: reg.subpixel, mse: reg.mse },
    colourRegistration: { gated: false, argmin: regColour.argmin, subpixelOutputPx: regColour.subpixel },
    coverageCentroidOffsetOutputPx: { dx: 2 * cl.cx - ch.cx, dy: 2 * cl.cy - ch.cy, gated: false },
  };
  let inter = 0, union = 0;
  for (let y = 0; y < lr.h; y++) {
    for (let x = 0; x < lr.w; x++) {
      let votes = 0;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (hr.data[((2 * y + oy) * hr.w + 2 * x + ox) * 4 + 3] < 1) votes++;
      const a = lr.data[(y * lr.w + x) * 4 + 3] < 1;
      const b = votes >= 2;
      if (a && b) inter++;
      if (a || b) union++;
    }
  }
  checks.alignment.iou = inter / union;
  checks.orientation = {
    inputCentroidRow: cl.cy, inputHeight: lr.h, targetCentroidRow: ch.cy, targetHeight: hr.h,
    rowZero: cl.cy > lr.h / 2 && ch.cy > hr.h / 2 ? 'top' : 'UNCONFIRMED',
  };
  let dSum = 0, dN = 0;
  for (let y = 0; y < lr.h; y++) {
    for (let x = 0; x < lr.w; x++) {
      const a = lr.data[(y * lr.w + x) * 4 + 3];
      const b = hr.data[(2 * y * hr.w + 2 * x) * 4 + 3];
      if (a < 1 && b < 1) { dSum += Math.abs(linear(a, near, far) - linear(b, near, far)); dN++; }
    }
  }
  checks.depthMeanAbsDiffMetres = dN ? dSum / dN : NaN;

  const failures = [];
  const r = checks.alignment.registration;
  if (r.texels < 500) failures.push(`registration: only ${r.texels} interior flesh texels (need 500)`);
  if (r.argmin.ox !== 0 || r.argmin.oy !== 0) failures.push(`registration: best match at output shift (${r.argmin.ox}, ${r.argmin.oy}), not (0, 0)`);
  if (!(Math.abs(r.subpixelOutputPx.x) <= 0.25 && Math.abs(r.subpixelOutputPx.y) <= 0.25)) {
    failures.push(`registration: sub-pixel offset (${r.subpixelOutputPx.x}, ${r.subpixelOutputPx.y}) exceeds 0.25 output px`);
  }
  if (checks.alignment.iou < 0.85) failures.push(`IoU ${checks.alignment.iou.toFixed(3)} < 0.85`);
  if (checks.orientation.rowZero !== 'top') failures.push('orientation unconfirmed: body staged below centre but centroid row <= H/2');
  if (!(checks.depthMeanAbsDiffMetres < 0.05)) failures.push(`mean depth diff ${checks.depthMeanAbsDiffMetres} m >= 0.05`);
  return { checks, failures, lr, hr, temporalStartOff };
}
