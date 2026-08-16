// src/lab/sdf-zombie/validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateBody, sdBody, MAX_PRIMS, MAX_CLUSTERS } from './validate';
import { assignClusters } from './clusters';
import { FRAG } from './march.glsl';
import type { LimbId, Primitive, Vec3 } from './types';

describe('shader caps', () => {
  it('bakes the same ceilings into the GLSL that the CPU side enforces', () => {
    expect(FRAG).toContain(`#define MAX_PRIMS ${MAX_PRIMS}`);
    expect(FRAG).toContain(`#define MAX_CLUSTERS ${MAX_CLUSTERS}`);
  });

  it('has room for the 21-primitive body plus a face', () => {
    expect(MAX_PRIMS).toBeGreaterThanOrEqual(40);
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
