// src/lab/sdf-zombie/characters/goblin-poses.test.ts
//
// The goblin's pose data (goblin-poses.ts) against the real skeleton: every clip resolves, its keys are in order, and no limb
// changes length at ANY sampled time (the angle-space blend's whole point), the feet stay on the ground, and the body stays one piece.
// The FLOOR clips (look round 1: he sits on a zabuton at the low kotatsu) set their own height, so for them "on the ground" is read off
// the posed flesh: nothing under the floor or into the cushion, the pelvis ON the cushion, the arms never above the shoulders, the hand
// balls resting on what they rest on with a straight-ish wrist.
import { describe, it, expect } from 'vitest';
import goblinSrc from './goblin.blob?raw';
import goblinHomeSrc from './goblin-home.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { bindRig, applyRig } from '../rig-bind';
import { jointNamesForBody } from '../gait';
import { len, sub } from '../vec';
import { makePoseRig, poseJoints } from '../pose';
import { posesFor } from '../pose-library';
import { GOBLIN_POSES, FLOOR_SEAT } from './goblin-poses';
import { KEYBOARD, KOTATSU } from '../webgpu/emergence-field';
import type { PoseClip } from '../pose';
import type { Primitive, Vec3 } from '../types';

// The goblin's body, and goblin-home's (the same skeleton plus cloth and bare feet: pose-library.ts gives it the goblin's clips, so the
// clip checks below run on both).
const rigFor = (src: string) => {
  const doc = parseBlob(src);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  const names = jointNamesForBody(body);
  const base = bindRig(body).rig.restPose;
  return { doc, names, base, rig: makePoseRig(doc, names, base) };
};
const { doc, names, base, rig } = rigFor(goblinSrc);
const home = rigFor(goblinHomeSrc);
const J = (name: string) => names.indexOf(name as never);
// The segment lengths below are the authored 1.30 m figures; the .blob's `scale` line makes the compiled limbs K times longer.
const K = doc.scale ?? 1;
const SEGMENTS: [string, string, number][] = [
  ['shoulderL', 'elbowL', 0.235], ['elbowL', 'handL', 0.235], ['shoulderR', 'elbowR', 0.235], ['elbowR', 'handR', 0.235],
  ['hipL', 'kneeL', 0.290], ['kneeL', 'footL', 0.270], ['hipR', 'kneeR', 0.290], ['kneeR', 'footR', 0.270],
];
const restGround = Math.min(base[J('footL')]![1], base[J('footR')]![1]);

/** A floor clip: every key opts out of the ground lock and sets its own height. The others stand or sit on a chair, feet on the floor. */
const isFloor = (c: PoseClip) => c.keys.every(k => k.groundLock === false);
const ALL = Object.values(GOBLIN_POSES);
const STANDING = ALL.filter(c => !isFloor(c)), FLOOR = ALL.filter(isFloor);
const endOf = (c: PoseClip) => c.keys[c.keys.length - 1]!.t;
/** goblin-home's FLESH posed on a clip's joints (cloth shells skipped: they bear no weight). */
const homeBody = buildBody(compileBlob(parseBlob(goblinHomeSrc), compileFace(parseBlob(goblinHomeSrc))));
const flesh = (joints: readonly Vec3[]): Primitive[] => {
  const bound = bindRig(homeBody);
  bound.rig.points = bound.rig.points.map((p, i) => ({ ...p, pos: joints[i]!, prev: joints[i]! }));
  return applyRig(homeBody, bound, 0).prims.filter(p => !p.shell && p.bone);
};
/** Points along a prim's axis with the flesh radius there (the y radius: the bounds below are heights). */
const samples = (p: Primitive, n = 10) => Array.from({ length: n + 1 }, (_, i) => {
  const f = i / n, r0 = p.radius * p.scale[1], r1 = (p.radiusB ?? p.radius) * p.scale[1];
  return { q: [p.a[0] + (p.b[0] - p.a[0]) * f, p.a[1] + (p.b[1] - p.a[1]) * f, p.a[2] + (p.b[2] - p.a[2]) * f] as Vec3, r: r0 + (r1 - r0) * f };
});
const lowest = (ps: Primitive[], bone: RegExp) => Math.min(...ps.filter(p => bone.test(p.bone!)).flatMap(p => samples(p).map(s => s.q[1] - s.r)));
/** What holds him up under (x, z): the cushion's top inside its footprint, the floor (0) outside it. */
const support = (x: number, z: number) =>
  x >= FLOOR_SEAT.x[0] && x <= FLOOR_SEAT.x[1] && z >= FLOOR_SEAT.z[0] && z <= FLOOR_SEAT.z[1] ? FLOOR_SEAT.top : 0;
