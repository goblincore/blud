// src/lab/sdf-zombie/webgpu/humanoid.wgsl.test.ts
//
// Nothing in this repo compiles WGSL, so — exactly like march.wgsl.test.ts —
// these tests guard the two things that CAN be checked from text (the wgslFn
// parse contract and the reserved-word list that already cost a blank page)
// plus a CPU mirror that proves the bone-fold maths means what the strings
// claim. The mirror is the only automatic check on the field: a drift between
// it and the WGSL puts click-to-shoot (Task 10) and the visual gate out of
// step with each other.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  HUMANOID_HELPERS, MARCH_HUMANOID,
  HUMANOID_DATA_ROWS,
  ROW_POSE_POS, ROW_POSE_QUAT, ROW_BRICK_OFFSET, ROW_BRICK_DIMS,
  ROW_BOUNDS_MIN, ROW_BOUNDS_INV, ROW_JOINT, ROW_JOINT_AXIS,
  HUMANOID_MAX_CLUSTER_BONES, HUMANOID_JOINT_SMIN_K, HUMANOID_SURFACE_WARP_AMP,
  HUMANOID_CUT_SEED, HUMANOID_CUT_IRREGULARITY_M,
  HUMANOID_CUT_RIM_WIDTH_M, HUMANOID_CAP_DEPTH_M,
} from './humanoid.wgsl';
import { validateHumanoidVolumeManifest } from './humanoid-volume';
import type { Vec3 } from '../types';
import { sub, dot } from '../vec';

/** `fn name(` — the shape three's ^-anchored declarationRegexp needs. */
function declaredName(src: string): string | null {
  return /^fn\s+([a-z_0-9]+)\s*\(/i.exec(src)?.[1] ?? null;
}

const ALL = [...HUMANOID_HELPERS, MARCH_HUMANOID];

describe('wgslFn parse contract', () => {
  it('starts every source with fn, since three anchors its parse to ^', () => {
    for (const src of ALL) expect(declaredName(src)).not.toBeNull();
  });

  it('orders HUMANOID_HELPERS so each only calls the ones before it', () => {
    const names = HUMANOID_HELPERS.map(declaredName);
    const seen = new Set<string>();
    HUMANOID_HELPERS.forEach((src, i) => {
      const self = names[i]!;
      const body = src.slice(src.indexOf('{'));
      for (const other of names) {
        if (other === null || other === self || seen.has(other)) continue;
        expect(
          new RegExp(`\\b${other}\\s*\\(`).test(body),
          `${self} calls ${other}, which is declared after it`,
        ).toBe(false);
      }
      seen.add(self);
    });
  });

  it('declares no helper twice', () => {
    const names = HUMANOID_HELPERS.map(declaredName);
    expect(new Set(names).size).toBe(names.length);
  });
});

// The list that cost a blank page (same as march.wgsl.test.ts): WGSL reserves
// ordinary-looking identifiers GLSL is happy with.
const RESERVED_WORDS = [
  'active', 'as', 'auto', 'binding_array', 'cast', 'class', 'common', 'compile',
  'demote', 'do', 'enum', 'explicit', 'export', 'extern', 'external', 'filter',
  'final', 'from', 'get', 'impl', 'import', 'inline', 'interface', 'layout',
  'match', 'meta', 'mod', 'module', 'move', 'mut', 'new', 'nil', 'null', 'of',
  'operator', 'package', 'partition', 'pass', 'precise', 'precision', 'priv',
  'protected', 'pub', 'public', 'readonly', 'ref', 'register', 'resource',
  'restrict', 'self', 'set', 'shared', 'sizeof', 'smooth', 'snorm', 'static',
  'std', 'super', 'target', 'template', 'this', 'throw', 'try', 'type',
  'typedef', 'typeof', 'union', 'unorm', 'use', 'using', 'varying', 'virtual',
  'volatile', 'where', 'while', 'write', 'writeonly', 'yield',
];

describe('no WGSL reserved words as identifiers', () => {
  it.each(ALL.map(src => [declaredName(src) ?? '(unnamed)', src] as const))(
    '%s declares nothing reserved', (_name, src) => {
      const declared = [
        ...src.matchAll(/\b(?:let|var)\s+([a-z_][a-z_0-9]*)/gi),
        ...src.matchAll(/[(,]\s*([a-z_][a-z_0-9]*)\s*:/gi),
      ].map(m => m[1]!);
      const clashes = declared.filter(d => RESERVED_WORDS.includes(d));
      expect(clashes).toEqual([]);
    },
  );
});

describe('the six bone-field helpers are wired', () => {
  it('shades and cuts through the entry, samples and folds through its helpers', () => {
    // The entry shades/cuts directly; the fold (mapHumanoidField), the cut
    // wrapper (mapHumanoidCut) and the colour helper (sampleBoneColor) carry
    // the distance/warp/blend/colour leaves. This mirrors march.wgsl.test.ts,
    // which checks applyCarves on mapBody rather than MARCH_BODY.
    expect(MARCH_HUMANOID).toContain('mapHumanoidField');
    expect(MARCH_HUMANOID).toContain('mapHumanoidCut');
    expect(MARCH_HUMANOID).toContain('sampleBoneColor');
    expect(MARCH_HUMANOID).toContain('capDepth');
    expect(MARCH_HUMANOID).toContain('tornCapMaterial');

    const fold = HUMANOID_HELPERS.find(h => declaredName(h) === 'mapHumanoidField')!;
    expect(fold).toContain('sampleDistanceBrick');
    expect(fold).toContain('surfaceWarp');
    expect(fold).toContain('jointBlendWeight');

    const cut = HUMANOID_HELPERS.find(h => declaredName(h) === 'mapHumanoidCut')!;
    expect(cut).toContain('mapHumanoidField');
    expect(cut).toContain('cutField');

    const color = HUMANOID_HELPERS.find(h => declaredName(h) === 'sampleBoneColor')!;
    expect(color).toContain('sampleColorBrick');
  });

  it('every helper is transitively referenced by the entry', () => {
    const names = HUMANOID_HELPERS.map(declaredName);
    const index = new Map(names.map((n, i) => [n, i]));
    // Build the call graph: for each helper, which other helpers it calls.
    const calls = new Map<string, Set<string>>();
    HUMANOID_HELPERS.forEach((src, i) => {
      const self = names[i]!;
      const body = src.slice(src.indexOf('{'));
      const out = new Set<string>();
      for (const other of names) {
        if (other === null || other === self) continue;
        if (new RegExp(`\\b${other}\\s*\\(`).test(body)) out.add(other);
      }
      calls.set(self, out);
    });
    // What the entry itself calls.
    const roots = new Set<string>();
    const entryBody = MARCH_HUMANOID.slice(MARCH_HUMANOID.indexOf('{'));
    for (const other of names) {
      if (other !== null && new RegExp(`\\b${other}\\s*\\(`).test(entryBody)) roots.add(other);
    }
    // BFS reachability.
    const reach = new Set<string>(roots);
    const queue = [...roots];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of calls.get(cur) ?? []) {
        if (!reach.has(next)) { reach.add(next); queue.push(next); }
      }
    }
    for (const name of names) {
      expect(reach.has(name!), `helper ${name} is not reachable from MARCH_HUMANOID`).toBe(true);
    }
  });
});

