// src/lab/sdf-zombie/webgpu/goo-strands.test.ts
import { describe, it, expect } from 'vitest';
import { DURATION } from './emergence-timeline';
import { N_STRANDS, N_BEADS, N_DRIPS, STRAND_POINTS, gooAt, gooTexels, GOO_BOUND0, GOO_TEXELS } from './goo-strands';

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('goo strands', () => {
  it('has nothing before the tear opens', () => {
    const g = gooAt(3);
    expect(g.strands.every(s => !s.live)).toBe(true);
    expect(g.drips.every(d => d.length === 0)).toBe(true);
  });

  it('is deterministic: the same time gives the same points, however it is reached', () => {
    const a = gooAt(9.37), b = gooAt(9.37);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    gooAt(14);                                   // a scrub elsewhere must not leak state
    expect(JSON.stringify(gooAt(9.37))).toBe(JSON.stringify(a));
  });

  it('strands are anchored at both ends and never stretch past their length limit', () => {
    for (const t of [7.5, 8.5, 9.5, 10.5, 11.5, 12.18, 13]) {
      const g = gooAt(t);
      for (const s of g.strands.filter(s => s.live)) {
        expect(s.points).toHaveLength(STRAND_POINTS);
        for (let i = 1; i < s.points.length; i++) expect(dist(s.points[i]!, s.points[i - 1]!), `t=${t}`).toBeLessThanOrEqual(s.segMax + 1e-6);
        expect(s.points.flat().every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('is stable: the whole run stays finite and inside a 3 m box', () => {
    for (let t = 0; t <= DURATION; t += 0.5) {
      const g = gooAt(t);
      // a bead of radius 0 is parked at the (0,-9,0) sentinel the shader skips, so only real beads are boxed
      for (const p of [...g.strands.flatMap(s => s.points), ...g.beads.filter(b => b.radius > 0).map(b => b.pos), ...g.drips.flatMap(d => d.length ? [d.top, d.tip] : [])])
        for (const v of p) { expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v)).toBeLessThan(3); }
    }
  });

  it('strands sag under gravity once the egg is out (the middle is lower than the chord)', () => {
    const g = gooAt(11.5);
    const live = g.strands.filter(s => s.live);
    expect(live.length).toBeGreaterThan(0);
    for (const s of live) {
      const mid = s.points[Math.floor(STRAND_POINTS / 2)]!, a = s.points[0]!, b = s.points[STRAND_POINTS - 1]!;
      expect(mid[1]).toBeLessThan((a[1] + b[1]) / 2 + 1e-6);
    }
  });

  it('drips grow downward from the bezel and stop at a length limit', () => {
    const early = gooAt(8), late = gooAt(12);
    const len = (d: { length: number }) => d.length;
    expect(Math.max(...late.drips.map(len))).toBeGreaterThan(Math.max(...early.drips.map(len)));
    for (const d of late.drips) expect(d.length).toBeLessThanOrEqual(0.25);
  });

  it('a strand and its beads thicken in after it forms instead of popping in at full radius', () => {
    const seen = new Set<number>();
    for (let t = 7; t <= 10; t += 1 / 60) {
      gooAt(t).strands.forEach((s, i) => {
        if (!s.live || seen.has(i)) return;
        seen.add(i);
        expect(s.radius, `strand ${i} at t=${t.toFixed(3)}`).toBeLessThan(0.0015);
        // its beads (bead b rides strand b % N_STRANDS) are as thin
        gooAt(t).beads.forEach((b, bi) => { if (bi % N_STRANDS === i) expect(b.radius, `bead ${bi} at t=${t.toFixed(3)}`).toBeLessThan(0.003); });
      });
    }
    expect(seen.size).toBe(N_STRANDS);
  });

  it('packs into the fixed texel count the shader reads', () => {
    const tex = gooTexels(gooAt(9));
    expect(tex).toHaveLength(GOO_TEXELS * 4);
    expect(GOO_BOUND0 + N_STRANDS + 2).toBeLessThanOrEqual(GOO_TEXELS);
  });

  it('the bounds hold their pieces: each strand\'s points, the beads and the drips, radii included', () => {
    for (const t of [7.5, 9, 10.5, 12, 14]) {
      const tex = gooTexels(gooAt(t));
      const tx = (i: number) => [tex[i * 4]!, tex[i * 4 + 1]!, tex[i * 4 + 2]!, tex[i * 4 + 3]!];
      const holds = (bi: number, a: number, b: number) => {
        const B = tx(bi);
        for (let i = a; i < b; i++) {
          const s = tx(i);
          if (s[3]! <= 0) continue;
          expect(B[3], `t=${t} bound ${bi}`).toBeGreaterThan(0);
          expect(dist(s, B) + s[3]!, `t=${t} texel ${i} in bound ${bi}`).toBeLessThanOrEqual(B[3]! + 1e-6);
        }
      };
      for (let s = 0; s < N_STRANDS; s++) holds(GOO_BOUND0 + s, s * STRAND_POINTS, (s + 1) * STRAND_POINTS);
      const b0 = N_STRANDS * STRAND_POINTS;
      holds(GOO_BOUND0 + N_STRANDS, b0, b0 + N_BEADS);
      holds(GOO_BOUND0 + N_STRANDS + 1, b0 + N_BEADS, b0 + N_BEADS + 2 * N_DRIPS);
    }
  });
});
