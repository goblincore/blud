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
//
// WHY LIGHTING LEGS. The dungeon relighting (2026-09-01) added a flashlight
// and shadow mapping to the same page, and their frame cost was UNMEASURED —
// the spec calls task 9 a gate, not a report. The three dungeon scenarios
// below are the A/B/C: same firefight script, three lighting states, so any
// delta between them is lighting and nothing else. `rig` carries the ACTUAL
// rig object (not a name) because the off-state parity gate has to assert
// dungeon-off drives the same values the gallery shipped with — a string
// would make that a tautology.
//
// HOW A LEG APPLIES. The data crosses to the page through the __dungeon
// seam: rig GALLERY_RIG <=> setDungeon(false) (the page's applyRig hides the
// spot with it); castShadow is a BOOT decision (?spotshadow=0) because
// toggling spot.castShadow live crashes three r185 WebGPU (disposed shadow
// map) and shadow.intensity=0 still RENDERS the map — it only zeroes the
// sampling term, which would measure the wrong split.
import { DEFAULT_BONE_RATIO } from '../bone-derive';
import { DUNGEON_RIG, GALLERY_RIG, type AmbientRig } from './dungeon-lighting';

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

/**
 * How often the fire segment re-aims and shoots, and with how many barrels.
 *
 * MEASURED THE HARD WAY (2026-08-31). The first draft fired BOTH barrels every
 * 20 frames: six double blasts over the segment shredded all four of room 4's
 * zombies into collapsed corpses within the first second. The bench then
 * reported fire and gib at ~9 ms against walk at ~40 ms and looked like the
 * firing segments were cheap — they were measuring an empty room.
 *
 * One barrel every 40 frames accumulates craters on bodies that are still
 * standing and still rendering, which is the cost this bench exists to find.
 * The per-segment census in the result is what makes that checkable rather
 * than assumed: if bodiesOnScreen collapses mid-run, the run is not
 * describing a firefight.
 */
const FIRE_PERIOD = 40;
const FIRE_BARRELS: 1 | 2 = 1;

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
    steps.push({ at: f + 1, action: { kind: 'fire', barrels: FIRE_BARRELS } });
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

// ---------------------------------------------------------------------------
// CLOSEUP BENCH SCENARIO — a STATIC frozen frame, no shots.
// ---------------------------------------------------------------------------

export interface CloseupOpts {
  /** Sampled frames. The whole run is one segment. */
  frames?: number;
}

export const CLOSEUP_DEFAULTS = {
  frames: 240,
} as const;

/**
 * The close-up diagnostic scene (2026-09-04 close-up task 1): ONE body
 * filling the screen, frozen, with the driver's staging already applied
 * (pose + stamped wounds) BEFORE the bench starts.
 *
 * Deliberately unlike the firefight: no teleport (it would override the
 * staged camera), no aim/fire (more damage would change the wound set
 * mid-run), and freeze ON at frame 0 (a moving body changes pixel coverage
 * frame to frame, which is measurement noise, not signal — the firefight
 * legs keep the wander because steady-state GAME cost is their question;
 * here the question is the fixed frame's march/shading split).
 */
export function buildCloseup(opts: CloseupOpts = {}): Scenario {
  const frames = opts.frames ?? CLOSEUP_DEFAULTS.frames;
  return {
    frames,
    steps: [{ at: 0, action: { kind: 'freeze', on: true } }],
    segments: [{ name: 'closeup', from: 0, to: frames }],
  };
}

// ---------------------------------------------------------------------------
// DUNGEON BENCH LEGS — same firefight, three lighting states.
// ---------------------------------------------------------------------------

/** The lighting state a bench run runs under. Pure data: the driver applies
 *  it through the page's seams, nothing here touches three. */
export interface LightingLeg {
  /** Rig values driving the page lights. `dungeon-off` pins GALLERY_RIG —
   *  that identity IS the off-state parity gate. */
  rig: AmbientRig;
  /** Weapon-mounted flashlight lit? */
  flashlight: boolean;
  /** Spot shadow map on? Only ever true with the flashlight. */
  castShadow: boolean;
}

/** A firefight script plus the lighting state it runs under. The script is
 *  IDENTICAL across all three legs — deltas between legs are lighting only. */
export interface BenchScenario extends Scenario, LightingLeg {
  name: DungeonScenarioName;
}

export const DUNGEON_SCENARIOS = [
  'dungeon-off',
  'dungeon-no-shadow',
  'dungeon-shadow',
] as const;

export type DungeonScenarioName = (typeof DUNGEON_SCENARIOS)[number];