describe('data texture layout', () => {
  it('gives every row a distinct index inside HUMANOID_DATA_ROWS', () => {
    const rows = [
      ROW_POSE_POS, ROW_POSE_QUAT, ROW_BRICK_OFFSET, ROW_BRICK_DIMS,
      ROW_BOUNDS_MIN, ROW_BOUNDS_INV, ROW_JOINT, ROW_JOINT_AXIS,
    ];
    expect(new Set(rows).size).toBe(rows.length);
    expect(Math.max(...rows)).toBe(HUMANOID_DATA_ROWS - 1);
  });
});

describe('distance/colour brick sampling (string pins)', () => {
  const fold = HUMANOID_HELPERS.find(h => declaredName(h) === 'mapHumanoidField')!;

  it('reads exactly eight 3D texels per brick, on the endpoint-inclusive lattice', () => {
    const dist = HUMANOID_HELPERS.find(h => declaredName(h) === 'sampleDistanceBrick')!;
    expect((dist.match(/textureLoad\(distAtlas/g) ?? []).length).toBe(8);
    expect(dist).toContain('offset + clamp(uv, vec3<f32>(0.0), vec3<f32>(1.0)) * (dims - vec3<f32>(1.0, 1.0, 1.0))');
    // Degenerate top corner: i1 clamps back onto the last texel.
    expect(dist).toContain('min(i0 + vec3<i32>(1, 1, 1), vec3<i32>(floor(hi)))');
    expect(dist).not.toContain('- 0.5)');
  });

  it('transforms world to local with the conjugate of the posed quaternion', () => {
    expect(fold).toContain('rotateConj(quat, p - posePos.xyz)');
    const rc = HUMANOID_HELPERS.find(h => declaredName(h) === 'rotateConj')!;
    expect(rc).toContain('vec4<f32>(-q.xyz, q.w)');
  });

  it('adds the true metric distance to the AABB outside the brick', () => {
    expect(fold).toContain('let diffMin = bmin.xyz - local;');
    expect(fold).toContain('let diffMax = local - (bmin.xyz + extent);');
    expect(fold).toContain('let outside = length(max(max(diffMin, diffMax), vec3<f32>(0.0)));');
    expect(fold).toContain('let sdd = sd + sw + outside;');
  });

  it('gates the surface warp to a four-amplitude shell and zeroes it at softness 0', () => {
    const warp = HUMANOID_HELPERS.find(h => declaredName(h) === 'surfaceWarp')!;
    expect(warp).toContain(`let amp = softness01 * ${HUMANOID_SURFACE_WARP_AMP};`);
    expect(warp).toContain('amp <= 0.0 || abs(baseD) >= amp * 4.0');
  });

  it('folds with hard min outside the band and smin gated by jointBlendWeight', () => {
    expect(fold).toContain('let bandW = jointBlendWeight(childLocal, jnt.xyz, jax.xyz, jnt.w);');
    expect(fold).toContain(`let kBand = ${HUMANOID_JOINT_SMIN_K} * bandW;`);
    expect(fold).toContain('d = smin(best, second, kBand);');
    // Adjacent slots only — the two dominant bones must be a parent/child pair.
    expect(fold).toContain('abs(f32(bestSlot) - f32(secondSlot)) == 1.0');
  });
});

// ============================== CPU MIRROR ==================================
// Hand transcription of the WGSL maths (kept in sync BY HAND, like
// march.wgsl.test.ts's sdPrimWgsl). These prove the fold semantics: hard-min
// outside a declared band, conservative smooth-min inside it, colour weights
// identical to the distance weights, complementary cut masks, and a finite
// outside-atlas distance.

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const sminMirror = (a: number, b: number, kIn: number): number => {
  const k = kIn * 4;
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const jointBlendMirror = (
  local: Vec3, center: Vec3, axis: Vec3, halfWidth: number,
): number => {
  if (halfWidth <= 0) return 0;
  const s = Math.abs(dot(axis, sub(local, center)));
  return 1 - smoothstep(halfWidth * 0.5, halfWidth, s);
};
const outsideBoxMirror = (local: Vec3, boundsMin: Vec3, invExtent: Vec3): number => {
  const extent: Vec3 = [1 / invExtent[0], 1 / invExtent[1], 1 / invExtent[2]];
  const m: Vec3 = [
    Math.max(Math.max(boundsMin[0] - local[0], local[0] - (boundsMin[0] + extent[0])), 0),
    Math.max(Math.max(boundsMin[1] - local[1], local[1] - (boundsMin[1] + extent[1])), 0),
    Math.max(Math.max(boundsMin[2] - local[2], local[2] - (boundsMin[2] + extent[2])), 0),
  ];
  return Math.hypot(m[0], m[1], m[2]);
};
const cutFieldMirror = (bodyD: number, planeD: number, cutMode: number): number => {
  if (cutMode < 0.5) return bodyD;
  const q = planeD;
  if (cutMode < 1.5) return Math.max(bodyD, q);
  return Math.max(bodyD, -q);
};
const lerp3 = (a: readonly number[], b: readonly number[], t: number): number[] =>
  [0, 1, 2].map(i => a[i]! + (b[i]! - a[i]!) * t);

interface MirrorBone { center: Vec3; radius: number; color: readonly [number, number, number]; }
interface MirrorJoint { center: Vec3; axis: Vec3; halfWidth: number; }

/** Two-bone fold with identity transforms (bind-local == world) — the exact
 *  reduce logic mapHumanoidField runs for a parent/child pair. */
function foldTwo(
  p: Vec3, a: MirrorBone, b: MirrorBone, j: MirrorJoint,
): { d: number; blendW: number; color: number[]; dA: number; dB: number } {
  const dA = Math.hypot(p[0] - a.center[0], p[1] - a.center[1], p[2] - a.center[2]) - a.radius;
  const dB = Math.hypot(p[0] - b.center[0], p[1] - b.center[1], p[2] - b.center[2]) - b.radius;
  const [best, second, cBest, cSecond] = dA <= dB
    ? [dA, dB, a.color, b.color]
    : [dB, dA, b.color, a.color];
  const bandW = jointBlendMirror(p, j.center, j.axis, j.halfWidth);
  const kBand = HUMANOID_JOINT_SMIN_K * bandW;
  const gap = second - best;
  const proximity = clamp(1 - gap / Math.max(kBand * 4, 1e-5), 0, 1);
  const blendW = bandW * proximity * 0.5;
  const d = sminMirror(best, second, kBand);
  const color = lerp3(cBest, cSecond, blendW);
  return { d, blendW, color, dA, dB };
}

describe('CPU field mirror — the bone fold', () => {
  // Two overlapping unit spheres a full radius apart along +y; the joint band
  // sits at their midpoint with a 15 mm half-width (the 30 mm overlap).
  const boneA: MirrorBone = { center: [0, 0, 0], radius: 0.1, color: [1, 0, 0] };
  const boneB: MirrorBone = { center: [0, 0.1, 0], radius: 0.1, color: [0, 0, 1] };
  const joint: MirrorJoint = { center: [0, 0.05, 0], axis: [0, 1, 0], halfWidth: 0.015 };

  it('hard-mins outside the declared band', () => {
    // A point on bone A's near surface, 0.12 m off the band centre — the band
    // weight is 0, so the fold is the plain union (min).
    const p: Vec3 = [0, -0.08, 0];
    const r = foldTwo(p, boneA, boneB, joint);
    expect(r.blendW).toBe(0);
    expect(r.d).toBeCloseTo(Math.min(r.dA, r.dB), 9);
    // Colour follows the hard-min winner (red bone A).
    expect(r.color[0]).toBeCloseTo(1, 6);
    expect(r.color[2]).toBeCloseTo(0, 6);
  });

  it('smooth-mins conservatively inside the band', () => {
    // Midpoint between the two spheres, inside the band: dA == dB == -0.05.
    const p: Vec3 = [0, 0.05, 0];
    const r = foldTwo(p, boneA, boneB, joint);
    // Conservative: smin never exceeds the plain min.
    expect(r.d).toBeLessThan(Math.min(r.dA, r.dB) - 1e-4);
    // ...and never punches a hole: it stays a bounded displacement below the min.
    expect(r.d).toBeGreaterThanOrEqual(Math.min(r.dA, r.dB) - HUMANOID_JOINT_SMIN_K - 1e-9);
    // At equal distances the proximity is 1 and the weight is exactly 0.5.
    expect(r.blendW).toBeCloseTo(0.5, 6);
  });

  it('blends colour with the identical joint/proximity weight', () => {
    // Inside the band, where dA == dB, colour is the 50/50 midpoint.
    const mid = foldTwo([0, 0.05, 0], boneA, boneB, joint);
    expect(mid.color[0]).toBeCloseTo(0.5, 6);
    expect(mid.color[2]).toBeCloseTo(0.5, 6);
    // Outside the band the colour is exactly the hard-min winner.
    const far = foldTwo([0, -0.08, 0], boneA, boneB, joint);
    expect(far.color[0]).toBeCloseTo(1, 6);
    expect(far.color[2]).toBeCloseTo(0, 6);
  });
});

describe('CPU field mirror — the cut mask', () => {
  it('produces complementary proximal/distal masks across a plane', () => {
    // A body point 0.03 m deep inside the flesh. On the DISTAL side of the
    // plane (q > 0) the proximal mask culls it and the distal mask keeps it.
    const bodyD = -0.03;
    expect(cutFieldMirror(bodyD, 0.02, 1)).toBeGreaterThan(0);   // proximal culls
    expect(cutFieldMirror(bodyD, 0.02, 2)).toBeLessThan(0);      // distal keeps
    // On the PROXIMAL side (q < 0) it is the other way around.
    expect(cutFieldMirror(bodyD, -0.02, 1)).toBeLessThan(0);     // proximal keeps
    expect(cutFieldMirror(bodyD, -0.02, 2)).toBeGreaterThan(0);  // distal culls
    // Identity when cutMode 0.
    expect(cutFieldMirror(bodyD, 0.02, 0)).toBeCloseTo(bodyD, 9);
    // A kept point is clipped to the plane, never deeper: the cap sits at q.
    expect(cutFieldMirror(bodyD, 0.02, 2)).toBeCloseTo(-0.02, 9);
  });
});

describe('CPU field mirror — outside-atlas distance', () => {
  it('is finite and grows outside the brick bounds', () => {
    const boundsMin: Vec3 = [0, 0, 0];
    const invExtent: Vec3 = [1 / 0.2, 1 / 0.2, 1 / 0.2];
    // Inside the box: zero.
    expect(outsideBoxMirror([0.1, 0.1, 0.1], boundsMin, invExtent)).toBe(0);
    // Outside: finite, and the true metric distance to the box face.
    const d = outsideBoxMirror([0.4, 0.1, 0.1], boundsMin, invExtent);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(0.2, 6);
    // Far outside stays finite and keeps growing (no slab extrusion to infinity
    // — it grows linearly with distance from the box).
    const far = outsideBoxMirror([2.0, 0.1, 0.1], boundsMin, invExtent);
    expect(Number.isFinite(far)).toBe(true);
    expect(far).toBeCloseTo(1.8, 6);
  });
});

// ========================== CUT + CAP MIRROR ================================
// Task 6 — the complementary irregular cut and the layered cap ramp. The
// noise mirrors (hash13/noise3) transcribe the WGSL VALUE noise so the CPU
// mirror and the shader share one definition of `q = planeD + cutNoise *
// irregularityM`; the complementary-occupancy property they prove does not
// depend on the exact noise value, only that BOTH signs read the same q.

const frac = (x: number): number => x - Math.floor(x);
const hash13Mirror = (p: Vec3): number => {
  let px = frac(p[0] * 0.1031);
  let py = frac(p[1] * 0.1031);
  let pz = frac(p[2] * 0.1031);
  const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += d; py += d; pz += d;
  return frac((px + py) * pz);
};
const noise3Mirror = (p: Vec3): number => {
  const ix = Math.floor(p[0]), iy = Math.floor(p[1]), iz = Math.floor(p[2]);
  let fx = frac(p[0]), fy = frac(p[1]), fz = frac(p[2]);
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const h = (dx: number, dy: number, dz: number) => hash13Mirror([ix + dx, iy + dy, iz + dz]);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const n = mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), fx), mix(h(0, 1, 0), h(1, 1, 0), fx), fy),
    mix(mix(h(0, 0, 1), h(1, 0, 1), fx), mix(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz);
  return n * 2 - 1;
};
const cutNoiseMirror = (local: Vec3, seed: number): number =>
  noise3Mirror([local[0] * 90 + seed, local[1] * 90 + seed * 1.7, local[2] * 90 + seed * 2.3]);

