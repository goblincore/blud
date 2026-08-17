import { describe, expect, it } from 'vitest';
import {
  CIG_EMBER_HOT,
  HANDS_TUNING,
  HAND_AXES,
  HAND_GRIP_PRIMS,
  HAND_JIGGLE,
  HAND_JIGGLE_OF_SIDE,
  HAND_PHASE_SEC,
  HAND_POSES,
  HAND_PRIMS,
  HAND_PRIM_COUNTS,
  HAND_PRIM_GROUPS,
  HAND_PRIM_NAMES,
  HAND_PROPS,
  HAND_SHEETS,
  HAND_SIDE_OF_ROLE,
  PROP_MESH,
  PROP_SEATS,
  STICK_IN_HAND,
  axisDistance,
  bobOffset,
  handPhaseFromCook,
  handSheetPose,
  poseAt,
  propAnchor,
  propFrame,
  smooth01,
  wrapPoint,
  type HandPhase,
  type HandPoseSample,
  type HandRole,
} from './hands';
import { makeFpv, stepCook, FPV_TUNING } from './fpv';
import { DYNAMITE_COOK } from '../../game/gibs/tuning';
import { sdPrimitive, smin } from './validate';
import type { Primitive, Vec3 } from './types';

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

const mid = (p: Primitive, k: number): number => (p.a[k]! + p.b[k]!) / 2;
const midV = (p: Primitive): Vec3 => [mid(p, 0), mid(p, 1), mid(p, 2)];
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Named indices per role — the prim ORDER is interface, so bind names once. */
const IX: Record<HandRole, Record<string, number>> = {
  lead: Object.fromEntries(HAND_PRIM_NAMES.lead.map((n, i) => [n, i])),
  support: Object.fromEntries(HAND_PRIM_NAMES.support.map((n, i) => [n, i])),
};

const roles: HandRole[] = ['lead', 'support'];
const primsOf = (role: HandRole): Primitive[] => HAND_PRIMS[HAND_SIDE_OF_ROLE[role]];

/** The hands' SDF, exactly as the shader folds it (validate.ts is the CPU
 *  mirror of march.wgsl's sdPrim + smin). */
function handField(prims: readonly Primitive[]): (p: Vec3) => number {
  return (p: Vec3): number => {
    let d = 1e9;
    for (const pr of prims) d = smin(d, sdPrimitive(p, pr), pr.blendK);
    return d;
  };
}

// ——— Prim sets ———————————————————————————————————————————————————————————————

describe('hand prim sets', () => {
  it('are seven prims each — silhouette only, detail is the sheet’s job', () => {
    for (const role of roles) {
      expect(primsOf(role).length).toBe(HAND_PRIM_COUNTS[role]);
      expect(HAND_PRIM_COUNTS[role]).toBe(7);
      expect(new Set(HAND_PRIM_NAMES[role]).size).toBe(HAND_PRIM_COUNTS[role]);
    }
  });

  it('have pose groups that partition each prim list exactly once', () => {
    for (const role of roles) {
      const g = HAND_PRIM_GROUPS[role];
      const seen = [...g.forearm, ...g.wrist, ...g.mass, ...g.digits, ...g.thumb]
        .sort((a, b) => a - b);
      expect(seen).toEqual([...Array(HAND_PRIM_COUNTS[role]).keys()]);
    }
  });

  // The headline of this revision: the hands are NOT a mirrored pair any more.
  it('are ASYMMETRIC — neither hand is the other’s x-mirror', () => {
    const L = primsOf('support'), R = primsOf('lead');
    expect(L.length).toBe(R.length); // same count, so index-wise is fair
    let worst = 0;
    for (let i = 0; i < L.length; i++) {
      const mirrored: Vec3 = [-R[i]!.a[0], R[i]!.a[1], R[i]!.a[2]];
      worst = Math.max(worst, dist(L[i]!.a, mirrored), Math.abs(L[i]!.radius - R[i]!.radius));
    }
    // Centimetres apart, not floating-point apart: they are different hands.
    expect(worst).toBeGreaterThan(0.02);
    // And they are named for different jobs.
    expect(HAND_PRIM_NAMES.lead).toContain('fist');
    expect(HAND_PRIM_NAMES.support).toContain('index');
    expect(HAND_PRIM_NAMES.support).not.toContain('fist');
  });

  it('are framed bottom-of-view, lead on the right and support on the left', () => {
    for (const role of roles) {
      for (const p of primsOf(role)) {
        expect(mid(p, 1)).toBeLessThan(0);        // bottom half of the frame
        expect(mid(p, 2)).toBeGreaterThan(0.2);   // inside the camera-anchored box
        expect(mid(p, 2)).toBeLessThan(0.9);
      }
      // The forearm stub exits below the hand mass.
      const g = HAND_PRIM_GROUPS[role];
      const stub = primsOf(role)[g.forearm[0]!]!;
      const mass = primsOf(role)[g.mass[0]!]!;
      expect(Math.min(stub.a[1], stub.b[1])).toBeLessThan(mid(mass, 1) - 0.15);
    }
    expect(mid(primsOf('lead')[HAND_PRIM_GROUPS.lead.mass[0]!]!, 0)).toBeGreaterThan(0);
    expect(mid(primsOf('support')[HAND_PRIM_GROUPS.support.mass[0]!]!, 0)).toBeLessThan(0);
  });

  it('never lifts a forearm’s cut end into frame, in any phase', () => {
    // lab-renderer.ts's camera is a 75° vertical FOV.
    const halfTan = Math.tan((75 * Math.PI) / 180 / 2);
    for (const role of roles) {
      const p = primsOf(role)[HAND_PRIM_GROUPS[role].forearm[0]!]!;
      for (const ph of ['idle', 'light', 'cook', 'throw', 'recover'] as HandPhase[]) {
        const o = HAND_POSES[role][ph][HAND_PRIM_GROUPS[role].forearm[0]!]?.pos ?? [0, 0, 0];
        const y = p.b[1] + o[1] + p.radius;
        const z = p.b[2] + o[2];
        expect(y / (z * halfTan), `${role} ${ph}`).toBeLessThan(-1);
      }
    }
  });
});

