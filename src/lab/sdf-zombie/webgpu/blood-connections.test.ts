// src/lab/sdf-zombie/webgpu/blood-connections.test.ts
//
// Pure CPU tests for the connection builder: STRICT emitter provenance,
// budgets, determinism, stable sheet topology and NaN hygiene. Nothing here
// touches a GPU; the module under test is a pure function of the droplet
// array.

import { describe, it, expect } from 'vitest';
import type { Droplet } from '../blood-sim';
import {
  CONNECTION_TUNING, buildBloodConnections, connectionBlobsForSim,
  hash01, valueNoise3, type ConnectionTuning,
} from './blood-connections';

interface DropOpts {
  age?: number; life?: number; size?: number;
  kind?: Droplet['kind']; stream?: number;
}

function drop(x: number, y: number, z: number, o: DropOpts = {}): Droplet {
  return {
    pos: [x, y, z],
    vel: [0, 0, 0],
    age: o.age ?? 0,
    life: o.life ?? 1,
    size: o.size ?? 0.22,
    kind: o.kind ?? 'drop',
    ...(o.stream !== undefined ? { stream: o.stream } : {}),
  } as Droplet;
}

/** A tight cluster of `n` droplets around an origin. */
function cluster(cx: number, cy: number, cz: number, n: number, stream?: number): Droplet[] {
  const out: Droplet[] = [];
  for (let i = 0; i < n; i++) {
    out.push(drop(cx + (i % 3) * 0.12, cy + Math.floor(i / 3) * 0.12, cz + (i % 2) * 0.1, { stream }));
  }
  return out;
}

/** A 3x3 patch spanning the X/Y plane, one stream. */
function spreadGrid(stream = 1, origin: [number, number, number] = [0, 0, 0]): Droplet[] {
  const out: Droplet[] = [];
  for (let ix = 0; ix < 3; ix++) {
    for (let iy = 0; iy < 3; iy++) {
      out.push(drop(origin[0] + ix * 0.4, origin[1] + 1 + iy * 0.4, origin[2],
        { age: ix * 0.05 + iy * 0.01, life: 5, stream }));
    }
  }
  return out;
}

describe('hash01 / valueNoise3 (deterministic noise, no RNG)', () => {
  it('hash01 is stable and in [0,1)', () => {
    for (let i = 0; i < 50; i++) {
      const v = hash01(i * 0.3, i * -0.7, i * 1.1, 1234);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash01(i * 0.3, i * -0.7, i * 1.1, 1234)).toBe(v);
    }
  });

  it('valueNoise3 is stable, in [0,1], and varies in space', () => {
    const a = valueNoise3(1.2, 3.4, 5.6, 7);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
    expect(valueNoise3(1.2, 3.4, 5.6, 7)).toBe(a);
    expect(valueNoise3(9.9, 3.4, 5.6, 7)).not.toBe(a);
  });
});

