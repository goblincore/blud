// src/lab/sdf-zombie/webgpu/axe-head.ts
//
// HEAD CHOPS (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §4). Pure, per actor. Every axe chop
// that lands on the head region stamps a deep head-tagged cut (game-axe.ts) and counts here; the chopsToKill-th chop
// kills (ZombieActor.blast forceCollapse). Head chops do not feed the body's collapse meter: the count kills, which
// keeps the rhythm readable. Part B, the head split: chop 1 opens the head, later chops widen it and the kill chop
// throws it fully open (chopOpenFrac); the split's own state and spring live in head-split.ts / game-head-split.ts.
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
