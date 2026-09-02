// src/lab/sdf-zombie/validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateBody, sdBody, nearestPrim, checkBoneContainment, MAX_PRIMS, MAX_CLUSTERS, MAX_CLUSTER_PRIMS, type Body } from './validate';
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

  it('counts bones AGAINST the shader ceiling, naming both counts', () => {
    // Flesh alone fits; flesh + bones does not. The texture is MAX_PRIMS wide
    // and the bone rows ride the SAME allocation past primCount, so the bound
    // is on the total — a body that validates here but overflows the texture
    // would have its bones silently unread.
    const flesh = Array.from({ length: MAX_PRIMS - 2 }, (_, i) => prim('torso', [0, 1.2 + i * 0.001, 0], 0.22));
    const body = {
      ...assignClusters(flesh),
      bonePrims: [
        { ...prim('torso', [0, 1.2, 0], 0.05), op: 'bone' as const, cluster: 1 },
        { ...prim('torso', [0, 1.201, 0], 0.05), op: 'bone' as const, cluster: 1 },
        { ...prim('torso', [0, 1.202, 0], 0.05), op: 'bone' as const, cluster: 1 },
      ],
    };
    const errs = validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 });
    expect(errs.join(' ')).toMatch(/primitive count .*flesh.*bone.*exceeds/s);
    expect(errs.join(' ')).toContain(`${flesh.length} flesh + 3 bone`);
    // And one under the combined bound stays clean.
    const ok = { ...body, bonePrims: body.bonePrims!.slice(0, 1) };
    expect(validateBody(ok, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 }).join(' ')).not.toMatch(/exceeds shader ceiling/);
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

describe('bone prims are invisible to the CPU field (wound pass r2)', () => {
  // sdBody backs click-to-shoot. It mirrors mapBody + applyCarves and does NOT
  // apply wounds, and bone is always strictly inside flesh — so adding bone
  // prims must not move the CPU field by even a float. If it does, shots land
  // where nothing is drawn.
  const flesh: Primitive = {
    a: [0, 0, 0], b: [0, 0.4, 0], radius: 0.09,
    scale: [1, 1, 1], blendK: 0.01, limb: 'legL', cluster: 0,
  };
  // The bone surface sits INSIDE the flesh's smin fillet band (gap 0.005 <
  // blendK 0.01) — the adversarial case. With a fat gap the smin degenerates
  // to an exact min of the flesh and an additive-folded bone would be a
  // bit-identical no-op, and this test would pass against a broken fold.
  const bone: Primitive = { ...flesh, radius: 0.085, op: 'bone' };

  const withoutBone = {
    prims: [flesh],
    clusters: [{ limb: 'legL', start: 0, count: 1, alive: true }],
  } as unknown as Body;
  const withBone = {
    prims: [flesh, bone],
    clusters: [{ limb: 'legL', start: 0, count: 2, alive: true }],
  } as unknown as Body;

  const probes: Vec3[] = [
    [0, 0.2, 0], [0.05, 0.2, 0], [0.12, 0.2, 0], [0, 0.5, 0],
    [0.3, 0.2, 0], [0, 0.2, 0.08], [-0.06, 0.1, 0.02],
  ];

  it('sdBody is bit-identical with and without bone prims', () => {
    for (const p of probes) {
      expect(sdBody(p, withBone)).toBe(sdBody(p, withoutBone));
    }
  });

  it('never reports a bone prim as the nearest additive primitive', () => {
    // A contract pin rather than a red/green test: for bone strictly inside
    // flesh, dBone > dFlesh at every point, so bone can never win the argmin
    // even before the skip existed. It pins the contract against future
    // fixtures where the two could tie or invert.
    for (const p of probes) {
      expect(nearestPrim(p, withBone)).not.toBe(1);
    }
  });
});

