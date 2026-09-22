// src/lab/sdf-zombie/characters/ogre-blob.test.ts
//
// Pins the ogre's DESIGN INTENT. There is no reference mesh or plate — the
// brief was prose ("a big brutish hunk of primordial flesh hunched over lugging
// a big chainsaw") — so, as cyberdemon-blob.test.ts says of its own file, these
// are STRUCTURAL PINS, not mesh-derived thresholds. Each one names a decision
// from the .blob header and fails if it is quietly undone:
//
//   * the HUNCH: the yoke and head hang well ahead of the hips;
//   * the YOKE: the shoulder mass is wider than the pelvis, and the head is
//     small against it;
//   * the arms and legs read as limbs (daylight), and still fuse (one body);
//   * the face is prims (tusks, emissive eyes) on a nubbed face block, with a
//     generated mouth-only decal;
//   * the chainsaw carry puts BOTH hands on the saw while he walks.
//
// What this file CANNOT check is whether he reads as an ogre. That took the
// turntable frames (docs/dev-notes/2026-09-22-ogre/).
import { describe, it, expect } from 'vitest';
import src from './ogre.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf, strandedOf } from '../blob-checks';
import { characterEntry } from '../character-registry';
import { OGRE_PROFILE } from '../motion-profile';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import { GUN_GRIP, gunPoint } from '../carry';

/** Shipped asset URLs, via import.meta.glob rather than node:fs — the tsconfig
 *  carries only vite/client, so node:fs breaks `npm run build`
 *  (character-registry.test.ts records the same choice). */
const SHIPPED: ReadonlySet<string> = new Set(
  Object.keys(import.meta.glob('../../../../public/assets/lab/**/*.{png,glb,gltf}'))
    .map(p => p.slice(p.indexOf('/public/') + '/public'.length)),
);
const shipped = (url: string) => SHIPPED.has(url);

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;
const HEIGHT = 2.20;
/** 2% of standing height — the separation the authoring skill calls visible
 *  from every yaw rather than only on the shadowed side. */
const DAYLIGHT = 0.02 * HEIGHT;

/** World-space extents of a cluster's SOLID prims, honouring per-axis scale. */
function clusterBounds(b: ReturnType<typeof built>, l: string) {
  const c = limb(b, l);
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const p of b.prims.slice(c.start, c.start + c.count)) {
    if (p.op === 'sub') continue;
    for (const e of [p.a, p.b]) {
      for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i]!, e[i]! - p.radius * p.scale[i]!);
        mx[i] = Math.max(mx[i]!, e[i]! + p.radius * p.scale[i]!);
      }
    }
  }
  return { mn, mx };
}

