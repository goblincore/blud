// src/lab/sdf-zombie/characters/goblin-head-profile.ts
//
// The goblin head's REST profile as seven reach probes, measured 2026-10-13 on the head BEFORE the jaw split (expression pass,
// docs/superpowers/plans/2026-10-13-goblin-expressions.md). The split puts the lower face on a `jaw` bone; the owner approved the
// head as it stood, so at rest the silhouette has to land where it did. Each probe walks from a point INSIDE the flesh along a
// direction until the field turns positive (the same 0.5 mm march goblin-blob.test.ts's `reach` uses) and reports the distance.
// Used by goblin-blob.test.ts and scripts/goblin-head-profile.ts (the tuning loop).
import { sdBody } from '../validate';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';

/** How far a probe may drift from its pinned value, metres. */
export const PROFILE_TOL = 0.003;

export interface ProfileProbe {
  name: string;
  from: Vec3;
  dir: Vec3;
  /** Pinned reach, metres. */
  want: number;
}

export const PROFILE_PROBES: readonly ProfileProbe[] = [
  // Front of the face, x = 0, going forward from the head's axis: chin, lower lip, mouth groove.
  { name: 'front y1.09 (chin)', from: [0, 1.09, 0], dir: [0, 0, 1], want: 0.1025 },
  { name: 'front y1.11 (lower lip)', from: [0, 1.11, 0], dir: [0, 0, 1], want: 0.118 },
  { name: 'front y1.13 (groove)', from: [0, 1.13, 0], dir: [0, 0, 1], want: 0.116 },
  // Half-width of the face at three heights, going out from the axis.
  { name: 'half-width y1.10', from: [0, 1.10, 0.03], dir: [1, 0, 0], want: 0.054 },
  { name: 'half-width y1.15', from: [0, 1.15, 0.03], dir: [1, 0, 0], want: 0.074 },
  { name: 'half-width y1.20', from: [0, 1.20, 0.03], dir: [1, 0, 0], want: 0.0855 },
  // The underside of the chin, going down.
  { name: 'chin underside', from: [0, 1.10, 0.07], dir: [0, -1, 0], want: 0.029 },
];

/** Distance from `p` along unit `d` to where the body's field turns positive, 0.5 mm steps. NaN if `p` starts outside the
 *  body or the ray never leaves it within `max`. */
export function reachOf(body: BuildResult, p: Vec3, d: Vec3, max = 0.3): number {
  if (sdBody(p, body) > 0) return NaN;
  for (let t = 0; t < max; t += 0.0005)
    if (sdBody([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t], body) > 0) return t;
  return NaN;
}

export function measureProfile(body: BuildResult): { probe: ProfileProbe; got: number }[] {
  return PROFILE_PROBES.map(probe => ({ probe, got: reachOf(body, probe.from, probe.dir) }));
}
