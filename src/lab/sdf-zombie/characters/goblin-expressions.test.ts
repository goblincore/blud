// src/lab/sdf-zombie/characters/goblin-expressions.test.ts
import { describe, it, expect } from 'vitest';
import { GOBLIN_EXPRESSIONS, GOBLIN_EXPRESSION_TUNING } from './goblin-expressions';
import { expressionsFor } from '../expression-library';
import { expressionAt, actuate, CHANNEL_NAMES } from '../expression';
import { JAW_MAX_GAPE } from '../jaw';
import { compileSheet } from '../blob-compile';
import { generateFaceSheet } from '../blob-face-sheet';
import { parseBlob } from '../blob-parse';
// The CINEMATIC goblin's face (Task 13): the base goblin.blob has no jaw, teeth or morphs.
import goblinSrc from './goblin-cinematic.blob?raw';
import { buildBody } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { motionProfileFor } from '../motion-profile';
import type { MorphWeights } from '../morph';

const authored = compileSheet(parseBlob(goblinSrc))!;

describe('goblin expressions', () => {
  it('are registered for the cinematic goblin and no one else (not the base goblin: Task 13)', () => {
    expect(expressionsFor('goblin-cinematic')?.clips).toBe(GOBLIN_EXPRESSIONS);
    expect(expressionsFor('goblin-cinematic')?.tuning).toBe(GOBLIN_EXPRESSION_TUNING);
    expect(expressionsFor('goblin')).toBeNull();
    expect(Object.keys(GOBLIN_EXPRESSIONS).sort()).toEqual(['grin', 'neutral', 'scowl', 'shout', 'smile', 'surprise']);
    expect(expressionsFor('zombie')).toBeNull();
  });

  it('never asks the jaw for more than jaw.ts allows', () => {
    expect(GOBLIN_EXPRESSION_TUNING.maxGape).toBeLessThanOrEqual(JAW_MAX_GAPE);
  });

  it.each(Object.values(GOBLIN_EXPRESSIONS).map(c => [c.name, c] as const))('%s: keys ascend and every channel stays in range', (_n, clip) => {
    for (let i = 1; i < clip.keys.length; i++) expect(clip.keys[i]!.t).toBeGreaterThan(clip.keys[i - 1]!.t);
    const end = clip.keys[clip.keys.length - 1]!.t;
    for (let k = 0; k <= 10; k++) {
      const c = expressionAt(clip, (end * k) / 10);
      for (const name of CHANNEL_NAMES) expect(Number.isFinite(c[name]), `${clip.name} ${name}`).toBe(true);
      expect(c.gape).toBeGreaterThanOrEqual(0); expect(c.gape).toBeLessThanOrEqual(1);
      expect(Math.abs(c.smile)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.browDown)).toBeLessThanOrEqual(1);
      expect(c.squint).toBeGreaterThanOrEqual(0); expect(c.squint).toBeLessThanOrEqual(1);
    }
  });

  it('neutral is the authored face: no gape, the sheet unchanged, every morph weight 0', () => {
    const a = actuate(expressionAt(GOBLIN_EXPRESSIONS.neutral!, 5), authored, GOBLIN_EXPRESSION_TUNING);
    expect(a.jawGape).toBe(0);
    for (const name of CHANNEL_NAMES) expect(a.morphs[name], name).toBe(0);
    expect(a.sheet).toEqual({ ...authored, eyeLid: 0 });
  });

  it('grin opens the jaw a little and smiles; shout opens it wide; scowl frowns and lowers the brow', () => {
    const at = (name: string) => actuate(expressionAt(GOBLIN_EXPRESSIONS[name]!, 99), authored, GOBLIN_EXPRESSION_TUNING);
    const grin = at('grin'), shout = at('shout'), scowl = at('scowl');
    expect(grin.jawGape).toBeGreaterThan(0.05);
    expect(grin.jawGape).toBeLessThan(shout.jawGape);
    expect(grin.sheet.mouthCurve).toBeLessThan(authored.mouthCurve);       // more of a smile
    expect(shout.jawGape).toBeGreaterThan(0.35);
    expect(scowl.sheet.mouthCurve).toBeGreaterThan(authored.mouthCurve);   // frown
    expect(scowl.sheet.browAngle).toBeGreaterThan(authored.browAngle);
  });
});

