// src/lab/sdf-zombie/webgpu/axe-head.ts
//
// HEAD CHOPS (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §4). Pure, per actor. Every axe chop
// that lands on the head region counts here; the chopsToKill-th chop kills (ZombieActor.blast forceCollapse). Head
// chops do not feed the body's collapse meter: the count kills, which keeps the rhythm readable.
// THE HEAD SPLIT: chop 1 opens the head, later chops widen it and the kill chop throws it fully open (chopOpenFrac);
// the split's own state and spring live in head-split.ts / game-head-split.ts. What a head chop cuts is headChopCut:
// the split's faces when it opens the head, its own deep head-tagged cut on a head that is not split or on an open
// head's outer skin, nothing on a cut face or through the gap (the widening is the effect there).
import { HEAD_SPLIT } from '../head-split';

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
