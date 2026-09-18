// src/lab/sdf-zombie/webgpu/fire-capsules.ts
//
// THE FIRE FIELD'S SOURCES (burning-feedback round 2, task 4a). A burning body
// is represented to the volumetric pass as a small set of capsules — the
// fattest flesh primitives of each posed limb, plus one crown above the head —
// so both the lab and (round 3) the game derive the same field from the same
// posed BuildResult the flame cards already ride. Pure: reads a posed
// BuildResult, never a renderer.
//
// WHY CAPSULES AT ALL. The volumetric march cannot sample the SDF field itself
// (it runs as a post pass, long after the march target exists). What it CAN
// sample is a handful of analytic capsules, which is exactly the wildfire
// architecture: a low-res field of smooth blobs fed per body, warped by the
// shared curl volume, and composited under the crisp card accents.
//
// THE RULE. Per cluster, in CLUSTER_ORDER, keep the fattest additive,
// unpainted prims (the headShape filter — painted hair/hats out-size the skull
// they cover). Two per limb, three for the torso; a head crown sits above the
// skull. The result is capped at FIRE_CAPSULES_PER_BODY.

import { CLUSTER_ORDER, type LimbId, type Vec3 } from '../types';
import type { BuildResult } from '../build-body';
import type { Primitive } from '../types';
import { headShape } from './flame-anchors';

/** The hard cap the packer's stride budget assumes (8 bodies x 16 capsules). */
export const FIRE_CAPSULES_PER_BODY = 16;

/** How many of a limb's fattest flesh prims become fire capsules. */
const PER_LIMB: Readonly<Record<LimbId, number>> = Object.freeze({
  head: 2, torso: 3, armL: 2, armR: 2, legL: 2, legR: 2,
});

export interface FireCapsule {
  /** Endpoints in world metres (the posed field's own coordinates). */
  a: Vec3;
  b: Vec3;
  /** Capsule radius, world metres. */
  radius: number;
  /** The limb this capsule belongs to, or 'crown' for the head cap. */
  limb: LimbId | 'crown';
  /** True for the one crown capsule. */
  crown: boolean;
  /** 'add' for a flesh primitive, 'crown' for the head cap. */
  source: 'add' | 'crown';
}

/** The fatness metric headShape uses: radius times the largest semi-axis. */
function fatness(p: Primitive): number {
  return p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
}

/**
 * The crown above the skull: a vertical capsule rising from 60% of the skull's
 * semi-height. Null when the body has no head cluster.
 */
export function fireCrown(b: BuildResult): FireCapsule | null {
  const skull = headShape(b);
  if (!skull) return null;
  const a: Vec3 = [skull.centre[0], skull.centre[1] + skull.axes[1] * 0.6, skull.centre[2]];
  const bEnd: Vec3 = [a[0], a[1] + 0.35, a[2]];
  return {
    a, b: bEnd,
    radius: Math.max(skull.axes[0], skull.axes[1], skull.axes[2]) * 0.8,
    limb: 'crown', crown: true, source: 'crown',
  };
}

/**
 * The burning body's fire capsules. Deterministic in the posed field: ranked by
 * fatness with index order as the tiebreak, so two runs of the same pose are
 * bit-identical (a capture A/B depends on it).
 */
export function fireCapsules(b: BuildResult): FireCapsule[] {
  const out: FireCapsule[] = [];
  for (const limb of CLUSTER_ORDER) {
    const cluster = b.clusters.find(c => c.limb === limb);
    if (!cluster || !cluster.alive) continue;
    const prims = b.prims.slice(cluster.start, cluster.start + cluster.count);
    // The headShape filter, exactly: additive, unpainted. Dead (severed) prims
    // are skipped as the field skips them.
    const flesh = prims.filter(p => p.op !== 'sub' && p.color === undefined && !p.dead);
    // Fattest first (fatness desc, index asc) — slice is stable in modern V8,
    // but the explicit index tiebreak documents the determinism contract.
    const ranked = flesh
      .map((p, i) => ({ p, i }))
      .sort((x, y) => fatness(y.p) - fatness(x.p) || x.i - y.i);
    const take = PER_LIMB[limb];
    for (let k = 0; k < Math.min(take, ranked.length); k++) {
      const p = ranked[k]!.p;
      out.push({
        a: p.a,
        b: p.b,
        // The world radius: the field divides by scale and multiplies by the
        // min semi-axis, so radius * max(scale) is the generous engulfing
        // bound a fire volume wants (a bare `radius` would leave thin limbs
        // with no flame).
        radius: p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]),
        limb, crown: false, source: 'add',
      });
      if (out.length >= FIRE_CAPSULES_PER_BODY) break;
    }
    if (out.length >= FIRE_CAPSULES_PER_BODY) break;
  }
  const crown = fireCrown(b);
  if (crown && out.length < FIRE_CAPSULES_PER_BODY) out.push(crown);
  return out.slice(0, FIRE_CAPSULES_PER_BODY);
}

/**
 * Per-capsule midpoint velocity (cur - prev) / dt. All zeros when the previous
 * frame is missing, the capsule count changed (a limb lit or severed), or dt
 * is not positive — a velocity the lag can trust, never a jump.
 */
export function capsuleVelocities(
  prev: readonly Pick<FireCapsule, 'a' | 'b'>[] | null,
  cur: readonly Pick<FireCapsule, 'a' | 'b'>[],
  dt: number,
): Vec3[] {
  const zero = (): Vec3 => [0, 0, 0];
  if (prev === null || dt <= 0 || prev.length !== cur.length) {
    return cur.map(zero);
  }
  const inv = 1 / dt;
  return cur.map((c, i) => {
    const p = prev[i]!;
    const pm0 = (p.a[0] + p.b[0]) * 0.5;
    const pm1 = (p.a[1] + p.b[1]) * 0.5;
    const pm2 = (p.a[2] + p.b[2]) * 0.5;
    const cm0 = (c.a[0] + c.b[0]) * 0.5;
    const cm1 = (c.a[1] + c.b[1]) * 0.5;
    const cm2 = (c.a[2] + c.b[2]) * 0.5;
    return [(cm0 - pm0) * inv, (cm1 - pm1) * inv, (cm2 - pm2) * inv];
  });
}
