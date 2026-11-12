// src/lab/sdf-zombie/webgpu/game-lifts.ts
//
// LIFTS IN PLAY (2026-11-01): the level's `lifts` on ctx.world.lifts. The rules and the mesh data are sector-lifts.ts.
// The file's floor is the lift's LOW position; the parser rests the live sector floor at `top`, and the static mesh
// draws the low one (sector-lifts.ts withLiftsLow) so it has the shaft. One mesh per lift, in the level group (lit by
// its zone, pre-warmed with the level) slides up by a uniform, as the door leaves do. `?lifts=0` leaves each at the top, not moving (the old static floor).

import * as THREE from 'three/webgpu';
import { positionLocal, uniform, vec3 } from 'three/tsl';
import type { GameContext } from './game-context';
import { LAMP_RGB } from './door-frame-geometry';
import { bakeAttributes, FRAME_RGB, frameMaterial, makeStatus } from './game-doors';
import { callsLift, liftBlockMesh, restingLift, stepLift, type LiftPhase, type LiftState } from './sector-lifts';
import type { SectorGround } from './sector-ground';

export interface GameLifts {
  step(dt: number): void;
  snapshot(): { id: string; sector: number; phase: LiftPhase; floor: number }[];
  readonly meshes: readonly THREE.Mesh[];
}

export function createGameLifts(ctx: GameContext): GameLifts | null {
  const map = ctx.world.level.def?.sectors;
  const fx = ctx.world.sectorFx;
  if (!map?.lifts?.length || !fx) return null;
  const moving = new URLSearchParams(location.search).get('lifts') !== '0';
  const defs = map.lifts;
  const states: LiftState[] = defs.map(restingLift);
  const rises = defs.map(d => uniform(d.top - d.low));
  const meshes = defs.map((def, i) => {
    const g = liftBlockMesh(map, def, outer => THREE.ShapeUtils.triangulateShape(outer.map(([x, z]) => new THREE.Vector2(x, z)), []));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute('mottleUv', new THREE.Float32BufferAttribute(g.mottleUv, 2));
    bakeAttributes(geo, g.count, def.sector, g);
    geo.computeBoundingSphere();
    geo.boundingSphere!.radius += def.top - def.low;         // the block's whole travel
    const status = makeStatus();
    const c = LAMP_RGB.closing;
    status.value.set(c[0], c[1], c[2]);
    const mat = frameMaterial(FRAME_RGB, fx, status);
    mat.positionNode = positionLocal.add(vec3(0, 1, 0).mul(rises[i]!));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `lift-${def.id}`;
    mesh.userData.room = map.sectors[def.sector]!.zone + 1;  // the zone's synthesized room id (game-sector-mesh)
    ctx.world.levelGroup.add(mesh);
    return mesh;
  });
  const ground = ctx.world.level.ground as SectorGround;
  return {
    meshes,
    step(dt) {
      if (!moving || !(dt > 0)) return;
      const pl = ctx.player.player;
      const s = ground.sectorAt(pl.pos[0], pl.pos[2]);
      defs.forEach((def, i) => {
        const st = states[i]!;
        const aboard = s === def.sector && pl.grounded;
        stepLift(def, st, dt, callsLift(map, def, s, pl.pos[0], pl.pos[1], pl.pos[2]), aboard);
        map.sectors[def.sector]!.floor = st.floor;
        rises[i]!.value = st.floor - def.low;
      });
    },
    snapshot: () => defs.map((d, i) => ({ id: d.id, sector: d.sector, phase: states[i]!.phase, floor: +states[i]!.floor.toFixed(3) })),
  };
}