describe('buildBloodConnections — strict emitter provenance', () => {
  it('never connects two differently tagged emitters, even when adjacent', () => {
    // Two separate wounds 0.25 m apart: proximity must NOT fuse them.
    const droplets = [...cluster(0, 1, 0, 6, 11), ...cluster(0.25, 1, 0, 6, 22)];
    const r = buildBloodConnections(droplets);
    expect(r.strands.length).toBeGreaterThan(0);
    const streams = new Set(r.strands.map(s => s.stream));
    expect([...streams].sort()).toEqual([11, 22]);
    for (const s of r.strands) {
      const xs = s.points.map(p => p.x);
      // A strand belongs to one cluster; a proximity bridge would span both.
      expect(Math.max(...xs) - Math.min(...xs), `strand ${s.stream} bridges emitters`).toBeLessThan(0.4);
      const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(s.stream).toBe(meanX < 0.25 ? 11 : 22);
    }
  });

  it('rejects untagged nodes instead of inventing identity by proximity', () => {
    const tagged = cluster(0, 1, 0, 6, 5);
    const untagged = cluster(0.3, 1, 0, 6);
    const r = buildBloodConnections([...tagged, ...untagged]);
    expect(r.untaggedRejected).toBe(6);
    expect(r.nodeCount).toBe(6);
    expect(r.strands.length).toBeGreaterThan(0);
    for (const s of r.strands) expect(s.stream).toBe(5);
    for (const b of r.blobs) expect(b.x).toBeLessThan(0.3);
  });

  it('makes no connections at all from untagged droplets', () => {
    const r = buildBloodConnections(cluster(0, 1, 0, 8));
    expect(r.strands).toEqual([]);
    expect(r.sheets).toEqual([]);
    expect(r.blobs).toEqual([]);
    expect(r.untaggedRejected).toBe(8);
    expect(r.streamCount).toBe(0);
  });

  it('does not link nodes of one stream separated in age', () => {
    const droplets = [
      drop(0, 1, 0, { age: 0, life: 2, stream: 1 }),
      drop(0.1, 1, 0, { age: 1.5, life: 2, stream: 1 }),
      drop(0.2, 1, 0, { age: 0.1, life: 2, stream: 1 }),
    ];
    const r = buildBloodConnections(droplets);
    // The middle node is far older than the other two; a strand may connect
    // the young pair but may never include the old node with the young ones.
    for (const s of r.strands) {
      const ages = s.points.map(p => (p.x < 0.05 ? 0 : p.x < 0.15 ? 1.5 : 0.1));
      const hasOld = ages.some(a => a > 1);
      const hasYoung = ages.some(a => a < 0.5);
      expect(hasOld && hasYoung).toBe(false);
    }
  });
});

describe('buildBloodConnections — budgets', () => {
  it('clamps strand length and node count, and blob count', () => {
    // A long chain within link range: 30 nodes 0.3 apart = 8.7 m.
    const chain: Droplet[] = [];
    for (let i = 0; i < 30; i++) chain.push(drop(i * 0.3, 1, 0, { age: i * 0.01, life: 5, stream: 1 }));
    const r = buildBloodConnections(chain);
    expect(r.strands.length).toBeGreaterThan(0);
    for (const s of r.strands) {
      expect(s.length).toBeLessThanOrEqual(CONNECTION_TUNING.maxStrandLength + 1e-9);
      expect(s.points.length).toBeLessThanOrEqual(CONNECTION_TUNING.maxStrandNodes);
    }
    expect(r.blobs.length).toBeLessThanOrEqual(CONNECTION_TUNING.maxStrandBlobs * r.strands.length);
  });

  it('honours maxTotalBlobs as a hard ceiling', () => {
    const chain: Droplet[] = [];
    for (let i = 0; i < 40; i++) chain.push(drop(i * 0.15, 1, 0, { age: i * 0.005, life: 5, stream: 1 }));
    const tuning: Partial<ConnectionTuning> = { maxTotalBlobs: 20, maxStrandBlobs: 20 };
    const r = buildBloodConnections(chain, { tuning });
    expect(r.blobs.length).toBeLessThanOrEqual(20);
  });

  it('honours maxStrands and reports the clamp', () => {
    const droplets = [
      ...cluster(0, 1, 0, 5, 1), ...cluster(5, 1, 0, 5, 2), ...cluster(10, 1, 0, 5, 3),
    ];
    const r = buildBloodConnections(droplets, { tuning: { maxStrands: 1 } });
    expect(r.strands.length).toBe(1);
    expect(r.budgetClamped).toBeGreaterThan(0);
  });

  it('drops strands with no remaining life and reports it', () => {
    const dead = [
      drop(0, 1, 0, { age: 3, life: 1, stream: 1 }),
      drop(0.1, 1, 0, { age: 3, life: 1, stream: 1 }),
    ];
    const r = buildBloodConnections(dead);
    expect(r.strands).toEqual([]);
    expect(r.nodesRejected).toBe(2);
    // A single node can never make a strand.
    const one = buildBloodConnections([drop(0, 1, 0, { stream: 1 })]);
    expect(one.strands).toEqual([]);
  });
});

