// src/lab/sdf-zombie/webgpu/axe-head.ts
//
// HEAD CHOPS (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §4). Pure, per actor. Every axe chop
// that lands on the head (chopOnHead: on head flesh, not the flail's wider head region) counts here; the chopsToKill-th chop kills (ZombieActor.blast forceCollapse). Head
// chops do not feed the body's collapse meter: the count kills, which keeps the rhythm readable.
// THE HEAD SPLIT: chop 1 opens the head, later chops widen it and the kill chop throws it fully open (chopOpenFrac);
// the split's own state and spring live in head-split.ts / game-head-split.ts. What a head chop cuts is headChopCut:
// the split's faces when it opens the head, its own deep head-tagged cut on a head that is not split or on an open
// head's outer skin, nothing on a cut face or through the gap (the widening is the effect there).
import { HEAD_SPLIT } from '../head-split';
import type { LimbId } from '../types';

export const AXE_HEAD = {
  /** The owner's debug default (2026-10-04: "a bit more tough for debug"): split (part B) on 1, wider on 2, kill on 3. */
  chopsToKill: 3,
  /** The split's opening after each chop before the kill, as fractions of the preset's max angle (head-split.ts). */
  openAngles: [0.55, 0.8],
} as const;

export interface AxeHeadState {
  /** Head chops so far. */
  chops: number;
  /** The kill has fired. */
  dead: boolean;
}

export function makeAxeHead(): AxeHeadState { return { chops: 0, dead: false }; }

/** One head chop: the new state, what it does, and its 1-based number (the cut's unique headRegion). */
export function chopHead(st: AxeHeadState, chopsToKill: number = AXE_HEAD.chopsToKill): { state: AxeHeadState; action: 'cut' | 'kill'; chop: number } {
  const chops = st.chops + 1;
  const kill = !st.dead && chops >= chopsToKill;
  return { state: { chops, dead: st.dead || kill }, action: kill ? 'kill' : 'cut', chop: chops };
}

/** How far the head split stands open after head chop `chop` (1-based), as a fraction of its preset's max: the
 *  openAngles in turn (the last one holds when there are more chops than angles), and 1 from the kill chop on. */
export function chopOpenFrac(chop: number, chopsToKill: number = AXE_HEAD.chopsToKill, angles: readonly number[] = AXE_HEAD.openAngles): number {
  if (chop >= chopsToKill || angles.length === 0) return 1;
  return angles[Math.min(Math.max(chop, 1), angles.length) - 1]!;
}

/** A CHOP IS ON THE HEAD when the flesh it lands on is the head's: `limb` is the limb of the prim nearest the hit (the
 *  un-warped hit, on a split head). Only such a chop is a head chop: it counts toward the kill and opens or widens the
 *  split. Not the flail's head region (flail-strike.ts isHeadRegion), which also takes anything within 0.2 m of the
 *  neck root: right for a blunt weapon's head ladder, and it made a chop on the upper chest split the skull.
 *  Measured on the posed zombie (2700 chops from twelve bearings and three eye heights, aimed up the neck and head):
 *  every hit on a head prim lies within 0.168 m of the skull centre, down to 4.7 cm above the neck root (the jaw and
 *  the upper neck); the collar, the chest and the neck's base are torso prims, the nearest of them 0.156 m from it.
 *  The strike's head magnet needs no clause of its own: its point is on the head's own field, and is a head chop
 *  where that is head flesh and a body chop where it is the neck's base in the shoulders. */
export function chopOnHead(limb: LimbId | undefined): boolean {
  return limb === 'head';
}

/** The cut a head chop leaves. `opened`: this chop opened the head (game-head-split.ts open accepted it). `closedDist`:
 *  the CLOSED head's field at the un-warped hit when the head was split open as the chop landed, null when it was not.
 *    'faces'  the chop opened the head: the split's cut faces are its cut;
 *    'own'    its own cut along the blade line: any head that is not split, and an open head hit on its OUTER skin
 *             (the closed field within HEAD_SPLIT.skinEps of zero);
 *    'none'   an open head hit on a cut face or through the gap: the un-warped hit is deep inside the closed head (or
 *             off it), where a cut would be anchored centimetres away on the scalp. The faces bleed again instead. */
export function headChopCut(opened: boolean, closedDist: number | null): 'faces' | 'own' | 'none' {
  if (opened) return 'faces';
  return closedDist === null || Math.abs(closedDist) <= HEAD_SPLIT.skinEps ? 'own' : 'none';
}
