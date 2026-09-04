// src/lab/sdf-zombie/melt-gate.test.ts
//
// MELT GATE A — the geometric half of "did the melt actually happen",
// measured on the real zombie.blob, in the suite, so it runs on every future
// change instead of living in a script someone remembers to run.
//
// WHY THIS GATE EXISTS: the previous attempt (c52b05b) shipped tested,
// green, correct-looking plumbing that produced literally zero visual change,
// and no test caught it. Any one of these three ratios would have failed it
// on its first run. THE THRESHOLDS ARE THE DEFINITION OF THE EFFECT — do not
// relax them to make a run pass. If a ratio misses, tune MELT_TUNING_BODY
// (crush drives height, spread drives width, poolHeight drives centroid).
//
// Width has a CEILING as well as a floor. Task 3's frames showed a melt that
// passed every lower bound by turning the zombie into a flat disc several
// metres across; "wider" is only right up to a point.
//
// FIXTURE NOTE — the body is placed ON THE FLOOR before measuring. The
// shipped zombie.blob floats: its lowest flesh extent is y≈0.199 above its
// local origin (verified in the live lab 2026-09-03 — the standing body
// hovers ~20 cm over the floor mesh). Melting the floating body pools goo at
// the world floor (poolHeight 0.09), which in prim space is BELOW the rest
// flesh bottom, and the AABB then "grows" downward mid-ramp while the crown
// is still up — a fixture artefact, not the melt rising. In any real scene
// the body stands on the floor, so the gate measures that body. The melt
// transform itself is untouched.
import { describe, it, expect } from 'vitest';
import src from './characters/zombie.blob?raw';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { buildBody } from './build-body';
import { translateBody } from './translate';
import { applyMelt, endpointHeights, MELT_TUNING_BODY, meltInitBody, stepMelt } from './melt';
import { makeChunk, stepChunk, type Chunk } from './gib-chunks';
import {
  boneChunkRadius, groupCentroid, groupReleaseProgress, limbOfGroup,
  releaseThreshold, meltBoneSpawnVel, mulberry32,
  partitionBones, releaseOrder, type BoneGroup,
} from './melt-bones';
import type { Primitive, Vec3 } from './types';

/** World AABB of a prim set, radius and per-axis scale included. */
function aabb(prims: readonly Primitive[]) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of prims) {
    const rx = p.radius * p.scale[0];
    const ry = p.radius * p.scale[1];
    const rz = p.radius * p.scale[2];
    for (const e of [p.a, p.b]) {
      x0 = Math.min(x0, e[0] - rx); x1 = Math.max(x1, e[0] + rx);
      y0 = Math.min(y0, e[1] - ry); y1 = Math.max(y1, e[1] + ry);
      z0 = Math.min(z0, e[2] - rz); z1 = Math.max(z1, e[2] + rz);
    }
  }
  return {
    height: y1 - y0,
    width: Math.max(x1 - x0, z1 - z0),
    centroid: prims.reduce((s, p) => s + (p.a[1] + p.b[1]) / 2, 0) / prims.length - y0,
  };
}

/** Lowest flesh extent — where the feet touch the floor. */
function floorY(prims: readonly Primitive[]) {
  let y = Infinity;
  for (const p of prims) for (const e of [p.a, p.b]) y = Math.min(y, e[1] - p.radius * p.scale[1]);
  return y;
}

/** The real zombie, floor-placed (see the fixture note above). */
function zombie() {
  const body = buildBody(compileBlob(parseBlob(src)));
  return translateBody(body, [0, -floorY(body.prims), 0]);
}

