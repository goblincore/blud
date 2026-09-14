// scripts/march-parity.mjs — the TOLERANCE gate for the crowd march path
// (?crowd=1), crowd stage (a) task 7b.
//
// WHY A TOLERANCE GATE AND NOT A HASH. The per-body canonical gate
// (scripts/march-hash.mjs) demands a byte-identical sha1. `?crowd=1` cannot
// meet that bar and never will with one instanced draw: the instanced
// `positionNode` reaches clip space as `view * (model * p)` while the
// per-body mesh is `(view * model) * p`, so the vertex transform differs by
// about one ULP. That ULP cascades through the AA-gated march to a different
// accepted `t` (Task 6 executor note, ratified 2026-09-14). What IS invariant
// is (a) WHICH pixels hit at all, (b) how far the accepted depth may move,
// and (c) the flat-albedo RGB — the field/material path. Those three are what
// this script gates; the per-body canonical sha1 `a8ab4e…` is checked by
// march-hash.mjs and must not move.
//
// WHAT IT DOES. For each room (default 1,2) it boots the close-up scene
// TWICE: once with `__sdfGame.setCrowd(false)` (per-body) and once with
// `__sdfGame.setCrowd(true)` (crowd), identical pins otherwise, and compares
// the raw march target via __sdfGameDebug.readMarchTarget() — alpha is NDC
// depth (1.0 = miss), RGB the shaded hit. The raw float bytes are decoded in
// Node; they are never printed. Each boot is captured twice: once lit, once
// with `__sdfGame.setFlatAlbedo(true)` (debugCfg.y) so the flat-albedo RGB
// can be required byte-identical — that part proves the field/material path
// is exact and leaves only `t` as the difference.
//
// MARCH_PARITY_TILES=1 adds `tiles-playtest` to the boot URL and calls
// `setTiles(true)`, so the tile-list march is gated in both modes.
//
// Output: ONE JSON line per (room, tiles, flat) combination, then a final
// `PASS`/`FAIL` line. Exit 1 on any exceeded threshold (which is named).
//
// Env: LAB_VITE_PORT / LAB_CDP_PORT (default 5323 / 9323),
//      MARCH_PARITY_ROOMS (default `1,2`), MARCH_PARITY_TILES=1,
//      MARCH_PARITY_DISPATCH (default `quad`; `boxes` is the stage-a path).
// Run inside scripts/lab-servers.sh (see that file's header).
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5323);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
const ROOMS = (process.env.MARCH_PARITY_ROOMS ?? '1,2').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
const TILES = process.env.MARCH_PARITY_TILES === '1';
const DISPATCH = process.env.MARCH_PARITY_DISPATCH === 'boxes' ? 'boxes' : 'quad';
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 8 min'); process.exit(3); }, 8 * 60_000).unref();

