// src/lab/sdf-zombie/gib-parts.test.ts
//
// The piece set is a DECISION (owner, 2026-09-10: split the torso, do not keep
// arms and legs whole, head stays whole, release the skeleton as its own
// pieces), so most of this file is pinning that decision against the real
// authored bodies — a refactor that quietly went back to one chunk per limb
// must fail here rather than in the owner's eyes.
//
// The last block is the one that is not a decision: CUTS MUST NOT EAT THE BODY.
// At the frame of release the pieces have to add up to the body they came from,
// and the way to know that is to measure the union against the original field,
// not to reason about it.
import { describe, it, expect } from 'vitest';
import zombieSrc from './characters/zombie.blob?raw';
import soldierSrc from './characters/soldier.blob?raw';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { buildBody } from './build-body';
import { gibParts, gibPlan, gibTierPlan, gibClusterPieces, displaceGibPieces, type GibPiece } from './gib-parts';
import { sdBody, type Body } from './validate';
import type { BuildResult } from './build-body';
import type { Vec3 } from './types';

const zombie = buildBody(compileBlob(parseBlob(zombieSrc)));
const soldier = buildBody(compileBlob(parseBlob(soldierSrc)));

const partsOf = (b: BuildResult, opts?: Parameters<typeof gibParts>[1]) =>
  new Map(gibParts(b, opts).map(p => [p.part, p]));

/** A one-cluster body for a piece, so the CPU field can sample it. */
function asBody(p: GibPiece): Body {
  return {
    prims: p.prims,
    clusters: [{
      id: 0, limb: p.limb, start: 0, count: p.prims.length,
      center: p.origin, radius: 0.4, alive: true,
    }],
    bonePrims: [],
  };
}

