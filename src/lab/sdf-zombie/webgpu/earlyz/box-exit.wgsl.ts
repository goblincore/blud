//
// EARLY-Z ANALYTIC EXIT (spec 2026-10-01 D4). The shipped proxy draws BACK faces and
// ray-window reads the exit as length(worldPos - camPos). A FRONT-face proxy's
// worldPos is the ENTRY, so the front material passes this point instead: the far
// root of the same slab test ray-window uses for boxEntry (same parallel-axis guard).
// `halfExt`, not `half`: avoid any reserved-word ambiguity in WGSL.
// `rd` must be unit length: it is normalized(worldPos - camPos) in the march.
// The 1e-8 parallel-axis guard is not scale-invariant.
export const EARLYZ_BOX_EXIT_WGSL = /* wgsl */ `fn earlyzBoxExitPoint(camPos: vec3<f32>, rd: vec3<f32>, centre: vec3<f32>, halfExt: vec3<f32>) -> vec3<f32> {
  let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));
  let rel = centre - camPos;
  let lo = (rel - halfExt) * invRd;
  let hi = (rel + halfExt) * invRd;
  let tExit = min(min(max(lo.x, hi.x), max(lo.y, hi.y)), max(lo.z, hi.z));
  return camPos + rd * max(tExit, 1e-4);
}`;

/** CPU twin of the WGSL above: the exit distance along `rd` (unit length).
 * `rd` must be unit length (not scale-invariant due to 1e-8 parallel-axis guard).
 */
export function boxExitT(
  camPos: ArrayLike<number>, rd: ArrayLike<number>, centre: ArrayLike<number>, half: ArrayLike<number>,
): number {
  let tExit = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = Math.abs(rd[i]!) > 1e-8 ? 1 / rd[i]! : 1e9;
    const rel_i = centre[i]! - camPos[i]!;
    const lo = (rel_i - half[i]!) * inv;
    const hi = (rel_i + half[i]!) * inv;
    tExit = Math.min(tExit, Math.max(lo, hi));
  }
  return Math.max(tExit, 1e-4);
}
