// src/lab/sdf-zombie/characters/bonewalker-blob.test.ts
//
// The bonewalker is the FIRST character authored with `blob:rings` as the
// primary instrument, so this file pins the numbers the whole trial rests
// on. Every threshold below is a number taken off
// docs/dev-notes/refs/bonewalker-mesh/bonewalker.glb (Meshy bind T-pose,
// 1.700 m, authored at 1.30 m — scale 0.7647) via the rig dump + per-bone
// rho profiles of 2026-08-27, or off blob:rings rounds 1-3. What this file
// CANNOT check is whether it reads as the horned skeletal undead of the
// renders — that needed the turntable and an eye.
//
// THE SKELETON IS THE PIN THAT MATTERS MOST. The brief's measured len=
// table (taken off the reference's own rig) is what lets blob:rings report
// clean radius findings instead of drowning every block in "BONE LENGTH IS
// OFF BY -44.8%" like the mouse and schoolgirl fits. If a future edit
// drifts a bone length, these pins fail before the fit degrades.
import { describe, it, expect } from 'vitest';
import src from './bonewalker.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance } from '../blob-checks';
import { sdBody } from '../validate';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));

/** Bone length in metres, resolved. */
const boneLen = (b: ReturnType<typeof built>, name: string) => {
  const bone = b.bones.get(name)!;
  return Math.hypot(bone.tail[0] - bone.head[0], bone.tail[1] - bone.head[1], bone.tail[2] - bone.head[2]);
};

/** Width of the TORSO along x at height y — first exit from the centreline,
 *  so a hanging arm further out does not count (the claws reach x ~0.17). */
const halfWidthAt = (b: ReturnType<typeof built>, y: number) => {
  let w = 0, prev = false;
  for (let x = 0; x <= 0.3; x += 0.001) {
    const inside = sdBody([x, y, 0], b) < 0;
    if (inside) w = x;
    if (!inside && prev && w > 0) break; // first exit = the torso's own edge
    prev = inside;
  }
  return w;
};
/** Front/back extent along z at height y on the centreline. */
const zExtentAt = (b: ReturnType<typeof built>, y: number) => {
  let front = NaN, back = NaN;
  for (let z = -0.3; z <= 0.3; z += 0.001) if (sdBody([0, y, z], b) < 0) { if (Number.isNaN(back)) back = z; front = z; }
  return { front, back };
};

