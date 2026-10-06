// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-split.test.ts
//
// The skull mesh's clip under a head split: the fracture offset, the per-instance record, and the clip's hand twin
// against the pure rule (head-split.ts skullPieceAt).
import { describe, expect, it } from 'vitest';
import {
  HEAD_SPLIT, forcedSplit, rotAxis, skullPieceAt, skullSplitOf, splitWarpOf, type HeadFrame, type SkullSplit,
} from '../../head-split';
import type { Vec3 } from '../../types';
import { qFromAxisAngle } from '../../vec';
import {
  JAG_SEED, MESH_SPLIT_CLIP_WGSL, MESH_SPLIT_INSIDE_WGSL, MESH_SPLIT_JAG_LINES, MESH_SPLIT_JAG_WGSL, SPLIT_INSTANCE_ATTRS,
  SPLIT_INSTANCE_FLOATS,
  meshSplitJag, meshSplitJagMax, meshSplitKeep, meshSplitRim, packSplitInstance, skullJagAt,
} from './mesh-split';

const hash = (i: number, lane: number): number => { const x = Math.sin(i * 127.1 + lane * 311.7) * 43758.5453; return x - Math.floor(x); };
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const JAG = HEAD_SPLIT.skull.jag;

// A turned, moved head, so nothing is axis-aligned.
const FRAME: HeadFrame = { centre: [0.4, 1.62, -0.3], quat: qFromAxisAngle([0.2, 1, 0.1], 0.8), radius: 0.137 };
const CASES: [string, SkullSplit][] = ([
  ['middle both', 'middle', 0, 0, 0.8], ['middle +', 'middle', 1, 0.04, 1], ['middle -', 'middle', -1, -0.04, 0.55],
  ['face', 'face', 1, 0, 1],
] as const).map(([name, preset, sides, offset, frac]) =>
  [name, skullSplitOf(splitWarpOf(forcedSplit(preset, sides, offset, frac)!, FRAME), null, 3)!]);

describe('meshSplitJag: the fracture\'s offset from the old plane', () => {
  it('stays within zigAmp + chipAmp, uses most of it, and is 0 with both amplitudes 0', () => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const v = meshSplitJag((hash(i, 1) - 0.5) * 0.4, hash(i, 2) * 0.25, i % 7);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    const max = meshSplitJagMax();
    expect(max).toBeCloseTo(JAG.zigAmp + JAG.chipAmp, 12);
    expect(hi).toBeLessThanOrEqual(max + 1e-12);
    expect(lo).toBeGreaterThanOrEqual(-max - 1e-12);
    expect(hi).toBeGreaterThan(0.7 * max);
    expect(lo).toBeLessThan(-0.7 * max);
    expect(meshSplitJag(0.03, 0.11, 2, { ...JAG, zigAmp: 0, chipAmp: 0 })).toBe(0);
    expect(meshSplitJagMax({ ...JAG, zigAmp: 0, chipAmp: 0 })).toBe(0);
  });
  it('a coarse zig-zag: it swings across the plane within a couple of zigLen along the break, whichever way the break runs', () => {
    const zigOnly = { ...JAG, chipAmp: 0 };
    for (const dir of [[1, 0], [0, 1], [0.7, 0.7]] as const) {
      let flips = 0, prev = 0;
      for (let i = 0; i <= 400; i++) {
        const t = i / 400 * 0.2;
        const v = meshSplitJag(0.01 + dir[0] * t, 0.02 + dir[1] * t, 1, zigOnly);
        if (prev !== 0 && Math.sign(v) !== Math.sign(prev)) flips++;
        if (v !== 0) prev = v;
      }
      // 0.2 m of break at a 22 mm period: about 18 crossings on an even saw; the wobble moves them.
      expect(flips, `${dir}`).toBeGreaterThan(6);
      expect(flips, `${dir}`).toBeLessThan(40);
    }
  });
  it('fine chips: constant inside a chipLen cell, stepping between cells', () => {
    const chipOnly = { ...JAG, zigAmp: 0 };
    const cell = JAG.chipLen;
    const a = meshSplitJag(cell * 3.1, cell * 5.2, 0, chipOnly), b = meshSplitJag(cell * 3.9, cell * 5.8, 0, chipOnly);
    expect(a).toBe(b);
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) seen.add(meshSplitJag(cell * (i + 0.5), cell * 0.5, 0, chipOnly));
    expect(seen.size).toBeGreaterThan(8);
  });
  it('the wobble\'s four are the twin\'s dials: each one moves the edge, and no wobble is an even saw', () => {
    const zigOnly = { ...JAG, chipAmp: 0 };
    const sample = (j: typeof zigOnly) => Array.from({ length: 64 }, (_, i) => meshSplitJag(0.004 * i, 0.03 + 0.003 * i, 2, j));
    const base = sample(zigOnly);
    for (const k of ['wobble', 'wobbleAlong', 'wobbleUp', 'upFreq'] as const) {
      const moved = sample({ ...zigOnly, [k]: zigOnly[k] * 1.5 });
      expect(moved.some((v, i) => Math.abs(v - base[i]!) > 1e-4), k).toBe(true);
    }
    // No wobble: along the axis alone the edge is the plain triangle wave, period zigLen.
    const even = { ...zigOnly, wobbleAlong: 0, wobbleUp: 0 };
    for (const x of [0.011, 0.047, 0.09]) expect(meshSplitJag(x + JAG.zigLen, 0.05, 1, even)).toBeCloseTo(meshSplitJag(x, 0.05, 1, even), 12);
  });
  it('the seed moves the pattern: two heads do not break alike', () => {
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      const al = (hash(i, 3) - 0.5) * 0.3, up = hash(i, 4) * 0.2;
      if (Math.abs(meshSplitJag(al, up, 1) - meshSplitJag(al, up, 2)) > 1e-4) differ++;
    }
    expect(differ).toBeGreaterThan(150);
  });
  it('skullJagAt reads it in the split\'s own frame (along the hinge axis, up from the hinge), so it rides the head', () => {
    const [, s] = CASES[0]!;
    const { w, u } = s.frame;
    const q = add(add(w.h, [w.a[0] * 0.05, w.a[1] * 0.05, w.a[2] * 0.05]), [u[0] * 0.12, u[1] * 0.12, u[2] * 0.12]);
    expect(skullJagAt(s, q)).toBeCloseTo(meshSplitJag(0.05, 0.12, s.seed), 12);
    // Off the plane along n: the same offset (the fracture is a sheet over the plane).
    expect(skullJagAt(s, add(q, [w.n[0] * 0.03, w.n[1] * 0.03, w.n[2] * 0.03]))).toBeCloseTo(skullJagAt(s, q), 12);
  });
});