describe('ogre.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, so a
  // key typo is invisible unless each block is compiled explicitly.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('declares humanoid and folds the knees forward', () => {
    expect(doc.stance).toBe('humanoid');
    expect(checkStance(built().bones, doc.stance)).toEqual([]);
  });

  it('is a 2.20 m brute whose crown reaches the declared height and whose boots stand on the floor', () => {
    expect(doc.height).toBe(HEIGHT);
    const b = built();
    const head = clusterBounds(b, 'head');
    expect(head.mx[1]).toBeGreaterThan(HEIGHT - 0.03);
    expect(head.mx[1]).toBeLessThan(HEIGHT + 0.03);
    for (const side of ['legL', 'legR'] as const) {
      const foot = clusterBounds(b, side);
      expect(foot.mn[1]).toBeGreaterThan(-0.02);
      expect(foot.mn[1]).toBeLessThan(0.03);
    }
  });

  // BEAT 1 — THE HUNCH. The rig's world-direction pitches put the base of the
  // neck ~0.29 m and the face ~0.5 m ahead of the hips. If someone
  // "straightens him up", this fails.
  it('hunches: the yoke and head hang well ahead of the hips', () => {
    const b = built();
    const hips = b.bones.get('pelvis')!.tail;
    const yoke = b.bones.get('chest')!.tail;
    expect(yoke[2] - hips[2]).toBeGreaterThan(0.25);
    expect(clusterBounds(b, 'head').mx[2]! - hips[2]).toBeGreaterThan(0.45);
  });

  // BEAT 2 — THE YOKE, and the small head set into it.
  it('carries a shoulder yoke wider than the pelvis, with a small head against it', () => {
    const b = built();
    const torso = limb(b, 'torso');
    const prims = b.prims.slice(torso.start, torso.start + torso.count);
    const half = (p: typeof prims[number]) => Math.max(Math.abs(p.a[0]), Math.abs(p.b[0])) + p.radius * p.scale[0]!;
    const pelvisY = b.bones.get('pelvis')!.tail[1];
    const low = Math.max(...prims.filter(p => p.a[1] < pelvisY + 0.05).map(half));
    const high = Math.max(...prims.filter(p => p.a[1] > 1.65).map(half));
    expect(high).toBeGreaterThan(low);
    const head = clusterBounds(b, 'head');
    const armL = clusterBounds(b, 'armL');
    const armR = clusterBounds(b, 'armR');
    // Shoulder-to-shoulder span against the head's width: a brute's ratio.
    expect((head.mx[0]! - head.mn[0]!) / (armL.mx[0]! - armR.mn[0]!)).toBeLessThan(0.35);
  });

  // THE GOBLIN REGRESSION. The join radius covers the shoulder ball, the
  // upper arm and the elbow (0.50 m from the shoulder): the ogre's elbows
  // legitimately brush his flanks — he is that wide — so what is pinned is the
  // FOREARM and fist hanging free, which is what reads as an arm.
  it.each(['armL', 'armR'] as const)('%s forearm and fist hang free of the torso', arm => {
    const b = built();
    const shoulder = b.bones.get(arm === 'armL' ? 'clavicle.l' : 'clavicle.r')!.tail;
    expect(daylightOf(b, limb(b, arm), limb(b, 'torso'), shoulder, 0.50)).toBeGreaterThan(DAYLIGHT);
  });

  it.each(['legL', 'legR'] as const)('%s hangs free of the torso below the knee', leg => {
    const b = built();
    const hip = b.bones.get('pelvis')!.tail;
    expect(daylightOf(b, limb(b, leg), limb(b, 'torso'), hip, 0.45)).toBeGreaterThan(DAYLIGHT);
  });

  it('is still one body: arms, legs and head fuse to the torso', () => {
    const b = built();
    for (const l of ['armL', 'armR', 'legL', 'legR', 'head'] as const)
      expect(fusedOf(b, limb(b, l), limb(b, 'torso')), l).toBeLessThan(0);
  });

  it('keeps the legs clear of each other and nothing stranded in a cluster', () => {
    const b = built();
    expect(clearOf(b, limb(b, 'legL'), limb(b, 'legR'))).toBeGreaterThan(0.010);
    for (const c of b.clusters) {
      const gap = strandedOf(b, c);
      if (gap !== null) expect(gap, `${c.limb} has a stranded prim`).toBeLessThan(0.005);
    }
  });

  // THE FACE — prims, not a painted face: two pointed ivory tusks and two
  // dimly glowing eyes. The glow is deliberately LOW (an ogre is not a demon).
  it('has two ivory tusks and two dim emissive eyes', () => {
    const b = built();
    const head = limb(b, 'head');
    const prims = b.prims.slice(head.start, head.start + head.count);
    const eyes = prims.filter(p => (p.glow ?? 0) > 0);
    expect(eyes).toHaveLength(2);
    for (const e of eyes) expect(e.glow!).toBeLessThan(0.5);
    const tusks = prims.filter(p => p.color !== undefined && (p.glow ?? 0) === 0);
    expect(tusks).toHaveLength(2);
    for (const t of tusks) {
      // Pointing UP out of the underbite.
      expect(t.b[1]).toBeGreaterThan(t.a[1] + 0.03);
      const [r, g, bl] = t.color!;
      expect(r).toBeGreaterThan(bl); // ivory, not bone-white
      expect(g).toBeGreaterThan(bl);
    }
  });

  it('authors the head as prims on a nubbed face block, framed by the cranium', () => {
    const face = compileFace(doc);
    expect(face.headRadius).toBeLessThan(0.002);
    const b = built();
    const head = limb(b, 'head');
    const unpainted = b.prims.slice(head.start, head.start + head.count)
      .filter(p => p.op !== 'sub' && p.color === undefined && p.radius > 0.01);
    let best = unpainted[0]!;
    for (const p of unpainted)
      if (p.radius * Math.max(...p.scale) > best.radius * Math.max(...best.scale)) best = p;
    // The decal's hs frame is the cranium: the only head prim with a
    // semi-height over 0.14 (the bullet head).
    expect(best.radius * best.scale[1]!).toBeGreaterThan(0.14);
  });

  it('wears a generated mouth-only decal with the sheet glow gated off', () => {
    const sheet = compileSheet(doc)!;
    expect(doc.sheetImage).toBe('ogre-face.png');
    expect(shipped('/assets/lab/faces/ogre-face.png')).toBe(true);
    expect(sheet.decal).toBe(0);
    expect(sheet.eyeGlowCut).toBe(0.99);
    expect(sheet.eyeGlowAmp).toBe(0);
  });

  it('wears its own sickly tan palette with bruise mottle', () => {
    const m = compilePalette(doc)!;
    const [r, g, b] = m.baseColor;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(m.mottleAmp).toBeGreaterThan(0.2);
    expect(m.deepColor[0]).toBeGreaterThan(m.deepColor[1]); // wounds stay red
  });

  it('is registered with its kit, face decal and chainsaw profile', () => {
    const entry = characterEntry('ogre');
    expect(entry.src).toBe(src);
    expect(entry.kit).toBe('/assets/lab/ogre-kit.gltf');
    expect(entry.face.url).toBe('/assets/lab/faces/ogre-face.png');
    expect(entry.profile).toBe(OGRE_PROFILE);
    expect(entry.profile.prop?.url).toBe('/assets/lab/ogre-chainsaw.glb');
    expect(shipped('/assets/lab/ogre-chainsaw.glb')).toBe(true);
    expect(shipped('/assets/lab/ogre-kit.gltf')).toBe(true);
  });
});

