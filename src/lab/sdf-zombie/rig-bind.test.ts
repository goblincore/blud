// src/lab/sdf-zombie/rig-bind.test.ts
import { describe, it, expect } from 'vitest';
import { bindRig, applyRig, headQuatOf, HEAD_RIGID_TUNING } from './rig-bind';
import { IK_TUNING } from './ik';
import { headingDir } from './wander';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { stepRig } from './rig';
import { sdPrimitive } from './validate';
import { add, dot, len, normalize, qRotate, scale as vscale, sub } from './vec';
import type { Primitive, Vec3 } from './types';
import type { Quat } from './vec';

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

describe('applyRig — rigid head cluster (motion-polish)', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);

  /** The worst-case angle the clamp cone permits off the rest direction:
   *  acos(cos(maxYaw)·cos(maxPitch)) — the cone's corner, where both yaw and
   *  pitch sit at their bounds simultaneously. */
  const CONE = Math.acos(
    Math.cos(IK_TUNING.headMaxYaw) * Math.cos(IK_TUNING.headMaxPitch));

  // The rigid set: head-limb sphere prims (cranium/jaw/brow/nose).
  const rigidIdx = body.prims
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.limb === 'head' && len(sub(p.a, p.b)) < 1e-9)
    .map(({ i }) => i);
  const centre = (prims: typeof body.prims, i: number) => prims[i]!.a; // spheres: a === b

  // Deterministic pseudo-rotation of the whole upper rig, so the head
  // transform is arbitrary rather than axis-aligned (a rotated frame is the
  // general case the rigidity property must hold in).
  const posedRig = (headDelta: readonly [number, number, number], neckDelta: readonly [number, number, number]) =>
    ({ ...bound, rig: { ...bound.rig, points: bound.rig.points.map((p, i) => {
      if (i === bound.head!.tip) return { ...p, pos: add(p.pos, headDelta) as Vec3 };
      if (i === bound.head!.pivot) return { ...p, pos: add(p.pos, neckDelta) as Vec3 };
      return p;
    }) } });

  it('binds a head rigid frame with the face spheres as its members', () => {
    expect(bound.head).not.toBeNull();
    expect(bound.head!.prims.size).toBe(rigidIdx.length);
    expect(rigidIdx.length).toBeGreaterThanOrEqual(4); // cranium+jaw+brow+nose
    // The neck-flesh capsule is NOT a member: it must keep spanning
    // chest→neck per-endpoint, or its chest end tears loose.
    const neckCapsule = body.prims.findIndex(p => p.limb === 'head' && len(sub(p.a, p.b)) >= 1e-9);
    expect(neckCapsule).toBeGreaterThanOrEqual(0);
    expect(bound.head!.prims.has(neckCapsule)).toBe(false);
  });

  it('RIGIDITY: face prims preserve rest-pose relative offsets under an arbitrary head pose', () => {
    // Rotate+translate the skull points arbitrarily (a tilted direction the
    // clamp will have to work against, plus neck drift). Every pair of rigid
    // prim centres must keep its rest separation EXACTLY — one rigid unit,
    // no shear — which is precisely what the per-endpoint binding broke.
    const moved = posedRig([0.09, -0.05, 0.12], [0.02, -0.01, 0.03]);
    const out = applyRig(body, moved);
    for (const i of rigidIdx) for (const j of rigidIdx) {
      const rest = len(sub(centre(body.prims, i), centre(body.prims, j)));
      const posed = len(sub(centre(out.prims, i), centre(out.prims, j)));
      expect(Math.abs(posed - rest)).toBeLessThan(1e-9);
    }
  });

  it('BODY YAW: the face turns WITH the body — the nose leads along the applied yaw in every quadrant (motion-polish task 5)', () => {
    // Regression: a bare qFromTo(restDir, clamped) shortest-arc carries the
    // head's pitch but ZERO azimuth — the pivot→tip axis is near-vertical in
    // every walking direction, so a 180° body turn was invisible to the
    // rigid pass and the face kept pointing the authored way (the owner's
    // "head turned around" screenshot). The yaw must be composed explicitly.
    let noseIdx = -1;
    let noseZ = -Infinity;
    body.prims.forEach((p, i) => {
      if (p.limb !== 'head' || len(sub(p.a, p.b)) > 1e-9) return;
      const z = (p.a[2] + p.b[2]) / 2;
      if (z > noseZ) { noseZ = z; noseIdx = i; }
    });
    const pivot = bound.rig.points[bound.head!.pivot]!.pos;
    const restLead = dot(sub(body.prims[noseIdx]!.a, pivot), [0, 0, 1]);
    expect(restLead).toBeGreaterThan(0.05); // the nose really does lead at rest
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.4]) {
      const posed = applyRig(body, bound, yaw); // rig at REST, only the yaw changes
      const fwd = headingDir(yaw);
      const lead = dot(sub(posed.prims[noseIdx]!.a, pivot), fwd);
      expect(lead).toBeGreaterThan(0.6 * restLead);
      // The painted-face rotation (headQuatOf) rides the SAME turn.
      const q = headQuatOf(bound, yaw)!;
      expect(dot(qRotate(q, [0, 0, 1]), fwd)).toBeGreaterThan(0.9);
    }
  });

  it('NECK CLAMP: an extreme head-point direction never rotates the face past the look-at cone', () => {
    // Shove the tip 90°+ sideways — far past every clamp. The posed face may
    // rotate up to the cone corner (both yaw and pitch at their IK_TUNING
    // bounds), never beyond: pairwise face vectors rotate by at most CONE.
    const pivot = bound.rig.points[bound.head!.pivot]!.pos;
    const tip = bound.rig.points[bound.head!.tip]!.pos;
    const along = normalize(sub(tip, pivot));
    const side: Vec3 = [-along[2], 0.2, along[0]]; // ⊥-ish, unnormalised on purpose
    const moved = posedRig(
      [side[0] * 0.5 - along[0] * 0.16, side[1] * 0.5, side[2] * 0.5 - along[2] * 0.16], [0, 0, 0]);
    const out = applyRig(body, moved);
    for (const i of rigidIdx) for (const j of rigidIdx) {
      if (i === j) continue;
      const a = normalize(sub(centre(out.prims, i), centre(out.prims, j)));
      const b = normalize(sub(centre(body.prims, i), centre(body.prims, j)));
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
      expect(ang).toBeLessThanOrEqual(CONE + 1e-6);
    }
  });

  it('SOCKET: the cranium stays on the neck no matter how far the head point drifts', () => {
    // The owner screenshot: head floating half a metre off the shoulders.
    // The rigid unit's origin may trail the head point by at most
    // HEAD_RIGID_TUNING.driftMax beyond the rigid prediction — so the posed
    // cranium sits within rest-offset + driftMax of the pivot, always.
    const moved = posedRig([0.5, 0.05, -0.35], [0, 0, 0]);
    const out = applyRig(body, moved);
    const pivotPos = moved.rig.points[bound.head!.pivot]!.pos;
    const cranium = rigidIdx[0]!; // prims are cluster-sorted; head cluster first
    const restOff = len(sub(centre(body.prims, cranium), bound.rig.points[bound.head!.pivot]!.pos));
    const posedOff = len(sub(centre(out.prims, cranium), pivotPos));
    expect(posedOff).toBeLessThanOrEqual(restOff + HEAD_RIGID_TUNING.driftMax + 1e-9);
  });

  it('TUNABLE clamp: the drift bound ENGAGES — a half-metre head-point shove moves the posed cranium by centimetres, not decimetres', () => {
    // The owner screenshot: head floating half a metre off the shoulders.
    // Without the clamp the rigid unit's origin would trail the head point's
    // full drift; with driftMax = 0.01 the cranium must sit orders of
    // magnitude closer to its socket than the raw shove. (Cranking
    // HEAD_RIGID_TUNING.driftMax is the loose-neck creature dial — this test
    // pins the near-rigid DEFAULT.)
    const shove: readonly [number, number, number] = [0.5, 0.05, -0.35];
    const moved = posedRig(shove, [0, 0, 0]);
    const out = applyRig(body, moved);
    const pivotPos = moved.rig.points[bound.head!.pivot]!.pos;
    const cranium = rigidIdx[0]!;
    const restOff = len(sub(centre(body.prims, cranium), bound.rig.points[bound.head!.pivot]!.pos));
    const posedOff = len(sub(centre(out.prims, cranium), pivotPos));
    expect(posedOff).toBeLessThanOrEqual(restOff + HEAD_RIGID_TUNING.driftMax + 1e-9);
    expect(len(shove) - (posedOff - restOff)).toBeGreaterThan(0.4); // the clamp bit
  });
});

