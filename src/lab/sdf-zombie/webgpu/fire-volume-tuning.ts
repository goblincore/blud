// src/lab/sdf-zombie/webgpu/fire-volume-tuning.ts
//
// THE VOLUMETRIC FIRE TUNING RECORD, the tongue-tuning.ts pattern one effect
// over: one frozen default record, one bounds record the panel's sliders read
// their ranges from (so the two cannot drift), and one resolve that non-finite
// input cannot get through. `steps = 0` is the pipeline-free off switch the
// spec asks for (the march early-outs without a pipeline change).
//
// Round 2b added the tongue-erosion block (noiseScale .. coreR) and the smoke
// scattering block (smokeAlbedo .. smokeSpread). Round 2's fields keep their
// names; `curlStrength`'s default and range grew because the round-2 0.35 was
// too weak to advect a tongue.

export interface FireVolumeTuning {
  /** Low-res march target scale of the content size, 0.25..1. */
  resolutionScale: number;
  /** March samples per ray; 0 = the pass early-outs (off, no pipeline change). */
  steps: number;
  /** Emission gain on the temperature field. */
  tempGain: number;
  /** Extinction gain on the soot field. */
  sootGain: number;
  /** Metres of flame above a source capsule. */
  rise: number;
  /** Metres of soot above the flame core. */
  sootRise: number;
  /** Curl warp amplitude in world metres. */
  curlStrength: number;
  /** Curl domain scale: world metres per volume repeat. */
  curlScale: number;
  /** Velocity-lag strength (seconds of trail per metre of height). */
  lag: number;
  /** Maximum lag offset, world metres. */
  lagMaxM: number;
  /** Temporal history blend, 0..0.97. */
  history: number;
  /** Flame cards kept per body when the volume carries the mass. */
  cardsPerBody: number;
  /** Seconds an extinguished body keeps smoking (round 3 consumes it). */
  smokeTailSec: number;
  /** Flame-space noise cycles per metre (higher = smaller tongues). */
  noiseScale: number;
  /** Vertical frequency of the flame noise relative to XZ (< 1 stretches). */
  noiseStretch: number;
  /** How much the noise erodes the shape (0 = round 2's solid shell). */
  erode: number;
  /** Fraction of `rise` over which erosion grows from solid to fully torn. */
  erodeRise: number;
  /** Contrast on (shape - erosion): higher = crisper lick edges. */
  edgeSharp: number;
  /** Capsule core radius (m) of the flame's distance falloff. */
  coreR: number;
  /** Smoke scattering gain (0 = round 2's darkening-only soot). */
  smokeAlbedo: number;
  /** Ambient (grey) share of the smoke's inscatter. */
  smokeAmbient: number;
  /** Fire-lit (orange from below) share of the smoke's inscatter. */
  smokeFireLit: number;
  /** Metres the smoke column widens per metre of height above the flame. */
  smokeSpread: number;
}

export const FIRE_VOLUME_TUNING: FireVolumeTuning = Object.freeze({
  resolutionScale: 0.5,
  steps: 32,
  tempGain: 2.0,
  sootGain: 0.6,
  rise: 1.5,
  sootRise: 2.0,
  curlStrength: 1.3,
  curlScale: 1.2,
  lag: 0.3,
  lagMaxM: 0.6,
  history: 0.85,
  cardsPerBody: 5,
  smokeTailSec: 2,
  noiseScale: 3.0,
  noiseStretch: 0.3,
  erode: 1.5,
  erodeRise: 0.3,
  edgeSharp: 1.4,
  coreR: 0.32,
  smokeAlbedo: 0.35,
  smokeAmbient: 0.5,
  smokeFireLit: 1.0,
  smokeSpread: 0.3,
});

/** The clamp range for every field, as data — the panel reads its slider
 *  ranges from here, exactly as BURN_BOUNDS does for the burn record. */
export const FIRE_VOLUME_BOUNDS: Readonly<Record<keyof FireVolumeTuning, readonly [number, number]>> =
  Object.freeze({
    resolutionScale: [0.25, 1],
    steps: [0, 64],
    tempGain: [0, 4],
    sootGain: [0, 2],
    rise: [0, 3],
    sootRise: [0, 5],
    curlStrength: [0, 3],
    curlScale: [0.2, 6],
    lag: [0, 1],
    lagMaxM: [0, 1.5],
    history: [0, 0.97],
    cardsPerBody: [0, 16],
    smokeTailSec: [0, 6],
    noiseScale: [0.5, 6],
    noiseStretch: [0.15, 1.5],
    erode: [0, 3],
    erodeRise: [0.05, 2],
    edgeSharp: [0.5, 8],
    coreR: [0.03, 0.4],
    smokeAlbedo: [0, 2],
    smokeAmbient: [0, 2],
    smokeFireLit: [0, 3],
    smokeSpread: [0, 1.5],
  });

const FIRE_VOLUME_FIELDS = Object.keys(FIRE_VOLUME_TUNING) as (keyof FireVolumeTuning)[];

export function resolveFireVolumeTuning(p: Partial<FireVolumeTuning> = {}): FireVolumeTuning {
  const out = {} as FireVolumeTuning;
  for (const key of FIRE_VOLUME_FIELDS) {
    const [min, max] = FIRE_VOLUME_BOUNDS[key];
    const v = p[key];
    out[key] = v !== undefined && Number.isFinite(v)
      ? Math.min(max, Math.max(min, v))
      : FIRE_VOLUME_TUNING[key];
  }
  return out;
}
