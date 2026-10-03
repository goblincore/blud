import { describe, it, expect } from 'vitest';
import { cutLipAmp, cutThreatWound, woundThreatMasks, type ThreatGroup } from './wound-threat';
import { CUT_SHADE, ROD_CALIBRE, cutCarve, stampCut } from '../cut-wound';
import { woundDirToWorld, woundWorldPos, type Wound } from '../damage';
import { prim } from '../head-pop';
import { sdBody } from '../validate';
import type { Primitive, Vec3 } from '../types';

// Two clusters: 0 = a torso group at the origin, 1 = a limb with a near and a far group.
const groups: ThreatGroup[] = [
  { center: [0, 0, 0], radius: 0.2, distort: 1 },
  { center: [0.3, 0, 0], radius: 0.05, distort: 1 },
  { center: [0.3, -0.8, 0], radius: 0.05, distort: 1 },
];
const clusterGroups: [number, number][] = [[0, 1], [1, 2]];

describe('woundThreatMasks', () => {
  it('names a foreign cluster whose group reaches the carve sphere, and never the owner', () => {
    const [m] = woundThreatMasks([{ pos: [0.15, 0, 0], radius: 0.1, owner: 0 }], groups, clusterGroups, 0.02);
    expect(m).toBe(1 << 2);
  });
  it('drops a cluster that is out of reach', () => {
    const [m] = woundThreatMasks([{ pos: [-0.15, 0, 0], radius: 0.1, owner: 0 }], groups, clusterGroups, 0.02);
    expect(m).toBe(0);
  });
  it('is conservative in the margin', () => {
    const [m] = woundThreatMasks([{ pos: [-0.15, 0, 0], radius: 0.1, owner: 0 }], groups, clusterGroups, 0.4);
    expect(m).toBe(1 << 2);
  });
  it('an unscoped wound threatens nobody: it is applied in every re-fold, never foreign', () => {
    const [m] = woundThreatMasks([{ pos: [0.15, 0, 0], radius: 0.5, owner: -1 }], groups, clusterGroups, 0.5);
    expect(m).toBe(0);
  });
  it('the depth slab excludes flesh behind the cap plane', () => {
    // Wound on the +x face of the torso, inward normal -x: the limb at +0.3 is OUTSIDE the
    // surface (negative depth) so the slab keeps it; flip the normal and it sits 0.15 past a 2 cm cap.
    const w = { pos: [0.15, 0, 0] as [number, number, number], radius: 0.3, owner: 0 };
    expect(woundThreatMasks([{ ...w, cap: { n: [-1, 0, 0], depth: 0.02 } }], groups, clusterGroups, 0.02)[0]).toBe(1 << 2);
    expect(woundThreatMasks([{ ...w, cap: { n: [1, 0, 0], depth: 0.02 } }], groups, clusterGroups, 0.02)[0]).toBe(0);
  });
  it('a distorted group widens the sphere test and skips the slab', () => {
    const fat = [groups[0]!, { ...groups[1]!, distort: 10 }, groups[2]!];
    const w = { pos: [-0.15, 0, 0] as [number, number, number], radius: 0.1, owner: 0, cap: { n: [1, 0, 0] as [number, number, number], depth: 0.001 } };
    expect(woundThreatMasks([w], fat, clusterGroups, 0.02)[0]).toBe(1 << 2);
  });
  it('stays below 512 so mask / 1024 keeps a 0/1 flag readable in the same texel', () => {
    const many: [number, number][] = Array.from({ length: 8 }, () => [0, 1] as [number, number]);
    const m = woundThreatMasks([{ pos: [0, 0, 0], radius: 1, owner: 0 }], groups, many, 1)[0]!;
    expect(m).toBeLessThan(512);
    expect(1 + m / 1024 > 0.5 && m / 1024 < 0.5).toBe(true);
  });
});

