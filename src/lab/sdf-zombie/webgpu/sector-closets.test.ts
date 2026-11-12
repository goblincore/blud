import { describe, expect, it } from 'vitest';
import type { SectorClosetDef, SectorMap } from './sector-def';
import { buildSectorGround } from './sector-ground';
import { sectorSegmentHit } from './sector-ray';
import { closetBlockMesh, closetOpenFraction, createClosets } from './sector-closets';

// Room A (x 0..4), the closet wall C (x 4..5), room B (x 5..9): A | C | B, all 3 m tall, floors at 0.
const makeMap = (closets: SectorClosetDef[], cFloor = 0): SectorMap => ({
  vertices: [[0, 0], [4, 0], [5, 0], [9, 0], [9, 2], [5, 2], [4, 2], [0, 2]],
  sectors: [0, 1, 2].map(zone => ({ floor: zone === 1 ? cFloor : 0, ceil: 3, zone, materials: { floor: 'concrete', ceil: 'concrete', wall: 'concrete' } })),
  lines: [
    { v: [0, 1], front: 0, back: -1 }, { v: [1, 6], front: 0, back: 1 }, { v: [6, 7], front: 0, back: -1 }, { v: [7, 0], front: 0, back: -1 },
    { v: [1, 2], front: 1, back: -1 }, { v: [2, 5], front: 1, back: 2 }, { v: [5, 6], front: 1, back: -1 },
    { v: [2, 3], front: 2, back: -1 }, { v: [3, 4], front: 2, back: -1 }, { v: [4, 5], front: 2, back: -1 },
  ],
  closets,
} as unknown as SectorMap);
const ceilCloset: SectorClosetDef = { id: 'c', sector: 1, opensOn: 'line.tag-1', moves: 'ceil', shut: 0, speed: 3 };

describe('a ceiling closet', () => {
  it('shuts at creation: the ground blocks a body and a sight ray stops at it', () => {
    const map = makeMap([ceilCloset]);
    const rt = createClosets(map);
    expect(map.sectors[1]!.ceil).toBe(0);
    expect(rt.phase[0]).toBe('shut');
    const ground = buildSectorGround(map);
    expect(ground.lineBlocks(1, 0)).toBe(true);
    const hit = sectorSegmentHit(map, ground, [2, 1.5, 1], [7, 1.5, 1]);
    expect(hit).not.toBeNull();
    expect(hit!.point[0]).toBeCloseTo(4, 5);
  });

  it('closes its lines to the portal flood while shut, only its own', () => {
    const rt = createClosets(makeMap([ceilCloset]));
    expect(rt.lineShut(1)).toBe(true);
    expect(rt.lineShut(5)).toBe(true);
    expect(rt.lineShut(0)).toBe(false);
  });

  it('ignores other events and opens on its own, to the file height, and stays open', () => {
    const map = makeMap([ceilCloset]);
    const rt = createClosets(map);
    expect(rt.fire('line.tag-2')).toEqual([]);
    expect(rt.fire('line.tag-1')).toEqual([0]);
    expect(rt.lineShut(1)).toBe(false);     // open to the flood from its first frame
    rt.step(0.5);
    expect(map.sectors[1]!.ceil).toBeCloseTo(1.5, 6);
    expect(closetOpenFraction(rt, 0)).toBeCloseTo(0.5, 6);
    const events = rt.step(1);
    expect(events).toEqual([{ closet: 0, phase: 'open' }]);
    expect(map.sectors[1]!.ceil).toBe(3);
    expect(rt.fire('line.tag-1')).toEqual([]);
    expect(buildSectorGround(map).lineBlocks(1, 0)).toBe(false);
  });

  it('?closets=0 leaves it open and inert', () => {
    const map = makeMap([ceilCloset]);
    const rt = createClosets(map, false);
    expect(map.sectors[1]!.ceil).toBe(3);
    expect(rt.lineShut(1)).toBe(false);
    expect(rt.fire('line.tag-1')).toEqual([]);
  });
});

describe('a floor closet (an alcove over a room)', () => {
  const floorCloset: SectorClosetDef = { id: 'f', sector: 1, opensOn: 'e', moves: 'floor', shut: 3, speed: 6 };
  it('rests at its shut floor and comes down to the file floor', () => {
    const map = makeMap([floorCloset]);
    const rt = createClosets(map);
    expect(map.sectors[1]!.floor).toBe(3);
    expect(buildSectorGround(map).lineBlocks(1, 0)).toBe(true);
    rt.fire('e');
    rt.step(0.25);
    expect(map.sectors[1]!.floor).toBeCloseTo(1.5, 6);
    rt.step(1);
    expect(map.sectors[1]!.floor).toBe(0);
    expect(rt.phase[0]).toBe('open');
  });
});

describe('the block', () => {
  it('a ceiling closet: a cap facing down at the shut height, sides out to the open one', () => {
    const map = makeMap([ceilCloset]);
    const m = closetBlockMesh(map, ceilCloset, 3);
    const ys = new Set<number>(), caps: number[] = [];
    for (let i = 0; i < m.count; i++) {
      ys.add(m.position[3 * i + 1]!);
      if (m.normal[3 * i + 1] !== 0) caps.push(m.normal[3 * i + 1]!);
    }
    expect([...ys].sort()).toEqual([0, 3]);
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every(n => n === -1)).toBe(true);
    // Each cap triangle's winding faces down.
    for (let t = 0; t < caps.length; t += 3) {
      const p = (k: number) => [m.position[3 * (t + k)]!, m.position[3 * (t + k) + 2]!];
      const [a, b, c] = [p(0), p(1), p(2)];
      const ny = (b[1]! - a[1]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[1]! - a[1]!);
      expect(ny).toBeLessThan(0);
    }
    expect(m.count).toBe(caps.length + 4 * 6);
  });

  it('a floor closet: the cap faces up at the shut height', () => {
    const def: SectorClosetDef = { id: 'f', sector: 1, opensOn: 'e', moves: 'floor', shut: 3, speed: 6 };
    const m = closetBlockMesh(makeMap([def]), def, 0);
    const capYs = new Set<number>();
    for (let i = 0; i < m.count; i++) if (m.normal[3 * i + 1] === 1) capYs.add(m.position[3 * i + 1]!);
    expect([...capYs]).toEqual([3]);
  });
});
