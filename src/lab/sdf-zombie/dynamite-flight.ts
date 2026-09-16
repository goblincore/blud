// src/lab/sdf-zombie/dynamite-flight.ts
//
// Pure ballistic integrator for a thrown dynamite bundle (spec §3): gravity,
// floor bounce and wall bounce with Blood's elastic feel, fuse countdown
// (impact + timer rules per the game), and a spin state for the cheap mesh
// prop. Mirrors the sim kThing mover (src/sim/thing.ts) and the sim projectile
// fuse rules (src/sim/projectile.ts) WITHOUT importing them — the sim modules
// own SimState, which the lab doesn't have. All game numbers arrive as data:
// DYNAMITE_COOK + BALLISTIC_BOUNDS from src/game/gibs/tuning.ts; gravity /
// elastic / rest-speed from the kThing mover's documented comments (cited
// below, not imported); the light airdrag from tuning.ts's source-sim note
// (actAirDrag a2=128 ≈ 0.2%/tic) — the source sim that produced the ~68 m
// full-charge reach (which tuned the 6→28 m/s band) included that drag, so
// reproducing the reach requires it.
//
// stepFlight(state, dt) is a pure (state, dt) → state function; detonation is
// NOT resolved here — the wiring polls detonated(state) and runs the gore
// stack. Deterministic: no Date.now, no Math.random, fixed 120 Hz sub-steps
// (the sim's own tic rate), so identical inputs yield identical trajectories.
import type { Vec3 } from './types';
import { BALLISTIC_BOUNDS, DYNAMITE_COOK } from '../../game/gibs/tuning';

/** Arena rectangle on the ground plane (injected; defaults to BALLISTIC_BOUNDS). */
export interface FlightBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** One solid box to bounce off. Structurally identical to game-level.ts's
 *  `Aabb` — declared here so this pure module never imports the level. */
export interface FlightBox {
  min: Vec3;
  max: Vec3;
}

/**
 * The WORLD a bundle flies through, beyond the floor plane. Optional and
 * defaulted, so the lab's arena-rect flight is bit-identical to before this
 * existed (the arena has no boxes and no ceiling).
 *
 * The dungeon passes `colliders: levelColliders()` — every wall, lintel, arch
 * step and furniture box the player already collides with — plus `ceilM`, the
 * room ceiling. Together those are the whole level: the tunnel lintels are
 * boxes spanning 2.2 → 3.0 m, so a ceiling plane at the room height plus the
 * boxes reproduces the real geometry, including the low tunnel mouths.
 */
export interface FlightWorld {
  /** Solid boxes, from game-level.ts's `levelColliders()`. */
  colliders?: readonly FlightBox[];
  /** Ceiling plane height (m); null/undefined = open sky. */
  ceilM?: number | null;
  /** Bundle collision radius (m); defaults to FLIGHT_TUNING.bundleRadiusM. */
  bundleRadiusM?: number;
}


export interface FlightState {
  /** Bundle center, meters; the floor is at y = 0. */
  pos: Vec3;
  /** Velocity, m/s. */
  vel: Vec3;
  /** Seconds of fuse remaining before timer detonation. */
  fuse: number;
  /** Seconds since spawn (drives the impact grace window). */
  age: number;
  /** Spawn origin (drives the impact safe-distance rule). */
  spawn: Vec3;
  /** Prop roll angle, radians (visual only — the cheap mesh bundle). */
  spin: number;
  /** Detonate on geometry contact (after grace + safe distance), per the game. */
  impactMode: boolean;
  /** Vertical settled on the floor; horizontal keeps sliding (kThing behavior). */
  resting: boolean;
  /** Fuse out or qualifying impact — stop integrating; the wiring resolves. */
  detonated: boolean;
}

