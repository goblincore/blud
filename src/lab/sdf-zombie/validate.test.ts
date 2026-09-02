// src/lab/sdf-zombie/validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateBody, sdBody, sdPrimitive, nearestPrim, MAX_PRIMS, MAX_CLUSTERS, MAX_CLUSTER_PRIMS } from './validate';
import { assignClusters } from './clusters';
import { FRAG } from './march.glsl';
import { APPLY_CARVES, MAP_BODY, HELPERS } from './webgpu/march.wgsl';
import type { LimbId, Primitive, Vec3 } from './types';
import { buildBody } from './build-body';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { add } from './vec';

describe('shader caps', () => {
  it('bakes the same ceilings into the GLSL that the CPU side enforces', () => {
    expect(FRAG).toContain(`#define MAX_PRIMS ${MAX_PRIMS}`);
    expect(FRAG).toContain(`#define MAX_CLUSTERS ${MAX_CLUSTERS}`);
  });

  it('has room for the 21-primitive body plus a face', () => {
    expect(MAX_PRIMS).toBeGreaterThanOrEqual(40);
  });

  // The WGSL is a template string, so tsc cannot see this literal and neither
  // can a type. If someone widens the cluster fold without moving the constant,
  // validateBody starts rejecting bodies the shader would have folded fine; if
  // they NARROW it, validateBody starts passing bodies the shader truncates in
  // silence. Assert the literal both cluster folds actually use.
  it('keeps MAX_CLUSTER_PRIMS equal to the WGSL cluster-fold literal', () => {
    // The prim fold lives in foldGroup (perf task 5), shared by BOTH fold
    // paths — cluster walk and tile list — plus APPLY_CARVES. All three stay
    // in step with the CPU-side cap.
    const foldGroup = HELPERS.find(h => /^fn foldGroup\(/.test(h))!;
    expect(foldGroup).toContain(`for (var i = 0; i < ${MAX_CLUSTER_PRIMS}; i = i + 1)`);
    expect(APPLY_CARVES).toContain(`for (var i = 0; i < ${MAX_CLUSTER_PRIMS}; i = i + 1)`);
  });

  it('can hold a cast, not just the one zombie', () => {
    expect(MAX_PRIMS).toBeGreaterThanOrEqual(128);
  });
});

const prim = (limb: LimbId, a: [number, number, number], radius = 0.1, blendK = 0.06):
  Omit<Primitive, 'cluster'> => ({ a, b: a, radius, scale: [1, 1, 1], blendK, limb });

/** A minimal valid body: head fused to torso, both legs fused to torso. */
const healthy = () => assignClusters([
  prim('head', [0, 1.62, 0], 0.15),
  prim('torso', [0, 1.35, 0], 0.22),
  prim('torso', [0, 1.15, 0], 0.20),
  prim('legL', [0.09, 0.95, 0], 0.10),
  prim('legR', [-0.09, 0.95, 0], 0.10),
]);

describe('validateBody', () => {
  it('passes a healthy body', () => {
    expect(validateBody(healthy(), { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 })).toEqual([]);
  });

  it('fails when a primitive escapes its cluster bounding sphere', () => {
    const body = healthy();
    // Move a primitive after bounds were computed — the cull would silently drop it.
    body.prims[body.clusters[0]!.start] = { ...body.prims[body.clusters[0]!.start]!, a: [5, 5, 5], b: [5, 5, 5] };
    const errs = validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/bounding sphere/i);
  });

  it('fails when silhouette noise outruns the march step multiplier', () => {
    const errs = validateBody(healthy(), { silhouetteNoiseAmp: 0.5, stepMultiplier: 0.95 });
    expect(errs.join(' ')).toMatch(/lipschitz|step multiplier/i);
  });

  it('fails when a limb is disconnected from the rest of the body', () => {
    const body = assignClusters([
      prim('torso', [0, 1.2, 0], 0.22),
      prim('legL', [0.09, 0.2, 0], 0.08, 0.01), // far below, tiny blend — floats free
    ]);
    const errs = validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/disconnected|not fused/i);
  });

  it('fails when the primitive count exceeds the shader ceiling', () => {
    const many = Array.from({ length: MAX_PRIMS + 1 }, (_, i) => prim('torso', [0, 1.2 + i * 0.001, 0], 0.22));
    const errs = validateBody(assignClusters(many), { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/primitive count/i);
  });

  // Regression: the total can sit well under MAX_PRIMS while ONE cluster runs
  // past the shader's 64-iteration fold. Before MAX_CLUSTER_PRIMS this passed
  // validation and the surface silently lost every primitive past the 64th.
  it('fails when a single cluster exceeds the per-cluster fold ceiling', () => {
    const fat = Array.from({ length: MAX_CLUSTER_PRIMS + 1 }, (_, i) =>
      prim('torso', [0, 1.2 + i * 0.001, 0], 0.22));
    expect(fat.length).toBeLessThanOrEqual(MAX_PRIMS); // total is legal…
    const errs = validateBody(assignClusters(fat), { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/per-cluster shader ceiling/i); // …the cluster is not
  });

  it('fails when a cluster is not contiguous in the primitive array', () => {
    const body = healthy();
    // Corrupt the fold order: swap a torso prim with a leg prim.
    const t = body.clusters.find(c => c.limb === 'torso')!;
    const l = body.clusters.find(c => c.limb === 'legL')!;
    const tmp = body.prims[t.start]!;
    body.prims[t.start] = body.prims[l.start]!;
    body.prims[l.start] = tmp;
    const errs = validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/contiguous|fold order/i);
  });
});

