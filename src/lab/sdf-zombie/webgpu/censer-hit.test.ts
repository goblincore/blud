// src/lab/sdf-zombie/webgpu/censer-hit.test.ts
//
import { describe, expect, it } from 'vitest';
import {
  CENSER_HIT, hitTier, makeStrokeHits, sweepHead, type ActorProbe, type HitEvent, type StrokeHits,
} from './censer-hit';
import type { Vec3 } from '../types';
import { CENSER_HEAD } from './censer-head';

const R = 0.07;   // CENSER_HEAD.radius
const ball = (id: number, c: Vec3, r = 0.3): ActorProbe => ({
  id, centre: c, field: p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r,
});
/** A capsule limb from `a` to `b` with radius `r` — a non-spherical body, to
 *  check nothing here is secretly ball-shaped. */
const capsule = (id: number, a: Vec3, b: Vec3, r: number): ActorProbe => {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const centre: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return {
    id, centre,
    field: p => {
      const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const t = l2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
      const c: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
      return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;
    },
  };
};
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Walk the head from → to in `stepLen` substeps, as censer-head's hook would, applying velScale. */
function dragBy(
  hits: StrokeHits, from: Vec3, to: Vec3, vel: Vec3, actors: ActorProbe[], stepLen: number,
) {
  const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / stepLen));
  const events: HitEvent[] = [];
  let scale = 1, p = from;
  for (let i = 1; i <= n; i++) {
    const q = lerp3(from, to, i / n);
    const r = sweepHead(hits, p, q, [vel[0] * scale, vel[1] * scale, vel[2] * scale], R, actors);
    events.push(...r.events);
    scale *= r.velScale;
    p = q;
  }
  return { events, scale, spheres: events.flatMap(e => e.spheres) };
}
/** The original 1 cm harness, kept for the tests that don't care about step length. */
const drag = (hits: StrokeHits, from: Vec3, to: Vec3, vel: Vec3, actors: ActorProbe[]) =>
  dragBy(hits, from, to, vel, actors, 0.01);

