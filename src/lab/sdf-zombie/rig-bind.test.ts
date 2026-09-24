// src/lab/sdf-zombie/rig-bind.test.ts
import { describe, it, expect } from 'vitest';
import { bindRig, applyRig, headQuatOf, pinTips, HEAD_RIGID_TUNING } from './rig-bind';
import { IK_TUNING } from './ik';
import { headingDir } from './wander';
import goblinSrc from './characters/goblin.blob?raw';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { stepRig } from './rig';
import { jointForBoneEnd, jointNamesForBody, rotateYaw } from './gait';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { makeMotionJoints } from './motion';
import { collapseRopes } from './collapse';
import soldierSrc from './characters/soldier.blob?raw';
import schoolgirlSrc from './characters/schoolgirl.blob?raw';
import zombieSrc from './characters/zombie.blob?raw';
import { sdPrimitive } from './validate';
import { add, dot, len, normalize, qRotate, scale as vscale, sub } from './vec';
import type { Primitive, Vec3 } from './types';
import type { BuildResult } from './build-body';
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

  it("RECOMPUTES a box primitive's cluster bound to cover its corner, not just the capsule radius (X1.28 task 4c site 8)", () => {
    // Minimal synthetic body: one dead-sharp box (round=0), radius 0.1, owned
    // by a single degenerate bone (bindRig needs at least one rig point to
    // bind endpoints to). True corner reach is 0.1*sqrt(3) ~ 0.1732, vs a
    // plain capsule's 0.1. The rig never moves here — this exercises the
    // cluster REFIT applyRig always performs, not the posing itself.
    const boxBody: BuildResult = {
      prims: [{
        a: [0, 0, 0], b: [0, 0, 0], radius: 0.1, scale: [1, 1, 1], blendK: 0,
        limb: 'torso', cluster: 0, box: { round: 0 },
      }],
      clusters: [{ id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 0.1, alive: true }],
      bones: new Map([['root', { head: [0, 0, 0], tail: [0, 0, 0] }]]),
      bonePrims: [], errors: [],
    };
    const boxBound = bindRig(boxBody);
    const out = applyRig(boxBody, boxBound);
    expect(out.clusters[0]!.radius).toBeGreaterThanOrEqual(0.1 * Math.sqrt(3) - 1e-9);
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

describe('applyRig — rigid segment tags (bone-segment spheres)', () => {
  // Every inside-flesh prim (bones AND organs) leaves applyRig tagged with
  // the rigid unit it poses by: skull-rigid, an axial BoneFrame, or a limb
  // bone's two bind points. pack.ts groups bone rows by this tag for the
  // per-segment sphere cull, so the tags must BE the pose units.
  const body = buildBody(compileBlob(parseBlob(zombieSrc)));
  const bound = bindRig(body);
  const out = applyRig(body, bound);

  it('tags every posed inside-flesh prim with a small dense non-negative int', () => {
    expect(out.bonePrims.length).toBeGreaterThan(0);
    const tags: number[] = [];
    for (const p of out.bonePrims) {
      expect(typeof p.boneSegment).toBe('number');
      expect(Number.isInteger(p.boneSegment)).toBe(true);
      expect(p.boneSegment!).toBeGreaterThanOrEqual(0);
      tags.push(p.boneSegment!);
    }
    // Dense: no gaps — max tag + 1 === number of distinct tags.
    expect(Math.max(...tags) + 1).toBe(new Set(tags).size);
  });

  it('shares a tag within one axial BoneFrame and splits across frames', () => {
    // Organs are excluded here on purpose: a torso organ carries a BoneFrame
    // (it POSES with the pelvis segment) but is TAGGED 'organs' — the tag is
    // the cull segment, not the pose frame, and organs cull as one unit.
    const groups = new Map<string, number[]>();
    bound.boneFrames.forEach((f, i) => {
      if (body.bonePrims[i]!.op === 'organ') return;
      const key = `${f.head}-${f.tail}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    // The zombie has several axial segments (pelvis, spine, neck) and rib
    // pairs, so some frame holds more than one bone prim.
    expect(groups.size).toBeGreaterThan(1);
    expect(Math.max(...[...groups.values()].map(g => g.length))).toBeGreaterThan(1);
    const seen = new Set<number>();
    for (const idxs of groups.values()) {
      const t = out.bonePrims[idxs[0]!]!.boneSegment!;
      for (const i of idxs) expect(out.bonePrims[i]!.boneSegment).toBe(t);
      expect(seen.has(t)).toBe(false); // distinct frames, distinct tags
      seen.add(t);
    }
  });

  it('poses every skull-rigid bone under ONE shared tag', () => {
    const skullBones = [...(bound.head?.bones.keys() ?? [])];
    expect(skullBones.length).toBeGreaterThan(0);
    const t = out.bonePrims[skullBones[0]!]!.boneSegment!;
    expect(typeof t).toBe('number'); // tagged at all — the shares below pin WHAT
    for (const i of skullBones) expect(out.bonePrims[i]!.boneSegment).toBe(t);
  });

  it('splits limb bones by their bind-point pair (an arm tag is not a shin tag)', () => {
    const skullSet = new Set(bound.head?.bones.keys() ?? []);
    const groups = new Map<string, number[]>();
    body.bonePrims.forEach((_, i) => {
      if (skullSet.has(i) || bound.boneFrames.has(i)) return;
      const bind = bound.boneBinding[i]!;
      const key = `${bind.a.point}-${bind.b.point}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    // Upper arm, forearm, thigh, shin — at least two limb segments.
    expect(groups.size).toBeGreaterThanOrEqual(2);
    const seen = new Set<number>();
    for (const idxs of groups.values()) {
      const t = out.bonePrims[idxs[0]!]!.boneSegment!;
      for (const i of idxs) expect(out.bonePrims[i]!.boneSegment).toBe(t);
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it('tags every organ with ONE tag no bone carries', () => {
    const organs = out.bonePrims.filter(p => p.op === 'organ');
    expect(organs.length).toBeGreaterThan(0);
    const organTag = organs[0]!.boneSegment!;
    for (const p of organs) expect(p.boneSegment).toBe(organTag);
    for (const p of out.bonePrims.filter(q => q.op !== 'organ'))
      expect(p.boneSegment).not.toBe(organTag);
  });
});

describe('rig-bind on .blob bone names (soldier)', () => {
  const body = buildBody(compileBlob(parseBlob(soldierSrc)));
  const bound = bindRig(body);
  it('both elbows and both knees get a bend constraint', () => {
    expect(bound.rig.bends?.length).toBe(4);
  });
  it('upperarm/forearm prims carry an arm frame', () => {
    const armPrims = body.prims.map((p, i) => [p, i] as const).filter(([p]) => /^(upperarm|forearm)\.[lr]$/.test(p.bone ?? ''));
    expect(armPrims.length).toBeGreaterThan(0);
    for (const [, i] of armPrims) expect(bound.binding[i]!.armFrame, `prim ${i}`).toBeDefined();
  });
  it('collapse ropes anchor the offset clavicle heads to the chest', () => {
    const names = jointNamesForBody(body);
    const ropes = collapseRopes(names, bound.rig.restPose);
    const iC = names.indexOf('chest'), iL = names.indexOf('clavicleL'), iR = names.indexOf('clavicleR');
    expect(ropes.some(r => (r.a === iL && r.b === iC) || (r.a === iC && r.b === iL))).toBe(true);
    expect(ropes.some(r => (r.a === iR && r.b === iC) || (r.a === iC && r.b === iR))).toBe(true);
  });
});

describe('rigid tips (hand tips and toes)', () => {
  const body = buildBody(compileBlob(parseBlob(soldierSrc)));
  const bound = bindRig(body);
  it('the soldier has four tips: two hands, two feet', () => {
    expect(bound.tips.length).toBe(4);
  });
  it('a sagging toe snaps back to its rest offset from the ankle, yawed', () => {
    const toe = bound.tips.find(t => t.rest[2] > 0.05)!; // the foot bone runs +z
    const yaw = 0.7;
    const sagged = bound.rig.points.map((p, i) => i === toe.point ? { ...p, pos: [p.pos[0], p.pos[1] - 0.1, p.pos[2]] as Vec3 } : p);
    const pinned = pinTips(sagged, bound.tips, yaw);
    const rel = sub(pinned[toe.point]!.pos, pinned[toe.anchor]!.pos);
    expect(len(sub(rel, rotateYaw(toe.rest, yaw)))).toBeLessThan(1e-9);
    expect(pinned[toe.point]!.prev).toEqual(pinned[toe.point]!.pos);
  });
  it('with `only`, just the listed tip points along its target; the rest keep their rest hang', () => {
    const [a, b] = bound.tips;
    const targets = bound.rig.points.map(p => p.pos);
    targets[a!.point] = add(targets[a!.anchor]!, [0, 1, 0]); // point tip a straight up
    targets[b!.point] = add(targets[b!.anchor]!, [0, 1, 0]); // and b, which is NOT listed
    const pinned = pinTips(bound.rig.points, bound.tips, 0, targets, new Set([a!.point]));
    expect(len(sub(sub(pinned[a!.point]!.pos, pinned[a!.anchor]!.pos), [0, len(a!.rest), 0]))).toBeLessThan(1e-9);
    expect(len(sub(sub(pinned[b!.point]!.pos, pinned[b!.anchor]!.pos), b!.rest))).toBeLessThan(1e-9);
  });
  it('the zombie has no tips and pinTips is a no-op for it', () => {
    const z = bindRig(buildBody(compileBlob(parseBlob(zombieSrc))));
    expect(z.tips).toEqual([]);
    expect(pinTips(z.rig.points, z.tips, 1)).toBe(z.rig.points);
  });
});

/** bindRig's own nearest-joint rule, for asserting membership from outside:
 *  the rig point closest to a world position. */
function nearestRigPoint(bound: ReturnType<typeof bindRig>, p: Vec3): number {
  let best = 0, bestD = Infinity;
  bound.rig.points.forEach((q, i) => {
    const d = len(sub(p, q.pos));
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

describe('applyRig — rigid head membership is SHAPE-BLIND (2026-09-06)', () => {
  // THE BUG THE OWNER FOUND BY EYE: "the prims on the head/face don't move
  // with the rest of the head."
  //
  // Membership in the rigid head frame was `limb === 'head' && a === b` —
  // head-limb SPHERES only — justified as "exactly the face prims face.ts
  // emits". That is true of face.ts. It is NOT true of a face authored in a
  // .blob: the goblin's ears, hooked nose and lip blobs carry a `tip=`, so
  // a !== b, so every one of them fell through to per-endpoint nearest-joint
  // binding. When the skull then rotated on the neck, the cranium turned and
  // the face did not — it slid off, which is exactly what the goblin looks
  // like in motion and exactly why he "looks fine if you turn movement off".
  //
  // ELEVEN of the sixteen shipped characters have head prims with a tip
  // (goblin, both clowns, all three schoolgirls, mouse, dragon, minotaur,
  // bonewalker, strand-fixture). The ZOMBIE has none — his only non-sphere
  // head prim is the neck bar, which must keep binding per-endpoint — which
  // is why nothing caught this: he is what every gate and every capture
  // renders.
  const goblin = () => buildBody(compileBlob(parseBlob(goblinSrc)));

  it('a non-sphere face prim sitting ON THE SKULL rides the rigid head', () => {
    const body = goblin();
    const bound = bindRig(body);
    expect(bound.head).not.toBeNull();

    // Every head-limb prim whose endpoints both sit on the skull segment,
    // whatever its shape. The nose and the ears are capsules; before the fix
    // the rigid set held only the spheres and these were absent.
    const shaped = body.prims
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.limb === 'head' && len(sub(p.a, p.b)) >= 1e-9);
    expect(shaped.length, 'goblin.blob authors non-sphere head prims').toBeGreaterThan(0);

    const skullPts = new Set([bound.head!.pivot, bound.head!.tip]);
    const onSkull = shaped.filter(({ p }) =>
      skullPts.has(nearestRigPoint(bound, p.a)) && skullPts.has(nearestRigPoint(bound, p.b)));
    expect(onSkull.length, 'the nose/ears/lips are skull-owned').toBeGreaterThan(0);

    for (const { i } of onSkull)
      expect(bound.head!.prims.has(i), `prim ${i} left behind by the rigid head`).toBe(true);
  });

  it('the neck capsule STILL binds per-endpoint — it spans off the skull', () => {
    // The one non-sphere head-limb prim that must NOT join: rigidly rotating
    // a capsule that runs chest→neck tears its chest end loose.
    const body = goblin();
    const bound = bindRig(body);
    const skullPts = new Set([bound.head!.pivot, bound.head!.tip]);
    const spanning = body.prims
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.limb === 'head' && len(sub(p.a, p.b)) >= 1e-9)
      .filter(({ p }) =>
        !skullPts.has(nearestRigPoint(bound, p.a)) || !skullPts.has(nearestRigPoint(bound, p.b)));
    for (const { i } of spanning)
      expect(bound.head!.prims.has(i), `spanning prim ${i} must stay per-endpoint`).toBe(false);
  });

  it('THE ZOMBIE IS UNTOUCHED — his rigid set is exactly his head spheres', () => {
    // The change is additive by construction, and this pins it: if the
    // zombie's rigid membership ever moves, every pixel baseline in the repo
    // is invalidated at once and the reason must be deliberate.
    const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const bound = bindRig(body);
    const spheres = body.prims
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.limb === 'head' && len(sub(p.a, p.b)) < 1e-9)
      .map(({ i }) => i);
    expect([...bound.head!.prims.keys()].sort((a, b) => a - b)).toEqual(spheres);
  });
});

describe('applyRig — a BENT prim on the rigid head keeps its curve (2026-09-22)', () => {
  // THE OGRE'S LIPS. The rigid-head branch moved a skull-owned prim's
  // endpoints and stamped orient = q, but left `bend` in REST space. The
  // field (sdPrimitive / sdPrimO) conjugates the control point by orient
  // along with the endpoints, so it expects the bend displacement POSED —
  // exactly what posePrimitive already does. Left at rest, a turned head's
  // curve bowed back into the skull: only the two end caps stayed proud of
  // the face, which with color= read as four dark balls at the mouth corners
  // (a bow of 3.6 cm on a 1.6 cm radius). A shallow bow (the brow shelf) hid
  // the same error inside the flesh.
  //
  // Invariant: the rigid head is a RIGID motion, so each skull-owned prim's
  // field must be identical at corresponding points. The motion is recovered
  // from the prim itself: x -> a' + q (x - a).
  const body = buildBody(compileBlob(parseBlob(goblinSrc)));
  const bound = bindRig(body);
  const moved = { ...bound, rig: { ...bound.rig, points: bound.rig.points.map((p, i) =>
    i === bound.head!.tip ? { ...p, pos: add(p.pos, [0.3, 0.02, -0.1]) as Vec3 } : p) } };

  it('the posed field of every skull-owned bent prim is the rest field, rigidly moved', () => {
    const out = applyRig(body, moved);
    const bent = [...bound.head!.prims.keys()].filter(i => body.prims[i]!.bend !== undefined);
    expect(bent.length, 'goblin.blob authors a bent face prim').toBeGreaterThan(0);
    for (const i of bent) {
      const rest = body.prims[i]!, posed = out.prims[i]!;
      const q = posed.orient!;
      expect(Math.abs(1 - q[3]), 'the head really turned').toBeGreaterThan(0.005);
      const toPosed = (x: Vec3): Vec3 => add(posed.a, qRotate(q, sub(x, rest.a)));
      // The curve's apex (Bezier t = 1/2) and points a radius off it along
      // the bow — the ones a rest-space bend moves the most.
      const c = add(vscale(add(rest.a, rest.b), 0.5), rest.bend!);
      const apex = add(vscale(add(rest.a, rest.b), 0.25), vscale(c, 0.5));
      const bow = normalize(rest.bend!);
      for (const x of [apex, add(apex, vscale(bow, rest.radius)), add(apex, vscale(bow, -rest.radius))]) {
        expect(sdPrimitive(toPosed(x), posed), `prim ${i}`).toBeCloseTo(sdPrimitive(x, rest), 9);
      }
    }
  });
});

describe('applyRig — a SHELL\'s clip plane rides the pose (2026-09-23)', () => {
  // The clip plane is authored in rest model space. It used to be packed as
  // authored whatever the pose, so a hood's face opening kept facing rest +z
  // when the body turned and a cuff plane stayed where the wrist was. The
  // plane must move by the prim's own map, x -> a' + q (x - a).
  const body = buildBody(compileBlob(parseBlob(schoolgirlSrc)));
  const bound = bindRig(body);
  const shells = body.prims.map((p, i) => ({ p, i })).filter(({ p }) => p.shell).map(({ i }) => i);

  it('is the authored plane exactly at rest', () => {
    expect(shells.length, 'schoolgirl.blob authors shells').toBeGreaterThan(0);
    const out = applyRig(body, bound);
    for (const i of shells) {
      expect(out.prims[i]!.shell!.clipNormal).toEqual(body.prims[i]!.shell!.clipNormal);
      expect(out.prims[i]!.shell!.clipOffset).toBeCloseTo(body.prims[i]!.shell!.clipOffset, 12);
    }
  });

  it('turns and translates with the prim under a yaw and a shoved rig', () => {
    const moved = { ...bound, rig: { ...bound.rig, points: bound.rig.points.map(p =>
      ({ ...p, pos: add(p.pos, [0.7, 0.05, -1.3]) as Vec3 })) } };
    const out = applyRig(body, moved, 1.3);
    for (const i of shells) {
      const rest = body.prims[i]!, posed = out.prims[i]!;
      const q = posed.orient!;
      expect(q, `prim ${i} is oriented`).toBeDefined();
      const n0 = rest.shell!.clipNormal, n1 = posed.shell!.clipNormal;
      const want = qRotate(q, n0);
      for (let k = 0; k < 3; k++) expect(n1[k]).toBeCloseTo(want[k]!, 9);
      // A point ON the rest plane lands ON the posed plane.
      const onRest = add(rest.a, vscale(n0, rest.shell!.clipOffset - dot(n0, rest.a)));
      const mapped = add(posed.a, qRotate(q, sub(onRest, rest.a)));
      expect(dot(n1, mapped) - posed.shell!.clipOffset, `prim ${i}`).toBeCloseTo(0, 9);
    }
  });
});

// THE BRIDE'S DRIP (2026-09-24): an endpoint bound to the nearest rig point
// of the WHOLE body, so a thin prim ending near another limb's hand rode that
// hand and, the moment the arm moved, stretched into a thread across the air
// (dark-red lines beside the bride; characters/thin-fixture.blob). Distal
// joints — elbow, hand, handTip, knee, foot, toe — now bind only prims on
// their own bone or an adjacent one (bindEnd in rig-bind.ts).
describe('bindRig — distal joints belong to their own limb', () => {
  const RAW = import.meta.glob('./characters/*.blob', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const DISTAL = /^(elbow|hand|handTip|knee|foot|toe)[LR]$/;

  /** Rig points (by index) that are distal gait joints of the given limb kind. */
  function distalPoints(body: BuildResult, bound: ReturnType<typeof bindRig>, kind: 'arm' | 'leg'): Set<number> {
    const want = kind === 'arm' ? /^(elbow|hand|handTip)/ : /^(knee|foot|toe)/;
    const out = new Set<number>();
    for (const [name, bone] of body.bones) {
      for (const end of ['head', 'tail'] as const) {
        const n = jointForBoneEnd(name, end);
        if (!n || !DISTAL.test(n) || !want.test(n)) continue;
        const i = bound.rig.points.findIndex(p => len(sub(p.pos as Vec3, bone[end])) < 1e-4);
        if (i >= 0) out.add(i);
      }
    }
    // ...and everything past them: claws, fingers (cyclops' c_in/c_mid/c_out).
    const ends = [...body.bones.values()].map(b => [b.head, b.tail].map(e =>
      bound.rig.points.findIndex(p => len(sub(p.pos as Vec3, e)) < 1e-4)));
    for (let grew = true; grew;) {
      grew = false;
      for (const [h, t] of ends) if (out.has(h!) && !out.has(t!)) { out.add(t!); grew = true; }
    }
    return out;
  }

  /** Swing the given rig points ~0.37 m and return how far each prim's
   *  endpoints moved (the larger of the two) — a prim bound to a foreign
   *  hand at BOTH ends does not stretch, it flies (minotaur's thigh). */
  function moved(body: BuildResult, bound: ReturnType<typeof bindRig>, pts: Set<number>): number[] {
    const moved = { ...bound, rig: { ...bound.rig, points: bound.rig.points.map((p, i) => pts.has(i)
      ? { ...p, pos: [p.pos[0] + 0.3, p.pos[1] + 0.1, p.pos[2] + 0.2] as const } : p) } };
    const out = applyRig(body, moved);
    return body.prims.map((p, i) =>
      Math.max(len(sub(out.prims[i]!.a, p.a)), len(sub(out.prims[i]!.b, p.b))));
  }

  it('thin-fixture: the 10 cm drip stays put when the wrists swing', () => {
    const body = buildBody(compileBlob(parseBlob(RAW['./characters/thin-fixture.blob']!)), DEFAULT_BUILD_OPTS);
    const bound = bindRig(body);
    const drips = body.prims.map((p, i) => [p, i] as const).filter(([p]) => p.radius < 0.003);
    expect(drips).toHaveLength(2);
    const dz = moved(body, bound, distalPoints(body, bound, 'arm'));
    // Before the fix each drip's low end rode its wrist (0.10 m -> ~0.4 m).
    for (const [, i] of drips) expect(dz[i]!).toBeLessThan(1e-9);
  });

  for (const [file, src] of Object.entries(RAW)) {
    const name = file.replace('./characters/', '').replace('.blob', '');
    it(`${name}: swinging one limb's distal joints moves no prim of another limb`, () => {
      const body = buildBody(compileBlob(parseBlob(src)), DEFAULT_BUILD_OPTS);
      const bound = bindRig(body);
      for (const kind of ['arm', 'leg'] as const) {
        const dz = moved(body, bound, distalPoints(body, bound, kind));
        const bad = body.prims.flatMap((p, i) => p.limb.startsWith(kind) || dz[i]! < 1e-6 ? []
          : [`${p.limb}/${p.bone} line ${p.src} +${(dz[i]! * 1000).toFixed(0)} mm`]);
        expect(bad, `${kind} swing moved`).toEqual([]);
      }
    });
  }
});
