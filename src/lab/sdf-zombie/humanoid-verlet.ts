// src/lab/sdf-zombie/humanoid-verlet.ts
//
// Task 3 — the humanoid's verlet recoil layer. One point per manifest.bones[]
// entry, seeded at that bone's bind origin; one distance constraint per
// parent/child pair at its bind length; the root (Hips) is pinned so the body
// does not drift. `impulseAtBone` mirrors the procedural zombie's
// `rig-bind.ts` `impulseAt` exactly (nearest UNPINNED point, add the delta to
// `pos` only — never to `prev`, because the gap between them IS the velocity);
// the rest-pose spring pulls it back, so the limb recoils and lags. This is
// the plain-click feel ported from `webgpu/lab-main.ts:902`:
//
//     const push = type === 'blast' ? 0.16 : type === 'pellet' ? 0.06 : 0.04;
//     bound = impulseAt(bound, hit, [d.x * push, d.y * push, d.z * push]);
//
// PURE. State-in/state-out: `stepHumanoidVerlet` and `impulseAtBone` never
// mutate their input, and identical input sequences produce identical output.
// The layer supplies TRANSLATION only — rotation stays with the elbow model.

import type { Vec3 } from './types';
import type { HumanoidVolumeManifest } from './webgpu/humanoid-volume';

/**
 * Velocity retention per step. The plan pins this at 0.86 and the step
 * integrates `pos += (pos − prev) * damping`, so the velocity keeps 86% of
 * itself each step — close to the procedural zombie's 0.94 (its rig runs
 * `damping: 0.06` as a BLEED, i.e. `vel *= 1 − 0.06`).
 */
export const HUMANOID_VERLET_DAMPING = 0.86;
/**
 * Rest-pose pull per 1/60 s step: each step a point is pulled this fraction
 * of the way back toward its bind origin (frame-rate scaled by `dt * 60`).
 *
 * NOTE vs the plan: the plan's draft listed 0.5, but 0.5 is inconsistent with
 * the plan's own "propagates to the child bone, so the limb lags" test — a
 * 0.5-per-step pull snaps the forearm back to bind in ~3 frames, so by step 8
 * the hand has re-crossed zero (|dx| ≈ 0.0006, below the 0.001 assertion).
 * 0.18 is the procedural zombie's tuned `restStiffness` (motion.ts /
 * lab-main.ts), the exact feel this pass is porting, and it clears the lag
 * test with ~7.5× margin.
 */
export const HUMANOID_VERLET_STIFFNESS = 0.18;
/** Distance-constraint relaxation passes per step. */
export const HUMANOID_VERLET_ITERATIONS = 4;

