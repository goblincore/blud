// src/lab/sdf-zombie/webgpu/sector-doors.test.ts
//
// Doors (sector-doors.ts) on a three-sector doorway level: room A (x -4..0), the doorway D (x 0..0.5,
// faces at x 0 and x 0.5, track walls at z -1 and z 1), room B (x 0.5..4.5); z -1..1 throughout. The
// door's centre line runs a (0.25, -1) -> b (0.25, 1): width 2, depth 0.5.

import { describe, expect, it } from 'vitest';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { sectorSegmentHit } from './sector-ray';
import { createSectorNavigation } from './sector-navigation';
import { occludersNear, rayClear } from './sector-bounce';
import {
  blockedFraction, closedDoor, coveredAt, doorTravel, leafCover, occupiesDoor, stepDoor, stepDoors, travelBlocked, wantsDoor,
  DOOR_TRIGGER_M, type DoorState,
} from './sector-doors';
import type { SectorDoorDef } from './sector-def';

const doorwayLevel = (): any => ({
  version: 1, id: 'doorway', name: 'Doorway', geometry: 'sectors', ammo: 'infinite', loadout: ['melee'],
  start: { pos: [-2, 0, 0], yaw: 0 },
  vertices: [[-4, -1], [0, -1], [0.5, -1], [4.5, -1], [4.5, 1], [0.5, 1], [0, 1], [-4, 1]],
  sectors: [{ floor: 0, ceil: 3, zone: 0 }, { floor: 0, ceil: 2.5, zone: 0 }, { floor: 0, ceil: 3, zone: 1 }],
  lines: [
    { v: [0, 1], front: 0 }, { v: [1, 6], front: 0, back: 1 }, { v: [6, 7], front: 0 }, { v: [7, 0], front: 0 },
    { v: [1, 2], front: 1 }, { v: [2, 5], front: 1, back: 2 }, { v: [5, 6], front: 1 },
    { v: [2, 3], front: 2 }, { v: [3, 4], front: 2 }, { v: [4, 5], front: 2 },
  ],
  doors: [{ id: 'd', sector: 1, faces: [1, 5], a: [0.25, -1], b: [0.25, 1], width: 2, depth: 0.5, height: 2.5, zones: [0, 1] }],
});

const parsed = () => parseSectorLevel(doorwayLevel()).sectors!;
type P = [number, number, number];

