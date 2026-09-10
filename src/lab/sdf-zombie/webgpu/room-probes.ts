// src/lab/sdf-zombie/webgpu/room-probes.ts
//
// PER-ROOM STATIC PROBE GRIDS (lighting P3, step 2). One irradiance grid per
// RoomDef, gathered once at boot in a module worker from the room's PAINT
// colours (not the accent-lit albedos P1 hands ambientAt — the accents are
// gathered as point lights here, and using both would count them twice),
// its accent lights, and its furniture as occluders. Bound to a body's
// march uniforms at spawn, next to the enclosure it already receives.
//
// The bake is asynchronous and bodies spawn before it lands, so bind()
// records the request and the grid is stamped when the reply arrives. Until
// then the body rides the 1x1 fallback with probeCfg.x = 0 — bit-identical
// to the P1 path, which is also what ?probes=0 pins for the parity drivers.
import * as THREE from 'three/webgpu';
import { luminance, type Box, type EnclosureWalls, type Vec3 } from '../ambient';
import { sampleProbeGrid, type ProbeGrid, type ProbeGridRequest } from '../probe-grid';
import type { ProbeWorkerReply, ProbeWorkerRequest } from '../probe-grid.worker';
import type { FurnitureDef, RoomDef } from './game-level';

export interface RoomProbeLight {
  dir: Vec3; keyColor: Vec3; keyIntensity: number; fillIntensity: number;
}

/** The march uniforms a grid binds to — the five probe slots. */
export interface ProbeBindable {
  probeTex: { value: THREE.Texture };
  probeMin: { value: THREE.Vector3 };
  probeInvExtent: { value: THREE.Vector3 };
  probeDims: { value: THREE.Vector4 };
  probeCfg: { value: THREE.Vector4 };
}

/** Minimal worker surface, so tests can hand in a synchronous fake. */
export interface ProbeWorkerLike {
  postMessage(message: ProbeWorkerRequest): void;
  onmessage: ((event: MessageEvent<ProbeWorkerReply>) => void) | null;
  terminate(): void;
}

export interface RoomProbesOptions {
  rooms: readonly RoomDef[];
  furniture: readonly FurnitureDef[];
  light: RoomProbeLight;
  workerFactory: () => ProbeWorkerLike;
  /** Probe grid resolution per room; 10x4x10 covers an 8x3x8 m room at ~0.9 m. */
  dims?: [number, number, number];
  raysPerProbe?: number;
  bounces?: number;
  /** Level the matched gain targets, as a multiple of the flat fill's
   *  luminance. The game runs P1 at ambientGain 4, so 4 keeps the LEVEL of
   *  today's look and changes only its direction and hue. */
  levelMultiple?: number;
  onReady?: (roomId: number) => void;
}

/** The pure request for one room — exported so a test can pin its shape. */
export function roomProbeRequest(
  room: RoomDef, furniture: readonly FurnitureDef[], light: RoomProbeLight,
  opts: { dims: [number, number, number]; raysPerProbe: number; bounces: number },
): ProbeGridRequest {
  const box: Box = { min: [room.minX, 0, room.minZ], max: [room.maxX, room.height, room.maxZ] };
  const walls: EnclosureWalls = {
    negX: room.wallColor, posX: room.wallColor,
    negY: room.floorColor, posY: room.ceilColor,
    negZ: room.wallColor, posZ: room.wallColor,
  };
  const occluders: Box[] = furniture
    .filter(f => f.room === room.id)
    .map(f => ({ min: [f.minX, 0, f.minZ] as Vec3, max: [f.maxX, f.height, f.maxZ] as Vec3 }));
  return {
    box,
    walls,
    light: {
      dir: light.dir, keyColor: light.keyColor,
      keyIntensity: light.keyIntensity, fillIntensity: light.fillIntensity,
      points: room.accents.map(a => ({ pos: a.pos, color: a.color })),
    },
    options: { dims: opts.dims, raysPerProbe: opts.raysPerProbe, bounces: opts.bounces, occluders },
  };
}

/** Gain that puts the grid's room-centre irradiance (mean over the six axis
 *  normals) at `levelMultiple` times the flat fill's luminance. */
export function matchedGain(grid: ProbeGrid, light: RoomProbeLight, levelMultiple: number): number {
  const c: Vec3 = [
    (grid.min[0] + grid.max[0]) / 2, (grid.min[1] + grid.max[1]) / 2, (grid.min[2] + grid.max[2]) / 2,
  ];
  const axes: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let lum = 0;
  for (const n of axes) lum += luminance(sampleProbeGrid(grid, c, n));
  lum /= axes.length;
  const target = levelMultiple * light.fillIntensity * luminance(light.keyColor);
  return lum > 1e-6 ? target / lum : 0;
}