// THRESHOLDS — pinned from the measured maxima, one set per dispatch (stage
// a-2 added the quad dispatch; the boxes set is the Task-7b one, unchanged).
//
// BOXES (Task 7b, 2026-09-14): measured across rooms 1+2, tiles off/on,
// deterministic to the last bit on a repeat run —
//   maskDiffFrac max 0.0 (exactly) — so the ratified 0.1 % bar is retained,
//     not tightened to 0; it is the structural allowance for a rim pixel whose
//     marginal AA gate an ULP flips, and 2x0 has no significant figure.
//   maxDz         max 1.379e-3 (room 2) -> 2x = 2.758e-3 -> one sig fig 3e-3.
//   lit rgbMax    max 0.2944 (room 1 tiles on) -> 2x = 0.589 -> 0.6. Lit colour
//     legitimately moves with the accepted `t` through the wound/AO terms; this
//     is a smoke alarm over those pixels, NOT a proof of equality.
//   flat RGB      measured exactly 0 channels / 0.0 — required bit-identical.
//
// QUAD (stage a-2, 2026-09-14): the entry moves from a box face to the nearest
// tile-sphere entry and the fragment is the union field, so the accepted `t`
// may shift by at most an entry epsilon at the surface and silhouette rim
// pixels can flip. MEASURED (tiles on, rooms 1+2, deterministic to the bit on
// a repeat run):
//   maskDiffFrac max 3.2721e-5 (room 2, exactly 1 rim pixel of 30561 hits;
//     rooms 1 and the second run both came out maskDiff 0) -> 2x = 6.545e-5
//     -> one sig fig 7e-5.
//   maxDz         max 2.1837e-3 (room 2; room 1 9.890e-4) -> 2x = 4.367e-3
//     -> one sig fig 4e-3.
//   lit rgbMax    max 0.2944 (room 1) -> 2x = 0.589 -> 0.6 (the boxes smoke
//     alarm, unchanged).
//   flat RGB      measured exactly 0 channels / 0.0 — required bit-identical.
// HARD CEILINGS regardless of measurement: maskDiffFrac <= 0.005, maxDz <= 2e-2.
const BOXES_THRESH = {
  maskDiffFrac: 0.001,
  maxDz: 3e-3,
  rgbMax: 0.6,
};
const QUAD_THRESH = {
  maskDiffFrac: 7e-5,
  maxDz: 4e-3,
  rgbMax: 0.6,
};
const THRESH = DISPATCH === 'boxes' ? BOXES_THRESH : QUAD_THRESH;
const HARD_MASK_CEILING = 0.005;
const HARD_DZ_CEILING = 2e-2;

/** The Task-7b comparison: hit-mask difference, depth delta over common hits,
 *  and lit-RGB delta over common hits. Sizes must agree. */
function compare(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const A = a.data, B = b.data; const n = a.w * a.h;
  let hitA = 0, hitB = 0, maskDiff = 0, maxDz = 0, sumDz = 0, rgbDiff = 0, rgbMax = 0;
  let lumA = 0, lumB = 0, dR = 0, dG = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const za = A[i * 4 + 3], zb = B[i * 4 + 3];
    const ha = za < 1, hb = zb < 1;
    if (ha) hitA++; if (hb) hitB++;
    if (ha !== hb) { maskDiff++; continue; }
    if (!ha) continue;
    const dz = Math.abs(za - zb); if (dz > maxDz) maxDz = dz; sumDz += dz;
    for (let c = 0; c < 3; c++) { const d = Math.abs(A[i * 4 + c] - B[i * 4 + c]); if (d > 0) rgbDiff++; if (d > rgbMax) rgbMax = d; }
    lumA += A[i*4]+A[i*4+1]+A[i*4+2]; lumB += B[i*4]+B[i*4+1]+B[i*4+2]; dR += B[i*4]-A[i*4]; dG += B[i*4+1]-A[i*4+1]; dB += B[i*4+2]-A[i*4+2];
  }
  const hits = Math.max(hitA, 1);
  return { hitA, hitB, maskDiff, maskDiffFrac: maskDiff / hits, maxDz, meanDz: sumDz / hits, rgbDiffChannels: rgbDiff, rgbMax, meanLumA: lumA/(3*hits), meanLumB: lumB/(3*hits), meanDelta: [dR/hits, dG/hits, dB/hits] };
}

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });

