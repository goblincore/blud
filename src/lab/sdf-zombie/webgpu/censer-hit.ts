// src/lab/sdf-zombie/webgpu/censer-hit.ts
//
// THE CENSER'S WOUNDS (spec §4.1–4.2). Pure: the head's substep segment and the
// actors' signed-distance fields in; wound SPHERES out. The caller turns each
// sphere into a 'blast'-type wound (damage.ts worldHitToWound) and hands the
// batch to ZombieActor.blast(), which credits the collapse meter with the
// spheres' meterCredit directly and runs the sever checks.
//
//   first contact  → one CRATER at the surface under the head, sized by the
//                    head's speed INTO the surface against the stroke's
//                    reference speed (a graze below minInSpeed stamps nothing)
//   while inside   → a GOUGE sphere every gougeStep of travel, each gougeShrink
//                    smaller, up to the stroke's cap; ends when the head exits
//                    or stalls below gougeMinSpeed
//   every stamp    → the head loses speed (velScale), so it bounces out
//   once per stroke per body; a stroke that STARTS inside a body waits until
//   the head has left it (a zombie hugging the player is not wounded by a
//   resting censer).
//
// `sweepHead` MUTATES the per-stroke ledger it is given (`StrokeHits`).

import type { Vec3 } from '../types';
import { traceProjectile } from './game-weapon';

export const CENSER_HIT = {
  /** Tap (charge 0) and full-charge ends of every per-stroke number; lerped by charge. */
  tap: { craterR: 0.06, gougeMax: 3, speedRef: 9, meter: 0.1 },
  heavy: { craterR: 0.11, gougeMax: 6, speedRef: 16, meter: 0.3 },
  /** Floor on the speed factor: a slow but real hit still leaves a mark. */
  minSpeedFrac: 0.4,
  /** m/s into the surface below which a contact is a graze. */
  minInSpeed: 1.5,
  /** m/s below which a head inside the flesh has stalled and the gouge ends. */
  gougeMinSpeed: 2.0,
  gougeStep: 0.03,
  gougeShrink: 0.8,
  gougeMeterFrac: 0.25,
  /** A gouge sphere closer than this × the smaller radius to the last one is merged (skipped). */
  mergeFrac: 0.5,
  /** severRadius = radius × this: the carve union the sever test sees. */
  severMul: 1.15,
  absorbCrater: 0.35,
  absorbGouge: 0.12,
  /** Segment-to-torso distance past which a body is not tested at all, metres. */
  broadPhase: 1.35,
  gradEps: 0.005,
  /**
   * Matches game-weapon.ts's GRAPESHOT.hitEps: traceProjectile admits a
   * contact up to this far outside the true surface (a graze that never
   * reaches field<=0 still registers on the eps shell). The interior exit
   * test below must tolerate the same margin, or a shallow/tangential first
   * contact — stamped via that same eps shell a substep before the head has
   * actually crossed the true boundary — reads as "already outside" on the
   * very next substep and the gouge phase ends before it starts.
   */
  hitEps: 0.01,
} as const;

export interface ActorProbe {
  id: number;
  /** Broad-phase centre (the torso cluster). */
  centre: Vec3;
  /** The posed body's signed distance (sdBody). */
  field: (p: Vec3) => number;
}

export interface WoundSphere {
  at: Vec3;
  radius: number;
  severRadius: number;
  kind: 'crater' | 'gouge';
  meterCredit: number;
}

export interface HitEvent {
  actorId: number;
  spheres: WoundSphere[];
  /** Unit direction of the head's travel. */
  dir: Vec3;
  /** m/s into the surface at this stamp. */
  speedIn: number;
}

interface Contact {
  /** False until the head has been seen outside this body (stroke started inside). */
  armed: boolean;
  inside: boolean;
  done: boolean;
  stamps: number;
  last: Vec3;
  lastR: number;
  /** The crater's speed factor; the gouge credits scale with it. */
  k: number;
}

