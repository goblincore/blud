// src/lab/sdf-zombie/hands.test.ts
import { describe, expect, it } from 'vitest';
import {
  HANDS_TUNING,
  HAND_AXES,
  HAND_JIGGLE,
  HAND_PHASE_SEC,
  HAND_POSES,
  HAND_PRIMS,
  HAND_PRIM_COUNT,
  HAND_PRIM_GROUPS,
  HAND_PRIM_NAMES,
  HAND_PROPS,
  LIGHTER_LIT,
  STICK_IN_HAND,
  bobOffset,
  handPhaseFromCook,
  poseAt,
  propAnchor,
  smooth01,
  type HandPhase,
  type HandPoseSample,
} from './hands';
import { makeFpv, stepCook, FPV_TUNING } from './fpv';
import { DYNAMITE_COOK } from '../../game/gibs/tuning';

const EPS = 1e-9;

function close(a: number, b: number, eps = EPS): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
}

function sampleDelta(x: HandPoseSample, y: HandPoseSample): number {
  let worst = 0;
  for (const hand of ['left', 'right'] as const) {
    expect(x[hand].length).toBe(y[hand].length);
    for (let i = 0; i < x[hand].length; i++) {
      const px = x[hand][i]!, py = y[hand][i]!;
      for (let k = 0; k < 3; k++) {
        worst = Math.max(worst, Math.abs(px.pos[k]! - py.pos[k]!));
        worst = Math.max(worst, Math.abs(px.scale[k]! - py.scale[k]!));
      }
    }
  }
  return Math.max(worst, Math.abs(x.bobWeight - y.bobWeight));
}

const finiteSample = (s: HandPoseSample): boolean =>
  [s.bobWeight, ...s.left.flatMap(t => [...t.pos, ...t.scale]),
    ...s.right.flatMap(t => [...t.pos, ...t.scale])].every(Number.isFinite);

// ——— Prim set ———————————————————————————————————————————————————————————————

/** Named indices — the prim ORDER is interface, so bind names once here. */
const IX = Object.fromEntries(HAND_PRIM_NAMES.map((n, i) => [n, i])) as
  Record<(typeof HAND_PRIM_NAMES)[number], number>;
const mid = (p: { a: readonly number[]; b: readonly number[] }, k: number): number =>
  (p.a[k]! + p.b[k]!) / 2;
