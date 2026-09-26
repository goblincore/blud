// src/lab/sdf-zombie/webgpu/game-level.test.ts
//
// Hand-worked gates for the ring layout and the capsule resolver. The ring
// topology tests are the point of the whole level: if the ring smears (a
// diagonal shortcut, a mouth on the wrong wall) the 1/2/3/4 count ramp is
// unreadable, and these are the tests that catch it.

import { describe, expect, it } from 'vitest';
import {
  ROOMS, TUNNELS, FURNITURE, levelColliders, levelSurfaces,
  enclosureKeyAt, enclosureOf, wanderBounds, spawnPoints, PLAYER_START,
  OUTER, BAND_HALF, slotCharacter,
} from './game-level';
import { ringLevel } from './active-level';
import { PLAYER, resolveCapsule, stepPlayer, eyeOf, type PlayerState } from './game-player';

function makePlayer(x: number, z: number, yaw: number): PlayerState {
  return { pos: [x, 0, z], vel: [0, 0, 0], yaw, pitch: 0, grounded: true };
}

/** Walk the player with fixed intent for `steps` frames; returns the path end. */
function walk(s: PlayerState, input: { x: number; z: number; jump: boolean }, steps: number) {
  const colliders = levelColliders();
  for (let i = 0; i < steps; i++) stepPlayer(s, input, 1 / 60, colliders);
  return s;
}

