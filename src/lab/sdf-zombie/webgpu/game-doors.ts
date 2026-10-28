// src/lab/sdf-zombie/webgpu/game-doors.ts
//
// DOORS IN PLAY (owner design 2026-10-28): the level's door entities (sector-def.ts SectorDoorDef) on
// ctx.world.doors. The pure core is sector-doors.ts (state machine, trigger, occupant rule, leaf cover)
// and the ground's DoorField, which every blocker already reads (player collision, rays for sight /
// the sight cull / shots / pellets / projectiles / debris); this module steps the doors once per tick
// from the player and the standing actors, takes the requests of bodies a leaf held back (doorTravel,
// wired in game-main's buildEncounter), and draws the leaves.
//
// THE LEAVES: per door two meshes (door-leaf-geometry.ts: one per side, so each side is lit by its own
// zone's light list), direct children of the level group so the light-list loop stamps them and the
// level pre-warm (game-level-prewarm.ts) builds their materials before first sight. Each wears its own
// sector node material of the scratched-steel leaf kind (panel-textures.ts slideDoor; the walls' recipe,
// game-sector-mesh.ts panelSurfaceMaterial) with the door sector's light; a vertex shift slides the
// leaves by the door's `open` uniform (positionNode: positionLocal + slide × open), so moving a door
// writes one uniform. The bounding sphere covers the leaves' whole travel.
//
// `?doors=0` leaves every doorway open and draws no leaves (the old behaviour, for A/B).
//
// SOUND: the game loads no audio. `onPhase` is the hook: it is called with each phase change (opening,
// open, closing, closed) and the door's centre, for a door sound to plug into later.

import * as THREE from 'three/webgpu';
import { attribute, positionLocal, uniform } from 'three/tsl';
import type { Vec3 } from '../types';
import type { GameContext } from './game-context';
import { PLAYER } from './game-player';
import { panelSurfaceMaterial } from './game-sector-mesh';
import { doorFaceSigns, doorLeafMesh } from './door-leaf-geometry';
import { SECTOR_BODY_RADIUS_M, type SectorDoorDef } from './sector-def';
import { closedDoor, stepDoors, type DoorBody, type DoorEvent, type DoorField, type DoorPhase, type DoorState } from './sector-doors';
import type { SectorGround } from './sector-ground';

export interface DoorSnapshot { id: string; sector: number; phase: DoorPhase; open: number; hold: number; centre: [number, number]; zones: readonly [number, number] }

export interface GameDoors {
  readonly field: DoorField;
  /** One tick: bodies trigger and occupy, the doors move, the leaves follow. */
  step(dt: number): void;
  /** A body's travel was refused by door d's leaf (doorTravel): it wants through. */
  request(d: number): void;
  snapshot(): DoorSnapshot[];
  /** Seam: force door `id` to an open fraction and phase ('open' holds `wait` again). */
  force(id: string, open: number, phase?: DoorPhase): boolean;
  /** The phase changes so far (a sound hook's log; capped). */
  readonly events: (DoorEvent & { t: number })[];
  /** The sound hook: every phase change, with the door's centre. */
  onPhase: ((e: DoorEvent, centre: Vec3) => void) | null;
  /** Level-group meshes the doors added. */
  readonly meshes: readonly THREE.Mesh[];
}

const EVENT_LOG_CAP = 64;

