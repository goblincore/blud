// src/lab/sdf-zombie/webgpu/blood-connections.test.ts
//
// Pure CPU tests for the connection builder: emitter isolation, budgets,
// determinism and NaN hygiene. Nothing here touches a GPU; the module under
// test is a pure function of the droplet array.

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

describe('buildBloodConnections — stream isolation', () => {
  it('never connects two differently tagged emitters', () => {
    const droplets = [...cluster(0, 1, 0, 6, 11), ...cluster(5, 1, 0, 6, 22)];
    const r = buildBloodConnections(droplets);
    expect(r.strands.length).toBeGreaterThan(0);
    for (const s of r.strands) {
      const xs = s.points.map(p => p.x);
      const near0 = xs.every(x => x < 1);
      const near5 = xs.every(x => x > 4);
      // A strand belongs wholly to one cluster.
      expect(near0 || near5, `strand stream ${s.stream} spans both emitters`).toBe(true);
      expect(s.stream).toBe(near0 ? 11 : 22);
      expect(s.explicitStream).toBe(true);
    }
    // No blob bridges the gap either.
    expect(r.blobs.every(b => b.x < 1 || b.x > 4)).toBe(true);
  });

  it('keeps untagged clusters apart by space + age', () => {
    // Proximity fallback: two clusters far apart must derive separate streams.
    const droplets = [...cluster(0, 1, 0, 6), ...cluster(6, 1, 0, 6)];
    const r = buildBloodConnections(droplets);
    expect(r.streamCount).toBeGreaterThanOrEqual(2);
    for (const s of r.strands) {
      const xs = s.points.map(p => p.x);
      expect(xs.every(x => x < 1) || xs.every(x => x > 5)).toBe(true);
      expect(s.explicitStream).toBe(false);
    }
  });

  it('does not connect nodes separated in age even when close in space', () => {
    const droplets = [
      drop(0, 1, 0, { age: 0, life: 2 }),
      drop(0.1, 1, 0, { age: 1.5, life: 2 }),
      drop(0.2, 1, 0, { age: 0.1, life: 2 }),
    ];
    const r = buildBloodConnections(droplets);
    // The middle node is far older than the other two; the young pair may
    // connect but no strand may include the old node with the young ones.
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
    for (let i = 0; i < 30; i++) chain.push(drop(i * 0.3, 1, 0, { age: i * 0.01, life: 5 }));
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
    for (let i = 0; i < 40; i++) chain.push(drop(i * 0.15, 1, 0, { age: i * 0.005, life: 5 }));
    const tuning: Partial<ConnectionTuning> = { maxTotalBlobs: 20, maxStrandBlobs: 20 };
    const r = buildBloodConnections(chain, { tuning });
    expect(r.blobs.length).toBeLessThanOrEqual(20);
  });

  it('honours maxStrands and reports the clamp', () => {
    const droplets = [
      ...cluster(0, 1, 0, 5), ...cluster(5, 1, 0, 5), ...cluster(10, 1, 0, 5),
    ];
    const r = buildBloodConnections(droplets, { tuning: { maxStrands: 1 } });
    expect(r.strands.length).toBe(1);
    expect(r.budgetClamped).toBeGreaterThan(0);
  });

  it('drops strands with no remaining life and reports it', () => {
    const dead = [drop(0, 1, 0, { age: 3, life: 1 }), drop(0.1, 1, 0, { age: 3, life: 1 })];
    const r = buildBloodConnections(dead);
    expect(r.strands).toEqual([]);
    expect(r.nodesRejected).toBe(2);
    // A single node can never make a strand.
    const one = buildBloodConnections([drop(0, 1, 0)]);
    expect(one.strands).toEqual([]);
  });
});

describe('buildBloodConnections — degeneracy and sheets', () => {
  it('rejects a collinear stream as a sheet (no giant line-sail)', () => {
    const line: Droplet[] = [];
    for (let i = 0; i < 8; i++) line.push(drop(i * 0.25, 1, 0, { age: i * 0.01, life: 5 }));
    const r = buildBloodConnections(line, { enableStrands: false, enableSheets: true });
    expect(r.sheets).toEqual([]);
    expect(r.degenerateRejected).toBeGreaterThan(0);
  });

  it('builds a bounded sheet through a spread cluster', () => {
    const grid: Droplet[] = [];
    for (let ix = 0; ix < 3; ix++) {
      for (let iy = 0; iy < 3; iy++) {
        grid.push(drop(ix * 0.4, 1 + iy * 0.4, 0, { age: ix * 0.05 + iy * 0.01, life: 5 }));
      }
    }
    const r = buildBloodConnections(grid, { enableStrands: false, enableSheets: true });
    expect(r.sheets.length).toBeGreaterThan(0);
    expect(r.sheets[0]!.blobs).toBeGreaterThan(0);
    expect(r.blobs.length).toBeLessThanOrEqual(CONNECTION_TUNING.maxSheetBlobs);
  });

  it('strands and sheets are independently toggleable', () => {
    const grid: Droplet[] = [];
    for (let ix = 0; ix < 3; ix++) {
      for (let iy = 0; iy < 3; iy++) {
        grid.push(drop(ix * 0.4, 1 + iy * 0.4, 0, { age: ix * 0.05 + iy * 0.01, life: 5 }));
      }
    }
    const strandsOnly = buildBloodConnections(grid, { enableSheets: false });
    expect(strandsOnly.strands.length).toBeGreaterThan(0);
    expect(strandsOnly.sheets).toEqual([]);
    const sheetsOnly = buildBloodConnections(grid, { enableStrands: false });
    expect(sheetsOnly.strands).toEqual([]);
    expect(sheetsOnly.sheets.length).toBeGreaterThan(0);
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
      drop(0, 1, 0), drop(0.1, 1.2, 0.1), drop(0.3, 0.9, -0.2),
      drop(0.4, 1.1, 0.3), drop(0.55, 1.3, 0.05), drop(0.7, 0.8, -0.1),
      drop(2, 1, 0), drop(2.2, 1.1, 0.2), drop(2.4, 0.9, -0.3),
      drop(2.6, 1.2, 0.1), drop(2.8, 1.0, 0.25),
    ];
    const r = buildBloodConnections(messy);
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
