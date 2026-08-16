// src/lab/sdf-zombie/lod.ts
//
// Level-of-detail for raymarched bodies.
//
// Levels are chosen by PROJECTED SCREEN HEIGHT in pixels, not by distance.
// Distance is the wrong metric: the same body at the same metres is worth very
// different amounts of detail at 540p versus 1080p, or through a 60-degree
// lens versus a 90-degree one. Screen height folds resolution and field of
// view in, and it is also the honest question being asked — "can you still see
// this detail?"
//
// WHAT THE MEASUREMENTS SAY (M3, 960x540, 15 close-packed bodies; see
// docs/dev-notes/2026-08-16-sdf-lab-lod-pass.md). Every per-pixel lever is
// worth far less than it looks:
//
//   march steps 96 -> 40 ............. -15%
//   23 primitives -> 6 ............... -11%
//   silhouette noise off .............  -8%
//   surface noise / scatter / AO / face  within noise, individually
//   everything at once ............... -24%
//
// In a distributed crowd where the levels below actually engage, the shipped
// configuration is worth about -10%; in a shoulder-to-shoulder pack every body
// is large enough to deserve full quality and LOD correctly changes nothing.
//
// So LOD is worth a quarter at its ceiling, and about a tenth in practice.
// Cost is
// dominated by the NUMBER OF FRAGMENT INVOCATIONS rather than by the work
// inside each one: cost rises linearly with body count even when bodies hide
// behind one another, because writing frag_depth and calling discard defeats
// early-Z, so an occluded body marches every pixel anyway. Getting past a
// quarter means invoking the shader less, which is the compute work the
// migration was for — not more aggressive levels here.
//
// Deliberately engine-free so it can be unit-tested and so both renderer paths
// could use it. It decides WHAT quality a body gets; the view decides how to
// express that in uniforms.

/**
 * The switchable quality levers — the boolean fields of `LodLevel`, named as a
 * type so callers can key overrides by them without `name` and `maxDist`
 * (which are not levers) leaking into the union.
 */
export type LodLever =
  'silhouetteNoise' | 'surfaceNoise' | 'scatter' | 'ao' | 'face' | 'wounds';

/** Every lever, in the order LOD gives them up. */
export const LOD_LEVERS: readonly LodLever[] =
  ['silhouetteNoise', 'surfaceNoise', 'scatter', 'ao', 'face', 'wounds'];

export interface LodLevel {
  name: string;
  /**
   * Swap the body for a coarse stand-in: one ellipsoid per live cluster.
   *
   * The measurements say this is the lever that matters. Cost is dominated by
   * per-step field complexity — every march step evaluates every primitive in
   * range — so cutting 23 primitives to 6 cuts the inner loop roughly 4x.
   * Cutting the step COUNT, by contrast, bought only 15% for 96 -> 40, because
   * few rays ever ran to the limit: they hit the surface or left the box first.
   */
  simplify: boolean;
  /** Applies while the body projects to at least this many pixels tall. */
  minScreenPx: number;
  /** March step count. */
  steps: number;
  /** Per-step field noise. By far the most expensive lever. */
  silhouetteNoise: boolean;
  /** Normal perturbation at the hit point — three fbm lookups. */
  surfaceNoise: boolean;
  /** Backlit scatter. One extra mapBody. */
  scatter: boolean;
  /** Field-sampled ambient occlusion. One extra mapBody. */
  ao: boolean;
  /** Face projection, relief taps and eye glow. Four texture reads. */
  face: boolean;
  /** Craters and their everted rims, inside mapBody. */
  wounds: boolean;
}

/**
 * Thresholds are where each feature stops resolving, judged on screen rather
 * than guessed from metres.
 *
 * 150px is roughly a third of a 540p frame — below that the surface noise and
 * the everted rim on a crater are a pixel or two wide. 60px is where the face
 * texture stops being a face: the sheet's eyes are ~4 of its 64 texels, so
 * they land under half a pixel.
 *
 * `far` keeps wounds deliberately. A body that heals its craters as it walks
 * away reads as a bug, where one that loses its ambient occlusion does not,
 * and the wound loop is cheap while the count is low.
 */
export const LOD_LEVELS: readonly LodLevel[] = [
  {
    name: 'near',
    minScreenPx: 150,
    steps: 96,
    simplify: false,
    silhouetteNoise: true,
    surfaceNoise: true,
    scatter: true,
    ao: true,
    face: true,
    wounds: true,
  },
  {
    name: 'mid',
    minScreenPx: 60,
    steps: 64,
    simplify: false,
    silhouetteNoise: false,
    surfaceNoise: true,
    scatter: false,
    ao: true,
    face: true,
    wounds: true,
  },
  {
    name: 'far',
    minScreenPx: 0,
    steps: 40,
    simplify: true,
    silhouetteNoise: false,
    surfaceNoise: false,
    scatter: false,
    ao: false,
    face: false,
    wounds: true,
  },
];

/**
 * Projected height in pixels of something `worldHeight` tall, `dist` away.
 *
 * Standard pinhole projection: the viewport spans `2 * dist * tan(fov/2)` of
 * world at that depth, so the object takes that fraction of `viewportPx`.
 */
export function screenHeightPx(
  worldHeight: number, dist: number, fovYDeg: number, viewportPx: number,
): number {
  if (!(dist > 0)) return Infinity;   // at or behind the eye: as big as it gets
  const span = 2 * dist * Math.tan((fovYDeg * Math.PI) / 360);
  return (worldHeight / span) * viewportPx;
}

/**
 * Index into `levels` for a body projecting to `screenPx` pixels tall.
 *
 * Clamped rather than wrapped, so a table whose last entry does not reach 0
 * still returns its coarsest level instead of running off the end. NaN falls
 * to the finest level: a body the caller cannot measure is one to draw
 * properly, not one to degrade.
 */
export function pickLod(screenPx: number, levels: readonly LodLevel[] = LOD_LEVELS): number {
  if (levels.length === 0) throw new Error('pickLod: empty level table');
  if (Number.isNaN(screenPx)) return 0;
  for (let i = 0; i < levels.length; i++) if (screenPx >= levels[i]!.minScreenPx) return i;
  return levels.length - 1;
}

/**
 * Hysteresis band, as a fraction of the boundary size.
 *
 * A body sitting on a boundary would otherwise flip level every frame as the
 * camera breathes, and the coarse swap is visible. 8% is wider than any
 * per-frame drift and narrower than the gap between levels.
 */
export const LOD_HYSTERESIS = 0.08;

/**
 * `pickLod` with stickiness: a body only leaves its current level once it is
 * clear of the boundary by `LOD_HYSTERESIS`.
 *
 * Pass the level chosen last frame; pass -1 (or anything out of range) the
 * first time.
 */
export function pickLodSticky(
  screenPx: number,
  previous: number,
  levels: readonly LodLevel[] = LOD_LEVELS,
): number {
  const next = pickLod(screenPx, levels);
  if (previous < 0 || previous >= levels.length || next === previous) return next;

  // The boundary between the two levels in play is the finer one's threshold.
  const boundary = levels[Math.min(next, previous)]!.minScreenPx;
  if (boundary <= 0) return next;
  const band = boundary * LOD_HYSTERESIS;
  // Going coarser, the body must have shrunk clear of the band; going finer,
  // it must have grown clear of it.
  if (next > previous && screenPx > boundary - band) return previous;
  if (next < previous && screenPx < boundary + band) return previous;
  return next;
}