// ---------------------------------------------------------------------------
// WOUND BENCH LEGS — same firefight, three feature states (wound pass r2,
// spec §4 gate 7). NOT a gate: a measurement. The bone fold may cost less
// than the bench's 5–11% within-run spread; if the delta lands under the
// spread the honest report is UNRESOLVED, and the amplitude guards
// (woundDepthAmp 0 / boneRatio 0 — each restores the
// previous shading bit-for-bit) are what contain the cost instead.
// ---------------------------------------------------------------------------

/** The wound-feature state a bench run runs under. Same separation as
 *  LightingLeg: pure data — the driver applies it through the page's
 *  setWoundTuning seam, nothing here touches the page.
 *
 *  WHY THE PIN. The lighting runs carried 8 bodies through the fire segment
 *  in one run and 5 in another, and cross-run absolute numbers drift ~45% on
 *  machine state alone (see docs/dev-notes/2026-09-01-wound-r2/
 *  bench-baseline.md). Either drift can exceed the effect being measured, so
 *  the legs carry the workload they bench as data, and the test fails if a
 *  leg drifts from the others. */
export interface WoundLeg {
  /** Wound-creating shots the script schedules (the buckshot re-aims plus
   *  the slug). Counted from the built script, not hardcoded, so editing the
   *  fire schedule moves the pin — and fails the leg test — rather than
   *  silently benching a different workload. The REALISED wound count still
   *  varies with where the wanderers stand when the shots land; the runner
   *  reports that census per leg. */
  woundCount: number;
  /** Zombies the room spawns (room 4 = 4). The on-screen census runs higher
   *  — the ring's sightlines — and varies with the wander; the pin is the
   *  population the workload is defined by, the same number every other
   *  bench row records as `bodies`. */
  bodyCount: number;
  /** Tissue-depth ramp amplitude. 0 = the pre-r2 flat lerp. */
  woundDepthAmp: number;
  /** Derived-bone ratio. 0 = no bone geometry, the fold never runs. */
  boneRatio: number;
}

export interface WoundBenchScenario extends Scenario, WoundLeg {
  name: WoundScenarioName;
}

export const WOUND_SCENARIOS = [
  'wounds-off',
  'wounds-no-bone',
  'wounds-bone',
] as const;

export type WoundScenarioName = (typeof WOUND_SCENARIOS)[number];

// Room 4 (four zombies) for every leg: the worst case is what a frame budget
// is about, and a shared room keeps the three columns comparable.
const LEG_ROOM = 4;

/** The named lighting legs. Every call rebuilds the firefight so no leg can
 *  be mutated in place through the shared object. */
export function scenarioByName(name: DungeonScenarioName): BenchScenario;
export function scenarioByName(name: WoundScenarioName): WoundBenchScenario;
export function scenarioByName(
  name: DungeonScenarioName | WoundScenarioName,
): BenchScenario | WoundBenchScenario {
  const base = buildFirefight({ room: LEG_ROOM });
  // The wound legs' workload pin, counted from THIS script (see WoundLeg).
  const woundShots = base.steps.filter(
    s => s.action.kind === 'fire' || s.action.kind === 'fireSlug',
  ).length;
  switch (name) {
    case 'dungeon-off':
      // Off-state parity: the gallery's own rig, no flashlight, no shadows.
      return { ...base, name, rig: GALLERY_RIG, flashlight: false, castShadow: false };
    case 'dungeon-no-shadow':
      // Full dungeon look, shadow pipeline ablated — the baseline the cost
      // gate (<= +40% for shadows) is measured against.
      return { ...base, name, rig: DUNGEON_RIG, flashlight: true, castShadow: false };
    case 'dungeon-shadow':
      // What ships.
      return { ...base, name, rig: DUNGEON_RIG, flashlight: true, castShadow: true };
    case 'wounds-off':
      // Pre-r2 state: every r2 amplitude at 0. The driver additionally
      // (the torn-fibre pass was cut 2026-09-02; nothing to zero) — it never ran on standing
      // bodies before r2, so the off leg must ablate it too.
      return { ...base, name, woundCount: woundShots, bodyCount: LEG_ROOM, woundDepthAmp: 0, boneRatio: 0 };
    case 'wounds-no-bone':
      // Full r2 shading, bone geometry ablated — the baseline the fold's
      // cost is measured against.
      return { ...base, name, woundCount: woundShots, bodyCount: LEG_ROOM, woundDepthAmp: 1, boneRatio: 0 };
    case 'wounds-bone':
      // What ships: r2 shading plus derived bone at the doc's default ratio.
      return { ...base, name, woundCount: woundShots, bodyCount: LEG_ROOM, woundDepthAmp: 1, boneRatio: DEFAULT_BONE_RATIO };
  }
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
