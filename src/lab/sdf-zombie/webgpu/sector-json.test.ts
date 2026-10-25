// src/lab/sdf-zombie/webgpu/sector-json.test.ts
//
// Sector levels (spec 2026-10-24 §4): parse, validate, zone rooms, delegation to Level Format v1.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLevel, parseSectorLevel } from './sector-json';

const fixture = (): any => JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'));

describe('parseSectorLevel: the sectors fixture', () => {
  it('reads vertices, sectors and lines with defaults filled', () => {
    const L = parseSectorLevel(fixture());
    expect(L.id).toBe('sectors-fixture');
    expect(L.sectors!.vertices).toHaveLength(14);
    expect(L.sectors!.lines).toHaveLength(17);
    expect(L.sectors!.sectors.map(s => [s.floor, s.ceil, s.zone])).toEqual([[0, 4, 0], [0.5, 4, 0], [1.5, 4, 0], [-1, 4, 1]]);
    expect(L.sectors!.sectors[1]).toMatchObject({ special: 'none', hurtPerSec: 0, glow: null,
      materials: { floor: 'default', ceil: 'default', wall: 'default' } });
    expect(L.sectors!.lines[0]).toEqual({ v: [1, 0], front: 0, back: -1, door: null, exit: false });
    expect(L.sectors!.lines[1]!.back).toBe(3);
  });
  it('makes one art-shelled room per zone, boxed round its sectors', () => {
    const L = parseSectorLevel(fixture());
    expect(L.rooms.map(r => [r.id, r.name, r.minX, r.maxX, r.minZ, r.maxZ, r.floor, r.height, r.shell]))
      .toEqual([[1, 'zone-0', -4, 4, -16, 0, 0, 4, 'art'], [2, 'zone-1', 4, 8, -8, 0, -1, 5, 'art']]);
  });
  it('requires sectors, never multi-floor, and keeps the shared markers', () => {
    const L = parseSectorLevel(fixture());
    expect(L.requires).toContain('sectors');
    expect(L.requires).not.toContain('multi-floor');
    expect(L.playerStart).toMatchObject({ x: 0, y: 0, z: -1.5 });
    expect(L.ammo).toBe('infinite');
    expect(L.rooms[0]!.accents).toHaveLength(1);
  });
});

describe('parseSectorLevel: refusals (collects every problem)', () => {
  const broken = (edit: (j: any) => void) => { const j = fixture(); edit(j); return () => parseSectorLevel(j); };
  it('refuses a line to a missing vertex or sector', () => {
    expect(broken(j => { j.lines[0].v = [0, 99]; })).toThrow(/lines\[0\]\.v/);
    expect(broken(j => { j.lines[1].back = 9; })).toThrow(/lines\[1\]\.back/);
  });
  it('refuses an open sector (a vertex used an odd number of times)', () => {
    expect(broken(j => { j.lines.splice(12, 1); })).toThrow(/sector 2: not closed/);
    expect(broken(j => { j.lines[0].v.reverse(); })).toThrow(/sector 0: not closed/);
    // D wound clockwise (every one of its lines reversed): closed, but not on their left
    expect(broken(j => { for (const i of [1, 14, 15, 16]) j.lines[i].v.reverse(); })).toThrow(/sector 3: lines must keep the sector on their left/);
  });
  it('refuses a ceiling at or below the floor', () => {
    expect(broken(j => { j.sectors[1].ceil = 0.5; })).toThrow(/sectors\[1\]: ceil must be above floor/);
  });
  it('refuses unknown keys and specials', () => {
    expect(broken(j => { j.sectors[0].wobble = 1; })).toThrow(/sectors\[0\]: unknown key wobble/);
    expect(broken(j => { j.sectors[0].special = 'spin'; })).toThrow(/sectors\[0\]\.special/);
    expect(broken(j => { j.sectors[0].special = 'hurt'; })).toThrow(/sectors\[0\]\.hurtPerSec/);
  });
  it('lets a door sector close (ceil == floor) but not invert', () => {
    expect(broken(j => { j.sectors[1].ceil = 0.5; j.lines[2].door = { sector: 1 }; })).not.toThrow();
    expect(broken(j => { j.sectors[1].ceil = 0.2; j.lines[2].door = { sector: 1 }; })).toThrow(/ceil must not be below floor/);
  });
});