export interface RoomProbes {
  /** Stamp a body's probe slots with its room's grid, now or when it lands. */
  bind(u: ProbeBindable, roomId: number): void;
  /** Weight 0 = bit-identical P1; gain scales the probe irradiance. */
  setProbes(weight: number, gain: number): void;
  readonly weight: number;
  readonly gain: number;
  /** Per-room matched gain, once baked; -1 before. */
  matchedGain(roomId: number): number;
  /** The baked grid, for the dynamic gather's probe positions; null before. */
  gridOf(roomId: number): ProbeGrid | null;
  readonly ready: boolean;
  dispose(): void;
}

export function createRoomProbes(o: RoomProbesOptions): RoomProbes {
  const dims = o.dims ?? [10, 4, 10];
  const raysPerProbe = o.raysPerProbe ?? 96;
  const bounces = o.bounces ?? 2;
  const levelMultiple = o.levelMultiple ?? 4;
  const baked = new Map<number, { grid: ProbeGrid; tex: THREE.DataTexture; gain: number }>();
  const bound = new Map<number, ProbeBindable[]>();
  const all: ProbeBindable[] = [];
  let weight = 1;
  let gain = -1; // -1 = use each room's matched gain
  let disposed = false;

  function stamp(u: ProbeBindable, roomId: number) {
    const b = baked.get(roomId);
    if (!b) return;
    u.probeTex.value = b.tex;
    u.probeMin.value.set(b.grid.min[0], b.grid.min[1], b.grid.min[2]);
    u.probeInvExtent.value.set(
      1 / Math.max(1e-6, b.grid.max[0] - b.grid.min[0]),
      1 / Math.max(1e-6, b.grid.max[1] - b.grid.min[1]),
      1 / Math.max(1e-6, b.grid.max[2] - b.grid.min[2]),
    );
    u.probeDims.value.set(b.grid.dims[0], b.grid.dims[1], b.grid.dims[2], 0);
    u.probeCfg.value.x = weight;
    u.probeCfg.value.y = gain >= 0 ? gain : b.gain;
  }

  // ONE worker, rooms in sequence: each bake is a few hundred ms and the
  // rooms are wanted in order of the player's path (room 1 first).
  const worker = o.workerFactory();
  const queue = [...o.rooms];
  let inFlight: RoomDef | null = null;
  function next() {
    if (disposed) return;
    inFlight = queue.shift() ?? null;
    if (!inFlight) { worker.terminate(); return; }
    worker.postMessage({ id: inFlight.id, req: roomProbeRequest(inFlight, o.furniture, o.light, { dims, raysPerProbe, bounces }) });
  }
  worker.onmessage = ({ data }) => {
    if (disposed) return;
    if ('error' in data) {
      console.error(`[room-probes] room ${data.id} bake failed: ${data.error}`);
    } else {
      const grid: ProbeGrid = { dims: data.dims, min: data.min, max: data.max, sh: data.sh };
      const tex = new THREE.DataTexture(
        new Float32Array(grid.sh), grid.dims[0] * grid.dims[1] * grid.dims[2] * 3, 1,
        THREE.RGBAFormat, THREE.FloatType,
      );
      tex.needsUpdate = true;
      baked.set(data.id, { grid, tex, gain: matchedGain(grid, o.light, levelMultiple) });
      for (const u of bound.get(data.id) ?? []) stamp(u, data.id);
      o.onReady?.(data.id);
    }
    next();
  };
  next();

  return {
    bind(u, roomId) {
      all.push(u);
      const list = bound.get(roomId) ?? [];
      list.push(u);
      bound.set(roomId, list);
      stamp(u, roomId);
    },
    setProbes(w, g) {
      weight = w; gain = g;
      for (const [roomId, list] of bound) for (const u of list) stamp(u, roomId);
      // Views bound to rooms that have not baked yet still take the weight
      // so a later stamp does not have to know whether the seam moved.
      for (const u of all) u.probeCfg.value.x = w;
    },
    get weight() { return weight; },
    get gain() { return gain; },
    matchedGain(roomId) { return baked.get(roomId)?.gain ?? -1; },
    gridOf(roomId) { return baked.get(roomId)?.grid ?? null; },
    get ready() { return queue.length === 0 && inFlight === null; },
    dispose() {
      disposed = true;
      worker.terminate();
      for (const b of baked.values()) b.tex.dispose();
      baked.clear(); bound.clear(); all.length = 0;
    },
  };
}
