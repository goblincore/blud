// src/lab/sdf-zombie/webgpu/outdoor-presets.ts
//
// OUTDOOR v1 presets (spec docs/superpowers/specs/2026-09-23-outdoor-v1-design.md §4, §6, §8).
// Named data the level file refers to: skies, grounds, edge styles, skylines.
// Pure: no three.js. The Rust port reads the same tables.

import type { Vec3 } from '../types';

export type SkyName = 'night';
export type GroundName = 'stone' | 'flagstone' | 'gravel' | 'dirt' | 'grass';
export type EdgeStyle = 'wall' | 'fence' | 'hedge';
export type SkylineName = 'treeline' | 'rooftops' | 'hills';

export const SKY_NAMES: readonly SkyName[] = ['night'];
export const GROUND_NAMES: readonly GroundName[] = ['stone', 'flagstone', 'gravel', 'dirt', 'grass'];
export const EDGE_STYLES: readonly EdgeStyle[] = ['wall', 'fence', 'hedge'];
export const SKYLINE_NAMES: readonly SkylineName[] = ['treeline', 'rooftops', 'hills'];

export interface SkyPreset {
  /** Linear-RGB gradient: straight up, at the horizon, and the glow band just above it. */
  zenith: Vec3;
  horizon: Vec3;
  band: Vec3;
  moon: {
    /** Unit vector from the ground TOWARD the moon. Light travels along -dir. */
    dir: Vec3;
    color: Vec3;
    /** DirectionalLight intensity and the bodies' key strength. */
    intensity: number;
    /** Angular radius of the disc and of the halo, degrees. */
    discDeg: number;
    haloDeg: number;
  };
  /** Star density 0..1. */
  stars: number;
  cloud: { color: Vec3; underlit: Vec3; cover: number };
  /** Sky radiance for lighting: the probe bake's sky term and the bodies' top face. */
  ambient: Vec3;
  /** Fog: colour equals `horizon`, so distance blends into the sky. */
  fog: { color: Vec3; near: number; far: number };
}

const NIGHT_HORIZON: Vec3 = [0.10, 0.16, 0.13];
const n3 = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

/** The Wake's stylised night: indigo zenith, a sickly green-teal horizon glow, a big
 *  pale moon high in the north-west, low clouds lit green from below. Tuned live
 *  (Task 8) and frozen back here. */
export const SKY_PRESETS: Record<SkyName, SkyPreset> = {
  night: {
    zenith: [0.012, 0.010, 0.045],
    horizon: NIGHT_HORIZON,
    band: [0.22, 0.32, 0.18],
    moon: { dir: n3([-0.35, 0.62, -0.70]), color: [0.72, 0.92, 0.84], intensity: 1.4, discDeg: 3.2, haloDeg: 16 },
    stars: 0.35,
    cloud: { color: [0.03, 0.035, 0.05], underlit: [0.30, 0.42, 0.22], cover: 0.45 },
    ambient: [0.05, 0.075, 0.09],
    fog: { color: NIGHT_HORIZON, near: 10, far: 70 },
  },
};

export type GroundTexture = 'cobble' | 'flagstone' | 'gravel' | 'dirt' | 'grass';
export interface GroundPreset { texture: GroundTexture; albedo: Vec3; roughness: number; repeatM: number }

/** `stone` is today's floor (the cobble texture), so an unmarked room looks unchanged. */
export const GROUND_PRESETS: Record<GroundName, GroundPreset> = {
  stone: { texture: 'cobble', albedo: [1, 1, 1], roughness: 1.0, repeatM: 2.7 },
  flagstone: { texture: 'flagstone', albedo: [0.30, 0.29, 0.28], roughness: 0.9, repeatM: 3.0 },
  gravel: { texture: 'gravel', albedo: [0.26, 0.25, 0.23], roughness: 1.0, repeatM: 1.5 },
  dirt: { texture: 'dirt', albedo: [0.16, 0.11, 0.07], roughness: 1.0, repeatM: 2.0 },
  grass: { texture: 'grass', albedo: [0.07, 0.11, 0.05], roughness: 1.0, repeatM: 2.0 },
};

export type EdgeTexture = 'brick' | 'railing' | 'leaves';
export interface EdgePreset {
  texture: EdgeTexture;
  albedo: Vec3;
  /** Railing textures carry alpha (colorNode.w); walls and hedges are opaque. */
  cutout: boolean;
  /** A stone cap (wall) or plinth (fence) drawn along the edge, metres. 0 = none. */
  capHeight: number;
  plinthHeight: number;
}

export const EDGE_PRESETS: Record<EdgeStyle, EdgePreset> = {
  wall: { texture: 'brick', albedo: [0.30, 0.29, 0.29], cutout: false, capHeight: 0.15, plinthHeight: 0 },
  fence: { texture: 'railing', albedo: [0.05, 0.05, 0.05], cutout: true, capHeight: 0, plinthHeight: 0.45 },
  hedge: { texture: 'leaves', albedo: [0.05, 0.10, 0.04], cutout: false, capHeight: 0, plinthHeight: 0 },
};

export type SkylineShape = 'trees' | 'roofs' | 'hills';
export interface SkylineLayer { distance: number; height: number; roughness: number; seed: number }
export interface SkylinePreset { shape: SkylineShape; layers: SkylineLayer[] }

/** Layers nearest first. `distance` is metres beyond the level's bounds. */
export const SKYLINE_PRESETS: Record<SkylineName, SkylinePreset> = {
  treeline: { shape: 'trees', layers: [
    { distance: 25, height: 11, roughness: 0.9, seed: 1 },
    { distance: 55, height: 16, roughness: 0.7, seed: 2 },
    { distance: 110, height: 24, roughness: 0.4, seed: 3 },
  ] },
  rooftops: { shape: 'roofs', layers: [
    { distance: 30, height: 12, roughness: 0.8, seed: 4 },
    { distance: 80, height: 20, roughness: 0.5, seed: 5 },
  ] },
  hills: { shape: 'hills', layers: [
    { distance: 60, height: 14, roughness: 0.5, seed: 6 },
    { distance: 140, height: 30, roughness: 0.3, seed: 7 },
  ] },
};

/** Colour of skyline layer `i` of `n`: the nearest is a dark silhouette, farther
 *  layers fade toward the horizon (aerial perspective). */
export function skylineLayerColor(sky: SkyPreset, i: number, n: number): Vec3 {
  const t = n <= 1 ? 0 : i / (n - 1);
  const k = 0.25 + 0.6 * t;
  const dark: Vec3 = [sky.zenith[0] * 0.6, sky.zenith[1] * 0.6, sky.zenith[2] * 0.6];
  return [
    dark[0] + (sky.horizon[0] - dark[0]) * k,
    dark[1] + (sky.horizon[1] - dark[1]) * k,
    dark[2] + (sky.horizon[2] - dark[2]) * k,
  ];
}
