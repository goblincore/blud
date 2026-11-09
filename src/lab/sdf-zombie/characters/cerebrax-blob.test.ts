// cerebrax.blob — the boss brain-spider: a brain in a harness ring on four long spider legs. What this pins: it builds
// and fuses at its boss scale, the toes are on the floor, the brain's top stays inside the body normal map's
// -2.5..2.5 m position range (body-normal.wgsl.ts pos16), every rig point maps to a gait joint, all four feet lift
// through the real motion pipeline, and the knees STAY HIGH (GaitProfile.kneePole / elbowPole): a spider's knee rides
// above its hip through the whole stride, never folding under like a dog's. And the BRAIN IS LOCKED TO ITS HARNESS:
// both ride `pelvis`, so nothing can move one against the other.
import { describe, it, expect } from 'vitest';
import src from './cerebrax.blob?raw';
// The kit's head and harness scripts (Vite ?raw: this suite has no node:fs types, character-registry.test.ts says why).
import headKitSrc from '../../../../assets-source/cerebrax-kit/make_head.py?raw';
import harnessKitSrc from '../../../../assets-source/cerebrax-kit/make_harness.py?raw';
import gunKitSrc from '../../../../assets-source/cerebrax-kit/make_gun.py?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { sdBody } from '../validate';
import { kitFrames } from '../rig-bind';
import { makeRng } from '../wander';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));

describe('cerebrax — a brain on four spider legs', () => {
  it('builds clean at boss scale, toes on the floor', () => {
    expect(body.errors).toEqual([]);
    for (const b of ['hand.l', 'hand.r', 'foot.l', 'foot.r']) {
      expect(Math.abs(body.bones.get(b)!.tail[1]), `${b} tip on the floor`).toBeLessThan(0.03);
    }
    // A boss: the knees tower over a player's 1.6 m eye line.
    expect(body.bones.get('thigh.l')!.tail[1]).toBeGreaterThan(2.5);
  });

  it('keeps the brain under the normal map\'s 2.5 m ceiling', () => {
    // March straight down the brain's axis from above to find its top.
    const c = body.bones.get('skull')!.head;
    let y = 3.2;
    while (y > c[1] && sdBody([c[0], y, c[2]], body) > 1e-3) y -= 0.002;
    expect(y, 'the brain has a top').toBeGreaterThan(c[1]);
    expect(y, 'under the pos16 range, with room for the swell').toBeLessThan(2.47);
  });

  it('walks on four feet with its knees held high', () => {
    const m = makeActorMotion(body, { seed: 3 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    const profile = characterEntry('cerebrax').profile;
    const rng = makeRng(3);
    const lifts: Record<string, number> = { handL: 0, handR: 0, footL: 0, footR: 0 };
    const low: Record<string, number> = {};
    let kneeOverHip = Infinity;
    for (let i = 0; i < 480; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      const P = (k: number) => m.bound.rig.points[k]!.pos as Vec3;
      if (i < 120) { for (const n of Object.keys(lifts)) low[n] = Math.min(low[n] ?? Infinity, P(J[n as 'handL']!)[1]); continue; }
      for (const n of Object.keys(lifts)) lifts[n] = Math.max(lifts[n]!, P(J[n as 'handL']!)[1] - low[n]!);
      for (const [knee, hip] of [['kneeL', 'hipL'], ['kneeR', 'hipR'], ['elbowL', 'shoulderL'], ['elbowR', 'shoulderR']] as const) {
        kneeOverHip = Math.min(kneeOverHip, P(J[knee]!)[1] - P(J[hip]!)[1]);
      }
    }
    for (const [n, lift] of Object.entries(lifts)) expect(lift, `${n} lifts`).toBeGreaterThan(0.10);
    expect(kneeOverHip, 'every knee rides at least 0.6 m over its socket').toBeGreaterThan(0.6);
  });

  it('locks the brain to the harness: the flesh rides `pelvis`, the kit on it rides the frame-pinned `skull`', () => {
    // On the aim chain's sprung skull (the first pass) the brain swayed, nodded and recoiled against the harness
    // (kit on pelvis) and clipped through the ring and the gun (owner, arena look, 2026-11-08). One bone, no gap.
    const flesh = body.prims.filter(p => p.limb === 'torso' && !p.metal);
    expect(flesh.length).toBeGreaterThan(10);
    for (const p of flesh) expect(p.bone, 'every brain and face prim rides pelvis').toBe('pelvis');
    // The harness and the gun are the frame (`pelvis`); the eyes, teeth and tendrils sit ON the flesh, so they ride
    // `skull`, whose points rigidFrame pins to the frame and the game's flesh jiggle shoves (flesh-jiggle.ts).
    const installs = (text: string) => [...text.matchAll(/'(\w+(?:\.[lr])?)\|(\w+)'/g)].map(m => m[1]);
    for (const [file, text] of [['make_harness.py', harnessKitSrc], ['make_gun.py', gunKitSrc]] as const) {
      expect(installs(text).length, `${file} installs parts`).toBeGreaterThan(0);
      for (const bone of installs(text)) expect(bone, `${file}: on the frame`).toBe('pelvis');
    }
    // (Its `drop([...])` lines name the old `pelvis|` copies only to clear them.)
    const head = installs(headKitSrc.split('\n').filter(l => !l.includes('drop(')).join('\n'));
    expect(head.length).toBeGreaterThan(0);
    for (const bone of head) expect(bone, 'make_head.py: on the flesh').toBe('skull');
  });

  it('walks as one rigid frame: the leg roots stay in their sockets and the brain never tips', () => {
    // The verlet legs dragged the hip and shoulder points 20-27 cm off the frame each stride (the kit's legs slid out of
    // their socket balls), and the gait's bob and sway tipped the 4 cm pelvis bone up to 10 deg (the brain and its
    // craters swam). Owner, arena look, 2026-11-09. MotionProfile.rigidFrame.
    const m = makeActorMotion(body, { seed: 3 });
    const profile = characterEntry('cerebrax').profile;
    const rng = makeRng(3);
    const rest = kitFrames(body, m.bound, 0);
    const restOff = (b: string) => rest.get(b)!.pos.map((v, k) => v - rest.get('pelvis')!.pos[k]!);
    let drift = 0, tilt = 0;
    for (let i = 0; i < 480; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      const F = kitFrames(body, m.bound, m.lastBodyYaw);
      const p = F.get('pelvis')!, c = Math.cos(m.lastBodyYaw), s = Math.sin(m.lastBodyYaw);
      // The legs' sockets, and the skull (the kit on the flesh) held to the frame too.
      for (const b of ['thigh.l', 'thigh.r', 'upperarm.l', 'upperarm.r', 'skull']) {
        const o = restOff(b);
        // The socket where the frame (pelvis, yawed) holds it, against where the leg's frame actually starts.
        const want = [p.pos[0] + c * o[0]! + s * o[2]!, p.pos[1] + o[1]!, p.pos[2] - s * o[0]! + c * o[2]!];
        drift = Math.max(drift, Math.hypot(...F.get(b)!.pos.map((v, k) => v - want[k]!)));
      }
      const q = p.quat, upY = 1 - 2 * (q[0]! * q[0]! + q[2]! * q[2]!);   // the frame's up, y component
      tilt = Math.max(tilt, Math.acos(Math.min(1, upY)));
    }
    expect(drift, 'leg roots off their sockets (m)').toBeLessThan(0.005);
    expect(tilt, 'the frame tips (rad)').toBeLessThan(0.01);
  });
});
