// src/lab/sdf-zombie/webgpu/deferred-lighting.ts
//
// Light packing for the shared deferred light pass. One fixed-capacity buffer
// (16 lights), a runtime active count, and a documented stride, so moving or
// enabling a light is a data upload and never a shader rebuild.
//
// PACKED LAYOUT — 16 floats (4 vec4) per light:
//
//   v0  position.xyz,  kind (0 = point, 1 = spot)
//   v1  direction.xyz, range  (units; range <= 0 rejected)
//   v2  color.rgb,     intensity
//   v3  cosInner, cosOuter, fleshKeyIntensity, fleshShoulderKnee
//
//   v3.z / v3.w (M2 task 5 game conversion, 2026-09-07): the flashlight slot's
//   MARCH-KEY response for FLESH-class receivers, and the flesh highlight
//   shoulder knee. The legacy march shades bodies with
//   `beamGain * (1 - d/range)^2` — a linear-to-range window, NO inverse
//   square — plus softShoulder(knee) so a beam-lit body keeps its wound
//   detail, while three's physical I/d^2 stays authoritative for the level.
//   One packed light therefore serves TWO receiver models: flesh evaluates
//   v3.z, everything else evaluates v2.w. Both default to 0 = feature off,
//   which is bit-identical to the pre-task-5 behaviour (every M1 fixture).
//
// (v0..v3 in the order the WGSL light pass reads them: textureLoad columns
// 0..3 of the 4x16 RGBA32F light data texture, row = light index.)
//
// The DataTexture is allocated ONCE at full capacity and never resized — the
// 2026-08-25 DataTexture trap (swapping image.data/width/height does not
// reallocate the GPU texture). Updates copy a freshly packed, full-capacity
// array into the same image buffer and flag needsUpdate, so inactive slots
// are zero on every update.

import * as THREE from 'three/webgpu';

export const MAX_DEFERRED_LIGHTS = 16;
export const DEFERRED_LIGHT_STRIDE_FLOATS = 16;

export const LIGHT_KIND_POINT = 0;
export const LIGHT_KIND_SPOT = 1;

/** The packed v3.z sentinel for a march flesh key PRESENT WITH GAIN 0 (see
 *  the packed-layout note). The API field is nonnegative; presence is
 *  `fleshKeyIntensity !== undefined`. The WGSL branches on `v3.z != 0` and
 *  evaluates `max(v3.z, 0)`, so the sentinel selects the march model with an
 *  exactly-zero contribution. */
export const FLESH_KEY_PRESENT_ZERO = -1;

export interface DeferredLight {
  kind: 'point' | 'spot';
  position: readonly [number, number, number];
  direction: readonly [number, number, number];
  color: readonly [number, number, number];
  intensity: number;
  range: number;
  cosInner: number;
  cosOuter: number;
  /** Flesh-class key intensity under the MARCH falloff model
   *  (`key * (1 - d/range)^2` — see the packed-layout note on v3.z).
   *  ABSENT (undefined): flesh evaluates the packed physical `intensity`
   *  like every other class — every M1 fixture. PRESENT (including 0): the
   *  march model replaces the physical one for flesh, so an explicit 0
   *  removes the beam from flesh receivers while the level keeps the
   *  physical slot (the game's beam-gain-0 panel position). Only the game's
   *  flashlight slot sets it. */
  fleshKeyIntensity?: number;
  /** softShoulder knee applied to the flesh-class lit sum (packed v3.w).
   *  0/absent = off. Mirrors the march's beam shoulder (spotCfg2.y 0.35 →
   *  knee 0.65): compresses [knee, inf) into [knee, 1) monotonically so two
   *  differently-bright flesh texels stay different. Accepted range is the
   *  march's own [0, 1): the legacy shader clamps 1-shoulder into
   *  [0.05, 0.99], so every legal panel value must pack (composition review
   *  fix — the old `< 0.95` bound threw on the LEGAL panel value 0.05,
   *  killing every deferred frame at that tuning). */
  fleshShoulderKnee?: number;
}

function assertFiniteTriple(value: readonly [number, number, number], label: string): void {
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(value[i])) throw new RangeError(`${label}[${i}] must be finite, got ${value[i]}`);
  }
}