describe('buildBloodConnections — degeneracy and sheets', () => {
  it('keeps sheets OFF by default (experimental)', () => {
    const r = buildBloodConnections(spreadGrid(1));
    expect(r.strands.length).toBeGreaterThan(0);
    expect(r.sheets).toEqual([]);
  });

  it('rejects a collinear stream as a sheet (no giant line-sail)', () => {
    const line: Droplet[] = [];
    for (let i = 0; i < 8; i++) line.push(drop(i * 0.25, 1, 0, { age: i * 0.01, life: 5, stream: 1 }));
    const r = buildBloodConnections(line, { enableStrands: false, enableSheets: true });
    expect(r.sheets).toEqual([]);
    expect(r.degenerateRejected).toBeGreaterThan(0);
  });

  it('builds a bounded sheet through a spread cluster', () => {
    const r = buildBloodConnections(spreadGrid(1), { enableStrands: false, enableSheets: true });
    expect(r.sheets.length).toBeGreaterThan(0);
    expect(r.sheets[0]!.blobs).toBeGreaterThan(0);
    expect(r.blobs.length).toBeLessThanOrEqual(CONNECTION_TUNING.maxSheetBlobs);
  });

  it('strands and sheets are independently toggleable', () => {
    const grid = spreadGrid(1);
    const strandsOnly = buildBloodConnections(grid, { enableSheets: false });
    expect(strandsOnly.strands.length).toBeGreaterThan(0);
    expect(strandsOnly.sheets).toEqual([]);
    const sheetsOnly = buildBloodConnections(grid, { enableStrands: false, enableSheets: true });
    expect(sheetsOnly.strands).toEqual([]);
    expect(sheetsOnly.sheets.length).toBeGreaterThan(0);
  });
});

describe('buildBloodConnections — stable sheet topology', () => {
  const sheetOpts = { enableStrands: false, enableSheets: true } as const;

  it('is translation invariant: holes and layout ride the material grid', () => {
    const a = buildBloodConnections(spreadGrid(7), sheetOpts);
    const t = spreadGrid(7).map(d => {
      const [x, y, z] = d.pos;
      d.pos[0] = x + 13; d.pos[1] = y - 4; d.pos[2] = z + 7;
      return d;
    });
    const b = buildBloodConnections(t, sheetOpts);
    expect(a.sheets.length).toBe(b.sheets.length);
    expect(a.blobs.length).toBe(b.blobs.length);
    expect(a.sheets[0]!.holes).toBe(b.sheets[0]!.holes);
    const q = (v: number) => Math.round(v * 1e6) / 1e6 + 0; // +0 normalises -0
    const rel = (r: typeof a) => r.blobs
      .map(bl => [q(bl.x - r.sheets[0]!.centre.x), q(bl.y - r.sheets[0]!.centre.y), q(bl.z - r.sheets[0]!.centre.z)])
      .sort((p, s) => p[0]! - s[0]! || p[1]! - s[1]! || p[2]! - s[2]!);
    expect(rel(b)).toEqual(rel(a));
  });

  it('holds the frame when the world AABB widest axis crosses', () => {
    // Both frames flow along +X; the second spreads much wider in Y, so the
    // AABB's two largest extents swap order. The old `axes.sort()` would have
    // flipped the patch onto a different pair of world axes mid-flight. The
    // flow frame must not move.
    const patch = (spread: number): Droplet[] => {
      const out: Droplet[] = [];
      const ys = [-spread, 0, spread];
      for (let ix = 0; ix < 3; ix++) {
        for (const y of ys) {
          // Ages pin the flow endpoints unambiguously: oldest (0,1,0),
          // newest (1,1,0), so the flow is exactly +X however wide Y grows.
          const age = (ix === 0 && y === 0) ? 0
            : (ix === 2 && y === 0) ? 1
              : 0.2 + ix * 0.2 + (y + spread) * 0.01;
          out.push(drop(ix * 0.5, 1 + y, 0, { age, life: 5, stream: 9 }));
        }
      }
      return out;
    };
    const frameA = patch(0.15); // X extent 1.0 > Y extent 0.3
    const frameB = patch(0.8);  // Y extent 1.6 > X extent 1.0
    const a = buildBloodConnections(frameA, sheetOpts);
    const b = buildBloodConnections(frameB, sheetOpts);
    expect(a.sheets.length).toBeGreaterThan(0);
    expect(b.sheets.length).toBeGreaterThan(0);
    const ba = a.sheets[0]!.basis; const bb = b.sheets[0]!.basis;
    for (let i = 0; i < 3; i++) {
      expect(bb.axis0[i]!).toBeCloseTo(ba.axis0[i]!, 6);
      expect(bb.axis1[i]!).toBeCloseTo(ba.axis1[i]!, 6);
    }
  });

  it('fades a sheet whose remaining life is short', () => {
    const long = spreadGrid(3);
    const short = spreadGrid(3).map(d => { d.life = d.age + 0.02; return d; });
    const a = buildBloodConnections(long, sheetOpts);
    const b = buildBloodConnections(short, sheetOpts);
    const maxR = (r: typeof a) => Math.max(...r.blobs.map(bl => bl.halfW), 0);
    if (a.blobs.length > 0 && b.blobs.length > 0) {
      expect(maxR(b)).toBeLessThan(maxR(a));
    } else {
      // A faded sheet may legitimately drop every cell.
      expect(b.blobs.length).toBeLessThanOrEqual(a.blobs.length);
    }
  });
});

