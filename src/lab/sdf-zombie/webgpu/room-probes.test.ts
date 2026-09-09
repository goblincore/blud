import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { buildProbeGridRequest } from '../probe-grid';
import { createRoomProbes, matchedGain, roomProbeRequest, type ProbeBindable, type ProbeWorkerLike, type RoomProbeLight } from './room-probes';
import { FURNITURE, ROOMS } from './game-level';
import type { ProbeWorkerReply, ProbeWorkerRequest } from '../probe-grid.worker';

const LIGHT: RoomProbeLight = { dir: [0.45, 0.72, 0.53], keyColor: [1, 0.96, 0.92], keyIntensity: 2.4, fillIntensity: 0.06 };
const SMALL = { dims: [4, 2, 4] as [number, number, number], raysPerProbe: 32, bounces: 1 };

/** A worker that bakes synchronously on postMessage, replying on a microtask
 *  so the caller's onmessage assignment (which follows the first post) has
 *  happened — the same ordering a real worker gives. */
function fakeWorker(): ProbeWorkerLike & { posted: number[]; terminated: boolean } {
  const w: ProbeWorkerLike & { posted: number[]; terminated: boolean } = {
    posted: [], terminated: false, onmessage: null,
    postMessage(m: ProbeWorkerRequest) {
      w.posted.push(m.id);
      const r = buildProbeGridRequest(m.req);
      const reply: ProbeWorkerReply = { id: m.id, dims: r.dims, min: r.min, max: r.max, sh: r.sh };
      queueMicrotask(() => w.onmessage?.({ data: reply } as MessageEvent<ProbeWorkerReply>));
    },
    terminate() { w.terminated = true; },
  };
  return w;
}
function bindable(): ProbeBindable {
  return {
    probeTex: { value: new THREE.Texture() },
    probeMin: { value: new THREE.Vector3() },
    probeInvExtent: { value: new THREE.Vector3() },
    probeDims: { value: new THREE.Vector4(1, 1, 1, 0) },
    probeCfg: { value: new THREE.Vector4(0, 0.25, 0, 0) },
  };
}
const settle = () => new Promise(r => setTimeout(r, 0));

describe('roomProbeRequest', () => {
  it('gathers from the PAINT colours and hands the accents over as point lights, never both', () => {
    const room = ROOMS[0]!;
    const req = roomProbeRequest(room, FURNITURE, LIGHT, SMALL);
    expect(req.walls.negX).toEqual(room.wallColor);
    expect(req.walls.negY).toEqual(room.floorColor);
    expect(req.walls.posY).toEqual(room.ceilColor);
    expect(req.light.points).toHaveLength(room.accents.length);
    expect(req.light.points![0]!.pos).toEqual(room.accents[0]!.pos);
    expect(req.options!.occluders).toHaveLength(FURNITURE.filter(f => f.room === room.id).length);
    expect(req.box.min[1]).toBe(0);
    expect(req.box.max[1]).toBe(room.height);
  });
});

describe('createRoomProbes', () => {
  it('bakes rooms in order through one worker and terminates it when done', async () => {
    const w = fakeWorker();
    const rp = createRoomProbes({ rooms: ROOMS.slice(0, 2), furniture: FURNITURE, light: LIGHT, workerFactory: () => w, ...SMALL });
    expect(rp.ready).toBe(false);
    await settle(); await settle(); await settle();
    expect(w.posted).toEqual([ROOMS[0]!.id, ROOMS[1]!.id]);
    expect(rp.ready).toBe(true);
    expect(w.terminated).toBe(true);
    rp.dispose();
  });

  it('stamps a body bound BEFORE its room bakes once the grid lands, and one bound after immediately', async () => {
    const rp = createRoomProbes({ rooms: ROOMS.slice(0, 1), furniture: FURNITURE, light: LIGHT, workerFactory: fakeWorker, ...SMALL });
    const early = bindable();
    rp.bind(early, ROOMS[0]!.id);
    // Not baked yet: the fallback texture and x = 0 stay — bit-identical P1.
    expect(early.probeDims.value.x).toBe(1);
    await settle(); await settle();
    expect(early.probeDims.value.toArray().slice(0, 3)).toEqual(SMALL.dims);
    expect(early.probeCfg.value.x).toBe(1);
    expect(early.probeCfg.value.y).toBeGreaterThan(0);
    const late = bindable();
    rp.bind(late, ROOMS[0]!.id);
    expect(late.probeTex.value).toBe(early.probeTex.value);
    expect(late.probeCfg.value.y).toBe(early.probeCfg.value.y);
    rp.dispose();
  });

  it('setProbes reaches every bound body; gain -1 means each room keeps its matched gain', async () => {
    const rp = createRoomProbes({ rooms: ROOMS.slice(0, 1), furniture: FURNITURE, light: LIGHT, workerFactory: fakeWorker, ...SMALL });
    const u = bindable();
    rp.bind(u, ROOMS[0]!.id);
    await settle(); await settle();
    const matched = rp.matchedGain(ROOMS[0]!.id);
    expect(u.probeCfg.value.y).toBeCloseTo(matched, 9);
    rp.setProbes(0, 0.5);
    expect(u.probeCfg.value.x).toBe(0);
    expect(u.probeCfg.value.y).toBe(0.5);
    rp.setProbes(1, -1);
    expect(u.probeCfg.value.y).toBeCloseTo(matched, 9);
    rp.dispose();
  });

  it('matched gain puts the room-centre level at levelMultiple x the fill luminance', () => {
    const req = roomProbeRequest(ROOMS[0]!, FURNITURE, LIGHT, SMALL);
    const r = buildProbeGridRequest(req);
    const g = matchedGain({ dims: r.dims, min: r.min, max: r.max, sh: r.sh }, LIGHT, 4);
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(1);
  });
});