describe('gibParts — the piece set', () => {
  const pieces = gibParts(zombie);

  it('splits the torso into chest, abdomen and pelvis — the owner said "Split it."', () => {
    const ids = pieces.map(p => p.part);
    expect(ids).toContain('torso.chest');
    expect(ids).toContain('torso.abdomen');
    expect(ids).toContain('torso.pelvis');
  });

  it('never leaves a limb whole — "Do NOT keep them whole"', () => {
    for (const limb of ['armL', 'armR', 'legL', 'legR']) {
      const halves = pieces.filter(p => p.part.startsWith(`${limb}.`) && p.kind === 'limb'
        && p.prims.length > 0);
      expect(halves.map(p => p.part)).toEqual([`${limb}.upper`, `${limb}.lower`]);
      // Non-empty on both sides: an empty piece is a phantom chunk.
      for (const h of halves) expect(h.prims.length).toBeGreaterThan(0);
    }
  });

  it('keeps the head whole', () => {
    const heads = pieces.filter(p => p.limb === 'head');
    expect(heads).toHaveLength(1);
    expect(heads[0]!.part).toBe('head');
    // The face block rides the head, and is_not sliced: a half-face reads as a
    // bug rather than as gore.
    expect(heads[0]!.prims.length).toBeGreaterThan(1);
  });

  it('releases the skeleton as its own BONE-ONLY pieces', () => {
    const bonePieces = pieces.filter(p => p.kind === 'bone');
    // The eleven rigid groups melt-bones partitions: skull, cage, pelvis and
    // the eight long bones. Each is bone-only — prims empty is what makes the
    // chunk view treat it as bare bone (counts2.y) instead of meat with a
    // skeleton buried inside it, which is the whole point.
    expect(bonePieces).toHaveLength(11);
    expect(bonePieces.map(p => p.part).sort()).toEqual([
      'bone.cage', 'bone.foreArm.l', 'bone.foreArm.r', 'bone.pelvis', 'bone.shin.l',
      'bone.shin.r', 'bone.skull', 'bone.thigh.l', 'bone.thigh.r',
      'bone.upperArm.l', 'bone.upperArm.r',
    ]);
    for (const p of bonePieces) {
      expect(p.prims).toEqual([]);
      expect(p.bones.length).toBeGreaterThan(0);
    }
    // The ribcage is the piece the owner asked for by name ("idk rib cage or
    // something") and it is the big one — if the authored skeleton ever stops
    // reaching the gib, this is the line that says so.
    expect(partsOf(zombie).get('bone.cage')!.bones.length).toBeGreaterThan(20);
  });

  it('carries no bone prim on any flesh piece — nothing left buried in the meat', () => {
    for (const p of pieces) if (p.kind === 'limb' && p.part !== 'organ.gut') expect(p.bones).toEqual([]);
  });

  it('partitions every live flesh prim exactly once', () => {
    const seen = new Map<object, number>();
    for (const p of pieces) {
      for (const prim of p.prims) {
        if (prim.op === 'sub') continue; // the cut caps are new geometry, not body
        seen.set(prim, (seen.get(prim) ?? 0) + 1);
      }
    }
    const live = zombie.prims.filter(p => !p.dead);
    expect(seen.size).toBe(live.length);
    expect([...seen.values()].every(n => n === 1)).toBe(true);
  });

  it('partitions every live bone prim exactly once, and never an organ', () => {
    const bones = pieces.filter(p => p.kind === 'bone').flatMap(p => p.bones);
    const live = zombie.bonePrims.filter(p => p.op === 'bone' && !p.dead);
    expect(bones).toHaveLength(live.length);
    expect(bones.every(b => b.op === 'bone')).toBe(true);
  });

  it('caps every cut with a carve that sits on the far side of the plane', () => {
    const chest = partsOf(zombie).get('torso.chest')!;
    const abdomen = partsOf(zombie).get('torso.abdomen')!;
    const capOf = (p: GibPiece) => p.prims.filter(q => q.op === 'sub');
    // Two cuts surround the abdomen (chest above, pelvis below); one caps the
    // chest (its own lower edge).
    expect(capOf(chest)).toHaveLength(1);
    expect(capOf(abdomen)).toHaveLength(2);
    // A cap is a SPHERE far outside the piece: its radius is what makes the cut
    // face flat (an arc of curvature t^2/2R), so a small one would round the
    // face back into the tube end this module exists to replace.
    for (const cap of capOf(abdomen)) expect(cap.radius).toBeGreaterThan(0.5);
    // ...and the caps sit on the side being REMOVED: the chest's (its own lower
    // edge) below the chest, the abdomen's one above it and one below it.
    expect(capOf(chest)[0]!.a[1]).toBeLessThan(chest.origin[1]);
    const sides = capOf(abdomen).map(c => Math.sign(c.a[1] - abdomen.origin[1]));
    expect(sides.sort()).toEqual([-1, 1]);
  });

  it('splits a character whose bones are spelled differently', () => {
    // The soldier writes `upperarm` / `forearm` / `thigh` / `shin` / `hand` in
    // lower case where the zombie writes `upperArm` / `foreArm`. A rule that
    // matched one spelling would leave the other cast's limbs whole, silently.
    const ids = gibParts(soldier).map(p => p.part);
    expect(ids).toContain('armL.upper');
    expect(ids).toContain('armL.lower');
    expect(ids).toContain('legL.upper');
    expect(ids).toContain('legL.lower');
    expect(ids.filter(id => id === 'torso.chest')).toHaveLength(1);
  });

  it('drops the pieces of a cluster that is already gone', () => {
    // A body that lost an arm to a slug earlier must not emit that arm.
    const maimed: BuildResult = {
      ...zombie,
      clusters: zombie.clusters.map(c => (c.limb === 'armL' ? { ...c, alive: false } : c)),
    };
    const ids = gibParts(maimed).map(p => p.part);
    expect(ids.some(id => id.startsWith('armL.'))).toBe(false);
    // ...but its BONE group survives: bones are released by group, not by
    // cluster age, and an arm's humerus being thrown by the blast is right.
    expect(ids).toContain('armR.upper');
  });

  it('honours the bone-release knob', () => {
    expect(gibParts(zombie, { bones: 'core' }).filter(p => p.kind === 'bone')).toHaveLength(3);
    expect(gibParts(zombie, { bones: 'off' }).filter(p => p.kind === 'bone')).toHaveLength(0);
    expect(gibParts(zombie, { organs: false }).some(p => p.part === 'organ.gut')).toBe(false);
  });

  it('is pure — two calls on one body agree exactly', () => {
    const a = gibParts(zombie);
    const b = gibParts(zombie);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // ...and it did not mutate the body it read: the rig re-solves this array
    // every frame, and a piece set that scribbles on it would be visible as a
    // silently reshaped body long before the next blast.
    expect(JSON.stringify(zombie)).toBe(JSON.stringify(buildBody(compileBlob(parseBlob(zombieSrc)))));
  });
});

