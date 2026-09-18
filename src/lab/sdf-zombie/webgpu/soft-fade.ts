// src/lab/sdf-zombie/webgpu/soft-fade.ts
//
// SHARED SOFT-PARTICLE DEPTH FADE (flame-polish task 1, extracted for the
// explosion-curl task). A translucent billboard that INTERSECTS geometry is cut
// by the depth test along a straight line, which reads as a rectangular edge.
// Fading its alpha as the fragment approaches the scene surface BEHIND it turns
// that cut into a gradient. The technique is from the wildfire teardown
// (docs/dev-notes/2026-09-18-wildfire-fire-teardown.md §4).
//
// ── THE TRAP, AND WHY IT LIVES BEHIND THIS API ──────────────────────────
// The fade needs TWO depths: the fragment's own, and the SCENE's at the same
// pixel. The scene's must come from the viewport depth texture —
// `linearDepth(viewportDepthTexture())`, exported by three as
// `viewportLinearDepth`. Feeding a bare `linearDepth()` / `depth()` (no
// argument) to BOTH sides is the current fragment's depth, so the difference is
// identically zero and `saturate((d - d) / fade) = 0` makes the ENTIRE effect
// render transparent black — no error, no warning. The wildfire bundle ships a
// runtime guard for exactly this.
//
// So this helper TAKES the scene depth FROM ONE PLACE: it reads
// `viewportLinearDepth` itself, for every caller, and its second parameter is
// never a depth at all. A caller cannot pass the wrong scene depth because it
// never passes one. `soft-fade.test.ts` fails if a bare `linearDepth()` call
// is ever introduced here.
//
// Both sides are normalized over [near, far] by three's depth nodes, so the
// fade distance is converted back to VIEW-SPACE METRES and a tuning value of
// `0.3` really is 30 cm. A 0 metre fade is inert (multiplied by 0), so the
// switch has no numerical side effects and compiles into the same shader.
//
// THE CALLER PASSES: the fragment's own normalized linear depth — i.e. a bare
// `linearDepth()` — and the fade distance in metres. For a soft-particle
// material that is the entire wiring; there is no scene-depth argument.

import {
  cameraFar, cameraNear, clamp, float, max, mix, smoothstep, viewportLinearDepth,
} from 'three/tsl';

/** TSL's published typings model each node as a fixed swizzle view; the repo
 *  casts at call sites (explosion-vfx.ts:644-653, flame-cards.ts:366-377). */
interface Tsl {
  mul(v: Tsl | number): Tsl;
  sub(v: Tsl | number): Tsl;
  add(v: Tsl | number): Tsl;
  div(v: Tsl | number): Tsl;
}
type N = never;

/**
 * The pure falloff, in metres — the arithmetic the node graph is built from, so
 * the shape is testable without a GPU. 0 where the fragment has reached the
 * scene surface, rising linearly to 1 at `fadeM` metres in front of it.
 *
 * `fadeM <= 0` (the disabled switch) and a non-finite fade both return 1: an
 * inert fade must never divide by zero or turn the frame black.
 */
export function softFade01(fragM: number, sceneM: number, fadeM: number): number {
  if (!(fadeM > 0)) return 1;
  const t = (sceneM - fragM) / fadeM;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * The TSL soft-particle fade for `fragLinearDepth01` (the fragment's own
 * `linearDepth()`), faded over `fadeMetres`. Returns a 0..1 node: 1 far from
 * the scene, 0 where the fragment meets it, 1 everywhere when `fadeMetres` is 0.
 *
 * The SCENE side is `viewportLinearDepth` — see the header. Both are unfolded
 * to metres with the camera's near/far before the comparison, so the fade
 * distance is a real distance rather than a fraction of the depth range.
 */
export function softParticleFade(fragLinearDepth01: Tsl, fadeMetres: Tsl): Tsl {
  const nearM = cameraNear as unknown as Tsl;
  const spanM = (cameraFar as unknown as Tsl).sub(nearM as N) as unknown as Tsl;
  // The scene fragment at this pixel, from the depth TEXTURE (the guard).
  const sceneM = nearM.add(
    (viewportLinearDepth as unknown as Tsl).mul(spanM as N) as N,
  ) as unknown as Tsl;
  const fragM = nearM.add(
    (fragLinearDepth01 as Tsl).mul(spanM as N) as N,
  ) as unknown as Tsl;
  // fadeOn keeps a 0 metre setting fully inert — no divide, no change.
  const fadeOn = smoothstep(0.0, 1e-5, fadeMetres as N) as unknown as Tsl;
  const soft = clamp(
    sceneM.sub(fragM as N).div(max(fadeMetres as N, 1e-4) as N) as N,
    0.0, 1.0,
  ) as unknown as Tsl;
  return mix(float(1) as N, soft as N, fadeOn as N) as unknown as Tsl;
}
