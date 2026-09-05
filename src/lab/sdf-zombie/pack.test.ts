// src/lab/sdf-zombie/pack.test.ts
import { describe, it, expect } from 'vitest';
import { packBody, PRIM_STRIDE, CLUSTER_STRIDE, GROUP_RADIUS_MAX, boundGroups, W_ADD, W_BONE, W_DEAD, W_ORGAN } from './pack';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import schoolgirlSrc from './characters/schoolgirl.blob?raw';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { bindRig, applyRig } from './rig-bind';
import { severLimb } from './sever';
import { MAX_CLUSTERS, MAX_PRIMS } from './validate';
import type { BuiltBody, Primitive, Vec3 } from './types';

// Every shipped character, keyed by file basename (the prof snapshot below
// names these). Eager glob so a character ADDED later without a snapshot row
// fails the >= count guard and the lookup, not silently nothing.
const CHARACTERS_RAW = import.meta.glob('./characters/*.blob', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const CHARACTERS: Record<string, string> = Object.fromEntries(
  Object.entries(CHARACTERS_RAW).map(([k, v]) => [k.split('/').pop()!, v]));

/** Packs into Float32Array, so expected values must be rounded to float32. */
const f32 = (v: number) => Math.fround(v);

describe('packBody', () => {
  const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const packed = packBody(built);

  it('allocates fixed-size arrays matching the shader ceilings', () => {
    expect(packed.primA).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.primB).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.primScale).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.primQuat).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.clusterBounds).toHaveLength(MAX_CLUSTERS * CLUSTER_STRIDE);
    expect(packed.clusterRange).toHaveLength(MAX_CLUSTERS * CLUSTER_STRIDE);
  });

  it('reports the live counts', () => {
    expect(packed.primCount).toBe(built.prims.length);
    expect(packed.clusterCount).toBe(built.clusters.length);
  });

  it('packs endpoint A with radius in w', () => {
    const p = built.prims[0]!;
    expect(Array.from(packed.primA.slice(0, 4))).toEqual([...p.a, p.radius].map(f32));
  });

  it('packs endpoint B with blendK in w', () => {
    const p = built.prims[0]!;
    expect(Array.from(packed.primB.slice(0, 4))).toEqual([...p.b, p.blendK].map(f32));
  });

  it('packs cluster range as (start, count, alive) and bounds as (center, radius)', () => {
    const c = built.clusters[0]!;
    expect(Array.from(packed.clusterRange.slice(0, 3))).toEqual([c.start, c.count, 1]);
    expect(Array.from(packed.clusterBounds.slice(0, 4))).toEqual([...c.center, c.radius].map(f32));
  });

  it('writes alive = 0 for a severed cluster without moving any primitive', () => {
    const severed = { ...built, clusters: built.clusters.map((c, i) => i === 2 ? { ...c, alive: false } : c) };
    const p2 = packBody(severed);
    expect(p2.clusterRange[2 * CLUSTER_STRIDE + 2]).toBe(0);
    // FLESH payload is byte-identical — severing never re-packs. (Compared over
    // the flesh region only: wound pass r2 packs bone rows past primCount, and
    // severing legitimately drops the dead cluster's bones there — that is the
    // feature, not a repack. p2.primCount === packed.primCount either way.)
    expect(Array.from(p2.primA.slice(0, p2.primCount * PRIM_STRIDE)))
      .toEqual(Array.from(packed.primA.slice(0, packed.primCount * PRIM_STRIDE)));
  });

  it('packs an absent orient as the identity quat, and a set one verbatim', () => {
    // The shader branches on |1 - w|, so the identity default must be exact.
    const q: [number, number, number, number] = [0, 0.7071068, 0, 0.7071068];
    const p = packBody({
      prims: [
        { ...built.prims[0]! },
        { ...built.prims[0]!, orient: q },
      ],
      clusters: [{ id: 0, limb: 'head', start: 0, count: 2, center: [0, 0, 0], radius: 1, alive: true }],
      bones: new Map(), bonePrims: [],
    });
    expect(Array.from(p.primQuat.slice(0, 4))).toEqual([0, 0, 0, 1]);
    expect(Array.from(p.primQuat.slice(4, 8))).toEqual(q.map(f32));
  });

  it('sets the clusterRange.w orient flag only for clusters carrying a real quat', () => {
    // The shader hoists the per-prim quat branch to this flag; a stale or
    // missing flag either pays a textureLoad per prim everywhere or renders
    // a turned head's face world-aligned again.
    const q: [number, number, number, number] = [0, 0.7071068, 0, 0.7071068];
    const mk = (orient?: [number, number, number, number]) => ({
      ...built.prims[0]!, ...(orient ? { orient } : {}),
    });
    const p = packBody({
      prims: [mk(), mk(q), mk([0, 0, 0, 1])],
      clusters: [
        { id: 0, limb: 'head', start: 0, count: 1, center: [0, 0, 0], radius: 1, alive: true },
        { id: 1, limb: 'torso', start: 1, count: 1, center: [0, 0, 0], radius: 1, alive: true },
        { id: 2, limb: 'armL', start: 2, count: 1, center: [0, 0, 0], radius: 1, alive: true },
      ],
      bones: new Map(), bonePrims: [],
    });
    expect(p.clusterRange[0 * CLUSTER_STRIDE + 3]).toBe(0); // absent orient
    expect(p.clusterRange[1 * CLUSTER_STRIDE + 3]).toBe(1); // real quat
    expect(p.clusterRange[2 * CLUSTER_STRIDE + 3]).toBe(0); // exact identity
  });

  it('reports the largest blendK, which the shader needs as its cull margin', () => {
    expect(packed.maxBlendK).toBe(Math.max(...built.prims.map(p => p.blendK)));
  });

  it('packs the rest rows from the rest body when one is given (task 6)', () => {
    // Two data rows ride alongside the posed endpoints: restA = [a, radius],
    // restB = [b, blendK] of the SAME prim in the authored rest pose.
    const rest = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const shifted = {
      ...rest,
      prims: rest.prims.map(p => ({
        ...p,
        a: [p.a[0] + 1, p.a[1], p.a[2]] as Vec3,
        b: [p.b[0] + 1, p.b[1], p.b[2]] as Vec3,
      })),
    };
    const p = packBody(shifted, rest);
    expect(Array.from(p.restA.slice(0, 4))).toEqual([...rest.prims[0]!.a, rest.prims[0]!.radius].map(f32));
    expect(Array.from(p.restB.slice(0, 4))).toEqual([...rest.prims[0]!.b, rest.prims[0]!.blendK].map(f32));
    // The posed rows carry the shifted endpoints — the two never mix.
    expect(Array.from(p.primA.slice(0, 4))).toEqual([...shifted.prims[0]!.a, shifted.prims[0]!.radius].map(f32));
    // restA.w is the 'written' sentinel: a real radius is always > 0.
    for (let i = 0; i < p.primCount; i++) expect(p.restA[i * PRIM_STRIDE + 3]).toBeGreaterThan(0);
  });

  it('defaults the rest rows to the posed prims (never-rigged bodies)', () => {
    // Crowd statues and chunk views pack no separate rest body; the posed
    // prims double as rest, which keeps their noise anchored exactly as the
    // explicit-rest path would anchor a motionless rig.
    expect(Array.from(packed.restA)).toEqual(Array.from(packed.primA));
    expect(Array.from(packed.restB)).toEqual(Array.from(packed.primB));
  });

  it('packs a missing rest prim as zeros — the shader\'s unwritten sentinel', () => {
    const p = packBody(built, { prims: [], clusters: [], bones: new Map(), bonePrims: [] });
    expect(Array.from(p.restA.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });
});

