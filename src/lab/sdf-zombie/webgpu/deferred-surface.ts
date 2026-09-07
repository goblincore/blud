// src/lab/sdf-zombie/webgpu/deferred-surface.ts
//
// Surface-buffer schema for the hybrid deferred experiment (spec:
// docs/superpowers/specs/2026-09-06-hybrid-deferred-m1-design.md). This module
// owns the G-buffer attachment contract — names, formats, sizes — and the
// pure CPU helpers that mirror the GPU resolve rule, so tests can pin the
// semantics without a device.
//
// THE CONTRACT. Five named MRT colour attachments plus hardware depth:
//
//   albedoRoughness  rgba16float   linear albedo RGB, perceptual roughness
//   normalMetalness  rgba16float   world-space unit normal XYZ, metalness
//   emissionClass    rgba16float   linear emission RGB, material class (a)
//   surfaceDepth     r32float      WebGPU clip depth in [0,1]; 1 = empty
//   surfaceParams    r32float      packed authored flesh response (0 = absent)
//
// 32 bytes of colour attachment per sample — EXACTLY the 32-byte default
// maxColorAttachmentBytesPerSample budget; the fifth attachment is why the
// budget check is `actual < required` rather than comfortable. r32float is
// colour-renderable in core WebGPU (not blendable, not filterable — both
// irrelevant here: all sampling is nearest/textureLoad and all writes are
// NoBlending).
//
// All G-buffer data is UNLIT LINEAR material data. Nothing prelit, no legacy
// gamma compensation, ever.
//
// surfaceParams (M2 task 7 material-parity repair) carries the AUTHORED
// legacy response scalars the shared light pass needs to reproduce the
// march's flesh material instead of the M1 bounded approximation: the wet-
// scaled specular intensity (P = mix(surfCfg.x, 1.5, gloss) * wet), the
// wet-scaled Fresnel boost (Q = surfCfg.z * (1 - wmRim) * mix(1, 2.5, gloss)
// * wet) and the field AO probe result. All three are UNLIT material/field
// data; the light-dependent composition (H, V, light colour) stays in the
// light pass. Packing is three 8-bit lanes in one exact-float32 integer
// (packSurfaceParams below) — no bitcasts, no NaN hazards, 2^24-1 exact.
//
// NAMES, NOT INDICES. three's MRTNode matches material outputs to render
// target textures BY TEXTURE NAME (see node_modules three
// src/nodes/core/MRTNode.js getTextureIndex), and every consumer here goes
// through getSurfaceTextures(). Attachment order in this file is only the
// creation order; nothing may depend on it downstream.

import * as THREE from 'three/webgpu';

export type SurfaceSource = 'empty' | 'mesh' | 'sdf';

export const SURFACE_ATTACHMENT_NAMES = ['albedoRoughness', 'normalMetalness', 'emissionClass', 'surfaceDepth', 'surfaceParams'] as const;
export type SurfaceAttachmentName = (typeof SURFACE_ATTACHMENT_NAMES)[number];

export type SurfaceTextures = Record<SurfaceAttachmentName, THREE.Texture>;

/** 3 x rgba16float (8 B) + 2 x r32float (4 B each). Exactly the default
 *  maxColorAttachmentBytesPerSample (32) — checked at layer creation. */
export const SURFACE_COLOR_BYTES_PER_SAMPLE = 3 * 8 + 4 + 4;

// ---------------------------------------------------------------------------
// surfaceParams packing (M2 task 7 material-parity repair)
// ---------------------------------------------------------------------------

/** Headroom normalisation for the packed specular intensity P =
 *  mix(surfCfg.x, 1.5, gloss) * wet. The wettest realistic surface is a
 *  melt/wound-lip gloss prims (wet ≈ 2.1 for the shipped presets); 3.5
 *  covers gloss-painted extremes without wasting quantisation steps. */
export const SURFACE_PARAM_SPEC_MAX = 3.5;
/** Same headroom for the packed Fresnel boost Q. surfCfg.z maxes around 1
 *  shipped, ×2.5 gloss × wet ≈ 5. */
export const SURFACE_PARAM_FRESNEL_MAX = 5.0;

