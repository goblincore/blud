// scripts/lib/march-depth-guard.mjs
//
// THE DEPTH GUARD of the capture gates (scripts/head-split-gate.mjs, scripts/axe-gate.mjs): every body texel of the
// float march target, placed in the world by its depth, lies in front of the camera and inside some actor's proxy box.
//
// The target's alpha is the hit's clip depth, so each body texel is a point in the world: the eye + (its distance
// along the view axis) x (the texel's ray). A texel is BAD when
//   - that distance is not positive and finite (the point is behind the camera, or nowhere), or
//   - the point lies outside EVERY actor's proxy box (the box the march rasterises and can alone hit inside: the
//     view's position +- its bodyHalf), grown by DEPTH_SLACK m and DEPTH_SLACK_FAR x the distance (a texel's own
//     footprint and the march's accept reach).
// Of the bad ones, those whose clip depth is the WORLD ORIGIN's (within DEPTH_ORIGIN) are counted apart: a hit written
// at (0, 0, 0) is the signature of the fault this guard was built on. On Apple's GPU, fragments of one 4 x 4 block of
// the target that skip a bodyLights call another fragment of the block takes come back with a zeroed ray and distance
// in the entry point (docs/dev-notes/2026-10-04-head-split/NOTES.md, "The depth fault, bisected"). The guard does not
// know the cause: any edit that puts a body texel where no body can be fails it.

export const DEPTH_SLACK = 0.05;
export const DEPTH_SLACK_FAR = 0.03;
export const DEPTH_ORIGIN = 1e-6;

/** What the guard needs from the page, as one expression for Runtime.evaluate: the eye, the rays of the frame's
 *  centre and of one step right and up, the clip depth at two distances and of the world origin, the proxy boxes. */
export const DEPTH_GUARD_PROBE = `(() => { const c = __sdfGame.cameraWorld(); const d = (x, y) => { const p = __sdfGame.screenRayToWorld(x, y, 1); return [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; };
    const a = __sdfGame.screenRayToWorld(0, 0, 0.5), b = __sdfGame.screenRayToWorld(0, 0, 2);
    return { c, f: d(0, 0), x: d(1, 0), y: d(0, 1), z1: __sdfGame.screenPosOf(a[0], a[1], a[2]).z, z2: __sdfGame.screenPosOf(b[0], b[1], b[2]).z, z0: __sdfGame.screenPosOf(0, 0, 0).z,
      boxes: __sdfGame.actorList().map((q) => __sdfGame.zombie(q.id)).filter((q) => q && q.view && q.view.object).map((q) => { const p = q.view.object.position, h = q.view.uniforms.bodyHalf.value; return [p.x, p.y, p.z, h.x, h.y, h.z]; }) }; })()`;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * One capture against the guard. `t`: the target ({ w, h, f: rgba floats, miss: the clear value's alpha }); `g`: what
 * DEPTH_GUARD_PROBE returned for the frame the target was read on. Returns the counts and the first bad texel
 * ({ texel, why, clipDepth, distance, originDepth }, null when none).
 */
export function depthGuardTexels(t, g) {
  // depth = A - B / distance along the view axis; a texel's ray is f + nx TX + ny TY per metre of that distance.
  const B = (g.z2 - g.z1) / (1 / 0.5 - 1 / 2), A = g.z1 + B / 0.5;
  const TX = sub(mul(g.x, 1 / dot(g.x, g.f)), g.f), TY = sub(mul(g.y, 1 / dot(g.y, g.f)), g.f);
  let last = 0; const res = { texels: 0, behind: 0, outside: 0, origin: 0, worst: null };
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    const z = t.f[(y * t.w + x) * 4 + 3]; if (z === t.miss) continue;
    res.texels++;
    const d = B / (A - z), nx = (x + 0.5) / t.w * 2 - 1, ny = 1 - (y + 0.5) / t.h * 2;
    let why = null;
    if (!(d > 0) || !Number.isFinite(d)) why = "behind";
    else {
      const p = [g.c[0] + d * (g.f[0] + nx * TX[0] + ny * TY[0]), g.c[1] + d * (g.f[1] + nx * TX[1] + ny * TY[1]), g.c[2] + d * (g.f[2] + nx * TX[2] + ny * TY[2])], slack = DEPTH_SLACK + DEPTH_SLACK_FAR * d;
      const inBox = (b) => Math.abs(p[0] - b[0]) <= b[3] + slack && Math.abs(p[1] - b[1]) <= b[4] + slack && Math.abs(p[2] - b[2]) <= b[5] + slack;
      if (!(last < g.boxes.length && inBox(g.boxes[last]))) { last = g.boxes.findIndex(inBox); if (last < 0) { last = 0; why = "outside"; } }
    }
    if (!why) continue;
    res[why]++; if (Math.abs(z - g.z0) <= DEPTH_ORIGIN) res.origin++;
    res.worst ??= { texel: [x, y], why, clipDepth: z, distance: +d.toFixed(3), originDepth: +g.z0.toFixed(7) };
  }
  return res;
}

/** The guard's check line over a run's totals ({ captures, texels, behind, outside, origin, worst }). */
export const depthGuardLine = (D) => `every body texel is where a body can be: of ${D.texels} over ${D.captures} captures, ${D.behind} lie behind the camera and ${D.outside} outside every actor's proxy box (+${DEPTH_SLACK} m, +${DEPTH_SLACK_FAR} x the distance)${D.behind + D.outside ? `; ${D.origin} of those at the world origin's depth; the first ${JSON.stringify(D.worst)}` : ""}`;
