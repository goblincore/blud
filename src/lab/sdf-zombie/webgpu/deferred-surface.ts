// src/lab/sdf-zombie/webgpu/deferred-surface.ts
//
// Surface-buffer schema for the hybrid deferred experiment (spec:
// docs/superpowers/specs/2026-09-06-hybrid-deferred-m1-design.md). This module
// owns the G-buffer attachment contract — names, formats, sizes — and the
// pure CPU helpers that mirror the GPU resolve rule, so tests can pin the
// semantics without a device.
//
// THE CONTRACT. Four named MRT colour attachments plus hardware depth:
//
//   albedoRoughness  rgba16float   linear albedo RGB, perceptual roughness
//   normalMetalness  rgba16float   world-space unit normal XYZ, metalness
//   emissionClass    rgba16float   linear emission RGB, material class (a)
//   surfaceDepth     r32float      WebGPU clip depth in [0,1]; 1 = empty
//
// 28 bytes of colour attachment per sample, inside the 32-byte default
// maxColorAttachmentBytesPerSample budget. r32float is colour-renderable in
// core WebGPU (not blendable, not filterable — both irrelevant here: all
// sampling is nearest/textureLoad and all writes are NoBlending).
//
// All G-buffer data is UNLIT LINEAR material data. Nothing prelit, no legacy
// gamma compensation, ever.
//
// NAMES, NOT INDICES. three's MRTNode matches material outputs to render
// target textures BY TEXTURE NAME (see node_modules three
// src/nodes/core/MRTNode.js getTextureIndex), and every consumer here goes
// through getSurfaceTextures(). Attachment order in this file is only the
// creation order; nothing may depend on it downstream.

import * as THREE from 'three/webgpu';

export type SurfaceSource = 'empty' | 'mesh' | 'sdf';

export const SURFACE_ATTACHMENT_NAMES = ['albedoRoughness', 'normalMetalness', 'emissionClass', 'surfaceDepth'] as const;
export type SurfaceAttachmentName = (typeof SURFACE_ATTACHMENT_NAMES)[number];

export type SurfaceTextures = Record<SurfaceAttachmentName, THREE.Texture>;

/** 3 x rgba16float (8 B) + 1 x r32float (4 B). Checked against the adapter's
 *  maxColorAttachmentBytesPerSample (32 by default) at layer creation. */
export const SURFACE_COLOR_BYTES_PER_SAMPLE = 3 * 8 + 4;

/** Material classes carried in emissionClass.a. 0 = empty is the clear value. */
export const SURFACE_CLASS_EMPTY = 0;
export const SURFACE_CLASS_MESH = 1;
export const SURFACE_CLASS_FLESH = 2;
export const SURFACE_CLASS_FLAT = 3;

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
    if (tex.name === 'surfaceDepth') {
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
