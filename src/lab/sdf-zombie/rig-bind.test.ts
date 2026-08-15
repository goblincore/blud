// src/lab/sdf-zombie/rig-bind.test.ts
import { describe, it, expect } from 'vitest';
import { bindRig, applyRig } from './rig-bind';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { stepRig } from './rig';
import { len, sub } from './vec';

describe('bindRig', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);

  it('creates one rig point per distinct bone joint', () => {
    expect(bound.rig.points.length).toBeGreaterThan(4);
    expect(bound.rig.points.length).toBeLessThanOrEqual(body.bones.size * 2);
  });

  it('binds every primitive endpoint to some rig point', () => {
    expect(bound.binding).toHaveLength(body.prims.length);
    for (const b of bound.binding) {
      expect(b.a.point).toBeGreaterThanOrEqual(0);
      expect(b.a.point).toBeLessThan(bound.rig.points.length);
      expect(b.b.point).toBeGreaterThanOrEqual(0);
    }
  });

  it('pins the lowest joint so the body does not fall through the floor', () => {
    expect(bound.rig.points.some(p => p.pinned)).toBe(true);
  });

  it('constrains adjacent joints at their rest separation', () => {
    for (const c of bound.rig.constraints) expect(c.rest).toBeGreaterThan(0);
  });
});

describe('applyRig', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);

  it('is the identity at rest — an unmoved rig reproduces the original body', () => {
    const out = applyRig(body, bound);
    for (let i = 0; i < body.prims.length; i++) {
      expect(len(sub(out.prims[i]!.a, body.prims[i]!.a))).toBeCloseTo(0, 9);
      expect(len(sub(out.prims[i]!.b, body.prims[i]!.b))).toBeCloseTo(0, 9);
    }
  });

  it('moves primitives when their bound rig point moves', () => {
    const moved = { ...bound, rig: { ...bound.rig,
      points: bound.rig.points.map((p, i) => i === bound.rig.points.length - 1
        ? { ...p, pos: [p.pos[0] + 0.5, p.pos[1], p.pos[2]] as const } : p) } };
    const out = applyRig(body, moved);
    const anyMoved = out.prims.some((p, i) => len(sub(p.a, body.prims[i]!.a)) > 0.4);
    expect(anyMoved).toBe(true);
  });

  it('RECOMPUTES cluster bounds — stale bounds silently drop moving flesh', () => {
    const moved = { ...bound, rig: { ...bound.rig,
      points: bound.rig.points.map(p => p.pinned ? p
        : ({ ...p, pos: [p.pos[0] + 0.3, p.pos[1], p.pos[2]] as const })) } };
    const out = applyRig(body, moved);
    for (const c of out.clusters)
      for (const prim of out.prims.slice(c.start, c.start + c.count)) {
        const maxScale = Math.max(prim.scale[0], prim.scale[1], prim.scale[2]);
        for (const end of [prim.a, prim.b])
          expect(len(sub(end, c.center)) + prim.radius * maxScale)
            .toBeLessThanOrEqual(c.radius + 1e-6);
      }
  });

  it('preserves fold order — cluster start/count/limb are untouched', () => {
    const out = applyRig(body, bound);
    expect(out.clusters.map(c => `${c.limb}:${c.start}:${c.count}`))
      .toEqual(body.clusters.map(c => `${c.limb}:${c.start}:${c.count}`));
  });

  it('survives a settled rig without NaN', () => {
    let rig = bound.rig;
    for (let i = 0; i < 120; i++)
      rig = stepRig(rig, 1 / 60, { gravity: [0, -9.8, 0], damping: 0.04, iterations: 4, restStiffness: 0.2 });
    const out = applyRig(body, { ...bound, rig });
    for (const p of out.prims) for (const v of [...p.a, ...p.b]) expect(Number.isFinite(v)).toBe(true);
  });
});