describe('carving', () => {
  const ball: Primitive = {
    a: [0, 0, 0], b: [0, 0, 0], radius: 0.2,
    scale: [1, 1, 1], blendK: 0.01, limb: 'head', cluster: 0,
  };
  const carve: Primitive = { ...ball, a: [0.2, 0, 0], b: [0.2, 0, 0], radius: 0.08, op: 'sub' };
  const clusters = (count: number, alive = true) =>
    [{ id: 0, limb: 'head' as LimbId, start: 0, count, center: [0, 0, 0] as Vec3, radius: 0.2, alive }];

  const solidBody = { prims: [ball], clusters: clusters(1) };
  const carvedBody = { prims: [ball, carve], clusters: clusters(2) };

  it('pushes the surface inward where a carve overlaps it', () => {
    const p: Vec3 = [0.17, 0, 0]; // just inside the sphere, under the carve
    expect(sdBody(p, solidBody)).toBeLessThan(0);
    expect(sdBody(p, carvedBody)).toBeGreaterThan(0);
  });

  it('leaves the field untouched far from any carve', () => {
    const far: Vec3 = [-0.19, 0, 0];
    expect(sdBody(far, carvedBody)).toBeCloseTo(sdBody(far, solidBody), 6);
  });

  it('drops a cluster carves and all when it is severed', () => {
    const dead = { prims: [ball, carve], clusters: clusters(2, false) };
    expect(sdBody([0, 0, 0], dead)).toBeGreaterThan(1e8);
  });
});

describe('shader/CPU field mirror', () => {
  it('carves in the shader too, behind a count guard', () => {
    expect(FRAG).toContain('applyCarves');
    expect(FRAG).toContain('uCarveCount');
  });
});

