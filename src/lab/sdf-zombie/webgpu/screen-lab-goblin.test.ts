// src/lab/sdf-zombie/webgpu/screen-lab-goblin.test.ts
//
// The screen lab's goblin (screen-lab-goblin.ts) against the plan's boundaries and the real goblin-home body: the clips come in the
// sequence's order, `local` restarts at 0 at every cut and never goes negative, the clip before a cut has finished playing when the cut
// lands, the POSE does not jump at any cut, the scoot (goblinRootAt) is continuous and bounded, and, on the floor-level set laid out from
// the measured typing pose (floorLayout): the board is the Flat's kotatsu height, the arms never rise above the shoulders, nothing goes
// through the board, its skirt, the floor, the cushion, the keyboard or the egg, he is well clear of the sac while it pushes, and his hands
// land on the keys, the floor, the board and the egg.
import { describe, it, expect } from 'vitest';
import goblinHomeSrc from '../characters/goblin-home.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { bindRig, applyRig } from '../rig-bind';
import { jointNamesForBody } from '../gait';
import { makePoseRig, poseJoints } from '../pose';
import { FLOOR_SEAT } from '../characters/goblin-poses';
import { DURATION, paramsAt } from './emergence-timeline';
import { DESK_Y, EGG, EGG_REST, KEYBOARD_RECT, KEYBOARD_TOP, KOTATSU, eggCentre, ellipsoidDist, sacExtent } from './emergence-field';
import { GOBLIN_CUTS, GOBLIN_ROOT, floorLayout, goblinClipAt, goblinRootAt, measureSeat, pinToPose, type FloorLayout } from './screen-lab-goblin';
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
const GRID = (a: number, b: number, dt: number) => Array.from({ length: Math.round((b - a) / dt) + 1 }, (_, i) => Math.min(b, a + i * dt));

describe('goblinClipAt', () => {
  it('plays floor-type, lean-back, brace-back, crawl-in, crawl-reach in that order, cut where the plan says', () => {
    const seen: string[] = [];
    for (let t = 0; t <= DURATION; t += 0.01) {
      const n = goblinClipAt(t).clip.name;
      if (seen[seen.length - 1] !== n) seen.push(n);
    }
    expect(seen).toEqual(['floor-type', 'lean-back', 'brace-back', 'crawl-in', 'crawl-reach']);
    expect(GOBLIN_CUTS.map(c => [c.clip.name, c.start])).toEqual(
      [['floor-type', 0], ['lean-back', 2.3], ['brace-back', 3.2], ['crawl-in', 10.4], ['crawl-reach', 12.2]]);
  });

  it('the last clip is crawl-reach, held past the end; the page no longer plays the chair or arms-up clips', () => {
    expect(goblinClipAt(DURATION).clip.name).toBe('crawl-reach');
    expect(goblinClipAt(DURATION + 5).clip.name).toBe('crawl-reach');
    for (const c of GOBLIN_CUTS) expect(['sit', 'type', 'jolt', 'recoil', 'touch', 'reach']).not.toContain(c.clip.name);
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

  it('every joint moves continuously over the whole sequence, scoot included (no step over 5 cm in 10 ms: no pop; the fastest, the hands as he throws himself back, is 3.6 m/s)', () => {
    let prev = jointsAt(0);
    for (const t of GRID(0.01, DURATION, 0.01)) {
      const j = jointsAt(t);
      j.forEach((p, i) => expect(Math.hypot(p[0] - prev[i]![0], p[1] - prev[i]![1], p[2] - prev[i]![2]), `t=${t.toFixed(2)} ${names[i]}`).toBeLessThan(0.05));
      prev = j;
    }
  });
});

describe('goblinRootAt (the scoot back and the crawl in)', () => {
  it('is 0 while he types, all the way back through the push, tear and out, then part way in for the reach', () => {
    for (const t of [-1, 0, 1, 2.3]) expect(goblinRootAt(t)).toBe(0);
    for (const t of [3.45, 5, 8, 10.4]) expect(goblinRootAt(t)).toBeCloseTo(GOBLIN_ROOT.back, 9);
    for (const t of [12.2, 13, DURATION, DURATION + 3]) expect(goblinRootAt(t)).toBeCloseTo(GOBLIN_ROOT.reach, 9);
    expect(GOBLIN_ROOT.back).toBeCloseTo(-0.55, 9);
    expect(GOBLIN_ROOT.reach).toBeLessThan(0);
    expect(GOBLIN_ROOT.reach).toBeGreaterThan(GOBLIN_ROOT.back);
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

  it('typing: the hand balls rest on the keys, inside the keyboard; the forearms rest on the board\'s front edge', () => {
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
      expect(low, `forearm.${s} over the board`).toBeGreaterThan(-0.001);
      expect(low).toBeLessThan(0.01);
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

  it('nothing of him goes into the egg at any t (the right hand ball rests ON it at the end)', () => {
    for (const t of GRID(7, DURATION, 0.05)) for (const p of fleshOf(jointsAt(t))) for (const { q, rMin } of samples(p))
      expect(eggGap(q, t) - rMin, `t=${t.toFixed(2)} ${p.bone}`).toBeGreaterThan(-0.004);
  });

  it('he is well back from the sac while it pushes, tears and lets the egg out (not close-up: the owner)', () => {
    let closest = Infinity;
    for (const t of GRID(3.45, 10.4, 0.1)) {
      const reach = sacExtent(paramsAt(t));
      for (const p of fleshOf(jointsAt(t))) for (const { q, r } of samples(p)) closest = Math.min(closest, toScreen(q)[2] - r - reach);
    }
    expect(closest).toBeGreaterThan(0.3);
  });

  it('braced back: the hand balls are on the floor behind him; reaching: the right hand rests on the egg, the left on the board', () => {
    const back = fleshOf(jointsAt(6.0));
    for (const s of ['l', 'r']) { const b = ball(back, `hand.${s}`); expect(Math.abs(b.c[1] - b.ry)).toBeLessThan(0.004); }
    for (const t of [12.2, 13, 14, DURATION]) {
      const ps = fleshOf(jointsAt(t)), hr = ball(ps, 'hand.r'), hl = ball(ps, 'hand.l');
      expect(Math.abs(eggGap(hr.c, t) - hr.rMin), `t=${t} the right hand's flesh to the egg`).toBeLessThan(0.005);
      const el = toScreen(hl.c);
      expect(Math.abs(el[1] - hl.ry - DESK_Y), `t=${t} the left hand on the board`).toBeLessThan(0.004);
      expect(el[2]).toBeLessThan(L.tableFrontZ - hl.r);
      expect(Math.abs(el[0])).toBeGreaterThan(KEYBOARD_RECT.x1 + hl.r * 0.5);   // beside the keyboard, not on its goo
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