describe('a cut row (flag 32): cutThreatWound', () => {
  // The owner (cluster 0) is a 0.2 m ball at the origin; a 0.1 m cut (half-length 0.05) on its +z face, inward -z,
  // along +y, 0.06 deep, sag 0.01, kerf 0.01. Cluster 1 gets one group per case.
  const owner: ThreatGroup = { center: [0, 0, 0], radius: 0.2, distort: 1 };
  const mid: Vec3 = [0, 0, 0.2], inward: Vec3 = [0, 0, -1], along: Vec3 = [0, 1, 0];
  const halfLen = 0.05, depth = 0.06, sag = 0.01, kerf = 0.01, margin = 0.005;
  const reachR = halfLen * Math.max(2, 2 * 1.15 + 3 * 0.42) + 4 * 0.015 + 0.25;   // the game's woundCfg / woundCfg2
  const cut = cutThreatWound(mid, 0, halfLen, inward, depth, sag, along, kerf, reachR);
  const maskWith = (g: ThreatGroup) => woundThreatMasks([cut], [owner, g], [[0, 1], [1, 1]], margin)[0];
  const ballField = (c: Vec3, r: number) => (p: Vec3) => Math.min(Math.hypot(p[0], p[1], p[2]) - 0.2, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r);
  it('a foreign hand straddling the lid is threatened (the slot carves it); one above the lid is neither carved nor flagged', () => {
    const lidZ = 0.2 + kerf + CUT_SHADE.lidSlack * halfLen;
    const low: ThreatGroup = { center: [0, 0, lidZ + 0.02], radius: 0.03, distort: 1 };   // its bottom 1 cm under the lid
    const inLow: Vec3 = [0, 0, lidZ - 0.008];
    expect(cutCarve(inLow, mid, halfLen, along, inward, depth, kerf, ballField(low.center as Vec3, 0.03)(inLow), sag)).toBeGreaterThan(0);
    expect(maskWith(low)).toBe(1 << 2);
    const high: ThreatGroup = { center: [0, 0, 0.35], radius: 0.03, distort: 1 };
    const inHigh: Vec3 = [0, 0, 0.35 - 0.03 + 0.002];
    expect(cutCarve(inHigh, mid, halfLen, along, inward, depth, kerf, ballField(high.center as Vec3, 0.03)(inHigh), sag)).toBeLessThan(0);
    expect(maskWith(high)).toBe(0);
  });
  it('the slab is sag + depth deep: a group just past the depth but above the floor is kept, one past the floor dropped', () => {
    const widen = (1 / CUT_SHADE.carveK - 1) * (0.01 + margin);
    const atDepth = (below: number): ThreatGroup => ({ center: [0, 0, 0.2 - below - 0.01], radius: 0.01, distort: 1 });
    expect(maskWith(atDepth(depth + 0.5 * sag))).toBe(1 << 2);
    expect(maskWith(atDepth(sag + depth + margin + widen + 0.001))).toBe(0);
  });
  it('the box: a group well beside the slot, past its tips or above the lid is dropped; a distorted one gets the corner sphere', () => {
    expect(maskWith({ center: [0.08, 0, 0.25], radius: 0.02, distort: 1 })).toBe(0);
    expect(maskWith({ center: [0, 0.12, 0.25], radius: 0.02, distort: 1 })).toBe(0);
    expect(maskWith({ center: [0, 0, 0.32], radius: 0.02, distort: 1 })).toBe(0);
    expect(maskWith({ center: [0.08, 0, 0.25], radius: 0.02, distort: 1.5 })).toBe(1 << 2);
    expect(maskWith({ center: [0, 0, 0.6], radius: 0.02, distort: 1.5 })).toBe(0);   // inside the old reach sphere
  });
  it('the corner sphere is the box, not the reach: rod at half-length 0.1 (game margin 0.125)', () => {
    const rod = cutThreatWound(mid, 0, 0.1, inward, 0.06, 0, along, 0.01, 0.1 * Math.max(2, 2 * 1.15 + 3 * 0.42) + 4 * 0.015 + 0.25);
    console.log(`rod threat sphere: reach form ${rod.radius.toFixed(4)} m, box form ${rod.slot!.boxR.toFixed(4)} m + ${rod.slot!.cornerWiden.toFixed(2)} x (group radius + margin)`);
    expect(rod.slot!.boxR).toBeLessThan(0.13);
    expect(rod.radius).toBeGreaterThan(0.6);
  });
  it('a cut row with no inward axis threatens nobody (the shader skips it)', () => {
    const dead = cutThreatWound(mid, 0, halfLen, [0, 0, 0], depth, sag, along, kerf, reachR);
    expect(woundThreatMasks([dead], [owner, { center: [0, 0, 0.21], radius: 0.05, distort: 1 }], [[0, 1], [1, 1]], 1)[0]).toBe(0);
  });
  it('the lip amplitude is kerf-sized, not half-length-sized, and clamped like the shader', () => {
    expect(cutLipAmp(kerf, 0.8)).toBeCloseTo(kerf * CUT_SHADE.lipHeight * 0.8, 12);
    expect(cutLipAmp(kerf, 0.8)).toBeLessThan(halfLen * 0.55 * 0.8);
    expect(cutLipAmp(kerf, 5)).toBeCloseTo(kerf * CUT_SHADE.lipHeight * CUT_SHADE.maxLipScale, 12);
  });
});

