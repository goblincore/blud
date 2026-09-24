// src/lab/sdf-zombie/webgpu/void-portal.ts
//
// The Void's portal, as pure maths (spec 2026-09-24-void-portal-design.md §5, §6):
// the portal's frame, the entry test, the oval, where a view ray through the portal
// lands on the ground behind it and what the tracks look like there, the ember wrap
// and the glow pool. TypeScript twin of portal.wgsl.ts: the WGSL draws, this tests.
// Change one, change both — portal.wgsl.test.ts pins the shared literals. Noise
// (rim flicker, haze swirl) is WGSL-only. Pure: no three.js, no DOM.

import type { Vec3 } from '../types';

export interface PortalLike { pos: Vec3; yaw: number; width: number; height: number }

export const PORTAL_DEPTH_M = 0.6;
export const RAIL_HALF_GAUGE = 0.72;
export const RAIL_HALF_WIDTH = 0.04;
export const SLEEPER_PITCH_M = 0.6;
export const SLEEPER_FILL = 0.25;
export const SLEEPER_HALF_LEN = 1.2;
export const TRACK_FADE_M = 14;
export const TRACK_BLACK_M = 60;

export function portalFrame(p: PortalLike): { facing: Vec3; back: Vec3; right: Vec3 } {
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  return { facing: [s, 0, -c], back: [-s, 0, c], right: [c, 0, s] };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Inside the portal's trigger box: width across, PORTAL_DEPTH_M through, height up. */
export function insidePortal(p: PortalLike, pos: Vec3): boolean {
  const f = portalFrame(p), d = sub(pos, p.pos);
  return Math.abs(dot(d, f.right)) <= p.width / 2 && Math.abs(dot(d, f.facing)) <= PORTAL_DEPTH_M / 2
    && d[1] >= -0.5 && d[1] <= p.height;
}

/** Oval signed distance in the portal's normalised plane coords (u, v in [-1, 1]). */
export function ovalDistance(u: number, v: number): number {
  return Math.hypot(u, v) - 1;
}

/** The view ray from `eye` through `onPortal`, carried behind the portal to the ground
 *  plane at the portal's base: depth behind the plane and lateral offset, or null. */
export function trackHit(p: PortalLike, eye: Vec3, onPortal: Vec3): { depth: number; lateral: number } | null {
  const d = sub(onPortal, eye);
  if (d[1] >= -1e-6) return null;
  const t = (onPortal[1] - p.pos[1]) / -d[1];
  const hit: Vec3 = [onPortal[0] + d[0] * t, p.pos[1], onPortal[2] + d[2] * t];
  const f = portalFrame(p), rel = sub(hit, p.pos);
  const depth = dot(rel, f.back);
  return depth > 0 ? { depth, lateral: dot(rel, f.right) } : null;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 0..1 brightness of the tracks at a ground hit (before the red tint). */
export function trackIntensity(depth: number, lateral: number): number {
  const railD = Math.abs(Math.abs(lateral) - RAIL_HALF_GAUGE);
  const rail = 1 - smooth(RAIL_HALF_WIDTH * 0.5, RAIL_HALF_WIDTH, railD);
  const phase = depth / SLEEPER_PITCH_M - Math.floor(depth / SLEEPER_PITCH_M);
  const sleeper = (phase < SLEEPER_FILL ? 1 : 0) * (Math.abs(lateral) < SLEEPER_HALF_LEN ? 0.45 : 0);
  const fade = Math.exp(-depth / TRACK_FADE_M) * (1 - smooth(TRACK_BLACK_M * 0.5, TRACK_BLACK_M, depth));
  return Math.max(rail, sleeper) * fade;
}

/** Wrap an ember position into a `box`-metre cube (x, z) centred on the camera; y untouched. */
export function emberWrap(pos: Vec3, cam: Vec3, box: number): Vec3 {
  const w = (v: number, c: number) => c + (((v - c + box / 2) % box) + box) % box - box / 2;
  return [w(pos[0], cam[0]), pos[1], w(pos[2], cam[2])];
}

/** Glow pool brightness at `r` metres from its centre. */
export function glowAt(r: number, radius: number): number {
  const t = Math.min(1, r / radius);
  return (1 - t) * (1 - t);
}