describe('sweepHead', () => {
  it('misses cleanly', () => {
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 2], [0, 0, 1.5], [0, 0, -9], R, [ball(1, [0, 0, 0])]);
    expect(r.events).toHaveLength(0);
    expect(r.velScale).toBe(1);
  });

  it('first contact stamps one crater on the body surface', () => {
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -9], R, [ball(1, [0, 0, 0])]);
    expect(r.events).toHaveLength(1);
    const s = r.events[0]!.spheres;
    expect(s).toHaveLength(1);
    expect(s[0]!.kind).toBe('crater');
    expect(Math.hypot(s[0]!.at[0], s[0]!.at[1], s[0]!.at[2] - 0.3)).toBeLessThan(0.012);
    expect(s[0]!.radius).toBeCloseTo(CENSER_HIT.tap.craterR, 3);
    expect(s[0]!.severRadius).toBeCloseTo(CENSER_HIT.tap.craterR * CENSER_HIT.severMul, 3);
    expect(s[0]!.meterCredit).toBeCloseTo(CENSER_HIT.tap.meter, 3);
    expect(r.velScale).toBeCloseTo(1 - CENSER_HIT.absorbCrater, 6);
  });

  it('sizes the crater by the speed into the surface; a graze stamps nothing', () => {
    const radiusAt = (speed: number) => {
      const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -speed], R, [ball(1, [0, 0, 0])]);
      return r.events[0]?.spheres[0]?.radius ?? null;
    };
    expect(radiusAt(4.5)).toBeCloseTo(CENSER_HIT.tap.craterR * 0.5, 3);
    expect(radiusAt(2)).toBeCloseTo(CENSER_HIT.tap.craterR * CENSER_HIT.minSpeedFrac, 3);
    expect(radiusAt(1)).toBeNull();
  });

  it('the speed factor k clamps to 1 above speedRef — a wild overswing is not a bigger crater', () => {
    const T = hitTier(0);
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -100], R, [ball(1, [0, 0, 0])]);
    expect(r.events[0]!.spheres[0]!.radius).toBeCloseTo(T.craterR, 6);
    expect(r.velScale).toBeCloseTo(1 - CENSER_HIT.absorbCrater, 6);
  });

  it('a full-charge strike is the big crater', () => {
    const r = sweepHead(makeStrokeHits(1, 1), [0, 0, 1], [0, 0, 0.3], [0, 0, -16], R, [ball(1, [0, 0, 0])]);
    expect(r.events[0]!.spheres[0]!.radius).toBeCloseTo(CENSER_HIT.heavy.craterR, 3);
  });

  it('makeStrokeHits clamps charge to [0, 1]', () => {
    expect(makeStrokeHits(1, -5).charge).toBe(0);
    expect(makeStrokeHits(1, 5).charge).toBe(1);
    expect(makeStrokeHits(1, 0.4).charge).toBeCloseTo(0.4, 6);
  });

  it(
    'the gouge trails the crater along the travel, shrinking ' +
    '(eps-exit regression: a shallow, tangential first contact registered on the eps shell — the ' +
    'segment never truly crosses the strict boundary before the eps-tolerant graze admits it — must ' +
    'still be followed by at least one gouge, not read as already-exited on the very next substep)',
    () => {
      const { spheres } = drag(makeStrokeHits(1, 0), [-0.45, 0, 0.33], [0.45, 0, 0.33], [9, 0, -1], [ball(1, [0, 0, 0])]);
      expect(spheres[0]!.kind).toBe('crater');
      const gouge = spheres.slice(1);
      expect(gouge.length).toBeGreaterThanOrEqual(1);
      expect(gouge.length).toBeLessThanOrEqual(CENSER_HIT.tap.gougeMax);
      for (const g of gouge) expect(g.kind).toBe('gouge');
      for (let i = 1; i < spheres.length; i++) {
        expect(spheres[i]!.at[0]).toBeGreaterThan(spheres[i - 1]!.at[0]);
        expect(spheres[i]!.radius).toBeCloseTo(spheres[i - 1]!.radius * CENSER_HIT.gougeShrink, 6);
        expect(spheres[i]!.meterCredit).toBeCloseTo(spheres[0]!.meterCredit * CENSER_HIT.gougeMeterFrac, 6);
      }
    },
  );

  it('the same trailing swing at a realistic 6.7 cm substep (16 m/s at 240 Hz) still gouges', () => {
    const { spheres } = dragBy(
      makeStrokeHits(1, 1), [-0.45, 0, 0.33], [0.45, 0, 0.33], [16, 0, -1], [ball(1, [0, 0, 0])], 0.067,
    );
    expect(spheres[0]?.kind).toBe('crater');
    const gouge = spheres.slice(1);
    expect(gouge.length).toBeGreaterThanOrEqual(1);
    expect(gouge.length).toBeLessThanOrEqual(CENSER_HIT.heavy.gougeMax);
    for (const g of gouge) expect(g.kind).toBe('gouge');
    for (let i = 1; i < spheres.length; i++) expect(spheres[i]!.at[0]).toBeGreaterThan(spheres[i - 1]!.at[0]);
  });

  it('hits each body once per stroke; a new stroke hits again', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    expect(drag(hits, [-0.45, 0, 0.33], [0.45, 0, 0.33], [9, 0, -1], body).spheres.length).toBeGreaterThan(0);
    expect(drag(hits, [0.45, 0, 0.33], [-0.45, 0, 0.33], [-9, 0, -1], body).spheres).toHaveLength(0);
    expect(drag(makeStrokeHits(2, 0), [0.45, 0, 0.33], [-0.45, 0, 0.33], [-9, 0, -1], body).spheres.length).toBeGreaterThan(0);
  });

  it('a stroke that starts inside the body waits until the head has left it', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    expect(sweepHead(hits, [0, 0, 0.2], [0, 0, 0.25], [0, 0, 9], R, body).events).toHaveLength(0);
    expect(drag(hits, [0, 0, 0.25], [0, 0, 0.6], [0, 0, 9], body).spheres).toHaveLength(0);
    const back = drag(hits, [0, 0, 0.6], [0, 0, 0.3], [0, 0, -9], body);
    expect(back.spheres[0]?.kind).toBe('crater');
  });

  // Stepped at 5 mm AND at the game's own step (speed / 240 Hz: 6.7 cm at 16 m/s,
  // 8.3 cm at 20) — at game step length the head is past grazeDepth on the very
  // substep it turns in, which the first cut of this rule dropped with no wound.
  for (const [speed, step] of [[16, 0.005], [16, 16 / CENSER_HEAD.stepHz], [20, 20 / CENSER_HEAD.stepHz]] as const) it(`a graze that slides on into flesh under it strikes there (a skull brushed, the shoulder hit) — ${speed} m/s, ${(step * 100).toFixed(1)} cm steps`, () => {
    // A "skull" ball sunk into a flat "shoulder" (the half-space y < 0), one
    // body (their union), so close that their contact shells overlap: a head
    // sliding off the skull never gets back outside before it meets the
    // shoulder (on the zombie the smooth-unioned skull and shoulders are
    // closer still). Measured in game before this: a full-charge slam that
    // brushed the skull left NO wound in the shoulder it then plowed into.
    const skull: Vec3 = [0, 0.09, 0];
    const body: ActorProbe = {
      id: 1, centre: [0, 0, 0],
      field: p => Math.min(Math.hypot(p[0] - skull[0], p[1] - skull[1], p[2] - skull[2]) - 0.1, p[1]),
    };
    // Straight down, just inside the skull's contact shell (≈ 1.2 m/s into it: a graze).
    const x = 0.1 + R + CENSER_HIT.hitEps - 0.0005;
    const { spheres, events } = dragBy(makeStrokeHits(1, 1), [x, 0.6, 0], [x, 0.02, 0], [0, -speed, 0], [body], step);
    expect(spheres[0]?.kind).toBe('crater');
    // In the crease and onto the shoulder — below the skull's equator (y 0.09), a real blow.
    expect(spheres[0]!.at[1]).toBeLessThan(0.075);
    expect(events[0]!.speedIn).toBeGreaterThanOrEqual(CENSER_HIT.glanceFrac * speed);
  });

  it('a fast glance (little of the speed into the skin) is a graze: it slides off and leaves nothing', () => {
    // 16 m/s skimming the top of a ball (≈ 3.4 m/s into it at the touch): over minInSpeed, under glanceFrac.
    const { spheres } = dragBy(makeStrokeHits(1, 1), [-0.6, 0, 0.378], [0.6, 0, 0.378], [16, 0, -1.8], [ball(1, [0, 0, 0])], 0.01);
    expect(spheres).toHaveLength(0);
  });

  it('a graze that sinks in without ever striking waits to leave the body', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    // Onto the top of the ball at 1.2 m/s (under minInSpeed), sinking well past grazeDepth.
    expect(dragBy(hits, [-0.03, 0.39, 0], [0.03, 0.28, 0], [0.6, -1.2, 0], body, 0.005).spheres).toHaveLength(0);
    // Still inside: even a fast push now is no first contact until the head has left.
    expect(dragBy(hits, [0.03, 0.28, 0], [0.03, 0.2, 0], [0, -9, 0], body, 0.01).spheres).toHaveLength(0);
  });

  it('the gouge ends when the head stalls in the flesh', () => {
    const body = [ball(1, [0, 0, 0])];
    const hits = makeStrokeHits(1, 0);
    const hit = sweepHead(hits, [-0.45, 0, 0.33], [-0.12, 0, 0.33], [9, 0, -1], R, body);
    expect(hit.events[0]!.spheres[0]!.kind).toBe('crater');
    expect(drag(hits, [-0.12, 0, 0.33], [0.12, 0, 0.33], [0.5, 0, 0], body).spheres).toHaveLength(0);
    expect(drag(hits, [0.12, 0, 0.33], [0.45, 0, 0.33], [9, 0, 0], body).spheres).toHaveLength(0);
  });

  it('two bodies in one sweep: both are hit, the second with the speed left over', () => {
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -9], R,
      [ball(1, [0, 0, 0]), ball(2, [0, 0, 0.01])]);
    expect(r.events.map(e => e.actorId)).toEqual([1, 2]);
    expect(r.events[1]!.spheres[0]!.radius).toBeLessThan(r.events[0]!.spheres[0]!.radius);
    expect(r.velScale).toBeCloseTo((1 - CENSER_HIT.absorbCrater) ** 2, 6);
  });

  it('a body beyond the broad-phase radius is not tested at all', () => {
    // A field that WOULD register a hit if it were ever evaluated (it is
    // permanently "inside" everywhere) — broad-phase must reject it purely
    // on centre distance, without ever calling `field`.
    let called = false;
    const far: ActorProbe = {
      id: 9,
      centre: [0, 0, 1 + CENSER_HIT.broadPhase + R + 1],   // 1 unit past the segment's near end, plus margin
      field: () => { called = true; return -1; },
    };
    const r = sweepHead(makeStrokeHits(1, 0), [0, 0, 1], [0, 0, 0.3], [0, 0, -9], R, [far]);
    expect(r.events).toHaveLength(0);
    expect(called).toBe(false);
  });

  it(
    'a graze while inside is not armed to fire — speeding up afterward, still inside, does not stamp ' +
    'a deep crater; only leaving and coming back fast stamps one, on the skin',
    () => {
      const hits = makeStrokeHits(1, 0);
      const body = [ball(1, [0, 0, 0])];   // radius 0.3

      // A graze at 1 m/s (below minInSpeed) on the eps shell.
      const graze = sweepHead(hits, [0, 0, 0.5], [0, 0, 0.36], [0, 0, -1], R, body);
      expect(graze.events).toHaveLength(0);

      // Slowly deeper, 5 cm under the true surface (distance 0.25 from centre).
      const deeper = sweepHead(hits, [0, 0, 0.36], [0, 0, 0.25], [0, 0, -0.5], R, body);
      expect(deeper.events).toHaveLength(0);

      // Now fast, while still that deep — this used to stamp a crater ~12 cm
      // under the skin (traceProjectile returns `from` when `from` is
      // already within hitEps of the inflated shell, which is true anywhere
      // inside it, so a stale "not yet armed to fire" state let a late
      // speed-up re-read as a fresh, valid contact at the current, deep,
      // position).
      const fast = sweepHead(hits, [0, 0, 0.25], [0, 0, 0.18], [0, 0, -9], R, body);
      expect(fast.events).toHaveLength(0);

      // Leave the shell (clearly outside) and come back in fast: NOW it's a
      // real, on-the-skin crater.
      const leave = sweepHead(hits, [0, 0, 0.18], [0, 0, 0.5], [0, 0, 9], R, body);
      expect(leave.events).toHaveLength(0);
      const back = sweepHead(hits, [0, 0, 0.5], [0, 0, 0.2], [0, 0, -9], R, body);
      expect(back.events).toHaveLength(1);
      const at = back.events[0]!.spheres[0]!.at;
      expect(Math.abs(Math.hypot(at[0], at[1], at[2]) - 0.3)).toBeLessThan(0.012);
    },
  );

  it('the tap gouge cap stops at exactly 3, on a big ball with room to spare (exercises the merge rule)', () => {
    const bigBall = [ball(1, [0, 0, 0], 0.5)];
    const { spheres } = drag(makeStrokeHits(1, 0), [-0.6, 0, 0.1], [0.6, 0, 0.1], [9, 0, -0.2], bigBall);
    const gouge = spheres.slice(1);
    expect(spheres[0]?.kind).toBe('crater');
    expect(gouge.length).toBe(CENSER_HIT.tap.gougeMax);
    for (const g of gouge) expect(g.kind).toBe('gouge');
    for (let i = 1; i < spheres.length; i++) {
      const step = Math.hypot(
        spheres[i]!.at[0] - spheres[i - 1]!.at[0],
        spheres[i]!.at[1] - spheres[i - 1]!.at[1],
        spheres[i]!.at[2] - spheres[i - 1]!.at[2],
      );
      expect(step).toBeGreaterThanOrEqual(Math.max(CENSER_HIT.gougeStep, CENSER_HIT.mergeFrac * spheres[i]!.radius) - 1e-9);
    }
  });

  it('a charge-1 stroke at 16 m/s stamps at most the heavy gouge cap (6), spaced by the merge rule', () => {
    const bigBall = [ball(1, [0, 0, 0], 0.6)];
    const { spheres } = dragBy(
      makeStrokeHits(1, 1), [-0.7, 0, 0.1], [0.7, 0, 0.1], [16, 0, -0.2], bigBall, 0.067,
    );
    const gouge = spheres.slice(1);
    expect(spheres[0]?.kind).toBe('crater');
    expect(gouge.length).toBeGreaterThanOrEqual(1);
    expect(gouge.length).toBeLessThanOrEqual(CENSER_HIT.heavy.gougeMax);
    for (const g of gouge) expect(g.kind).toBe('gouge');
    for (let i = 1; i < spheres.length; i++) {
      const step = Math.hypot(
        spheres[i]!.at[0] - spheres[i - 1]!.at[0],
        spheres[i]!.at[1] - spheres[i - 1]!.at[1],
        spheres[i]!.at[2] - spheres[i - 1]!.at[2],
      );
      expect(step).toBeGreaterThanOrEqual(Math.max(CENSER_HIT.gougeStep, CENSER_HIT.mergeFrac * spheres[i]!.radius) - 1e-9);
    }
  });

  it('a non-ball body (a capsule limb) is hit the same way: entry crater plus at least one gouge', () => {
    const limb = [capsule(1, [0, -0.3, 0], [0, 0.3, 0], 0.04)];
    const { spheres } = dragBy(
      makeStrokeHits(1, 1), [-0.5, 0, 0], [0.5, 0, 0], [16, 0, 0], limb, 0.067,
    );
    expect(spheres.length).toBeGreaterThanOrEqual(2);
    expect(spheres[0]!.kind).toBe('crater');
    expect(spheres.slice(1).some(s => s.kind === 'gouge')).toBe(true);
  });
});
