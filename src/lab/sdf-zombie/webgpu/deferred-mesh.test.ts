// src/lab/sdf-zombie/webgpu/deferred-mesh.test.ts
//
// Focused pins for the deferred mesh adapter (M2 task 3): receiver metadata
// on the class channel, and the material-preservation contract the game's
// level/kit/prop materials rely on when they enter the opaque MRT pass.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createDeferredMeshMaterial } from './deferred-mesh';
import { encodeSurfaceClass } from './deferred-surface';

/** The adapter as NodeMaterial-shaped plus the task-2 diagnostics marker. */
type AdapterMat = {
  mrtNode: { outputNodes: Record<string, unknown> } | null;
  surfaceKind?: number;
  fog: boolean;
  transparent: boolean;
  blending: THREE.Blending;
  alphaTest: number;
  side: THREE.Side;
  vertexColors: boolean;
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  emissiveMap: THREE.Texture | null;
  lights: boolean;
};

describe('createDeferredMeshMaterial receiver metadata (M2 task 3)', () => {
  it('defaults to the M1 encoding exactly: mesh class 1, full receiver, no bit', () => {
    const adapter = createDeferredMeshMaterial(new THREE.MeshStandardMaterial()) as AdapterMat;
    expect(adapter.surfaceKind).toBe(encodeSurfaceClass(1, 'full'));
    expect(adapter.surfaceKind).toBe(1);
  });

  it("encodes the level-only receiver as 17 (mesh class + bit 4), matching encodeSurfaceClass(1,'level-only')", () => {
    const adapter = createDeferredMeshMaterial(new THREE.MeshStandardMaterial(), {
      output: 'surface',
      shadowReceiver: 'level-only',
    }) as AdapterMat;
    expect(adapter.surfaceKind).toBe(encodeSurfaceClass(1, 'level-only'));
    expect(adapter.surfaceKind).toBe(17);
  });

  it('rejects an unknown receiver rather than silently encoding full', () => {
    expect(() =>
      createDeferredMeshMaterial(new THREE.MeshStandardMaterial(), {
        shadowReceiver: 'both' as 'level-only',
      }),
    ).toThrow();
  });
});

describe('createDeferredMeshMaterial material preservation (game materials)', () => {
  it('keeps mapped/cutout state: maps by REFERENCE, alphaTest, side, vertexColors', () => {
    const map = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const src = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.1,
    });
    const adapter = createDeferredMeshMaterial(src) as AdapterMat;
    // Texture ownership stays with the source (spec: dispose owned adapters
    // without disposing shared original assets — never clone here).
    expect(adapter.map).toBe(map);
    expect(adapter.normalMap).toBe(normalMap);
    // Cutout survives: the G-buffer pass is opaque, but alphaTest discard
    // must come through or the cutout silhouette fills solid.
    expect(adapter.alphaTest).toBe(0.5);
    expect(adapter.side).toBe(THREE.DoubleSide);
    expect(adapter.vertexColors).toBe(true);
  });

  it('stays unlit G-buffer data: lights off, fog off, no transparency', () => {
    const src = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 });
    const adapter = createDeferredMeshMaterial(src) as AdapterMat;
    expect(adapter.lights).toBe(false);
    // The GAME scene carries scene.fog (dungeon rig); fog is a lit-stage term
    // evaluated once in the shared light pass — never pre-baked into albedo.
    expect(adapter.fog).toBe(false);
    // Even a transparent SOURCE enters the MRT pass opaque (transparent
    // materials are the forward route's business — the router excludes them;
    // the adapter itself must never blend).
    expect(adapter.transparent).toBe(false);
    expect(adapter.blending).toBe(THREE.NoBlending);
  });

  it('keeps emission so emissive game materials glow in the lit stage', () => {
    const src = new THREE.MeshStandardMaterial({
      emissive: new THREE.Color(1.0, 0.2, 0.1),
      emissiveIntensity: 2.2,
    });
    const adapter = createDeferredMeshMaterial(src);
    expect(adapter.emissive.r).toBeCloseTo(src.emissive.r, 6);
    expect(adapter.emissive.g).toBeCloseTo(src.emissive.g, 6);
    expect(adapter.emissive.b).toBeCloseTo(src.emissive.b, 6);
    expect(adapter.emissiveIntensity).toBe(2.2);
  });

  it('an emissiveMap source keeps the map by reference (the r185 vec4 trap is a GPU-side witness)', () => {
    // With an emissiveMap, three r185's MaterialNode multiplies the emissive
    // colour by the RAW texture sample (vec4 — MaterialNode.js:225 has no
    // .rgb swizzle), so the mrt emissionClass join MUST swizzle .rgb or the
    // WGSL join exceeds vec4 and the validator rejects the whole graph at
    // build time. The rejection only materialises inside a node BUILDER
    // (JoinNode.generate — error() at generate, not construct), so the pure
    // witness is the on-device composition check
    // (scripts/deferred-game-composition-check.mjs, arms route: page errors
    // before the fix, clean after); here we pin the reference contract only.
    const tex = new THREE.Texture();
    const src = new THREE.MeshStandardMaterial({
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: 1.4,
      map: tex,
    });
    const adapter = createDeferredMeshMaterial(src) as AdapterMat;
    expect(adapter.emissiveMap).toBe(tex);
    expect(adapter.map).toBe(tex);
    expect(adapter.mrtNode).not.toBeNull();
    expect(adapter.mrtNode!.outputNodes.emissionClass).toBeDefined();
  });
});