describe('the door format', () => {
  it('parses a door with defaults (split, 3 m/s, 4 s, no key)', () => {
    const map = parsed();
    expect(map.doors).toEqual([{ id: 'd', sector: 1, faces: [1, 5], a: [0.25, -1], b: [0.25, 1], width: 2, depth: 0.5, height: 2.5,
      zones: [0, 1], style: 'split', speed: 3, wait: 4, key: null }]);
  });
  const broken = (edit: (d: any, j: any) => void) => { const j = doorwayLevel(); edit(j.doors[0], j); return () => parseSectorLevel(j); };
  it('refuses a door that disagrees with its geometry', () => {
    expect(broken(d => { d.width = 2.5; })).toThrow(/width 2.5 is not \|b - a\|/);
    expect(broken(d => { d.faces = [1, 4]; })).toThrow(/faces\[1\] \(line 4\) must be a two-sided line of sector 1/);
    expect(broken(d => { d.zones = [0, 0]; })).toThrow(/zones\[1\] must be the zone beyond faces\[1\]/);
    expect(broken(d => { d.depth = 1; })).toThrow(/is not depth \/ 2 from a -> b/);
    expect(broken(d => { d.height = 2.8; })).toThrow(/height 2.8 is over its sector's opening/);
    expect(broken(d => { d.style = 'up'; })).toThrow(/style: one of split/);
    expect(broken(d => { d.hinge = 1; })).toThrow(/doors\[0\]: unknown key hinge/);
    expect(broken((d, j) => { j.doors.push({ ...d }); })).toThrow(/door d: duplicate id/);
  });
  it('takes a key name', () => {
    const j = doorwayLevel();
    j.doors[0].key = 'blue';
    expect(parseSectorLevel(j).sectors!.doors![0]!.key).toBe('blue');
  });
});

describe('the door state machine', () => {
  const def = parsed().doors![0]!;          // 3 m/s over a 1 m leaf travel: 1/3 s to open
  const run = (st: DoorState, secs: number, want: boolean, occupied = false) => {
    for (let t = 0; t < secs - 1e-9; t += 1 / 60) stepDoor(def, st, 1 / 60, want, occupied);
  };
  it('opens when wanted, holds `wait` once clear, then closes', () => {
    const st = closedDoor();
    run(st, 0.2, true);
    expect(st.phase).toBe('opening');
    expect(st.open).toBeGreaterThan(0.5);
    run(st, 0.2, true);
    expect(st).toMatchObject({ phase: 'open', open: 1 });
    run(st, 3.9, false);
    expect(st.phase).toBe('open');
    run(st, 0.2, false);
    expect(st.phase).toBe('closing');
    run(st, 0.4, false);
    expect(st).toMatchObject({ phase: 'closed', open: 0 });
  });
  it('never closes on an occupant: it reopens, and holds while someone stands in it', () => {
    const st: DoorState = { phase: 'closing', open: 0.6, hold: 0 };
    run(st, 1 / 60, false, true);
    expect(st.phase).toBe('opening');
    run(st, 0.5, false, true);
    expect(st.phase).toBe('open');
    run(st, 10, false, true);
    expect(st.phase).toBe('open');
  });
  it('leaves cover (1 - open) / 2 each, from the jambs', () => {
    expect(leafCover(0)).toBe(0.5);
    expect(leafCover(1)).toBe(0);
    expect(blockedFraction(0.25)).toBeCloseTo(0.75, 9);
    expect(coveredAt(0.5, 0.2)).toBe(true);
    expect(coveredAt(0.5, 0.5)).toBe(false);
    expect(coveredAt(0.5, 0.8)).toBe(true);
    expect(coveredAt(0.5, 0.5, 0.3)).toBe(true);   // padded by a body's radius, the gap is too narrow
    expect(coveredAt(1, 0)).toBe(false);
  });
});

describe('the trigger and the occupant', () => {
  const def: SectorDoorDef = parsed().doors![0]!;
  it('a body within 1.5 m moving toward the doorway wants it; standing, moving away or far does not', () => {
    expect(wantsDoor(def, -1, 0, 2, 0)).toBe(true);
    expect(wantsDoor(def, 1.6, 0.5, -1, 0)).toBe(true);
    expect(wantsDoor(def, -1, 0, 0, 0)).toBe(false);
    expect(wantsDoor(def, -1, 0, -2, 0)).toBe(false);
    expect(wantsDoor(def, -1, 0, 0, 2)).toBe(false);              // along the wall
    expect(wantsDoor(def, 0.25 - DOOR_TRIGGER_M - 0.1, 0, 3, 0)).toBe(false);
  });
  it('a disc overlapping the doorway box occupies it', () => {
    expect(occupiesDoor(def, 0.25, 0, 0.3)).toBe(true);
    expect(occupiesDoor(def, -0.2, 0, 0.3)).toBe(true);           // half in the doorway
    expect(occupiesDoor(def, -0.6, 0, 0.3)).toBe(false);
  });
  it('stepDoors opens for an approaching body or a request, and reports phase changes', () => {
    const map = parsed(), ground = buildSectorGround(map);
    const states = [closedDoor()], req = new Uint8Array(1);
    expect(stepDoors(ground.doors, states, 1 / 60, [{ x: -1, z: 0, vx: 2, vz: 0, r: 0.32 }], req)).toEqual([{ door: 0, phase: 'opening' }]);
    expect(ground.doors.open[0]).toBe(0);
    stepDoors(ground.doors, states, 0.1, [], req);
    expect(ground.doors.open[0]).toBeCloseTo(0.3, 5);
    const st2 = [closedDoor()];
    req[0] = 1;
    expect(stepDoors(ground.doors, st2, 1 / 60, [], req)[0]!.phase).toBe('opening');
    expect(req[0]).toBe(0);
  });
});

describe('what a door blocks', () => {
  const setup = (open: number) => {
    const map = parsed(), ground = buildSectorGround(map);
    ground.doors.open[0] = open;
    return { map, ground };
  };
  it('bodies: shut, the faces block whole; part open, only the leaves; open, nothing', () => {
    // blockingNear is a candidate set (grid cells): the x 0 pieces are the door face's.
    const onFace = (segs: readonly { ax: number; bx: number; az: number; bz: number }[]) => segs.filter(s => s.ax === 0 && s.bx === 0);
    const shut = onFace(setup(0).ground.blockingNear(0, 0, 0.6, 0));
    expect(shut.length).toBe(2);                                 // both leaves (two pieces), meeting in the middle
    expect(Math.min(...shut.flatMap(s => [s.az, s.bz]))).toBe(-1);
    expect(Math.max(...shut.flatMap(s => [s.az, s.bz]))).toBe(1);
    const half = onFace(setup(0.5).ground.blockingNear(0, 0, 1.2, 0));
    expect(half.map(s => [s.az, s.bz].sort((a, b) => a - b))).toEqual([[-1, -0.5], [0.5, 1]]);
    expect(onFace(setup(1).ground.blockingNear(0, 0, 0.6, 0))).toEqual([]);
  });
  it('rays (shots, sight): a leaf is a wall, the gap is open', () => {
    const a: P = [-2, 1, 0], b: P = [2, 1, 0], side: P = [-2, 1, 0.8], sideB: P = [2, 1, 0.8];
    const shut = setup(0);
    const h = sectorSegmentHit(shut.map, shut.ground, a, b);
    expect(h).toMatchObject({ kind: 'wall', line: 1, sector: 0 });
    expect(h!.point[0]).toBeCloseTo(0, 9);
    const half = setup(0.5);
    expect(sectorSegmentHit(half.map, half.ground, a, b)).toBeNull();              // through the middle gap
    expect(sectorSegmentHit(half.map, half.ground, side, sideB)).toMatchObject({ kind: 'wall', line: 1 });
    const open = setup(1);
    expect(sectorSegmentHit(open.map, open.ground, side, sideB)).toBeNull();
  });
  it('travel: a body is held at a leaf and may step back out; navigation still routes through', () => {
    const { map, ground } = setup(0);
    const def = map.doors![0]!;
    expect(travelBlocked(def, 0, -1, 0, 1, 0, 0.34)).toBe(true);
    expect(travelBlocked(def, 0, -0.5, 0, -0.3, 0, 0.34)).toBe(true);           // stepping into the leaf
    expect(travelBlocked(def, 0, -0.3, 0, -0.5, 0, 0.34)).toBe(false);          // and away from it
    expect(travelBlocked(def, 0.9, -1, 0, 1, 0, 0.34)).toBe(false);             // a gap of 1.8 m fits
    expect(travelBlocked(def, 0.2, -1, 0, 1, 0, 0.34)).toBe(true);              // 0.4 m does not
    const nav = createSectorNavigation(map, ground, [{ id: 1, name: 'zone-0' }, { id: 2, name: 'zone-1' }], []);
    expect(nav.route([-2, 0, 0], [2, 0, 0]).length).toBeGreaterThan(0);           // the grid ignores doors
    const asked: number[] = [];
    const travel = doorTravel(ground.doors, nav.canTravel, 0.34, d => asked.push(d));
    expect(travel([-0.8, 0, 0], [-0.2, 0, 0])).toBe(false);
    expect(asked).toEqual([0]);
    expect(travel([-3, 0, 0], [3, 0, 0])).toBe(false);                            // far: refused, asks nothing
    expect(asked).toEqual([0]);
    ground.doors.open[0] = 1;
    expect(travel([-0.8, 0, 0], [-0.2, 0, 0])).toBe(true);
  });
  it('light: the baked bounce treats a door face as a solid wall', () => {
    const map = parsed();
    const occ = occludersNear(map, [-4, -1], [4.5, 1], 10);
    expect(rayClear(occ, [-2, 1, 0], [2, 1, 0])).toBe(false);
    const noDoor = { ...map, doors: undefined };
    expect(rayClear(occludersNear(noDoor, [-4, -1], [4.5, 1], 10), [-2, 1, 0], [2, 1, 0])).toBe(true);
  });
});
