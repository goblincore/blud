// scripts/open-head-ray-evals.mts — the open split head's piece loop, counted on the CPU along camera rays
// (docs/dev-notes/2026-10-06-open-head-cost/NOTES.md, section 4).
//
// The hand twin of map-body.wgsl.ts's split slot (webgpu/march/map-body-split-twin.test.ts) counts field evaluations
// at points drawn uniformly in the region. A frame's samples are not uniform: they lie along sphere-traced rays. This
// walks the rays of a 400 x 300 target (58 degrees, every other texel) through the hold ball of a posed zombie's
// head, from the front, with the twin's logic, and counts per step:
//   evals        pieces the shipped loop evaluates (ascending caps, the exact early skip);
//   FIXED ORDER  the same with the pieces in id order and a per-piece skip in place of the sort;
//   needed       pieces that lowered the running minimum (no exact skip can do better in this order);
//   fold-only    pieces whose own field is at least max(the running best, gate): an early exit after the fold could
//                leave their wounds out exactly (every lowering in applyWounds is gated on the incoming field);
//   sphere bound pieces a skip on max(cap, |q - c| - R) would leave out (c the head centre, R 1.25 x its largest
//                semi-axis), and how many of those skips are WRONG: the piece left out was under the running best.
// Usage: npx tsx scripts/open-head-ray-evals.mts
const ROOT = '../src/lab/sdf-zombie';
const { buildBody, DEFAULT_BUILD_OPTS } = await import(`${ROOT}/build-body.ts`);
const { makeZombie } = await import(`${ROOT}/body.ts`);
const { applyRig, bindRig, headQuatOf } = await import(`${ROOT}/rig-bind.ts`);
const { sdBodyClosed } = await import(`${ROOT}/validate.ts`);
const { headShape } = await import(`${ROOT}/webgpu/flame-anchors.ts`);
const HS = await import(`${ROOT}/head-split.ts`);
const { add, cross, dot, len, scale, sub, qRotate, normalize } = await import(`${ROOT}/vec.ts`);
type V = [number, number, number];
const { REGION_MARGIN, forcedSplit, headFrameOf, splitWarpOf } = HS;

const BODY = buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {});
const BOUND = bindRig(BODY);
const POSED = applyRig(BODY, BOUND, 0);
const FRAME = headFrameOf(headShape(POSED)!, headQuatOf(BOUND, 0) ?? [0, 0, 0, 1]);
const f = (q: V) => sdBodyClosed(q, POSED) as number;
const warp = (preset: string, sides: number, offset: number, frac: number) => splitWarpOf(forcedSplit(preset, sides, offset, frac)!, FRAME)!;

function moveBack(p: V, h: V, a: V, theta: number): V {
  const v = sub(p, h), c = Math.cos(-theta), s = Math.sin(-theta);
  return add(add(add(h, scale(v, c)), scale(cross(a, v), s)), scale(a, dot(a, v) * (1 - c)));
}

interface Stat { fixedEvals: number; evals: number; full: number; foldOnly: number; sphereSkips: number; sphereWrong: number; needed: number; }
/** One slot sample, the twin's logic, with the counters of the variants. gate: the fold early-out's floor (m).
 *  sphere: [centre, R] of the closed head's flesh, for the sphere-bound variant. */
function sample(w: any, pIn: V, gate: number, sph: { c: V; R: number }, st: Stat): number {
  let dUnion = 1e9, splitShell = 1e9;
  let pcs: [number, number, number][] = [[-1e9, 0, 0], [1e9, 0, 1], [1e9, 0, 2]];
  const spU = cross(w.n, w.a), spDh = len(sub(pIn, w.h)), spRho = w.r - REGION_MARGIN;
  splitShell = REGION_MARGIN + Math.abs(spDh - w.r);
  let cap0 = Math.min(dot(spU, sub(pIn, w.h)), spRho - spDh);
  if (spDh <= w.r) {
    const qP = moveBack(pIn, w.h, w.a, w.thetaP), qM = moveBack(pIn, w.h, w.a, w.thetaM);
    const capP = Math.max(Math.max(-(dot(w.n, qP) - w.d0), -dot(spU, sub(qP, w.h))), spDh - spRho);
    const capM = Math.max(Math.max(dot(w.n, qM) - w.d0, -dot(spU, sub(qM, w.h))), spDh - spRho);
    if (w.thetaP === 0) cap0 = Math.min(cap0, capP); else { pcs[1]![0] = capP; pcs[1]![1] = w.thetaP; }
    if (w.thetaM === 0) cap0 = Math.min(cap0, capM); else { pcs[2]![0] = capM; pcs[2]![1] = w.thetaM; }
  }
  pcs[0]![0] = cap0;
  // the fixed-order variant: pieces by id, each skipped (continue) against the running best
  { let dU = 1e9; for (const piece of pcs) { if (piece[0] >= Math.min(dU, splitShell)) continue; const q = piece[1] !== 0 ? moveBack(pIn, w.h, w.a, piece[1]) : pIn; st.fixedEvals++; const d = Math.max(f(q), piece[0]); if (d < dU) dU = d; } }
  pcs.sort((x, y) => x[0] - y[0]);
  for (const piece of pcs) {
    const best = Math.min(dUnion, splitShell);
    if (piece[0] >= best) break;
    const q = piece[1] !== 0 ? moveBack(pIn, w.h, w.a, piece[1]) : pIn;
    const v = f(q);
    st.evals++;
    // the sphere-bound variant: would it have skipped, and would that have been wrong?
    const sb = Math.max(piece[0], len(sub(q, sph.c)) - sph.R);
    if (sb >= best) { st.sphereSkips++; if (Math.max(v, piece[0]) < best) st.sphereWrong++; }
    // the fold early-out variant
    if (v >= Math.max(best, gate)) st.foldOnly++; else st.full++;
    const d = Math.max(v, piece[0]);
    if (d < dUnion) { dUnion = d; st.needed++; }
  }
  return Math.min(dUnion, splitShell);
}

