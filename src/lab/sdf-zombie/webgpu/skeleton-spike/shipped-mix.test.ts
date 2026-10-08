// src/lab/sdf-zombie/webgpu/skeleton-spike/shipped-mix.test.ts
//
// THE RENDERER ON THE SHIPPED MIX: the default page's bone cache (the full recipe, the anatomical skull's kit under
// the resolver's plan) and one renderer drawing a carved character, a character on its plain bone under the second
// paint, one of the eight on a fitted skull, and one of the eight with no eye seats. For each: which mesh its head is,
// which material and paint its head and a limb are on, and where its eyes are seated. The same again when the plates'
// asset fails to load (every head falls back to its sculpted bone).
// @ts-expect-error — node:fs is available in the Vitest runtime
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AnatomicalSkullKit } from './anatomical-skull';
import { anatomicalSkullSource } from './anatomical-skull.fixture';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { createSkeletonSources } from './contract';
import { SEGMENT_MATERIALS, createSegmentMeshRenderer } from './mesh-renderer';
import { meshEyePlacements, type MeshEyePlacement } from './mesh-eyes';
import { meshBoneSource } from './mesh-skull';
import { createBoneMeshCache } from './sculpt-cache';
import { sculptRecipe } from './sculpt-variant';
import { BALL_HEADS } from './skull-cast';

const CAST = ['zombie', 'soldier', 'juggernaut', 'cultist', 'female', 'bonewalker'] as const;
const built = CAST.map((character) => {
  const body = buildBody(compileBlob(parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${character}.blob`, 'utf8'))), DEFAULT_BUILD_OPTS);
  const sources = createSkeletonSources(body, bindRig(body), { character });
  return { character, sources, head: sources.find(s => s.segment === 'head')!, limb: sources.find(s => s.segment !== 'head' && s.kind !== 'organ')! };
});
const plates = (plan: ConstructorParameters<typeof AnatomicalSkullKit>[3]) => Promise.resolve(new AnatomicalSkullKit(anatomicalSkullSource(), new THREE.Texture(), new THREE.Vector2(1, 1), plan));

/** What the renderer draws for each of the cast on `cache`. */
function drawnOn(cache: Awaited<ReturnType<typeof createBoneMeshCache>>) {
  const renderer = createSegmentMeshRenderer(cache);
  const owners = built.map((_, i) => ({ id: i + 1 }));
  renderer.update(built.map(b => b.sources), owners);
  const materialOf = (g: THREE.BufferGeometry) => { const m = (renderer.object.children.find(c => (c as THREE.InstancedMesh).geometry === g) as THREE.InstancedMesh | undefined)?.material as THREE.Material | undefined; return m ? [m.name, m.userData.sculptPaint ?? null] : null; };
  const rows = Object.fromEntries(built.map((b, i) => {
    const head = cache.get(b.head), eyes = renderer.drawn.filter(d => d.owner === owners[i] && d.eye);
    const at = (seats: readonly MeshEyePlacement[] | null | undefined) => !!seats && seats.length === eyes.length && eyes.every((d, k) =>
      new THREE.Vector3().setFromMatrixPosition(d.matrix).distanceTo(new THREE.Vector3(...b.head.toWorld(seats[k]!.center))) < 1e-6 && Math.abs(d.matrix.getMaxScaleOnAxis() - seats[k]!.radius) < 1e-9);
    const fitted = cache.skullKit?.head(b.head) ?? null;
    const seat = eyes.length === 0 ? 'none' : at(fitted?.eyes) ? 'orbits' : at(meshEyePlacements(meshBoneSource(b.head, cache.sculpt.shape))) ? 'sculpt' : 'elsewhere';
    return [b.character, { mesher: head.mesher, plates: !!fitted, fit: fitted?.fit?.name ?? null, head: materialOf(head.geometry), limb: materialOf(cache.get(b.limb).geometry), eyes: eyes.length, seat }];
  }));
  renderer.dispose();
  return rows;
}
const bone = (paint: 1 | 2) => [SEGMENT_MATERIALS.bone, paint], plate = [SEGMENT_MATERIALS.plate, null];

describe('the default page: one renderer, the shipped mix', () => {
  it('each character\'s head mesh, its head\'s and limbs\' material and paint, and its eye seats', async () => {
    const cache = await createBoneMeshCache('', () => {}, plates);
    expect(cache.sculpt).toBe(sculptRecipe('full'));
    expect(cache.skullKit).not.toBeNull();
    const rows = drawnOn(cache);
    // The carved two: the sculpted head, extracted (not the asset), second paint, eyes in the sculpt's sockets.
    for (const c of ['zombie', 'soldier']) expect(rows[c], c).toEqual({ mesher: expect.not.stringMatching(/^asset$/), plates: false, fit: null, head: bone(2), limb: bone(2), eyes: 2, seat: 'sculpt' });
    // The juggernaut: his plain bone, second paint.
    expect(rows.juggernaut).toEqual({ mesher: expect.not.stringMatching(/^asset$/), plates: false, fit: null, head: bone(2), limb: bone(2), eyes: 2, seat: 'sculpt' });
    // Two of the eight with eyes: the plates under each one's own fit, on the plates' material; their limbs are bone
    // under the FIRST paint; their eyes are seated in the fitted skull's orbits.
    for (const c of ['cultist', 'female']) expect(rows[c], c).toEqual({ mesher: 'asset', plates: true, fit: BALL_HEADS[c]!.spec.fit, head: plate, limb: bone(1), eyes: 2, seat: 'orbits' });
    // The bonewalker: the plates, and no eyes (he never had mesh eyes).
    expect(rows.bonewalker).toEqual({ mesher: 'asset', plates: true, fit: BALL_HEADS.bonewalker!.spec.fit, head: plate, limb: bone(1), eyes: 0, seat: 'none' });
    // The kit fitted the three ball heads and nobody else.
    expect(cache.skullKit!.made.map(m => m.character).sort()).toEqual(['bonewalker', 'cultist', 'female']);
    cache.dispose();
  });

  it('the plates\' asset fails: every head is its sculpted bone, each character on its own paint, eyes in the sculpt\'s sockets or none', async () => {
    const said: string[] = [];
    const cache = await createBoneMeshCache('', line => { said.push(line); }, () => Promise.reject(new Error('no asset')));
    expect(cache.skullKit).toBeNull();
    expect(said).toHaveLength(1);
    const rows = drawnOn(cache);
    for (const c of ['zombie', 'soldier', 'juggernaut']) expect(rows[c], c).toMatchObject({ plates: false, head: bone(2), limb: bone(2), eyes: 2, seat: 'sculpt' });
    for (const c of ['cultist', 'female']) expect(rows[c], c).toMatchObject({ plates: false, head: bone(1), limb: bone(1), eyes: 2, seat: 'sculpt' });
    expect(rows.bonewalker).toMatchObject({ plates: false, head: bone(1), limb: bone(1), eyes: 0, seat: 'none' });
    cache.dispose();
  });
});
