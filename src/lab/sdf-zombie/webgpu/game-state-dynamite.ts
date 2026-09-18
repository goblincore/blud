// src/lab/sdf-zombie/webgpu/game-state-dynamite.ts
//
// DYNAMITE slice of the sdf-game GameContext decomposition. It lifts the
// throwable-bundle state that used to be `let`s inside main() in game-main.ts
// into one addressable object: the cook clock and its one-frame input edges,
// the per-throw/detonation telemetry that `__sdfGame.dynamite()` reads back,
// the last-gib readbacks, and the per-phase blast profile.
//
// Values only — no behavior lives here. Pure by construction: the only
// non-local dependency would be an erased `import type`, and this slice needs
// none, so the module carries no runtime Three.js/WebGPU dependency.
//
// Plain mutable fields only. Field access must keep exactly the timing it had
// as a local binding inside main(), so there are deliberately no getters,
// setters, `readonly` or frozen objects here — a proxy or an accessor would
// change evaluation order and shift pixels.
//
// Computed initializers (the `?dynspeed` URL read, `explosionRadiusM()`,
// `newBlastProfile()`) get a type-correct placeholder in the factory; the codemod
// supplies the real value at the binding's original line.

export interface DynamiteState {
  /** `?dynspeed` scale on the throw/flight clock, clamped 0.1..4; default 1.
   *  The codemod supplies the real parsed value at the original declaration. */
  speedScale: number;
  /** The cook clock in SIM seconds, advanced by `tick(dt)` — not a wall clock,
   *  so a frozen/render-locked capture cannot advance the fuse behind its own
   *  back. */
  now: number;
  /** One-frame press edge, consumed by the next tick. */
  press: boolean;
  /** One-frame release edge, consumed by the next tick. */
  release: boolean;
  /** 0..1 charge of the live cook, for the HUD. */
  charge: number;
  /** Telemetry for the tuning pass, read back through `__sdfGame.dynamite()`. */
  thrown: number;
  /** Blasts resolved. */
  detonations: number;
  /** Bodies gibbed by those blasts. */
  gibbed: number;
  /** Pieces those bodies spawned. */
  gibPieces: number;
  /** DIAGNOSTIC (temporary): bodies the pre-tear window's drain touched, so a
   *  census that disagrees says WHICH side is wrong. */
  scheduledGibBodies: number;
  /** DIAGNOSTIC (temporary): pieces that pre-tear drain touched. */
  scheduledGibPieces: number;
  /** Wall-clock duration of the LAST detonation, ms. */
  lastBlastMs: number;
  /** THE RADIUS THE LAST BLAST ACTUALLY RESOLVED AT — the honest readback, not
   *  the reference constant `explosionRadiusM()` (see game-main.ts:6612). The
   *  codemod supplies the real value at the original declaration. */
  lastRadiusM: number;
  /** Pieces a gib had to leave OUT because the view pool was full. */
  lastGibDropped: number;
  /** Which piece SHAPE the last body got (see gibActor's tiers). Literal boot
   *  value `'parts'`; `let`-inferred `string`. */
  lastGibTier: string;
  /** EVERY body's tier for the last blast, in gib order; cleared at the top of
   *  each detonation. */
  gibTierLog: string[];
  /** How many pieces the last gibbed body actually spawned. */
  lastGibSpawned: number;
  /** The piece ids/names the last gibbed body actually spawned. */
  lastGibParts: string[];
  /** How many pieces the last body held back. */
  lastGibHeld: number;
  /** Blood entities left orphaned by the last blast. */
  bloodOrphans: number;
  /** Per-phase timings of the LAST detonation, ms. `newBlastProfile()` is a
   *  local nested function in game-main.ts with an inline return type and no
   *  exported alias, so the field is `unknown`; the codemod assigns the real
   *  object at the original declaration. */
  blastProfile: unknown;
}

/** Every call returns a fresh object, nested arrays included. */
export function makeDynamiteState(): DynamiteState {
  return {
    speedScale: 0,
    now: 0,
    press: false,
    release: false,
    charge: 0,
    thrown: 0,
    detonations: 0,
    gibbed: 0,
    gibPieces: 0,
    scheduledGibBodies: 0,
    scheduledGibPieces: 0,
    lastBlastMs: 0,
    lastRadiusM: 0,
    lastGibDropped: 0,
    lastGibTier: 'parts',
    gibTierLog: [],
    lastGibSpawned: 0,
    lastGibParts: [],
    lastGibHeld: 0,
    bloodOrphans: 0,
    blastProfile: null,
  };
}

/** Old `main()` binding name → path on the GameContext's dynamite slice. The
 *  codemod that rewrites game-main.ts routes every binding through this map. */
export const DYNAMITE_BINDINGS = {
  dynSpeedScale: 'dynamite.speedScale',
  dynNow: 'dynamite.now',
  dynPress: 'dynamite.press',
  dynRelease: 'dynamite.release',
  dynCharge: 'dynamite.charge',
  dynThrown: 'dynamite.thrown',
  dynDetonations: 'dynamite.detonations',
  dynGibbed: 'dynamite.gibbed',
  dynGibPieces: 'dynamite.gibPieces',
  dynScheduledGibBodies: 'dynamite.scheduledGibBodies',
  dynScheduledGibPieces: 'dynamite.scheduledGibPieces',
  dynLastBlastMs: 'dynamite.lastBlastMs',
  dynLastRadiusM: 'dynamite.lastRadiusM',
  dynLastGibDropped: 'dynamite.lastGibDropped',
  dynLastGibTier: 'dynamite.lastGibTier',
  dynGibTierLog: 'dynamite.gibTierLog',
  dynLastGibSpawned: 'dynamite.lastGibSpawned',
  dynLastGibParts: 'dynamite.lastGibParts',
  dynLastGibHeld: 'dynamite.lastGibHeld',
  dynBloodOrphans: 'dynamite.bloodOrphans',
  dynBlastProfile: 'dynamite.blastProfile',
} as const;
