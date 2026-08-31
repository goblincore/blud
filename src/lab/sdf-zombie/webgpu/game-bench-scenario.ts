// src/lab/sdf-zombie/webgpu/game-bench-scenario.ts
//
// The scripted firefight, as DATA. Pure on purpose: the harness that runs it
// needs a GPU, the shape of it does not, so the invariants that actually bite
// (every frame belongs to a segment; no shot is fired without a surface aim)
// are testable in vitest without a browser.
//
// WHY SEGMENTS. The owner's target is "stable 30", which is a question about
// WHICH MOMENT breaks the budget, not about an average. A run that reports one
// number cannot answer it — walking, firing and gibbing have to be reported
// apart or the expensive moment is averaged away by the cheap one.
//
// WHY aimSurface IS ITS OWN ACTION. A torso cluster centre sits INSIDE the
// field: aiming there anchors the crater pathologically and a slug's
// severRadius cuts both hip necks into instant collapse. That is never
// player-visible (the page's predictor always aims at surfaces) but it would
// silently corrupt a bench.

/** One thing the harness asks the page to do, between frames. */
export type BenchAction =
  | { kind: 'teleport'; room: number }
  | { kind: 'freeze'; on: boolean }
  | { kind: 'look'; yaw: number; pitch: number }
  | { kind: 'aimSurface' }
  | { kind: 'fire'; barrels: 1 | 2 }
  | { kind: 'fireSlug' };

export interface ScenarioStep { at: number; action: BenchAction }

/** A named span of frames, [from, to). Reported separately. */
export interface Segment { name: string; from: number; to: number }

export interface Scenario {
  frames: number;
  steps: ScenarioStep[];
  segments: Segment[];
}

export interface FirefightOpts {
  /** Which room to stand in. Rooms 1-4 hold 1/2/3/4 zombies. */
  room: number;
  /** Frames spent walking before the first shot. */
  walkFrames?: number;
  /** Frames spent firing buckshot. */
  fireFrames?: number;
  /** Frames spent after the slug that severs — chunks in flight. */
  gibFrames?: number;
}

export const FIREFIGHT_DEFAULTS = {
  walkFrames: 120,
  fireFrames: 120,
  gibFrames: 120,
} as const;

/** How often the fire segment re-aims and shoots. */
const FIRE_PERIOD = 20;

/**
 * The script. Three segments, in the order a real encounter runs them:
 *
 *   walk — bodies wandering, nothing fired. The steady-state cost.
 *   fire — buckshot every FIRE_PERIOD frames, so wounds accumulate on live
 *          bodies.
 *   gib  — a slug that severs, then the chunks fly. The spike suspect.
 *
 * Wanderers are LEFT RUNNING (freeze off). A frozen bench would be more
 * repeatable and would measure the wrong thing: the rig step and the hull
 * rebuild are part of the frame this budget has to hold.
 */
export function buildFirefight(opts: FirefightOpts): Scenario {
  const walkFrames = opts.walkFrames ?? FIREFIGHT_DEFAULTS.walkFrames;
  const fireFrames = opts.fireFrames ?? FIREFIGHT_DEFAULTS.fireFrames;
  const gibFrames = opts.gibFrames ?? FIREFIGHT_DEFAULTS.gibFrames;

  const steps: ScenarioStep[] = [
    { at: 0, action: { kind: 'teleport', room: opts.room } },
    { at: 0, action: { kind: 'freeze', on: false } },
  ];

  // FIRE: re-aim then shoot, on a fixed period. Re-aiming each time matters —
  // the wanderers move, and a stale aim would start missing halfway through
  // the segment, quietly turning a firing bench into a walking one.
  const fireStart = walkFrames;
  const gibStart = fireStart + fireFrames;
  for (let f = fireStart; f + 1 < gibStart; f += FIRE_PERIOD) {
    steps.push({ at: f, action: { kind: 'aimSurface' } });
    steps.push({ at: f + 1, action: { kind: 'fire', barrels: 2 } });
  }

  // GIB: one slug, then let the chunks fly for the rest of the segment.
  steps.push({ at: gibStart, action: { kind: 'aimSurface' } });
  steps.push({ at: gibStart + 1, action: { kind: 'fireSlug' } });

  // Stable sort by frame: same-frame actions keep insertion order, which is
  // what actionsAt promises and what makes the script reproducible.
  steps.sort((a, b) => a.at - b.at);

  return {
    frames: walkFrames + fireFrames + gibFrames,
    steps,
    segments: [
      { name: 'walk', from: 0, to: fireStart },
      { name: 'fire', from: fireStart, to: gibStart },
      { name: 'gib', from: gibStart, to: gibStart + gibFrames },
    ],
  };
}

/** Every action scheduled for exactly this frame, in insertion order. */
export function actionsAt(s: Scenario, frame: number): BenchAction[] {
  return s.steps.filter(x => x.at === frame).map(x => x.action);
}

/** The segment a frame belongs to, or null if the segments leave it uncovered. */
export function segmentAt(s: Scenario, frame: number): string | null {
  const seg = s.segments.find(x => frame >= x.from && frame < x.to);
  return seg ? seg.name : null;
}

/**
 * Structural problems, as human-readable strings. Empty means sound.
 *
 * This exists because a scenario with a one-frame gap or an off-the-end step
 * still RUNS — it just silently drops samples on the floor, and the resulting
 * table looks entirely plausible.
 */
export function validateScenario(s: Scenario): string[] {
  const errs: string[] = [];
  const sorted = [...s.segments].sort((a, b) => a.from - b.from);
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.from > cursor) errs.push(`gap before frame ${seg.from}`);
    if (seg.from < cursor) errs.push(`overlap at frame ${seg.from}`);
    if (seg.to <= seg.from) errs.push(`empty segment ${seg.name}`);
    cursor = Math.max(cursor, seg.to);
  }
  if (cursor < s.frames) errs.push(`gap before frame ${s.frames}`);
  if (cursor > s.frames) errs.push(`segments run past frames=${s.frames}`);
  for (const st of s.steps) {
    if (st.at >= s.frames) errs.push(`step at frame ${st.at} is past frames=${s.frames}`);
    if (st.at < 0) errs.push(`step at negative frame ${st.at}`);
  }
  return errs;
}
