// src/lab/sdf-zombie/webgpu/curl-volume-node.ts
//
// THE SHARED CURL VOLUME, TSL SIDE (extracted from flame-cards.ts for the
// explosion-curl task). The CPU half — the seeded 64^3 RGBA8 curl field, its
// packer and the CPU trilinear sampler — is curl-volume.ts. This module owns
// the ONE `Data3DTexture` every effect samples, and the TSL function that reads
// it.
//
// ── WHY A SINGLETON ─────────────────────────────────────────────────────
// The volume is ~0.7 s of CPU and 1 MB of VRAM, and it is built with
// Math.random-free seeding, so a per-effect build wastes both AND gives each
// effect a different field. Flame cards and explosions must swirl through the
// SAME divergence-free flow — that is what makes a shared volume worth having.
// So the texture is lazily created on first use and reused for the process's
// life. `disposeCurlVolume()` exists for teardown/tests only; materials hold a
// texture BINDING, so callers must not dispose it while a material that samples
// it is still alive (flame-cards.ts used to own and dispose its own texture —
// it no longer does).
//
// ── WHAT curlVector RETURNS ─────────────────────────────────────────────
// The decoded RGB vector (`rgb * 2 - 1`) of the field at
// `worldPos / scale` scrolled UP by `time * rise` volume units per second. It
// is divergence-free by construction (curl-volume.ts), so it reads as FLOW
// rather than drift, and it is smooth, so neighbouring fragments/cards get
// near-identical vectors and a mass of cards moves as one body.
//
// The shared CPU volume is exposed by `getCurlVolumeData()` so a CPU anchor
// displacement can sample the identical field the shader warps with.

import * as THREE from 'three/webgpu';
import { texture3D, vec3 } from 'three/tsl';
import {
  buildCurlVolume, createCurlTextureFromVolume, CURL_SCALE,
} from './curl-volume';

export { CURL_SCALE, CURL_VOLUME_SIZE } from './curl-volume';

/**
 * The seed of the shared field. One seed for every effect, deliberately: two
 * effects that swirl through different fields do not read as one world.
 */
export const CURL_NODE_SEED = 0x51c0ff;

/**
 * Volume units per second the shared field scrolls upward at the default. The
 * flame cards' own value (its shimmer must stay slower than the 15 fps
 * flipbook); explosions use the same rise so fire and fire look related.
 */
export const CURL_NODE_RISE = 0.45;

/** TSL's typings reject chained arithmetic; the repo casts at call sites. */
interface Tsl {
  x: Tsl; y: Tsl; z: Tsl; rgb: Tsl;
  add(v: Tsl | number): Tsl;
  sub(v: Tsl | number): Tsl;
  mul(v: Tsl | number): Tsl;
  div(v: Tsl | number): Tsl;
}
type N = never;

let sharedData: Uint8Array | null = null;
let sharedTexture: THREE.Data3DTexture | null = null;

/**
 * The shared CPU volume, built once and returned read-only. Callers must not
 * mutate it (both the upload and the CPU sampler read the same array).
 */
export function getCurlVolumeData(): Uint8Array {
  if (!sharedData) sharedData = buildCurlVolume(CURL_NODE_SEED);
  return sharedData;
}

/**
 * The one shared 64^3 RGBA8 curl `Data3DTexture`, lazily built and uploaded on
 * first use. Linear/Linear + Repeat on all three axes (the filterability and
 * tiling the shader depends on); no mipmaps.
 */
export function getCurlTexture(): THREE.Data3DTexture {
  if (!sharedTexture) sharedTexture = createCurlTextureFromVolume(getCurlVolumeData());
  return sharedTexture;
}

/**
 * The decoded curl vector at `worldPos / scale`, scrolled up by
 * `time * rise` volume units. Returns a TSL vec3 node in roughly -1..1.
 *
 * `scale` is world metres per volume repeat (smaller = more, tighter swirl
 * cells); `rise` is the upward scroll in volume units per second. Both accept a
 * TSL node as well as a number, so a live tuning uniform can drive them.
 */
export function curlVector(
  worldPos: Tsl,
  time: Tsl,
  scale: Tsl | number = CURL_SCALE,
  rise: Tsl | number = CURL_NODE_RISE,
): Tsl {
  const uv = (worldPos as Tsl)
    .div(scale as Tsl | number)
    .sub(vec3(0, (time as Tsl).mul(rise as Tsl | number) as N, 0) as N) as unknown as Tsl;
  const tex = texture3D(getCurlTexture(), uv as N) as unknown as Tsl;
  return (tex.rgb as Tsl).mul(2).sub(1) as unknown as Tsl;
}

/**
 * Drop the shared texture and CPU volume (teardown/tests). The next
 * `getCurlTexture()` call rebuilds and re-uploads. Do NOT call while a live
 * material samples the texture.
 */
export function disposeCurlVolume(): void {
  if (sharedTexture) {
    sharedTexture.dispose();
    sharedTexture = null;
  }
  sharedData = null;
}
