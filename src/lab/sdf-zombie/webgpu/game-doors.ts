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
// READABILITY CUES (owner playtest 2026-10-28: shut doors read as wall panels): `?doorcues=` (door-frame-geometry.ts
// doorCues; all on by default) switches each of: `frame` (a dark heavy-metal surround, reveal lining and threshold
// plate), `light` (a status lamp on each side: red shut, green opening / open, amber closing), `recess` (the leaves
// set back from the face planes) and `tone` (the leaves in cleaner, colder, lighter steel than the walls). The frame
// and lamp of a side are one more mesh, lit by that side's zone like the leaves, on the walls' metal-plate recipe
// plus two baked weights (lamp, spill) and the door's status colour uniform: no light, no extra pass, pre-warmed with
// the level like the leaves.
//
// SOUND: the game loads no audio. `onPhase` is the hook: it is called with each phase change (opening,
// open, closing, closed) and the door's centre, for a door sound to plug into later.

import * as THREE from 'three/webgpu';
import { attribute, float, positionLocal, uniform, vec3, vec4 } from 'three/tsl';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Vec3 } from '../types';
import type { GameContext } from './game-context';
import { PLAYER } from './game-player';
import { panelSurfaceMaterial } from './game-sector-mesh';
import { doorFaceSigns, doorLeafMesh, LEAF_INSET_M } from './door-leaf-geometry';
import { doorCues, doorFrameMesh, LAMP_RGB, leafInset, type DoorCues } from './door-frame-geometry';
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
  /** Level-group meshes the doors added (leaves and frames). */
  readonly meshes: readonly THREE.Mesh[];
  /** The readability cues in force (`?doorcues=`). */
  readonly cues: DoorCues;
  /** Each door's status lamp colour now (linear RGB). */
  lampColours(): [number, number, number][];
}

/** The status lamp's brightness and its spill on the header (shared by every door; seams may retune them). */
export const doorLampGain = uniform(3.5);
export const doorSpillGain = uniform(0.35);
/** The tone cue: the leaves' colour against the palette wall (cleaner, colder, lighter) and their grime scale. */
const TONE_LEAF_RGB: readonly [number, number, number] = [0.4, 0.46, 0.56];
const TONE_LEAF_GRIME = 0.35;
/** The frame's colour: darker, heavier metal than the walls. */
const FRAME_RGB: readonly [number, number, number] = [0.075, 0.072, 0.07];

const EMPTY_BAKE = 0;
const makeStatus = () => uniform(new THREE.Vector3(...LAMP_RGB.closed));
type UniformColor = ReturnType<typeof makeStatus>;
/** The bake attributes every sector-material mesh carries, plus the frame's two weights, in ONE interleaved buffer
 *  (WebGPU allows 8 vertex buffers): sectorIndex, glowBounce(3), emitScreen(3), emitFS(2)[, lamp, spill]. */
function bakeAttributes(geo: THREE.BufferGeometry, count: number, sector: number, extra?: { lamp: number[]; spill: number[] }): void {
  const stride = extra ? 11 : 9;
  const bake = new Float32Array(count * stride).fill(EMPTY_BAKE);
  for (let i = 0; i < count; i++) {
    bake[i * stride] = sector;
    if (extra) { bake[i * stride + 9] = extra.lamp[i]!; bake[i * stride + 10] = extra.spill[i]!; }
  }
  const ib = new THREE.InterleavedBuffer(bake, stride);
  geo.setAttribute('sectorIndex', new THREE.InterleavedBufferAttribute(ib, 1, 0));
  geo.setAttribute('glowBounce', new THREE.InterleavedBufferAttribute(ib, 3, 1));
  geo.setAttribute('emitScreen', new THREE.InterleavedBufferAttribute(ib, 3, 4));
  geo.setAttribute('emitFS', new THREE.InterleavedBufferAttribute(ib, 2, 7));
  if (extra) {
    geo.setAttribute('doorLamp', new THREE.InterleavedBufferAttribute(ib, 1, 9));
    geo.setAttribute('doorSpill', new THREE.InterleavedBufferAttribute(ib, 1, 10));
  }
}

/** The frame's material: the walls' metal-plate recipe, the lamp faces dark glass lit by the door's status colour,
 *  and the status spill on the header round it. */
