// src/lab/sdf-zombie/webgpu/train-window.ts
//
// TypeScript twin of TRAIN_WINDOW (train-window.wgsl.ts; carriage kit spec §5): what a view
// ray through a window pane meets: poles, fence posts, the treeline, the hills, the sky.
// The track runs along -z; the train moves toward -z at `speed`, so scenery moves toward +z.

import type { Vec3 } from '../types';

export interface WindowPreset {
  speed: number;           // m/s
  poleDist: number; polePitch: number; poleHeight: number;
  postDist: number; postPitch: number; postHeight: number;
  treeDist: number; treeHeight: number;
  hillDist: number; hillHeight: number;
  ground: Vec3; tree: Vec3; hill: Vec3; pole: Vec3;
}

export const WINDOW_PRESETS: Record<'night', WindowPreset> = {
  night: {
    speed: 20,
    poleDist: 6, polePitch: 40, poleHeight: 7,
    postDist: 3.5, postPitch: 3, postHeight: 1.1,
    treeDist: 60, treeHeight: 9,
    hillDist: 400, hillHeight: 40,
    ground: [0.012, 0.014, 0.016], tree: [0.006, 0.008, 0.01], hill: [0.018, 0.022, 0.03], pole: [0.004, 0.004, 0.005],
  },
};

/** Where the ray from `eye` along `dir` (pointing outward, |x| growing) crosses the plane
 *  |x| = dist beside the track: the z there and the height above the rail head (y = 0). */
export function crossAt(eye: Vec3, dir: Vec3, dist: number): { z: number; y: number } | null {
  if (Math.abs(dir[0]) < 1e-6) return null;
  const t = (Math.sign(dir[0]) * dist - eye[0]) / dir[0];
  if (t <= 0) return null;
  return { z: eye[2] + dir[2] * t, y: eye[1] + dir[1] * t };
}

/** Is scenery coordinate z (moving: z + speed * time) on a pole/post of the given pitch and width? */
export function onStrip(z: number, time: number, speed: number, pitch: number, width: number): boolean {
  const u = (((z + speed * time) % pitch) + pitch) % pitch;
  return u < width;
}

/** Silhouette height (metres) of a band at scenery coordinate s: a sum of sines (the WGSL uses the same). */
export function silhouette(s: number, height: number, freq: number): number {
  return height * (0.55 + 0.25 * Math.sin(s * freq) + 0.12 * Math.sin(s * freq * 2.7 + 1.3) + 0.08 * Math.sin(s * freq * 6.1 + 4.1));
}