export function createGameDoors(ctx: GameContext): GameDoors | null {
  const map = ctx.world.level.def?.sectors;
  const field = (ctx.world.level.ground as SectorGround).doors;
  if (!map || !field || field.defs.length === 0) return null;
  // ?doors=0: the A/B without doors — every doorway stands open (nothing blocks), no leaves are drawn.
  if (new URLSearchParams(location.search).get('doors') === '0') { field.open.fill(1); return null; }
  const fx = ctx.world.sectorFx;
  if (!fx) return null;
  const defs = field.defs;
  const states: DoorState[] = defs.map(() => closedDoor());
  const requests = new Uint8Array(defs.length);
  const opens = defs.map(() => uniform(0));
  const P = ctx.world.level.def!.palette;
  const meshes: THREE.Mesh[] = [];
  const centre = (def: SectorDoorDef): Vec3 => [(def.a[0] + def.b[0]) / 2, map.sectors[def.sector]!.floor + def.height / 2, (def.a[1] + def.b[1]) / 2];

  defs.forEach((def, d) => {
    const floor = map.sectors[def.sector]!.floor;
    const mids = def.faces.map(i => {
      const l = map.lines[i]!, p = map.vertices[l.v[0]]!, q = map.vertices[l.v[1]]!;
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as [number, number];
    }) as [[number, number], [number, number]];
    const signs = doorFaceSigns(def, mids);
    for (const side of [0, 1] as const) {
      const g = doorLeafMesh(def, side, floor, signs);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('mottleUv', new THREE.Float32BufferAttribute(g.mottleUv, 2));
      geo.setAttribute('leafSlide', new THREE.Float32BufferAttribute(g.slide, 3));
      // The sector batches' attributes, so the walls' material reads the door sector's light and no bake. One
      // interleaved buffer: WebGPU allows 8 vertex buffers and the leaves need 9 attributes.
      const bake = new Float32Array(g.count * 9);
      for (let i = 0; i < g.count; i++) bake[i * 9] = def.sector;
      const ib = new THREE.InterleavedBuffer(bake, 9);
      geo.setAttribute('sectorIndex', new THREE.InterleavedBufferAttribute(ib, 1, 0));
      geo.setAttribute('glowBounce', new THREE.InterleavedBufferAttribute(ib, 3, 1));
      geo.setAttribute('emitScreen', new THREE.InterleavedBufferAttribute(ib, 3, 4));
      geo.setAttribute('emitFS', new THREE.InterleavedBufferAttribute(ib, 2, 7));
      geo.computeBoundingSphere();
      geo.boundingSphere!.radius += def.width / 2;           // the leaves' whole travel
      const mat = panelSurfaceMaterial('slideDoor', P.wall, fx);
      mat.positionNode = positionLocal.add(attribute('leafSlide', 'vec3').mul(opens[d]!));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `door-${def.id}-side-${side}`;
      mesh.userData.room = def.zones[side] + 1;              // the zone's synthesized room id (game-sector-mesh)
      mesh.userData.door = def.id;
      ctx.world.levelGroup.add(mesh);
      meshes.push(mesh);
    }
  });

  const bodies: DoorBody[] = [];
  const lastPos = new Map<number, [number, number]>();
  const events: (DoorEvent & { t: number })[] = [];
  let clock = 0;
  const api: GameDoors = {
    field, meshes, events, onPhase: null,
    step(dt) {
      if (!(dt > 0)) return;
      clock += dt;
      bodies.length = 0;
      const pl = ctx.player.player;
      bodies.push({ x: pl.pos[0], z: pl.pos[2], vx: pl.vel[0], vz: pl.vel[2], r: PLAYER.radius });
      for (const a of ctx.world.actors) {
        const p = a.pose().pos, prev = lastPos.get(a.id);
        lastPos.set(a.id, [p[0], p[2]]);
        if (a.motionFrame()?.collapsed) continue;            // a corpse neither opens nor holds a door
        const vx = prev ? (p[0] - prev[0]) / dt : 0, vz = prev ? (p[2] - prev[1]) / dt : 0;
        bodies.push({ x: p[0], z: p[2], vx, vz, r: SECTOR_BODY_RADIUS_M });
      }
      const changed = stepDoors(field, states, dt, bodies, requests);
      for (let d = 0; d < defs.length; d++) opens[d]!.value = states[d]!.open;
      for (const e of changed) {
        events.push({ ...e, t: +clock.toFixed(3) });
        if (events.length > EVENT_LOG_CAP) events.shift();
        api.onPhase?.(e, centre(defs[e.door]!));
      }
    },
    request(d) { if (d >= 0 && d < requests.length) requests[d] = 1; },
    snapshot: () => defs.map((def, d) => ({
      id: def.id, sector: def.sector, phase: states[d]!.phase, open: +states[d]!.open.toFixed(4), hold: +states[d]!.hold.toFixed(3),
      centre: [(def.a[0] + def.b[0]) / 2, (def.a[1] + def.b[1]) / 2], zones: def.zones,
    })),
    force(id, open, phase) {
      const d = defs.findIndex(def => def.id === id);
      if (d < 0) return false;
      const st = states[d]!;
      st.open = Math.min(1, Math.max(0, open));
      st.phase = phase ?? (st.open >= 1 ? 'open' : st.open <= 0 ? 'closed' : 'opening');
      if (st.phase === 'open') st.hold = defs[d]!.wait;
      field.open[d] = st.open;
      opens[d]!.value = st.open;
      return true;
    },
  };
  return api;
}