describe('bone containment (wound pass r2)', () => {
  const flesh: Primitive = {
    a: [0, 0, 0], b: [0, 0.4, 0], radius: 0.09,
    scale: [1, 1, 1], blendK: 0.01, limb: 'legL', cluster: 0,
  };
  const mk = (boneRadius: number) => ({
    prims: [flesh],
    bonePrims: [{ ...flesh, radius: boneRadius, op: 'bone' as const }],
    clusters: [{ limb: 'legL', start: 0, count: 1, alive: true }],
  } as unknown as Body);

  it('accepts a bone comfortably inside its flesh', () => {
    expect(checkBoneContainment(mk(0.03))).toEqual([]);
  });

  it('rejects a bone fatter than the flesh around it', () => {
    const errs = checkBoneContainment(mk(0.12));
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/bone/i);
    // Index 0 WITHIN the bone array — bone lives outside body.prims now, so
    // the error names the bone-array position (was prims[1] under the old
    // storage this task replaces).
    expect(errs[0]).toMatch(/prim 0/);
  });

  it('rejects a bone that only breaches on one side', () => {
    // Same radius as a passing bone, but shoved sideways until it breaks the
    // skin. Radius alone is not the test — position matters.
    const offset = { ...flesh, radius: 0.03, op: 'bone' as const,
      a: [0.075, 0, 0] as Vec3, b: [0.075, 0.4, 0] as Vec3 };
    const body = {
      prims: [flesh], bonePrims: [offset],
      clusters: [{ limb: 'legL', start: 0, count: 1, alive: true }],
    } as unknown as Body;
    expect(checkBoneContainment(body).length).toBeGreaterThan(0);
  });

  it('catches a breach that only a non-uniform scale creates', () => {
    // sdPrimitive divides the sample point by prim.scale, so a prim with
    // scale.x = 1.45 reaches 1.45 x radius in x — the ribcage Task 10 authors
    // as exactly wide=1.45. Sampling a plain sphere of radius r probes a
    // surface the prim does not have and misses every breach along a widened
    // axis. The breach below is REAL (flesh r=0.09, bone reaches 0.10875),
    // confirmed against sdBody before asserting it is caught.
    const wide = {
      ...flesh, radius: 0.075, scale: [1.45, 1, 0.55] as Vec3, op: 'bone' as const,
    };
    const body = {
      prims: [flesh], bonePrims: [wide],
      clusters: [{ limb: 'legL', start: 0, count: 1, alive: true }],
    } as unknown as Body;
    // Confirm the breach is real before asserting it is caught.
    expect(sdBody([0.075 * 1.45, 0.2, 0], body)).toBeGreaterThan(0);
    expect(checkBoneContainment(body).length).toBeGreaterThan(0);
  });

  it('catches a breach that only the taper creates', () => {
    // radiusB sits at the FAR end; a bone whose radiusB exceeds the flesh's
    // reach there breaches only near b. A sampler that never interpolates
    // radius toward radiusB never looks there.
    const tapered = {
      ...flesh, radius: 0.03, radiusB: 0.12, op: 'bone' as const,
    };
    const body = {
      prims: [flesh], bonePrims: [tapered],
      clusters: [{ limb: 'legL', start: 0, count: 1, alive: true }],
    } as unknown as Body;
    // 0.105 from the axis at the far cap: outside the flesh (r 0.09) but
    // inside the bone's radiusB (0.12) — where the bone pokes through.
    expect(sdBody([0.105, 0.4, 0], body)).toBeGreaterThan(0);
    expect(checkBoneContainment(body).length).toBeGreaterThan(0);
  });

  it('catches a breach that only the bend creates', () => {
    // A bent bone's midsection swings out to the control point — well off the
    // a-b chord an endpoint-only sampler walks.
    const bent = {
      ...flesh, radius: 0.03, bend: [0.15, 0, 0] as Vec3, op: 'bone' as const,
    };
    const body = {
      prims: [flesh], bonePrims: [bent],
      clusters: [{ limb: 'legL', start: 0, count: 1, alive: true }],
    } as unknown as Body;
    // The Bezier mid lands at x=0.075; the bone's 0.03 radius reaches 0.105,
    // past the flesh's 0.09. Probe a point inside the bone, outside the flesh.
    expect(sdBody([0.095, 0.2, 0], body)).toBeGreaterThan(0);
    expect(checkBoneContainment(body).length).toBeGreaterThan(0);
  });
});

describe('organ prims are invisible to the CPU field (organs r3)', () => {
  const flesh: Primitive = {
    a: [0, 0, 0], b: [0, 0.4, 0], radius: 0.09,
    scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: 0,
  };
  const organ: Primitive = { ...flesh, radius: 0.085, op: 'organ' };
  const withOrgan = {
    prims: [flesh], bonePrims: [organ],
    clusters: [{ limb: 'torso', start: 0, count: 1, alive: true }],
  } as unknown as Body;
  const without = {
    prims: [flesh], bonePrims: [],
    clusters: [{ limb: 'torso', start: 0, count: 1, alive: true }],
  } as unknown as Body;

  it('sdBody is bit-identical with and without organs', () => {
    for (const p of [[0, 0.2, 0], [0.05, 0.2, 0], [0.3, 0.2, 0]] as Vec3[]) {
      expect(sdBody(p, withOrgan)).toBe(sdBody(p, without));
    }
  });

  it('containment covers organs, not just bones', () => {
    // Organs must sit inside flesh for exactly the same reason bones do: the
    // shader's nearWound gate is only an identity while nothing in this array
    // protrudes. A breaching organ pops as the gate flips.
    const breaching = {
      prims: [flesh], bonePrims: [{ ...flesh, radius: 0.12, op: 'organ' as const }],
      clusters: [{ limb: 'torso', start: 0, count: 1, alive: true }],
    } as unknown as Body;
    expect(checkBoneContainment(breaching).length).toBeGreaterThan(0);
  });
});