/** One shared q drives both signs, exactly as cutField does in WGSL. */
const cutFieldMirrorFull = (
  bodyD: number, local: Vec3,
  plane: readonly [number, number, number, number],
  cutMode: number, seed: number, irregularityM: number,
): number => {
  if (cutMode < 0.5) return bodyD;
  const planeD = plane[0] * local[0] + plane[1] * local[1] + plane[2] * local[2] + plane[3];
  const jagged = cutNoiseMirror(local, seed) * irregularityM;
  const q = planeD + jagged;
  if (cutMode < 1.5) return Math.max(bodyD, q);
  return Math.max(bodyD, -q);
};

describe('complementary cut and cap (source pins)', () => {
  it('shares one cutNoise across both cut signs and pins the manifest seed', () => {
    const noise = HUMANOID_HELPERS.find(h => declaredName(h) === 'cutNoise')!;
    const cut = HUMANOID_HELPERS.find(h => declaredName(h) === 'cutField')!;
    const mapCut = HUMANOID_HELPERS.find(h => declaredName(h) === 'mapHumanoidCut')!;
    expect(noise).toBeDefined();
    // cutField references cutNoise EXACTLY once — one q, complementary signs.
    expect((cut.match(/cutNoise\s*\(/g) ?? []).length).toBe(1);
    expect(cut).toContain('max(bodyD, q)');
    expect(cut).toContain('max(bodyD, -q)');
    // The manifest seed + irregularity are pinned where the cut is invoked.
    expect(mapCut).toContain(`${HUMANOID_CUT_SEED}`);
    expect(mapCut).toContain(`${HUMANOID_CUT_IRREGULARITY_M}`);
  });

  it('shades the cap through explicit skin/rim/meat/deep bands', () => {
    const cap = HUMANOID_HELPERS.find(h => declaredName(h) === 'tornCapMaterial')!;
    expect(cap).toContain('meatColor');
    expect(cap).toContain('deepColor');
    expect(cap).toContain('rimRatio');
    expect(cap).toContain(`${HUMANOID_CUT_RIM_WIDTH_M}`);
    expect(cap).toContain(`${HUMANOID_CAP_DEPTH_M}`);
    // skin (albedo) -> meat -> deep, via two smoothstep bands.
    expect((cap.match(/smoothstep\(/g) ?? []).length).toBe(2);
  });
});

describe('CPU field mirror — complementary cut occupancy', () => {
  const realManifest = validateHumanoidVolumeManifest(JSON.parse(
    readFileSync('public/assets/lab/humanoid-sdf/zombie-humanoid.json', 'utf8'),
  ));
  // The EXACT manifest plane and seed — the test may not invent replacements.
  const [nx, ny, nz, w] = realManifest.rightArm.cutPlaneLocal;
  const plane: readonly [number, number, number, number] = [nx, ny, nz, w];
  const seed = realManifest.rightArm.cutSeed;
  const irregularityM = realManifest.rightArm.irregularityM;

  // A synthetic body centred ON the plane so the cut genuinely bisects it.
  const cx = -w * nx, cy = -w * ny, cz = -w * nz;
  const bodyD = (p: Vec3): number =>
    Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) - 0.05;

  it('covers intact occupancy exactly outside a <=2-voxel analytic rim', () => {
    const rimTolerance = 2 * 0.006; // two limb voxels
    let checked = 0, proxCount = 0, distCount = 0;
    const step = 0.006;
    for (let x = cx - 0.085; x <= cx + 0.085; x += step) {
      for (let y = cy - 0.085; y <= cy + 0.085; y += step) {
        for (let z = cz - 0.085; z <= cz + 0.085; z += step) {
          const p: Vec3 = [x, y, z];
          const bd = bodyD(p);
          const intact = bd < 0;
          const proxOcc = cutFieldMirrorFull(bd, p, plane, 1, seed, irregularityM) < 0;
          const distOcc = cutFieldMirrorFull(bd, p, plane, 2, seed, irregularityM) < 0;
          // Complementary masks never both claim a point.
          expect(proxOcc && distOcc).toBe(false);
          const planeD = nx * x + ny * y + nz * z + w;
          const q = planeD + cutNoiseMirror(p, seed) * irregularityM;
          if (Math.abs(q) > rimTolerance) {
            expect(proxOcc || distOcc, `union mismatch at ${p} (q=${q})`).toBe(intact);
            checked++;
          }
          if (proxOcc) proxCount++;
          if (distOcc) distCount++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // The plane genuinely bisects the body: both sides of the cut are occupied.
    expect(proxCount).toBeGreaterThan(100);
    expect(distCount).toBeGreaterThan(100);
  });

  it('applies the same q to both signs, so the two cut contours coincide', () => {
    // A point just inside the flesh on the distal side is kept by the distal
    // mask and culled by the proximal mask, and vice versa — the contours are
    // the SAME q zero-set, never two independent noises.
    const onPlane: Vec3 = [cx, cy, cz];
    const distalPoint: Vec3 = [cx + 0.02 * nx, cy + 0.02 * ny, cz + 0.02 * nz];
    const proxPoint: Vec3 = [cx - 0.02 * nx, cy - 0.02 * ny, cz - 0.02 * nz];
    const bdDistal = bodyD(distalPoint); // inside flesh
    expect(bdDistal).toBeLessThan(0);
    expect(cutFieldMirrorFull(bdDistal, distalPoint, plane, 1, seed, irregularityM)).toBeGreaterThan(0);
    expect(cutFieldMirrorFull(bdDistal, distalPoint, plane, 2, seed, irregularityM)).toBeLessThan(0);
    const bdProx = bodyD(proxPoint);
    expect(cutFieldMirrorFull(bdProx, proxPoint, plane, 1, seed, irregularityM)).toBeLessThan(0);
    expect(cutFieldMirrorFull(bdProx, proxPoint, plane, 2, seed, irregularityM)).toBeGreaterThan(0);
    // On the plane itself both masks read the same (zero-ish) q.
    const qBoth = cutFieldMirrorFull(bodyD(onPlane), onPlane, plane, 1, seed, irregularityM)
      === -cutFieldMirrorFull(bodyD(onPlane), onPlane, plane, 2, seed, irregularityM);
    expect(qBoth).toBe(true);
  });
});