it('packs a carve as a negative blend constant', () => {
  const prim = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3, radius: 0.1,
    scale: [1, 1, 1] as Vec3, blendK: 0.02, limb: 'head' as const, cluster: 0,
  };
  const p = packBody({
    prims: [prim, { ...prim, op: 'sub' as const }],
    clusters: [{ id: 0, limb: 'head', start: 0, count: 2, center: [0, 0, 0], radius: 0.1, alive: true }],
    bones: new Map(), bonePrims: [],
  });
  // blendK keeps its magnitude on BOTH; the carve flag rides primScale.w.
  expect(p.primB[3]).toBeCloseTo(0.02, 6);
  expect(p.primB[7]).toBeCloseTo(0.02, 6);
  expect(p.primScale[3]).toBe(0);   // additive
  expect(p.primScale[7]).toBe(1);   // carve
  // The cull margin is a distance, never signed.
  expect(p.maxBlendK).toBeCloseTo(0.02, 6);
  expect(p.carveCount).toBe(1);
});

describe('box packing', () => {
  // Shared skeleton: one prim, one cluster covering it. Each test only
  // varies the prim fields relevant to the box encoding.
  const base = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3, radius: 0.1,
    scale: [1, 1, 1] as Vec3, blendK: 0.02, limb: 'torso' as const, cluster: 0,
  };
  const pack1 = (prim: Primitive) => packBody({
    prims: [prim],
    clusters: [{ id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 0.1, alive: true }],
    bones: new Map(), bonePrims: [],
  });

  it('sets prof bit 3 (value 8) for a box', () => {
    const p = pack1({ ...base, box: { round: 0.2 } });
    expect(Math.floor(p.primShape[1]!) & 8).toBe(8);
  });

  it('puts round in primBend.w', () => {
    const p = pack1({ ...base, box: { round: 0.2 } });
    expect(p.primBend[3]).toBeCloseTo(0.2, 6);
  });

  it('composes with chamfer without disturbing the low bits', () => {
    const p = pack1({ ...base, box: { round: 0.2 }, blendProfile: 'chamfer' });
    expect(Math.floor(p.primShape[1]!)).toBe(9); // chamfer(1) + box(8)
  });

  it('leaves prof and primBend.w untouched on a non-box prim', () => {
    const p = pack1({ ...base });
    expect(Math.floor(p.primShape[1]!) & 8).toBe(0);
    expect(p.primBend[3]).toBe(0);
  });

  it('still writes a BENT prim\'s control point into primBend.xyz, and leaves w at 0', () => {
    // The regression this shared row could plausibly cause: a bent
    // (non-box) prim's Bezier control point must land in xyz exactly as
    // before, undisturbed by the box's w write.
    const bent = { ...base, a: [0, 0, 0] as Vec3, b: [1, 0, 0] as Vec3, bend: [0, 0.3, 0] as Vec3 };
    const p = pack1(bent);
    // bendCtrl = midpoint(a, b) + bend = (0.5, 0.3, 0).
    expect(Array.from(p.primBend.slice(0, 3))).toEqual([0.5, 0.3, 0].map(f32));
    expect(p.primBend[3]).toBe(0);
  });
});

