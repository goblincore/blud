// src/lab/sdf-zombie/webgpu/game-art-leaves.ts
//
// LEVEL ART in the game (mesh key spec §5): fetch and parse <id>.art.glb, then attach
// every mesh to the level group tagged with its room, so the per-room light-list loop
// lights it like the walls. Decisions are pure (level-art.ts).

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameContext } from './game-context';
import { artRoomOf, artUrl, capEmissive } from './level-art';

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
    m.castShadow = shadow;
    m.receiveShadow = true;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) std.emissiveIntensity = capEmissive(std.emissiveIntensity);
    }
    if ((m as THREE.InstancedMesh).isInstancedMesh) { instanced++; instances += (m as THREE.InstancedMesh).count; }
  }
  ctx.world.art = { file, meshes: found.length, instanced, instances, objects: found };
}