// ——— GRIPS MUST GRIP ————————————————————————————————————————————————————————
// The prop is authored first and the digits are wrapped onto it, so contact is
// a construction guarantee. These are the assertions that keep it one.

describe('the grips actually grip', () => {
  it('sinks every grip prim’s surface INTO its prop (contact, not adjacency)', () => {
    const cases: [HandRole, keyof typeof PROP_SEATS][] = [['lead', 'stick'], ['support', 'cig']];
    for (const [role, key] of cases) {
      const seat = PROP_SEATS[key];
      for (const i of HAND_GRIP_PRIMS[role]) {
        const p = primsOf(role)[i]!;
        for (const end of [p.a, p.b] as Vec3[]) {
          // The prim's SURFACE lies inside the prop's outer radius: they touch.
          const surface = axisDistance(seat, end) - p.radius;
          expect(surface, `${role}[${i}] surface`).toBeLessThan(seat.radius);
        }
      }
    }
  });

  it('wraps each digit tangent to its prop, sunk a few authored mm', () => {
    // The wrapped digits (as opposed to the fist, which the bundle passes
    // clean through) sit at radius = propR + primR − sink by construction, so
    // their penetration IS the authored sink. A regression that re-authored a
    // digit in raw camera coordinates would land outside this band.
    const wrapped: [HandRole, keyof typeof PROP_SEATS, string[]][] = [
      ['lead', 'stick', ['knuckles', 'fingerTips', 'thumbBase', 'thumbTip']],
      ['support', 'cig', ['index', 'middle']],
    ];
    for (const [role, key, names] of wrapped) {
      const seat = PROP_SEATS[key];
      for (const name of names) {
        const p = primsOf(role)[IX[role][name]!]!;
        for (const end of [p.a, p.b] as Vec3[]) {
          const sink = seat.radius - (axisDistance(seat, end) - p.radius);
          expect(sink, `${role}.${name} sink`).toBeGreaterThan(0);
          expect(sink, `${role}.${name} sink`).toBeLessThan(p.radius);
        }
      }
    }
  });

  it('passes the bundle THROUGH the fist — the axis is inside the fist mass', () => {
    const fist = primsOf('lead')[IX.lead.fist!]!;
    // The bundle's axis runs inside the fist prim's own radius.
    expect(axisDistance(PROP_SEATS.stick, midV(fist)))
      .toBeLessThan(fist.radius * Math.min(...fist.scale));
  });

  it('OCCLUDES the bundle: a ray from the eye to the grip hits flesh first', () => {
    // The owner's actual complaint was that the bundle floated adjacent to the
    // hand. March the hands' real SDF along the eye→grip ray and require the
    // flesh surface to be crossed BEFORE the bundle's own surface.
    const seat = PROP_SEATS.stick;
    const field = handField(primsOf('lead'));
    const target = seat.grip as Vec3;
    const range = Math.hypot(...target);
    const dir: Vec3 = [target[0] / range, target[1] / range, target[2] / range];
    let fleshAt = Infinity;
    for (let t = 0.05; t < range; t += 0.0015) {
      if (field([dir[0] * t, dir[1] * t, dir[2] * t]) <= 0) { fleshAt = t; break; }
    }
    const bundleAt = range - seat.radius; // the bundle's near surface
    expect(fleshAt).toBeLessThan(bundleAt);
    // And the flesh in front is a real slab, not a graze.
    expect(bundleAt - fleshAt).toBeGreaterThan(0.004);
  });

  it('locks the lead thumb tip across the FRONT of the bundle', () => {
    const f = propFrame(PROP_SEATS.stick);
    const tip = primsOf('lead')[IX.lead.thumbTip!]!;
    // e1 is the prop's camera-facing perpendicular: a positive component means
    // the thumb is on the side the eye is looking from.
    const rel = sub3(midV(tip), PROP_SEATS.stick.grip as Vec3);
    expect(dot3(rel, f.e1)).toBeGreaterThan(0.01);
  });

  it('pinches the cigarette from OPPOSITE sides, index and middle', () => {
    const f = propFrame(PROP_SEATS.cig);
    const idx = primsOf('support')[IX.support.index!]!;
    const mdl = primsOf('support')[IX.support.middle!]!;
    const side = (p: Primitive): number =>
      dot3(sub3(midV(p), PROP_SEATS.cig.grip as Vec3), f.e2);
    // Opposite signs across the cigarette — an actual pinch.
    expect(side(idx) * side(mdl)).toBeLessThan(0);
    // Both seat into the paper by roughly the authored 2 mm: the digit's
    // SURFACE (centre distance minus its radius) sits inside the cigarette's
    // radius by that much.
    for (const p of [idx, mdl]) {
      for (const e of [p.a, p.b] as Vec3[]) {
        const penetration = PROP_SEATS.cig.radius - (axisDistance(PROP_SEATS.cig, e) - p.radius);
        expect(penetration).toBeGreaterThan(0.001);
        expect(penetration).toBeLessThan(0.004);
      }
    }
  });

  it('derives each prop’s anchor so it sits EXACTLY on its authored seat', () => {
    // This is what makes "prop and hand are one unit" mechanical: move a
    // finger and the prop follows, with no second set of numbers to sync.
    for (const [key, role] of [['stick', 'lead'], ['cig', 'support']] as const) {
      const spec = HAND_PROPS[key];
      expect(spec.role).toBe(role);
      const a = propAnchor(primsOf(role), spec);
      for (let k = 0; k < 3; k++) close(a.pos[k]!, PROP_SEATS[key].grip[k]!, 1e-12);
      expect(Math.hypot(...a.axis)).toBeCloseTo(1, 12);
    }
  });

  it('keeps the cigarette’s ember clear of the fingers that hold it', () => {
    // The ember has to be able to touch the fuse, so it must stick out past
    // the pinch rather than sit between the knuckles like the zippo did.
    const seat = PROP_SEATS.cig;
    const ember = wrapPoint(seat, 0, PROP_MESH.cig.above + PROP_MESH.cig.emberM, 0);
    const field = handField(primsOf('support'));
    expect(field(ember)).toBeGreaterThan(0.01); // outside the flesh entirely
  });

  it('is robust to a short prim list (never NaNs a mesh transform)', () => {
    const a = propAnchor([], HAND_PROPS.stick);
    expect(a.pos.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...a.axis)).toBeCloseTo(1, 9);
  });
});

