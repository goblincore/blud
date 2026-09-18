// src/lab/sdf-zombie/webgpu/curl-volume.ts
//
// CURL-NOISE VOLUME (flame-polish plan task 2, 2026-09-18): a small seeded
// 64^3 RGBA8 3D texture whose RGB is a divergence-free vector field and whose
// A is a fourth noise scalar. It is the wildfire teardown's most portable idea
// (docs/dev-notes/2026-09-18-wildfire-fire-teardown.md §2): because curl noise
// is divergence-free it reads as FLOW rather than drift, so N flame cards
// sampling one shared field move as one body instead of flickering alone.
//
// ── HOW IT IS BUILT ─────────────────────────────────────────────────────
// Four scalar value-noise lattices are sampled over the 64^3 grid (four
// independent seed-derived offsets and base frequencies, several octaves —
// the repo's canonical CPU value noise, `noise3` in ../validate.ts, in a
// transcription pinned to the original by the test, is the generator). The
// curl of the first three is taken by CENTRAL finite
// differences with wraparound indexing ((x + 1) & 63, (x - 1) & 63):
//
//     curl(F) = ( dFz/dy - dFy/dz,  dFx/dz - dFz/dx,  dFy/dx - dFx/dy )
//
// The wraparound is what makes the stored vector field PERIODIC on the 64^3
// torus — the curl at texel 63 differences against texel 0 — so the texture
// tiles under RepeatWrapping with no seam. (The scalar lattices themselves do
// not need to be periodic; only the field we store does.) The field is then
// normalised by the largest component magnitude over the whole volume and
// packed as `rgb = v * 0.5 + 0.5`, with the fourth scalar in `a`.
//
// The shader decodes `rgb * 2 - 1` and samples at `position / CURL_SCALE`.
//
// ── DETERMINISM ─────────────────────────────────────────────────────────
// No Math.random() anywhere: the per-field offsets come from the repo's
// mulberry32 in seed order, so a seed reproduces the exact same 1 MB volume.
// Builds are memoised (the volume is ~0.6 s of CPU and the app and the tests
// both ask for the same seed more than once).
//
// ── FILTERABILITY ───────────────────────────────────────────────────────
// RGBA8 + LinearFilter is a filterable WebGPU combination, and
// createCurlTexture sets BOTH filters to Linear. That matters: flame-cards.ts
// learned the hard way (flame-polish task 1) that a Nearest/Nearest fallback
// makes WGSLNodeBuilder bake integer `textureLoad` into the compiled shader,
// silently ignoring the bound texture's own filtering.

import * as THREE from 'three/webgpu';
import { mulberry32 } from './game-weapon';
import type { Vec3 } from '../types';

/** Edge length of the cubic volume, texels. Named so the test and the GPU
 *  side cannot drift from the packer. */
export const CURL_VOLUME_SIZE = 64;

/** World metres per volume repeat: the shader samples `position / CURL_SCALE`.
 *  ~6 m is the wildfire bundle's figure and about two body heights, so a
 *  burning body sees a couple of flow cells across itself. */
export const CURL_SCALE = 6;

/** Octaves per scalar lattice. Three is "several" and keeps the boot build
 *  under a second; the base field carries the large swirl, the octaves add
 *  the ragged detail a flame edge wants. */
const CURL_OCTAVES = 3;
/** Noise periods across the volume at the base octave. */
const CURL_BASE_CELLS = 3;
/** Octave amplitude falloff and frequency lacunarity (the repo's fbm shape). */
const CURL_GAIN = 0.5;
const CURL_LACUNARITY = 2;

const S = CURL_VOLUME_SIZE;
const S2 = S * S;
const N = S * S * S;
const MASK = S - 1;   // 64 is a power of two; & MASK wraps a non-negative index

/** The fourth scalar's channel index in the packed RGBA8 volume. */
export const CURL_ALPHA_CHANNEL = 3;

// ── The scalar noise (the repo's value noise, allocation-free) ──────────
// curl-volume is built with ~3 million noise samples per field, and the
// canonical CPU twin (`noise3` in ../validate.ts) allocates several small
// arrays on every hash call — measured at ~2 s per build, which would tax
// every flame-lab page load. These two functions are a faithful, scalar-only
// transcription of `hash13`/`noise3` from validate.ts (same 0.1031/33.33
// constants, same smoothstep fade), pinned to the original by
// curl-volume.test.ts so the copy cannot drift. Reusing the repo's noise here
// means reusing its field, not re-deriving it.

