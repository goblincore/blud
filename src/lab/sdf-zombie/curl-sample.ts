// src/lab/sdf-zombie/curl-sample.ts
//
// CPU SIDE OF THE SHARED CURL VOLUME (2026-09-18 blood-curl-spike): a pure,
// THREE-FREE trilinear sampler over the packed `Uint8Array` from
// `buildCurlVolume` (webgpu/curl-volume.ts), plus the world-space accessor the
// droplet sim integrates with.
//
// ── WHY THIS MODULE EXISTS SEPARATELY ───────────────────────────────────
// `blood-sim.ts` is deliberately renderer-free ("No three import: renderer
// views live per path") and is stepped in plain vitest. The volume BUILDER
// (webgpu/curl-volume.ts) imports `three/webgpu` to hand back a
// `Data3DTexture`, so the sim cannot import it just to sample a byte array.
// This module owns the sampling primitives with no three import; curl-volume.ts
// imports the same functions so there is exactly ONE trilinear implementation
// (the old `sampleCurlVolume` lives here now and is re-exported from
// curl-volume.ts for its existing callers).
//
// ── THE DECODE/TILING CONTRACT ──────────────────────────────────────────
// The packed volume is `rgb = vector * 0.5 + 0.5` (`rgb / 255 * 2 - 1`
// decodes it), one texel per unit of volume space, and it tiles on all three
// axes (the builder takes the curl with wraparound). So `sampleCurlVolume`
// wraps its integer lattice indices with `& 63` and adds 64 to any coordinate
// to get the identical vector. `sampleCurlWorld` divides world metres by a
// scale before sampling, matching the shader's `position / CURL_SCALE`.
//
// ── DETERMINISM ─────────────────────────────────────────────────────────
// Pure arithmetic over the caller's array: no Math.random, no clock, no state.
// The same array and coordinates always decode to the same vector, which is
// what lets the sim pin "flow off is byte-identical" and "flow on is
// reproducible from a seed".

import type { Vec3 } from './types';

/** Edge length of the cubic volume, texels. The single source of truth the
 *  packer, the texture and this sampler all agree on (curl-volume re-exports
 *  it). */
export const CURL_VOLUME_SIZE = 64;

/** World metres per volume repeat: the shader samples `position / CURL_SCALE`.
 *  curl-volume re-exports this for the GPU side. */
export const CURL_SCALE = 6;

/** The fourth scalar's channel index in the packed RGBA8 volume. */
export const CURL_ALPHA_CHANNEL = 3;

const S = CURL_VOLUME_SIZE;
const S2 = S * S;
const MASK = S - 1;   // 64 is a power of two; & MASK wraps a non-negative index

/**
 * One world-space curl advection setting for `stepBlood`. `data` is the shared
 * packed volume (read-only), `strength` is the acceleration in m/s^2 applied
 * along the sampled vector, `scale` is world metres per volume repeat, `drift`
 * is volume units per second the sample point advances along +Y, and `time` is
 * the sim time in seconds that drives the drift.
 *
 * All fields are plain numbers so the whole object can be rebuilt per frame
 * without touching the sim's state; `strength === 0` is the off switch and is
 * skipped entirely (byte-identical baseline).
 */
export interface CurlFlow {
  readonly data: Uint8Array;
  readonly strength: number;
  readonly scale: number;
  readonly drift: number;
  readonly time: number;
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
 * axes. Coordinates are in VOLUME space (`world / scale`), so adding
 * `CURL_VOLUME_SIZE` to any axis returns the same value. Returns the decoded
 * RGB vector in roughly -1..1.
 *
 * This is the one trilinear implementation: `blood-sim.ts` reaches it through
 * `curlAccelAt`, and flame-cards reaches it through curl-volume.ts's
 * re-export.
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

/**
 * The decoded curl vector at a WORLD position, i.e. `sampleCurlVolume` at
 * `world / scale`. The shader's shared accessor divides by `CURL_SCALE` the
 * same way, so a CPU-anchored effect and a fragment-warped effect read the
 * identical cell.
 */
export function sampleCurlWorld(
  data: Uint8Array, wx: number, wy: number, wz: number, scale: number = CURL_SCALE,
): Vec3 {
  const s = scale > 0 ? scale : CURL_SCALE;
  return sampleCurlVolume(data, wx / s, wy / s, wz / s);
}

/**
 * The world-space acceleration `curl(world / scale + time * drift) * strength`
 * that `stepBlood` adds to an airborne droplet. The drift advances the sample
 * point along +Y (volume units per second), so the stored field appears to
 * scroll as time passes; at `drift = 0` the field is frozen in place and only
 * the droplet's own motion changes the sample.
 *
 * A non-positive `scale` falls back to `CURL_SCALE` rather than dividing by
 * zero — a zero-strength call is skipped by the caller anyway, but a live
 * slider can momentarily read 0.
 */
export function curlAccelAt(
  flow: CurlFlow, wx: number, wy: number, wz: number,
): Vec3 {
  const s = flow.scale > 0 ? flow.scale : CURL_SCALE;
  const v = sampleCurlVolume(
    flow.data,
    wx / s,
    wy / s + flow.time * flow.drift,
    wz / s,
  );
  const k = flow.strength;
  return [v[0] * k, v[1] * k, v[2] * k] as unknown as Vec3;
}