export interface StrokeHits {
  strokeId: number;
  charge: number;
  contacts: Map<number, Contact>;
}

export function makeStrokeHits(strokeId: number, charge: number): StrokeHits {
  return { strokeId, charge: Math.min(1, Math.max(0, charge)), contacts: new Map() };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3, fallback: Vec3): Vec3 => { const l = len(a); return l > 1e-9 ? scl(a, 1 / l) : fallback; };

export function hitTier(charge: number) {
  const T = CENSER_HIT.tap, H = CENSER_HIT.heavy;
  return {
    craterR: mix(T.craterR, H.craterR, charge),
    gougeMax: Math.round(mix(T.gougeMax, H.gougeMax, charge)),
    speedRef: mix(T.speedRef, H.speedRef, charge),
    meter: mix(T.meter, H.meter, charge),
  };
}

/** Outward unit normal of a field by central differences. */
export function surfaceNormal(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = CENSER_HIT.gradEps;
  const g: Vec3 = [
    field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
    field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
    field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
  ];
  return unit(g, [0, 1, 0]);
}

function segPointDist(a: Vec3, b: Vec3, p: Vec3): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}

export function sweepHead(
  hits: StrokeHits, from: Vec3, to: Vec3, vel: Vec3, headR: number, actors: readonly ActorProbe[],
): { events: HitEvent[]; velScale: number } {
  const C = CENSER_HIT;
  const T = hitTier(hits.charge);
  const events: HitEvent[] = [];
  let velScale = 1;
  for (const a of actors) {
    if (segPointDist(from, to, a.centre) > C.broadPhase + headR) continue;
    const outside = (p: Vec3) => a.field(p) - headR > 0;
    let c = hits.contacts.get(a.id);
    if (!c) {
      c = { armed: outside(from), inside: false, done: false, stamps: 0, last: [0, 0, 0], lastR: 0, k: 1 };
      hits.contacts.set(a.id, c);
    }
    if (c.done) continue;
    if (!c.armed) { if (outside(to)) c.armed = true; continue; }

    const v = scl(vel, velScale);
    const dir = unit(v, unit(sub(to, from), [0, 0, -1]));
    if (!c.inside) {
      const hp = traceProjectile(from, to, q => a.field(q) - headR);
      if (!hp) continue;
      const n = surfaceNormal(a.field, hp);
      const speedIn = -dot(v, n);
      if (speedIn < C.minInSpeed) continue;   // a graze
      c.k = Math.min(1, Math.max(C.minSpeedFrac, speedIn / T.speedRef));
      const r = T.craterR * c.k;
      const at = sub(hp, scl(n, headR));      // the body surface under the head
      c.inside = true; c.stamps = 1; c.last = at; c.lastR = r;
      velScale *= 1 - C.absorbCrater;
      events.push({
        actorId: a.id, dir, speedIn,
        spheres: [{ at, radius: r, severRadius: r * C.severMul, kind: 'crater', meterCredit: T.meter * c.k }],
      });
      continue;
    }

    const dIn = a.field(to);
    if (dIn - headR > C.hitEps) { c.inside = false; c.done = true; continue; }   // out the far side
    if (c.stamps - 1 >= T.gougeMax) continue;
    if (len(v) < C.gougeMinSpeed) { c.done = true; continue; }          // stalled in the flesh
    const n = surfaceNormal(a.field, to);
    const at = sub(to, scl(n, dIn));                                      // head centre onto the surface
    const step = len(sub(at, c.last));
    const r = c.lastR * C.gougeShrink;
    if (step < C.gougeStep || step < C.mergeFrac * Math.min(r, c.lastR)) continue;
    c.stamps++; c.last = at; c.lastR = r;
    velScale *= 1 - C.absorbGouge;
    events.push({
      actorId: a.id, dir, speedIn: -dot(v, n),
      spheres: [{ at, radius: r, severRadius: r * C.severMul, kind: 'gouge', meterCredit: T.meter * c.k * C.gougeMeterFrac }],
    });
  }
  return { events, velScale };
}