describe('shaped bitflag gates box and shell (task 6)', () => {
  // clusterRange.w and groupRange.w both pack (oriented?1:0) + (shaped?2:0).
  // `shaped` gates whether the shader loads ROW_PRIM_SHAPE (where `prof`
  // lives) and ROW_PRIM_BEND at all for that cluster/group — miss a
  // property here and every prim carrying it arrives at the shader with
  // prof = 0, indistinguishable from a plain capsule, regardless of what
  // was authored.
  const base = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3, radius: 0.1,
    scale: [1, 1, 1] as Vec3, blendK: 0.02, limb: 'torso' as const, cluster: 0,
  };
  const SHAPED_BIT = 2;

  it('sets the CLUSTER-level shaped bit when the only special prim is a box', () => {
    const box = { ...base, box: { round: 0.2 } };
    const p = packBody({
      prims: [box],
      clusters: [{ id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 0.1, alive: true }],
      bones: new Map(), bonePrims: [],
    });
    expect(Math.floor(p.clusterRange[0 * CLUSTER_STRIDE + 3]!) & SHAPED_BIT).toBe(SHAPED_BIT);
  });

  it('sets the GROUP-level shaped bit when the only special prim is a box', () => {
    const box = { ...base, box: { round: 0.2 } };
    const p = packBody({
      prims: [box],
      clusters: [{ id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 0.1, alive: true }],
      bones: new Map(), bonePrims: [],
    }, undefined, { singleGroup: true });
    expect(Math.floor(p.groupRange[0 * CLUSTER_STRIDE + 3]!) & SHAPED_BIT).toBe(SHAPED_BIT);
  });

  it('sets the GROUP-level shaped bit when the only special prim is a shell (pre-existing bug, owner-approved fix)', () => {
    // Before this fix, the group-level `shaped` some() list omitted `shell`
    // entirely (only the cluster-level list had it). foldGroup reads ONLY
    // the group-level flag (grp.w, via ROW_GROUP_RANGE) — the cluster-level
    // flag feeds applyCarves alone — so a shell whose group carried no
    // OTHER shaped property arrived at the shader with prof = 0, never hit
    // `(i32(prof) & 4) != 0`, and rendered as a solid capsule instead of a
    // thin clipped sheet. schoolgirl-alt's cape (group 10) hit exactly this.
    const shell = {
      ...base,
      shell: { thickness: 0.01, clipNormal: [0, 1, 0] as Vec3, clipOffset: 0, rim: 0.005 },
    };
    const p = packBody({
      prims: [shell],
      clusters: [{ id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 0.1, alive: true }],
      bones: new Map(), bonePrims: [],
    }, undefined, { singleGroup: true });
    expect(Math.floor(p.groupRange[0 * CLUSTER_STRIDE + 3]!) & SHAPED_BIT).toBe(SHAPED_BIT);
  });
});