const midV = (p: { a: readonly number[]; b: readonly number[] }): [number, number, number] =>
  [mid(p, 0), mid(p, 1), mid(p, 2)];
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('hand prim set', () => {
  it('has 8–12 prims per hand (claymation-chunky), same count both sides', () => {
    expect(HAND_PRIMS.left.length).toBe(HAND_PRIM_COUNT);
    expect(HAND_PRIMS.right.length).toBe(HAND_PRIM_COUNT);
    // The perf ceiling the spec's bench gate cares about: these march every
    // frame, twice (two clusters).
    expect(HAND_PRIM_COUNT).toBeGreaterThanOrEqual(8);
    expect(HAND_PRIM_COUNT).toBeLessThanOrEqual(12);
    expect(new Set(HAND_PRIM_NAMES).size).toBe(HAND_PRIM_COUNT);
  });

  it('the pose groups partition the prim list exactly once', () => {
    const seen = Object.values(HAND_PRIM_GROUPS).flatMap(g => [...g]).sort((a, b) => a - b);
    expect(seen).toEqual([...Array(HAND_PRIM_COUNT).keys()]);
  });

  it('left is the exact x-mirror of right (one authored side per the task)', () => {
    for (let i = 0; i < HAND_PRIM_COUNT; i++) {
      const l = HAND_PRIMS.left[i]!, r = HAND_PRIMS.right[i]!;
      expect(l.a).toEqual([-r.a[0], r.a[1], r.a[2]]);
      expect(l.b).toEqual([-r.b[0], r.b[1], r.b[2]]);
      expect(l.radius).toBe(r.radius);
      expect(l.scale).toEqual(r.scale);
      expect(l.blendK).toBe(r.blendK);
      expect(l.limb).toBe('armL');
      expect(r.limb).toBe('armR');
      expect(l.cluster).toBe(0);
      expect(r.cluster).toBe(1);
    }
  });

  it('is framed bottom-of-view: below centre, in front of the camera, stubs exiting low', () => {
    for (const side of ['left', 'right'] as const) {
      for (const p of HAND_PRIMS[side]) {
        expect(mid(p, 1)).toBeLessThan(0);          // bottom half of the frame
        expect(mid(p, 2)).toBeGreaterThan(0.2);     // inside the camera-anchored box
        expect(mid(p, 2)).toBeLessThan(0.9);
      }
      const stub = HAND_PRIMS[side][IX.forearm]!;
      const fingers = HAND_PRIMS[side][IX.fingerRoot]!;
      // Forearm stub exits below the grip mass.
      expect(Math.min(stub.a[1], stub.b[1])).toBeLessThan(mid(fingers, 1) - 0.15);
      // The fingers converge toward screen centre past the wrist (grip faces in).
      expect(Math.abs(mid(fingers, 0)))
        .toBeLessThan(Math.abs(mid(HAND_PRIMS[side][IX.wrist]!, 0)));
    }
    // Lead (right) hand sits on the right of the view, support on the left.
    expect(mid(HAND_PRIMS.right[IX.fingerRoot]!, 0)).toBeGreaterThan(0);
    expect(mid(HAND_PRIMS.left[IX.fingerRoot]!, 0)).toBeLessThan(0);
  });

  // The point of the redesign: at bottom-of-frame scale the silhouette has to
  // say "hand", not "mitten". These are the structural facts that carry that
  // read in the game's own dynamite frames.
  describe('reads as a hand, not a mitten', () => {
    const R = HAND_PRIMS.right;

    it('has three separated finger tubes — the grooves survive the smin fold', () => {
      const f = HAND_PRIM_GROUPS.fingers.map(i => R[i]!);
      expect(f.length).toBe(3);
      for (let i = 0; i + 1 < f.length; i++) {
        const gap = dist(midV(f[i]!), midV(f[i + 1]!));
        const a = f[i]!, b = f[i + 1]!;
        // Centres further apart than the two radii: the tubes touch and
        // groove instead of merging into one bar…
        expect(gap).toBeGreaterThan((a.radius + b.radius) * 0.8);
        // …and the smin skirt (k is scaled ×4 in the shader) stays under the
        // gap, so the groove is not smoothed away.
        expect(Math.max(a.blendK, b.blendK) * 4).toBeLessThan(gap);
      }
    });

    it('fuses the palm masses but keeps the digits crisp', () => {
      const softest = Math.min(...HAND_PRIM_GROUPS.mass.map(i => R[i]!.blendK));
      const hardest = Math.max(
        ...[...HAND_PRIM_GROUPS.fingers, ...HAND_PRIM_GROUPS.thumb].map(i => R[i]!.blendK),
      );
      expect(hardest).toBeLessThan(softest);
    });

    it('has an opposable thumb: off the finger row, on the far side of the palm', () => {
      const { w } = HAND_AXES.right;
      const palm = midV(R[IX.palm]!);
      const along = (p: readonly number[]): number =>
        (p[0]! - palm[0]!) * w[0] + (p[1]! - palm[1]!) * w[1] + (p[2]! - palm[2]!) * w[2];
      // Every thumb segment sits thumb-side (+w) of the palm, and the digit
      // as a whole is displaced well past the finger row — the opposition
      // that turns a paw into a hand.
      for (const i of HAND_PRIM_GROUPS.thumb) expect(along(midV(R[i]!))).toBeGreaterThan(0.01);
      const meanAlong = (g: readonly number[]): number =>
        g.reduce((s, i) => s + along(midV(R[i]!)), 0) / g.length;
      expect(meanAlong(HAND_PRIM_GROUPS.thumb))
        .toBeGreaterThan(meanAlong(HAND_PRIM_GROUPS.fingers) + 0.03);
      // It also rides proud of the fingers toward the eye (+b), so it breaks
      // the silhouette instead of hiding behind the fist.
      const { b } = HAND_AXES.right;
      const out = (p: readonly number[]): number =>
        (p[0]! - palm[0]!) * b[0] + (p[1]! - palm[1]!) * b[1] + (p[2]! - palm[2]!) * b[2];
      const meanOut = (g: readonly number[]): number =>
        g.reduce((s, i) => s + out(midV(R[i]!)), 0) / g.length;
      expect(meanOut(HAND_PRIM_GROUPS.thumb)).toBeGreaterThan(meanOut(HAND_PRIM_GROUPS.fingers));
      // The tip reaches ACROSS the grip — further along the hand than its base.
      const { u } = HAND_AXES.right;
      const up = (p: readonly number[]): number => p[0]! * u[0] + p[1]! * u[1] + p[2]! * u[2];
      expect(up(midV(R[IX.thumbTip]!))).toBeGreaterThan(up(midV(R[IX.thumbBase]!)));
    });

    it('tapers at the wrist between a thick forearm and a broad palm', () => {
      expect(R[IX.wrist]!.radius).toBeLessThan(R[IX.forearm]!.radius);
      expect(R[IX.wrist]!.radius).toBeLessThan(R[IX.palm]!.radius);
    });

    it('gives the forearm roughly half the silhouette, as the frames do', () => {
      const arm = dist(R[IX.forearm]!.a, R[IX.forearm]!.b);
      const hand = dist(midV(R[IX.heel]!), midV(R[IX.finger1]!));
      expect(arm).toBeGreaterThan(hand);
    });
  });
});