describe('ring layout', () => {
  it('is a ring: each tunnel joins adjacent rooms, in order 1-2-3-4-1', () => {
    expect(TUNNELS.filter(t => t.a !== 5 && t.b !== 5).map(t => [t.a, t.b])).toEqual([[1, 2], [2, 3], [3, 4], [4, 1]]);
  });

  it('has no diagonal shortcut: the centre block is solid', () => {
    // A capsule standing at the origin must be pushed OUT.
    const pos: [number, number, number] = [0, 0, 0];
    expect(resolveCapsule(pos, levelColliders())).toBe(true);
    const r = Math.hypot(pos[0], pos[2]);
    expect(r).toBeGreaterThan(BAND_HALF - 1e-6);
  });

  it('original rooms are quadrants around a solid cross, not arbitrary boxes', () => {
    for (const r of ROOMS.filter(r => r.id <= 4)) {
      expect(r.maxX - r.minX).toBeCloseTo(8);
      expect(r.maxZ - r.minZ).toBeCloseTo(8);
      expect(Math.abs((r.minX + r.maxX) / 2)).toBeCloseTo(4.8);
      expect(Math.abs((r.minZ + r.maxZ) / 2)).toBeCloseTo(4.8);
    }
  });

  it('zombie counts escalate 1/2/3/4 around the ring, ten total', () => {
    expect(ROOMS.filter(r => r.id <= 4).map(r => r.zombies)).toEqual([1, 2, 3, 4]);
    expect(ROOMS.filter(r => r.id <= 4).reduce((n, r) => n + r.zombies, 0)).toBe(10);
  });

  it('rooms 3 and 4 are FIRE braziers; rooms 1 and 2 are the red and green rooms (owner, 2026-09-09)', () => {
    // L2 (2026-09-01) unified every practical as flame. The per-room probe
    // grids (P3 step 2) made hue useful again: the owner asked for one red
    // and one green room so a body's bounce says where it stands. Rooms 3
    // and 4 keep the fire band; dungeon-palette.test.ts pins 1 and 2.
    for (const id of [3, 4]) {
      const c = ROOMS.find(r => r.id === id)!.accents[0]!.color;
      expect(c[0]).toBeGreaterThan(c[2]! + 0.35); // red dominates blue
      expect(c[1]).toBeGreaterThan(c[2]!);        // green over blue
      expect(c[0]).toBeGreaterThan(c[1]!);        // and red leads
    }
  });

  it('every room has one or two accents, placed INSIDE the room at brazier height', () => {
    for (const r of ROOMS) {
      expect(r.accents.length).toBeGreaterThanOrEqual(1);
      expect(r.accents.length).toBeLessThanOrEqual(2);
      for (const a of r.accents) {
        expect(a.pos[0]).toBeGreaterThan(r.minX);
        expect(a.pos[0]).toBeLessThan(r.maxX);
        expect(a.pos[2]).toBeGreaterThan(r.minZ);
        expect(a.pos[2]).toBeLessThan(r.maxZ);
        expect(a.pos[1]).toBeGreaterThan(0.5);   // off the floor — furniture
        expect(a.pos[1]).toBeLessThan(2.0);      // NOT a ceiling fixture (L2)
        expect(a.pos[1]).toBeLessThan(r.height); // under the ceiling
        expect(a.power).toBeGreaterThan(0);
      }
    }
  });

  it('enclosureOf returns box+walls for every room and tunnel', () => {
    for (const r of ROOMS) {
      const e = enclosureOf(r.name)!;
      expect(e).not.toBeNull();
      expect(e.box.min[1]).toBe(0);
      expect(e.box.max[1]).toBeCloseTo(r.height);
    }
    for (const t of TUNNELS) {
      const e = enclosureOf(t.name)!;
      expect(e.box.max[1]).toBeCloseTo(t.height);
    }
    expect(enclosureOf('void')).toBeNull();
  });

  it('enclosureKeyAt maps room centres and tunnel midpoints correctly', () => {
    expect(enclosureKeyAt(-4.8, -4.8)).toBe('room1');
    expect(enclosureKeyAt(4.8, -4.8)).toBe('room2');
    expect(enclosureKeyAt(4.8, 4.8)).toBe('room3');
    expect(enclosureKeyAt(-4.8, 4.8)).toBe('room4');
    expect(enclosureKeyAt(0, -4.8)).toBe('tunnel-1-2');
    expect(enclosureKeyAt(4.8, 0)).toBe('tunnel-2-3');
    expect(enclosureKeyAt(0, 4.8)).toBe('tunnel-3-4');
    expect(enclosureKeyAt(-4.8, 0)).toBe('tunnel-4-1');
    expect(enclosureKeyAt(0, 0)).toBe('void'); // solid centre block
    expect(enclosureKeyAt(OUTER + 5, 0)).toBe('void'); // outside the level
  });

  it('spawn points are inside their room and clear of furniture', () => {
    for (const r of ROOMS) {
      const spots = spawnPoints(r);
      expect(spots.length).toBe(r.zombies);
      for (const p of spots) {
        expect(resolveCapsule([...p], levelColliders())).toBe(false);
        expect(p[0]).toBeGreaterThan(r.minX);
        expect(p[0]).toBeLessThan(r.maxX);
        expect(p[2]).toBeGreaterThan(r.minZ);
        expect(p[2]).toBeLessThan(r.maxZ);
        for (const f of FURNITURE) {
          const inside = p[0] > f.minX - 0.5 && p[0] < f.maxX + 0.5
            && p[2] > f.minZ - 0.5 && p[2] < f.maxZ + 0.5;
          expect(inside).toBe(false);
        }
      }
    }
  });

  it('wander bounds stay inside the room interior', () => {
    for (const r of ROOMS) {
      const b = wanderBounds(r);
      expect(b.minX).toBeGreaterThan(r.minX);
      expect(b.maxX).toBeLessThan(r.maxX);
      expect(b.minZ).toBeGreaterThan(r.minZ);
      expect(b.maxZ).toBeLessThan(r.maxZ);
    }
  });

  it('surfaces cover every room and tunnel without throwing', () => {
    const { planes, boxes } = levelSurfaces();
    // 6 per room (floor, ceiling, 4 walls — mouths add segments) + 3 per tunnel.
    expect(planes.length).toBeGreaterThanOrEqual(6 * 4 + 3 * 4);
    // 4 lintels + 16 arch steps + furniture.
    expect(boxes.length).toBeGreaterThanOrEqual(4 + 16 + FURNITURE.length);
    for (const p of planes) {
      expect(p.max[1]).toBeGreaterThanOrEqual(p.min[1]);
    }
  });

  it('every display plane has positive extent on BOTH span axes', () => {
    // THE WALL GATE. wallPlanes once wrote the span into the wrong component
    // for axis-2 walls: every N/S plane collapsed to a zero-width line at
    // the room corner, the rooms rendered open front-and-back, and the level
    // read as a dollhouse cutaway. Orientation was never the suspect — the
    // rectangles were degenerate. This asserts the geometry is real.
    const { planes } = levelSurfaces();
    for (const p of planes) {
      for (const a of [0, 1, 2]) {
        if (a === p.axis) continue;
        expect(p.max[a]! - p.min[a]!)
          .toBeGreaterThan(0.05);
      }
      expect(p.min[p.axis]).toBeCloseTo(p.max[p.axis]!, 6);
    }
  });

  it('from inside a room, a ray toward each wall hits that wall close by', () => {
    // The owner-facing consequence of a missing wall: standing in the room,
    // looking at a wall, you must SEE the wall — not the rest of the level.
    // Pure-data ray vs rectangle (no three.js), eye height 1.6.
    const { planes } = levelSurfaces();
    const hit = (o: readonly number[], d: readonly number[]): number | null => {
      let best: number | null = null;
      for (const p of planes) {
        const n = p.axis === 0 ? [p.facing, 0, 0] : p.axis === 1 ? [0, p.facing, 0] : [0, 0, p.facing];
        const dn = n[0]! * d[0]! + n[1]! * d[1]! + n[2]! * d[2]!;
        if (dn >= -1e-9) continue; // backface or parallel: culled, invisible
        const oc = [o[0]! - (p.min[0]! + p.max[0]!) / 2, o[1]! - (p.min[1]! + p.max[1]!) / 2, o[2]! - (p.min[2]! + p.max[2]!) / 2];
        const t = -(n[0]! * oc[0]! + n[1]! * oc[1]! + n[2]! * oc[2]!) / dn;
        if (t <= 0.01) continue;
        const hx = o[0]! + d[0]! * t, hy = o[1]! + d[1]! * t, hz = o[2]! + d[2]! * t;
        const eps = 1e-6;
        if (hx < p.min[0]! - eps || hx > p.max[0]! + eps) continue;
        if (hy < p.min[1]! - eps || hy > p.max[1]! + eps) continue;
        if (hz < p.min[2]! - eps || hz > p.max[2]! + eps) continue;
        if (best === null || t < best) best = t;
      }
      return best;
    };
    for (const r of ROOMS) {
      const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
      // A side with a tunnel mouth lets the centre ray escape to the FAR
      // room's wall (~13.6 m) — legitimate. A mouth-less side must be walled
      // close by. Detect mouths by probing just outside each wall midpoint.
      const outside = (dx: number, dz: number): string =>
        enclosureKeyAt(cx + dx * ((r.maxX - r.minX) / 2 + 0.5),
          cz + dz * ((r.maxZ - r.minZ) / 2 + 0.5));
      const cases: [string, number[], boolean][] = [
        ['west wall', [1, 0, 0], outside(1, 0).startsWith('tunnel')],
        ['east wall', [-1, 0, 0], outside(-1, 0).startsWith('tunnel')],
        ['north wall', [0, 0, 1], outside(0, 1).startsWith('tunnel')],
        ['south wall', [0, 0, -1], outside(0, -1).startsWith('tunnel')],
        ['ceiling', [0, 1, 0], false],
      ];
      for (const [name, d, hasMouth] of cases) {
        const t = hit([cx, 1.6, cz], d);
        expect(t, `${r.name} ${name} invisible from inside`).not.toBeNull();
        if (!hasMouth) {
          // Bound RELATIVE to the room's own size: the original cells are 8 m
          // across (4 m to the wall), and the arena added 2026-09-10 is 16 m
          // (8 m to the wall), so a hard-coded 5 m could only ever describe
          // the small rooms. The ceiling runs from 1.6 m to the room's height.
          const halfSpan = name === 'ceiling'
            ? Math.max(0, r.height - 1.6)
            : Math.max((r.maxX - r.minX) / 2, (r.maxZ - r.minZ) / 2);
          expect(t!, `${r.name} ${name} too far`).toBeLessThan(halfSpan + 0.5);
        }
        // Aligned mouths can now expose the far annex wall through room2.
        const levelSpan = Math.max(...ROOMS.map(room => room.maxX))
          - Math.min(...ROOMS.map(room => room.minX));
        expect(t!, `${r.name} ${name} unbounded void`).toBeLessThan(levelSpan);
      }
    }
  });
});