describe('sdPrimitive box', () => {
  const base = { a: [0, 0, 0], b: [0, 0, 0], scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, radius: 0.1 } as const;
  const boxAt = (round: number) => ({ ...base, box: { round } }) as unknown as Primitive;

  it('round=1 is exactly the capsule', () => {
    const cap = { ...base } as unknown as Primitive;
    for (const p of [[0.2, 0, 0], [0, 0.15, 0.1], [0.05, 0.05, 0.05]] as Vec3[])
      expect(sdPrimitive(p, boxAt(1))).toBeCloseTo(sdPrimitive(p, cap), 6);
  });

  it('reaches r along an axis regardless of round', () => {
    // On an axis the inset exactly cancels: extent (1-round)*r plus rounding
    // round*r is r, so the surface sits at r for every round.
    for (const round of [0, 0.08, 0.5, 1])
      expect(sdPrimitive([0.1, 0, 0], boxAt(round))).toBeCloseTo(0, 6);
  });

  it('a sharp corner sits r*(sqrt3-1) outside the capsule on the diagonal', () => {
    // The far corner of a cube of half-extent r is at r*sqrt(3). At round=0
    // the box surface reaches it, where the capsule stopped at r.
    const k = 0.1 * Math.sqrt(3);
    const corner: Vec3 = [k / Math.sqrt(3), k / Math.sqrt(3), k / Math.sqrt(3)];
    expect(sdPrimitive(corner, boxAt(0))).toBeCloseTo(0, 6);
    expect(sdPrimitive(corner, { ...base } as unknown as Primitive)).toBeCloseTo(0.1 * (Math.sqrt(3) - 1), 6);
  });

  it('leaves a non-box primitive bit-identical', () => {
    const cap = { ...base, radius: 0.07, scale: [1.3, 0.8, 1.1] } as unknown as Primitive;
    expect(sdPrimitive([0.2, 0.1, 0], cap)).toBe(sdPrimitive([0.2, 0.1, 0], { ...cap }));
  });

  it('reaches radius * scale[k] along each world axis on an anisotropic box', () => {
    // The scale-divide is per-component, so a world point sitting exactly at
    // radius*scale[k] along axis k maps to `radius` along that axis in the
    // divided frame regardless of the OTHER axes' scale — the box's e+r
    // inset (== radius) puts the surface exactly there, same as the capsule.
    // This is the property `round` being a FRACTION rather than metres exists
    // to protect: an absolute round in a divided frame would distort exactly
    // this reach anisotropically.
    //
    // NOTE: every assertion here is ON the surface (sdRoundBox === 0), so it
    // cannot see whether `* minScale` is even applied — 0 times anything is
    // 0. That is a separate property, pinned below.
    const scale: Vec3 = [1.4, 0.7, 1.0];
    const radius = 0.1;
    const anis = { ...base, scale, radius, box: { round: 0.35 } } as unknown as Primitive;
    const points: Vec3[] = [
      [radius * scale[0], 0, 0],
      [0, radius * scale[1], 0],
      [0, 0, radius * scale[2]],
    ];
    for (const p of points) expect(sdPrimitive(p, anis)).toBeCloseTo(0, 6);
  });

  it('applies minScale OFF the surface, where an on-surface point cannot see it', () => {
    // Every other test in this block reads the surface (distance 0), and
    // 0 * minScale === 0 for ANY minScale — a missing or misplaced
    // `* minScale` in the box branch is invisible to an on-surface
    // assertion. This point sits strictly outside the box, so the
    // scale-correction factor shows up in the returned NUMBER itself.
    //
    // Derivation (a = b = [0,0,0], so the divided-frame closest point is the
    // origin for any p): scale = [1.4, 0.7, 1.0], radius = 0.1, round = 0
    // (so e = radius = 0.1, r = 0). At world p = [0.28, 0, 0]:
    //   q  = p / scale = [0.2, 0, 0]           (divide by scale[0] = 1.4)
    //   qx = |0.2| - e = 0.1;  qy = qz = 0 - e = -0.1
    //   sdRoundBox = hypot(max(qx,0), 0, 0) + min(max(qx,qy,qz), 0) - r
    //              = 0.1 + min(0.1, 0) - 0 = 0.1
    //   minScale = min(1.4, 0.7, 1.0) = 0.7
    //   base = sdRoundBox * minScale = 0.1 * 0.7 = 0.07
    // Deleting `* minScale` from the box branch would yield 0.1 here, not
    // 0.07 — that is exactly what this assertion is pinning.
    const scale: Vec3 = [1.4, 0.7, 1.0];
    const anis = { ...base, scale, radius: 0.1, box: { round: 0 } } as unknown as Primitive;
    expect(sdPrimitive([0.28, 0, 0], anis)).toBeCloseTo(0.07, 6);
  });
});

describe('dead prims (mid-limb severing)', () => {
  // primScale.w semantics: 0 add, 1 carve, 2 dead. The CPU mirror must skip
  // dead prims in BOTH passes exactly as the shaders do, or click-to-shoot
  // rays hit flesh that is no longer there.
  const ball: Primitive = {
    a: [0, 0, 0], b: [0, 0, 0], radius: 0.2,
    scale: [1, 1, 1], blendK: 0.01, limb: 'head', cluster: 0,
  };
  const near: Primitive = {
    ...ball, a: [0, 0.45, 0], b: [0, 0.45, 0], radius: 0.08, limb: 'armL',
  };
  const carve: Primitive = {
    ...ball, a: [0.15, 0, 0], b: [0.15, 0, 0], radius: 0.08, op: 'sub',
  };
  const clusters = (count: number) =>
    [{ id: 0, limb: 'head' as LimbId, start: 0, count, center: [0, 0, 0] as Vec3, radius: 0.2, alive: true }];

  it('drops a dead additive prim from the fold', () => {
    const live = { prims: [ball, near], clusters: clusters(2) };
    const dead = { prims: [ball, { ...near, dead: true }], clusters: clusters(2) };
    const p: Vec3 = [0, 0.45, 0]; // centre of `near`
    expect(sdBody(p, live)).toBeLessThan(0);
    expect(sdBody(p, dead)).toBeGreaterThan(0);
  });

  it('drops a dead carve from the carve pass', () => {
    const live = { prims: [ball, carve], clusters: clusters(2) };
    const dead = { prims: [ball, { ...carve, dead: true }], clusters: clusters(2) };
    const alone = { prims: [ball], clusters: clusters(1) };
    const p: Vec3 = [0.17, 0, 0]; // inside the ball, under the carve
    expect(sdBody(p, live)).toBeGreaterThan(0);
    expect(sdBody(p, dead)).toBeCloseTo(sdBody(p, alone), 6);
  });
});

