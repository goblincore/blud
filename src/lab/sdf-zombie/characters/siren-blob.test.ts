// src/lab/sdf-zombie/characters/siren-blob.test.ts
//
// Pins the siren's DESIGN INTENT (siren.blob's header): beautiful at rest, a
// face that splits open only in the swing. Authored from the owner's brief, no
// reference, so these are STRUCTURAL pins, each naming a decision from the
// .blob. Whether she reads as attractive is the owner's call on frames.
import { describe, it, expect } from 'vitest';
import src from './siren.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { sdBody } from '../validate';
import { checkStance } from '../blob-checks';
import { bindRig } from '../rig-bind';
import { makeMotionJoints } from '../motion';
import { motionProfileFor, SIREN_PROFILE } from '../motion-profile';
import { ATTACK_TUNING, swingGapeAt } from '../attack';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { JAW_MAX_GAPE } from '../jaw';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const bone = (n: string) => {
  const b = body.bones.get(n);
  if (!b) throw new Error(`no bone ${n}`);
  return b;
};

// The fangs are the only ivory prims on her (sclera and lips are sheet paint).
const IVORY = 'e6dcc4';
const isFang = (p: (typeof body.prims)[number]) => !!p.color && p.color[0] > 0.7 && p.color[2] > 0.5 && p.radius < 0.005;

describe('siren — build', () => {
  it('compiles clean, is registered, and stands humanoid', () => {
    expect(body.errors).toEqual([]);
    expect(characterEntry('siren').name).toBe('siren');
    expect(checkStance(body.bones, doc.stance)).toEqual([]);
  });

  it('drives the motion rig, jaw included (the reveal rides the bride\'s hinge)', () => {
    const joints = makeMotionJoints(body, bindRig(body).rig.restPose);
    expect(joints).not.toBeNull();
    expect(joints!.jaw).toBeDefined();
  });

  it('has LONG legs: the hip joint above 55% of her height (the elegant proportion, bride hook 1)', () => {
    const hip = bone('thigh.l').head[1];
    expect(hip / doc.height!).toBeGreaterThan(0.55);
  });
});

describe('siren — the face', () => {
  it('wears her own painted sheet at MULTIPLY in colour, with no glow (no ZOMBIE_FLAT, no glow eyes)', () => {
    const sheet = compileSheet(doc)!;
    expect(sheet).not.toBeNull();
    expect(characterEntry('siren').face.url).toBe('/assets/lab/faces/siren-face.png');
    expect(sheet.decal).toBe(0);
    expect(sheet.blendLuma).toBe(0);
    expect(sheet.eyeGlowAmp).toBe(0);
    expect(body.prims.every(p => !(p.glow && p.glow > 0))).toBe(true);
  });

  it('keeps the CRANIUM as the face frame: no hair prim out-sizes it (game headShape takes ALL prims)', () => {
    const head = body.clusters.find(c => c.limb === 'head')!;
    const prims = body.prims.slice(head.start, head.start + head.count).filter(p => p.op !== 'sub');
    const metric = (p: typeof prims[number]) => p.radius * Math.max(...p.scale);
    const fattest = prims.reduce((m, p) => (metric(p) > metric(m) ? p : m));
    expect(fattest.color).toBeUndefined();
    expect(fattest.shell).toBeUndefined();
    expect(fattest.strand).toBeUndefined();
  });

  it('paints nothing on the face with prims: the only painted face prims are the hidden maw and fangs', () => {
    // The sclera, iris and lip prims of the first passes owned a band of skin
    // each (paint is by nearest prim). All face colour is the sheet's now;
    // the mouth's dark inside (2a0608) and the fangs are buried at rest.
    const skull = bone('skull');
    const faceY = (y: number) => y > skull.head[1] + 0.02 && y < skull.head[1] + 0.17;
    const isMaw = (p: (typeof body.prims)[number]) => !!p.color && p.color[0] < 0.05 && p.color[1] < 0.01;
    const painted = body.prims.filter(p => p.color && !isFang(p) && !isMaw(p) && !p.shell && !p.strand
      && faceY(p.a[1]) && p.a[2] > 0.05 && Math.abs(p.a[0]) < 0.05);
    expect(painted).toEqual([]);
  });
});

describe('siren — the reveal', () => {
  it(`hides every fang (${IVORY}) at least 2 mm inside the rest face`, () => {
    const fangs = body.prims.filter(isFang);
    expect(fangs.length).toBe(14);
    // The field WITHOUT the fangs, so a fang cannot hide behind itself.
    const noFangSrc = src.split('\n').filter(l => !l.includes(`color=${IVORY}`)).join('\n');
    const noFangDoc = parseBlob(noFangSrc);
    const bare = buildBody(compileBlob(noFangDoc, compileFace(noFangDoc)));
    for (const f of fangs) {
      for (const t of [0, 0.5, 1]) {
        const p: [number, number, number] = [
          f.a[0] + (f.b[0] - f.a[0]) * t, f.a[1] + (f.b[1] - f.a[1]) * t, f.a[2] + (f.b[2] - f.a[2]) * t];
        expect(sdBody(p, bare), `fang point ${p.map(v => v.toFixed(3))}`).toBeLessThan(-0.002);
      }
    }
  });

  it('opens the jaw only through the swing, near the hinge ceiling, and shuts it before the swing ends', () => {
    const peak = SIREN_PROFILE.swingGape!;
    expect(motionProfileFor('siren')).toBe(SIREN_PROFILE);
    expect(peak).toBeGreaterThan(0.55); // wider than the bride's sword gape: a face splitting
    expect(peak).toBeLessThanOrEqual(JAW_MAX_GAPE);
    expect(swingGapeAt(0, peak)).toBe(0);
    expect(swingGapeAt((ATTACK_TUNING.windupEnd + ATTACK_TUNING.holdEnd) / 2, peak)).toBe(peak);
    expect(swingGapeAt(0.85, peak)).toBe(0);
    expect(swingGapeAt(1, peak)).toBe(0);
  });

  it('drops the jaw through the zombie mind\'s unarmed HOOK in the real motion step, shut before and after', () => {
    // The game path: motion.ts reads SIREN_PROFILE.swingGape for any swing
    // that is neither the sword's nor the hound's, so the zombie mind's
    // hook (enemy-mind.ts makeZombieMind) is enough to split her face.
    const b = buildBody(compileBlob(doc, compileFace(doc)));
    const m = makeActorMotion(b, { seed: 7 });
    const rng = makeRng(7);
    const gape: { phase: number; g: number }[] = [];
    for (let i = 0; i < 121; i++) {
      const phase = i >= 60 ? Math.min(1, (i - 60) / 60) : undefined;
      const f = stepActorMotion(m, {
        current: b, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile: SIREN_PROFILE, forceSpeed: 0,
        ...(phase !== undefined ? { attack: { phase, side: 'R' as const, variant: 'hook' as const } } : {}),
      })!;
      gape.push({ phase: phase ?? -1, g: f.jawGape });
    }
    expect(gape.filter(x => x.phase < 0).every(x => x.g === 0)).toBe(true);
    expect(Math.max(...gape.map(x => x.g))).toBeCloseTo(SIREN_PROFILE.swingGape!, 5);
    expect(gape[gape.length - 1]!.g).toBe(0);
  });
});