function fract(v: number): number {
  return v - Math.floor(v);
}

/** Scalar form of validate.ts `hash13`. */
function hash13f(x: number, y: number, z: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  let pz = fract(z * 0.1031);
  const s = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += s; py += s; pz += s;
  const v = (px + py) * pz;
  return v - Math.floor(v);
}

/** Scalar form of validate.ts `noise3`: trilinear value noise in [-1, 1]. */
export function curlNoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const h = (di: number, dj: number, dk: number) =>
    hash13f(ix + di, iy + dj, iz + dk);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const n = mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), fx), mix(h(0, 1, 0), h(1, 1, 0), fx), fy),
    mix(mix(h(0, 0, 1), h(1, 0, 1), fx), mix(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  );
  return n * 2 - 1;
}

/**
 * One scalar value-noise lattice over the 64^3 grid: value noise summed over
 * several octaves at a seed-derived offset and base frequency.
 */
function buildLattice(
  ox: number, oy: number, oz: number, baseCells: number,
): Float32Array {
  const out = new Float32Array(N);
  let i = 0;
  for (let z = 0; z < S; z++) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let amp = 1, sum = 0, norm = 0, cells = baseCells;
        for (let o = 0; o < CURL_OCTAVES; o++) {
          const inv = cells / S;
          sum += curlNoise3(x * inv + ox, y * inv + oy, z * inv + oz) * amp;
          norm += amp;
          amp *= CURL_GAIN;
          cells *= CURL_LACUNARITY;
        }
        out[i++] = sum / norm;
      }
    }
  }
  return out;
}

// Builds are keyed by seed and reused; callers must treat the array as
// read-only (the app only uploads it and reads it for the CPU anchor offset).
const cache = new Map<number, Uint8Array>();
const CACHE_LIMIT = 4;

/**
 * Build the 64^3 RGBA8 curl volume for `seed`.
 *
 * RGB is the divergence-free curl vector remapped to 0..255 (`rgb / 255 * 2 -
 * 1` decodes it); A is a fourth noise lattice remapped to 0..255. The result is
 * deterministic for a seed and tiles on all three axes.
 */