describe('buildBloodConnections — determinism and hygiene', () => {
  it('is a stable replay on identical input', () => {
    const droplets = [...cluster(0, 1, 0, 8, 3), ...cluster(2.5, 1.3, 0, 8, 4)];
    const a = buildBloodConnections(droplets);
    const b = buildBloodConnections(droplets);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('does not mutate the input droplets', () => {
    const droplets = cluster(0, 1, 0, 6, 1);
    const before = JSON.stringify(droplets);
    buildBloodConnections(droplets);
    expect(JSON.stringify(droplets)).toBe(before);
  });

  it('never emits a NaN or infinite blob', () => {
    const messy = [
      drop(0, 1, 0, { stream: 1 }), drop(0.1, 1.2, 0.1, { stream: 1 }),
      drop(0.3, 0.9, -0.2, { stream: 1 }), drop(0.4, 1.1, 0.3, { stream: 1 }),
      drop(0.55, 1.3, 0.05, { stream: 1 }), drop(0.7, 0.8, -0.1, { stream: 1 }),
      drop(2, 1, 0, { stream: 2 }), drop(2.2, 1.1, 0.2, { stream: 2 }),
      drop(2.4, 0.9, -0.3, { stream: 2 }), drop(2.6, 1.2, 0.1, { stream: 2 }),
      drop(2.8, 1.0, 0.25, { stream: 2 }),
    ];
    const r = buildBloodConnections(messy, { enableSheets: true });
    expect(r.blobs.length).toBeGreaterThan(0);
    for (const b of r.blobs) {
      for (const v of [b.x, b.y, b.z, b.halfW, b.halfH, b.roll]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(b.halfW).toBeGreaterThan(0);
      expect(b.halfH).toBeGreaterThan(0);
    }
  });

  it('connectionBlobsForSim is the blob slice of the full result', () => {
    const droplets = cluster(0, 1, 0, 7, 2);
    const full = buildBloodConnections(droplets);
    expect(connectionBlobsForSim(droplets)).toEqual(full.blobs);
  });
});