// ——— The detail sheet's projection frame ————————————————————————————————————

describe('hand-detail sheet framing', () => {
  it('gives each hand an orthonormal right-handed frame and its own sheet', () => {
    const sheets = new Set<string>();
    for (const role of roles) {
      const ax = HAND_AXES[role];
      for (const v of [ax.u, ax.w, ax.b]) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      expect(dot3(ax.u, ax.b)).toBeCloseTo(0, 9);
      expect(dot3(ax.u, ax.w)).toBeCloseTo(0, 9);
      expect(dot3(ax.w, ax.b)).toBeCloseTo(0, 9);
      // w = u × b, so (w, u, b) is right-handed — a valid rotation matrix for
      // the projection quaternion the view builds.
      const wx: Vec3 = [
        ax.u[1] * ax.b[2] - ax.u[2] * ax.b[1],
        ax.u[2] * ax.b[0] - ax.u[0] * ax.b[2],
        ax.u[0] * ax.b[1] - ax.u[1] * ax.b[0],
      ];
      for (let k = 0; k < 3; k++) expect(ax.w[k]).toBeCloseTo(wx[k]!, 9);
      // The back of the hand faces the eye (camera looks down +z from 0).
      expect(ax.b[2]).toBeLessThan(0);
      sheets.add(HAND_SHEETS[role].sheet);
    }
    expect(sheets.size).toBe(2); // the two hands never share a sheet
  });

  it('centres the projection on the hand, not the arm, and covers its prims', () => {
    for (const role of roles) {
      const frame = HAND_SHEETS[role];
      expect(frame.prims).not.toContain(HAND_PRIM_GROUPS[role].forearm[0]);
      const pose = handSheetPose(primsOf(role), role);
      for (const v of frame.halfExtent) expect(v).toBeGreaterThan(0.02);
      // Every sheet prim's endpoints land inside head-space |hs| <= 1.3, the
      // march's projection cutoff.
      const ax = HAND_AXES[role];
      for (const i of frame.prims) {
        const p = primsOf(role)[i]!;
        for (const e of [p.a, p.b] as Vec3[]) {
          const rel = sub3(e, pose.centre);
          const hs = [
            dot3(rel, ax.w) / frame.halfExtent[0]!,
            dot3(rel, ax.u) / frame.halfExtent[1]!,
            dot3(rel, ax.b) / frame.halfExtent[2]!,
          ];
          expect(Math.hypot(hs[0]!, hs[1]!, hs[2]!), `${role}[${i}]`).toBeLessThan(1.3);
        }
      }
    }
  });

  it('rides the pose: a cooked hand carries its projection with it', () => {
    const posed = primsOf('lead').map((p, i) => {
      const o = HAND_POSES.lead.cook[i]?.pos ?? [0, 0, 0];
      return { ...p, a: [p.a[0] + o[0], p.a[1] + o[1], p.a[2] + o[2]] as Vec3,
        b: [p.b[0] + o[0], p.b[1] + o[1], p.b[2] + o[2]] as Vec3 };
    });
    const rest = handSheetPose(primsOf('lead'), 'lead');
    const cook = handSheetPose(posed, 'lead');
    expect(dist(rest.centre, cook.centre)).toBeGreaterThan(0.005);
  });
});

