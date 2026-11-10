// src/lab/sdf-zombie/webgpu/doors.test.ts
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import type { DoorDef } from './level-def';
import { DOOR, doorCollider, doorSlab, makeDoorStates, slideAxis, stepDoors, type DoorState } from './doors';

// A 1.4 m door across a corridor running along z, at z = 0.
const door = (key: DoorDef['key'] = null): DoorDef => ({ id: 'd', key, box: { min: [-0.7, 0, -0.05], max: [0.7, 2.1, 0.05] } });

function run(d: DoorDef, s: DoorState[], player: Vec3 | null, seconds: number, keys: DoorDef['key'][] = [], occupants: Vec3[] = []) {
  const events: string[] = [];
  let locked: string[] = [];
  for (let t = 0; t < seconds; t += 0.05) {
    const r = stepDoors([d], s, player, keys.filter(k => k !== null), occupants, 0.05);
    s = r.states;
    events.push(...r.events);
    locked = r.locked;
  }
  return { s, events, locked };
}

describe('doors', () => {
  it('slides along its long horizontal side', () => {
    expect(slideAxis(door().box)).toBe(0);
    expect(slideAxis({ min: [0, 0, 0], max: [0.1, 2, 1.4] })).toBe(2);
  });

  it('an unlocked door opens when the player comes near, then shuts once the doorway is empty', () => {
    const d = door();
    const far: Vec3 = [0, 0, 5];
    let r = run(d, makeDoorStates([d]), far, 1);
    expect(r.s[0]!.open).toBe(0);
    r = run(d, r.s, [0, 0, 1.2], 1);
    expect(r.s[0]!.open).toBe(1);
    expect(r.events).toEqual(['door.open.d']);
    expect(doorCollider(d, r.s[0]!)).toBeNull();
    r = run(d, r.s, far, DOOR.holdS - 0.2);
    expect(r.s[0]!.open).toBe(1);
    r = run(d, r.s, far, 1.5);
    expect(r.s[0]!.open).toBe(0);
    expect(doorCollider(d, r.s[0]!)).toEqual(d.box);
  });

  it('a locked door stays shut without its key and reports it; with the key it unlocks for good', () => {
    const d = door('red');
    let r = run(d, makeDoorStates([d]), [0, 0, 1], 1, ['blue']);
    expect(r.s[0]!.open).toBe(0);
    expect(r.locked).toEqual(['d']);
    r = run(d, r.s, [0, 0, 1], 1, ['red']);
    expect(r.s[0]!.open).toBe(1);
    expect(r.events).toEqual(['door.unlock.d', 'door.open.d']);
    expect(r.locked).toEqual([]);
  });

  it('never shuts on anyone standing in the doorway, but an enemy alone never opens it', () => {
    const d = door();
    const r0 = run(d, makeDoorStates([d]), [0, 0, 5], 1, [], [[0, 0, 0.3]]);
    expect(r0.s[0]!.open).toBe(0);
    let r = run(d, makeDoorStates([d]), [0, 0, 1], 1);
    r = run(d, r.s, [0, 0, 5], 4, [], [[0.2, 0, -0.3]]);
    expect(r.s[0]!.open).toBe(1);
  });

  it('half open, the slab has slid half its width and the rest still blocks', () => {
    const d = door();
    const s = { open: 0.5, idle: 0, unlocked: true };
    expect(doorSlab(d, s).min[0]).toBeCloseTo(0);
    expect(doorSlab(d, s).max[0]).toBeCloseTo(1.4);
    const c = doorCollider(d, s)!;
    expect(c.min[0]).toBeCloseTo(0);
    expect(c.max[0]).toBeCloseTo(0.7);
  });
});