// NO MISSED CARVE. On the cut-wound fixtures (a torso and an arm capsule), every sample where the slot's carve is
// positive inside a foreign group is flagged: a tiny group (radius 1 mm) at each such sample, margin 0 and the game's
// ~0.125, plus random groups whose ball holds a sample where s_g(p) < carve(p) + margin (the header's win condition).
describe('cutThreatWound never misses a carve (fixtures)', () => {
  const torso = prim([0, 1.0, 0], [0, 1.5, 0], 0.15, [1, 1, 1], { limb: 'torso', cluster: 1 });
  const arm = prim([0.4, 1.0, 0], [0.4, 1.5, 0], 0.05, [1, 1, 1], { limb: 'armL', cluster: 2 });
  const prims: Primitive[] = [torso, arm];
  const body = { prims, clusters: [{ start: 0, count: 1, alive: true }, { start: 1, count: 1, alive: true }] } as unknown as Parameters<typeof sdBody>[1];
  const field = (p: Vec3) => sdBody(p, body);
  const reachF = Math.max(2, 2 * 1.15 + 3 * 0.42);
  const fixtures = (kerf: number): [string, Wound][] => {
    const cal = { ...ROD_CALIBRE, kerf };
    const t = (h: number, around: boolean) => {
      const z = Math.sqrt(0.15 * 0.15 - h * h);
      return stampCut(prims, around ? { a: [-h, 1.25, z], b: [h, 1.25, z], view: [0, 0, -1] } : { a: [0, 1.25 - h, 0.15], b: [0, 1.25 + h, 0.15], view: [0, 0, -1] }, cal, 0, field);
    };
    return [
      ['torso along 0.015', t(0.015, false)], ['torso around 0.1', t(0.1, true)], ['torso along 0.175', t(0.175, false)],
      ['arm along', stampCut(prims, { a: [0.4, 1.15, 0.05], b: [0.4, 1.35, 0.05], view: [0, 0, -1] }, cal, 0, field)],
      ['arm silhouette', stampCut(prims, { a: [0.35, 1.25, 0], b: [0.45, 1.25, 0], view: [0, 0, -1] }, cal, 0, field)],
    ];
  };
  it('flags every positive-carve sample and every random group that could win', () => {
    let positive = 0, randomWins = 0;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const kerf of [0.006, 0.01, 0.015]) {
      for (const [name, w] of fixtures(kerf)) {
        const pos = woundWorldPos(prims, w, 0), al = woundDirToWorld(prims, w, w.cutDir!, 0), inw = woundDirToWorld(prims, w, w.carveN!, 0);
        const h = w.radius;
        const tw = cutThreatWound(pos, 0, h, inw, w.carveDepth!, w.sag!, al, w.kerf!, h * reachF + 4 * 0.015 + 0.25);
        const side = [al[1] * inw[2] - al[2] * inw[1], al[2] * inw[0] - al[0] * inw[2], al[0] * inw[1] - al[1] * inw[0]];
        const at = (a: number, s: number, u: number): Vec3 => [0, 1, 2].map(i => pos[i]! + al[i]! * a + inw[i]! * s + side[i]! * u) as unknown as Vec3;
        const flagged = (g: ThreatGroup, margin: number) => woundThreatMasks([tw], [{ center: [9, 9, 9], radius: 0.01, distort: 1 }, g], [[0, 1], [1, 1]], margin)[0] === 1 << 2;
        // (1) tiny groups at positive-carve samples (dIn = the union with that group: <= -1 mm there).
        const step = Math.max(0.0015, h / 25);
        for (let a = -h - 0.01; a <= h + 0.01; a += step) {
          for (let s = -0.08; s <= w.sag! + w.carveDepth! + 0.02; s += 0.0015) {
            for (let u = -0.025; u <= 0.025; u += 0.0015) {
              const p = at(a, s, u);
              const c = cutCarve(p, pos, h, al, inw, w.carveDepth!, w.kerf!, Math.min(field(p), -0.001), w.sag!);
              if (c <= 0) continue;
              positive++;
              const g: ThreatGroup = { center: p as unknown as [number, number, number], radius: 0.001, distort: 1 };
              expect(flagged(g, 0), `${name} kerf ${kerf} at a ${a.toFixed(3)} s ${s.toFixed(3)} u ${u.toFixed(3)}`).toBe(true);
              expect(flagged(g, 0.125)).toBe(true);
            }
          }
        }
        // (2) random groups: where the limb could win, the mask must say so.
        for (let i = 0; i < 300; i++) {
          const gr = 0.005 + 0.06 * rnd(), margin = [0, 0.02, 0.125][i % 3]!;
          const c = at((rnd() * 2 - 1) * (h + 0.15), (rnd() * 2 - 1) * 0.25, (rnd() * 2 - 1) * 0.2);
          const g: ThreatGroup = { center: c as unknown as [number, number, number], radius: gr, distort: 1 };
          const gf = (p: Vec3) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - gr;
          let wins = false;
          for (let a = -h; a <= h && !wins; a += h / 10) {
            for (let s = -0.06; s <= w.sag! + w.carveDepth!; s += 0.004) {
              for (let u = -0.02; u <= 0.02; u += 0.002) {
                const p = at(a, s, u), sg = gf(p);
                if (sg < cutCarve(p, pos, h, al, inw, w.carveDepth!, w.kerf!, Math.min(field(p), sg), w.sag!) + margin) { wins = true; break; }
              }
              if (wins) break;
            }
          }
          if (wins) { randomWins++; expect(flagged(g, margin), `${name} kerf ${kerf} random group ${i}`).toBe(true); }
        }
      }
    }
    console.log(`threat no-miss: ${positive} positive-carve samples flagged, ${randomWins} winning random groups flagged`);
    expect(positive).toBeGreaterThan(1000);
    expect(randomWins).toBeGreaterThan(50);
  }, 300000);
});