describe('capsule-vs-AABB', () => {
  const wall = { min: [0, 0, -1] as [number, number, number], max: [1, 3, 1] as [number, number, number] };

  it('pushes a sideways overlap out along the separating vector', () => {
    // Capsule at x=-0.2 beside a wall face at x=0: gap 0.2 < radius.
    const pos: [number, number, number] = [-0.2, 0, 0];
    expect(resolveCapsule(pos, [wall])).toBe(true);
    expect(pos[0]).toBeCloseTo(-PLAYER.radius, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
  });

  it('leaves a clear capsule untouched', () => {
    const pos: [number, number, number] = [-1, 0, 0];
    expect(resolveCapsule(pos, [wall])).toBe(false);
    expect(pos[0]).toBeCloseTo(-1);
  });

  it('supports standing on top of a crate', () => {
    const crate = { min: [-1, 0, -1] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    // Feet 0.1 into the crate top: the capsule bottom sphere dips below y=1.
    const pos: [number, number, number] = [0, 0.9, 0];
    expect(resolveCapsule(pos, [crate])).toBe(true);
    expect(pos[1]).toBeCloseTo(1.0, 5);
  });

  it('ejects a capsule spawned inside a box along the min-penetration axis', () => {
    const pos: [number, number, number] = [0.8, 0.5, 0]; // closest face: +x
    expect(resolveCapsule(pos, [wall])).toBe(true);
    expect(pos[0]).toBeGreaterThan(1);
  });

  it('falls to the floor and stops when idling', () => {
    const s = makePlayer(-4.8, -4.8, 0);
    s.pos[1] = 1;
    walk(s, { x: 0, z: 0, jump: false }, 120);
    expect(s.pos[1]).toBe(0);
    expect(s.grounded).toBe(true);
    expect(Math.hypot(s.vel[0], s.vel[2])).toBeLessThan(1e-3);
  });
});

describe('walking the ring', () => {
  const fwd = { x: 0, z: 1, jump: false };

  it('crosses tunnel 1-2 east from room 1 into room 2', () => {
    const s = makePlayer(-2, -4.8, Math.PI / 2); // forward = +x
    // Stop in room2 before continuing through the new eastern passage.
    walk(s, fwd, 60 * 2);
    expect(enclosureKeyAt(s.pos[0], s.pos[2])).toBe('room2');
  });

  it('crosses tunnel 4-1 south from room 1 into room 4', () => {
    const s = makePlayer(-4.8, -2, Math.PI); // forward = +z
    walk(s, fwd, 60 * 4);
    expect(enclosureKeyAt(s.pos[0], s.pos[2])).toBe('room4');
  });

  it('blocks the diagonal: room 1 to room 3 through the centre is solid', () => {
    // Face the far diagonal corner and walk for ten seconds.
    const s = makePlayer(-4.8, -4.8, Math.atan2(9.6, 9.6)); // toward (+,+)
    walk(s, fwd, 60 * 10);
    expect(enclosureKeyAt(s.pos[0], s.pos[2])).not.toBe('room3');
    expect(Math.abs(s.pos[0])).toBeGreaterThan(BAND_HALF + PLAYER.radius - 1e-3);
  });

  it('closes the full ring 1->2->3->4->1 on foot', () => {
    // Waypoints: room centres and tunnel midpoints, ring order.
    const waypoints: [number, number][] = [
      [0, -4.8], [4.8, -4.8],   // tunnel 1-2, room 2
      [4.8, 0], [4.8, 4.8],     // tunnel 2-3, room 3
      [0, 4.8], [-4.8, 4.8],    // tunnel 3-4, room 4
      [-4.8, 0], [-4.8, -4.8],  // tunnel 4-1, room 1
    ];
    const s = makePlayer(-4.8, -4.8, 0);
    const visited: string[] = [];
    const colliders = levelColliders();
    for (const [wx, wz] of waypoints) {
      for (let i = 0; i < 60 * 12; i++) {
        const yaw = Math.atan2(wx - s.pos[0], -(wz - s.pos[2]));
        s.yaw = yaw;
        stepPlayer(s, fwd, 1 / 60, colliders);
        if (Math.hypot(wx - s.pos[0], wz - s.pos[2]) < 0.3) break;
      }
      expect(Math.hypot(wx - s.pos[0], wz - s.pos[2])).toBeLessThan(0.4);
      visited.push(enclosureKeyAt(s.pos[0], s.pos[2]));
    }
    expect(visited).toEqual([
      'tunnel-1-2', 'room2', 'tunnel-2-3', 'room3',
      'tunnel-3-4', 'room4', 'tunnel-4-1', 'room1',
    ]);
  });

  it('never leaves the level or clips a wall while walking the ring', () => {
    const s = makePlayer(PLAYER_START.x, PLAYER_START.z, PLAYER_START.yaw);
    const colliders = levelColliders();
    // Random-ish but deterministic walk: yaw sweeps, forward held.
    for (let i = 0; i < 60 * 30; i++) {
      s.yaw += Math.sin(i * 0.013) * 0.05 + 0.01;
      stepPlayer(s, { x: 0, z: 1, jump: i % 300 === 0 }, 1 / 60, colliders);
      expect(s.pos[0]).toBeGreaterThan(-OUTER);
      expect(s.pos[0]).toBeLessThan(Math.max(...ROOMS.map(r => r.maxX)));
      expect(Math.abs(s.pos[2])).toBeLessThan(OUTER);
      expect(s.pos[1]).toBeGreaterThanOrEqual(0);
      expect(enclosureKeyAt(s.pos[0], s.pos[2])).not.toBe('void');
    }
  });

  it('eye height rides the capsule', () => {
    const s = makePlayer(0, 0, 0);
    expect(eyeOf(s)[1]).toBeCloseTo(PLAYER.eye);
  });
});


describe('mixed encounter annex', () => {
  it('adds five combatants east of room2 with three soldier slots', () => {
    const room = ROOMS.find(r => r.id === 5);
    expect(room).toBeDefined();
    expect(room!.minX).toBeGreaterThan(ROOMS[1]!.maxX);
    expect(room!.zombies).toBe(5);
    expect(room!.soldiers).toBe(3);
    expect(ROOMS[0]!.soldiers).toBe(1);
    expect(spawnPoints(room!)).toHaveLength(5);
    expect(enclosureKeyAt(14.4, -4.8)).toBe('room5');
    // TWO mouths since 2026-09-10: the original west door from room 2, and the
    // east door into the new ARENA. The annex is a through-room now, which is
    // a deliberate topology change — see the arena note in game-level.ts.
    const tunnels = TUNNELS.filter(t => t.a === 5 || t.b === 5);
    expect(tunnels).toHaveLength(2);
    const west = tunnels.find(t => t.a === 2 || t.b === 2)!;
    expect([west.a, west.b].sort()).toEqual([2, 5]);
    expect(west.maxZ - west.minZ).toBeGreaterThanOrEqual(2);
    const east = tunnels.find(t => t.a === 6 || t.b === 6)!;
    expect([east.a, east.b].sort()).toEqual([5, 6]);
    expect(east.axis).toBe('x');
  });

  it('admits two lateral capsule lanes through both new doorway mouths', () => {
    const colliders = levelColliders();
    // Sample the full approach, both mouths and the corridor; the offset
    // lanes also fit two capsules side by side, rather than only a centre ray.
    for (const z of [-5.3, -4.3]) {
      for (let x = 7.8; x <= 11.4; x += 0.05) {
        const pos: [number, number, number] = [x, 0, z];
        expect(resolveCapsule(pos, colliders), `blocked at ${x}, ${z}`).toBe(false);
        expect(enclosureKeyAt(x, z)).not.toBe('void');
      }
    }
  });

  it('walks through the annex tunnel in either direction', () => {
    for (const [x, yaw, destination] of [
      [7.8, Math.PI / 2, 'room5'], [11.4, -Math.PI / 2, 'room2'],
    ] as const) {
      const s = makePlayer(x, -4.8, yaw);
      walk(s, { x: 0, z: 1, jump: false }, 60);
      expect(enclosureKeyAt(s.pos[0], s.pos[2])).toBe(destination);
    }
  });

  it('has cover with clear north and south lateral routes', () => {
    expect(FURNITURE.filter(f => f.room === 5).length).toBeGreaterThanOrEqual(2);
    const colliders = levelColliders();
    for (const z of [-7.7, -1.9]) {
      for (let x = 11.4; x <= 17.4; x += 0.1) {
        expect(resolveCapsule([x, 0, z], colliders)).toBe(false);
      }
    }
  });

  it('matches visible annex wall planes to collision and leaves the mouths open', () => {
    const colliders = levelColliders();
    const { planes, boxes } = levelSurfaces();
    const walls = planes.filter(p => p.axis !== 1 && p.min[0] >= OUTER);
    expect(walls.length).toBeGreaterThan(0);
    for (const p of walls) {
      const mid: [number, number, number] = [
        (p.min[0] + p.max[0]) / 2,
        (p.min[1] + p.max[1]) / 2,
        (p.min[2] + p.max[2]) / 2,
      ];
      expect(colliders.some(b => mid.every((v, axis) =>
        v >= b.min[axis]! - 1e-6 && v <= b.max[axis]! + 1e-6))).toBe(true);
    }
    for (const x of [8.8, 10.4]) {
      expect(planes.some(p => p.axis === 0 && Math.abs(p.min[0] - x) < 1e-6
        && p.min[1] < 1.7 && p.max[1] > 0.3 && p.min[2] < -4.8 && p.max[2] > -4.8)).toBe(false);
    }
    for (const b of boxes.filter(b => b.min[0] >= OUTER)) {
      expect(colliders.some(c => c.min.every((v, i) => v === b.min[i])
        && c.max.every((v, i) => v === b.max[i]))).toBe(true);
    }
  });

  it('keeps a walking capsule inside the annex and now lets it out east into the arena', () => {
    // The first lane drives EAST down the door lane. Before 2026-09-10 that
    // ended against a wall and the capsule stayed in room5; the arena door is
    // there now, so it must walk THROUGH — and the two lanes that still face
    // closed sides must still be contained. Both halves are asserted, so
    // neither "the door vanished" nor "the annex lost its walls" can pass.
    const east = makePlayer(17, -4.8, Math.PI / 2);
    walk(east, { x: 0, z: 1, jump: false }, 180);
    expect(enclosureKeyAt(east.pos[0], east.pos[2])).toBe('arena');
    expect(east.pos[0]).toBeGreaterThan(OUTER);

    for (const [x, z, yaw] of [[17, -7.5, 0], [17, -2, Math.PI]]) {
      const s = makePlayer(x!, z!, yaw!);
      walk(s, { x: 0, z: 1, jump: false }, 180);
      expect(enclosureKeyAt(s.pos[0], s.pos[2])).toBe('room5');
    }
  });
});

describe('spawn slots: soldiers, then juggernauts, then zombies', () => {
  it('puts one juggernaut in the arena, in slot 0, among seven zombies (the ring level\'s spawn list)', () => {
    const arena = ROOMS.find(r => r.name === 'arena')!;
    const kinds = ringLevel().spawnList().filter(s => s.room === arena).map(s => s.kind);
    expect(kinds.filter(k => k === 'juggernaut')).toEqual(['juggernaut']);
    expect(kinds[0]).toBe('juggernaut');
    expect(kinds.filter(k => k === 'zombie')).toHaveLength(kinds.length - 1);
    // No other room gained one.
    for (const r of ROOMS) if (r !== arena) expect(r.juggernauts ?? 0).toBe(0);
  });
  it('orders soldiers first, then juggernauts, then zombies', () => {
    const room = { ...ROOMS[0]!, zombies: 5, soldiers: 2, juggernauts: 1 };
    expect([0, 1, 2, 3, 4].map(i => slotCharacter(room, i))).toEqual(['soldier', 'soldier', 'juggernaut', 'zombie', 'zombie']);
  });
});
