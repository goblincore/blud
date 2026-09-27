// src/lab/sdf-zombie/webgpu/bone-instancer.test.ts
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import type { Primitive } from '../types';
import { packBoneInstances, INSTANCE_FLOATS, BONE_QROT_WGSL, BONE_VERTEX_WGSL, BONE_SURFACE_WGSL, BONE_SHADE_WGSL, BONE_HASH_WGSL, BONE_NOISE_WGSL, boneInstanceArrays, createBoneInstancer } from './bone-instancer';
import { encodeSurfaceClass, SURFACE_ATTACHMENT_NAMES } from './deferred-surface';

const bone = (over: Partial<Primitive>): Primitive => ({
  a: [0, 0, 0], b: [0, 0.2, 0], radius: 0.02, scale: [1, 1, 1], blendK: 0,
  limb: 'torso', cluster: 1, op: 'bone', ...over,
});

// Instance data lives in a Float32Array, so equality is to f32 precision,
// not literal (0.1 packs to 0.10000000149011612).
const closeArr = (actual: ArrayLike<number>, expected: readonly number[]) => {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i]!, 6);
};

describe('packBoneInstances', () => {
  it('packs bones only: organs, dead prims and dead clusters are skipped', () => {
    const arrays = boneInstanceArrays(8);
    const alive = [true, true, false];
    const n = packBoneInstances([
      bone({}),
      bone({ op: 'organ' }),
      bone({ dead: true }),
      bone({ cluster: 2 }),               // dead cluster
      bone({ b: [0.1, 0, 0], bend: [0, 0.02, 0], radiusB: 0.01, scale: [1.2, 1, 1] }),
    ], alive, arrays, 8);
    expect(n).toBe(2);
    // second instance: a, b, c, r, scale
    const o = INSTANCE_FLOATS;
    closeArr(arrays.ab.subarray(o * 1, o * 1 + 6), [0, 0, 0, 0.1, 0, 0]);
    closeArr(arrays.ab.subarray(o * 1 + 6, o * 1 + 9), [0.05, 0.02, 0]);
    closeArr(arrays.ab.subarray(o * 1 + 9, o * 1 + 11), [0.02, 0.01]);
    closeArr(arrays.ab.subarray(o * 1 + 11, o * 1 + 14), [1.2, 1, 1]);
    closeArr(arrays.ab.subarray(o * 1 + 14, o * 1 + 18), [0, 0, 0, 1]);
    expect(arrays.ab[o * 1 + 22]).toBe(1);   // iFill: packed owner-less (1) until syncLights
  });
  it('clamps at capacity and reports overflow', () => {
    const arrays = boneInstanceArrays(2);
    const n = packBoneInstances([bone({}), bone({}), bone({})], [true, true], arrays, 2);
    expect(n).toBe(2);
    expect(arrays.overflowed).toBe(true);
  });
  it('a chunk bone list (cluster 0, no alive table) packs by passing alive undefined', () => {
    const arrays = boneInstanceArrays(4);
    expect(packBoneInstances([bone({ cluster: 0 })], undefined, arrays, 4)).toBe(1);
  });
});

describe('WGSL parse contract', () => {
  for (const [name, src] of Object.entries({ BONE_QROT_WGSL, BONE_VERTEX_WGSL, BONE_SURFACE_WGSL, BONE_SHADE_WGSL, BONE_HASH_WGSL, BONE_NOISE_WGSL })) {
    it(`${name} starts with fn and has no colon-in-comment in its signature`, () => {
      expect(src.startsWith('fn ')).toBe(true);
      // ONE fn per string: wgslFn reads a second fn's parameters as the
      // node's inputs (a boneHash inside the shade string asked for an input
      // 'q' and the pipeline never built — 2026-09-03).
      expect((src.match(/^fn /gm) ?? []).length, `${name} declares more than one fn`).toBe(1);
      const sig = src.slice(src.indexOf('('), src.indexOf(') ->') + 1);
      for (const line of sig.split('\n')) {
        const c = line.indexOf('//');
        if (c >= 0) expect(line.slice(c)).not.toMatch(/\w\s*:\s*\w/);
      }
    });
  }
});