/**
 * Packs lights into a full-capacity Float32Array. Inactive slots are zeros on
 * every call, so consumers can upload the whole array without residue from a
 * previous, larger set. Throws on overflow or nonfinite data rather than
 * poisoning the GPU buffer.
 */
export function packDeferredLights(lights: readonly DeferredLight[]): { data: Float32Array; count: number } {
  if (lights.length > MAX_DEFERRED_LIGHTS) {
    throw new RangeError(`deferred light capacity is ${MAX_DEFERRED_LIGHTS}, got ${lights.length}`);
  }
  const data = new Float32Array(MAX_DEFERRED_LIGHTS * DEFERRED_LIGHT_STRIDE_FLOATS);
  lights.forEach((light, i) => {
    assertFiniteTriple(light.position, `lights[${i}].position`);
    assertFiniteTriple(light.direction, `lights[${i}].direction`);
    assertFiniteTriple(light.color, `lights[${i}].color`);
    for (const [label, v] of [['intensity', light.intensity], ['range', light.range], ['cosInner', light.cosInner], ['cosOuter', light.cosOuter]] as const) {
      if (!Number.isFinite(v)) throw new RangeError(`lights[${i}].${label} must be finite, got ${v}`);
    }
    if (light.range <= 0) throw new RangeError(`lights[${i}].range must be positive, got ${light.range}`);
    const key = light.fleshKeyIntensity;
    if (key !== undefined && (!Number.isFinite(key) || key < 0)) {
      throw new RangeError(`lights[${i}].fleshKeyIntensity must be finite >= 0, got ${key}`);
    }
    const knee = light.fleshShoulderKnee ?? 0;
    if (!Number.isFinite(knee) || knee < 0 || knee >= 1) {
      throw new RangeError(`lights[${i}].fleshShoulderKnee must be finite in [0, 1), got ${knee}`);
    }
    for (let c = 0; c < 3; c++) {
      if (light.color[c]! < 0) throw new RangeError(`lights[${i}].color[${c}] must be >= 0, got ${light.color[c]}`);
    }
    const o = i * DEFERRED_LIGHT_STRIDE_FLOATS;
    data[o + 0] = light.position[0];
    data[o + 1] = light.position[1];
    data[o + 2] = light.position[2];
    data[o + 3] = light.kind === 'spot' ? LIGHT_KIND_SPOT : LIGHT_KIND_POINT;
    data[o + 4] = light.direction[0];
    data[o + 5] = light.direction[1];
    data[o + 6] = light.direction[2];
    data[o + 7] = light.range;
    data[o + 8] = light.color[0];
    data[o + 9] = light.color[1];
    data[o + 10] = light.color[2];
    data[o + 11] = light.intensity;
    data[o + 12] = light.cosInner;
    data[o + 13] = light.cosOuter;
    // Present-zero encodes as the sentinel (see the v3.z note): 0 alone
    // means ABSENT, the M1 fixture shape.
    data[o + 14] = key === undefined ? 0 : (key === 0 ? FLESH_KEY_PRESENT_ZERO : key);
    data[o + 15] = light.fleshShoulderKnee ?? 0;
  });
  return { data, count: lights.length };
}

/** The fixed-capacity light buffer texture: row = light index, columns = the
 *  four packed vec4s. Allocate once; upload in place. */
export function createDeferredLightTexture(): THREE.DataTexture {
  const data = new Float32Array(MAX_DEFERRED_LIGHTS * DEFERRED_LIGHT_STRIDE_FLOATS);
  const tex = new THREE.DataTexture(data, DEFERRED_LIGHT_STRIDE_FLOATS / 4, MAX_DEFERRED_LIGHTS, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** In-place upload into the fixed-capacity texture. Never resizes it. */
export function uploadDeferredLights(texture: THREE.DataTexture, packed: { data: Float32Array; count: number }): void {
  const image = texture.image as { data: Float32Array; width: number; height: number };
  if (image.data.length !== packed.data.length) {
    throw new Error(`light texture capacity mismatch: ${image.data.length} floats vs packed ${packed.data.length}`);
  }
  image.data.set(packed.data);
  texture.needsUpdate = true;
}
