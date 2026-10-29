// src/lab/sdf-zombie/gib-switch.ts
//
// THE LIVE-BODY -> GIB SWITCH (owner 2026-10-29: "explosion -> enemy damaged -> gibbed does not read as one
// sequence", mostly with dynamite that lands OFF the target). The frame-strip diagnosis (.lab-tmp/blast-gib/,
// docs/tasks/combat-and-gore.md "Blast-to-gib switch pass") found five breaks on the switch side; each fix is its
// own step so it can be judged alone: `?gibswitch=beat,blood,launch,shade,timing` (no param: DEFAULT_GIB_SWITCH;
// `none`: the old behaviour; `all`; or any comma list).
//  - beat:   the doomed body takes a visible hit reaction away from the blast during the pre-tear window
//            (gib-tear.ts `beatM`), and the pieces spawn where that shoved body is (it rides the rupture offsets).
//  - blood:  the spray comes from the body, on its blast side, aimed away from the blast, and a first spray
//            starts on the hit frame (blastBloodPlacement), not only at the swap.
//  - launch: pieces blow AWAY from the blast, violent close and a shove far, with a lower up floor
//            (gib-launch.ts gibBlastLaunchVelocity).
//  - shade:  the transition frame's pieces match the live body's look.
//  - timing: the swap lands nearer the explosion light's peak (GIB_SWITCH_TEAR_SEC).
// Gameplay is untouched by every step: who gibs, damage, AOE radius and piece counts are the resolver's.
// Pure: no three.js, no DOM.
import type { Vec3 } from './types';

export type GibSwitchStep = 'beat' | 'blood' | 'launch' | 'shade' | 'timing';
export const GIB_SWITCH_STEPS: readonly GibSwitchStep[] = ['beat', 'blood', 'launch', 'shade', 'timing'];

/** What a page with no `?gibswitch=` gets: the steps that were judged to read right. */
export const DEFAULT_GIB_SWITCH: readonly GibSwitchStep[] = ['beat', 'blood'];

/** The steps a `?gibswitch=` value turns on: absent or '' = DEFAULT_GIB_SWITCH, 'none', 'all', or a comma list
 *  (unknown names ignored). */
export function parseGibSwitch(param: string | null): ReadonlySet<GibSwitchStep> {
  if (param === null || param.trim() === '') return new Set(DEFAULT_GIB_SWITCH);
  if (param === 'all') return new Set(GIB_SWITCH_STEPS);
  if (param === 'none') return new Set();
  const known = new Set<string>(GIB_SWITCH_STEPS);
  return new Set(param.split(',').map(s => s.trim()).filter((s): s is GibSwitchStep => known.has(s)));
}

// --- beat ----------------------------------------------------------------------------------------------

/** The doomed body's blast() reaction gain (1 = exactly what a survivor gets). The body that dies is nearer the
 *  blast than any survivor, so it is struck a little harder. */
export const GIB_SWITCH_BEAT_GAIN = 1.3;

// --- blood ---------------------------------------------------------------------------------------------

/** The horizontal unit from the blast to `p`; null when `p` is (nearly) straight above/below it. */
export function awayFromBlastXZ(at: Vec3, p: Vec3): Vec3 | null {
  const dx = p[0] - at[0], dz = p[2] - at[2];
  const l = Math.hypot(dx, dz);
  return l < 1e-4 ? null : [dx / l, 0, dz / l];
}

export const GIB_SWITCH_BLOOD = {
  /** How far toward the blast from the torso centre the swap gout sits, metres (the body's blast-facing side). */
  sideM: 0.14,
  /** Up share of the spray axis: away-from-blast plus this much up, then normalized. */
  upK: 0.55,
  /** The hit-frame spray: the stump profile (fast, wide) at this count/speed share, off the torso surface. */
  hitSideM: 0.17,
  hitCountMul: 0.7,
  hitSpeedMul: 0.7,
  /** The swap gout: the owner's near-stationary slug goo, carried along with the pieces at this speed share. */
  swapSpeedMul: 5,
} as const;

/**
 * Where a blast's blood leaves a body and which way it goes. `torso` is the body's torso centre (as drawn),
 * `at` the blast. The anchor is on the blast-facing side of the torso; the SPRAY axis is away from the blast,
 * tipped up. `dirN` is in spawnImpactGout's convention (it sprays along -dirN), so pass it straight through.
 * A blast directly under the body has no side: the anchor is the torso centre and the spray goes straight up.
 */
export function blastBloodPlacement(torso: Vec3, at: Vec3, sideM: number = GIB_SWITCH_BLOOD.sideM,
  upK: number = GIB_SWITCH_BLOOD.upK): { anchor: Vec3; spray: Vec3; dirN: Vec3 } {
  const away = awayFromBlastXZ(at, torso);
  if (!away) return { anchor: [torso[0], torso[1], torso[2]], spray: [0, 1, 0], dirN: [0, -1, 0] };
  const anchor: Vec3 = [torso[0] - away[0] * sideM, torso[1], torso[2] - away[2] * sideM];
  const l = Math.hypot(1, upK);
  const spray: Vec3 = [away[0] / l, upK / l, away[2] / l];
  return { anchor, spray, dirN: [-spray[0], -spray[1], -spray[2]] };
}

// --- timing --------------------------------------------------------------------------------------------

/** The pre-tear window with `timing` on (an explicit `?gibtear=` still wins): the swap lands at ~90 ms, beside
 *  the explosion light's peak (~83 ms), instead of 217 ms. */
export const GIB_SWITCH_TEAR_SEC = 0.09;
