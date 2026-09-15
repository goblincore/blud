// src/lab/sdf-zombie/mesher-comparison/render.ts
//
// A tiny CPU rasteriser used ONLY to produce inspectable visual evidence for
// the mesher comparison. No GPU, no WebGL, no three.js: a z-buffered
// orthographic render with one fixed neutral material and one fixed light, so
// the three methods are framed and shaded identically.
//
// Geometry is the target. Wound/albedo differences cannot bias the result
// because every panel shares this material.

import type { IndexedMesh } from './types';
import type { Vec3 } from '../types';

export interface CameraSpec {
  /** Yaw about +Y, radians. */
  readonly yaw: number;
  /** Pitch above the horizon, radians. */
  readonly pitch: number;
  readonly centre: Vec3;
  /** Half-extent of the orthographic view volume (metres). */
  readonly halfSize: number;
  readonly width: number;
  readonly height: number;
  readonly light: Vec3;
}

export function defaultCamera(centre: Vec3, radius: number, width = 420, height = 420): CameraSpec {
  return {
    yaw: 0.6, pitch: 0.25, centre, halfSize: radius * 1.05,
    width, height, light: normalize([0.4, 0.8, 0.35]),
  };
}

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

interface Basis { r: Vec3; u: Vec3; f: Vec3 }

function basis(cam: CameraSpec): Basis {
  const f: Vec3 = [Math.cos(cam.pitch) * Math.sin(cam.yaw), Math.sin(cam.pitch), Math.cos(cam.pitch) * Math.cos(cam.yaw)];
  const r = normalize([f[2], 0, -f[0]]);
  const u: Vec3 = [
    f[1] * r[2] - f[2] * r[1],
    f[2] * r[0] - f[0] * r[2],
    f[0] * r[1] - f[1] * r[0],
  ];
  return { r, u, f: normalize(f) };
}

export interface RenderedImage {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export function renderMesh(mesh: IndexedMesh, cam: CameraSpec, mode: 'shaded' | 'wireframe' = 'shaded'): RenderedImage {
  const { width, height } = cam;
  const rgba = new Uint8Array(width * height * 4);
  const zbuf = new Float32Array(width * height).fill(-Infinity);
  // Background: neutral dark grey.
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 26; rgba[i * 4 + 1] = 28; rgba[i * 4 + 2] = 32; rgba[i * 4 + 3] = 255;
  }
  const B = basis(cam);
  const p = mesh.positions;
  const project = (i: number): [number, number, number] => {
    const x = p[i * 3]! - cam.centre[0], y = p[i * 3 + 1]! - cam.centre[1], z = p[i * 3 + 2]! - cam.centre[2];
    const vx = x * B.r[0] + y * B.r[1] + z * B.r[2];
    const vy = x * B.u[0] + y * B.u[1] + z * B.u[2];
    const vz = x * B.f[0] + y * B.f[1] + z * B.f[2];
    const sx = (vx / cam.halfSize) * (width / 2) + width / 2;
    const sy = height / 2 - (vy / cam.halfSize) * (height / 2);
    return [sx, sy, vz];
  };
  const light = normalize(cam.light);
  const material: [number, number, number] = [0.72, 0.72, 0.74];

  const idx = mesh.indices;
  // Painter's-independent z-buffer; order does not matter.
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t]!, ib = idx[t + 1]!, ic = idx[t + 2]!;
    const a = project(ia), b = project(ib), c = project(ic);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (area === 0) continue;
    const ax = p[ia * 3]!, ay = p[ia * 3 + 1]!, az = p[ia * 3 + 2]!;
    const bx = p[ib * 3]!, by = p[ib * 3 + 1]!, bz = p[ib * 3 + 2]!;
    const cx = p[ic * 3]!, cy = p[ic * 3 + 1]!, cz = p[ic * 3 + 2]!;
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nl = Math.hypot(nx, ny, nz);
    if (nl === 0) continue;
    nx /= nl; ny /= nl; nz /= nl;
    // Two-sided shading so an inward-wound triangle is still visible (and
    // geometrically obvious), never a black hole.
    const d = nx * light[0] + ny * light[1] + nz * light[2];
    const lambert = Math.abs(d) * 0.85 + 0.15;
    const shade = mode === 'wireframe' ? 0 : lambert;
    const col: [number, number, number] = mode === 'wireframe'
      ? [30, 32, 36]
      : [material[0] * shade * 255, material[1] * shade * 255, material[2] * shade * 255];

    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const invArea = 1 / area;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((b[0] - a[0]) * (y + 0.5 - a[1]) - (x + 0.5 - a[0]) * (b[1] - a[1])) * invArea;
        const w1 = ((x + 0.5 - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y + 0.5 - a[1])) * invArea;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w2 * a[2] + w1 * b[2] + w0 * c[2];
        const o = y * width + x;
        if (z > zbuf[o]!) {
          zbuf[o] = z;
          rgba[o * 4] = col[0]; rgba[o * 4 + 1] = col[1]; rgba[o * 4 + 2] = col[2];
        }
      }
    }
  }

  if (mode === 'wireframe') {
    // Overlay edges on top of a faint fill so the surface reads.
    for (let t = 0; t < idx.length; t += 3) {
      const ia = idx[t]!, ib = idx[t + 1]!, ic = idx[t + 2]!;
      for (const [i0, i1] of [[ia, ib], [ib, ic], [ic, ia]] as const) {
        const a = project(i0), b = project(i1);
        drawLine(rgba, zbuf, width, height, a, b);
      }
    }
  }
  return { rgba, width, height };
}

function drawLine(
  rgba: Uint8Array, zbuf: Float32Array, width: number, height: number,
  a: [number, number, number], b: [number, number, number],
): void {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) * 2 + 1;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const x = Math.round(a[0] + (b[0] - a[0]) * s);
    const y = Math.round(a[1] + (b[1] - a[1]) * s);
    const z = a[2] + (b[2] - a[2]) * s;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const o = y * width + x;
    if (z > zbuf[o]! - 1e-4 || zbuf[o]! === -Infinity) {
      rgba[o * 4] = 205; rgba[o * 4 + 1] = 215; rgba[o * 4 + 2] = 225;
    }
  }
}

/** Bounding sphere of a mesh, for framing. */
export function meshBounds(mesh: IndexedMesh): { centre: Vec3; radius: number } {
  const p = mesh.positions;
  const n = p.length / 3;
  if (n === 0) return { centre: [0, 0, 0], radius: 1 };
  const mn: [number, number, number] = [Infinity, Infinity, Infinity];
  const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) {
    const v = p[i * 3 + d]!;
    if (v < mn[d]!) mn[d] = v;
    if (v > mx[d]!) mx[d] = v;
  }
  const centre: Vec3 = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  let r2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = p[i * 3]! - centre[0], dy = p[i * 3 + 1]! - centre[1], dz = p[i * 3 + 2]! - centre[2];
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  return { centre, radius: Math.sqrt(r2) };
}

/** Union bounding sphere (used to give every panel in a row one framing). */
export function unionBounds(meshes: readonly IndexedMesh[]): { centre: Vec3; radius: number } {
  const mn: [number, number, number] = [Infinity, Infinity, Infinity];
  const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    const { centre, radius } = meshBounds(m);
    for (let d = 0; d < 3; d++) {
      mn[d] = Math.min(mn[d]!, centre[d]! - radius);
      mx[d] = Math.max(mx[d]!, centre[d]! + radius);
    }
  }
  if (!Number.isFinite(mn[0]!)) return { centre: [0, 0, 0], radius: 1 };
  const centre: Vec3 = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  return { centre, radius: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 };
}