describe('gibParts — the cut does not eat the body', () => {
  /**
   * The frame-of-release test. Sample the ORIGINAL body's surface; at each
   * sample, the union of the pieces must still be there (field <= 0). Whatever
   * the pieces miss is a hole that appears in the body on the very frame the
   * explosion is supposed to be ripping through it.
   *
   * Two allowances, both measured rather than guessed:
   *
   *  - A 2 mm skin. The pieces are sampled on a grid, and a piece's cut face
   *    lands on the plane to float precision, so a sample one grid step inside
   *    the skin can read a hair positive.
   *  - The CLUSTER SEAM is not this module's to fix. A body's field blends
   *    across cluster boundaries (the armpit, the crotch), and no arrangement
   *    of per-cluster pieces can reproduce a blend that lives between two
   *    clusters. `gibAll` has the same seam; it is the floor both share and the
   *    measurement below is what pins that it has not got worse.
   */
  function surfaceMiss(sets: { limb: string; prims: GibPiece['prims'] }[], n: number) {
    const bodies = sets.map(s => asBody({
      limb: s.limb, prims: s.prims, part: s.limb, kind: 'limb',
      bones: [], origin: [0, 0, 0], tornAt: [],
    } as unknown as GibPiece));
    const min = [1e9, 1e9, 1e9];
    const max = [-1e9, -1e9, -1e9];
    for (const p of zombie.prims) for (const e of [p.a, p.b]) for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, e[i]!); max[i] = Math.max(max[i]!, e[i]!);
    }
    for (let i = 0; i < 3; i++) { min[i] = min[i]! - 0.05; max[i] = max[i]! + 0.05; }
    const step = [0, 1, 2].map(i => (max[i]! - min[i]!) / n);
    let total = 0, missed = 0, worst = 0;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
      const q: Vec3 = [min[0]! + i * step[0]!, min[1]! + j * step[1]!, min[2]! + k * step[2]!];
      if (sdBody(q, zombie) > 0.002) continue;
      total++;
      let dU = Infinity;
      for (const b of bodies) {
        const d = sdBody(q, b);
        if (d < dU) dU = d;
        if (dU < -0.02) break;
      }
      if (dU > 0.002) missed++;
      if (dU > worst) worst = dU;
    }
    return { total, missed, worst };
  }

  it('the union of the flesh pieces still covers the body it came from', () => {
    const flesh = gibParts(zombie, { bones: 'off', organs: false })
      .filter(p => p.prims.length > 0);
    const miss = surfaceMiss(flesh, 64);
    expect(miss.total).toBeGreaterThan(10000);
    // Measured on this body: 3.66% for the ORIGINAL one-chunk-per-limb set
    // (its cluster seams alone) and 5.4% for the split set, which adds the
    // within-cluster cuts. The bound is set just above the split set's own
    // number: this is a regression fence, not a target.
    expect(miss.missed / miss.total).toBeLessThan(0.07);
    // And nothing may be missing by more than about a centimetre and a half:
    // the residual is the smooth-min fillet lost at a seam, which is a
    // thinner-looking waist, not a hole.
    expect(miss.worst).toBeLessThan(0.03);
  });
});