describe('MELT GATE — the end state must be shorter, wider and lower', () => {
  it('sinks, spreads and drops its centroid by progress 1', () => {
    const body = zombie();
    const rest = aabb(body.prims);

    let s = meltInitBody(body.prims, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    const end = aabb(applyMelt(body.prims, s));

    const h = end.height / rest.height;
    const w = end.width / rest.width;
    const c = end.centroid / rest.centroid;
    // Printed so a failure says WHICH property is missing, not just "false".
    console.log(`melt gate: height ${h.toFixed(2)}x  width ${w.toFixed(2)}x  centroid ${c.toFixed(2)}x`);

    expect(h).toBeLessThanOrEqual(0.40);
    expect(w).toBeGreaterThanOrEqual(1.50);
    expect(w).toBeLessThanOrEqual(3.00);
    expect(c).toBeLessThanOrEqual(0.25);
  });

  it('never grows taller at any point in the ramp', () => {
    const body = zombie();
    let s = meltInitBody(body.prims, 0);
    let prev = aabb(body.prims).height;
    for (let i = 0; i < 600; i++) {
      s = stepMelt(s, 1 / 60);
      const now = aabb(applyMelt(body.prims, s)).height;
      expect(now).toBeLessThanOrEqual(prev + 1e-6);
      prev = now;
    }
  });

  // ——— BONE SETTLE (task 6, step 0b) ————————————————————————————————————
  // Both silhouette gates measure height, width and centroid of the FLESH —
  // a puddle with no skeleton in it passes all six bounds, which is exactly
  // what Task 5's frames showed: meltDirect jumps progress instantly, the
  // capture shoots two frames later, and every bone was photographed at the
  // instant it was released, mid-air. This is the check those gates were
  // missing: simulate the release and the fall with the SAME pure pieces the
  // lab uses (melt-bones.ts spawn helpers + the gib-chunks stepper), and
  // require the skeleton to COME TO REST IN THE PUDDLE. A melt whose bones
  // flew away, never released, or sank through the floor is not a pass.
  it('at least 8 of the 11 bone groups come to rest inside the puddle', () => {
    const body = zombie();
    const parts = partitionBones(body.bonePrims);
    const order = releaseOrder(parts);
    expect(order).toHaveLength(11);
    const span = Math.max(...endpointHeights(body.prims));
    // The lab's seed (lab-main.ts MELT_BONE_SEED) — the gate must reproduce
    // the same tumble the capture photographs.
    const rng = mulberry32(20260903);

    /** Longest endpoint chord — the same rule lab-main's primsLongAxis uses. */
    const longAxis = (ps: readonly Primitive[]): Vec3 => {
      let best: Vec3 = [0, 1, 0]; let bestLen = 0;
      for (const p of ps) {
        const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
        const l = Math.hypot(...d);
        if (l > bestLen) { bestLen = l; best = d; }
      }
      return bestLen < 1e-6 ? [0, 1, 0]
        : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
    };

    // Release each group as the front passes it, spawn the chunk exactly as
    // lab-main's releaseMeltBones does (shared helpers, one formula), and
    // step the whole pile at the capture's fixed 1/60.
    const chunks: { g: BoneGroup; c: Chunk }[] = [];
    const released = new Set<BoneGroup>();
    let s = meltInitBody(body.prims, 0);
    while (s.t < 1) {
      s = stepMelt(s, 1 / 60);
      for (const g of order) {
        if (released.has(g)) continue;
        const prims = parts.get(g)!;
        const centroid = groupCentroid(prims);
        if (groupReleaseProgress(s, centroid[1], span) <= releaseThreshold(g)) continue;
        released.add(g);
        chunks.push({
          g,
          c: makeChunk(
            limbOfGroup(g), centroid,
            meltBoneSpawnVel(centroid, rng),
            boneChunkRadius(prims), longAxis(prims), rng, 'bone'),
        });
      }
      for (const ch of chunks) ch.c = stepChunk(ch.c, 1 / 60);
    }
    // Every group must have let go — a skeleton that never falls out is not
    // a melt either.
    expect(released.size).toBe(11);

    // Settle tail: the melt freezes at t = 1 but the bones keep falling —
    // the last groups (cage, skull) release with under half a second of fall
    // left in the ramp. Step until every chunk is grounded and slow.
    let settledFrames = 0;
    for (let i = 0; i < 600; i++) {
      settledFrames++;
      for (const ch of chunks) ch.c = stepChunk(ch.c, 1 / 60);
      const resting = chunks.every(ch =>
        Math.hypot(...ch.c.vel) < 0.05 && ch.c.pos[1] <= ch.c.radius + 1e-3);
      if (resting) break;
    }

    // The puddle they must rest IN: the melted flesh's XZ extent at t = 1.
    const pool = aabb(applyMelt(body.prims, s));
    const poolR = pool.width / 2;
    const maxY = MELT_TUNING_BODY.poolHeight * 3;
    const report = chunks.map(ch => {
      const [x, y, z] = ch.c.pos;
      const inPool = Math.hypot(x, z) <= poolR && y <= maxY;
      return `${ch.g}@(${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)})${inPool ? '' : ' OUT'}`;
    });
    const inside = chunks.filter(ch =>
      Math.hypot(ch.c.pos[0], ch.c.pos[2]) <= poolR
      && ch.c.pos[1] <= maxY).length;
    console.log(`bone settle: ${inside}/${chunks.length} groups in the puddle ` +
      `(poolR=${poolR.toFixed(2)}, maxY=${maxY.toFixed(2)}, settle ${settledFrames}f)  ` +
      report.join(' '));
    expect(inside).toBeGreaterThanOrEqual(8);
  });
});