/**
 * Packs the three authored response scalars into ONE exact-float32 integer:
 *
 *   v = p8 * 65536 + q8 * 256 + a8     (each lane an 8-bit unorm)
 *
 * The maximum (255 * 65536 + 255 * 256 + 255 = 2^24 - 1) is exactly
 * representable in float32, so the WGSL side can decode with floor/multiply
 * arithmetic and NEVER bitcast — a float32 colour attachment is free to
 * canonicalise NaN payloads, and a bitcast round-trip through one is not
 * safe. The 65536/256 strides keep every floor-decode clean: the lower
 * lanes' maximum (65535) can never spill into the lane above. 8-bit
 * precision per lane is plenty for shading coefficients: the lanes
 * multiply light colour/attenuation that varies continuously, so
 * quantisation never sits still on screen.
 *
 * Returns 0 when every lane is 0 — the sentinel the mesh producer and the
 * clear pass write to mean "no authored response packed" (the light pass
 * keeps the M1 bounded flesh evaluation for those pixels).
 */
export function packSurfaceParams(specIntensity: number, fresnelBoost: number, ao: number): number {
  const lane = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const p8 = lane(specIntensity / SURFACE_PARAM_SPEC_MAX);
  const q8 = lane(fresnelBoost / SURFACE_PARAM_FRESNEL_MAX);
  const a8 = lane(ao);
  return p8 * 65536 + q8 * 256 + a8;
}

/** The exact inverse of packSurfaceParams. Input is the raw attachment
 *  scalar (f32). Rejects negative/nonfinite/above-2^24-1 values — a decode
 *  failure means producer/resolve corruption, never silently shading. */
export function unpackSurfaceParams(v: number): { specIntensity: number; fresnelBoost: number; ao: number } {
  if (!Number.isFinite(v) || v < 0 || v > 16777215) {
    throw new RangeError(`surfaceParams scalar out of the exact-float32 range [0, 16777215]: ${v}`);
  }
  const p8 = Math.floor(v / 65536);
  const rem = v - p8 * 65536;
  const q8 = Math.floor(rem / 256);
  const a8 = rem - q8 * 256;
  return {
    specIntensity: p8 / 255 * SURFACE_PARAM_SPEC_MAX,
    fresnelBoost: q8 / 255 * SURFACE_PARAM_FRESNEL_MAX,
    ao: a8 / 255,
  };
}

/** Material classes carried in emissionClass.a. 0 = empty is the clear value. */
export const SURFACE_CLASS_EMPTY = 0;
export const SURFACE_CLASS_MESH = 1;
export const SURFACE_CLASS_FLESH = 2;
export const SURFACE_CLASS_FLAT = 3;

/**
 * Which flashlight shadow map samples this surface (hybrid deferred M2, spec
 * docs/superpowers/specs/2026-09-06-hybrid-deferred-m2-design.md):
 *
 *   'full'       — the full caster map (level geometry + inflated character
 *                  proxies); sampled by standard opaque mesh receivers so
 *                  characters cast onto the environment.
 *   'level-only' — the level-only map (no inflated flesh proxies); sampled by
 *                  flesh and bone/tissue receivers (and equipment riding an
 *                  actor) so a character's own hull cannot swallow its
 *                  illumination.
 */
export type ShadowReceiver = 'full' | 'level-only';

/** Bit 4 of the packed emissionClass.a value: set = level-only receiver. */
export const SURFACE_RECEIVER_LEVEL_ONLY_BIT = 16;
/** The base class occupies the low four bits (classes 0..3 today, 0..15 legal). */
export const SURFACE_CLASS_MASK = 0b1111;

/**
 * Packs a material class and its shadow receiver into one emissionClass.a
 * scalar WITHOUT a fifth attachment: the low four bits keep the base class,
 * bit 4 selects the level-only receiver, 'full' sets no bit.
 *
 * The EMPTY class always encodes to exactly 0 regardless of receiver — a
 * surface that is not there has no receiver, and the clear sentinel must
 * never grow a bit. Base classes above 15 (or negative/noninteger) are
 * REJECTED rather than folded into the receiver bits.
 */
export function encodeSurfaceClass(baseClass: number, receiver: ShadowReceiver): number {
  if (!Number.isInteger(baseClass) || baseClass < 0 || baseClass > SURFACE_CLASS_MASK) {
    throw new RangeError(
      `surface base class must be an integer in [0, ${SURFACE_CLASS_MASK}], got ${baseClass}`,
    );
  }
  if (receiver !== 'full' && receiver !== 'level-only') {
    throw new RangeError(`unknown shadow receiver '${receiver}' (expected 'full' | 'level-only')`);
  }
  if (baseClass === SURFACE_CLASS_EMPTY) return SURFACE_CLASS_EMPTY;
  return receiver === 'level-only' ? baseClass + SURFACE_RECEIVER_LEVEL_ONLY_BIT : baseClass;
}

