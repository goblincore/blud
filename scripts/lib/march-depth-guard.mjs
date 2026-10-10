// scripts/lib/march-depth-guard.mjs
//
// THE DEPTH GUARD of the capture gates (scripts/head-split-gate.mjs, scripts/axe-gate.mjs): every body texel of the
// float march target, placed in the world by its depth, is where a body can be.
//
// The target's alpha is the hit's clip depth, so each body texel is a point in the world: the eye + (its distance
// along the view axis) x (the texel's ray). Three arms:
//   BEHIND   that distance is not positive and finite (the point is behind the camera, or nowhere);
//   OUTSIDE  the point lies outside EVERY marched thing's bound: each actor's proxy box (the box the march rasterises
//            and can alone hit inside: the view's position +- its bodyHalf) and each live gib chunk's sphere (the
//            chunks are marched into the same target; chunkStats().livePieces: centre, DEPTH_CHUNK x its radius), all
//            grown by DEPTH_SLACK m and DEPTH_SLACK_FAR x the distance (a texel's own footprint and the march's
//            accept reach);
//   ORIGIN   of ALL the body texels whose clip depth is the WORLD ORIGIN's (within DEPTH_ORIGIN), the largest set that
//            share one depth TO THE BIT, whether or not the other two arms object (the slack is 0.44 m at 13 m: a
//            point at the origin's depth can fall inside some body's grown box). A surface that really crosses the
//            origin's depth does so at many depths; a hit written at (0, 0, 0) gives one. A run over DEPTH_ORIGIN_RUN
//            fails.
// ORIGIN is the signature of the fault this guard was built on. On Apple's GPU, fragments of one 4 x 4 block of the
// target that skip a bodyLights call another fragment of the block takes come back with a zeroed ray and distance in
// the entry point (docs/dev-notes/2026-10-04-head-split/NOTES.md, "The depth fault, bisected": bisected to that
// trigger; the cause below the shader source is not reached). The guard does not know the cause: any edit that puts
// a body texel where no body can be fails it.
//
// depthGuardControl() is the guard's positive control: each arm shown to fail on made-up texels, nothing rendered.

export const DEPTH_SLACK = 0.05;
export const DEPTH_SLACK_FAR = 0.03;
export const DEPTH_ORIGIN = 1e-6;
export const DEPTH_ORIGIN_RUN = 2;
export const DEPTH_CHUNK = 1.75;

/** What the guard needs from the page, as one expression for Runtime.evaluate: the eye, the rays of the frame's
 *  centre and of one step right and up, the clip depth at two distances and of the world origin, the actors' proxy
 *  boxes and the live gib chunks' spheres ([] on a page with no chunkStats seam). */