/** One verlet point per bone, in manifest.bones[] array order. */
export interface HumanoidVerletState {
  /** Current verlet point per bone (seeded at the bind origin). */
  positions: readonly Vec3[];
  /** Previous-step positions; positions[i] − prevPositions[i] is the velocity. */
  prevPositions: readonly Vec3[];
  /** Bind-pose origins — the rest pose each point is pulled toward. */
  bindOrigins: readonly Vec3[];
  /** Rest length per bone: bind distance to its parent (0 for the root). */
  restLengths: readonly number[];
  /** Parent index per bone (−1 for the pinned root). */
  parentIndices: readonly number[];
  /** Pinned points are held fixed at their bind origin (the root). */
  pinned: readonly boolean[];
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Builds the verlet layer from the manifest: one point per bone at its bind
 * origin, a rest length per parent/child pair, and the root pinned.
 */
export function makeHumanoidVerlet(manifest: HumanoidVolumeManifest): HumanoidVerletState {
  const bindOrigins: Vec3[] = manifest.bones.map(b => [
    b.bindToModel[12]!, b.bindToModel[13]!, b.bindToModel[14]!,
  ]);
  const parentIndices = manifest.bones.map(b => b.parentIndex);
  const pinned = manifest.bones.map(b => b.parentIndex === -1);
  const restLengths = manifest.bones.map((b, i) => {
    const p = parentIndices[i]!;
    if (p === -1) return 0;
    const a = bindOrigins[i]!;
    const c = bindOrigins[p]!;
    return Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
  });
  return {
    positions: bindOrigins.map(o => [...o] as Vec3),
    prevPositions: bindOrigins.map(o => [...o] as Vec3),
    bindOrigins,
    restLengths,
    parentIndices,
    pinned,
  };
}

/**
 * One Verlet step: integrate (velocity retention), pull toward the bind
 * origin, then relax the distance constraints holding pinned points fixed.
 * `dt <= 0` or non-finite `dt` is a no-op returning the same state. Pure.
 */
export function stepHumanoidVerlet(state: HumanoidVerletState, dt: number): HumanoidVerletState {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  // Frame-rate independent rest pull: at 1/60 s this equals STIFFNESS.
  const st = clamp01(HUMANOID_VERLET_STIFFNESS * dt * 60);

  const positions: Vec3[] = state.positions.map((p, i) => {
    if (state.pinned[i]) return [...p] as Vec3;
    const prev = state.prevPositions[i]!;
    const bind = state.bindOrigins[i]!;
    // integrate: pos += (pos − prev) * damping
    let x = p[0] + (p[0] - prev[0]) * HUMANOID_VERLET_DAMPING;
    let y = p[1] + (p[1] - prev[1]) * HUMANOID_VERLET_DAMPING;
    let z = p[2] + (p[2] - prev[2]) * HUMANOID_VERLET_DAMPING;
    // pull toward the bind origin
    x += (bind[0] - x) * st;
    y += (bind[1] - y) * st;
    z += (bind[2] - z) * st;
    return [x, y, z] as Vec3;
  });

  for (let it = 0; it < HUMANOID_VERLET_ITERATIONS; it++) {
    for (let i = 0; i < positions.length; i++) {
      const pIdx = state.parentIndices[i]!;
      if (pIdx === -1) continue;
      const a = positions[i]!;    // child
      const b = positions[pIdx]!; // parent
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      const dz = a[2] - b[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1e-12) continue;
      const diff = (dist - state.restLengths[i]!) / dist;
      const ci = state.pinned[i] ? 0 : 0.5;
      const cp = state.pinned[pIdx] ? 0 : 0.5;
      positions[i] = [a[0] - dx * diff * ci, a[1] - dy * diff * ci, a[2] - dz * diff * ci] as Vec3;
      positions[pIdx] = [b[0] + dx * diff * cp, b[1] + dy * diff * cp, b[2] + dz * diff * cp] as Vec3;
    }
  }

  // Pinned points are held exactly at their bind origin (no drift, no velocity).
  for (let i = 0; i < positions.length; i++) {
    if (state.pinned[i]) positions[i] = [...state.bindOrigins[i]!] as Vec3;
  }

  return { ...state, positions, prevPositions: state.positions };
}

/**
 * Displaces the nearest UNPINNED verlet point by `delta` — mirrors
 * `rig-bind.ts` `impulseAt` exactly. `delta` is added to `pos` only, never to
 * `prev`, so the impulse becomes velocity for the next step. Pure.
 */
export function impulseAtBone(
  state: HumanoidVerletState,
  worldPoint: Vec3,
  delta: Vec3,
): HumanoidVerletState {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < state.positions.length; i++) {
    if (state.pinned[i]) continue;
    const p = state.positions[i]!;
    const d = Math.hypot(
      p[0] - worldPoint[0], p[1] - worldPoint[1], p[2] - worldPoint[2],
    );
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best === -1) return state; // every point pinned (degenerate)
  const positions = state.positions.map((p, i) => i === best
    ? [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]] as Vec3
    : [...p] as Vec3);
  return { ...state, positions };
}

/** The current verlet point per bone (a fresh array; the Vec3s are shared). */
export function verletBonePositions(state: HumanoidVerletState): Vec3[] {
  return [...state.positions];
}