/**
 * Unpacks what encodeSurfaceClass packed. Values outside the representable
 * range (noninteger, negative, above bit 4) are rejected: a class readback
 * that fails validation means a producer or resolve bug, never silently
 * misclassified receivers.
 */
export function decodeSurfaceClass(encoded: number): { baseClass: number; receiver: ShadowReceiver } {
  if (!Number.isInteger(encoded) || encoded < 0 || encoded > SURFACE_RECEIVER_LEVEL_ONLY_BIT + SURFACE_CLASS_MASK) {
    throw new RangeError(`encoded surface class must be an integer in [0, 31], got ${encoded}`);
  }
  return {
    baseClass: encoded & SURFACE_CLASS_MASK,
    receiver: (encoded & SURFACE_RECEIVER_LEVEL_ONLY_BIT) !== 0 ? 'level-only' : 'full',
  };
}

/**
 * Trailing options shared by the surface-producing factories (M2 tasks 2+).
 * Every field is optional and defaults to the existing lit behaviour, so all
 * current call sites stay lit and unchanged.
 */
export interface SurfaceOutputOptions {
  /** 'lit' (default) keeps the existing lit output; 'surface' emits the
   *  four named G-buffer attachments instead. */
  output?: 'lit' | 'surface';
  /** Which flashlight shadow map this producer's surface samples. Default
   *  'full' (the existing opaque-mesh receiver category). */
  shadowReceiver?: ShadowReceiver;
}

function assertClipDepth(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite clip depth in [0, 1], got ${value}`);
  }
}

/**
 * CPU reference for the visibility resolve. The GPU implementation (the
 * resolve pass in deferred-layer.ts) must be equivalent; task 3's GPU gate
 * covers that equivalence.
 *
 *   source = meshDepth < 1 && meshDepth <= sdfDepth ? 'mesh'
 *          : sdfDepth < 1 ? 'sdf' : 'empty'
 *
 * Equal depths deterministically favour the mesh. A miss is depth 1.
 */
export function selectSurface(meshDepth: number, sdfDepth: number): SurfaceSource {
  assertClipDepth(meshDepth, 'meshDepth');
  assertClipDepth(sdfDepth, 'sdfDepth');
  if (meshDepth < 1 && meshDepth <= sdfDepth) return 'mesh';
  return sdfDepth < 1 ? 'sdf' : 'empty';
}

function checkedSize(width: number, height: number, label: string): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError(`${label} must be finite and positive, got ${width}x${height}`);
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/** Size of the independently scaled SDF surface target. Fractional positive
 *  results clamp to >= 1 texel; scale must be finite and positive. */
export function sdfTargetSize(width: number, height: number, scale: number): { width: number; height: number } {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError(`sdfScale must be finite and positive, got ${scale}`);
  }
  const full = checkedSize(width, height, 'surface size');
  return {
    width: Math.max(1, Math.round(full.width * scale)),
    height: Math.max(1, Math.round(full.height * scale)),
  };
}

/**
 * Allocates one surface G-buffer target: the four named attachments plus a
 * hardware depth buffer for the geometry producer that renders into it.
 *
 * A THREE RENDER TARGET (not a DataTexture — see the 2026-08-25 trap): it
 * resizes safely via setSize, which reallocates the backing textures.
 */
export function createSurfaceTarget(width: number, height: number): THREE.RenderTarget {
  const size = checkedSize(width, height, 'surface target size');
  const target = new THREE.RenderTarget(size.width, size.height, {
    count: SURFACE_ATTACHMENT_NAMES.length,
    depthBuffer: true,
  });
  target.textures.forEach((tex, i) => {
    tex.name = SURFACE_ATTACHMENT_NAMES[i]!;
    if (tex.name === 'surfaceDepth' || tex.name === 'surfaceParams') {
      tex.format = THREE.RedFormat;
      tex.type = THREE.FloatType;
    } else {
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.HalfFloatType;
    }
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
  });
  return target;
}

/** Name-keyed access to a surface target's attachments. Throws rather than
 *  guessing an index when the schema is not present. */
export function getSurfaceTextures(target: THREE.RenderTarget): SurfaceTextures {
  const byName = new Map<string, THREE.Texture>();
  for (const tex of target.textures) byName.set(tex.name, tex);
  const out = {} as SurfaceTextures;
  for (const name of SURFACE_ATTACHMENT_NAMES) {
    const tex = byName.get(name);
    if (!tex) {
      throw new Error(`surface target is missing attachment '${name}' (has: ${target.textures.map((t) => t.name || '<unnamed>').join(', ')})`);
    }
    out[name] = tex;
  }
  return out;
}
