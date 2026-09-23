// src/lab/sdf-zombie/webgpu/game-lighting-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import * as THREE from 'three/webgpu';

export function applyHemi(ctx: GameContext) { ctx.lighting.hemi.intensity = ctx.lighting.hemiBase * (1 - ctx.lighting.levelProbeWeight); }

/** The rooms whose accents a room's walls shade: itself plus every room
 *  it shares a tunnel with (the tunnel's surfaces belong to the nearer
 *  room, and a doorway wall sees the light across the arch). */
export function accentRoomsFor(ctx: GameContext, roomId: number): Set<number> {
  const set = new Set<number>([roomId]);
  for (const t of ctx.world.level.tunnels) { if (t.a === roomId) set.add(t.b); if (t.b === roomId) set.add(t.a); }
  return set;
}

/** Every scene light except OTHER rooms' accent PointLights. An accent
 *  has no range (distance 0 = infinite), so before this every wall pixel
 *  in the level shaded all seven; a room's walls now shade its own and
 *  its neighbours' — the rest of the level is skipped per pixel. The
 *  probe grid still carries every accent's bounce inside its own room. */
export function levelSceneLights(ctx: GameContext, roomId: number): THREE.Light[] {
  const allowed = accentRoomsFor(ctx, roomId);
  const ls: THREE.Light[] = [];
  ctx.boot.handle.scene.traverse(o => {
    const l = o as THREE.Light;
    if (!l.isLight) return;
    const accentRoom = l.userData.accentRoom as number | undefined;
    if (accentRoom !== undefined && !allowed.has(accentRoom)) return;
    ls.push(l);
  });
  return ls;
}

/** Re-list the scene's lights on every room (a light was added — the
 *  muzzle flash with the gun) and force the level pipelines to rebuild. */
export function refreshLevelLights(ctx: GameContext) {
  if (ctx.world.levelLightLists.size === 0) return;
  for (const [roomId, node] of ctx.lighting.levelProbeNodes) {
    ctx.world.levelLightLists.get(roomId)?.setLights([...levelSceneLights(ctx, roomId), node as unknown as THREE.Light]);
  }
  for (const nm of ctx.world.levelNodeMaterials) nm.needsUpdate = true;
}
