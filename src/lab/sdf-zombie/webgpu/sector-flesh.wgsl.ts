// src/lab/sdf-zombie/webgpu/sector-flesh.wgsl.ts
//
// FLESH WALLS (owner playtest 2026-11-01: the original's rooms of meat, handled our own way). The folds are the panel's
// (panel-textures.ts fleshWall); this is what makes them alive: veins with a slow pulse travelling up them, and the wall
// BREATHING, swelling along its normal on a slow beat. Bulges come from world noise so a wall does not move as one sheet.
// Nothing moves in collision: 6 cm at most. A wall's edges are pinned (fleshPin), so corners and floors stay shut.
// `?breathe=0` holds the walls still; `?hellmat=0` removes the flesh altogether.
//
// Pure: no three.js, no DOM.

export const FLESH_BREATH = /* wgsl */ `fn fleshBreath(wpos: vec3<f32>, t: f32) -> f32 {
  let bulge = sgNoise(wpos.xz * 0.55 + vec2<f32>(wpos.y * 0.6, t * 0.04));
  let beat = 0.5 + 0.5 * sin(t * 1.15 + bulge * 5.0);
  return 0.06 * beat * smoothstep(0.2, 0.75, bulge);
}`;

export const FLESH_VEINS = /* wgsl */ `fn fleshVeins(p: vec2<f32>, t: f32) -> vec3<f32> {
  let warp = vec2<f32>(sgNoise(p * 0.6), sgNoise(p * 0.6 + vec2<f32>(3.7, 8.1)));
  let edge = sgCells(p * 2.1 + (warp - 0.5) * 3.4, 0.0);
  let vein = (1.0 - smoothstep(0.0, 0.045, edge)) * smoothstep(0.42, 0.66, sgNoise(p * 0.5 + warp));
  let pulse = pow(0.5 + 0.5 * sin(t * 1.15 - p.y * 1.3 + warp.x * 6.0), 4.0);
  return vec3<f32>(0.3, 0.012, 0.02) * vein * (0.05 + 0.75 * pulse);
}`;

/** `?breathe=0` holds flesh walls still. */
export const breatheOn = (search: URLSearchParams): boolean => search.get('breathe') !== '0';
/** The size of the grid a breathing wall is cut into (metres). */
export const FLESH_ROW_M = 0.6;
/** How far in from a wall's edge the swell reaches full strength (metres). */
const PIN_M = 0.45;

/** A breathing wall vertex's weight, 0 on the wall's edges: `along` of `len` metres on the line, `up` of `height` up it. */
export function fleshPin(along: number, len: number, up: number, height: number): number {
  const edge = Math.min(along, len - along, up, height - up);
  return Math.max(0, Math.min(1, edge / PIN_M));
}