export const FLIGHT_TUNING = {
  /** Gravity (m/s²) — src/sim/thing.ts THING_GRAVITY_DV comment: "matches the
   *  Rapier world gravity from src/physics/world.ts: y=-25 → magnitude 25 m/s²". */
  gravityMps2: 25,
  /** Floor/wall restitution — src/sim/thing.ts DEFAULT_ELASTIC = 24576 in 16.16
   *  = 0.375: "Blood thingInfo elastic for TNT (0.375 in 16.16)". */
  elastic: 0.375,
  /** Below this |vy| on floor contact the bundle rests (keeps sliding
   *  horizontally — src/sim/thing.ts REST_VY = metersPerSecToFp(0.5)). */
  restSpeedMps: 0.5,
  /** Light airdrag (/s) — tuning.ts source-sim note: "actAirDrag a2=128
   *  ≈ 0.2%/tic" → 128/65536 per tic × 120 tics/s = 0.234375/s. Exponential
   *  decay applied per sub-step. Reproduces the source-simulated ~68 m
   *  full-charge reach that tuned the velocity band. */
  airdragPerSec: 0.234375,
  /** Impact grace (s) before geometry contact counts — src/sim/projectile.ts
   *  THROW.impactGraceTics = round(0.05 · 120). */
  impactGraceSec: 0.05,
  /** Impact safe distance (m) from spawn — src/sim/projectile.ts
   *  IMPACT_SAFE_DIST_SQ_FP = (0.7 m)²: contact closer than this never
   *  detonates (protects the spawn-in-hand contact). */
  impactSafeDistM: 0.7,
  /** Integrator sub-step (s) — the sim's fixed 120 tic/s (src/sim/units.ts
   *  TICS_PER_SEC = 120). Bounces and impact checks happen per sub-step,
   *  exactly like the game's per-tic mover. */
  subStepSec: 1 / 120,
  /** Prop tumble rate (rad/s) while airborne. Blood's bundle does NOT tumble
   *  (ang set once at spawn, never updated — dynamite.ts header) — this is a
   *  LAB-PROP feel value for the cheap cylinder-bundle mesh. */
  spinRateRadPerSec: 12,
  /** Bundle collision radius (m) — the 0.08 m the arena-bounds comment used to
   *  subsume, now an explicit sphere radius for the box tests. */
  bundleRadiusM: 0.08,
} as const;

/**
 * Spawn a thrown bundle. Defaults mirror the game's wiring (main.ts):
 * impact-mode throws carry the in-flight safety fuse
 * (DYNAMITE_COOK.impactSafetyFuseSec), fuse-only carries DYNAMITE_COOK.fuseMaxSec.
 */
export function makeFlight(
  pos: Vec3,
  vel: Vec3,
  opts: { impactMode?: boolean; fuseSec?: number } = {},
): FlightState {
  const impactMode = opts.impactMode ?? true;
  const fuse = opts.fuseSec
    ?? (impactMode ? DYNAMITE_COOK.impactSafetyFuseSec : DYNAMITE_COOK.fuseMaxSec);
  return {
    pos: [pos[0], pos[1], pos[2]],
    vel: [vel[0], vel[1], vel[2]],
    fuse,
    age: 0,
    spawn: [pos[0], pos[1], pos[2]],
    spin: 0,
    impactMode,
    resting: false,
    detonated: false,
  };
}

/** True once the fuse is out or a qualifying impact occurred — the wiring
 *  resolves the explosion, this module only reports it. */