describe('bonewalker.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, so
  // a face/sheet/palette key typo is invisible unless each block is
  // compiled explicitly — same trap the mouse's test records.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('folds the way it declared (stance humanoid)', () => {
    expect(checkStance(built().bones, doc.stance)).toEqual([]);
  });

  // =====================================================================
  // THE MEASURED SKELETON — every len= is the reference rig's own
  // joint-to-joint distance x 0.7647 (5% tolerance: the .l/.r pairs
  // themselves differ by up to 5.2%, e.g. upperarm 0.257 vs 0.244).
  // =====================================================================
  it('keeps the measured bone lengths (drift here degrades every blob:rings fit)', () => {
    const b = built();
    expect(boneLen(b, 'pelvis')).toBeCloseTo(0.092, 2);
    expect(boneLen(b, 'spine1')).toBeCloseTo(0.092, 2);
    expect(boneLen(b, 'chest')).toBeCloseTo(0.092, 2);
    expect(boneLen(b, 'spine2')).toBeCloseTo(0.050, 2);
    expect(boneLen(b, 'neck')).toBeCloseTo(0.068, 2);
    expect(boneLen(b, 'clavicle.l')).toBeCloseTo(0.111, 2);
    expect(boneLen(b, 'upperarm.l')).toBeCloseTo(0.257, 2);
    expect(boneLen(b, 'forearm.l')).toBeCloseTo(0.213, 2);
    expect(boneLen(b, 'thigh.l')).toBeCloseTo(0.289, 2);
    expect(boneLen(b, 'shin.l')).toBeCloseTo(0.329, 2);
    expect(boneLen(b, 'foot.l')).toBeCloseTo(0.126, 2);
  });

  // LANKY IS THE DESIGN: legs (thigh+shin) are 47.6% of standing height
  // and the arm span (upperarm+forearm) 36% — both measured, both lankier
  // than any human proportion. Do not "fix" toward human.
  it('is lanky the way the reference is lanky', () => {
    const b = built();
    const legs = boneLen(b, 'thigh.l') + boneLen(b, 'shin.l');
    expect(legs / 1.30).toBeGreaterThan(0.45); // measured 0.476
    const arms = boneLen(b, 'upperarm.l') + boneLen(b, 'forearm.l');
    expect(arms / 1.30).toBeGreaterThan(0.34); // measured 0.362
    expect(arms / 1.30).toBeLessThan(0.40);
  });

  // The surface crotch at 0.646 (49.7% of the mesh) puts the hip line at
  // 0.738 and straight measured legs land the ankle at ~0.129 — the
  // mesh's own foot band is y 0.117-0.131. The feet MUST reach the floor.
  it('stands on the floor with ankles in the mesh foot band', () => {
    const b = built();
    const shin = b.bones.get('shin.l')!;
    expect(shin.tail[1]).toBeGreaterThan(0.107); // mesh band low edge
    expect(shin.tail[1]).toBeLessThan(0.151);    // mesh band high edge
    // Floor contact: flesh within 12mm of y=0 somewhere under a paw.
    const paw = b.bones.get('foot.l')!;
    let touches = false;
    for (let z = -0.05; z <= 0.20; z += 0.01)
      for (let x = 0.05; x <= 0.30; x += 0.01)
        if (sdBody([x, 0.010, z], b) < 0 && Math.hypot(x - paw.head[0], z - paw.head[2]) < 0.20) touches = true;
    expect(touches).toBe(true);
  });

  // Surface bands measured off the Hips/Spine02/Spine01 vertex clouds
  // (world halfW): hip bowl ~0.090 at y 0.675 (plus blade-like wings to
  // 0.119), the wasp waist 0.033-0.040 at y 0.825, the ribcage 0.109
  // halfW and DEEPER than wide (halfD 0.121) at y 0.95. The waist is
  // pinned as a RELATION (a real pinch, <=0.065 and <2/3 of the ribs):
  // capsule caps cannot flare as fast as the mesh's 33->94mm across
  // 0.825-0.875, so the absolute 33mm is out of reach for this
  // construction — the pin caught the cap filling the waist at 0.080 and
  // now guards the flare stays lifted clear of the pinch.
  it('pinches at the waist and carries a ribcage deeper than wide', () => {
    const b = built();
    let waist = 1;
    for (let y = 0.80; y <= 0.84; y += 0.005) waist = Math.min(waist, halfWidthAt(b, y));
    expect(waist).toBeLessThan(0.065);
    // At 0.65 the x-probe reads bowl + wings + splayed thigh tops in one
    // merged field — so does the mesh's own silhouette there (140mm outer
    // edge from its thigh-claimed verts; the pelvis-cloud-only 75mm is not
    // probeable once the field merges). Ours sits just under the mesh.
    const hipBand = halfWidthAt(b, 0.65);
    expect(hipBand).toBeGreaterThan(0.09);
    expect(hipBand).toBeLessThan(0.155);
    expect(waist).toBeLessThan(hipBand * 0.65); // the pinch is real, not a straight column
    // RIBCAGE depth on the centreline (arm-free; an x-probe at y 0.95
    // merges the hanging arms into the reading). Mesh: front +0.110,
    // back -0.121 -> 0.231 full depth, deeper than its 0.218 full width.
    const { front, back } = zExtentAt(b, 0.95);
    expect(front - back).toBeGreaterThan(0.20);
    expect(front - back).toBeLessThan(0.27);
  });

  // The exposed spine is the character's signature and it is PAINT: three
  // bone-coloured bars down the back (dbc0a0 -> linear ~(0.69,0.53,0.37)),
  // each offset BEHIND the torso's back plane. Regression: v1's offsets
  // (-0.058/-0.062) left the ridge buried and invisible from behind.
  it('paints an exposed spine ridge proud of the back', () => {
    const b = built();
    const torso = b.clusters.find(c => c.limb === 'torso')!;
    const bonePainted = b.prims.slice(torso.start, torso.start + torso.count)
      .filter(p => p.color && p.color[0] > 0.55 && p.color[1] > 0.40 && p.color[2] > 0.25 && p.color[0] > p.color[2]);
    expect(bonePainted.length).toBeGreaterThanOrEqual(3); // pelvis + spine1 + chest ridge bars
    const { back: backAtWaist } = zExtentAt(b, 0.85);
    expect(backAtWaist).toBeLessThan(-0.095); // proud: the mesh's own back is -0.087 there
  });

  // Claws are pale bone paint: four fingers per hand + three toe claws
  // per paw, all tapering to points (r2 -> near-zero), all colour-keyed.
  it('ends its hands and feet in pale claw paint', () => {
    const b = built();
    const claws = b.prims.filter(p =>
      p.color && p.color[0] > 0.55 && p.color[1] > 0.40 && p.color[2] > 0.25
      && p.radiusB !== undefined && p.radiusB < 0.006);
    // 4 fingers x 2 hands + 3 toes x 2 paws = 14; horns are bars with r2
    // 0.007 — just above the point threshold — so they stay out.
    expect(claws.length).toBe(14);
  });

  // Rusted meat over bone dust: base is dark red-brown (red >> green >
  // blue); the mottle differs in HUE (grey-gold vs red), not just value —
  // the "bone showing through" read. The first palette (amp 0.60, pale
  // tan mottle) rendered as desert camouflage and was walked back.
  it('wears rusted red flesh with a bone-dust mottle', () => {
    const m = compilePalette(doc)!;
    const [r, g, bl] = m.baseColor;
    expect(r).toBeGreaterThan(0.10);
    expect(r).toBeGreaterThan(g * 2.2); // red-dominant dark rust
    expect(g).toBeGreaterThan(bl);
    expect(m.mottleAmp).toBeGreaterThan(0.25);
    expect(m.mottleAmp).toBeLessThan(0.50); // 0.60 read as desert camo
    // Hue gap, saturation-style: the mottle is FAR less red-saturated than
    // the base (measured texels: rust mode 84,40,26 is ~2x the red excess
    // of the brightest bone 175,140,119 relative to luminance).
    const baseSat = (r - bl) / (r + bl);
    const mottleSat = (m.mottleColor[0] - m.mottleColor[2]) / (m.mottleColor[0] + m.mottleColor[2]);
    expect(mottleSat).toBeLessThan(baseSat * 0.6);
  });

  // The face is a DECAL off the mesh's own head (skill rule: agents cannot
  // paint faces). The bake includes the horns, so the projection is AIMED
  // (eyes + chin rows) rather than proportional — see the .blob sheet note.
  it('wears the baked face decal', () => {
    const sheet = compileSheet(doc)!;
    expect(sheet.decal).toBe(1);
    expect(doc.sheetImage).toBe('bonewalker-face.png');
  });
});