// One boot of the staged close-up, captured lit AND flat-albedo. The boot
// uses a bare URL (no crowd flag) and selects the path with setCrowd — the
// literal two-boot design; the per-body boot is then exactly the plain page
// (setCrowd(false) is a no-op). Every step count is identical on both boots so
// the march-jitter frame parity lands on the same phase.
async function bootAndCapture({ room, crowd }) {
  const q = ['frozen=1', 'vhs=off', 'upscale=0'];
  if (TILES) q.push('tiles-playtest');
  await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${VITE}/sdf-game.html?${q.join('&')}` });
  await evaluate('__sdfGame.setLoopRunning(false)');
  await applyShipDefaults(evaluate);
  if (TILES) await evaluate('__sdfGame.setTiles(true)');
  // Stage a-2: pick the dispatch BEFORE setCrowd(true) builds the types — the
  // type stores the dispatch it was created with. The per-body boot ignores it.
  await evaluate(`__sdfGame.setCrowdDispatch(${JSON.stringify(DISPATCH)})`);
  await evaluate(`__sdfGame.setCrowd(${crowd})`);
  // Diagnostic hook: extra JS after the path is selected, before pins/stage (e.g. setLevelShadow(false)).
  if (process.env.MARCH_PARITY_PRELUDE) await evaluate(process.env.MARCH_PARITY_PRELUDE);
  // Same pins march-hash.mjs uses: fields off (sdf-layer's private frame
  // counter makes fields-on bimodal), flicker clock frozen, probe afterglow a
  // pure per-frame estimate.
  const SKIP = (process.env.MARCH_PARITY_SKIP_PINS ?? '').split(',');
  if (!SKIP.includes('field')) await evaluate('__sdfGame.setFieldStyle("off")');
  if (!SKIP.includes('light')) await evaluate('(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); return 1; })()');
  if (!SKIP.includes('probe')) await evaluate('(() => { __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); return 1; })()');
  await stageCloseUp(evaluate, { room }, fail);
  await evaluate('(() => { __sdfGame.setSdfScale(0.5); __sdfGame.step(6); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');

  // readMarchTarget() steps one internal frame per call; two calls per logical
  // capture lock the period-2 jitter parity (march-hash.mjs's discipline).
  const read = async () => {
    await evaluate('__sdfGameDebug.readMarchTarget()');
    const r = await evaluate('__sdfGameDebug.readMarchTarget()');
    const bytes = Buffer.from(r.rgba32f, 'base64');
    const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    return { w: r.w, h: r.h, data };
  };
  const lit = await read();
  await evaluate('(() => { __sdfGame.setFlatAlbedo(true); __sdfGame.step(2); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  const flat = await read();
  return { lit, flat };
}

const failures = [];
const check = (name, value, bound, unit) => {
  const ok = value <= bound;
  if (!ok) failures.push(`${name} ${value}${unit} > ${bound}${unit}`);
  return ok;
};

for (const room of ROOMS) {
  const perBody = await bootAndCapture({ room, crowd: false });
  const crowd = await bootAndCapture({ room, crowd: true });

  for (const [flat, key] of [[false, 'lit'], [true, 'flat']]) {
    const m = compare(perBody[key], crowd[key]);
    const line = { room, tiles: TILES, dispatch: DISPATCH, flat, ...m };
    console.log(JSON.stringify(line));
    const tag = `room${room} tiles=${TILES ? 1 : 0} dispatch=${DISPATCH} flat=${flat ? 1 : 0}`;
    // Stage a-2 hard ceilings: independent of the measured-pin set above, the
    // quad entry must not exceed these (the boxes set cannot either).
    check(`${tag} maskDiffFrac(hard)`, m.maskDiffFrac, HARD_MASK_CEILING, '');
    check(`${tag} maxDz(hard)`, m.maxDz, HARD_DZ_CEILING, '');
    check(`${tag} maskDiffFrac`, m.maskDiffFrac, THRESH.maskDiffFrac, '');
    check(`${tag} maxDz`, m.maxDz, THRESH.maxDz, '');
    if (flat) {
      // Flat albedo is the field/material proof: it must be byte-identical.
      // report the failure through the same list so the final line names it.
      if (m.rgbDiffChannels !== 0) failures.push(`${tag} rgbDiffChannels ${m.rgbDiffChannels} != 0`);
      if (m.rgbMax !== 0) failures.push(`${tag} rgbMax ${m.rgbMax} != 0`);
    } else {
      check(`${tag} rgbMax`, m.rgbMax, THRESH.rgbMax, '');
    }
  }
}

if (failures.length) {
  console.log(`FAIL (${failures.length}): ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS');
process.exit(0);
