// src/lab/sdf-zombie/webgpu/baked-chunks.test.ts
//
// M2 task 2: the baked-chunk material split. The lit path (chunkShade) is
// untouched — pins below hold its shape; the surface path must publish the
// BAKED vertex albedo/wetness as light-invariant G-buffer terms, never the
// old lit color.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  createBakedChunkMaterial, CHUNK_SHADE_WGSL, CHUNK_SURFACE_WGSL,
} from './baked-chunks';
import { encodeSurfaceClass } from './deferred-surface';

describe('createBakedChunkMaterial — default lit path (M1 behavior)', () => {
  it('stays lit: colorNode output, no MRT, live lighting uniforms', () => {
    const baked = createBakedChunkMaterial();
    const mat = baked.material as unknown as {
      mrtNode: unknown; colorNode: unknown; depthWrite: boolean; depthTest: boolean;
    };
    expect(mat.mrtNode).toBeNull();
    expect(mat.colorNode).toBeTruthy();
    expect(mat.depthWrite).toBe(true);
    expect(mat.depthTest).toBe(true);
    expect(baked.surfaceKind).toBeUndefined();
    // The live uniform set the page refreshes per frame from the flashlight.
    expect(baked.uniforms.spotCfg).toBeTruthy();
    expect(baked.uniforms.lightCfg).toBeTruthy();
    baked.dispose();
  });

  it('chunkShade keeps the light compose: beam, diffuse, wet specular from the baked mask', () => {
    for (const present of [
      'if (spotCfg.x > 0.0)',
      'let diffuse = albedo.rgb * (ambient + keyI * keyC * (0.15 + 0.85 * ndl));',
      'let wm = clamp(albedo.a, 0.0, 1.0);',
      'let specular = keyC * wetTint',
    ]) {
      expect(CHUNK_SHADE_WGSL).toContain(present);
    }
  });
});

describe('createBakedChunkMaterial — surface mode (M2 task 2)', () => {
  it('emits the four named attachments from the baked vertex terms, no lit color', () => {
    const baked = createBakedChunkMaterial({ output: 'surface' });
    const mat = baked.material as unknown as {
      mrtNode: { outputNodes: Record<string, unknown> } | null;
      colorNode: unknown;
      blending: THREE.Blending;
    };
    expect(Object.keys(mat.mrtNode!.outputNodes).sort())
      .toEqual(['albedoRoughness', 'emissionClass', 'normalMetalness', 'surfaceDepth']);
    expect(mat.colorNode).toBeNull();
    expect(mat.blending).toBe(THREE.NoBlending);
    // Mesh-class receiver, 'full' default.
    expect(baked.surfaceKind).toBe(encodeSurfaceClass(1, 'full'));
    expect(baked.surfaceKind).toBe(1);
    baked.dispose();
  });

  it('honours shadowReceiver level-only (17) and stays mesh class', () => {
    const baked = createBakedChunkMaterial({ output: 'surface', shadowReceiver: 'level-only' });
    expect(baked.surfaceKind).toBe(encodeSurfaceClass(1, 'level-only'));
    expect(baked.surfaceKind).toBe(17);
    baked.dispose();
  });

  it('chunkSurface is light-invariant: albedo attribute in, roughness from the wet mask', () => {
    const sig = CHUNK_SURFACE_WGSL.slice(CHUNK_SURFACE_WGSL.indexOf('('), CHUNK_SURFACE_WGSL.indexOf(') ->'));
    for (const absent of ['lightDir', 'keyColor', 'lightCfg', 'spotPos', 'spotAxis', 'spotCfg', 'spotColor', 'ambient', 'camPos']) {
      expect(sig).not.toContain(absent);
    }
    // The albedo IS the baked attribute (rgb), roughness mapped from the
    // wound-mask wetness (.a) — the lit color is never encoded here.
    expect(CHUNK_SURFACE_WGSL).toContain('let rough = clamp(mix(0.9, 0.31, wm), 0.04, 1.0);');
    expect(CHUNK_SURFACE_WGSL).toContain('return vec4<f32>(albedo.rgb, rough);');
  });
});

// M2 task 5 regression (2026-09-07): same shape as the bone-instancer one —
// the router reads material.surfaceKind (materialEligibility), not the
// factory handle. A removed stamp must fail HERE, not on a live game boot
// where the baked chunk silently vanishes from its pass.
describe('router eligibility through the actual material (not the handle)', () => {
  it('materialEligibility admits a surface-mode baked-chunk material as a producer', async () => {
    const { materialEligibility } = await import('./game-deferred-scene');
    const baked = createBakedChunkMaterial({ output: 'surface' });
    expect(materialEligibility(baked.material as THREE.Material)).toBe('asis');
    baked.dispose();
  });

  it('a level-only receiver material is admitted the same way', async () => {
    const { materialEligibility } = await import('./game-deferred-scene');
    const baked = createBakedChunkMaterial({ output: 'surface', shadowReceiver: 'level-only' });
    expect(materialEligibility(baked.material as THREE.Material)).toBe('asis');
    baked.dispose();
  });
});