describe('metal — prof bit 4, value 16 (hard-surface task 2)', () => {
  // `metal` is a SHADING-ONLY bit: it must not change the fold. That is why
  // it is safe to give it the next free bit — every read of prof in
  // march.wgsl.ts is a mask (`& 2`, `& 4`, `& 8`, `(& 7) == 1`), all of
  // which leave bit 4 clear — and why this test pins the exact VALUE, not
  // just the masked bit: an accidental collision with bits 0-3 would change
  // the fold of every metal prim.
  const base = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3, radius: 0.1,
    scale: [1, 1, 1] as Vec3, blendK: 0.02, limb: 'torso' as const, cluster: 0,
  };
  const SHAPED_BIT = 2;
  const METAL_BIT = 16;
  const cluster = () =>
    ({ id: 0, limb: 'torso' as const, start: 0, count: 1, center: [0, 0, 0] as Vec3, radius: 0.1, alive: true });

  it('packs a metal-ONLY prim as prof EXACTLY 16 — no other bit set', () => {
    const p = packBody({ prims: [{ ...base, metal: true }], clusters: [cluster()], bones: new Map(), bonePrims: [] });
    expect(p.primShape[1]).toBe(METAL_BIT);
  });

  it('keeps prof masked-clean for a metal box: 8 + 16, low bits untouched', () => {
    // The combination the minotaur's plates actually author. Asserting the
    // exact value pins that metal neither collides with nor perturbs the
    // box/chamfer/bend bits.
    const p = packBody({
      prims: [{ ...base, metal: true, box: { round: 0.1 }, blendProfile: 'chamfer' as const }],
      clusters: [cluster()], bones: new Map(), bonePrims: [],
    });
    expect(p.primShape[1]).toBe(1 + 8 + 16);
  });

  it('sets the CLUSTER-level shaped bit when the only special prim is metal', () => {
    // A prim that is ONLY metal — no taper, chamfer, bend, shell or box —
    // is the whole point of this test: one on `box metal` would pass with
    // the flag missing and prove nothing. A missing flag means the shape row
    // is never loaded for that run, so the prim arrives at the shader with
    // prof = 0 and silently loses its specialness (the schoolgirl-alt cape
    // bug, found in these same two lists).
    const p = packBody({ prims: [{ ...base, metal: true }], clusters: [cluster()], bones: new Map(), bonePrims: [] });
    expect(Math.floor(p.clusterRange[0 * CLUSTER_STRIDE + 3]!) & SHAPED_BIT).toBe(SHAPED_BIT);
  });

  it('sets the GROUP-level shaped bit when the only special prim is metal', () => {
    // This is the flag foldGroup actually reads; the cluster-level one
    // feeds applyCarves alone. Each level needs its own assertion.
    const p = packBody({ prims: [{ ...base, metal: true }], clusters: [cluster()], bones: new Map(), bonePrims: [] }, undefined, { singleGroup: true });
    expect(Math.floor(p.groupRange[0 * CLUSTER_STRIDE + 3]!) & SHAPED_BIT).toBe(SHAPED_BIT);
  });

  it('every shipped character packs the SAME prof values as before metal existed', () => {
    // Byte-identical pin (task 2 step 1d), taken 2026-09-03 from the
    // pre-metal pack of every .blob in characters/ (sorted primShape.y
    // multisets). Any change to these arrays — apart from a CONSCIOUS
    // re-pin when a character deliberately authors `metal` — means the
    // metal bit leaked into packing arithmetic existing characters were
    // relying on. minotaur.blob is the ONE row re-pinned by this task (its
    // five prosthetic plates now carry metal: 8 + 16 = 24).
    const packedProf = (name: string): number[] => {
      const src = CHARACTERS[name];
      if (src === undefined) throw new Error(`no character file keyed ${name} — the glob changed under the snapshot`);
      const built = buildBody(compileBlob(parseBlob(src)), DEFAULT_BUILD_OPTS);
      const p = packBody(built);
      const profs: number[] = [];
      for (let i = 0; i < built.prims.length; i++) profs.push(p.primShape[i * PRIM_STRIDE + 1]!);
      return profs.sort((a, b) => a - b);
    };
    expect(Object.keys(CHARACTERS).length).toBeGreaterThanOrEqual(12);
    expect(packedProf('bonewalker.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,3,3]);
    expect(packedProf('box-fixture.blob')).toEqual([0,0,0,0,8,8]);
    expect(packedProf('clown-alt.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1]);
    expect(packedProf('clown.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1]);
    expect(packedProf('cyclops.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,2,2,2]);
    expect(packedProf('dragon.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2,3]);
    expect(packedProf('goblin.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,3]);
    // Five plate boxes at 24 = box bit 3 (8) + metal bit 4 (16); the two
    // 2s are bent horns, the 3s chamfered+bent ones. Re-pinned when the
    // plates were authored `metal` — every other value is pre-metal.
    expect(packedProf('minotaur.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,2,3,3,24,24,24,24,24]);
    expect(packedProf('mouse.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,2,2]);
    expect(packedProf('schoolgirl-alt.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,4,4,4,4]);
    expect(packedProf('schoolgirl.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,4,4,4,4]);
    expect(packedProf('zombie.blob')).toEqual(
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  });
});

describe('primColor row', () => {
  it('packs flesh as all zeros, so pre-colour bodies are bit-identical', () => {
    const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const packed = packBody(built);
    let sum = 0;
    for (const v of packed.primColor) sum += Math.abs(v);
    expect(sum).toBe(0);
  });

  // w = 1 + gloss, never 0 for a painted prim: 0 is the shader's "flesh"
  // sentinel, and a black matte prim (rgb 0, gloss 0) would otherwise pack
  // as indistinguishable from no paint at all.
  it('writes linear rgb with w = 1 + gloss, so black matte is still painted', () => {
    const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const painted = {
      ...built,
      prims: built.prims.map((p, i) =>
        i === 0 ? { ...p, color: [0, 0, 0] as Vec3 } :
        i === 1 ? { ...p, color: [1, 0.2, 0] as Vec3, gloss: 0.8 } : p),
    };
    const c = packBody(painted).primColor;
    expect([...c.slice(0, 4)]).toEqual([0, 0, 0, 1]);
    expect(c[PRIM_STRIDE + 0]).toBeCloseTo(1, 6);
    expect(c[PRIM_STRIDE + 1]).toBeCloseTo(0.2, 6);
    expect(c[PRIM_STRIDE + 3]).toBeCloseTo(1.8, 6);
    expect(c[2 * PRIM_STRIDE + 3]).toBe(0);
  });
});

describe('primClip row — w = per-prim glow (hard-surface task 3)', () => {
  // primClip was the last documented-spare lane: xyz = shell clip normal,
  // w = 0 always. glow= now rides w on BOTH branches — the shell branch and
  // the plain one — because a glowing shell (a lit cable run authored as a
  // cloth sheet) must glow exactly like a glowing capsule.
  const base = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 1] as Vec3, radius: 0.1,
    scale: [1, 1, 1] as Vec3, blendK: 0.02, limb: 'torso' as const, cluster: 0,
  };
  const cluster = () =>
    ({ id: 0, limb: 'torso' as const, start: 0, count: 1, center: [0, 0, 0] as Vec3, radius: 0.1, alive: true });

  it('packs glow into primClip.w on a NON-shell prim', () => {
    const p = packBody({ prims: [{ ...base, color: [1, 0.13, 0] as Vec3, glow: 0.9 }], clusters: [cluster()], bones: new Map(), bonePrims: [] });
    expect(p.primClip[0]).toBe(0);
    expect(p.primClip[1]).toBe(0);
    expect(p.primClip[2]).toBe(0);
    expect(p.primClip[3]).toBeCloseTo(0.9, 6);
  });

  it('packs glow into primClip.w on a SHELL prim too — a glowing shell still glows', () => {
    const p = packBody({
      prims: [{
        ...base, color: [1, 0.13, 0] as Vec3, glow: 0.9,
        shell: { thickness: 0.004, rim: 0.01, clipOffset: 0, clipNormal: [0, 1, 0] as Vec3 },
      }],
      clusters: [cluster()], bones: new Map(), bonePrims: [],
    });
    expect(p.primClip[0]).toBe(0);
    expect(p.primClip[1]).toBeCloseTo(1, 6);
    expect(p.primClip[2]).toBe(0);
    expect(p.primClip[3]).toBeCloseTo(0.9, 6);
  });

  it('leaves primClip.w at 0 for a prim without glow — pre-glow rows stay byte-identical', () => {
    const p = packBody({ prims: [{ ...base }], clusters: [cluster()], bones: new Map(), bonePrims: [] });
    expect(Array.from(p.primClip.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('every shipped character packs primClip.w all-zero EXCEPT the minotaur, which authors exactly two glowing eyes', () => {
    // glow= is opt-in per prim: characters that do not author it must pack
    // byte-identically to before the lane existed, and the minotaur — the
    // task-3 acceptance character — must carry EXACTLY the two authored eye
    // prims (one per side; mirror expansion doubles the authored line), so
    // an accidental glow= somewhere else is caught here.
    for (const [name, raw] of Object.entries(CHARACTERS)) {
      const built = buildBody(compileBlob(parseBlob(raw)), DEFAULT_BUILD_OPTS);
      const packed = packBody(built);
      let glowing = 0;
      for (let i = 0; i < built.prims.length; i++) {
        if (Math.abs(packed.primClip[i * PRIM_STRIDE + 3]!) > 0) glowing++;
      }
      if (name === 'minotaur.blob') {
        expect(glowing).toBe(2);
      } else {
        expect(glowing).toBe(0);
      }
    }
  });
});

describe('bound groups (the fold cull unit)', () => {
  const body = () => buildBody(compileBlob(parseBlob(schoolgirlSrc)));

  it('cover every prim of every cluster, contiguously, in fold order', () => {
    const b = body();
    const p = packBody(b);
    // Walk clusters through clusterGroups: each span's groups must tile the
    // cluster's [start, start+count) exactly — fold order is the correctness
    // argument for culling by group at all.
    b.clusters.forEach((c, ci) => {
      const first = p.clusterGroups[ci * 4]!;
      const n = p.clusterGroups[ci * 4 + 1]!;
      let next = c.start;
      for (let g = first; g < first + n; g++) {
        expect(p.groupRange[g * 4]).toBe(next);
        next += p.groupRange[g * 4 + 1]!;
      }
      expect(next).toBe(c.start + c.count);
    });
  });

  it('keeps every group sphere at or under GROUP_RADIUS_MAX unless it is a single prim', () => {
    const p = packBody(body());
    for (let g = 0; g < p.groupCount; g++) {
      if (p.groupRange[g * 4 + 1]! > 1)
        expect(p.groupBounds[g * 4 + 3]).toBeLessThanOrEqual(GROUP_RADIUS_MAX + 1e-6);
    }
  });

  it('contains each member prim inside its group sphere (cull soundness)', () => {
    const b = body();
    const p = packBody(b);
    for (let g = 0; g < p.groupCount; g++) {
      const start = p.groupRange[g * 4]!, n = p.groupRange[g * 4 + 1]!;
      const cx = p.groupBounds[g * 4]!, cy = p.groupBounds[g * 4 + 1]!, cz = p.groupBounds[g * 4 + 2]!, r = p.groupBounds[g * 4 + 3]!;
      for (let i = start; i < start + n; i++) {
        const prim = b.prims[i]!;
        if (prim.op === 'sub') continue; // carves are excluded from the fit, as in clusters
        const reach = Math.max(prim.radius, prim.radiusB ?? prim.radius)
          * Math.max(prim.scale[0], prim.scale[1], prim.scale[2]);
        for (const q of [prim.a, prim.b]) {
          const d = Math.hypot(q[0] - cx, q[1] - cy, q[2] - cz);
          expect(d + reach).toBeLessThanOrEqual(r + 1e-6);
        }
      }
    }
  });

  it('singleGroup mirrors the clusters one-to-one (the chunk path)', () => {
    const b = body();
    const p = packBody(b, undefined, { singleGroup: true });
    expect(p.groupCount).toBe(b.clusters.length);
    b.clusters.forEach((c, ci) => {
      expect(p.groupRange[ci * 4]).toBe(c.start);
      expect(p.groupRange[ci * 4 + 1]).toBe(c.count);
      expect(p.groupBounds[ci * 4 + 3]).toBeCloseTo(c.radius, 6);
    });
  });

  it("fitSphere (via boundGroups) covers a sharp box's corner, not just the capsule radius", () => {
    // A lone dead-sharp box (round=0), radius 0.1, degenerate a===b so its
    // own position is the group center. Corner reach = 0.1*sqrt(3) ~ 0.1732;
    // a capsule of the same radius would only need 0.1.
    const p: Primitive = {
      a: [0, 0, 0], b: [0, 0, 0], radius: 0.1, scale: [1, 1, 1], blendK: 0,
      limb: 'torso', cluster: 0, box: { round: 0 },
    };
    const groups = boundGroups([p], 0, 1);
    expect(groups[0]!.radius).toBeGreaterThanOrEqual(0.1 * Math.sqrt(3) - 1e-9);
  });
});

describe('bone prims (wound pass r2)', () => {
  it('encodes op bone as primScale.w = 4', () => {
    const bone: Primitive = {
      a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.03,
      scale: [1, 1, 1], blendK: 0, limb: 'legL', cluster: 0, op: 'bone',
    };
    const flesh: Primitive = { ...bone, radius: 0.08, op: undefined };
    const packed = packBody({
      prims: [flesh, bone],
      clusters: [{ id: 0, limb: 'legL', start: 0, count: 2, center: [0, 0.15, 0], radius: 0.2, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_ADD);
    expect(packed.primScale[PRIM_STRIDE + 3]).toBe(W_BONE);
  });

  it('dead outranks bone, exactly as it outranks carve', () => {
    const bone: Primitive = {
      a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.03,
      scale: [1, 1, 1], blendK: 0, limb: 'legL', cluster: 0,
      op: 'bone', dead: true,
    };
    const packed = packBody({
      prims: [bone],
      clusters: [{ id: 0, limb: 'legL', start: 0, count: 1, center: [0, 0.15, 0], radius: 0.2, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_DEAD);
  });
});

describe('bone rows (wound pass r2)', () => {
  const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const bound = bindRig(built);
  const posed = applyRig(built, bound);

  it('writes bones after the flesh with W_BONE, and counts them', () => {
    expect(built.bonePrims.length).toBeGreaterThan(0);
    const packed = packBody(posed);
    expect(packed.boneCount).toBe(posed.bonePrims.length);
    for (let k = 0; k < packed.boneCount; k++) {
      const o = (packed.primCount + k) * PRIM_STRIDE;
      expect(packed.primScale[o + 3]).toBe(W_BONE);
      // Endpoints ride the SAME rows the flesh uses — the shader's bone pass
      // reads them with the ordinary sdPrim machinery at [counts.x, +boneCount).
      const bone = posed.bonePrims[k]!;
      expect(packed.primA[o]).toBe(f32(bone.a[0]));
      expect(packed.primA[o + 1]).toBe(f32(bone.a[1]));
      expect(packed.primA[o + 2]).toBe(f32(bone.a[2]));
      expect(packed.primA[o + 3]).toBe(f32(bone.radius));
    }
    // Rows past the bones stay zero — no stale data from a previous occupant.
    const o = (packed.primCount + packed.boneCount) * PRIM_STRIDE;
    expect(packed.primScale[o + 3]).toBe(0);
  });

  it('carries rest rows for bones at the same index as the posed bones', () => {
    const packed = packBody(posed, built);
    for (let k = 0; k < packed.boneCount; k++) {
      const o = (packed.primCount + k) * PRIM_STRIDE;
      const rest = built.bonePrims[k]!;
      expect(packed.restA[o]).toBe(f32(rest.a[0]));
      expect(packed.restA[o + 3]).toBe(f32(rest.radius));
    }
  });

  it('severing a limb drops its bones from the packed output', () => {
    const { body: severed } = severLimb(posed, 'legL');
    const packedSevered = packBody(severed, built);
    const legLBones = posed.bonePrims.filter(b => b.limb === 'legL').length;
    expect(legLBones).toBeGreaterThan(0);
    expect(packedSevered.boneCount).toBe(posed.bonePrims.length - legLBones);
    // The surviving bone rows are the OTHER clusters' bones, still W_BONE.
    for (let k = 0; k < packedSevered.boneCount; k++) {
      const o = (packedSevered.primCount + k) * PRIM_STRIDE;
      expect(packedSevered.primScale[o + 3]).toBe(W_BONE);
    }
    // And the flesh rows are untouched — severing flags a cluster, it does
    // not touch the prim array, and bones must not change that.
    expect(packedSevered.primCount).toBe(posed.prims.length);
  });
});

describe('organ prims (organs r3)', () => {
  const mk = (op: 'bone' | 'organ'): Primitive => ({
    a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.03,
    scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, op,
  });

  it('encodes op organ as primScale.w = 5', () => {
    const packed = packBody({
      prims: [], bonePrims: [mk('organ')],
      clusters: [{ limb: 'torso', start: 0, count: 0, center: [0, 0.15, 0], radius: 0.2, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_ORGAN);
  });

  it('packs organs and bones into the same range, distinguished only by w', () => {
    const packed = packBody({
      prims: [], bonePrims: [mk('bone'), mk('organ')],
      clusters: [{ limb: 'torso', start: 0, count: 0, center: [0, 0.15, 0], radius: 0.2, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.boneCount).toBe(2);
    expect(packed.primScale[3]).toBe(W_BONE);
    expect(packed.primScale[PRIM_STRIDE + 3]).toBe(W_ORGAN);
  });

  it('dead still outranks organ', () => {
    const packed = packBody({
      prims: [], bonePrims: [{ ...mk('organ'), dead: true }],
      clusters: [{ limb: 'torso', start: 0, count: 0, center: [0, 0.15, 0], radius: 0.2, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_DEAD);
  });

  it('an organ row is bit-identical to the same prim packed as bone, except primScale.w (task 6 gate 1)', () => {
    // The off-state claim: a body with no organ prims packs bit-for-bit as
    // before. True iff the organ op touches ONLY the w column — every other
    // packed value must flow the identical code path. Compare every packed
    // array in full between the same prim labelled bone and labelled organ.
    const mkClusters = () => [{ limb: 'torso', start: 0, count: 0, center: [0, 0.15, 0], radius: 0.2, alive: true }];
    const boneRows = packBody({
      prims: [], bonePrims: [mk('bone')], clusters: mkClusters(),
    } as unknown as BuiltBody);
    const organRows = packBody({
      prims: [], bonePrims: [mk('organ')], clusters: mkClusters(),
    } as unknown as BuiltBody);
    const arrays = ['primA', 'primB', 'primQuat', 'primShape', 'primBend',
      'primColor', 'primShell', 'primClip', 'restA', 'restB',
      'clusterBounds', 'clusterRange'] as const;
    for (const key of arrays) {
      expect(Array.from(organRows[key]), key).toEqual(Array.from(boneRows[key]));
    }
    // primScale: identical everywhere except the one w lane, 4 -> 5.
    const scaleA = Array.from(boneRows.primScale);
    const scaleO = Array.from(organRows.primScale);
    expect(scaleO[3]).toBe(W_ORGAN);
    expect(scaleA[3]).toBe(W_BONE);
    scaleO[3] = scaleA[3]!;
    expect(scaleO).toEqual(scaleA);
    expect(boneRows.boneCount).toBe(organRows.boneCount);
  });
});

describe('packBones (bone tubes)', () => {
  // Same fixture shape the organ tests above use: a couple of flesh prims,
  // bone AND organ rows in bonePrims, one alive cluster.
  const bodyWithBonesAndOrgans = () => ({
    prims: [
      { a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.05, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, op: 'add' },
    ],
    bonePrims: [
      { a: [0, 0, 0], b: [0, 0.2, 0], radius: 0.02, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, op: 'bone' },
      { a: [0, 0.05, 0], b: [0, 0.1, 0], radius: 0.03, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, op: 'organ' },
      { a: [0, 0.1, 0], b: [0, 0.15, 0], radius: 0.02, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, op: 'bone' },
    ],
    clusters: [{ limb: 'torso', start: 0, count: 1, center: [0, 0.15, 0], radius: 0.2, alive: true }],
  } as unknown as BuiltBody);

  it('default packs bones and organs exactly as before', () => {
    const body = bodyWithBonesAndOrgans();
    const a = packBody(body);
    const b = packBody(body, undefined, { packBones: true });
    expect(a.boneCount).toBe(b.boneCount);
    expect(Array.from(a.primScale)).toEqual(Array.from(b.primScale));
  });

  it('packBones:false skips bone rows, keeps organs, and boneCount counts organs', () => {
    const body = bodyWithBonesAndOrgans();
    const organs = (body.bonePrims ?? []).filter(p => p.op === 'organ' && body.clusters[p.cluster]?.alive).length;
    const p = packBody(body, undefined, { packBones: false });
    expect(p.boneCount).toBe(organs);
    for (let i = body.prims.length; i < body.prims.length + p.boneCount; i++) {
      expect(p.primScale[i * PRIM_STRIDE + 3]).toBe(W_ORGAN);
    }
  });
});