// ——— Pose tables ————————————————————————————————————————————————————————

describe('pose keyframes (data integrity)', () => {
  const phases: HandPhase[] = ['idle', 'light', 'cook', 'throw', 'recover'];

  it('references only existing prim indices, with finite 3-vectors', () => {
    for (const role of ['lead', 'support'] as const) {
      for (const ph of phases) {
        const kf = HAND_POSES[role][ph];
        expect(kf.length).toBeLessThanOrEqual(HAND_PRIM_COUNT);
        for (const entry of kf) {
          if (!entry) continue;
          for (const v of [entry.pos ?? [0, 0, 0], entry.scale ?? [1, 1, 1]]) {
            expect(v.length).toBe(3);
            for (const n of v) {
              expect(Number.isFinite(n)).toBe(true);
            }
          }
          // Ellipsoid scale multipliers must stay positive (and sane).
          for (const n of entry.scale ?? [1, 1, 1]) {
            expect(n).toBeGreaterThan(0.5);
            expect(n).toBeLessThan(2);
          }
        }
      }
    }
  });

  it('poses actually act: light lifts, cook squeezes, throw extends the lead hand', () => {
    const leadGrip = HAND_POSES.lead.light[IX.fingerRoot]!;
    expect(leadGrip.pos![1]).toBeGreaterThan(0);              // raises the stick
    expect(HAND_POSES.support.light[IX.fingerRoot]!.pos![1]).toBeGreaterThan(
      leadGrip.pos![1],                                      // lighter hand rises higher
    );
    const cookScale = HAND_POSES.lead.cook[IX.finger1]!.scale!;
    expect(cookScale[1]).toBeGreaterThan(1);                 // fingers swell (tense grip)
    const throwLead = HAND_POSES.lead.throw[IX.fingerRoot]!.pos!;
    const throwSupport = HAND_POSES.support.throw[IX.fingerRoot]!.pos!;
    expect(throwLead[1]).toBeGreaterThan(0);                 // lead extends up…
    expect(throwLead[2]).toBeGreaterThan(0);                 // …and forward
    expect(throwSupport[1]).toBeLessThan(0);                 // support drops away
  });

  it('cook is the cocked hold the fuse-burn frames show: lower and further out', () => {
    const cook = HAND_POSES.lead.cook[IX.palm]!.pos!;
    const idle = HAND_POSES.lead.idle[IX.palm]!.pos!;
    expect(cook[1]).toBeLessThan(idle[1]);                   // drops below idle
    expect(cook[0]).toBeGreaterThan(idle[0]);                // and further outward
    // The support hand comes IN to the fuse while the lead hand cocks away.
    expect(HAND_POSES.support.cook[IX.palm]!.pos![0]).toBeGreaterThan(0.05);
  });

  it('the throw takes the whole arm with it (no forearm left hanging in frame)', () => {
    const hand = HAND_POSES.lead.throw[IX.palm]!.pos!;
    const arm = HAND_POSES.lead.throw[IX.forearm]!.pos!;
    expect(arm[1]).toBeGreaterThan(hand[1] * 0.6);           // the stub follows, lagging
    expect(arm[1]).toBeLessThan(hand[1]);                    // …but it does lag
    // Fingers open on release (tile 3225) — the grip swell inverts.
    expect(HAND_POSES.lead.throw[IX.finger1]!.scale![0]).toBeLessThan(1);
  });

  it('never lifts the forearm’s cut end into frame (the severed-arm read)', () => {
    // The stub is a capsule that runs OFF the bottom of the view; if a pose
    // lifts its far cap above the frame edge the player sees an amputation.
    // lab-renderer.ts's camera is a 75° vertical FOV.
    const halfTan = Math.tan((75 * Math.PI) / 180 / 2);
    for (const role of ['lead', 'support'] as const) {
      const side = role === 'lead' ? 'right' : 'left';
      for (const ph of phases) {
        const p = HAND_PRIMS[side][IX.forearm]!;
        const o = HAND_POSES[role][ph][IX.forearm]?.pos ?? [0, 0, 0];
        const y = p.b[1] + o[1] + p.radius;
        const z = p.b[2] + o[2];
        expect(y / (z * halfTan), `${role} ${ph}`).toBeLessThan(-1);
      }
    }
  });

  it('recover targets the idle pose exactly (the motion is the blend home)', () => {
    for (const role of ['lead', 'support'] as const) {
      for (let i = 0; i < HAND_PRIM_COUNT; i++) {
        expect(HAND_POSES[role].recover[i]).toEqual(HAND_POSES[role].idle[i]);
      }
    }
  });
});