// ——— Pose tables ————————————————————————————————————————————————————————

describe('pose keyframes (data integrity)', () => {
  const phases: HandPhase[] = ['idle', 'light', 'cook', 'throw', 'recover'];

  it('references only existing prim indices, with finite 3-vectors', () => {
    for (const role of roles) {
      for (const ph of phases) {
        const kf = HAND_POSES[role][ph];
        expect(kf.length).toBeLessThanOrEqual(HAND_PRIM_COUNTS[role]);
        for (const entry of kf) {
          if (!entry) continue;
          for (const v of [entry.pos ?? [0, 0, 0], entry.scale ?? [1, 1, 1]]) {
            expect(v.length).toBe(3);
            for (const n of v) expect(Number.isFinite(n)).toBe(true);
          }
          for (const n of entry.scale ?? [1, 1, 1]) {
            expect(n).toBeGreaterThan(0.5);
            expect(n).toBeLessThan(2);
          }
        }
      }
    }
  });

  it('brings the CIGARETTE to the FUSE on the light beat', () => {
    // The new light phase: the support hand's ember travels to the bundle's
    // tip. Measure ember-to-fuse, both props riding their posed hands.
    const gapAt = (ph: HandPhase): number => {
      const seatOf = (role: HandRole, key: 'stick' | 'cig'): { pos: Vec3; axis: Vec3 } => {
        const posed = primsOf(role).map((p, i) => {
          const o = HAND_POSES[role][ph][i]?.pos ?? [0, 0, 0];
          return { ...p, a: [p.a[0] + o[0], p.a[1] + o[1], p.a[2] + o[2]] as Vec3,
            b: [p.b[0] + o[0], p.b[1] + o[1], p.b[2] + o[2]] as Vec3 };
        });
        return propAnchor(posed, HAND_PROPS[key]);
      };
      const s = seatOf('lead', 'stick'), c = seatOf('support', 'cig');
      const fuse: Vec3 = [
        s.pos[0] + s.axis[0] * PROP_MESH.stick.above,
        s.pos[1] + s.axis[1] * PROP_MESH.stick.above,
        s.pos[2] + s.axis[2] * PROP_MESH.stick.above,
      ];
      const tip = PROP_MESH.cig.above + PROP_MESH.cig.emberM;
      const ember: Vec3 = [
        c.pos[0] + c.axis[0] * tip, c.pos[1] + c.axis[1] * tip, c.pos[2] + c.axis[2] * tip,
      ];
      return dist(fuse, ember);
    };
    // Contact-ish on the light beat, and much closer than at rest.
    expect(gapAt('light')).toBeLessThan(0.06);
    expect(gapAt('light')).toBeLessThan(gapAt('idle') * 0.5);
    // The fuse then burns on its own and the hands part again.
    expect(gapAt('cook')).toBeGreaterThan(gapAt('light'));
  });

  it('cocks the lead hand for the fuse burn: lower and further out than idle', () => {
    const i = IX.lead.fist!;
    const cook = HAND_POSES.lead.cook[i]!.pos!;
    const idle = HAND_POSES.lead.idle[i]!.pos!;
    expect(cook[1]).toBeLessThan(idle[1]);
    expect(cook[0]).toBeGreaterThan(idle[0]);
    expect(HAND_POSES.lead.cook[IX.lead.knuckles!]!.scale![1]).toBeGreaterThan(1);
  });

  it('extends the lead hand on the throw and drops the support hand clear', () => {
    const lead = HAND_POSES.lead.throw[IX.lead.fist!]!.pos!;
    expect(lead[1]).toBeGreaterThan(0);   // up…
    expect(lead[2]).toBeGreaterThan(0);   // …and forward
    expect(HAND_POSES.support.throw[IX.support.palm!]!.pos![1]).toBeLessThan(0);
    // Fingers open on release.
    expect(HAND_POSES.lead.throw[IX.lead.knuckles!]!.scale![0]).toBeLessThan(1);
    // The arm follows the hand out rather than staying behind.
    const arm = HAND_POSES.lead.throw[IX.lead.forearm!]!.pos!;
    expect(arm[1]).toBeGreaterThan(lead[1] * 0.6);
    expect(arm[1]).toBeLessThan(lead[1]);
  });

  it('makes recover target the idle pose exactly (the motion is the blend home)', () => {
    for (const role of roles) {
      for (let i = 0; i < HAND_PRIM_COUNTS[role]; i++) {
        expect(HAND_POSES[role].recover[i]).toEqual(HAND_POSES[role].idle[i]);
      }
    }
  });

  it('names the phases the view shows each prop in', () => {
    expect([...STICK_IN_HAND]).toEqual(['idle', 'light', 'cook']); // released at throw
    expect([...CIG_EMBER_HOT]).toEqual(['light', 'cook']);         // ember flares
  });
});