function run(name: string, w: any, dist: number, gate: number) {
  const hc: V = FRAME.centre, front = qRotate(FRAME.quat, [0, 0, 1]) as V;
  const fl = Math.hypot(front[0], front[2]);
  const fwd: V = [-front[0] / fl, 0, -front[2] / fl];            // camera looks back along the head's front
  const eye: V = [hc[0] - fwd[0] * dist, hc[1], hc[2] - fwd[2] * dist];
  const right = normalize(cross(fwd, [0, 1, 0])) as V, up = cross(right, fwd) as V;
  const W = 400, H = 300, tanH = Math.tan((58 * Math.PI / 180) / 2);
  // the closed head's flesh sphere: centre the frame's, radius the farthest head-flesh surface found by sampling
  const sph = { c: hc, R: 1.25 * FRAME.radius };
  const st: Stat = { fixedEvals: 0, evals: 0, full: 0, foldOnly: 0, sphereSkips: 0, sphereWrong: 0, needed: 0 };
  let rays = 0, steps = 0, closedSteps = 0, hits = 0, closedHits = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const sx = ((x + 0.5) / W * 2 - 1) * tanH * (W / H), sy = (1 - (y + 0.5) / H * 2) * tanH;
    const rd = normalize(add(add(fwd, scale(right, sx)), scale(up, sy))) as V;
    // the hold ball's screen disc (what the bounds let march): ray vs sphere (h, rho)
    const oc = sub(w.h, eye), tc = dot(oc, rd), rho = w.r - REGION_MARGIN, d2 = dot(oc, oc) - tc * tc;
    if (d2 > rho * rho) continue;
    const th = Math.sqrt(rho * rho - d2), t0 = Math.max(tc - th, 0), t1 = tc + th;
    rays++;
    let t = t0;
    for (let i = 0; i < 96 && t < t1; i++) {
      const p = add(eye, scale(rd, t)) as V;
      const d = sample(w, p, gate, sph, st);
      steps++;
      if (d < Math.max(0.0012, t * 0.000924 * 3)) { hits++; break; }
      t += d;
    }
    t = t0;
    for (let i = 0; i < 96 && t < t1; i++) {
      const d = f(add(eye, scale(rd, t)) as V);
      closedSteps++;
      if (d < Math.max(0.0012, t * 0.000924 * 3)) { closedHits++; break; }
      t += d;
    }
  }
  console.log(`${name} @${dist} m, gate ${gate}: rays ${rays} (hit ${hits}, closed ${closedHits}); steps ${steps} (closed ${closedSteps}); `
    + `FIXED ORDER evals ${st.fixedEvals} (${(st.fixedEvals / steps).toFixed(2)}/step); evals ${st.evals} = ${(st.evals / steps).toFixed(2)}/step, ${(st.evals / closedSteps).toFixed(2)}x the closed head's; `
    + `needed (won the running min) ${st.needed} = ${(st.needed / steps).toFixed(2)}/step; `
    + `fold early-out: full ${st.full} (${(st.full / steps).toFixed(2)}/step), fold-only ${st.foldOnly}; `
    + `sphere bound: would skip ${st.sphereSkips}, WRONG ${st.sphereWrong}`);
}

for (const dist of [0.6, 2]) {
  for (const [name, w] of [['mid-both', warp('middle', 0, 0, 1)], ['mid-one', warp('middle', 1, 0.04, 1)]] as const) {
    for (const gate of [0.025]) run(name, w, dist, gate);
  }
}