describe('material/light split (M2 task 2)', () => {
  it('boneSurface carries the material terms with NO light input', () => {
    // The G-buffer albedo must be light-invariant: the surface fn's
    // signature takes p/boneColor/deepColor/look/woundTex/woundCount and
    // nothing else — no lightDir, key, spot, ambient or camera.
    const sig = BONE_SURFACE_WGSL.slice(BONE_SURFACE_WGSL.indexOf('('), BONE_SURFACE_WGSL.indexOf(') ->'));
    for (const absent of ['lightDir', 'keyColor', 'lightCfg', 'spotPos', 'spotAxis', 'spotCfg', 'spotColor', 'ambient', 'camPos']) {
      expect(sig).not.toContain(absent);
    }
    // The mottle/stain/exposure terms LIVE in the surface fn…
    for (const present of ['expo', 'boneNoise', 'mottle', 'stain', 'albedo']) {
      expect(BONE_SURFACE_WGSL).toContain(present);
    }
    // …and boneShade consumes them via surfaceIn instead of re-deriving.
    expect(BONE_SHADE_WGSL).toContain('surfaceIn');
    expect(BONE_SHADE_WGSL).not.toContain('boneNoise');
    expect(BONE_SHADE_WGSL).not.toContain('textureLoad');
    expect(BONE_SHADE_WGSL).toContain('let albedo = surfaceIn.xyz;');
    expect(BONE_SHADE_WGSL).toContain('let expo = surfaceIn.w;');
    // The light compose itself is intact.
    for (const present of ['spotCfg.x > 0.0', 'let diffuse = albedo * (ambient + keyI * keyC', 'let specular = keyC * wetTint']) {
      expect(BONE_SHADE_WGSL).toContain(present);
    }
  });

  it('surfaceKind: default undefined (lit); surface mode packs mesh class + receiver', () => {
    const lit = createBoneInstancer(8);
    expect(lit.surfaceKind).toBeUndefined();
    const litMat = lit.object.material as unknown as { mrtNode: unknown; colorNode: unknown; positionNode: unknown; normalNode: unknown };
    // Existing default: lit output, and the instanced position/normal nodes.
    expect(litMat.mrtNode).toBeNull();
    expect(litMat.colorNode).toBeTruthy();
    expect(litMat.positionNode).toBeTruthy();
    expect(litMat.normalNode).toBeTruthy();
    lit.dispose();

    const surf = createBoneInstancer(8, { output: 'surface' });
    expect(surf.surfaceKind).toBe(encodeSurfaceClass(1, 'full'));
    expect(surf.surfaceKind).toBe(1);
    const surfMat = surf.object.material as unknown as { mrtNode: { outputNodes: Record<string, unknown> } | null; colorNode: unknown; positionNode: unknown; normalNode: unknown };
    expect(Object.keys(surfMat.mrtNode!.outputNodes).sort())
      .toEqual([...SURFACE_ATTACHMENT_NAMES].sort());
    const params = surfMat.mrtNode!.outputNodes.surfaceParams as { node: { nodes: Array<{ node: { value: number } }> } };
    expect(params.node.nodes.map(n => n.node.value)).toEqual([0, 0, 0, 1]);
    expect(surfMat.colorNode).toBeNull();
    // The bone positionNode and normalNode are retained in BOTH modes.
    expect(surfMat.positionNode).toBeTruthy();
    expect(surfMat.normalNode).toBeTruthy();
    surf.dispose();

    const lvl = createBoneInstancer(8, { output: 'surface', shadowReceiver: 'level-only' });
    expect(lvl.surfaceKind).toBe(encodeSurfaceClass(1, 'level-only'));
    expect(lvl.surfaceKind).toBe(17);
    lvl.dispose();
  });

  it('update/setWounds run identically in surface mode', () => {
    const surf = createBoneInstancer(8, { output: 'surface', shadowReceiver: 'level-only' });
    const n = surf.update([{ prims: [bone({})] }]);
    void n;
    expect(surf.count).toBe(1);
    surf.setWounds([{ pos: [0, 0, 0], radius: 0.2 }]);
    expect(surf.uniforms.woundCount.value).toBe(1);
    surf.dispose();
  });
});