// ——— Phase windows derived from fpv's constants ————————————————————————————

describe('phase timing (fpv-owned, never duplicated)', () => {
  it('light + cookMax == the fuse window; throw + recover == fpv throwRecoverSec', () => {
    close(HAND_PHASE_SEC.light + HAND_PHASE_SEC.cookMax, DYNAMITE_COOK.fuseMaxSec);
    close(HAND_PHASE_SEC.throw + HAND_PHASE_SEC.recover, FPV_TUNING.throwRecoverSec);
    expect(HAND_PHASE_SEC.recover).toBeGreaterThan(0);
  });

  it('every blend finishes inside its phase window (continuity precondition)', () => {
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
    ['idle', 4.2, 'light'],
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
        expect(sampleDelta(a, b), `${from}→${to} at clock ${clock}`).toBeLessThanOrEqual(EPS);
      }
    }
  });

  it('entry capture makes variable-exit boundaries exact (early release, overcook)', () => {
    const clock = 0.61;
    const cases: [HandPhase, number, HandPhase][] = [
      ['cook', 0.23, 'throw'],
      ['cook', 0.05, 'throw'],
      ['cook', 1.9, 'idle'],
      ['light', 0.06, 'cook'],
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
    const entry = poseAt('cook', 0.4, clock);
    const settled = poseAt('idle', 5, clock, entry);
    const idle = poseAt('idle', 5, clock);
    expect(sampleDelta(settled, idle)).toBeLessThanOrEqual(EPS);
  });

  it('samples the right prim count per hand (the hands differ now)', () => {
    const s = poseAt('cook', 0.2, 0.5);
    expect(s.right.length).toBe(HAND_PRIM_COUNTS.lead);
    expect(s.left.length).toBe(HAND_PRIM_COUNTS.support);
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

  it('pose components move monotonically toward the keyframe (support light)', () => {
    // bobClock 0 → bob = [0, 0, forwardAmp]; x/y are pure blend terms. The
    // support hand's light gesture is the big one now: it carries the ember in.
    const i = IX.support.palm!;
    const kf = HAND_POSES.support.light[i]!;
    let prevX = -Infinity, prevY = -Infinity;
    for (let n = 0; n <= 60; n++) {
      const p = poseAt('light', (n / 60) * HANDS_TUNING.blendSec.light, 0).left[i]!;
      expect(p.pos[0]).toBeGreaterThanOrEqual(prevX); // travels inward (+x)
      expect(p.pos[1]).toBeGreaterThanOrEqual(prevY); // and up
      prevX = p.pos[0]; prevY = p.pos[1];
    }
    const end = poseAt('light', HANDS_TUNING.blendSec.light, 0).left[i]!;
    close(end.pos[0], kf.pos![0]);
    close(end.pos[1], kf.pos![1]);
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
    const a = bobOffset(0.37), h = bobOffset(0.37 + T / 2);
    expect(Math.abs(h[0] - a[0])).toBeGreaterThan(1e-6);
  });

  it('y runs at double frequency (figure-eight sway), x/z at one', () => {
    const a = bobOffset(0.37), h = bobOffset(0.37 + T / 2);
    close(h[1], a[1], 1e-12);
    close(h[0], -a[0], 1e-12);
    close(h[2], -a[2], 1e-12);
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
    expect(handPhaseFromCook({ phase: 'idle', phaseAt: 5, cookStart: 5 }, 9))
      .toEqual({ phase: 'idle', phaseT: 4 });
  });

  it('drives a full cook cycle off stepCook’s own state machine', () => {
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
    expect(wraps).toBe(1);
  });

  it('is finite and defined for degenerate inputs (t=0, negative, past the end)', () => {
    for (const ph of ['idle', 'light', 'cook', 'throw', 'recover'] as const) {
      for (const t of [0, -1, 0.001, HAND_PHASE_SEC.cookMax, 99]) {
        expect(finiteSample(poseAt(ph, t, 0.777))).toBe(true);
      }
    }
  });
});

// ——— Verlet jiggle spec —————————————————————————————————————————————————————

describe('jiggle data (for rig.ts)', () => {
  it('keeps the SHARED integrator constants exactly as they were', () => {
    // The bounciness is the part that already worked. If this test has to
    // change, it should be because someone meant to retune the feel.
    expect(HAND_JIGGLE.gravity).toEqual([0, -1.6, 0]);
    expect(HAND_JIGGLE.damping).toBe(0.12);
    expect(HAND_JIGGLE.iterations).toBe(3);
    expect(HAND_JIGGLE.restStiffness).toBe(0.18);
    expect(HAND_JIGGLE.linkStiffness).toBe(0.55);
  });

  it('has one entry per prim per role, sane ranges, only the forearm pinned', () => {
    for (const role of roles) {
      const table = HAND_JIGGLE.perPrim[role];
      expect(table.length).toBe(HAND_PRIM_COUNTS[role]);
      table.forEach((pj, i) => {
        expect(pj.stiffness).toBeGreaterThan(0);
        expect(pj.stiffness).toBeLessThanOrEqual(1);
        expect(pj.damping).toBeGreaterThan(0);
        expect(pj.damping).toBeLessThanOrEqual(1);
        expect(pj.pinned).toBe(i === 0);
      });
      // Stiffness falls off outward from the pinned anchor.
      expect(table[0]!.stiffness).toBeGreaterThan(table[2]!.stiffness);
      expect(table[2]!.stiffness).toBeGreaterThan(table[3]!.stiffness);
    }
  });

  it('maps sides to the right role table', () => {
    expect(HAND_JIGGLE_OF_SIDE.right).toBe(HAND_JIGGLE.perPrim.lead);
    expect(HAND_JIGGLE_OF_SIDE.left).toBe(HAND_JIGGLE.perPrim.support);
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