// ——— Held props ————————————————————————————————————————————————————————————

describe('held prop anchors (bundle + lighter)', () => {
  const posedFor = (phase: HandPhase, side: 'left' | 'right', role: 'lead' | 'support') =>
    HAND_PRIMS[side].map((p, i) => {
      const tr = HAND_POSES[role][phase][i] ?? {};
      const o = tr.pos ?? [0, 0, 0];
      return { ...p, a: [p.a[0] + o[0], p.a[1] + o[1], p.a[2] + o[2]] as const,
        b: [p.b[0] + o[0], p.b[1] + o[1], p.b[2] + o[2]] as const };
    });
  const stickAt = (ph: HandPhase) => propAnchor(posedFor(ph, 'right', 'lead'), HAND_PROPS.stick);
  const lighterAt = (ph: HandPhase) =>
    propAnchor(posedFor(ph, 'left', 'support'), HAND_PROPS.lighter);

  it('each prop rides its own hand and sits clear of the knuckles', () => {
    expect(HAND_PROPS.stick.role).toBe('lead');
    expect(HAND_PROPS.lighter.role).toBe('support');
    const s = stickAt('idle');
    // Above the finger tubes (the frames show the bundle leaving the top of
    // the fist), and on the lead hand's side of the view.
    expect(s.pos[1]).toBeGreaterThan(mid(HAND_PRIMS.right[IX.finger1]!, 1));
    expect(s.pos[0]).toBeGreaterThan(0);
    const l = lighterAt('idle');
    expect(l.pos[1]).toBeGreaterThan(mid(HAND_PRIMS.left[IX.finger1]!, 1));
    expect(l.pos[0]).toBeLessThan(0);
  });

  it('anchors are unit-axis and tilt in toward screen centre, mirrored per side', () => {
    for (const a of [stickAt('idle'), lighterAt('idle')]) {
      expect(Math.hypot(...a.axis)).toBeCloseTo(1, 9);
      expect(a.axis[1]).toBeGreaterThan(0.5);   // both props stand up
    }
    expect(stickAt('idle').axis[0]).toBeLessThan(0);   // lead prop leans left…
    expect(lighterAt('idle').axis[0]).toBeGreaterThan(0); // …support leans right
  });

  it('anchors follow the pose — the light beat brings flame and fuse together', () => {
    const gap = (ph: HandPhase) => dist(stickAt(ph).pos, lighterAt(ph).pos);
    expect(gap('light')).toBeLessThan(gap('idle') * 0.5);
    // …and the fuse burn lets them drift apart again, as the frames do.
    expect(gap('cook')).toBeGreaterThan(gap('light'));
  });

  it('names the phases the view shows each prop in', () => {
    expect([...STICK_IN_HAND]).toEqual(['idle', 'light', 'cook']); // released at throw
    expect([...LIGHTER_LIT]).toEqual(['light', 'cook']);           // lit through the burn
  });

  it('is robust to a short prim list (never NaNs the mesh transform)', () => {
    const a = propAnchor([], HAND_PROPS.stick);
    expect(a.pos.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...a.axis)).toBeCloseTo(1, 9);
  });
});

