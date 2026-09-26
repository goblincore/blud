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
//                    reference speed (a graze — under minInSpeed or under
//                    glanceFrac of the head's speed — stamps nothing YET: the
//                    head slides on and strikes further along if it turns
//                    into the skin before it sinks grazeDepth under the shell)
//   while inside   → a GOUGE sphere every gougeStep of travel, each gougeShrink
//                    smaller, up to the stroke's cap; ends when the head exits
//                    or its TOTAL speed stalls below gougeMinSpeed — total,
//                    not speed into the surface, because a dragging gouge is
//                    mostly tangential (a deliberate deviation from the
//                    spec's §4.2 "into the surface" wording, which describes
//                    the crater, not the drag)
//   every stamp    → the head loses speed (velScale), so it bounces out
//   once per stroke per body; a stroke that STARTS inside a body waits until
//   the head has left it (a zombie hugging the player is not wounded by a
//   resting censer). On a thin limb the gouge often lands on the EXIT face
//   rather than the entry face it started from — that's fine, it's what the
//   sever check (severRadius, the carve union) wants.
//
// `sweepHead` MUTATES the per-stroke ledger it is given (`StrokeHits`).

import type { Vec3 } from '../types';
import { GRAPESHOT, traceProjectile } from './game-weapon';

export const CENSER_HIT = {
  /** Tap (charge 0) and full-charge ends of every per-stroke number; lerped by charge.
   *  heavy.craterR 0.11 → 0.13 (Task 9 gate, with severMul below): see severMul. */
  tap: { craterR: 0.06, gougeMax: 3, speedRef: 9, meter: 0.1 },
  heavy: { craterR: 0.13, gougeMax: 6, speedRef: 16, meter: 0.3 },
  /** Floor on the speed factor: a slow but real hit still leaves a mark. */
  minSpeedFrac: 0.4,
  /** m/s into the surface below which a contact is a graze. */
  minInSpeed: 1.5,
  /** …and a contact is a graze too unless at least this fraction of the head's
   *  speed goes INTO the skin (0.3 ≈ 17°). A full-charge slam that brushed a
   *  skull at 1.9 m/s (of 20) spent its one crater per body there — a
   *  floor-sized dent — and the shoulder it plowed into next got only the
   *  shrinking gouge (censer gate, Task 9). */
  glanceFrac: 0.3,
  /** A GRAZING head slides on inside the contact shell (it has not struck yet)
   *  and strikes, where it is, once it turns into the skin (the same test).
   *  If its centre has sunk this far (m) under the shell and it is STILL not a
   *  blow, it has sunk in without one and waits to leave the body, as before. A glance
   *  that slides off again leaves no wound. */
  grazeDepth: 0.035,
  /** m/s below which a head inside the flesh has stalled and the gouge ends. */
  gougeMinSpeed: 2.0,
  gougeStep: 0.03,
  gougeShrink: 0.8,
  gougeMeterFrac: 0.25,
  /** A gouge sphere closer than this × the smaller radius to the last one is merged (skipped). */
  mergeFrac: 0.5,
  /** severRadius = radius × this: the carve union the sever test sees.
   *  1.15 → 1.6 (Task 9, scripts/censer-gate.mjs). The head's section is tested
   *  at the NECK BASE (connectivity.ts cutLimbs), sunk ~8 cm into the shoulders
   *  and shielded by the skull; the nearest a slam's crater lands is on the
   *  shoulder's top ~0.15 m away, so cutting it needs a sever calibre over
   *  ~0.2 m (distance + the neck's 0.045 m girth). At 1.15 even heavy.craterR
   *  0.14 (the plan's cap) gave 0.161; at 1.6 the heavy's 0.13 gives 0.208,
   *  the first that severed (0.11 / 0.12 did not). A tap is 0.096 at full
   *  speed — the grapeshot pellet's proven 0.10, which "severs a shoulder in
   *  ~8": the gate's taps take a forearm off at the elbow on the second. */
  severMul: 1.6,
  absorbCrater: 0.35,
  absorbGouge: 0.12,
  /** Segment-to-torso distance past which a body is not tested at all, metres. */
  broadPhase: 1.35,
  gradEps: 0.005,
  /** Must match traceProjectile's own eps shell, or entry/exit/arming disagree on where the surface is. */
  hitEps: GRAPESHOT.hitEps,
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
  /** Touched at a graze and still sliding along inside the shell. */
  grazing: boolean;
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

/** The 4 corners of a regular tetrahedron centred on the origin — the classic
 *  4-tap SDF gradient (half the field evaluations of central differences). */
const TETRA_K: readonly Vec3[] = [[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]];

/** Outward unit normal of a field by the tetrahedral gradient trick. */
export function surfaceNormal(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = CENSER_HIT.gradEps;
  let gx = 0, gy = 0, gz = 0;
  for (const k of TETRA_K) {
    const f = field([p[0] + e * k[0], p[1] + e * k[1], p[2] + e * k[2]]);
    gx += k[0] * f; gy += k[1] * f; gz += k[2] * f;
  }
  return unit([gx, gy, gz], [0, 1, 0]);
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
    // Same eps tolerance as traceProjectile's own shell, so arming, entry and
    // exit all agree on where "outside" starts.
    const outside = (p: Vec3) => a.field(p) - headR > C.hitEps;
    let c = hits.contacts.get(a.id);
    if (!c) {
      c = { armed: outside(from), grazing: false, inside: false, done: false, stamps: 0, last: [0, 0, 0], lastR: 0, k: 1 };
      hits.contacts.set(a.id, c);
    }
    if (c.done) continue;
    if (!c.armed) { if (outside(to)) c.armed = true; continue; }

    const v = scl(vel, velScale);
    const dir = unit(v, unit(sub(to, from), [0, 0, -1]));
    if (!c.inside) {
      let n: Vec3, at: Vec3;
      if (!c.grazing) {
        const hp = traceProjectile(from, to, q => a.field(q) - headR);
        if (!hp) continue;
        // traceProjectile returns `from` outright when `from` is already
        // within hitEps of the shell — true anywhere inside it, however deep.
        // So a first contact whose point is DEEP is not one: disarm, and the
        // head must actually leave the shell (`outside`, above) before it can
        // count. (A graze is handled below — it keeps sliding.)
        const dHp = a.field(hp);
        if (dHp - headR < -C.hitEps) { c.armed = false; continue; }   // hp is deep: not a valid first contact
        n = surfaceNormal(a.field, hp);
        at = sub(hp, scl(n, dHp));         // project onto the true skin, same as the gouge does below
      } else {
        // GRAZING: the head touched at a glancing angle and slides on inside
        // the shell — down a skull's side into the shoulder under it, say.
        // Judge the contact where the head is NOW (never a stale point): the
        // skin under it and the speed into that. It used to disarm at the
        // graze, and a full-charge slam that brushed the skull then plowed
        // into the shoulder at 19 m/s left no wound at all (censer gate).
        // The blow is judged BEFORE the depth bail: at game step length (a
        // 16–20 m/s head moves 6.7–8.3 cm per 240 Hz substep) the head turning
        // into the shoulder is already past grazeDepth on the very substep it
        // turns in, and bailing first dropped it with no wound (review, Task 9).
        const dTo = a.field(to);
        if (dTo - headR > C.hitEps) { c.grazing = false; continue; }          // slid off: outside again, still armed
        n = surfaceNormal(a.field, to);
        at = sub(to, scl(n, dTo));
        if (dTo - headR < -C.grazeDepth && -dot(v, n) < Math.max(C.minInSpeed, C.glanceFrac * len(v))) {
          c.grazing = false; c.armed = false; continue;                        // sank in without a blow
        }
      }
      const speedIn = -dot(v, n);
      if (speedIn < Math.max(C.minInSpeed, C.glanceFrac * len(v))) { c.grazing = true; continue; }   // a graze: keep sliding
      c.grazing = false;
      c.k = Math.min(1, Math.max(C.minSpeedFrac, speedIn / T.speedRef));
      const r = T.craterR * c.k;
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
    if (c.stamps - 1 >= T.gougeMax) { c.done = true; continue; }                // cap reached: stop sampling
    if (len(v) < C.gougeMinSpeed) { c.done = true; continue; }   // TOTAL speed stalled (see header note)
    const n = surfaceNormal(a.field, to);
    const at = sub(to, scl(n, dIn));                                      // head centre onto the surface
    const step = len(sub(at, c.last));
    const r = c.lastR * C.gougeShrink;
    // r < c.lastR always (gougeShrink < 1), so the merge distance is just r.
    if (step < C.gougeStep || step < C.mergeFrac * r) continue;
    c.stamps++; c.last = at; c.lastR = r;
    velScale *= 1 - C.absorbGouge;
    events.push({
      actorId: a.id, dir, speedIn: Math.max(0, -dot(v, n)),   // informational only for gouges
      spheres: [{ at, radius: r, severRadius: r * C.severMul, kind: 'gouge', meterCredit: T.meter * c.k * C.gougeMeterFrac }],
    });
  }
  return { events, velScale };
}