describe('validateBody with carves', () => {
  it('does not report a carve as escaping its bounding sphere', () => {
    const solid: Primitive = {
      a: [0, 0, 0], b: [0, 0, 0], radius: 0.2,
      scale: [1, 1, 1], blendK: 0.01, limb: 'head', cluster: 0,
    };
    const errs = validateBody({
      prims: [solid, { ...solid, a: [0.2, 0, 0], b: [0.2, 0, 0], radius: 0.08, op: 'sub' }],
      clusters: [{
        id: 0, limb: 'head', start: 0, count: 2,
        center: [0, 0, 0], radius: 0.2, alive: true,
      }],
    }, { silhouetteNoiseAmp: 0.012, stepMultiplier: 0.6 });
    expect(errs.filter(e => /bounding sphere/.test(e))).toEqual([]);
  });
});

describe('nearestPrim', () => {
  // Same fixture grammar as build-body.test.ts's "source-line provenance
  // survives the build" — skull is required (facePrims always reference it),
  // and the mirrored thigh bones need the pelvis-anchored second torso blob
  // to fuse to. Two torso blobs at different `at` with distinct radii, plus
  // a carve on the top one.
  const SRC = `model t
skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=0 len=0.34
  bone skull parent=spine dir=up len=0.16
  mirror
    bone thigh parent=pelvis dir=down side=0.10 len=0.40
  end

body
  blob torso on spine at=0.8 r=0.15 wide=1.28 deep=0.78 blend=0.014
  carve on spine at=0.8 r=0.05 offset=0.12,0,0.06
  bar  leg on thigh from=0.05 to=0.95 r=0.082 blend=0.0175 mirror
  blob torso on pelvis at=0.40 r=0.16 wide=1.10 tall=0.9 deep=0.92 blend=0.03
`;
  const topLine = 11;
  const carveLine = 12;
  const bottomLine = 14;

  const doc = parseBlob(SRC);
  const body = buildBody(compileBlob(doc, compileFace(doc)));

  const top = body.prims.findIndex(p => p.src === topLine);
  const bottom = body.prims.findIndex(p => p.src === bottomLine);
  const carveIdx = body.prims.findIndex(p => p.src === carveLine);

  it('builds clean', () => {
    expect(body.errors).toEqual([]);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeGreaterThanOrEqual(0);
    expect(carveIdx).toBeGreaterThanOrEqual(0);
  });

  it('returns the index of the additive prim with the smallest distance, ignoring carves and dead prims', () => {
    const topPrim = body.prims[top]!;
    const bottomPrim = body.prims[bottom]!;
    const pTop = add(topPrim.a, [0, 0, topPrim.radius + 0.005]);
    const pBottom = add(bottomPrim.a, [0, 0, bottomPrim.radius + 0.005]);
    expect(nearestPrim(pTop, body)).toBe(top);
    expect(nearestPrim(pBottom, body)).toBe(bottom);

    const pOnCarve = body.prims[carveIdx]!.a;
    const nearest = nearestPrim(pOnCarve, body);
    expect(body.prims[nearest]!.op).not.toBe('sub');
  });

  it('skips a dead prim and falls through to the next-nearest live one', () => {
    // A synthetic two-prim body, not the compiled fixture above — the fixture's
    // face prims sit close enough to the top torso blob that killing it would
    // surface a face prim instead of the bottom blob, muddying what this test
    // is actually checking.
    const near = prim('head', [0, 1.5, 0], 0.1);
    const far = prim('torso', [0, 1.0, 0], 0.1);
    const alive = assignClusters([near, far]);
    const pNear = add(near.a, [0, 0, near.radius + 0.005]);
    expect(nearestPrim(pNear, alive)).toBe(0);

    const dead = assignClusters([{ ...near, dead: true }, far]);
    expect(nearestPrim(pNear, dead)).toBe(1);
  });

  it('returns -1 when no cluster is alive', () => {
    const noneAlive = { ...body, clusters: body.clusters.map(c => ({ ...c, alive: false })) };
    expect(nearestPrim([0, 0, 0], noneAlive)).toBe(-1);
  });
});
