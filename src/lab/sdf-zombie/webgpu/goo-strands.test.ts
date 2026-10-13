// src/lab/sdf-zombie/webgpu/goo-strands.test.ts
import { describe, it, expect } from 'vitest';
import { DURATION } from './emergence-timeline';
import {
  COAT, DESK_Y, EGG, EGG_REST, FRAME_BOTTOM, FRAME_FACE_Z, FRAME_TOP, KEYBOARD_RECT, KEYBOARD_TOP, coatCoverage, coatThickness, dripFloor, eggCentre,
  ellipsoidDist, onKeyboard, KOTATSU, TABLE_FRONT_Z,
} from './emergence-field';
import { paramsAt } from './emergence-timeline';
import {
  DRIP_R, DRIP_RETRACT, DRIP_TIP, N_CONES, N_COAT, N_RUNS, N_STRANDS, N_BEADS, N_DRIPS, N_POOLS, RUN, RUN_W, STRAND_POINTS, dripsAt, gooAt, gooTexels, GOO_BOUND0,
  GOO_COAT0, GOO_POOL0, GOO_TEXELS, POOL_REACH,
} from './goo-strands';

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
/** The 0.05 s grid over the whole run (integer steps, so no float drift in t). */
const GRID = Array.from({ length: Math.round(DURATION / 0.05) + 1 }, (_, i) => Math.min(DURATION, i * 0.05));

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

  it('drips stop at their floor (the keyboard\'s top over it, the desk\'s elsewhere: it never moves) and never pass through it', () => {
    let onKeys = 0;
    for (let t = 8; t <= DURATION; t += 0.25) for (const d of dripsAt(t).drips) {
      if (d.length === 0) continue;
      expect(d.floor, `t=${t}`).toBe(dripFloor(d.top[0], d.top[2]));
      expect(d.tip[1] - d.radius * 1.6, `t=${t}`).toBeGreaterThanOrEqual(d.floor - 1e-9);
      if (d.floor === KEYBOARD_TOP) onKeys++;
    }
    // while the lip is bowed out over the keyboard's back edge the drips land on the keys; once it relaxes back they hang over the desk
    expect(onKeys).toBeGreaterThan(10);
    expect(gooAt(DURATION).drips.every(d => d.floor === DESK_Y)).toBe(true);
  });

  it('dripsAt is gooAt\'s drips, runs, coat and drip and run pools (the cheap twin the housing test scans with)', () => {
    for (const t of [8.5, 11.5, 12.6, 13.2, 14.5]) {
      const g = gooAt(t), d = dripsAt(t);
      expect(JSON.stringify(d.drips), `t=${t}`).toBe(JSON.stringify(g.drips));
      expect(JSON.stringify(d.runs), `t=${t}`).toBe(JSON.stringify(g.runs));
      expect(JSON.stringify(d.coat), `t=${t}`).toBe(JSON.stringify(g.coat));
      expect(JSON.stringify(d.pools), `t=${t}`).toBe(JSON.stringify(g.pools.slice(1)));
    }
  });

  it('a drip is never inside the CRT housing: it hangs straight down in front of the chin\'s face, radii included, at every time', () => {
    let seen = 0;
    for (const t of GRID) for (const [i, d] of dripsAt(t).drips.entries()) {
      if (d.length <= 0) continue;
      seen++;
      expect(d.tip[0], `t=${t} drip ${i}`).toBe(d.top[0]);
      expect(d.tip[2], `t=${t} drip ${i}`).toBe(d.top[2]);
      // anchored on the OUTSIDE of the chin: its top at least the fattest radius (the tip's) plus 4 mm in front of the face
      expect(d.top[2], `t=${t} drip ${i}`).toBeGreaterThanOrEqual(FRAME_FACE_Z + DRIP_R * DRIP_TIP + 0.004 - 1e-12);
      // the whole round cone, top sphere to tip sphere: where its height overlaps the frame's, its back is in front of the face
      const yLo = d.tip[1] - d.radius * DRIP_TIP, yHi = d.top[1] + d.radius;
      if (yHi >= FRAME_BOTTOM && yLo <= FRAME_TOP) expect(d.top[2] - d.radius * DRIP_TIP, `t=${t} drip ${i}`).toBeGreaterThanOrEqual(FRAME_FACE_Z);
    }
    expect(seen).toBeGreaterThan(100);
  });

  it('drips retract with the heal: from the bottom up (the tip rising, the drip thinning), gone by the heal\'s DRIP_RETRACT end', () => {
    const [h0, h1] = DRIP_RETRACT;
    const win = GRID.filter(t => paramsAt(t).heal >= h0);
    // they were there when it began
    expect(dripsAt(win[0]!).drips.every(d => d.length > 0.03)).toBe(true);
    let prev = dripsAt(win[0]!).drips;
    for (const t of win.slice(1)) {
      const cur = dripsAt(t).drips, heal = paramsAt(t).heal;
      for (let i = 0; i < N_DRIPS; i++) {
        const a = prev[i]!, b = cur[i]!;
        expect(b.length, `t=${t} drip ${i}`).toBeLessThanOrEqual(a.length + 1e-12);
        if (b.length > 0) {
          expect(b.radius, `t=${t} drip ${i}`).toBeLessThanOrEqual(a.radius + 1e-12);
          expect(b.tip[1], `t=${t} drip ${i}`).toBeGreaterThanOrEqual(a.tip[1] - 1e-12);
        }
        if (heal >= h1) expect(b.length, `t=${t} drip ${i}`).toBe(0);
      }
      prev = cur;
    }
    // thinner mid-way, and nothing left for the shader after the heal
    const mid = win.find(t => paramsAt(t).heal >= (h0 + h1) / 2)!;
    for (const d of dripsAt(mid).drips) { expect(d.length).toBeGreaterThan(0); expect(d.radius).toBeLessThan(DRIP_R); }
    const tex = gooTexels(gooAt(DURATION));
    const d0 = N_STRANDS * STRAND_POINTS + N_BEADS;
    for (let k = 0; k < 2 * N_DRIPS; k++) expect(tex[(d0 + k) * 4 + 3]).toBe(0);
  });

  it('what the drips leave where they land (a pool on the desk, a blob of the coat on the keys) stays where it formed after they retract', () => {
    // each drip's mark: its pool on the desk (pools[i]) or its coat blob on the keyboard (coat[1 + i]); radius only grows, centre fixed
    const first: ({ r: number; c: number[] } | null)[] = Array(2 * N_DRIPS).fill(null);
    for (const t of GRID) {
      const d = dripsAt(t);
      const marks = [...d.pools.slice(0, N_DRIPS).map(p => ({ r: p.radius, c: [...p.centre] })), ...d.coat.slice(1).map(b => ({ r: b.r, c: [b.x, b.z] }))];
      marks.forEach((m, i) => {
        const f = first[i] ?? null;
        if (f === null) { if (m.r > 0) first[i] = m; return; }
        expect(m.r, `t=${t} mark ${i}`).toBeGreaterThanOrEqual(f.r);
        expect(m.c, `t=${t} mark ${i}`).toEqual(f.c);
        f.r = m.r;
      });
    }
    expect(first.filter(f => f !== null).length).toBeGreaterThanOrEqual(2);
    const end = dripsAt(DURATION);
    expect(end.pools.slice(0, N_DRIPS).filter(p => p.radius > 0).length + end.coat.slice(1).filter(b => b.r > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('drips that land on the keys feed the keyboard\'s coat there; the coat covers more and more of it, most of it by the settle', () => {
    const at = (t: number) => dripsAt(t).coat;
    expect(at(9.5).every(b => b.r === 0)).toBe(true);
    expect(coatCoverage(at(9.5))).toBe(0);
    // every drip blob lies on the keyboard
    for (const b of at(DURATION).slice(1)) if (b.r > 0) expect(onKeyboard(b.x, b.z)).toBe(true);
    expect(at(DURATION).slice(1).filter(b => b.r > 0).length).toBeGreaterThanOrEqual(2);
    // coverage never shrinks, and grows from the first drip's landing (about 10 s) and the egg's fall (10.5 s)
    let prev = 0;
    for (let t = 9.5; t <= DURATION + 1e-9; t += 0.25) {
      const c = coatCoverage(at(t));
      expect(c, `t=${t}`).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = c;
    }
    expect(coatCoverage(at(10.75))).toBeGreaterThan(0);
    expect(coatCoverage(at(11.5))).toBeGreaterThan(0.3);
    expect(coatCoverage(at(13))).toBeGreaterThan(0.5);
    // thicker round the egg's foot than out at the keyboard's ends
    const c13 = at(13);
    expect(coatThickness(c13, EGG_REST[0], EGG_REST[2])).toBeGreaterThan(coatThickness(c13, KEYBOARD_RECT.x1 - 0.03, EGG_REST[2]) + 0.005);
  });

  it('the coat runs over the keyboard\'s front edge to the desk: straight down from the edge, never through the desk, and it stays', () => {
    expect(dripsAt(10.4).runs.every(r => r.length === 0)).toBe(true);
    let prev = dripsAt(10.4).runs;
    for (let t = 10.5; t <= DURATION + 1e-9; t += 0.1) {
      const runs = dripsAt(t).runs;
      runs.forEach((r, i) => {
        expect(r.length, `t=${t.toFixed(1)} run ${i}`).toBeGreaterThanOrEqual(prev[i]!.length - 1e-12);
        if (r.length <= 0) return;
        expect(r.top[2]).toBeGreaterThan(KEYBOARD_RECT.z1);                 // over the front edge, not through the keyboard
        expect(r.top[2] - RUN.r * RUN_W[i]! * DRIP_TIP).toBeLessThan(KEYBOARD_RECT.z1);  // and clinging to its front face (the fat tip touches it)
        expect(r.tip[0]).toBe(r.top[0]); expect(r.tip[2]).toBe(r.top[2]);
        expect(r.tip[1] - r.radius * DRIP_TIP, `t=${t.toFixed(1)} run ${i}`).toBeGreaterThanOrEqual(DESK_Y - 1e-9);
      });
      prev = runs;
    }
    const end = dripsAt(DURATION);
    expect(end.runs.filter(r => r.length > 0).length).toBe(N_RUNS);
    end.runs.forEach((r, i) => {
      expect(r.radius).toBeGreaterThan(RUN.r * RUN_W[i]! * 0.99);
      expect(r.tip[1] - r.radius * DRIP_TIP).toBeCloseTo(DESK_Y, 9);     // its tip rests on the desk
    });
    // they reach the desk and pool there
    expect(end.pools.slice(N_DRIPS).filter(p => p.radius > 0).length).toBeGreaterThanOrEqual(2);
    for (const p of end.pools.slice(N_DRIPS)) expect(p.centre[1]).toBe(DESK_Y);
  });

  it('the slick: nothing before the egg lands, a pool under it after, and drip pools only on the desk', () => {
    expect(gooAt(10).pools.every(p => p.radius === 0)).toBe(true);
    const g = gooAt(DURATION), c = eggCentre(paramsAt(DURATION));
    expect(g.pools).toHaveLength(N_POOLS);
    expect(g.pools[0]!.radius).toBeGreaterThan(EGG.rx);
    expect(g.pools[0]!.centre).toEqual([c[0], DESK_Y, c[2]]);
    const tex = gooTexels(g);
    expect(tex[GOO_POOL0 * 4 + 3]).toBeCloseTo(g.pools[0]!.radius, 6);
    expect(GOO_POOL0 + N_POOLS).toBeLessThanOrEqual(GOO_TEXELS);
    // the coat's blobs after the pools: (x, peak, z, radius)
    expect(GOO_COAT0).toBe(GOO_POOL0 + N_POOLS);
    expect(GOO_COAT0 + N_COAT).toBeLessThanOrEqual(GOO_TEXELS);
    g.coat.forEach((b, i) => {
      expect([tex[(GOO_COAT0 + i) * 4], tex[(GOO_COAT0 + i) * 4 + 1], tex[(GOO_COAT0 + i) * 4 + 2]]).toEqual([b.x, b.h, b.z].map(Math.fround));
      expect(tex[(GOO_COAT0 + i) * 4 + 3]).toBeCloseTo(b.r > 0 && b.h > 0 ? b.r : 0, 6);
    });
    expect(g.coat[0]!.r).toBeGreaterThan(COAT.egg.r * 0.99);
  });

  it('every pool, its edge wobble included (scrPool: up to 1.15x), lies on the kotatsu\'s board (look round 1: the floor-level set)', () => {
    // The board: KOTATSU.w wide, from TABLE_FRONT_Z back KOTATSU.d. POOL_REACH is the egg's slick at its widest; the page builds the board here.
    expect(EGG_REST[2] + POOL_REACH).toBeLessThan(TABLE_FRONT_Z);
    for (const t of GRID.filter((_, i) => i % 10 === 0).concat(DURATION)) {
      const { pools, runs, drips } = gooAt(t);
      for (const p of pools) {
        if (p.radius <= 0) continue;
        const r = p.radius * 1.15;
        expect(p.centre[2] + r, `t=${t} pool front`).toBeLessThan(TABLE_FRONT_Z);
        expect(p.centre[2] - r).toBeGreaterThan(TABLE_FRONT_Z - KOTATSU.d);
        expect(Math.abs(p.centre[0]) + r).toBeLessThan(KOTATSU.w / 2);
      }
      for (const d of [...runs, ...drips]) if (d.length > 0) expect(d.tip[2] + d.radius * DRIP_TIP, `t=${t} drip/run tip`).toBeLessThan(TABLE_FRONT_Z);
    }
  });

  it('a strand\'s egg end stays on the egg\'s surface as the egg moves', () => {
    for (const t of [8.5, 9.5, 10.5, 11.2, 11.8]) {
      const g = gooAt(t), c = eggCentre(paramsAt(t));
      for (const s of g.strands.filter(s => s.live)) {
        const b = s.points[STRAND_POINTS - 1]!;
        expect(Math.abs(ellipsoidDist([b[0] - c[0], b[1] - c[1], b[2] - c[2]], [EGG.rx, EGG.ry, EGG.rz])), `t=${t}`).toBeLessThan(1e-3);
      }
    }
  });

  it('once the egg is out the strands cross a real gap, and in the heal they let go and thin away before the tear closes', () => {
    const c = eggCentre(paramsAt(11.5));
    const clear = gooAt(11.5).strands.filter(s => s.live && s.points.filter(p => ellipsoidDist([p[0] - c[0], p[1] - c[1], p[2] - c[2]], [EGG.rx, EGG.ry, EGG.rz]) > s.radius).length >= 4);
    expect(clear.length).toBeGreaterThanOrEqual(3);
    expect(gooAt(13.5).strands.every(s => s.radius < 1e-3)).toBe(true);
  });

  it('a let-go strand lies on the keyboard or the desk, never through either', () => {
    for (const t of [12.4, 12.8, 13.2]) for (const s of gooAt(t).strands.filter(s => s.live))
      for (const p of s.points.slice(0, -1)) expect(p[1], `t=${t}`).toBeGreaterThanOrEqual(dripFloor(p[0], p[2]) - 1e-9);
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
      expect(N_CONES).toBe(N_DRIPS + N_RUNS);
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
      holds(GOO_BOUND0 + N_STRANDS + 1, b0 + N_BEADS, b0 + N_BEADS + 2 * N_CONES);
    }
  });
});