describe('applyRig — per-prim orientation (motion-polish task 3)', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);

  // The brow: the anisotropic face prim that read as a detached visor when
  // its [1.55, 0.42, 0.80] squash stayed world-aligned under a turned head.
  const browIdx = body.prims.findIndex(
    p => p.limb === 'head' && p.scale[0] > 1.4 && p.scale[1] < 0.5);
  expect(browIdx).toBeGreaterThanOrEqual(0);

  /** Head tipped ~60° sideways — past the 0.85 rad clamp, so the pose is the
   *  clamped corner, the worst case the visor bug ever shows. */
  const moved = { ...bound, rig: { ...bound.rig, points: bound.rig.points.map((p, i) =>
    i === bound.head!.tip ? { ...p, pos: add(p.pos, [0.5, 0.02, 0.12]) as Vec3 } : p) } };

  it('stamps the head quat on skull-owned prims and leaves everything else absent', () => {
    const out = applyRig(body, moved);
    let stamped = 0;
    out.prims.forEach((p, i) => {
      if (bound.head!.prims.has(i)) {
        stamped++;
        expect(p.orient).toBeDefined();
      } else {
        expect(p.orient).toBeUndefined();
      }
    });
    expect(stamped).toBeGreaterThanOrEqual(4); // cranium+jaw+brow+nose
  });

  it('is the EXACT identity at rest, so statue bodies pay nothing', () => {
    const out = applyRig(body, bound);
    const q = out.prims[browIdx]!.orient!;
    expect(Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2])).toBeLessThan(1e-12);
    expect(q[3]).toBeCloseTo(1, 12);
  });

  it('REGRESSION: the brow ledge follows the turned face — surface extents rotate with the head', () => {
    const out = applyRig(body, moved);
    const brow = out.prims[browIdx]!;
    const q = brow.orient!;
    expect(Math.abs(1 - q[3])).toBeGreaterThan(0.05); // a real rotation, clamped corner
    const qc: Quat = [-q[0], -q[1], -q[2], q[3]];

    // Bisect for the zero crossing along a world direction — exact, since
    // sdPrimitive's zero is exactly |S^-1 p_local| = radius.
    const surf = (prim: Primitive, dir: Vec3): number => {
      let lo = 0, hi = prim.radius * 3;
      for (let k = 0; k < 48; k++) {
        const m = (lo + hi) / 2;
        if (sdPrimitive(add(prim.a, vscale(dir, m)), prim) > 0) hi = m; else lo = m;
      }
      return (lo + hi) / 2;
    };
    // Analytic extent of the oriented ellipsoid along unit v: t = r / |S^-1 (q* v)|.
    const predicted = (dir: Vec3): number => {
      const l = qRotate(qc, dir);
      return brow.radius / Math.hypot(
        l[0] / brow.scale[0], l[1] / brow.scale[1], l[2] / brow.scale[2]);
    };

    const AXES: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const restExtents = AXES.map(d => surf(body.prims[browIdx]!, d));
    const posedExtents = AXES.map(d => surf(brow, d));

    // The field's surface extent along the WORLD axes changes with the pose...
    const maxShift = Math.max(...AXES.map((_, i) => Math.abs(posedExtents[i]! - restExtents[i]!)));
    expect(maxShift).toBeGreaterThan(0.2 * brow.radius);
    // ...and lands exactly where the ROTATED ellipsoid says — the ledge hugs
    // the skull at the clamped angle instead of sticking out as a visor.
    AXES.forEach((d, i) => {
      const want = predicted(d);
      expect(Math.abs(posedExtents[i]! - want)).toBeLessThan(0.02 * want + 1e-5);
    });

    // Pre-fix behaviour pinned as the regression: WITHOUT orient the squash
    // stays world-aligned and the extent does NOT follow the face.
    const noOrient: Primitive = { ...brow, orient: undefined };
    const stale = AXES.map(d => surf(noOrient, d));
    expect(Math.max(...AXES.map((_, i) => Math.abs(stale[i]! - posedExtents[i]!))))
      .toBeGreaterThan(0.2 * brow.radius);
  });

  it('the rotated brow agrees with the CPU field probes along its turned axes', () => {
    const out = applyRig(body, moved);
    const brow = out.prims[browIdx]!;
    const q = brow.orient!;
    const d = brow.radius * 1.1; // between the 0.80 and 1.55 horizontal extents
    const longAxis = qRotate(q, [1, 0, 0]);
    const shortAxis = qRotate(q, [0, 0, 1]);
    expect(sdPrimitive(add(brow.a, vscale(longAxis, d)), brow)).toBeLessThan(0);
    expect(sdPrimitive(add(brow.a, vscale(shortAxis, d)), brow)).toBeGreaterThan(0);
  });
});

