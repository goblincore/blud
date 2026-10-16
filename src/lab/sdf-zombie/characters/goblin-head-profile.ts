// src/lab/sdf-zombie/characters/goblin-head-profile.ts
//
// The goblin head's REST profile as seven reach probes, measured 2026-10-13 on the head BEFORE the jaw split (expression pass,
// docs/superpowers/plans/2026-10-13-goblin-expressions.md). The split puts the lower face on a `jaw` bone; the owner approved the
// head as it stood, so at rest the silhouette has to land where it did. Each probe walks from a point INSIDE the flesh along a
// direction until the field turns positive (the same 0.5 mm march goblin-blob.test.ts's `reach` uses) and reports the distance.
// Used by goblin-head-profile.test.ts, goblin-cinematic-blob.test.ts and scripts/goblin-head-profile.ts (the tuning loop).
//
// TWO SETS SINCE TASK 13 (2026-10-15): the face rig moved to goblin-cinematic.blob and the base goblin.blob went back to its
// pre-expression head (f81e5b10). GOBLIN_PROFILE_PROBES are the original Task 1 pins, which the base goblin must keep;
// CINEMATIC_PROFILE_PROBES are the variant's, the same probes with the Task 3b re-pin (the mouth line) and, since Task 21, the
// chin underside swapped for two throat probes (the throat fill under the chin: eight probes).
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

/** The base goblin's head (goblin.blob), as pinned before the jaw split: these numbers never move. */
export const GOBLIN_PROFILE_PROBES: readonly ProfileProbe[] = [
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

/** The cinematic goblin's head (goblin-cinematic.blob): the base pins with the mouth line re-pinned by Task 3b. */
export const CINEMATIC_PROFILE_PROBES: readonly ProfileProbe[] = [
  // Front of the face, x = 0, going forward from the head's axis: chin, lower lip, mouth groove.
  { name: 'front y1.09 (chin)', from: [0, 1.09, 0], dir: [0, 0, 1], want: 0.1025 },
  { name: 'front y1.11 (lower lip)', from: [0, 1.11, 0], dir: [0, 0, 1], want: 0.118 },
  // RE-PINNED 2026-10-14 (Task 3b, the grin): 0.116 -> 0.121. The groove that cut a 5 mm channel here is gone (it carved the
  // teeth whenever the jaw opened) and the mouth now opens AT this line, so the lips meet here instead of a groove. The painted
  // sheet mouth draws the line now. Name kept so the history reads.
  { name: 'front y1.13 (groove)', from: [0, 1.13, 0], dir: [0, 0, 1], want: 0.121 },
  // Half-width of the face at three heights, going out from the axis.
  { name: 'half-width y1.10', from: [0, 1.10, 0.03], dir: [1, 0, 0], want: 0.054 },
  { name: 'half-width y1.15', from: [0, 1.15, 0.03], dir: [1, 0, 0], want: 0.074 },
  { name: 'half-width y1.20', from: [0, 1.20, 0.03], dir: [1, 0, 0], want: 0.0855 },
  // RE-PINNED 2026-10-16 (Task 21, owner: "there's still this like disk neck throat bulge thing going on that i would like to
  // smooth out/remove"): the 'chin underside' probe (down from (0, 1.10, 0.07), 0.029) measured the flat shelf that WAS the disc.
  // The throat fill (goblin-cinematic.blob, under the chin) tapers the chin into the neck, so that ray now runs on down the
  // throat's front and never leaves the flesh. Replaced by the throat line itself: its front at y 1.07 (was 0.069, the neck's
  // front just under the shelf) and its half-width at y 1.075 (was 0.0385). The base goblin keeps its 'chin underside' pin.
  { name: 'throat front y1.07', from: [0, 1.07, 0], dir: [0, 0, 1], want: 0.086 },
  { name: 'throat half-width y1.075', from: [0, 1.075, 0.03], dir: [1, 0, 0], want: 0.0455 },
];

/** Distance from `p` along unit `d` to where the body's field turns positive, 0.5 mm steps. NaN if `p` starts outside the
 *  body or the ray never leaves it within `max`. */
export function reachOf(body: BuildResult, p: Vec3, d: Vec3, max = 0.3): number {
  if (sdBody(p, body) > 0) return NaN;
  for (let t = 0; t < max; t += 0.0005)
    if (sdBody([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t], body) > 0) return t;
  return NaN;
}

/** The probe set for a .blob `model` name: the cinematic goblin's, or the base goblin's for anything else. */
export function profileProbesFor(model: string): readonly ProfileProbe[] {
  return model === 'goblin-cinematic' ? CINEMATIC_PROFILE_PROBES : GOBLIN_PROFILE_PROBES;
}

export function measureProfile(body: BuildResult, probes: readonly ProfileProbe[]): { probe: ProfileProbe; got: number }[] {
  return probes.map(probe => ({ probe, got: reachOf(body, probe.from, probe.dir) }));
}