export const DEPTH_GUARD_PROBE = `(() => { const c = __sdfGame.cameraWorld(); const d = (x, y) => { const p = __sdfGame.screenRayToWorld(x, y, 1); return [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; };
    const a = __sdfGame.screenRayToWorld(0, 0, 0.5), b = __sdfGame.screenRayToWorld(0, 0, 2);
    return { c, f: d(0, 0), x: d(1, 0), y: d(0, 1), z1: __sdfGame.screenPosOf(a[0], a[1], a[2]).z, z2: __sdfGame.screenPosOf(b[0], b[1], b[2]).z, z0: __sdfGame.screenPosOf(0, 0, 0).z,
      boxes: __sdfGame.actorList().map((q) => __sdfGame.zombie(q.id)).filter((q) => q && q.view && q.view.object).map((q) => { const p = q.view.object.position, h = q.view.uniforms.bodyHalf.value; return [p.x, p.y, p.z, h.x, h.y, h.z]; }),
      chunks: typeof __sdfGame.chunkStats === "function" ? (__sdfGame.chunkStats().livePieces ?? []).map((q) => [q.centre[0], q.centre[1], q.centre[2], q.radius]) : [] }; })()`;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * One capture against the guard. `t`: the target ({ w, h, f: rgba floats, miss: the clear value's alpha }); `g`: what
 * DEPTH_GUARD_PROBE returned for the frame the target was read on (`chunks` may be absent). Returns the counts of the
 * three arms ({ texels, behind, outside, originRun }) and the first texel BEHIND or OUTSIDE
 * ({ texel, why, clipDepth, distance, originDepth }, null when none).
 */
export function depthGuardTexels(t, g) {
  // depth = A - B / distance along the view axis; a texel's ray is f + nx TX + ny TY per metre of that distance.
  const B = (g.z2 - g.z1) / (1 / 0.5 - 1 / 2), A = g.z1 + B / 0.5;
  const TX = sub(mul(g.x, 1 / dot(g.x, g.f)), g.f), TY = sub(mul(g.y, 1 / dot(g.y, g.f)), g.f);
  const chunks = g.chunks ?? [], atOrigin = new Map();
  let last = 0; const res = { texels: 0, behind: 0, outside: 0, originRun: 0, worst: null };
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const z = t.f[(y * t.w + x) * 4 + 3]; if (z === t.miss) continue;
    res.texels++;
    if (Math.abs(z - g.z0) <= DEPTH_ORIGIN) { const k = (atOrigin.get(z) ?? 0) + 1; atOrigin.set(z, k); if (k > res.originRun) res.originRun = k; }
    const d = B / (A - z), nx = (x + 0.5) / t.w * 2 - 1, ny = 1 - (y + 0.5) / t.h * 2;
    let why = null;
    if (!(d > 0) || !Number.isFinite(d)) why = "behind";
    else {
      const p = [g.c[0] + d * (g.f[0] + nx * TX[0] + ny * TY[0]), g.c[1] + d * (g.f[1] + nx * TX[1] + ny * TY[1]), g.c[2] + d * (g.f[2] + nx * TX[2] + ny * TY[2])], slack = DEPTH_SLACK + DEPTH_SLACK_FAR * d;
      const inBox = (b) => Math.abs(p[0] - b[0]) <= b[3] + slack && Math.abs(p[1] - b[1]) <= b[4] + slack && Math.abs(p[2] - b[2]) <= b[5] + slack;
      const inChunk = (q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= DEPTH_CHUNK * q[3] + slack;
      if (!(last < g.boxes.length && inBox(g.boxes[last]))) { last = g.boxes.findIndex(inBox); if (last < 0) { last = 0; if (!chunks.some(inChunk)) why = "outside"; } }
    }
    if (!why) continue;
    res[why]++;
    res.worst ??= { texel: [x, y], why, clipDepth: z, distance: +d.toFixed(3), originDepth: +g.z0.toFixed(7) };
  }
  return res;
}

/** A run's totals: every capture's counts summed, the longest origin run and the most chunks live in any one capture,
 *  and the first failing capture's first bad texel (`worst`). */
export const depthGuardTotals = () => ({ captures: 0, texels: 0, behind: 0, outside: 0, originRun: 0, chunks: 0, worst: null });

/** One capture's result (depthGuardTexels, with the probe it was judged on) into a run's totals. `name` labels the
 *  capture in `worst` (its number in the run otherwise). Returns the result. */
export function depthGuardAdd(D, bad, g, name = null) {
  D.captures++; D.texels += bad.texels; D.behind += bad.behind; D.outside += bad.outside;
  D.originRun = Math.max(D.originRun, bad.originRun); D.chunks = Math.max(D.chunks, (g.chunks ?? []).length);
  if (bad.worst || bad.originRun > DEPTH_ORIGIN_RUN) D.worst ??= { capture: name ?? D.captures, ...(bad.worst ?? { why: "origin", originDepth: +g.z0.toFixed(7) }), originRun: bad.originRun };
  return bad;
}

/** The run passes: something was captured, and no arm objected. */
export const depthGuardOk = (D) => D.captures > 0 && D.behind === 0 && D.outside === 0 && D.originRun <= DEPTH_ORIGIN_RUN;

/** The guard's check line over a run's totals. */
export const depthGuardLine = (D) => `every body texel is where a body can be: of ${D.texels} over ${D.captures} captures, ${D.behind} lie behind the camera and ${D.outside} outside every actor's proxy box and gib chunk's sphere (+${DEPTH_SLACK} m, +${DEPTH_SLACK_FAR} x the distance; ${D.chunks} chunks live at most); at the world origin's clip depth the largest run of bit-equal texels in a capture is ${D.originRun} (<= ${DEPTH_ORIGIN_RUN})${D.worst ? `; the first ${JSON.stringify(D.worst)}` : ""}`;

/**
 * THE GUARD'S OWN ARMS, on made-up texels (a positive control: nothing is rendered). An eye at (0, 1.6, 3) looking
 * down -z; one body's box 4 m off, one that happens to stand about the world origin, and one gib chunk 7 m off to the
 * side. `faulty`: a texel on the first body, one behind the camera, one 13 m off in no bound, and three at the
 * origin's depth to the bit that land INSIDE the second body's box (an origin count taken only among texels the
 * other arms had judged bad let those through). `clean`: texels on both bodies, near the origin's depth but not at
 * it. Returns each target's counts.
 */
export function depthGuardControl() {
  const A = 1.0005, B = 0.10005, at = (d) => Math.fround(A - B / d), miss = 1;
  const g = { c: [0, 1.6, 3], f: [0, 0, -1], x: [0.05, 0, -1], y: [0, 0.04, -1], z1: A - B / 0.5, z2: A - B / 2, z0: A - B / 3, boxes: [[0, 1, -1, 0.4, 1, 0.4], [0, 1, 0, 2, 2, 0.5]], chunks: [[3, 1, -7, 0.2]] };
  const target = (zs) => ({ w: zs.length, h: 1, miss, f: Float32Array.from(zs.flatMap((z) => [0.2, 0.1, 0.1, z])) });
  const counts = ({ texels, behind, outside, originRun }) => ({ texels, behind, outside, originRun });
  return {
    faulty: counts(depthGuardTexels(target([miss, at(4), at(-9.741), at(13), at(3), at(3), at(3), miss]), g)),
    clean: counts(depthGuardTexels(target([miss, at(4), at(3.9), at(4.1), at(2.9), at(3.02), miss, miss]), g)),
  };
}

/** The control holds: the faulty target reads one texel behind, one outside and a run of three; the clean one none. */
export const depthGuardControlOk = (k) => k.faulty.behind === 1 && k.faulty.outside === 1 && k.faulty.originRun === 3 && k.clean.behind === 0 && k.clean.outside === 0 && k.clean.originRun <= 1;

/** The control's check line. */
export const depthGuardControlLine = (k) => `the depth guard's own arms, on made-up texels: of ${k.faulty.texels}, ${k.faulty.behind} behind the camera, ${k.faulty.outside} outside every bound and a run of ${k.faulty.originRun} at the world origin's depth INSIDE a body's box (1, 1 and 3 expected; a run over ${DEPTH_ORIGIN_RUN} fails); on a clean target ${k.clean.behind}, ${k.clean.outside} and a run of ${k.clean.originRun}`;