describe('the WGSL: one function per string, scalars and vectors only', () => {
  it('the jag and the clip are the twins\' formulas', () => {
    expect(MESH_SPLIT_JAG_WGSL).toContain('fn meshSplitJag(c: vec2<f32>, seed: f32, jag: vec4<f32>, shape: vec4<f32>) -> f32');
    // Every body line is in the string, and the seed's numbers in them are JAG_SEED's (the twin reads the same table).
    for (const line of MESH_SPLIT_JAG_LINES) expect(MESH_SPLIT_JAG_WGSL).toContain(`\n  ${line}`);
    expect(MESH_SPLIT_JAG_LINES).toEqual([
      'let z = c / max(jag.y, 1e-5);',
      `let wob = boneNoise(vec3<f32>(z * shape.x, seed * ${JAG_SEED.noise})) - 0.5;`,
      `let t1 = abs(fract(z.x + seed * ${JAG_SEED.along} + wob * shape.y) - 0.5) * 4.0 - 1.0;`,
      `let t2 = abs(fract(z.y * shape.w + seed * ${JAG_SEED.up} + ${JAG_SEED.upPhase} - wob * shape.z) - 0.5) * 4.0 - 1.0;`,
      'let zig = 0.5 * (t1 + t2);',
      `let chip = boneHash(vec3<f32>(floor(c / max(jag.w, 1e-5)), seed + ${JAG_SEED.chip}.0)) * 2.0 - 1.0;`,
      'return jag.x * zig + jag.z * chip;',
    ]);
    expect(MESH_SPLIT_JAG_WGSL).not.toMatch(/\$\{|undefined|NaN/);
    expect(MESH_SPLIT_CLIP_WGSL).toContain('fn meshSplitClip(pWorld: vec3<f32>, sn: vec4<f32>, sh: vec4<f32>, sa: vec4<f32>, sk: vec4<f32>, jag: vec4<f32>, shape: vec4<f32>) -> vec4<f32>');
    // The clip tests the UN-TURNED point, and both halves read the fracture there.
    expect(MESH_SPLIT_CLIP_WGSL).toContain('let q = sh.xyz + rel * c - cross(sa.xyz, rel) * s + sa.xyz * (dot(sa.xyz, rel) * (1.0 - c));');
    expect(MESH_SPLIT_CLIP_WGSL).toContain('meshSplitJag(vec2<f32>(dot(sa.xyz, r), up), sk.w, jag, shape)');
    expect(MESH_SPLIT_CLIP_WGSL).toContain('return vec4<f32>(q, keep);');
    expect(MESH_SPLIT_INSIDE_WGSL).toContain('let edge = clamp((rim.w - keep) / max(rim.w, 1e-6) * 2.0, 0.0, 1.0);');
    expect(MESH_SPLIT_INSIDE_WGSL).toContain('return select(vec4<f32>(mix(inside, rim.xyz, edge), edge), surface, front > 0.5);');
    for (const src of [MESH_SPLIT_JAG_WGSL, MESH_SPLIT_CLIP_WGSL, MESH_SPLIT_INSIDE_WGSL]) {
      expect(src.match(/\bfn /g)).toHaveLength(1);
      expect(src).not.toMatch(/array<|\[|\bvar<|\bloop\b|\bfor\b/);
    }
  });
});

describe('meshSplitRim: the inner wall is cut bone near the break', () => {
  it('full to half the width, gone at the width, and nothing at all with width 0', () => {
    const w = HEAD_SPLIT.skull.rim.width;
    expect(w).toBeGreaterThan(0);
    expect(meshSplitRim(0)).toBe(1);
    expect(meshSplitRim(w / 2)).toBe(1);
    expect(meshSplitRim(w * 0.75)).toBeCloseTo(0.5, 12);
    expect(meshSplitRim(w)).toBe(0);
    expect(meshSplitRim(0.05)).toBe(0);
    expect(meshSplitRim(1e-4, 0)).toBe(0);
  });
});

describe('packSplitInstance: the four per-instance vec4s, one row of 16 floats', () => {
  it('N = (n, d0), H = (h, this piece\'s bone angle), A = (a, rho), K = (piece, + turns, - turns, seed)', () => {
    expect(SPLIT_INSTANCE_ATTRS).toEqual(['iSplitN', 'iSplitH', 'iSplitA', 'iSplitK']);
    expect(SPLIT_INSTANCE_FLOATS).toBe(4 * SPLIT_INSTANCE_ATTRS.length);
    const [, s] = CASES[0]!, w = s.frame.w;
    const rows = new Float32Array(3 * 16);
    packSplitInstance(rows, 2, s, 2);
    const f = (v: number) => Math.fround(v);
    expect(Array.from(rows.subarray(32))).toEqual([...w.n, w.d0, ...w.h, s.angleM, ...w.a, s.frame.rho, 2, 1, 1, 3].map(f));
    expect(Array.from(rows.subarray(0, 32))).toEqual(new Array(32).fill(0));
    packSplitInstance(rows, 0, s, 1);
    expect(rows[7]).toBe(f(s.angleP));
    expect(rows[12]).toBe(1);
    packSplitInstance(rows, 1, CASES[1]![1], 0);   // one side: the rest does not turn, the - side is its own
    expect(rows[16 + 7]).toBe(0);
    expect(Array.from(rows.subarray(16 + 12, 32))).toEqual([0, 1, 0, 3]);
  });
});

describe('meshSplitKeep, the clip\'s hand twin: each copy keeps exactly what its piece owns', () => {
  for (const [name, s] of CASES) {
    it(`${name}: a bone point is kept by the copy of its own piece, at its turned place, and by no other`, () => {
      const { w } = s.frame;
      const seen = [0, 0, 0];
      for (let i = 0; i < 3000; i++) {
        const q: Vec3 = add(FRAME.centre, [(hash(i, 5) - 0.5) * 0.4, (hash(i, 6) - 0.45) * 0.45, (hash(i, 7) - 0.5) * 0.4]);
        const owner = skullPieceAt(s, q, skullJagAt(s, q));
        seen[owner]!++;
        for (const piece of [0, 1, 2] as const) {
          const angle = piece === 1 ? s.angleP : piece === 2 ? s.angleM : 0;
          if (piece !== 0 && angle === 0) continue;   // no such copy is drawn
          // Where this copy draws the point: turned by its piece's angle about the hinge.
          const p = add(w.h, rotAxis(sub(q, w.h), w.a, angle));
          const kept = meshSplitKeep(p, { w, rho: s.frame.rho, angle, piece, turnP: s.angleP !== 0, turnM: s.angleM !== 0, seed: s.seed });
          expect(len(sub(kept.q, q))).toBeLessThan(1e-12);
          if (Math.abs(kept.keep) < 1e-9) continue;   // on an edge
          expect(kept.keep > 0, `${name} point ${i} piece ${piece} owner ${owner}`).toBe(piece === owner);
        }
      }
      expect(seen[0]!).toBeGreaterThan(100);
      expect(seen[1]! + seen[2]!).toBeGreaterThan(100);
    });
  }
  it('keep is the distance to the copy\'s nearest edge on a clean plane (what a rim would read)', () => {
    const [, s] = CASES[0]!, { w, u } = s.frame;
    const clean = { ...JAG, zigAmp: 0, chipAmp: 0 };
    const q = add(add(w.h, [u[0] * 0.1, u[1] * 0.1, u[2] * 0.1]), [w.n[0] * 0.007, w.n[1] * 0.007, w.n[2] * 0.007]);
    const p = add(w.h, rotAxis(sub(q, w.h), w.a, s.angleP));
    expect(meshSplitKeep(p, { w, rho: s.frame.rho, angle: s.angleP, piece: 1, turnP: true, turnM: true, seed: 0 }, clean).keep).toBeCloseTo(0.007, 9);
  });
});