const near = (a: readonly (readonly number[])[], b: readonly (readonly number[])[], eps = 1e-9) =>
  a.every((p, i) => p.every((v, k) => Math.abs(v - b[i]![k]!) < eps));

describe('goblin poses', () => {
  it('are registered for the goblin (and goblin-home, his body in home clothes; and goblin-cinematic, the same skeleton plus a jaw) and no one else', () => {
    expect(posesFor('goblin')).toBe(GOBLIN_POSES);
    expect(posesFor('goblin-home')).toBe(GOBLIN_POSES);
    expect(posesFor('goblin-cinematic')).toBe(GOBLIN_POSES);
    expect(Object.keys(GOBLIN_POSES).sort()).toEqual(
      ['brace-back', 'floor-type', 'jolt', 'lean-back', 'reach', 'recoil', 'sit', 'sit-up-look', 'stand', 'touch', 'type']);
    expect(FLOOR.map(c => c.name).sort()).toEqual(['brace-back', 'floor-type', 'lean-back', 'sit-up-look']);
    expect(posesFor('zombie')).toEqual({});
  });

  it.each(ALL.map(c => [c.name, c] as const))('%s: keys ascend and limbs keep their length at every sampled time', (_n, clip) => {
    for (let i = 1; i < clip.keys.length; i++) expect(clip.keys[i]!.t).toBeGreaterThan(clip.keys[i - 1]!.t);
    const end = endOf(clip);
    for (let k = 0; k <= 20; k++) {
      const j = poseJoints(rig, clip, (end * k) / 20);
      for (const [a, b, want] of SEGMENTS)
        expect(len(sub(j[J(b)]!, j[J(a)]!)), `${clip.name} t=${(end * k) / 20} ${a}-${b}`).toBeCloseTo(want * K, 6);
    }
  });

  it.each(STANDING.map(c => [c.name, c] as const))('%s (standing or chair): the feet stay on the floor', (_n, clip) => {
    const end = endOf(clip);
    for (let k = 0; k <= 10; k++) {
      const j = poseJoints(rig, clip, (end * k) / 10);
      expect(Math.min(j[J('footL')]![1], j[J('footR')]![1]), `${clip.name} ground`).toBeCloseTo(restGround, 9);
    }
  });

  it.each(Object.values(GOBLIN_POSES).map(c => [c.name, c] as const))('%s on goblin-home: the same joints as the goblin (the cloth moves no joint), so the same lengths and floor', (_n, clip) => {
    expect(home.names).toEqual(names);
    expect(home.base).toEqual(base);
    const end = clip.keys[clip.keys.length - 1]!.t;
    for (let k = 0; k <= 10; k++) {
      const t = (end * k) / 10;
      expect(poseJoints(home.rig, clip, t)).toEqual(poseJoints(rig, clip, t));
    }
  });

  it('sit starts at the standing rest and ends at the typing pose; stand is its reverse', () => {
    const restJ = poseJoints(rig, { name: 'rest', keys: [{ t: 0, bones: {} }] }, 0);
    const typeJ = poseJoints(rig, GOBLIN_POSES.type!, 0);
    const near = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) =>
      a.every((p, i) => p.every((v, k) => Math.abs(v - b[i]![k]!) < 1e-9));
    expect(near(poseJoints(rig, GOBLIN_POSES.sit!, 0), restJ)).toBe(true);
    expect(near(poseJoints(rig, GOBLIN_POSES.sit!, 0.8), typeJ)).toBe(true);
    expect(near(poseJoints(rig, GOBLIN_POSES.stand!, 0), typeJ)).toBe(true);
    expect(near(poseJoints(rig, GOBLIN_POSES.stand!, 0.8), restJ)).toBe(true);
  });

  it('touch runs from the recoil pose to the reach pose, and reach lowers the hand below the shoulder and in front of the knee', () => {
    const near = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) =>
      a.every((p, i) => p.every((v, k) => Math.abs(v - b[i]![k]!) < 1e-9));
    expect(near(poseJoints(rig, GOBLIN_POSES.touch!, 0), poseJoints(rig, GOBLIN_POSES.recoil!, 0))).toBe(true);
    const reachEnd = poseJoints(rig, GOBLIN_POSES.reach!, 0);
    expect(near(poseJoints(rig, GOBLIN_POSES.touch!, GOBLIN_POSES.touch!.keys[GOBLIN_POSES.touch!.keys.length - 1]!.t), reachEnd)).toBe(true);
    expect(reachEnd[J('handL')]![1]).toBeLessThan(reachEnd[J('shoulderL')]![1]);
    expect(reachEnd[J('handL')]![2]).toBeGreaterThan(reachEnd[J('kneeL')]![2] - 0.1);
  });

  it.each(FLOOR.map(c => [c.name, c] as const))('%s (floor): no flesh under the floor or into the cushion, at any sampled time', (_n, clip) => {
    const end = endOf(clip);
    for (let k = 0; k <= 24; k++) {
      const t = (end * k) / 24;
      for (const p of flesh(poseJoints(home.rig, clip, t)))
        for (const { q, r } of samples(p))
          expect(q[1] - r, `${clip.name} t=${t.toFixed(3)} ${p.bone} at ${q.map(v => v.toFixed(3))}`).toBeGreaterThan(support(q[0], q[2]) - 0.003);
    }
  });

  it.each(FLOOR.map(c => [c.name, c] as const))('%s (floor): the arms never rise above the shoulders (elbows, wrists, hand tips)', (_n, clip) => {
    // The owner's note (2026-10-12): the jolt / recoil arms-up "looks weird". He backs away on his hands instead.
    const end = endOf(clip);
    for (let k = 0; k <= 40; k++) {
      const t = (end * k) / 40, j = poseJoints(rig, clip, t);
      for (const s of ['L', 'R'])
        for (const n of ['elbow', 'hand', 'handTip'])
          expect(j[J(n + s)]![1], `${clip.name} t=${t.toFixed(3)} ${n}${s}`).toBeLessThan(j[J('shoulder' + s)]![1]);
    }
  });

  it('sitting (every floor clip: he never leaves the cushion): the pelvis rests ON the cushion top', () => {
    for (const clip of FLOOR) {
      const end = endOf(clip);
      for (let k = 0; k <= 10; k++) {
        const t = (end * k) / 10;
        expect(lowest(flesh(poseJoints(home.rig, clip, t)), /^pelvis$/), `${clip.name} t=${t}`).toBeCloseTo(FLOOR_SEAT.top, 2);
      }
    }
  });

  it('floor-type: the hand balls rest on the key tops (the kotatsu plus the keyboard), the elbows hang by his sides, the knees lower than the skirt', () => {
    const j = poseJoints(home.rig, GOBLIN_POSES['floor-type']!, 0), ps = flesh(j);
    const keyTop = KOTATSU.top + KEYBOARD.t + KEYBOARD.keys;
    for (const s of ['l', 'r']) expect(Math.abs(lowest(ps, new RegExp(`^hand\\.${s}$`)) - keyTop)).toBeLessThan(0.003);
    for (const s of ['L', 'R']) {
      // dropped, not winged out on the board (the first pass's): well under the shoulder and close in to it
      expect(j[J('shoulder' + s)]![1] - j[J('elbow' + s)]![1]).toBeGreaterThan(0.12);
      expect(Math.abs(j[J('elbow' + s)]![0] - j[J('shoulder' + s)]![0])).toBeLessThan(0.1);
    }
    const kneeTop = Math.max(...ps.filter(p => /^(thigh|shin)\./.test(p.bone!)).flatMap(p => samples(p).map(s => s.q[1] + s.r)));
    expect(kneeTop).toBeLessThan(KOTATSU.top - KOTATSU.t - KOTATSU.skirt - 0.03); // lower than the board's quilted skirt, 3 cm to spare
  });

  it('brace-back: a SLIGHT lean back (the owner\'s third notes): the trunk 15 to 25 degrees back, the hand balls flat on the floor just behind the cushion, not a crab', () => {
    const j = poseJoints(home.rig, GOBLIN_POSES['brace-back']!, 0), bb = flesh(j);
    const hips = j[J('hips')]!, chest = j[J('chest')]!, lean = Math.atan2(hips[2] - chest[2], chest[1] - hips[1]) * 180 / Math.PI;
    expect(lean).toBeGreaterThan(15);
    expect(lean).toBeLessThan(25);
    for (const s of ['l', 'r']) {
      const hand = bb.find(p => p.bone === `hand.${s}`)!;
      expect(Math.abs(lowest([hand], /./))).toBeLessThan(0.003);
      expect(hand.a[2] + hand.radius).toBeLessThan(FLOOR_SEAT.z[0]);
      expect(hand.a[2]).toBeGreaterThan(-0.5);   // 0.45 m behind the hips (the crab had them 0.57 back on straight arms)
    }
  });

  it('sit-up-look: sitting up (the trunk within 10 degrees of upright), the hand balls over the knees, no hand anywhere near the board', () => {
    const j = poseJoints(home.rig, GOBLIN_POSES['sit-up-look']!, endOf(GOBLIN_POSES['sit-up-look']!)), ps = flesh(j);
    const hips = j[J('hips')]!, chest = j[J('chest')]!;
    expect(Math.abs(Math.atan2(hips[2] - chest[2], chest[1] - hips[1]) * 180 / Math.PI)).toBeLessThan(10);
    for (const s of ['l', 'r']) {
      const S = s.toUpperCase(), o = orbOf(ps, s as 'l' | 'r'), knee = j[J('knee' + S)]!;
      expect(Math.hypot(o.c[0] - knee[0], o.c[2] - knee[2])).toBeLessThan(0.08);
      expect(o.c[1] - o.ry).toBeLessThan(KOTATSU.top - 0.1);
    }
  });

  // THE HANDS (the owner's note, 2026-10-13: "the hands clip into the floor a bit too much and maybe bend a bit too acutely or look too
  // disconnected to the wrist/forearm"). The hand is goblin-home's ORB (`blob arm on hand at=0.55 r=0.046 deep=0.90`, 0.060 m compiled),
  // and the rig does NOT carry it along the hand bone: rig-bind turns only upper-arm and forearm prims with their bone (ARM_BONE_RE), so the
  // orb binds to its nearest joint, the hand TIP, with its rest offset in WORLD axes: it always sits 0.45 x 0.0942 = 4.24 cm straight ABOVE
  // the hand tip, whatever the hand bone's angle. The hand bone itself draws nothing. So what the eye reads as the wrist is the forearm
  // against the line from the wrist joint to the ORB's centre (`bend` below), and the orb is joined to the arm only while that centre is
  // close to the wrist (`reach`): the forearm ends in a 2.35 cm cap, so past 6.0 + 2.35 = 8.4 cm the ball floats free of it, and past
  // about 7 cm the junction pinches to a neck narrower than the wrist. Before this fit: floor-type 32.6 degrees and 79.7 mm (an 11 mm
  // neck), brace-back 77.5 degrees and 95.1 mm (a 1.1 cm GAP between the forearm and the ball), lean-back up to 106 degrees.
  const orbOf = (ps: Primitive[], s: 'l' | 'r') => { const h = ps.find(p => p.bone === `hand.${s}`)!; return { c: h.a.map((v, k) => (v + h.b[k]!) / 2) as unknown as Vec3, r: h.radius, ry: h.radius * h.scale[1] }; };
  const ang = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b))))) * 180 / Math.PI;
  /** The visible wrist: the forearm's direction against the wrist-to-orb line (degrees), and the orb centre's distance from the wrist. */
  const wrist = (j: readonly Vec3[], ps: Primitive[], s: 'l' | 'r') => {
    const S = s.toUpperCase(), w = j[J('hand' + S)]!, o = orbOf(ps, s).c;
    return { bend: ang(sub(w, j[J('elbow' + S)]!), sub(o, w)), reach: len(sub(o, w)) };
  };
  const PLAYED = FLOOR;

  it('contact poses: each hand ball rests ON its surface (floor-type: the key tops; brace-back: the floor), no more than 3 mm in or 5 mm off', () => {
    const keyTop = KOTATSU.top + KEYBOARD.t + KEYBOARD.keys;
    for (const [name, surface] of [['floor-type', keyTop], ['brace-back', 0]] as const) {
      const ps = flesh(poseJoints(home.rig, GOBLIN_POSES[name]!, 0));
      for (const s of ['l', 'r'] as const) {
        const o = orbOf(ps, s), gap = o.c[1] - o.ry - surface;
        expect(gap, `${name} hand.${s}: the ball's underside over its surface`).toBeGreaterThan(-0.003);
        expect(gap, `${name} hand.${s}`).toBeLessThan(0.005);
      }
    }
  });

  it('contact poses: the wrist reads straight-ish and joined (the forearm within 40 degrees of the wrist-to-ball line, the ball centre within 7.2 cm of the wrist)', () => {
    for (const name of ['floor-type', 'brace-back', 'sit-up-look']) {
      const t = endOf(GOBLIN_POSES[name]!);
      const j = poseJoints(home.rig, GOBLIN_POSES[name]!, t), ps = flesh(j);
      for (const s of ['l', 'r'] as const) {
        const w = wrist(j, ps, s);
        expect(w.bend, `${name} hand.${s} wrist bend`).toBeLessThan(40);
        expect(w.reach, `${name} hand.${s} ball centre from the wrist`).toBeLessThan(0.072);
      }
    }
    // braced on BENT arms since the slight lean back (third notes): the elbows bent 30 to 70 degrees (50), well under the shoulders
    const j = poseJoints(home.rig, GOBLIN_POSES['brace-back']!, 0);
    for (const S of ['L', 'R']) {
      const bend = ang(sub(j[J('elbow' + S)]!, j[J('shoulder' + S)]!), sub(j[J('hand' + S)]!, j[J('elbow' + S)]!));
      expect(bend).toBeGreaterThan(30);
      expect(bend).toBeLessThan(70);
      expect(j[J('shoulder' + S)]![1] - j[J('elbow' + S)]![1]).toBeGreaterThan(0.08);
    }
  });

  it.each(PLAYED.map(c => [c.name, c] as const))('%s: the wrist never bends past 60 degrees at any sampled time', (_n, clip) => {
    const end = endOf(clip);
    for (let k = 0; k <= 60; k++) {
      const t = (end * k) / 60, j = poseJoints(home.rig, clip, t), ps = flesh(j);
      for (const s of ['l', 'r'] as const) expect(wrist(j, ps, s).bend, `${clip.name} t=${t.toFixed(3)} hand.${s}`).toBeLessThan(60);
    }
  });

  it.each(FLOOR.map(c => [c.name, c] as const))('%s: the ball never comes off the forearm (its centre within 8 cm of the wrist: the forearm\'s cap still inside it)', (_n, clip) => {
    const end = endOf(clip);
    for (let k = 0; k <= 60; k++) {
      const t = (end * k) / 60, j = poseJoints(home.rig, clip, t), ps = flesh(j);
      for (const s of ['l', 'r'] as const) expect(wrist(j, ps, s).reach, `${clip.name} t=${t.toFixed(3)} hand.${s}`).toBeLessThan(0.08);
    }
  });

  it('lean-back runs floor-type to brace-back and sit-up-look starts on brace-back (the cuts in the screen lab never pop)', () => {
    const at = (name: string, t: number) => poseJoints(rig, GOBLIN_POSES[name]!, t);
    expect(near(at('lean-back', 0), at('floor-type', 0))).toBe(true);
    expect(near(at('lean-back', endOf(GOBLIN_POSES['lean-back']!)), at('brace-back', 0))).toBe(true);
    expect(near(at('sit-up-look', 0), at('brace-back', 0))).toBe(true);
  });
});