export function buildCurlVolume(seed: number): Uint8Array {
  const cached = cache.get(seed);
  if (cached) return cached;

  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  // Independent offset + base frequency per field, drawn in a fixed order.
  const fields: Float32Array[] = [];
  for (let f = 0; f < 4; f++) {
    const ox = rng() * 512;
    const oy = rng() * 512;
    const oz = rng() * 512;
    const cells = CURL_BASE_CELLS * (0.8 + rng() * 0.4);
    fields.push(buildLattice(ox, oy, oz, cells));
  }
  const fx = fields[0]!, fy = fields[1]!, fz = fields[2]!, fw = fields[3]!;

  // Curl by CENTRAL differences with wraparound. Central is symmetric, so the
  // field stays divergence-free on the torus instead of picking up a one-sided
  // bias at cell boundaries.
  const vx = new Float32Array(N);
  const vy = new Float32Array(N);
  const vz = new Float32Array(N);
  let maxMag = 1e-9;
  for (let z = 0; z < S; z++) {
    for (let y = 0; y < S; y++) {
      const row = y * S, rowUp = ((y + 1) & MASK) * S, rowDn = ((y - 1) & MASK) * S;
      for (let x = 0; x < S; x++) {
        const xp = (x + 1) & MASK, xm = (x - 1) & MASK;
        const zc = z * S2, zp = ((z + 1) & MASK) * S2, zm = ((z - 1) & MASK) * S2;
        const i = x + row + zc;
        const ixp = xp + row + zc, ixm = xm + row + zc;
        const iyp = x + rowUp + zc, iym = x + rowDn + zc;
        const izp = x + row + zp, izm = x + row + zm;
        // Half the forward-minus-backward difference (voxel spacing 1).
        const dfzdy = (fz[iyp]! - fz[iym]!) * 0.5;
        const dfydz = (fy[izp]! - fy[izm]!) * 0.5;
        const dfxdz = (fx[izp]! - fx[izm]!) * 0.5;
        const dfzdx = (fz[ixp]! - fz[ixm]!) * 0.5;
        const dfydx = (fy[ixp]! - fy[ixm]!) * 0.5;
        const dfxdy = (fx[iyp]! - fx[iym]!) * 0.5;
        const a = dfzdy - dfydz;
        const b = dfxdz - dfzdx;
        const c = dfydx - dfxdy;
        vx[i] = a; vy[i] = b; vz[i] = c;
        const m = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
        if (m > maxMag) maxMag = m;
      }
    }
  }

  const out = new Uint8Array(N * 4);
  const invMax = 0.5 / maxMag;   // (v / maxMag) * 0.5 folded in
  for (let i = 0; i < N; i++) {
    const o = i << 2;
    out[o] = packUnit(vx[i]! * invMax + 0.5);
    out[o + 1] = packUnit(vy[i]! * invMax + 0.5);
    out[o + 2] = packUnit(vz[i]! * invMax + 0.5);
    out[o + 3] = packUnit(fw[i]! * 0.5 + 0.5);
  }

  if (cache.size >= CACHE_LIMIT) {
    // Drop the oldest entry; seed 0 / the app seed is the one that matters.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(seed, out);
  return out;
}

/** Round a 0..1 value to a byte, clamped (a Float32 lattice can overshoot). */
function packUnit(v: number): number {
  const b = Math.round(v * 255);
  return b < 0 ? 0 : b > 255 ? 255 : b;
}

/** Wrap a volume coordinate into [0, S). */
function wrapCoord(v: number): number {
  const w = v % S;
  return w < 0 ? w + S : w;
}

/** Decode one channel of a packed texel to its -1..1 (or 0..1 for A) value. */
function decodeTexel(data: Uint8Array, xi: number, yi: number, zi: number, c: number): number {
  return data[(((xi + yi * S + zi * S2) << 2) + c)]! * (2 / 255) - 1;
}

/**
 * CPU trilinear sample of the packed volume, with RepeatWrapping on all three
 * axes. Coordinates are in VOLUME space (`world / CURL_SCALE`), so adding
 * CURL_VOLUME_SIZE to any axis returns the same value. Returns the decoded
 * RGB vector in roughly -1..1.
 *
 * The card host uses this to displace each card's anchor by the SAME field the
 * fragment shader warps its atlas UV with, so the whole card both moves and
 * flows, and neighbouring anchors get near-identical vectors.
 */
export function sampleCurlVolume(
  data: Uint8Array, x: number, y: number, z: number,
): Vec3 {
  const x0f = Math.floor(x), y0f = Math.floor(y), z0f = Math.floor(z);
  const fx = x - x0f, fy = y - y0f, fz = z - z0f;
  const x0 = wrapCoord(x0f), y0 = wrapCoord(y0f), z0 = wrapCoord(z0f);
  const x1 = (x0 + 1) & MASK, y1 = (y0 + 1) & MASK, z1 = (z0 + 1) & MASK;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    const c000 = decodeTexel(data, x0, y0, z0, c);
    const c100 = decodeTexel(data, x1, y0, z0, c);
    const c010 = decodeTexel(data, x0, y1, z0, c);
    const c110 = decodeTexel(data, x1, y1, z0, c);
    const c001 = decodeTexel(data, x0, y0, z1, c);
    const c101 = decodeTexel(data, x1, y0, z1, c);
    const c011 = decodeTexel(data, x0, y1, z1, c);
    const c111 = decodeTexel(data, x1, y1, z1, c);
    const c00 = lerp(c000, c100, fx), c10 = lerp(c010, c110, fx);
    const c01 = lerp(c001, c101, fx), c11 = lerp(c011, c111, fx);
    out.push(lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz));
  }
  return out as unknown as Vec3;
}

/** A 3D texture from an already-built volume (the app builds once, then keeps
 *  the CPU array for the anchor displacement). */
export function createCurlTextureFromVolume(data: Uint8Array): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(data, S, S, S);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Build and upload the curl volume for `seed`. */
export function createCurlTexture(seed: number): THREE.Data3DTexture {
  return createCurlTextureFromVolume(buildCurlVolume(seed));
}
