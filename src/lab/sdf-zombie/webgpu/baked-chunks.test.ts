// src/lab/sdf-zombie/webgpu/baked-chunks.test.ts
//
// M2 task 2: the baked-chunk material split. The lit path (chunkShade) is
// untouched — pins below hold its shape; the surface path must publish the
// BAKED vertex albedo/wetness as light-invariant G-buffer terms, never the
// old lit color.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  createBakedChunkMaterial, CHUNK_SHADE_WGSL, CHUNK_FACE_SHADE_WGSL, CHUNK_SURFACE_WGSL,
} from './baked-chunks';
import { encodeSurfaceClass, SURFACE_ATTACHMENT_NAMES } from './deferred-surface';

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
    // The compose now reads the LOCAL albedo/normal/wetness (`a`, `nrm`, `wm`)
    // rather than the parameters directly, because the procedural detail layer
    // modifies them before the light sees them — see CHUNK_SHADE_WGSL's header.
    // What must not change is the compose itself.
    //
    // The diffuse term gained a trailing `* ao` (2026-09-11): a BAKED per-vertex
    // occlusion, multiplying the lit term exactly where the march multiplies its
    // own cheap field AO. It is 1.0 unless the material opts in via `bakedAo`,
    // so every other user of this shader composes identically.
    for (const present of [
      'if (spotCfg.x > 0.0)',
      // The 0.15 constant became `look.x` (2026-09-15): a DIFFUSE KEY FLOOR the
      // march does not have, which is why a settled piece could never be in
      // shadow. It defaults to 0.04, and at 0 the term is plain `ndl`.
      'let diffuse = a.rgb * (ambient + keyI * keyC * (floorK + (1.0 - floorK) * ndl)) * ao;',
      'let wm = clamp(a.a, 0.0, 1.0);',
      'let meshSpec = keyC * wetTint',
    ]) {
      expect(CHUNK_SHADE_WGSL).toContain(present);
    }
  });

  it('the detail layer is GATED, so every existing user is unchanged', () => {
    // The detail (bump, blood decals, organ gloss) sits behind `goreCfg.x > 0`,
    // whose uniform default is 0 — so a baked chunk that never opts in shades as
    // it always did. If this gate is ever removed, every settled piece in the
    // game changes appearance without anybody choosing it.
    expect(CHUNK_SHADE_WGSL).toContain('if (goreCfg.x > 0.0) {');
    const mat = createBakedChunkMaterial();
    expect(mat.uniforms.goreCfg.value.x).toBe(0);
    // ...and the opt-in path is what turns it on.
    expect(createBakedChunkMaterial({ goreDetail: true }).uniforms.goreCfg.value.x)
      .toBe(0);   // the FLAG still needs the page to set the amp

  });
});

describe('chunkShade — shared light list (plan 1, Task 12)', () => {
  it('takes picks, the list and the switch after fresnelGain, before any face args', () => {
    for (const src of [CHUNK_SHADE_WGSL, CHUNK_FACE_SHADE_WGSL]) {
      expect(src).toContain('fresnelGain: f32, picks: vec4<f32>, lights: ptr<storage, array<vec4<f32>>, read>, listOn: f32, listGain: f32');
    }
    expect(CHUNK_FACE_SHADE_WGSL).toContain('listGain: f32, faceTex: texture_2d<f32>');
  });
  it('the list branch swaps only the key: bodyLights, ambient/AO kept, fresnel on the dominant colour', () => {
    for (const src of [CHUNK_SHADE_WGSL, CHUNK_FACE_SHADE_WGSL]) {
      expect(src).toContain('if (listOn > 0.5) {');
      expect(src).toContain('let bl = bodyLights(p, nrm, V, picks, lights, false);');
      // every list term rides the chunk trim (lightListCfg.y, CHUNK_LIST_GAIN)
      expect(src).toContain('let domC = bl.domC * listGain;');
      expect(src).toContain('let rimC = select(keyColor, domC / max(peak, 1e-4), peak > 1e-4);');
      expect(src).toContain('let diffL = a.rgb * (ambient + bl.diffuse * listGain) * ao;');
      expect(src).toContain('let meshSpecL = wetTint * (bl.spec * listGain * look.z + rimC * fres * (0.5 + 0.5 * peak)) + bl.rim * listGain;');
      expect(src).toContain('let fleshSpecL = (bl.spec * listGain * response.w + rimC * fres) * response.y + bl.rim * listGain;');
      // the shoulder runs whenever the list is on, as the march's (compose.wgsl.ts)
      expect(src).toContain('if ((spotCfg.x > 0.0 || listOn > 0.5) && spotCfg2.y > 0.0) {');
      // the list branch lands before the shoulder and the display transform, which still apply
      expect(src.indexOf('if (listOn > 0.5) {')).toBeLessThan(src.indexOf('if ((spotCfg.x > 0.0 || listOn > 0.5) && spotCfg2.y > 0.0) {'));
      // the old compose is still there for listOn 0
      expect(src).toContain('let diffuse = a.rgb * (ambient + keyI * keyC * (floorK + (1.0 - floorK) * ndl)) * ao;');
    }
    expect(CHUNK_SHADE_WGSL).not.toContain('flatKey');
    expect(CHUNK_FACE_SHADE_WGSL).toContain('var flatKey = 0.30 * lightCfg.x * keyColor;');
    expect(CHUNK_FACE_SHADE_WGSL).toContain('flatKey = 0.30 * domC;');
    expect(CHUNK_FACE_SHADE_WGSL).toContain('out = mix(out, a.rgb * (ambient + flatKey), faceFlat * 0.85);');
  });
  it('uniform defaults: no picks (-1 x 4), list off (x = 0)', () => {
    const m = createBakedChunkMaterial();
    expect(m.uniforms.chunkLights.value.toArray()).toEqual([-1, -1, -1, -1]);
    expect(m.uniforms.lightListCfg.value.toArray()).toEqual([0, 0, 0, 0]);
    m.dispose();
  });
  it('builds with a list node or without one (the zero fallback is bound)', () => {
    expect(createBakedChunkMaterial({ lightList: undefined }).material).toBeTruthy();
    expect(createBakedChunkMaterial({ fleshResponse: true, bakedAo: true }).material).toBeTruthy();
  });
});

describe('createBakedChunkMaterial — surface mode (M2 task 2)', () => {
  it('emits every surface attachment from the baked vertex terms, no lit color', () => {
    const baked = createBakedChunkMaterial({ output: 'surface' });
    const mat = baked.material as unknown as {
      mrtNode: { outputNodes: Record<string, unknown> } | null;
      colorNode: unknown;
      blending: THREE.Blending;
    };
    expect(Object.keys(mat.mrtNode!.outputNodes).sort())
      .toEqual([...SURFACE_ATTACHMENT_NAMES].sort());
    const params = mat.mrtNode!.outputNodes.surfaceParams as { node: { nodes: Array<{ node: { value: number } }> } };
    expect(params.node.nodes.map(n => n.node.value)).toEqual([0, 0, 0, 1]);
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