// M2 task 5 regression (2026-09-07): the task-3 router admits surface
// producers by reading surfaceKind ON THE MATERIAL (materialEligibility) —
// the factory handle getter above is diagnostic sugar and predates the
// router. The task-5 game boot found surface-mode bone tubes diagnosed
// UNSUPPORTED (hidden from the G-buffer pass) because the stamp lived only
// on the handle. These tests drive the router's ACTUAL admission function
// against the material the factory hands to three, so a removed stamp fails
// here instead of on a live game boot.
describe('router eligibility through the actual material (not the handle)', () => {
  it('materialEligibility admits a surface-mode bone material as a producer', async () => {
    const { materialEligibility } = await import('./game-deferred-scene');
    const surf = createBoneInstancer(8, { output: 'surface' });
    const mat = surf.object.material as THREE.Material;
    expect((mat as unknown as { surfaceKind: number }).surfaceKind)
      .toBe(encodeSurfaceClass(1, 'full'));
    expect(materialEligibility(mat)).toBe('asis');
    surf.dispose();
  });

  it('a level-only receiver material is admitted the same way', async () => {
    const { materialEligibility } = await import('./game-deferred-scene');
    const lvl = createBoneInstancer(8, { output: 'surface', shadowReceiver: 'level-only' });
    expect(materialEligibility(lvl.object.material as THREE.Material)).toBe('asis');
    lvl.dispose();
  });

  it('an unstamped MeshBasicNodeMaterial is still rejected (the check does work)', async () => {
    const { materialEligibility } = await import('./game-deferred-scene');
    const { MeshBasicNodeMaterial } = await import('three/webgpu');
    const verdict = materialEligibility(new MeshBasicNodeMaterial());
    expect(verdict).not.toBe('asis');
    expect(verdict).not.toBe('adapt');
  });
});