// Task 15 (owner on the old grin clip: "it actually reads more like surprise"): a smile is the eyes and cheeks as much as the
// mouth. The grin keeps the jaw nearly shut and narrows the eyes; surprise is its opposite and must stay so.
describe('the grin is a smile, not surprise (Task 15)', () => {
  const GLOW = 224;
  const lit = (sheet: typeof authored) => generateFaceSheet(sheet, 64).pixels.reduce((n, b) => n + (b >= GLOW ? 1 : 0), 0);
  const peak = (name: string) => actuate(expressionAt(GOBLIN_EXPRESSIONS[name]!, 99), authored, GOBLIN_EXPRESSION_TUNING);
  const grin = peak('grin'), smile = peak('smile'), surprise = peak('surprise');

  // Task 18 (the cartoon grin) opened it to 0.18 rad: the crescent's height is the jaw's, its width and upturned corners the
  // smile morphs', and the whole head squashes (wider, shorter).
  it('the grin opens the jaw part way (at most 0.18 rad at its peak), squashes the head and smiles with the eyes: squint, brows down', () => {
    expect(grin.jawGape).toBeLessThanOrEqual(0.18 + 1e-9);
    expect(grin.morphs.squash).toBeGreaterThanOrEqual(0.8);
    expect(grin.morphs.smile).toBe(1);
    expect(grin.morphs.squint).toBeGreaterThanOrEqual(0.7);
    expect(grin.morphs.squint).toBeLessThanOrEqual(0.9);
    expect(grin.morphs.browDown).toBeGreaterThanOrEqual(0.6);
    // The jaw never opens past its peak on the way in.
    const end = GOBLIN_EXPRESSIONS.grin!.keys.at(-1)!.t;
    for (let k = 0; k <= 20; k++)
      expect(actuate(expressionAt(GOBLIN_EXPRESSIONS.grin!, (end * k) / 20), authored, GOBLIN_EXPRESSION_TUNING).jawGape).toBeLessThanOrEqual(0.18 + 1e-9);
  });

  it('the grin\'s lit eye is at most 60% of the neutral\'s on the sheet; the friendly smile narrows it too', () => {
    const n0 = lit(authored);
    expect(lit(grin.sheet)).toBeLessThanOrEqual(n0 * 0.6);
    expect(lit(smile.sheet)).toBeLessThan(n0);
  });

  it('the friendly smile keeps the brows up and the jaw nearly shut; the evil grin\'s upper lid comes down, the smile\'s does not', () => {
    expect(smile.morphs.browDown).toBeLessThanOrEqual(0);
    expect(smile.jawGape).toBeLessThan(0.06);
    expect(grin.sheet.eyeLidTop).toBeGreaterThan(0);
    expect(smile.sheet.eyeLidTop).toBe(0);
  });

  it('surprise is the opposite: the jaw drops, the brows go up, the eyes open WIDER than neutral, no smile, no squint', () => {
    expect(surprise.jawGape).toBeGreaterThan(0.25);
    expect(surprise.morphs.squint).toBe(0);
    expect(surprise.morphs.smile).toBe(0);
    expect(surprise.sheet.browDrop).toBeLessThan(0);
    expect(lit(surprise.sheet)).toBeGreaterThan(lit(authored));
    expect(surprise.jawGape).toBeGreaterThan(grin.jawGape * 2);
    // Task 18: and the head stretches (narrower, taller) where the grin squashes it.
    expect(surprise.morphs.squash).toBeLessThan(0);
  });
});

describe('the motion path takes an expression gape', () => {
  const doc = parseBlob(goblinSrc);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  const run = (jawGape: number | undefined, morphs?: (i: number) => MorphWeights | undefined) => {
    const m = makeActorMotion(body, { seed: 3 });
    const rng = makeRng(3);
    let f = null as ReturnType<typeof stepActorMotion>;
    for (let i = 0; i < 30; i++) {
      const w = morphs?.(i);
      f = stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: false, armStyle: undefined, headingFollow: 0, gazeFollow: 0,
        bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, rng, signals: emptyActorSignals(),
        profile: motionProfileFor('goblin-cinematic'), forceSpeed: 0,
        ...(jawGape === undefined ? {} : { jawGape }),
        ...(w ? { morphs: w } : {}),
      });
    }
    return { f: f!, m };
  };

  // Task 12: the morph weights ride the actor path straight onto the rig applyRig reads (motion never needs them).
  it('writes the morph weights onto the rig each frame, and drops them when the caller stops', () => {
    const grin = actuate(expressionAt(GOBLIN_EXPRESSIONS.grin!, 99), authored, GOBLIN_EXPRESSION_TUNING).morphs;
    expect(run(undefined, () => grin).m.bound.rig.morphs).toEqual(grin);
    expect(run(undefined, i => (i < 29 ? grin : undefined)).m.bound.rig.morphs).toBeUndefined();
    expect('morphs' in run(undefined).m.bound.rig).toBe(false);
  });

  it('reaches MotionFrame.jawGape and the rig, and no input leaves it 0', () => {
    const open = run(0.3);
    expect(open.f.jawGape).toBeCloseTo(0.3, 9);
    expect(open.m.bound.rig.jawGape).toBeCloseTo(0.3, 9);
    expect(run(undefined).f.jawGape).toBe(0);
  });

  // The goblin's jaw lever hangs nearly straight down from the hinge, so opening swings the chin point mostly BACK toward
  // the throat (~7 cm at 0.5) and only a few mm down in world y: measure both, not a 1 cm drop.
  it('pins the jaw point lower than, and well away from, the shut jaw', () => {
    const shut = run(undefined), open = run(0.5);
    const J = shut.m.motionJoints!.index.jaw!;
    const a = open.m.bound.rig.points[J]!.pos, b = shut.m.bound.rig.points[J]!.pos;
    expect(a[1]).toBeLessThan(b[1] - 0.002);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(0.03);
  });
});