// THE SAW CARRY, through the real motion pipeline: the right hand holds the
// saw's grip and the left hand is FABRIK'd onto its front hoop. This is the
// check that the `saw` carry's angles (carry.ts) are REACHABLE on this rig —
// the soldier's `low` was not (it lifted the saw to his face), and at prop
// scale 1.6 the hoop was out of the left arm's reach.
describe('ogre chainsaw carry', () => {
  it('keeps both fists on the saw at belly height while he walks', () => {
    const body = built();
    const m = makeActorMotion(body, { seed: 7 });
    const rng = makeRng(7);
    const J = m.motionJoints!.index;
    let worstFore = 0, worstGrip = 0, sumGrip = 0, sumFore = 0, n = 0;
    let gripLow = Infinity, gripHigh = -Infinity;
    for (let i = 0; i < 240; i++) {
      const f = stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile: OGRE_PROFILE, forceSpeed: OGRE_PROFILE.cruise,
      })!;
      expect(f.carry).toBe('saw');
      if (i < 60) continue; // let the verlet settle into the carry
      const pts = m.bound.rig.points;
      const grip = gunPoint(f.gun!, GUN_GRIP.gripHand);
      const fore = gunPoint(f.gun!, GUN_GRIP.foreHand);
      const dist = (a: readonly number[], b: readonly number[]) =>
        Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
      const g = dist(pts[J.handR!]!.pos, grip), fo = dist(pts[J.handL!]!.pos, fore);
      worstGrip = Math.max(worstGrip, g); worstFore = Math.max(worstFore, fo);
      sumGrip += g; sumFore += fo; n++;
      gripLow = Math.min(gripLow, grip[1]);
      gripHigh = Math.max(gripHigh, grip[1]);
    }
    // The hands are verlet points chasing the carry's targets, so they lag in
    // transients (turns, footfalls). The SOLDIER'S own numbers through this
    // same loop are the baseline: mean grip 7 mm, worst 46 mm / 48 mm (fore);
    // the ogre measured mean 10 mm, worst 55 / 60 mm on 2026-09-22. The mean
    // is the real pin — a carry the left arm cannot reach reads ~0.1 m+ on
    // average, not in a spike.
    expect(sumGrip / n).toBeLessThan(0.02);
    expect(sumFore / n).toBeLessThan(0.02);
    expect(worstGrip).toBeLessThan(0.08);
    expect(worstFore).toBeLessThan(0.08);
    // Belly height, not the face (the soldier's `low` put it at ~1.8 m).
    expect(gripLow).toBeGreaterThan(1.1);
    expect(gripHigh).toBeLessThan(1.55);
  });
});