describe('bone prims ride the rig (wound pass r2)', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);

  it('binds every bone endpoint alongside the flesh binds', () => {
    expect(bound.boneBinding).toHaveLength(body.bonePrims.length);
  });

  it('is the identity at rest for bones too', () => {
    const out = applyRig(body, bound);
    body.bonePrims.forEach((bp, i) => {
      expect(len(sub(out.bonePrims[i]!.a, bp.a))).toBeCloseTo(0, 9);
      expect(len(sub(out.bonePrims[i]!.b, bp.b))).toBeCloseTo(0, 9);
    });
  });

  it('poses each bone with its flesh source, never leaves it at rest', () => {
    // Swing every rig point but the pinned one. Each bone must move by EXACTLY
    // the amount its flesh source moves — same bone, same binds — and at least
    // one bone must actually move, else the test proves nothing.
    const moved = { ...bound, rig: { ...bound.rig,
      points: bound.rig.points.map(p => p.pinned ? p
        : ({ ...p, pos: [p.pos[0] + 0.3, p.pos[1], p.pos[2]] as const })) } };
    const out = applyRig(body, moved);
    let checked = 0;
    let movedBones = 0;
    body.bonePrims.forEach((bp, i) => {
      // The flesh source shares the bone name, limb and REST endpoints — the
      // derivation copies geometry, so the pair is unambiguous.
      const j = body.prims.findIndex(p =>
        p.bone === bp.bone && p.limb === bp.limb && p.cluster === bp.cluster
        && p.a[0] === bp.a[0] && p.a[1] === bp.a[1] && p.a[2] === bp.a[2]
        && p.b[0] === bp.b[0] && p.b[1] === bp.b[1] && p.b[2] === bp.b[2]);
      expect(j).toBeGreaterThanOrEqual(0);
      const boneDelta = len(sub(out.bonePrims[i]!.a, bp.a));
      const fleshDelta = len(sub(out.prims[j]!.a, body.prims[j]!.a));
      expect(boneDelta).toBeCloseTo(fleshDelta, 9);
      if (boneDelta > 0.29) movedBones++;
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
    expect(movedBones).toBeGreaterThan(0);
  });

  it('keeps bone endpoints finite through a settled rig', () => {
    let rig = bound.rig;
    for (let i = 0; i < 120; i++)
      rig = stepRig(rig, 1 / 60, { gravity: [0, -9.8, 0], damping: 0.04, iterations: 4, restStiffness: 0.2 });
    const out = applyRig(body, { ...bound, rig });
    for (const p of out.bonePrims) for (const v of [...p.a, ...p.b]) expect(Number.isFinite(v)).toBe(true);
  });
});
