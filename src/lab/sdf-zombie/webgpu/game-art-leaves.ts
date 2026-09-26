// src/lab/sdf-zombie/webgpu/game-art-leaves.ts
//
// LEVEL ART in the game (mesh key spec §5): fetch and parse <id>.art.glb, then attach
// every mesh to the level group tagged with its room, so the per-room light-list loop
// lights it like the walls. Decisions are pure (level-art.ts).

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext } from './game-context';
import { artBatchKey, artRoomOf, artUrl, capEmissive } from './level-art';

/** Fetch + parse the level's art; null when the level has none or `?art=0`. */
export async function loadLevelArt(levelParam: string | null, file: string | null): Promise<THREE.Group | null> {
  if (!levelParam || !file) return null;
  if (new URLSearchParams(location.search).get('art') === '0') return null;
  const url = artUrl(levelParam, file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`level art ${url}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(bytes, url).catch((e: unknown) => {
    throw new Error(`level art ${url}: ${e instanceof Error ? e.message : String(e)}`);
  });
  return gltf.scene;
}

/** Attach every mesh to the level group, room-tagged, shadows per its extras. */
export function placeLevelArt(ctx: GameContext, scene: THREE.Group, file: string): void {
  scene.updateMatrixWorld(true);
  const found: THREE.Mesh[] = [];
  scene.traverse(o => { if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh); });
  let instanced = 0, instances = 0;
  for (const m of found) {
    const chain: Record<string, unknown>[] = [];
    for (let o: THREE.Object3D | null = m; o; o = o.parent) chain.push(o.userData);
    const room = artRoomOf(chain);
    const shadow = !chain.some(u => u.shadow === false);
    ctx.world.levelGroup.attach(m);
    if (room !== null) m.userData.room = room;
    if (!shadow) m.userData.shadow = false;
    const sway = chain.find(u => typeof u.sway === 'string')?.sway;
    if (sway) m.userData.sway = sway;
    m.castShadow = shadow;
    m.receiveShadow = true;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) std.emissiveIntensity = capEmissive(std.emissiveIntensity);
    }
    if ((m as THREE.InstancedMesh).isInstancedMesh) { instanced++; instances += (m as THREE.InstancedMesh).count; }
  }
  const objects = new URLSearchParams(location.search).get('artbatch') === '0' ? found : batchArt(ctx, found);
  ctx.world.art = { file, meshes: objects.length, instanced, instances, objects, sourceMeshes: found.length };
}

/** STATIC BATCHING (optimisation pass, 2026-09-26): the art was ~330 draws on Night Train, one
 *  per (room, kit piece, part) instanced mesh, and the frame was CPU-bound on submitting them.
 *  Every static mesh (and every instance of an instanced one) is baked into world space and
 *  merged per artBatchKey: one draw per room, material, shadow flag and vertex layout. Moving
 *  pieces, window glass and roomless meshes stay as they are. `?artbatch=0` keeps the old
 *  one-mesh-per-piece art for A/B. */
function batchArt(ctx: GameContext, meshes: THREE.Mesh[]): THREE.Mesh[] {
  const group = ctx.world.levelGroup;
  group.updateMatrixWorld(true);
  const toGroup = group.matrixWorld.clone().invert();
  const batches = new Map<string, { mats: THREE.Material; geos: THREE.BufferGeometry[]; room: number; shadow: boolean }>();
  const kept: THREE.Mesh[] = [];
  const m4 = new THREE.Matrix4();
  for (const m of meshes) {
    const mat = m.material as THREE.Material;
    const g = m.geometry;
    const key = Array.isArray(m.material) ? null : artBatchKey({
      room: typeof m.userData.room === 'number' ? m.userData.room as number : null,
      materialId: mat.uuid,
      materialName: mat.name ?? '',
      shadow: m.userData.shadow !== false,
      sway: typeof m.userData.sway === 'string' ? m.userData.sway as string : null,
      attributes: Object.keys(g.attributes).sort().join(','),
      indexed: g.index !== null,
    });
    if (key === null) { kept.push(m); continue; }
    let b = batches.get(key);
    if (!b) { b = { mats: mat, geos: [], room: m.userData.room as number, shadow: m.userData.shadow !== false }; batches.set(key, b); }
    m.updateMatrixWorld(true);
    const im = m as THREE.InstancedMesh;
    const n = im.isInstancedMesh ? im.count : 1;
    for (let i = 0; i < n; i++) {
      if (im.isInstancedMesh) { im.getMatrixAt(i, m4); m4.premultiply(m.matrixWorld); } else m4.copy(m.matrixWorld);
      m4.premultiply(toGroup);
      b.geos.push(g.clone().applyMatrix4(m4));
    }
    m.removeFromParent();
  }
  const out = [...kept];
  for (const [key, b] of batches) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) { console.warn(`[art] batch ${key} did not merge`); continue; }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, b.mats);
    mesh.name = `art-batch:${b.room}:${b.mats.name}`;
    mesh.userData.room = b.room;
    if (!b.shadow) mesh.userData.shadow = false;
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    out.push(mesh);
  }
  return out;
}