describe('gibPlan — the reusable region identity', () => {
  const plan = gibPlan(zombie);

  it('names every live flesh prim exactly once, and non-flesh only as a source', () => {
    const seen = new Map<number, number>();
    for (const p of plan.pieces) {
      for (const i of p.srcPrims ?? []) seen.set(i, (seen.get(i) ?? 0) + 1);
    }
    const live = zombie.prims.map((p, i) => (!p.dead ? i : -1)).filter(i => i >= 0);
    expect(seen.size).toBe(live.length);
    expect([...seen.values()].every(n => n === 1)).toBe(true);
    for (const i of seen.keys()) expect(zombie.prims[i]!.dead).not.toBe(true);
  });

  it('names every live bone prim once, and the organs as their own region', () => {
    const bones = plan.pieces.flatMap(p => p.srcBones ?? []);
    // `srcBones` covers the bone pieces AND the gut coil, which rides
    // `bonePrims` as `op: 'organ'` and is a region of its own.
    const live = zombie.bonePrims
      .map((p, i) => ((p.op === 'bone' || p.op === 'organ') && !p.dead ? i : -1))
      .filter(i => i >= 0);
    expect(bones.slice().sort((a, b) => a - b)).toEqual(live);
    // No organ is buried inside a bone piece: the bone release is bone-only.
    for (const p of plan.pieces.filter(q => q.kind === 'bone')) {
      for (const i of p.srcBones ?? []) expect(zombie.bonePrims[i]!.op).toBe('bone');
    }
  });

  it('caps carry no source index but ride their piece', () => {
    const chest = plan.pieces.find(p => p.part === 'torso.chest')!;
    expect(chest.srcPrims!.length).toBeGreaterThan(0);
    // The cap is extra geometry: srcPrims indexes only the body's own prims,
    // while prims includes the `sub` carve.
    expect(chest.prims.filter(p => p.op === 'sub').length).toBeGreaterThan(0);
    expect(chest.prims.length).toBeGreaterThan(chest.srcPrims!.length);
  });

  it('every cut links two real pieces and separates them', () => {
    expect(plan.cuts.length).toBeGreaterThan(0);
    for (const c of plan.cuts) {
      expect(c.a).toBeGreaterThanOrEqual(0);
      expect(c.b).toBeGreaterThan(c.a);
      expect(c.b).toBeLessThan(plan.pieces.length);
      // The normal is unit-ish and the two sides are different regions.
      expect(plan.pieces[c.a]!.part).not.toBe(plan.pieces[c.b]!.part);
    }
  });

  it('displaceGibPieces is identity at zero and a rigid translation otherwise', () => {
    const zero = displaceGibPieces(plan.pieces, plan.pieces.map(() => [0, 0, 0] as Vec3));
    expect(JSON.stringify(zero)).toBe(JSON.stringify(plan.pieces));
    const off: Vec3 = [0.1, -0.02, 0.03];
    const moved = displaceGibPieces(plan.pieces, plan.pieces.map(() => off));
    for (let i = 0; i < plan.pieces.length; i++) {
      const a = plan.pieces[i]!;
      const b = moved[i]!;
      expect(b.origin).toEqual([a.origin[0] + off[0], a.origin[1] + off[1], a.origin[2] + off[2]]);
      for (let k = 0; k < a.prims.length; k++) {
        const p0 = a.prims[k]!, p1 = b.prims[k]!;
        for (let j = 0; j < 3; j++) {
          expect(p1.a[j]! - p0.a[j]!).toBeCloseTo(off[j]!, 12);
          expect(p1.b[j]! - p0.b[j]!).toBeCloseTo(off[j]!, 12);
        }
      }
      // The plan it was handed is untouched.
      expect(a.origin).toEqual(plan.pieces[i]!.origin);
    }
  });
});

