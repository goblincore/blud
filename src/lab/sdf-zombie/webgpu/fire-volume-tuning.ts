// src/lab/sdf-zombie/webgpu/fire-volume-tuning.ts
//
// THE VOLUMETRIC FIRE TUNING RECORD, the tongue-tuning.ts pattern one effect
// over: one frozen default record, one bounds record the panel's sliders read
// their ranges from (so the two cannot drift), and one resolve that non-finite
// input cannot get through. `steps = 0` is the pipeline-free off switch the
// spec asks for (the march early-outs without a pipeline change).
//
// Round 2b added the tongue-erosion block (noiseScale .. coreR) and a smoke
// block, removed 2026-09-19 (owner: smoke will come from a cheaper effect). Round 2's fields keep their
// names; `curlStrength`'s default and range grew because the round-2 0.35 was
// too weak to advect a tongue.
//
// Hands-on redesign (2026-09-18): the field became swept flame SHEETS (see
// fire-volume.wgsl.ts). `rise` is now the sheet length, `coreR` the flame shell
// thickness, `curlStrength` a few-cm wobble (round 2b's 1.3 m threw the field
// off the body), and `tempGain` the brightness of a single-coefficient
// emission-absorption medium (so it cannot sum past the ramp into white).

export interface FireVolumeTuning {
  /** Low-res march target scale of the content size, 0.25..1. */
  resolutionScale: number;
  /** March samples per ray; 0 = the pass early-outs (off, no pipeline change). */
  steps: number;
  /** Flame brightness: a thick flame converges to ramp colour x this. */
  tempGain: number;
  /** Length (m) of the flame sheet each limb sweeps upward; it tapers to a point. */
  rise: number;
  /** Curl wobble amplitude in world metres (a few cm; it displaces the whole field). */
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
  /** Burning bodies (nearest first) that get the volume; the rest keep their
   *  surface fire and cards. The volume's cost scales with this. */
  maxBodies: number;
  /** Flame-space noise cycles per metre (higher = smaller tongues). */
  noiseScale: number;
  /** Vertical frequency of the flame noise relative to XZ (< 1 stretches). */
  noiseStretch: number;
  /** How much the noise erodes the shape (0 = round 2's solid shell). */
  erode: number;
  /** Fraction of the sheet length over which erosion grows from base to full. */
  erodeRise: number;
  /** Contrast on (shape - erosion): higher = crisper lick edges. */
  edgeSharp: number;
  /** Thickness (m) of the flame shell around each limb; thins as the sheet climbs. */
  coreR: number;
  /** Flame opacity scale (1 = ~94% opaque per 10 cm of full flame). Lower
   *  lets the body's form read through the fire. */
  density: number;
  /** Flame coating the body surface (0..1); the sheets rising off it stay
   *  full. Lower keeps the body's form readable inside the fire. */
  skin: number;
  /** Sheet-length scale for the HEAD (and its crown): < 1 keeps the flame over
   *  the head short so the head stays readable; the body keeps `rise`. */
  headRise: number;
  /** Flame strength left right around the head (0..1), from EVERY limb's
   *  sheet: the shoulder flame otherwise climbs over the face. */
  headClear: number;
}

export const FIRE_VOLUME_TUNING: FireVolumeTuning = Object.freeze({
  resolutionScale: 0.4,
  steps: 48,
  tempGain: 2.0,
  rise: 0.55,
  curlStrength: 0.07,
  curlScale: 1.5,
  lag: 0.3,
  lagMaxM: 0.6,
  history: 0.7,
  cardsPerBody: 5,
  maxBodies: 4,
  noiseScale: 11,
  noiseStretch: 0.33,
  erode: 1.4,
  erodeRise: 0.6,
  edgeSharp: 4,
  coreR: 0.16,
  density: 1,
  skin: 0.3,
  headRise: 0.45,
  headClear: 0.25,
});

/** The clamp range for every field, as data — the panel reads its slider
 *  ranges from here, exactly as BURN_BOUNDS does for the burn record. */
export const FIRE_VOLUME_BOUNDS: Readonly<Record<keyof FireVolumeTuning, readonly [number, number]>> =
  Object.freeze({
    resolutionScale: [0.25, 1],
    steps: [0, 64],
    tempGain: [0, 6],
    rise: [0, 3],
    curlStrength: [0, 0.4],
    curlScale: [0.2, 6],
    lag: [0, 1],
    lagMaxM: [0, 1.5],
    history: [0, 0.97],
    cardsPerBody: [0, 16],
    maxBodies: [1, 8],
    noiseScale: [0.5, 16],
    noiseStretch: [0.15, 1.5],
    erode: [0, 3],
    erodeRise: [0.05, 2],
    edgeSharp: [0.5, 8],
    coreR: [0.03, 0.4],
    density: [0.05, 2],
    skin: [0, 1],
    headRise: [0, 1.5],
    headClear: [0, 1],
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