// ——— Phase windows derived from fpv's constants ————————————————————————————

describe('phase timing (fpv-owned, never duplicated)', () => {
  it('light + cookMax == the fuse window; throw + recover == fpv throwRecoverSec', () => {
    close(HAND_PHASE_SEC.light + HAND_PHASE_SEC.cookMax, DYNAMITE_COOK.fuseMaxSec);
    close(HAND_PHASE_SEC.throw + HAND_PHASE_SEC.recover, FPV_TUNING.throwRecoverSec);
    expect(HAND_PHASE_SEC.recover).toBeGreaterThan(0);
  });

  it('every blend finishes inside its phase window (boundary continuity precondition)', () => {
    const b = HANDS_TUNING.blendSec;
    expect(b.light).toBeLessThanOrEqual(HAND_PHASE_SEC.light);
    expect(b.cook).toBeLessThanOrEqual(HAND_PHASE_SEC.cookMax);
    expect(b.throw).toBeLessThanOrEqual(HAND_PHASE_SEC.throw);
    expect(b.idle).toBeGreaterThan(0);
  });
});

// ——— Tween continuity ——————————————————————————————————————————————————————

describe('tween continuity at phase boundaries (canonical full-charge path)', () => {
  const boundaries: [HandPhase, number, HandPhase][] = [
    ['idle', 4.2, 'light'],      // idle is constant in phaseT
    ['light', HAND_PHASE_SEC.light, 'cook'],
    ['cook', HAND_PHASE_SEC.cookMax, 'throw'],
    ['throw', HAND_PHASE_SEC.throw, 'recover'],
    ['recover', HAND_PHASE_SEC.recover, 'idle'],
  ];

  it('sampling either side of each boundary yields the same pose (no pops)', () => {
    for (const clock of [0, 0.23, 1.7, 41.309]) {
      for (const [from, exitT, to] of boundaries) {
        const a = poseAt(from, exitT, clock);
        const b = poseAt(to, 0, clock);
        const delta = sampleDelta(a, b);
        expect(delta, `${from}→${to} at clock ${clock}`).toBeLessThanOrEqual(EPS);
      }
    }
  });

  it('entry capture makes variable-exit boundaries exact (early release, overcook, mid-blend)', () => {
    const clock = 0.61;
    const cases: [HandPhase, number, HandPhase][] = [
      ['cook', 0.23, 'throw'],   // early release — cook nowhere near its canonical exit
      ['cook', 0.05, 'throw'],   // released during the first clench frames
      ['cook', 1.9, 'idle'],     // overcook self-detonation → idle
      ['light', 0.06, 'cook'],   // automatic boundary hit mid-blend
      ['throw', 0.05, 'recover'],
      ['recover', 0.2, 'idle'],
    ];
    for (const [from, t, to] of cases) {
      const entry = poseAt(from, t, clock);
      const resumed = poseAt(to, 0, clock, entry);
      expect(sampleDelta(entry, resumed), `${from}@${t}→${to}`).toBeLessThanOrEqual(1e-12);
    }
  });

  it('an entry-blended pose still converges home to the phase target', () => {
    const clock = 1.3;
    const entry = poseAt('cook', 0.4, clock);          // early-release snapshot
    const settled = poseAt('idle', 5, clock, entry);   // long after the blend-in
    const idle = poseAt('idle', 5, clock);
    expect(sampleDelta(settled, idle)).toBeLessThanOrEqual(EPS);
  });
});

