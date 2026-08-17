// src/lab/sdf-zombie/hands.test.ts
import { describe, expect, it } from 'vitest';
import {
  HANDS_TUNING,
  HAND_JIGGLE,
  HAND_PHASE_SEC,
  HAND_POSES,
  HAND_PRIM_COUNT,
  HAND_PRIMS,
  bobOffset,
  handPhaseFromCook,
  poseAt,
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

describe('hand prim set', () => {
  it('has 4–6 prims per hand (claymation-chunky), same count both sides', () => {
    expect(HAND_PRIMS.left.length).toBe(HAND_PRIM_COUNT);
    expect(HAND_PRIMS.right.length).toBe(HAND_PRIM_COUNT);
    expect(HAND_PRIM_COUNT).toBeGreaterThanOrEqual(4);
    expect(HAND_PRIM_COUNT).toBeLessThanOrEqual(6);
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
        const cy = (p.a[1] + p.b[1]) / 2;
        const cz = (p.a[2] + p.b[2]) / 2;
        expect(cy).toBeLessThan(0);            // bottom half of the frame
        expect(cz).toBeGreaterThan(0.2);       // inside the camera-anchored box
        expect(cz).toBeLessThan(0.9);
      }
      const stub = HAND_PRIMS[side][0]!;
      const mitten = HAND_PRIMS[side][3]!;
      // Forearm stub exits below the grip mass.
      expect(Math.min(stub.a[1], stub.b[1])).toBeLessThan(
        (mitten.a[1] + mitten.b[1]) / 2 - 0.15,
      );
      // Mitten converges toward screen centre past the wrist (grip faces in).
      expect(Math.abs((mitten.a[0] + mitten.b[0]) / 2))
        .toBeLessThan(Math.abs((HAND_PRIMS[side][1]!.a[0] + HAND_PRIMS[side][1]!.b[0]) / 2));
    }
    // Lead (right) hand sits on the right of the view, support on the left.
    expect((HAND_PRIMS.right[3]!.a[0] + HAND_PRIMS.right[3]!.b[0]) / 2).toBeGreaterThan(0);
    expect((HAND_PRIMS.left[3]!.a[0] + HAND_PRIMS.left[3]!.b[0]) / 2).toBeLessThan(0);
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
    const leadMitten = HAND_POSES.lead.light[3]!;
    expect(leadMitten.pos![1]).toBeGreaterThan(0);            // raises the stick
    expect(HAND_POSES.support.light[3]!.pos![1]).toBeGreaterThan(
      leadMitten.pos![1],                                     // lighter hand rises higher
    );
    const cookScale = HAND_POSES.lead.cook[3]!.scale!;
    expect(cookScale[1]).toBeGreaterThan(1);                  // mitten swells (tense grip)
    const throwLead = HAND_POSES.lead.throw[3]!.pos!;
    const throwSupport = HAND_POSES.support.throw[3]!.pos!;
    expect(throwLead[1]).toBeGreaterThan(0);                  // lead extends up…
    expect(throwLead[2]).toBeGreaterThan(0);                  // …and forward
    expect(throwSupport[1]).toBeLessThan(0);                  // support drops away
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