describe('parseSectorLevel: review fixes', () => {
  const broken = (edit: (j: any) => void) => { const j = fixture(); edit(j); return () => parseSectorLevel(j); };
  it('treats back: null as a solid wall', () => {
    const j = fixture(); j.lines[0].back = null;
    expect(parseSectorLevel(j).sectors!.lines[0]!.back).toBe(-1);
  });
  it('reports a sector mistake and a marker mistake in one error', () => {
    let msg = '';
    try { const j = fixture(); j.sectors[1].ceil = 0.5; j.start.pos = [50, 0, 50]; parseSectorLevel(j); }
    catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/sectors\[1\]: ceil must be above floor/);
    expect(msg).toMatch(/start/);
    expect(msg.match(/level sectors-fixture:/g)).toHaveLength(1);
  });
  it('refuses bad materials', () => {
    expect(broken(j => { j.sectors[0].materials = 'tech'; })).toThrow(/sectors\[0\]\.materials: expected an object/);
    expect(broken(j => { j.sectors[0].materials.floor = 3; })).toThrow(/sectors\[0\]\.materials\.floor: expected a name/);
  });
  it('accepts door: null and refuses a non-object door', () => {
    expect(broken(j => { j.lines[2].door = null; })).not.toThrow();
    expect(broken(j => { j.lines[2].door = 5; })).toThrow(/lines\[2\]\.door: expected an object/);
  });
  it('refuses a zero-length line', () => {
    expect(broken(j => { j.vertices[1] = [...j.vertices[0]]; })).toThrow(/lines\[0\]\.v: zero-length line/);
  });
});

describe('parseSectorLevel: markers in void', () => {
  const broken = (edit: (j: any) => void) => { const j = fixture(); edit(j); return () => parseSectorLevel(j); };
  it('refuses a start in the column hole, and still parses the fixture as is', () => {
    expect(() => parseSectorLevel(fixture())).not.toThrow();
    expect(broken(j => { j.start.pos = [0, 0, -4]; })).toThrow(/start: must stand in a sector/);
  });
  it('refuses spawns and pickups in void, in one error', () => {
    let msg = '';
    try {
      const j = fixture();
      j.start.pos = [0, 0, -4];
      j.spawns = [{ id: 's1', kind: 'zombie', pos: [0, 0, -4] }];
      j.pickups = [{ id: 'p1', item: 'shells', pos: [20, 0, 20] }];
      parseSectorLevel(j);
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/start: must stand in a sector/);
    expect(msg).toMatch(/spawn s1: must stand in a sector/);
    expect(msg).toMatch(/pickup p1: must stand in a sector/);
    expect(msg).not.toMatch(/unknown key/);
    expect(msg.match(/level sectors-fixture:/g)).toHaveLength(1);
  });
});

describe('parseLevel', () => {
  it('sends sector files to the sector parser and the rest to Level Format v1', () => {
    expect(parseLevel(fixture()).sectors).toBeDefined();
    const rooms = JSON.parse(readFileSync('public/assets/levels/fixtures/two-rooms.level.json', 'utf8'));
    expect(parseLevel(rooms).sectors).toBeUndefined();
  });
});

describe('parseSectorLevel: lights go to the zone of the sector they stand in', () => {
  // Sector 1 (x -4..4, z -8..-12) moved to zone 1: zone 1's box (sectors 1 and 3) now overlaps zone 0's.
  const overlapping = () => { const j = fixture(); j.sectors[1].zone = 1; return j; };
  it('a light in a zone-1 sector inside zone 0\'s box lands in zone 1', () => {
    const j = overlapping();
    j.lights.push({ pos: [0, 3, -10], color: [0.2, 1, 0.3], power: 14, mood: 'fire', fixture: 'none' });
    const L = parseSectorLevel(j);
    const z0 = L.rooms.find(r => r.name === 'zone-0')!, z1 = L.rooms.find(r => r.name === 'zone-1')!;
    expect(z0.minZ).toBeLessThanOrEqual(-10);                     // the boxes do overlap there
    expect(z0.accents.map(a => a.pos)).toEqual([[0, 3.4, -6]]);
    expect(z1.accents.map(a => a.pos)).toHaveLength(2);
    expect(z1.accents.map(a => a.pos)).toEqual(expect.arrayContaining([[6, 3.4, -4], [0, 3, -10]]));
  });
  it('leaves correctly boxed lights alone', () => {
    const L = parseSectorLevel(fixture());
    expect(L.rooms.map(r => r.accents.map(a => a.power))).toEqual([[10], [6]]);
  });
});

describe('parseSectorLevel: per-side wall families', () => {
  it('reads walls on a line and leaves lines without them bare', () => {
    const j = fixture();
    j.lines[1].walls = { front: { lower: 'metal-plate' }, back: { upper: 'door' } };
    const L = parseSectorLevel(j);
    expect(L.sectors!.lines[1]!.walls).toEqual({ front: { lower: 'metal-plate' }, back: { upper: 'door' } });
    expect(L.sectors!.lines[0]!.walls).toBeUndefined();
  });
  it('refuses unknown sides and parts, empty names and a back side on a one-sided line', () => {
    const j = fixture();
    j.lines[1].walls = { left: {}, front: { side: 'x', mid: '' } };
    j.lines[0].walls = { back: { mid: 'tech' } };
    expect(() => parseSectorLevel(j)).toThrow(/lines\[1\]\.walls: unknown key left.*lines\[1\]\.walls\.front: unknown key side.*lines\[1\]\.walls\.front\.mid: expected a name/);
    expect(() => parseSectorLevel(j)).toThrow(/lines\[0\]\.walls\.back: a one-sided line has no back side/);
  });
});