// ——— Easing ——————————————————————————————————————————————————————————————————

describe('easing', () => {
  it('smoothstep: 0 at 0, 1 at 1, clamped outside, monotone between', () => {
    expect(smooth01(0)).toBe(0);
    expect(smooth01(1)).toBe(1);
    expect(smooth01(-0.5)).toBe(0);
    expect(smooth01(1.5)).toBe(1);
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = smooth01(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('pose components move monotonically toward the keyframe (light, lead mitten)', () => {
    // bobClock 0 → bob = [0, 0, forwardAmp]; x/y are pure blend terms.
    const kf = HAND_POSES.lead.light[3]!;
    let prevY = -Infinity, prevX = Infinity;
    for (let i = 0; i <= 60; i++) {
      const p = poseAt('light', (i / 60) * HANDS_TUNING.blendSec.light, 0).right[3]!;
      expect(p.pos[1]).toBeGreaterThanOrEqual(prevY); // rises toward kf y
      expect(p.pos[0]).toBeLessThanOrEqual(prevX);    // pulls in toward kf x
      prevY = p.pos[1];
      prevX = p.pos[0];
    }
    const end = poseAt('light', HANDS_TUNING.blendSec.light, 0).right[3]!;
    close(end.pos[1], kf.pos![1]);
    close(end.pos[0], kf.pos![0]);
  });
});

// ——— Idle bob ———————————————————————————————————————————————————————————————

describe('idle bob oscillator', () => {
  const T = HANDS_TUNING.bob.periodSec;

  it('is periodic with exactly HANDS_TUNING.bob.periodSec', () => {
    for (const t of [0, 0.37, 2.71]) {
      const a = bobOffset(t), b = bobOffset(t + T);
      for (let k = 0; k < 3; k++) close(a[k]!, b[k]!, 1e-12);
    }
    // Half a period is NOT the period: x/z flip sign, so the vector differs.
    const a = bobOffset(0.37), h = bobOffset(0.37 + T / 2);
    expect(Math.abs(h[0] - a[0])).toBeGreaterThan(1e-6);
  });

  it('y runs at double frequency (figure-eight sway), x/z at one', () => {
    const a = bobOffset(0.37), h = bobOffset(0.37 + T / 2);
    close(h[1], a[1], 1e-12);  // sin(2θ) repeats after θ+π
    close(h[0], -a[0], 1e-12); // sin(θ)  inverts
    close(h[2], -a[2], 1e-12); // cos(θ)  inverts
  });

  it('idle pose carries the full bob; acting phases damp it', () => {
    expect(poseAt('idle', 3, 1.11).bobWeight).toBeCloseTo(1, 12);
    expect(poseAt('light', 5, 1.11).bobWeight).toBeCloseTo(HANDS_TUNING.bobWeight.light, 12);
    expect(poseAt('cook', 5, 1.11).bobWeight).toBeCloseTo(HANDS_TUNING.bobWeight.cook, 12);
    expect(poseAt('throw', 5, 1.11).bobWeight).toBeCloseTo(0, 12);
  });
});

// ——— fpv cook-state mapping + integration ———————————————————————————————————

describe('handPhaseFromCook maps fpv phases (no second clock)', () => {
  it('splits cooking into light→cook and cooldown into throw→recover', () => {
    const cooking = { phase: 'cooking' as const, phaseAt: 10, cookStart: 10 };
    const lightAt = handPhaseFromCook(cooking, 10.07);
    expect(lightAt.phase).toBe('light');
    close(lightAt.phaseT, 0.07);
    const cookAt = handPhaseFromCook(cooking, 10.9);
    expect(cookAt.phase).toBe('cook');
    close(cookAt.phaseT, 0.9 - HAND_PHASE_SEC.light);
    const cooldown = { phase: 'cooldown' as const, phaseAt: 20, cookStart: 19 };
    const throwAt = handPhaseFromCook(cooldown, 20.05);
    expect(throwAt.phase).toBe('throw');
    close(throwAt.phaseT, 0.05);
    const recAt = handPhaseFromCook(cooldown, 20.3);
    expect(recAt.phase).toBe('recover');
    close(recAt.phaseT, 0.3 - HAND_PHASE_SEC.throw);
    expect(handPhaseFromCook({ phase: 'idle', phaseAt: 5, cookStart: 5 }, 9)).toEqual({ phase: 'idle', phaseT: 4 });
  });

  it('drives a full cook cycle off stepCook’s own state machine (wiring preview)', () => {
    let cook = makeFpv().cook;
    const dt = 1 / 60;
    const order: HandPhase[] = [];
    let allFinite = true;
    let lastPhase: HandPhase | null = null;
    let wraps = 0;
    const rank: Record<HandPhase, number> = { idle: 0, light: 1, cook: 2, throw: 3, recover: 4 };
    for (let i = 0; i < 300; i++) {
      const now = i * dt;
      const press = now >= 0.5 && now < 0.5 + dt;
      const release = now >= 1.3 && now < 1.3 + dt;
      const r = stepCook(cook, { press, release }, now);
      cook = r.state;
      const ref = handPhaseFromCook(cook, now);
      if (ref.phase !== lastPhase) {
        if (lastPhase !== null && rank[ref.phase] < rank[lastPhase]) wraps++;
        order.push(ref.phase);
        lastPhase = ref.phase;
      }
      allFinite &&= finiteSample(poseAt(ref.phase, ref.phaseT, now));
    }
    expect(allFinite).toBe(true);
    expect(order).toEqual(['idle', 'light', 'cook', 'throw', 'recover', 'idle']);
    expect(wraps).toBe(1); // recover→idle is the only rank drop
  });

  it('is finite and defined for degenerate inputs (t=0, negative, past window end)', () => {
    for (const ph of ['idle', 'light', 'cook', 'throw', 'recover'] as const) {
      for (const t of [0, -1, 0.001, HAND_PHASE_SEC.cookMax, 99]) {
        expect(finiteSample(poseAt(ph, t, 0.777))).toBe(true);
      }
    }
  });
});

// ——— Verlet jiggle spec —————————————————————————————————————————————————————

describe('jiggle data (for rig.ts)', () => {
  it('has one entry per prim, sane ranges, forearm pinned as the frame anchor', () => {
    expect(HAND_JIGGLE.perPrim.length).toBe(HAND_PRIM_COUNT);
    HAND_JIGGLE.perPrim.forEach((pj, i) => {
      expect(pj.stiffness).toBeGreaterThan(0);
      expect(pj.stiffness).toBeLessThanOrEqual(1);
      expect(pj.damping).toBeGreaterThan(0);
      expect(pj.damping).toBeLessThanOrEqual(1);
      expect(pj.pinned).toBe(i === 0); // only the forearm stub
    });
    for (const v of HAND_JIGGLE.gravity) expect(Number.isFinite(v)).toBe(true);
    expect(HAND_JIGGLE.restStiffness).toBeGreaterThan(0);
    expect(HAND_JIGGLE.restStiffness).toBeLessThanOrEqual(1);
  });
});

// ——— Determinism ———————————————————————————————————————————————————————————

describe('determinism', () => {
  it('identical arguments → bit-identical samples; scripted play-through repeats', () => {
    expect(poseAt('cook', 0.666, 4.2)).toEqual(poseAt('cook', 0.666, 4.2));

    const play = (): string => {
      let cook = makeFpv().cook;
      const trace: unknown[] = [];
      for (let i = 0; i < 400; i++) {
        const now = i / 60;
        const press = now >= 1 && now < 1 + 1 / 60;
        const release = now >= 2.6 && now < 2.6 + 1 / 60;
        const r = stepCook(cook, { press, release }, now);
        cook = r.state;
        const ref = handPhaseFromCook(cook, now);
        const s = poseAt(ref.phase, ref.phaseT, now);
        if (i % 7 === 0) trace.push(s);
      }
      return JSON.stringify(trace);
    };
    expect(play()).toBe(play());
  });
});