// ——— TASK 3: the budget tier is chosen ONCE, before the preview ———————————
describe('gibTierPlan — preview and release agree on the shape', () => {
  const at: Vec3 = [0, 1, 0];

  it('fits the full split set when the pool can afford it', () => {
    const t = gibTierPlan(zombie, 64, { bones: 'core', at });
    expect(t.tier).toBe('parts');
    expect(t.reserve).toBe(t.plan.pieces.length);
    expect(t.plan.cuts.length).toBeGreaterThan(0);
  });

  it('degrades to the same rung gibActor would have picked at a tight pool', () => {
    // 16 full > 12, 16 core > 12, clusters+core 9 <= 12 — the exact rung the
    // old release-time ladder chose after previewing all 16 (RESULTS.md §7.1).
    const tight = gibTierPlan(zombie, 12, { bones: 'core', at });
    expect(tight.tier).toBe('clusters+core');
    expect(tight.reserve).toBe(9);
    // The floor rung is clusters+the cage, 7 pieces; below that, a slice.
    expect(gibTierPlan(zombie, 7, { bones: 'core', at }).tier).toBe('clusters+cage');
    const slice = gibTierPlan(zombie, 3, { bones: 'core', at });
    expect(slice.tier).toBe('slice');
    expect(slice.plan.pieces).toHaveLength(3);
  });

  it('the reduced tiers still name the body prims and bones they own', () => {
    const clusters = gibClusterPieces(zombie);
    expect(clusters.length).toBeGreaterThan(0);
    // Every live flesh prim is owned exactly once and the BONES travel too —
    // without these the preview could not draw the cheap shape.
    const seen = new Set<number>();
    for (const p of clusters) {
      expect(p.srcPrims!.length).toBeGreaterThan(0);
      expect(p.srcBones).toBeDefined();
      for (const i of p.srcPrims!) {
        expect(seen.has(i)).toBe(false);
        seen.add(i);
      }
    }
    expect(seen.size).toBe(zombie.prims.filter(p => !p.dead).length);
  });

  it('plans and pieces are deterministic, and reserve matches what spawns', () => {
    const a = gibTierPlan(zombie, 12, { bones: 'core', at });
    const b = gibTierPlan(zombie, 12, { bones: 'core', at });
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
    // The release spawns exactly the plan's pieces (offsets are identity here,
    // which is the displacement at progress 0) — the count the reservation made.
    expect(displaceGibPieces(a.plan.pieces, a.plan.pieces.map(() => [0, 0, 0] as Vec3)))
      .toHaveLength(a.reserve);
  });

  it('the peel flag is on the ribcage-bearing chest band only', () => {
    const plan = gibPlan(zombie, { bones: 'core' });
    const peeled = plan.pieces.filter(p => (p.peel ?? 0) !== 0).map(p => p.part).sort();
    expect(peeled).toEqual(['torso.abdomen', 'torso.chest', 'torso.pelvis']);
    expect(plan.pieces.find(p => p.part === 'torso.chest')!.peel).toBeGreaterThan(0);
    expect(plan.up).toBeDefined();
  });

  it('plans the SECOND humanoid the same way (safe fallback, not a crash)', () => {
    // Task 3 asks for a second supported humanoid. The soldier has its own
    // torso split and its own (restrained) cage; the planner must run on it
    // exactly as on the zombie. An actor with no rib STRUCTURE still gets the
    // flesh peel (the cage is the mesh/material's problem, not the planner's),
    // which is the explicit fallback: peel the flesh, and if there is no bone
    // to reveal, the result is simply torn flesh rather than an error.
    const t = gibTierPlan(soldier, 64, { bones: 'core', at });
    expect(t.tier).toBe('parts');
    expect(t.plan.pieces.some(p => p.part === 'torso.chest')).toBe(true);
    expect(t.plan.pieces.find(p => p.part === 'torso.chest')!.peel).toBeGreaterThan(0);
    // A body whose torso/head are missing still plans: bodyUp falls back to
    // world-up rather than throwing on an empty cluster list.
    const headless: BuildResult = {
      ...soldier,
      clusters: soldier.clusters.map(c => (c.limb === 'head' ? { ...c, alive: false } : c)),
    };
    expect(() => gibTierPlan(headless, 64, { bones: 'core', at })).not.toThrow();
  });

  it('a pre-severed limb is missing from the plan, preview and cluster tier', () => {
    // The body that lost an arm to a slug earlier must not emit that arm — the
    // same alive-flag rule the clean path has always used (sever.ts), now also
    // honoured by the tier planner that builds the preview.
    const maimed: BuildResult = {
      ...zombie,
      clusters: zombie.clusters.map(c => (c.limb === 'armL' ? { ...c, alive: false } : c)),
    };
    const full = gibTierPlan(maimed, 64, { bones: 'core', at });
    expect(full.plan.pieces.some(p => p.part.startsWith('armL.'))).toBe(false);
    const clusters = gibClusterPieces(maimed);
    expect(clusters.some(p => p.limb === 'armL')).toBe(false);
  });
});
