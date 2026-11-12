// src/lab/sdf-zombie/webgpu/game-closets.ts
//
// MONSTER CLOSETS IN PLAY (2026-11-08): the level's `closets` on ctx.world.closets. The rules and the block's mesh data
// are sector-closets.ts. Created after the static mesh, navigation and the portal graph (all built from the file's open
// heights): creating it shuts the live sectors. One block mesh per closet, in the level group (lit by its zone, like the
// lifts), filling the shut part; a uniform slides it and every vertex is clamped into the closet's travel, so it squeezes
// away as the closet opens and is hidden once open. `?closets=0` leaves every closet open from load (the old import).

import * as THREE from 'three/webgpu';
import { clamp, positionLocal, uniform, vec3 } from 'three/tsl';
import type { GameContext } from './game-context';
import { bakeAttributes, FRAME_RGB, frameMaterial, makeStatus } from './game-doors';
import { closetBlockMesh, createClosets, type ClosetPhase, type ClosetRuntime } from './sector-closets';

export interface GameClosets {
  readonly rt: ClosetRuntime;
  step(dt: number): void;
  levelEvent(event: string): void;
  /** Whether line i borders a shut closet (the portal flood's closed line). */
  lineShut(i: number): boolean;
  snapshot(): { id: string; sector: number; opensOn: string; phase: ClosetPhase; at: number }[];
  readonly meshes: readonly THREE.Mesh[];
}

export function createGameClosets(ctx: GameContext): GameClosets | null {
  const map = ctx.world.level.def?.sectors;
  const fx = ctx.world.sectorFx;
  if (!map?.closets?.length || !fx) return null;
  const shut = new URLSearchParams(location.search).get('closets') !== '0';
  // The block is built from the open heights, so before createClosets writes the shut ones.
  const geos = map.closets.map(def => {
    const openH = def.moves === 'ceil' ? map.sectors[def.sector]!.ceil : map.sectors[def.sector]!.floor;
    return { g: closetBlockMesh(map, def, openH, outer => THREE.ShapeUtils.triangulateShape(outer.map(([x, z]) => new THREE.Vector2(x, z)), [])), openH };
  });
  const rt = createClosets(map, shut);
  const slides = rt.defs.map((d, i) => uniform(rt.at[i]! - d.shut));
  const meshes = rt.defs.map((def, i) => {
    const { g, openH } = geos[i]!;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute('mottleUv', new THREE.Float32BufferAttribute(g.mottleUv, 2));
    bakeAttributes(geo, g.count, def.sector, g);
    geo.computeBoundingSphere();
    const mat = frameMaterial(FRAME_RGB, fx, makeStatus());
    const lo = Math.min(def.shut, openH), hi = Math.max(def.shut, openH);
    mat.positionNode = vec3(positionLocal.x, clamp(positionLocal.y.add(slides[i]!), lo, hi), positionLocal.z);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `closet-${def.id}`;
    mesh.userData.room = map.sectors[def.sector]!.zone + 1;  // the zone's synthesized room id (game-sector-mesh)
    mesh.visible = rt.phase[i] !== 'open';
    ctx.world.levelGroup.add(mesh);
    return mesh;
  });
  return {
    rt, meshes,
    step(dt) {
      if (rt.step(dt).length === 0 && !rt.phase.includes('opening')) return;
      rt.defs.forEach((d, i) => {
        slides[i]!.value = rt.at[i]! - d.shut;
        meshes[i]!.visible = rt.phase[i] !== 'open';
      });
    },
    levelEvent(event) {
      for (const i of rt.fire(event)) ctx.telemetry.telemetry.event('closet', { id: rt.defs[i]!.id, phase: 'opening' });
    },
    lineShut: i => rt.lineShut(i),
    snapshot: () => rt.defs.map((d, i) => ({ id: d.id, sector: d.sector, opensOn: d.opensOn, phase: rt.phase[i]!, at: +rt.at[i]!.toFixed(3) })),
  };
}
