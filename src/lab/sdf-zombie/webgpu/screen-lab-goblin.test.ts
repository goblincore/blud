// src/lab/sdf-zombie/webgpu/screen-lab-goblin.test.ts
//
// The screen lab's goblin (screen-lab-goblin.ts) against the plan's boundaries and the real goblin-home body: the clips come in the
// sequence's order AT THE EGG'S CUES (goblinCues: he reacts a beat after the sac bulges and sits up after the egg lands, derived from the
// timeline and the field), `local` restarts at 0 at every cut and never goes negative, the clip before a cut has finished playing when the
// cut lands, the POSE does not jump at any cut, no joint moves faster than 2.5 m/s, the limited frame rate (stepClock) holds each pose for
// a frame and still lands every clip's end pose, the pushback (goblinRootAt) is continuous and bounded, and, on the floor-level set laid out
// from the measured typing pose (floorLayout): the board is the Flat's kotatsu height, the arms never rise above the shoulders, nothing goes
// through the board, its skirt, the floor, the cushion, the keyboard or the egg, he is clear of the sac while it pushes, his hands land on
// the keys, the floor and his knees (never the egg), and his HEAD looks at the sac while he leans back and at the egg once it has landed.
import { describe, it, expect } from 'vitest';
import goblinHomeSrc from '../characters/goblin-home.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { bindRig, applyRig, headQuatOf } from '../rig-bind';
import { qRotate } from '../vec';
import { sdBody } from '../validate';
import { jointNamesForBody } from '../gait';
import { makePoseRig, poseJoints } from '../pose';
import { FLOOR_SEAT } from '../characters/goblin-poses';
import { CURVES, DURATION, paramsAt, type Curves } from './emergence-timeline';
import { DESK_Y, EGG, EGG_REST, KEYBOARD_RECT, KEYBOARD_TOP, KOTATSU, SLUMP, eggCentre, ellipsoidDist, sacExtent } from './emergence-field';
import {
  GOBLIN_CUES, GOBLIN_CUTS, GOBLIN_FPS, GOBLIN_LAGS, GOBLIN_ROOT, floorLayout, goblinClipAt, goblinCues, goblinRootAt, measureSeat, pinToPose, stepClock,
  type FloorLayout,
} from './screen-lab-goblin';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { MOTION_TUNING } from '../motion';
import { makeRng } from '../wander';
import type { Primitive, Vec3 } from '../types';