function frameMaterial(color: readonly [number, number, number], fx: NonNullable<GameContext['world']['sectorFx']>,
  status: UniformColor): MeshStandardNodeMaterial {
  const mat = panelSurfaceMaterial('metalPlate', color, fx, { metalness: 0.55 });
  const lamp = attribute('doorLamp', 'float'), spill = attribute('doorSpill', 'float');
  const rgb = status;
  const albedo = mat.colorNode ? (mat.colorNode as ReturnType<typeof vec4>).rgb : vec3(...color);
  mat.colorNode = vec4(albedo.mul(float(1).sub(lamp.mul(0.85))), 1);
  const lit = mat.emissiveNode as ReturnType<typeof vec3>;
  mat.emissiveNode = lit.mul(float(1).sub(lamp))
    .add(rgb.mul(lamp.mul(doorLampGain)))
    .add(rgb.mul(spill.mul(doorSpillGain).mul(float(1).sub(lamp))));
  return mat;
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
  const cues = doorCues(new URLSearchParams(location.search).get('doorcues'));
  const defs = field.defs;
  const states: DoorState[] = defs.map(() => closedDoor());
  const requests = new Uint8Array(defs.length);
  const opens = defs.map(() => uniform(0));
  const statuses = defs.map(makeStatus);
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
    const inset = leafInset(def, cues.recess, LEAF_INSET_M);
    // The rooms beyond each face (the face line's other sector): the frame's posts reach their floor, its header
    // stops under their ceiling, and the threshold plate overhangs only a face whose room floor is the doorway's.
    const rooms = def.faces.map(i => {
      const l = map.lines[i]!;
      return map.sectors[l.front === def.sector ? l.back : l.front] ?? map.sectors[def.sector]!;
    });
    const over = rooms.map(r => (Math.abs(r.floor - floor) < 0.01 ? 0.12 : 0));
    for (const side of [0, 1] as const) {
      const g = doorLeafMesh(def, side, floor, signs, inset);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('mottleUv', new THREE.Float32BufferAttribute(g.mottleUv, 2));
      geo.setAttribute('leafSlide', new THREE.Float32BufferAttribute(g.slide, 3));
      // The sector batches' attributes, so the walls' material reads the door sector's light and no bake. One
      // interleaved buffer: WebGPU allows 8 vertex buffers and the leaves need 9 attributes.
      bakeAttributes(geo, g.count, def.sector);
      geo.computeBoundingSphere();
      geo.boundingSphere!.radius += def.width / 2;           // the leaves' whole travel
      const mat = cues.tone
        ? panelSurfaceMaterial('slideDoor', TONE_LEAF_RGB, fx, { grime: TONE_LEAF_GRIME, metalness: 0.4 })
        : panelSurfaceMaterial('slideDoor', P.wall, fx);
      mat.positionNode = positionLocal.add(attribute('leafSlide', 'vec3').mul(opens[d]!));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `door-${def.id}-side-${side}`;
      mesh.userData.room = def.zones[side] + 1;              // the zone's synthesized room id (game-sector-mesh)
      mesh.userData.door = def.id;
      ctx.world.levelGroup.add(mesh);
      meshes.push(mesh);

      // This side's frame and status lamp (none when both cues are off).
      const room = rooms[side]!;
      const f = doorFrameMesh(def, { frame: cues.frame, light: cues.light, inset, floor, roomFloor: room.floor, roomCeil: room.ceil,
        sign: signs[side], plate: side === 0 ? { near: over[0]!, far: over[1]! } : null });
      if (f.count === 0) continue;
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(f.position, 3));
      fg.setAttribute('normal', new THREE.Float32BufferAttribute(f.normal, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(f.uv, 2));
      fg.setAttribute('mottleUv', new THREE.Float32BufferAttribute(f.mottleUv, 2));
      bakeAttributes(fg, f.count, def.sector, f);
      fg.computeBoundingSphere();
      const frame = new THREE.Mesh(fg, frameMaterial(FRAME_RGB, fx, statuses[d]!));
      frame.name = `door-${def.id}-frame-${side}`;
      frame.userData.room = def.zones[side] + 1;
      frame.userData.door = def.id;
      ctx.world.levelGroup.add(frame);
      meshes.push(frame);
    }
  });
  const setStatus = (d: number) => { const c = LAMP_RGB[states[d]!.phase]; statuses[d]!.value.set(c[0], c[1], c[2]); };

  const bodies: DoorBody[] = [];
  const lastPos = new Map<number, [number, number]>();
  const events: (DoorEvent & { t: number })[] = [];
  let clock = 0;
  const api: GameDoors = {
    field, meshes, events, onPhase: null, cues,
    lampColours: () => statuses.map(u => [+u.value.x.toFixed(3), +u.value.y.toFixed(3), +u.value.z.toFixed(3)] as [number, number, number]),
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
      for (const e of changed) setStatus(e.door);
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
      setStatus(d);
      return true;
    },
  };
  return api;
}
