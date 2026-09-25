/**
 * MESH-BEAM FIT — the kit flashlight that matches the SDF body beam.
 *
 * WHY. The game's flashlight is a three.js SpotLight (intensity 90, decay 1.6,
 * dungeon-lighting.ts). Polygon kits (MeshStandardMaterial) are lit by it
 * through three's physical model with no tone mapping: on axis the diffuse
 * multiplier on albedo is `I * d^-decay * window / pi` = 28.6x at 1 m, so a
 * dress or plate clips to white. The SDF bodies never see that light: the
 * march replays the beam analytically (march/body/blocks/light/flashlight.wgsl.ts)
 * as `keyI = gain * coneFall^2 * (1 - d/range)^2` on albedo, i.e. 3.5x at 1 m.
 * The same character therefore read as grey flesh in white clothes (owner,
 * 2026-09-25, investigation stills in docs/dev-notes/2026-09-25-kit-brightness/).
 *
 * WHAT. A second SpotLight lights the kits (webgpu/kit-lights.ts) and THIS
 * derives its intensity/decay/distance from the SDF beam constants, so the
 * two stay in sync: change the beam gain or range and the kit light follows.
 * three's falloff `d^-decay * saturate(1 - (d/distance)^4)^2` cannot express
 * `(1 - d/range)^2` exactly, so it is a minimax fit of the log ratio over the
 * distances that matter (MESH_BEAM_WINDOW). The shape (decay, distance) only
 * depends on range; intensity is exactly linear in gain.
 *
 * NOT MODELLED: the SDF's highlight shoulder (compose.wgsl.ts softShoulder) —
 * the owner picked the beam parity alone; meshes still have no tone map.
 * Pure: no three, no GPU.
 */

export interface SdfBeam {
  /** The march's key gain, spotCfg2.x (beamTuning.gain). */
  gain: number;
  /** Beam range in metres, spotCfg.w (the flashlight SpotLight's distance). */
  range: number;
}

export interface MeshBeam {
  /** three SpotLight.intensity (candela). */
  intensity: number;
  /** three SpotLight.decay. */
  decay: number;
  /** three SpotLight.distance (the cutoff window), metres. */
  distance: number;
}

export interface MeshBeamFit extends MeshBeam {
  /** intensity / gain — set `intensity = intensityPerGain * gain` live. */
  intensityPerGain: number;
  /** Worst |mesh/sdf - 1| over the fit window. */
  maxRatioError: number;
}

/** Fit window. 0.5 m is closer than any melee; the dungeon fog reaches black
 *  at 13 m (DUNGEON_RIG.fogFar), so past 10 m a kit is fog, not beam. */
export const MESH_BEAM_WINDOW = Object.freeze({ near: 0.5, far: 10 });

/** SDF beam on axis (coneFall = 1): the multiplier on albedo. */
export function sdfBeamFalloff(beam: SdfBeam, d: number): number {
  const f = Math.min(Math.max(1 - d / Math.max(beam.range, 1e-4), 0), 1);
  return beam.gain * f * f;
}

/** three's SpotLight on axis through MeshStandardMaterial's Lambert term
 *  (BRDF_Lambert = albedo / pi), with LightUtils.getDistanceAttenuation. */
export function meshBeamFalloff(light: MeshBeam, d: number): number {
  let a = 1 / Math.max(Math.pow(d, light.decay), 0.01);
  if (light.distance > 0) {
    const w = Math.min(Math.max(1 - Math.pow(d / light.distance, 4), 0), 1);
    a *= w * w;
  }
  return (light.intensity * a) / Math.PI;
}

const SAMPLES = 40;
const DECAY_MAX = 1.5;

/**
 * Minimax (in log ratio) fit of a three SpotLight to the SDF beam over
 * `window`. Coarse-to-fine grid over decay × distance; for each candidate the
 * best log intensity is the mid-range of the log residual. Runs once at boot
 * (a few ms).
 */
export function fitMeshBeam(beam: SdfBeam, window = MESH_BEAM_WINDOW): MeshBeamFit {
  const { near, far } = window;
  const ds: number[] = [];
  const logSdf: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const d = near * Math.pow(far / near, i / (SAMPLES - 1));
    ds.push(d);
    // Fit the unit-gain beam: gain only scales intensity.
    logSdf.push(Math.log(sdfBeamFalloff({ gain: 1, range: beam.range }, d)));
  }
  const logD = ds.map(Math.log);
  const score = (decay: number, distance: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      const w = 1 - Math.pow(ds[i]! / distance, 4);
      if (w <= 0) return { err: Infinity, logI: 0 };
      // log(meshBeamFalloff(I=1)) = -decay*log d + 2 log w - log pi
      const r = logSdf[i]! + decay * logD[i]! - 2 * Math.log(w) + Math.log(Math.PI);
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    return { err: (hi - lo) / 2, logI: (hi + lo) / 2 };
  };
  const distMin = far * 1.02;
  const distMax = Math.max(beam.range * 4, distMin + 1);
  let best = { err: Infinity, logI: 0, decay: 0, distance: distMin };
  const search = (d0: number, d1: number, dStep: number, x0: number, x1: number, xStep: number) => {
    for (let decay = Math.max(0, d0); decay <= Math.min(DECAY_MAX, d1) + 1e-9; decay += dStep) {
      for (let distance = Math.max(distMin, x0); distance <= Math.min(distMax, x1) + 1e-9; distance += xStep) {
        const s = score(decay, distance);
        if (s.err < best.err) best = { ...s, decay, distance };
      }
    }
  };
  search(0, DECAY_MAX, 0.05, distMin, distMax, 1);
  const c = { ...best };
  search(c.decay - 0.05, c.decay + 0.05, 0.005, c.distance - 1, c.distance + 1, 0.05);
  // Round to readable constants, then re-derive intensity for the rounded shape.
  const decay = Math.round(best.decay * 1000) / 1000;
  const distance = Math.round(best.distance * 100) / 100;
  const intensityPerGain = Math.exp(score(decay, distance).logI);
  const intensity = intensityPerGain * beam.gain;
  let maxRatioError = 0;
  for (const d of ds) {
    const r = meshBeamFalloff({ intensity, decay, distance }, d) / sdfBeamFalloff(beam, d);
    maxRatioError = Math.max(maxRatioError, Math.abs(r - 1));
  }
  return { intensity, decay, distance, intensityPerGain, maxRatioError };
}