describe('shared light list (plan 1, Task 11): each tube takes its owner\'s 4 lights', () => {
  it('INSTANCE_FLOATS is 23, iLights sits at float 18 and iFill at 22', async () => {
    const m = await import('./bone-instancer');
    expect(INSTANCE_FLOATS).toBe(23);
    expect(m.IFILL_OFFSET).toBe(22);
    expect(m.ILIGHTS_OFFSET).toBe(18);
    expect(m.NO_OWNER_PICKS).toBe(-2);
  });
  it('boneShade replaces only the key with bodyLights, behind listOn and an owned instance', () => {
    const i = BONE_SHADE_WGSL.indexOf('if (listOn > 0.5 && picks.x > -1.5) {');
    expect(i).toBeGreaterThan(0);
    const call = BONE_SHADE_WGSL.indexOf('bodyLights(p, n, V, picks, lights, false)');
    expect(call).toBeGreaterThan(i);
    // the list branch keeps ambient, AO, the gloss (look.z) and the fresnel
    const branch = BONE_SHADE_WGSL.slice(i, BONE_SHADE_WGSL.indexOf('var L = normalize(lightDir);'));
    for (const t of ['ambient * fill + bl.diffuse', 'bl.spec * look.z', 'fresL', 'bl.rim', 'aoL']) expect(branch).toContain(t);
    // the old key path is still there, after the branch
    expect(BONE_SHADE_WGSL.indexOf('keyI * keyC * (0.15 + 0.85 * ndl)')).toBeGreaterThan(call);
    expect(BONE_SHADE_WGSL).toContain('lights: ptr<storage, array<vec4<f32>>, read>, listOn: f32, fill: f32');
  });
  it('Task 11b: the ambient is scaled by the room fill in the list branch only', () => {
    const i = BONE_SHADE_WGSL.indexOf('if (listOn > 0.5 && picks.x > -1.5) {');
    const oldAt = BONE_SHADE_WGSL.indexOf('var L = normalize(lightDir);');
    const branch = BONE_SHADE_WGSL.slice(i, oldAt);
    expect(branch).toContain('surfaceIn.xyz * (ambient * fill + bl.diffuse) * aoL');
    // the old path is untouched: `?lightlist=0` stays exact
    const old = BONE_SHADE_WGSL.slice(oldAt).replace(/\/\/.*$/gm, '');
    expect(old).not.toMatch(/\bfill\b/);
    expect(old).toContain('albedo * (ambient + keyI * keyC * (0.15 + 0.85 * ndl)) * ao');
  });
  it('update writes each instance\'s owner picks (read again at syncLights); no owner = -2', () => {
    const inst = createBoneInstancer(8);
    const owner = { x: 0.9, y: 3.25, z: -1, w: -1 };
    inst.update([{ prims: [bone({}), bone({})], alive: [true, true], lights: owner }, { prims: [bone({ cluster: 0 })] }]);
    expect(inst.count).toBe(3);
    const row = (k: number) => Array.from(inst.instances.subarray(k * INSTANCE_FLOATS + 18, k * INSTANCE_FLOATS + 22));
    closeArr(row(0), [0.9, 3.25, -1, -1]);
    closeArr(row(1), [0.9, 3.25, -1, -1]);
    closeArr(row(2), [-2, -2, -2, -2]);
    // the owner's picks change after update (the game's light loop): syncLights copies the new ones
    owner.x = 5.5;
    inst.syncLights();
    closeArr(row(0), [5.5, 3.25, -1, -1]);
    expect(inst.uniforms.lightListCfg.value.x).toBe(0);   // off until the game turns it on
    inst.dispose();
  });
  it('Task 11b: syncLights writes fillOf(owner) into iFill; no owner or no fillOf = 1', () => {
    const inst = createBoneInstancer(8);
    const actorA = { name: 'a' }, actorB = { name: 'b' };
    const picks = { x: 0.9, y: -1, z: -1, w: -1 };
    inst.update([
      { prims: [bone({}), bone({})], alive: [true, true], lights: picks, owner: actorA },
      { prims: [bone({})], alive: [true, true], lights: picks, owner: actorB },
      { prims: [bone({ cluster: 0 })] },
    ]);
    const fill = (k: number) => inst.instances[k * INSTANCE_FLOATS + 22];
    // update alone (no fillOf): every row 1
    for (let k = 0; k < 4; k++) expect(fill(k)).toBe(1);
    const seen: unknown[] = [];
    inst.syncLights(o => { seen.push(o); return o === actorA ? 0.25 : 0.6; });
    expect(fill(0)).toBeCloseTo(0.25, 6);
    expect(fill(1)).toBeCloseTo(0.25, 6);
    expect(fill(2)).toBeCloseTo(0.6, 6);
    expect(fill(3)).toBe(1);                      // the chunk bone: no owner
    expect(seen).toEqual([actorA, actorB]);       // one lookup per owner run, never for no owner
    // the row stride and offset are what the shader attribute reads
    const attr = inst.object.geometry.getAttribute('iFill') as THREE.InterleavedBufferAttribute;
    expect(attr.offset).toBe(22);
    expect(attr.data.stride).toBe(23);
    expect(attr.itemSize).toBe(1);
    // M3: only the live rows upload
    expect(attr.data.updateRanges).toEqual([{ start: 0, count: 4 * INSTANCE_FLOATS }]);
    inst.dispose();
  });
});