export function detonated(state: FlightState): boolean {
  return state.detonated;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** One 120 Hz sub-step (the game's tic): gravity + integrate, airdrag, floor /
 *  wall / box bounce with elastic damping, then the detonation checks in the
 *  sim's order (fuse first, then qualifying impact). */
function stepSub(s: FlightState, sub: number, b: FlightBounds | null, world: FlightWorld): FlightState {
  const T = FLIGHT_TUNING;
  const pos: [number, number, number] = [...s.pos];
  const vel: [number, number, number] = [...s.vel];

  // Fuse + age first — mirrors stepProjectiles (fuseTics -= 1 before the mover).
  const fuse = s.fuse - sub;
  const age = s.age + sub;

  // Gravity + integrate (semi-implicit Euler, vy-first — mirrors stepThing).
  vel[1] -= T.gravityMps2 * sub;
  pos[0] += vel[0] * sub;
  pos[1] += vel[1] * sub;
  pos[2] += vel[2] * sub;

  // Airdrag — exponential per sub-step.
  const drag = Math.exp(-T.airdragPerSec * sub);
  vel[0] *= drag;
  vel[1] *= drag;
  vel[2] *= drag;

  // — Floor (y = 0): reflect + dampen, or rest once the bounce is weak.
  //   resting zeroes the VERTICAL only; horizontal keeps sliding (stepThing). —
  let hit = false;
  /** |velocity along the normal| of EVERY contact made this sub-step. The
   *  bundle counts as resting when it touched something and none of those
   *  components is still above the rest speed — the floor's original rule,
   *  generalised so a bundle landing on a CRATE settles too. */
  const contactSpeeds: number[] = [];
  if (pos[1] <= 0) {
    pos[1] = 0;
    hit = true;
    if (vel[1] < 0) {
      const up = -vel[1] * T.elastic;
      vel[1] = up <= T.restSpeedMps ? 0 : up;
    }
    contactSpeeds.push(Math.abs(vel[1]));
  }

  // — Walls: bounce planes = the arena rect, when one was supplied. The dungeon
  //   passes null and gets its walls from `colliders` instead. —
  if (b) {
    if (pos[0] < b.minX) { pos[0] = b.minX; vel[0] = -vel[0] * T.elastic; hit = true; }
    if (pos[0] > b.maxX) { pos[0] = b.maxX; vel[0] = -vel[0] * T.elastic; hit = true; }
    if (pos[2] < b.minZ) { pos[2] = b.minZ; vel[2] = -vel[2] * T.elastic; hit = true; }
    if (pos[2] > b.maxZ) { pos[2] = b.maxZ; vel[2] = -vel[2] * T.elastic; hit = true; }
  }

  // — Ceiling plane (the dungeon's room height). Rooms have no ceiling BOX in
  //   levelColliders, so without this a full-charge lob leaves through the
  //   roof. Tunnels are handled by their own lintel boxes, which the box test
  //   below catches — a lintel spans 2.2 → 3.0 m, so the low mouths are real. —
  const ceil = world.ceilM ?? null;
  if (ceil !== null && pos[1] > ceil) {
    pos[1] = ceil;
    hit = true;
    if (vel[1] > 0) vel[1] = -vel[1] * T.elastic;
  }

  // — Solid boxes: sphere-vs-AABB, push out along the contact normal and
  //   reflect the normal component. Two passes so a bundle wedged into a
  //   corner settles instead of jittering between two faces. —
  const boxes = world.colliders;
  if (boxes !== undefined && boxes.length > 0) {
    const r = world.bundleRadiusM ?? T.bundleRadiusM;
    for (let pass = 0; pass < 2; pass++) {
      for (const box of boxes) {
        // Cheap reject on the bundle's own AABB.
        if (pos[0] + r < box.min[0] || pos[0] - r > box.max[0]
          || pos[1] + r < box.min[1] || pos[1] - r > box.max[1]
          || pos[2] + r < box.min[2] || pos[2] - r > box.max[2]) continue;

        // Closest point on the box to the centre.
        const cx = clamp(pos[0], box.min[0], box.max[0]);
        const cy = clamp(pos[1], box.min[1], box.max[1]);
        const cz = clamp(pos[2], box.min[2], box.max[2]);
        const dx = pos[0] - cx, dy = pos[1] - cy, dz = pos[2] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        hit = true;

        let nx: number, ny: number, nz: number, pen: number;
        if (d2 > 1e-12) {
          const dist = Math.sqrt(d2);
          nx = dx / dist; ny = dy / dist; nz = dz / dist;
          pen = r - dist;
        } else {
          // Centre INSIDE the box (a fast sub-step can land there): leave by
          // the nearest face, the same min-penetration fallback the player
          // capsule uses (game-player.ts resolveCapsule).
          const faces: [number, 0 | 1 | 2, number][] = [
            [pos[0] - box.min[0] + r, 0, -1], [box.max[0] - pos[0] + r, 0, 1],
            [pos[1] - box.min[1] + r, 1, -1], [box.max[1] - pos[1] + r, 1, 1],
            [pos[2] - box.min[2] + r, 2, -1], [box.max[2] - pos[2] + r, 2, 1],
          ];
          faces.sort((p, q) => p[0] - q[0]);
          const [amount, axis, sign] = faces[0]!;
          nx = axis === 0 ? sign : 0; ny = axis === 1 ? sign : 0; nz = axis === 2 ? sign : 0;
          pen = amount;
        }
        pos[0] += nx * pen; pos[1] += ny * pen; pos[2] += nz * pen;
        const vn = vel[0] * nx + vel[1] * ny + vel[2] * nz;
        if (vn < 0) {
          const k = (1 + T.elastic) * vn;
          vel[0] -= k * nx; vel[1] -= k * ny; vel[2] -= k * nz;
        }
        // Post-contact normal speed, on the same rest rule as the floor: a
        // bundle that has stopped bouncing off a crate lid is at rest on it.
        contactSpeeds.push(Math.abs(vel[0] * nx + vel[1] * ny + vel[2] * nz));
      }
    }
  }

  const resting = hit && contactSpeeds.every(v => v <= T.restSpeedMps);

  // — Detonation, in the sim's order (stepProjectiles): fuse out wins; else a
  //   qualifying impact — past the grace window AND ≥ safe distance from
  //   spawn. Contact within the safe distance (e.g. thrown at your own feet)
  //   bounces harmlessly instead of detonating. —
  let det = s.detonated;
  if (fuse <= 0) {
    det = true;
  } else if (s.impactMode && age >= T.impactGraceSec && hit) {
    const dx = pos[0] - s.spawn[0];
    const dy = pos[1] - s.spawn[1];
    const dz = pos[2] - s.spawn[2];
    if (dx * dx + dy * dy + dz * dz >= T.impactSafeDistM * T.impactSafeDistM) det = true;
  }

  // Prop spin: lazy tumble while airborne; freezes at rest / on detonation.
  const spin = det || resting ? s.spin : s.spin + T.spinRateRadPerSec * sub;

  return {
    pos, vel, fuse, age, spawn: s.spawn, spin,
    impactMode: s.impactMode, resting, detonated: det,
  };
}

/**
 * Advance the flight by `dt` seconds (clamped to 0..0.25), consuming it in
 * 120 Hz sub-steps so bounces and impact checks land on the game's tic grid.
 * Pure and deterministic: same (state, dt, bounds, world) → same next state.
 * Once `detonated` is true the state stops changing.
 *
 * `bounds` is the arena rect (pass null for the dungeon, which uses `world`);
 * `world` adds the solid boxes and the ceiling and defaults to none of either,
 * so every existing caller keeps the exact behaviour it had.
 */
export function stepFlight(
  state: FlightState,
  dt: number,
  bounds: FlightBounds | null = BALLISTIC_BOUNDS,
  world: FlightWorld = {},
): FlightState {
  const dtc = clamp(dt, 0, 0.25);
  const b = bounds === null ? null : {
    minX: Math.min(bounds.minX, bounds.maxX),
    maxX: Math.max(bounds.minX, bounds.maxX),
    minZ: Math.min(bounds.minZ, bounds.maxZ),
    maxZ: Math.max(bounds.minZ, bounds.maxZ),
  };
  const sub = FLIGHT_TUNING.subStepSec;
  let out = state;
  let remaining = dtc;
  while (remaining > 1e-9 && !out.detonated) {
    const step = Math.min(remaining, sub);
    remaining -= step;
    out = stepSub(out, step, b, world);
  }
  return out;
}