const doc = parseBlob(goblinHomeSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const names = jointNamesForBody(body);
const rig = makePoseRig(doc, names, bindRig(body).rig.restPose);
const J = (n: string) => names.indexOf(n as never);
const clipEnd = (c: { keys: { t: number }[] }) => c.keys[c.keys.length - 1]!.t;
const EPS = 1e-6;

/** The posed joints at sequence time t, in the goblin's world (the page's scoot applied along z, as the page does). */
const jointsAt = (t: number) => {
  const { clip, local } = goblinClipAt(t);
  const dz = goblinRootAt(t);
  return poseJoints(rig, clip, local).map(p => [p[0], p[1], p[2] + dz] as Vec3);
};
/** goblin-home's FLESH on those joints (cloth shells skipped: they bear no weight and their bound is the unclipped base). */
const fleshOf = (joints: readonly Vec3[]): Primitive[] => {
  const bound = bindRig(body);
  bound.rig.points = bound.rig.points.map((p, i) => ({ ...p, pos: joints[i]!, prev: joints[i]! }));
  return applyRig(body, bound, 0).prims.filter(p => !p.shell && p.bone);
};
/** Points along a prim's axis with the flesh radius there: `r` across (the larger of the x and z scales: conservative at the board's
 *  edges) and `ry` up and down (the y scale: heights). */
const samples = (p: Primitive, n = 8) => Array.from({ length: n + 1 }, (_, i) => {
  const f = i / n, rr = p.radius + ((p.radiusB ?? p.radius) - p.radius) * f;
  return { q: [p.a[0] + (p.b[0] - p.a[0]) * f, p.a[1] + (p.b[1] - p.a[1]) * f, p.a[2] + (p.b[2] - p.a[2]) * f] as Vec3,
    r: rr * Math.max(p.scale[0], p.scale[2]), ry: rr * p.scale[1], rMin: rr * Math.min(...p.scale) };
});
const ball = (ps: Primitive[], bone: string) => {
  const h = ps.find(p => p.bone === bone)!;
  return { c: [(h.a[0] + h.b[0]) / 2, (h.a[1] + h.b[1]) / 2, (h.a[2] + h.b[2]) / 2] as Vec3, r: h.radius, ry: h.radius * h.scale[1], rMin: h.radius * Math.min(...h.scale) };
};

// The set, from the typing pose (the page does the same: measure, then lay out).
const L: FloorLayout = floorLayout(measureSeat(fleshOf(jointsAt(1.0))));
/** World (the goblin's frame) to the screen's frame: the screen group is turned half round y and sits at (0, glassY, glassZ). */
const toScreen = (w: Vec3): Vec3 => [-w[0], w[1] - L.glassY, L.glassZ - w[2]];
const eggGap = (q: Vec3, t: number) => {
  const c = eggCentre(paramsAt(t)), s = toScreen(q);
  return ellipsoidDist([s[0] - c[0], s[1] - c[1], s[2] - c[2]], [EGG.rx, EGG.ry, EGG.rz]);
};
/** The screen frame back to the goblin's world. */
const toWorldOf = (s: Vec3): Vec3 => [-s[0], s[1] + L.glassY, L.glassZ - s[2]];
/** The head as the page turns it: the rigid head's rotation (headQuatOf on the pinned rig, its gaze cone clamp included) applied to the
 *  face's rest forward (+z), from the head's centre (midway between the neck and head joints). */
const headAt = (joints: readonly Vec3[]) => {
  const bound = pinToPose(bindRig(body), joints);
  const q = headQuatOf(bound, 0)!, n = joints[J('neck')]!, h = joints[J('head')]!;
  return { fwd: qRotate(q, [0, 0, 1]), c: [(n[0] + h[0]) / 2, (n[1] + h[1]) / 2, (n[2] + h[2]) / 2] as Vec3 };
};
/** His flesh's least clearance from the egg's surface from 7 s on (he only looks at it: measured 0.46 m, his skull at 12 s), from the
 *  apex's plane while the sac pushes (his nearest flesh: 0.32 m, the left shin at 6.5 s), and his head's centre from the apex (0.72 m). */
const MIN_EGG_GAP = 0.35, MIN_SAC_GAP = 0.25, MIN_HEAD_GAP = 0.6;
const GRID = (a: number, b: number, dt: number) => Array.from({ length: Math.round((b - a) / dt) + 1 }, (_, i) => Math.min(b, a + i * dt));
const C = GOBLIN_CUES;
const same = (a: readonly Vec3[], b: readonly Vec3[], tol = 1e-9) => a.every((p, i) => Math.hypot(p[0] - b[i]![0], p[1] - b[i]![1], p[2] - b[i]![2]) < tol);

describe('goblinCues (cause and effect: the owner, 2026-10-14, "the animation timing between the egg and the goblin backing up is a bit too off")', () => {
  it('the bulge is the first time the sac stands GOBLIN_LAGS.bulgeSeen past the glass (sacExtent), read off the timeline', () => {
    expect(sacExtent(paramsAt(C.bulgeSeen))).toBeGreaterThan(GOBLIN_LAGS.bulgeSeen);
    expect(sacExtent(paramsAt(C.bulgeSeen - 1e-5))).toBeLessThanOrEqual(GOBLIN_LAGS.bulgeSeen);
    for (const t of GRID(0, C.bulgeSeen - 0.01, 0.01)) expect(sacExtent(paramsAt(t)), `t=${t}`).toBeLessThanOrEqual(GOBLIN_LAGS.bulgeSeen);
  });

  it('the landing is when the egg\'s fall ends: eggCentre is down at its rest height on the keyboard then, and above it just before', () => {
    expect(eggCentre(paramsAt(C.land))[1]).toBeCloseTo(EGG_REST[1], 6);
    expect(eggCentre(paramsAt(C.land - 0.01))[1]).toBeGreaterThan(EGG_REST[1] + 0.001);   // falling at about 0.17 m/s there
    for (const t of GRID(0, C.land - 0.01, 0.01)) expect(eggCentre(paramsAt(t))[1], `t=${t}`).toBeGreaterThan(EGG_REST[1]);
    // the timeline's slump is linear over its two keys, so the landing is SLUMP.land of the way through it
    const k = CURVES.slump.filter(x => x.v === 0).pop()!.t, k1 = CURVES.slump.find(x => x.v === 1)!.t;
    expect(C.land).toBeCloseTo(k + (k1 - k) * SLUMP.land, 5);
  });

  it('he reacts a human beat AFTER each event, never before: the flinch the lag after the bulge, the sit-up the lag after the landing', () => {
    expect(GOBLIN_LAGS.flinch).toBeGreaterThanOrEqual(0.25);
    expect(GOBLIN_LAGS.sitUp).toBeGreaterThanOrEqual(0.3);
    expect(C.flinch - C.bulgeSeen).toBeGreaterThanOrEqual(GOBLIN_LAGS.flinch - 1e-9);
    expect(C.sitUp - C.land).toBeGreaterThanOrEqual(GOBLIN_LAGS.sitUp - 1e-9);
    expect(C.sitUp).toBeGreaterThan(C.land);
    // the brace settles about a second after the flinch, the sit-up takes about 1.4 s
    expect(C.braced - C.flinch).toBeGreaterThan(0.8);
    expect(C.braced - C.flinch).toBeLessThan(1.2);
    expect(C.sitUpDone - C.sitUp).toBeCloseTo(1.4, 9);
  });

  it('THE HOLD: nothing of him moves from the start to the flinch (a dead beat after the bulge), then the flinch begins at once', () => {
    const still = jointsAt(0);
    for (const t of [...GRID(0, C.flinch - 0.005, 0.05), C.flinch - 1e-6]) expect(same(jointsAt(t), still), `t=${t.toFixed(3)}`).toBe(true);
    expect(goblinRootAt(C.flinch)).toBe(0);
    // abrupt: in the first 20 ms the hands already move at the first segment's whole speed (a linear segment: no ease-in; a smoothstep
    // would cover half of that)
    const k1 = GOBLIN_CUTS[1]!.clip.keys[1]!.t, d = (u: number) => { const a = jointsAt(C.flinch), b = jointsAt(C.flinch + u); return Math.hypot(...[0, 1, 2].map(k => b[J('handL')]![k]! - a[J('handL')]![k]!)) / u; };
    expect(d(0.02)).toBeGreaterThan(0.8 * d(k1));
  });

  it('he stays braced, still, from the brace through the push, the tear opening and the egg\'s fall, until the sit-up', () => {
    const i = CURVES.tear.findIndex(k => k.v > 0), tearOpens = CURVES.tear[i - 1]!.t;
    expect(C.scootEnd).toBeLessThan(tearOpens);                  // settled before the tear starts to open (6.5 s)
    expect(C.scootEnd).toBeLessThan(5);
    const held = jointsAt(C.scootEnd);
    for (const t of [...GRID(C.scootEnd, C.sitUp - 0.005, 0.05), C.sitUp - 1e-6]) {
      expect(goblinClipAt(t).clip.name, `t=${t.toFixed(2)}`).toBe('brace-back');
      expect(same(jointsAt(t), held), `t=${t.toFixed(2)}`).toBe(true);
    }
  });

  it('follows the egg if its curves are retuned: push and slump keys a second later move his cues later', () => {
    const later = (keys: Curves['push']) => keys.map(k => (k.t === 0 ? k : { ...k, t: Math.min(DURATION, k.t + 1) }));
    const moved: Curves = { ...CURVES, push: later(CURVES.push), slump: later(CURVES.slump) };
    const c = goblinCues(moved);
    expect(c.bulgeSeen - C.bulgeSeen).toBeGreaterThan(0.3);        // the first push key (0 to 2.5 s) stretches, so the bulge comes later
    expect(c.flinch - c.bulgeSeen).toBeCloseTo(GOBLIN_LAGS.flinch, 9);
    expect(c.land).toBeGreaterThan(C.land + 0.5);
    expect(c.sitUp - c.land).toBeCloseTo(GOBLIN_LAGS.sitUp, 9);
  });

  it('refuses curves that never bulge the sac (no cue to react to)', () => {
    expect(() => goblinCues({ ...CURVES, push: [{ t: 0, v: 0 }, { t: DURATION, v: 0 }] })).toThrow();
  });
});

describe('the limited frame rate (early amateur CGI: his body at GOBLIN_FPS poses a second, the egg and the camera smooth)', () => {
  it('is 15 fps by default; 0 is the smooth clock', () => {
    expect(GOBLIN_FPS).toBe(15);
    for (const t of GRID(0, DURATION, 0.013)) {
      expect(goblinClipAt(t, 0)).toEqual(goblinClipAt(t));
      expect(goblinRootAt(t, 0)).toBe(goblinRootAt(t));
    }
  });

  it('stepClock floors to the rate inside a clip and passes the end through (the last key is never skipped)', () => {
    expect(stepClock(0.1, 1, 15)).toBeCloseTo(1 / 15, 12);
    expect(stepClock(2 / 15, 1, 15)).toBeCloseTo(2 / 15, 12);            // on a frame boundary: that frame, not the one before
    expect(stepClock(0.99, 1, 15)).toBeCloseTo(14 / 15, 12);
    expect(stepClock(1, 1, 15)).toBe(1);
    expect(stepClock(1.3, 1, 15)).toBe(1.3);
    expect(stepClock(0.37, 1, 0)).toBe(0.37);
  });

  it('the pose and the pushback are piecewise constant at the rate (a frame starts at each clip\'s start), lagging the smooth motion by under a frame', () => {
    const fps = GOBLIN_FPS;
    for (const t of GRID(0, DURATION, 0.004)) {
      const q = goblinClipAt(t, fps), s = goblinClipAt(t);
      expect(q.clip).toBe(s.clip);
      expect(q.local).toBeLessThanOrEqual(s.local + 1e-12);
      expect(s.local - q.local).toBeLessThan(1 / fps + 1e-9);
      // inside a clip's playing time, the stepped clock is a whole number of frames from its start
      if (s.local < q.clip.keys[q.clip.keys.length - 1]!.t) expect(Math.abs(q.local * fps - Math.round(q.local * fps)), `t=${t}`).toBeLessThan(1e-6);
    }
    // constant within each frame: the start and the end of every whole frame of the lean-back, the sit-up and the pushback
    for (const cut of [GOBLIN_CUTS[1]!, GOBLIN_CUTS[3]!]) for (let k = 0; (k + 1) / fps <= clipEnd(cut.clip) + 1e-9; k++) {
      const a = cut.start + k / fps + 1e-6, b = cut.start + (k + 1) / fps - 1e-6;
      expect(goblinClipAt(b, fps), `${cut.clip.name} frame ${k}`).toEqual(goblinClipAt(a, fps));
    }
    for (let k = 0; (k + 1) / fps <= GOBLIN_ROOT.scoot; k++) {
      const a = C.flinch + k / fps + 1e-6, b = C.flinch + (k + 1) / fps - 1e-6;
      expect(goblinRootAt(b, fps), `pushback frame ${k}`).toBe(goblinRootAt(a, fps));
    }
  });

  it('every clip still reaches its end pose at its end, and the pushback its end, on the stepped clock', () => {
    const fps = GOBLIN_FPS;
    for (const cut of GOBLIN_CUTS) {
      const end = cut.clip.keys[cut.clip.keys.length - 1]!.t;
      if (end === 0) continue;
      // at the clip's end (the next clip may cut in right there: it starts on this one's end pose)
      const q = goblinClipAt(cut.start + end + 1e-9, fps);
      expect(same(poseJoints(rig, q.clip, q.local), poseJoints(rig, cut.clip, end)), cut.clip.name).toBe(true);
    }
    expect(goblinRootAt(C.scootEnd + 1e-9, fps)).toBeCloseTo(GOBLIN_ROOT.back, 12);
    expect(goblinRootAt(DURATION, fps)).toBeCloseTo(GOBLIN_ROOT.back, 12);
  });
});

describe('goblinClipAt', () => {
  it('plays floor-type, lean-back, brace-back, sit-up-look in that order, cut at the cues', () => {
    const seen: string[] = [];
    for (let t = 0; t <= DURATION; t += 0.01) {
      const n = goblinClipAt(t).clip.name;
      if (seen[seen.length - 1] !== n) seen.push(n);
    }
    expect(seen).toEqual(['floor-type', 'lean-back', 'brace-back', 'sit-up-look']);
    expect(GOBLIN_CUTS.map(c => [c.clip.name, c.start])).toEqual(
      [['floor-type', 0], ['lean-back', C.flinch], ['brace-back', C.braced], ['sit-up-look', C.sitUp]]);
    // the flinch about 3.35 s, braced about 4.35; the sit-up from about 11.6 s, done by about 13.0 s (then he holds, looking)
    expect(C.flinch).toBeGreaterThan(3.2);
    expect(C.flinch).toBeLessThan(3.5);
    expect(C.sitUp).toBeGreaterThan(11.5);
    expect(C.sitUpDone).toBeLessThan(13.2);
    expect(clipEnd(GOBLIN_CUTS[3]!.clip)).toBeCloseTo(1.4, 9);
  });

  it('the last clip is sit-up-look, held past the end; the page plays no chair, arms-up or reach-for-the-egg clip', () => {
    expect(goblinClipAt(DURATION).clip.name).toBe('sit-up-look');
    expect(goblinClipAt(DURATION + 5).clip.name).toBe('sit-up-look');
    const held = poseJoints(rig, goblinClipAt(C.sitUpDone).clip, goblinClipAt(C.sitUpDone).local), end = poseJoints(rig, goblinClipAt(DURATION).clip, goblinClipAt(DURATION).local);
    held.forEach((p, i) => { for (const k of [0, 1, 2]) expect(Math.abs(p[k]! - end[i]![k]!)).toBeLessThan(1e-9); });   // settled by the sit-up's end, held
    for (const c of GOBLIN_CUTS) expect(['sit', 'type', 'jolt', 'recoil', 'touch', 'reach', 'crawl-in', 'crawl-reach']).not.toContain(c.clip.name);
  });

  it('local is never negative, even before 0', () => {
    for (let t = -1; t <= DURATION + 1; t += 0.05) expect(goblinClipAt(t).local).toBeGreaterThanOrEqual(0);
  });

  it('local runs with the clock inside a clip and restarts at 0 at each cut', () => {
    for (const cut of GOBLIN_CUTS) {
      expect(goblinClipAt(cut.start).clip).toBe(cut.clip);
      expect(goblinClipAt(cut.start).local).toBeCloseTo(0, 9);
      expect(goblinClipAt(cut.start + 0.1).local).toBeCloseTo(0.1, 9);
    }
  });

  it('the clip before each cut has finished by the cut, and the pose is continuous across it (on the real skeleton)', () => {
    for (let i = 1; i < GOBLIN_CUTS.length; i++) {
      const cut = GOBLIN_CUTS[i]!;
      const before = goblinClipAt(cut.start - EPS);
      expect(before.clip).toBe(GOBLIN_CUTS[i - 1]!.clip);
      expect(before.local + EPS).toBeGreaterThanOrEqual(clipEnd(before.clip) - 1e-9);
      const a = poseJoints(rig, before.clip, before.local);
      const b = poseJoints(rig, cut.clip, goblinClipAt(cut.start).local);
      for (let j = 0; j < a.length; j++)
        for (let k = 0; k < 3; k++) expect(Math.abs(a[j]![k]! - b[j]![k]!), `${cut.clip.name} joint ${j}`).toBeLessThan(1e-4);
    }
  });

  it('every joint moves continuously over the whole sequence, scoot included, and no joint faster than 2.5 m/s (the 2026-10-14 tween: the hands swung back at 3.6 m/s, a snap; now about 2.2)', () => {
    let prev = jointsAt(0);
    const dt = 0.005;
    for (const t of GRID(dt, DURATION, dt)) {
      const j = jointsAt(t);
      j.forEach((p, i) => expect(Math.hypot(p[0] - prev[i]![0], p[1] - prev[i]![1], p[2] - prev[i]![2]) / dt, `t=${t.toFixed(3)} ${names[i]}`).toBeLessThan(2.5));
      prev = j;
    }
  });
});

describe('goblinRootAt (the slight pushback)', () => {
  it('is 0 while he types, then a slight pushback (about 0.2 m; the owner: "slides back too far") from the flinch, held to the end', () => {
    for (const t of [-1, 0, 1, 2.3, C.flinch]) expect(goblinRootAt(t)).toBe(0);
    expect(goblinRootAt(C.flinch + 0.1)).toBeLessThan(0);
    for (const t of [C.scootEnd, 5, 8, 10.4, 12, 13, DURATION, DURATION + 3]) expect(goblinRootAt(t)).toBeCloseTo(GOBLIN_ROOT.back, 9);
    expect(GOBLIN_ROOT.back).toBeLessThan(-0.15);
    expect(GOBLIN_ROOT.back).toBeGreaterThan(-0.25);
  });

  it('is continuous and bounded (no step over 1 mm in 1 ms; never in front of where he sat, never past the scoot)', () => {
    let prev = goblinRootAt(-0.5);
    for (let t = -0.5; t <= DURATION + 0.5; t += 0.001) {
      const v = goblinRootAt(t);
      expect(Math.abs(v - prev), `t=${t.toFixed(3)}`).toBeLessThan(0.001);
      expect(v).toBeLessThanOrEqual(0);
      expect(v).toBeGreaterThanOrEqual(GOBLIN_ROOT.back - 1e-12);
      prev = v;
    }
  });
});

describe('the floor-level set and the goblin on it', () => {
  it('is laid out from the measured typing pose: the board at the Flat\'s kotatsu height, the cushion under the seat, the glass DESK_Y above the board', () => {
    expect(Math.abs(L.tableTopY - KOTATSU.top)).toBeLessThan(0.003);
    expect(Math.abs(L.seatTopY - FLOOR_SEAT.top)).toBeLessThan(0.003);
    expect(L.glassY).toBeCloseTo(L.tableTopY - DESK_Y, 9);
    expect(L.floorY).toBeCloseTo(-L.glassY, 9);
    expect(L.tableFrontZ - L.tableBackZ).toBeCloseTo(KOTATSU.d, 9);
    expect(L.tableHalfW).toBeCloseTo(KOTATSU.w / 2, 9);
    expect(L.kneeClearance).toBeGreaterThan(0.02);
    // the board holds the keyboard and the settled egg (its slick: goo-strands.test), and reaches behind the CRT's 0.31 m pedestal
    expect(L.tableFrontZ).toBeGreaterThan(EGG_REST[2] + EGG.rz + 0.04);
    expect(L.tableFrontZ).toBeGreaterThan(KEYBOARD_RECT.z1 + 0.1);
    expect(L.tableBackZ).toBeLessThan(-0.35);
    expect(KEYBOARD_RECT.x1).toBeLessThan(L.tableHalfW - 0.1);
  });

  it('typing: the hand balls rest on the keys, inside the keyboard; the forearms pass over the board\'s front edge, clear of it', () => {
    const ps = fleshOf(jointsAt(1.0));
    for (const s of ['l', 'r']) {
      const b = ball(ps, `hand.${s}`), c = toScreen(b.c);
      expect(Math.abs(c[1] - b.ry - (KEYBOARD_TOP))).toBeLessThan(0.003);
      expect(Math.abs(c[0])).toBeLessThan(KEYBOARD_RECT.x1 - 0.05);
      expect(c[2]).toBeGreaterThan(KEYBOARD_RECT.z0);
      expect(c[2]).toBeLessThan(KEYBOARD_RECT.z1);
      // the forearm's flesh over the board: its lowest point there is on the board's top (a few mm over it at the edge)
      let low = Infinity;
      for (const q of samples(ps.find(p => p.bone === `forearm.${s}`)!, 24)) {
        const sc = toScreen(q.q);
        if (sc[2] - q.r < L.tableFrontZ) low = Math.min(low, sc[1] - q.ry - DESK_Y);
      }
      // Clear of it, no longer resting on it (the hands round, 2026-10-13): with the ball hanging below the wrist (the rig keeps the orb 4.24
      // cm over the hand tip) a forearm that rose from the edge to the keys bent the wrist 60 degrees; the arms now come in higher and the
      // forearms pass about 5 cm over the edge. Not ABOVE the shoulders (the arms test).
      expect(low, `forearm.${s} over the board`).toBeGreaterThan(-0.001);
      expect(low).toBeLessThan(0.08);
    }
  });

  it('the arms are NEVER raised above the shoulders, at any t (the owner: the arms-up recoil "looks weird")', () => {
    for (const t of GRID(0, DURATION, 0.02)) {
      const j = jointsAt(t);
      for (const s of ['L', 'R'])
        for (const n of ['elbow', 'hand', 'handTip'])
          expect(j[J(n + s)]![1], `t=${t.toFixed(2)} ${n}${s}`).toBeLessThan(j[J('shoulder' + s)]![1]);
    }
  });

  it('no flesh through the board, its skirt, the keyboard, the floor or the cushion at any t (the cushion travels with him)', () => {
    const under = L.tableTopY - KOTATSU.t;
    for (const t of GRID(0, DURATION, 0.05)) {
      const dz = goblinRootAt(t);
      for (const p of fleshOf(jointsAt(t))) for (const { q, r, ry } of samples(p)) {
        const s = toScreen(q), at = `t=${t.toFixed(2)} ${p.bone} at ${s.map(v => v.toFixed(3))}`;
        const onCushion = q[0] >= FLOOR_SEAT.x[0] && q[0] <= FLOOR_SEAT.x[1] && q[2] - dz >= FLOOR_SEAT.z[0] && q[2] - dz <= FLOOR_SEAT.z[1];
        expect(q[1] - ry, `${at} under the ${onCushion ? 'cushion' : 'floor'}`).toBeGreaterThan((onCushion ? FLOOR_SEAT.top : 0) - 0.004);
        if (Math.abs(s[0]) < L.tableHalfW + r && s[2] < L.tableFrontZ + r && s[2] > L.tableBackZ - r) {
          expect(q[1] - ry >= L.tableTopY - 0.004 || q[1] + ry <= under, `${at} through the board`).toBe(true);
          // the skirt: a band just inside the board's front and side edges, from its underside down KOTATSU.skirt
          const nearFront = Math.abs(s[2] - (L.tableFrontZ - KOTATSU.inset)) < r + 0.01;
          const nearSide = Math.abs(Math.abs(s[0]) - (L.tableHalfW - KOTATSU.inset)) < r + 0.01;
          if (nearFront || nearSide) expect(q[1] + ry <= under - KOTATSU.skirt || q[1] - ry >= under, `${at} through the skirt`).toBe(true);
        }
        if (s[0] > KEYBOARD_RECT.x0 - r && s[0] < KEYBOARD_RECT.x1 + r && s[2] > KEYBOARD_RECT.z0 - r && s[2] < KEYBOARD_RECT.z1 + r)
          expect(s[1] - ry, `${at} into the keyboard`).toBeGreaterThan(KEYBOARD_TOP - 0.004);
      }
    }
  });

  it('nothing of him goes into the egg at any t, and his hands stay well off it (he looks; he does not touch it)', () => {
    for (const t of GRID(7, DURATION, 0.05)) for (const p of fleshOf(jointsAt(t))) for (const { q, rMin } of samples(p))
      expect(eggGap(q, t) - rMin, `t=${t.toFixed(2)} ${p.bone}`).toBeGreaterThan(MIN_EGG_GAP);
  });

  it('he is clear of the sac while it pushes, tears and lets the egg out (a slight pushback, not close-up: the owner)', () => {
    // With the shorter push (the apex 0.45 m out) and the 0.2 m pushback his nearest flesh stays MIN_SAC_GAP short of the apex's plane,
    // and his head MIN_HEAD_GAP from the apex itself (round one's 0.65 m push needed the 0.55 m slide to keep him 0.3 m clear).
    // From the end of his pushback to the sit-up (it was 3.45 to 10.4 s before the 2026-10-14 retime).
    let closest = Infinity, headGap = Infinity;
    for (const t of GRID(C.scootEnd, C.sitUp, 0.1)) {
      const reach = sacExtent(paramsAt(t));
      for (const p of fleshOf(jointsAt(t))) for (const { q, r } of samples(p)) closest = Math.min(closest, toScreen(q)[2] - r - reach);
      const h = toScreen(headAt(jointsAt(t)).c);
      headGap = Math.min(headGap, Math.hypot(h[0], h[1], h[2] - reach));
    }
    expect(closest).toBeGreaterThan(MIN_SAC_GAP);
    expect(headGap).toBeGreaterThan(MIN_HEAD_GAP);
  });

  it('the sac never reaches him while he is still at the keys or leaning away (he waits a beat after it bulges: his nearest flesh stays 3 cm short of the apex\'s plane)', () => {
    // Measured 4.3 cm at its least, his hands lifting off the keys as the flinch starts (the sac 6 cm out); 9 cm before the retime, when he
    // left before the sac had bulged.
    let closest = Infinity;
    for (const t of GRID(C.bulgeSeen, C.scootEnd, 0.02)) {
      const reach = sacExtent(paramsAt(t));
      for (const p of fleshOf(jointsAt(t))) for (const { q, r } of samples(p)) closest = Math.min(closest, toScreen(q)[2] - r - reach);
    }
    expect(closest).toBeGreaterThan(0.03);
  });

  it('braced back: the hand balls are on the floor behind him; sitting up: the hand balls rest over his knees', () => {
    const back = fleshOf(jointsAt(6.0));
    for (const s of ['l', 'r']) { const b = ball(back, `hand.${s}`); expect(Math.abs(b.c[1] - b.ry)).toBeLessThan(0.004); }
    for (const t of [C.sitUpDone, 13.5, DURATION]) {
      const j = jointsAt(t), ps = fleshOf(j);
      for (const s of ['l', 'r'] as const) {
        const b = ball(ps, `hand.${s}`), knee = j[J('knee' + s.toUpperCase())]!;
        expect(Math.hypot(b.c[0] - knee[0], b.c[2] - knee[2]), `t=${t} hand.${s} over the knee`).toBeLessThan(0.08);
        expect(b.c[1]).toBeGreaterThan(knee[1]);
      }
    }
  });

  // THE HEAD AIM (the owner's third notes: "his head doesn't appear to be looking at the egg when he sits up a bit to presumably take a
  // look"). The head is the rig's rigid head: rig-bind's headQuatOf turns the face's rest forward (+z) with the skull, CLAMPED to a cone
  // round its rest direction (28.6 degrees: the IK gaze limit), exactly as the page sets it (gpu.setHeadRotation). The angle is from the
  // head's centre (midway between the neck and head joints) to the target's centre.
  const aim = (t: number, target: Vec3) => {
    const h = headAt(jointsAt(t)), w = toWorldOf(target), d: Vec3 = [w[0] - h.c[0], w[1] - h.c[1], w[2] - h.c[2]];
    const c = (h.fwd[0] * d[0] + h.fwd[1] * d[1] + h.fwd[2] * d[2]) / (Math.hypot(...h.fwd) * Math.hypot(...d));
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  };

  it('looks at the egg: from its landing (11.125 s) within 30 degrees (still braced, looking where the sac was), locking on during the sit-up, within 10 degrees from the sit-up\'s end to the end', () => {
    // since the 2026-10-14 retime he sits up half a second AFTER the landing, so the 10-degree aim starts at the sit-up's end
    for (const t of GRID(C.land, C.sitUpDone, 0.05)) expect(aim(t, eggCentre(paramsAt(t))), `t=${t.toFixed(2)}`).toBeLessThan(30);
    for (const t of GRID(C.sitUpDone, DURATION, 0.05)) expect(aim(t, eggCentre(paramsAt(t))), `t=${t.toFixed(2)}`).toBeLessThan(10);
    // the head comes down onto it DURING the sit-up (its middle key: within 3 degrees well before the hands settle)
    const lock = GRID(C.sitUp, DURATION, 0.01).find(t => aim(t, eggCentre(paramsAt(t))) < 3)!;
    expect(lock).toBeGreaterThan(C.sitUp);
    expect(lock).toBeLessThan(C.sitUpDone - 0.3);
    // pitched DOWN at it (the egg sits on the keyboard, well below his eyes)
    expect(headAt(jointsAt(DURATION)).fwd[1]).toBeLessThan(-0.25);
  });

  it('watches the sac while braced (from the brace to 10 s): the head\'s forward axis within 15 degrees of the sac\'s apex', () => {
    for (const t of GRID(C.braced, 10, 0.05)) expect(aim(t, [0, 0, sacExtent(paramsAt(t))]), `t=${t.toFixed(2)}`).toBeLessThan(15);
  });
});

describe('the hands (the owner, 2026-10-13: "the hands clip into the floor a bit too much and maybe bend a bit too acutely or look too disconnected")', () => {
  // goblin-home's hand is an orb that the rig hangs 4.24 cm over the hand TIP in world axes (rig-bind turns only upper-arm and forearm prims
  // with their bones): goblin-poses.test.ts has the whole story. Here the contacts are read off the posed FLESH (sdBody, the field the page
  // marches) in the lab's own layout, and the wrist over the whole sequence.
  const posedBody = (joints: readonly Vec3[]) => {
    const bound = bindRig(body);
    bound.rig.points = bound.rig.points.map((p, i) => ({ ...p, pos: joints[i]!, prev: joints[i]! }));
    return applyRig(body, bound, 0);
  };
  /** The flesh's signed gap to the plane y = Y round (x, z): the least sdBody over a 8 cm patch of the plane (negative: sunk into it). */
  const planeGap = (b: ReturnType<typeof posedBody>, Y: number, x: number, z: number) => {
    let m = Infinity;
    for (let i = -10; i <= 10; i++) for (let k = -10; k <= 10; k++) m = Math.min(m, sdBody([x + i * 0.004, Y, z + k * 0.004], b));
    return m;
  };
  const visibleWrist = (j: readonly Vec3[], ps: Primitive[], s: 'l' | 'r') => {
    const S = s.toUpperCase(), w = j[J('hand' + S)]!, e = j[J('elbow' + S)]!, o = ball(ps, `hand.${s}`).c;
    const f = [w[0] - e[0], w[1] - e[1], w[2] - e[2]], u = [o[0] - w[0], o[1] - w[1], o[2] - w[2]];
    const c = (f[0]! * u[0]! + f[1]! * u[1]! + f[2]! * u[2]!) / (Math.hypot(...f) * Math.hypot(...u));
    return { bend: Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI, reach: Math.hypot(...u) };
  };

  it('typing (t 1): the flesh of each hand ball meets the key tops, no more than 3 mm in or 5 mm off', () => {
    const j = jointsAt(1), b = posedBody(j), keyTopW = KEYBOARD_TOP + L.glassY;
    for (const s of ['l', 'r'] as const) {
      const c = ball(fleshOf(j), `hand.${s}`).c, g = planeGap(b, keyTopW, c[0], c[2]);
      expect(g, `hand.${s}`).toBeGreaterThan(-0.003);
      expect(g, `hand.${s}`).toBeLessThan(0.005);
    }
  });

  it('braced back: the flesh of each hand ball meets the floor behind the cushion, wherever the pushback leaves him (0, 0.1 m and the page\'s 0.2 m back)', () => {
    // The pushback only slides him (and the cushion) along z, so the contact is the pose's own.
    const pose = poseJoints(rig, goblinClipAt(6).clip, 0);
    for (const dz of [0, -0.1, GOBLIN_ROOT.back]) {
      const j = pose.map(p => [p[0], p[1], p[2] + dz] as Vec3), b = posedBody(j), ps = fleshOf(j);
      for (const s of ['l', 'r'] as const) {
        const h = ball(ps, `hand.${s}`), g = planeGap(b, 0, h.c[0], h.c[2]);
        expect(g, `dz ${dz} hand.${s}`).toBeGreaterThan(-0.003);
        expect(g, `dz ${dz} hand.${s}`).toBeLessThan(0.005);
        expect(h.c[2] - dz + h.r, `dz ${dz} hand.${s} behind the cushion`).toBeLessThan(FLOOR_SEAT.z[0]);
      }
    }
    expect(goblinClipAt(6).clip.name).toBe('brace-back');
  });

  it('sitting up (from the sit-up\'s end on): the flesh of each hand ball rests on his knee, no more than 3 mm in or 5 mm off (the rest of the body, the arms left out)', () => {
    for (const t of [C.sitUpDone, DURATION]) {
      const j = jointsAt(t), b = posedBody(j), ps = fleshOf(j);
      const noArms = { ...b, prims: b.prims.map(p => (/^(upperarm|forearm|hand)\.[lr]$/.test(p.bone ?? '') ? { ...p, dead: true } : p)) };
      for (const s of ['l', 'r'] as const) {
        const h = ps.find(p => p.bone === `hand.${s}`)!, c = ball(ps, `hand.${s}`).c;
        // the least distance from the ball's surface (the hand prim's radius and scale) to the body's field without the arms (the ball is joined to its own forearm)
        let g = Infinity;
        for (let i = 0; i <= 12; i++) for (let k = 0; k < 24; k++) {
          const th = (i / 12) * Math.PI, ph = (k / 24) * 2 * Math.PI;
          const q: Vec3 = [c[0] + h.radius * h.scale[0] * Math.sin(th) * Math.cos(ph), c[1] - h.radius * h.scale[1] * Math.cos(th), c[2] + h.radius * h.scale[2] * Math.sin(th) * Math.sin(ph)];
          g = Math.min(g, sdBody(q, noArms));
        }
        expect(g, `t=${t} hand.${s}`).toBeGreaterThan(-0.003);
        expect(g, `t=${t} hand.${s}`).toBeLessThan(0.005);
      }
    }
  });

  it('the wrist reads straight-ish at the contacts (t 1 typing, t 5 braced, t 13.5 sitting up: under 40 degrees, the ball within 7.2 cm of the wrist) and never bends past 60 degrees', () => {
    for (const t of [1, 5, 13.5]) {
      const j = jointsAt(t), ps = fleshOf(j);
      for (const s of ['l', 'r'] as const) {
        const w = visibleWrist(j, ps, s);
        expect(w.bend, `t=${t} hand.${s} bend`).toBeLessThan(40);
        expect(w.reach, `t=${t} hand.${s} reach`).toBeLessThan(0.072);
      }
    }
    for (const t of GRID(0, DURATION, 0.02)) {
      const j = jointsAt(t), ps = fleshOf(j);
      for (const s of ['l', 'r'] as const) expect(visibleWrist(j, ps, s).bend, `t=${t.toFixed(2)} hand.${s}`).toBeLessThan(60);
    }
  });
});

describe('pinToPose (the page\'s actor path lands the pose exactly)', () => {
  it('after stepActorMotion the hands, feet and shins are where the pose put them, as the tests above measure them', () => {
    const entry = characterEntry('goblin-home');
    const motion = makeActorMotion(body, { seed: 1709 });
    const poseRig = makePoseRig(doc, motion.motionJoints!.names, motion.motionJoints!.base);
    const step = (t: number) => {
      const { clip, local } = goblinClipAt(t), dz = goblinRootAt(t);
      const joints = poseJoints(poseRig, clip, local).map(p => [p[0], p[1], p[2] + dz] as Vec3);
      stepActorMotion(motion, {
        current: body, dt: 1 / 60, wander: false, armStyle: undefined, headingFollow: MOTION_TUNING.headingFollow, gazeFollow: MOTION_TUNING.gazeFollow,
        bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, rng: makeRng(1709), signals: emptyActorSignals(), profile: { ...entry.profile, prop: undefined },
        forceSpeed: 0, pose: joints,
      });
      return joints;
    };
    // without it, the actor's tip pinning and knee stop move the crossed legs' ankles and toes and the hand tips (the page measured the
    // board 4 cm low before it)
    const raw = step(1.0);
    const moved = motion.bound.rig.points.reduce((m, p, i) => Math.max(m, Math.hypot(p.pos[0] - raw[i]![0], p.pos[1] - raw[i]![1], p.pos[2] - raw[i]![2])), 0);
    expect(moved).toBeGreaterThan(0.05);
    for (const t of [1.0, 2.7, 6, 11, 13]) {
      const joints = step(t);
      motion.bound = pinToPose(motion.bound, joints);
      const page = applyRig(body, motion.bound, motion.lastBodyYaw).prims.filter(p => !p.shell && p.bone);
      const direct = fleshOf(joints);
      expect(page.length).toBe(direct.length);
      page.forEach((p, i) => { for (const k of [0, 1, 2]) { expect(p.a[k]).toBeCloseTo(direct[i]!.a[k]!, 9); expect(p.b[k]).toBeCloseTo(direct[i]!.b[k]!, 9); } });
    }
  });
});

describe('measureSeat', () => {
  const prim = (bone: string, a: [number, number, number], b: [number, number, number], radius: number, radiusB?: number): Primitive =>
    ({ bone, a, b, radius, radiusB, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0 }) as Primitive;
  it('reads the palms, the seat, the knees and the hands off the prims', () => {
    const m = measureSeat([
      prim('hand.l', [0.2, 0.6, 0.7], [0.2, 0.6, 0.7], 0.05), prim('hand.r', [-0.2, 0.62, 0.7], [-0.2, 0.62, 0.7], 0.05),
      prim('thigh.l', [0.08, 0.58, 0], [0.08, 0.55, 0.38], 0.06, 0.04), prim('thigh.r', [-0.08, 0.58, 0], [-0.08, 0.55, 0.38], 0.06, 0.04),
      prim('pelvis', [0, 0.55, -0.06], [0, 0.55, -0.06], 0.07),
      prim('chest', [0, 0.9, 0.1], [0, 0.9, 0.1], 0.2),
    ]);
    expect(m.palmY).toBeCloseTo(0.55, 9);
    expect(m.handZ).toBeCloseTo(0.7, 9);
    expect(m.handHalfSpan).toBeCloseTo(0.2, 9);
    expect(m.seatY).toBeCloseTo(0.48, 9);
    expect(m.seatBackZ).toBeCloseTo(-0.13, 9);
    expect(m.kneeFrontZ).toBeCloseTo(0.44, 9);
    expect(m.kneeTopY).toBeCloseTo(0.59, 9);
  });
  it('skips cloth: a shell on the pelvis or a thigh moves nothing (its bound is the unclipped base, not the hem)', () => {
    const flesh = [
      prim('hand.l', [0.2, 0.6, 0.7], [0.2, 0.6, 0.7], 0.05), prim('hand.r', [-0.2, 0.62, 0.7], [-0.2, 0.62, 0.7], 0.05),
      prim('thigh.l', [0.08, 0.58, 0], [0.08, 0.55, 0.38], 0.06, 0.04), prim('thigh.r', [-0.08, 0.58, 0], [-0.08, 0.55, 0.38], 0.06, 0.04),
      prim('pelvis', [0, 0.55, -0.06], [0, 0.55, -0.06], 0.07),
    ];
    const shell = { thickness: 0.004, clipNormal: [0, -1, 0] as const, clipOffset: -0.5, rim: 0.004 };
    const cloth = [
      { ...prim('pelvis', [0, 0.5, -0.06], [0, 0.56, -0.06], 0.12), shell },
      { ...prim('thigh.l', [0.08, 0.58, 0], [0.08, 0.57, 0.2], 0.09, 0.08), shell },
    ];
    expect(measureSeat([...flesh, ...cloth])).toEqual(measureSeat(flesh));
  });
  it('refuses a body without hands, thighs or pelvis rather than guessing', () => {
    expect(() => measureSeat([prim('chest', [0, 1, 0], [0, 1, 0], 0.2)])).toThrow();
  });
});
