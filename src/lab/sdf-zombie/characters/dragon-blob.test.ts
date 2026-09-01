// src/lab/sdf-zombie/characters/dragon-blob.test.ts
//
// Pins for the first NON-HUMANOID .blob character. Every threshold is a
// number measured off docs/dev-notes/refs/dragon-mesh/dragon.glb by this
// author (2026-08-31): rig joint distances and per-joint vertex clouds from
// scripts/dragon-probe.ts (a jointWorld dump + per-joint cloud extents),
// authored at 1.2 x the 1.70 m mesh (2.04 m). The pins below encode the
// things that make this character a DRAGON -- wingspan vs body length, the
// digitigrade hock, the tail's reach, the head's height -- because those are
// the features blob:rings is blind to (its rig table maps NONE of the head,
// wing-tip, or tail surface; coverage is 25% by construction).
import { describe, it, expect } from 'vitest';
import src from './dragon.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf } from '../blob-checks';
import { sdBody } from '../validate';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;

describe('dragon.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  it('has no typo in its face or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  // THE STANCE FIGHT, recorded (see the .blob header for the full story).
  // The rig's own knee sits FORWARD of the hip->hock line (z 0.0835 vs line
  // 0.0527 ref): checkStance classifies that as 'humanoid', but the mesh is a
  // bird-style digitigrade leg (knee forward, hock back, LONG METATARSUS).
  // The authored knee is pulled back to pass the check; these pins hold the
  // ACTUAL digitigrade anatomy that the classifier cannot see: the metatarsus
  // (shin.tail -> foot.tail) must be much longer than the tibia (thigh.tail ->
  // shin.tail), and the toes must reach the floor.
  it('folds the way it declared (and the declaration is digitigrade)', () => {
    expect(doc.stance).toBe('digitigrade');
    expect(checkStance(built().bones, doc.stance)).toEqual([]);
  });

  it('has a bird-style leg: metatarsus ~2.4x the tibia, toes on the floor (measured)', () => {
    const b = built();
    const tibia = Math.hypot(
      b.bones.get("shin.l")!.tail[0]! - b.bones.get("thigh.l")!.tail[0]!,
      b.bones.get("shin.l")!.tail[1]! - b.bones.get("thigh.l")!.tail[1]!,
      b.bones.get("shin.l")!.tail[2]! - b.bones.get("thigh.l")!.tail[2]!);
    const metatarsus = Math.hypot(
      b.bones.get("foot.l")!.tail[0]! - b.bones.get("shin.l")!.tail[0]!,
      b.bones.get("foot.l")!.tail[1]! - b.bones.get("shin.l")!.tail[1]!,
      b.bones.get("foot.l")!.tail[2]! - b.bones.get("shin.l")!.tail[2]!);
    // rig: foot 0.2306 vs shin 0.0940 (authored lengths) -- do NOT 'fix'
    // toward human proportions; the long segment is the metatarsus.
    expect(metatarsus / tibia).toBeGreaterThan(2.0);
    expect(metatarsus / tibia).toBeLessThan(2.8);
    // the toe joint hangs above the floor (y 0.0965 ref x 1.2 = 0.116) and
    // the toe-pad prim under it reaches it (sole within 15 mm of y 0)
    const toeY = b.bones.get('foot.l')!.tail[1];
    expect(toeY).toBeGreaterThan(0.08);
    expect(toeY).toBeLessThan(0.15);
    let sole = 1;
    for (let z = 0.10; z <= 0.45; z += 0.01)
      for (let x = 0.12; x <= 0.40; x += 0.01)
        for (let y = 0.05; y >= -0.05; y -= 0.002)
          if (sdBody([x, y, z], b) < 0) sole = Math.min(sole, y); // LOWEST solid: the pad bottom
    expect(sole).toBeLessThan(0.015); // weight on the toes, heel off the ground
  });

  // THE HOCK: the reference's sharp backward ankle bend. In body space the
  // hock (shin tail) sits BEHIND the hip->hock chord by construction here;
  // pin the measured hock height instead: rig y 0.1852 x 1.2 = 0.222, i.e.
  // the ankle is held well above the floor (digitigrade, not plantigrade).
  it('holds the hock off the ground at the rig height (0.222)', () => {
    const b = built();
    const hockY = b.bones.get('shin.l')!.tail[1];
    expect(hockY).toBeGreaterThan(0.19);
    expect(hockY).toBeLessThan(0.25);
  });

  // WINGSPAN vs BODY LENGTH -- the dragon's defining proportion, invisible to
  // blob:rings (wing-tip verts ride unmapped joints 016/017/021/022). Mesh:
  // wingspan x -0.473..0.472 (0.945 ref = 1.134 authored); nose-to-tail
  // z -0.555..0.714 (1.269 ref = 1.523 minus the 0.043 frame shift = 1.479
  // body-space). The mesh's own ratio: 1.134 / 1.523 = 0.745. The .blob must
  // land within 10% of that with the membrane fans included.
  it('has the mesh wingspan-to-body-length ratio (0.75 +/- 10%)', () => {
    const b = built();
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const p of b.prims) {
      for (const [px, , pz] of [p.a, p.b] as const) {
        // reach of a tapered prim about its endpoints (the fatter end radius)
        xMin = Math.min(xMin, px - p.radius); xMax = Math.max(xMax, px + p.radius);
        zMin = Math.min(zMin, pz - p.radius); zMax = Math.max(zMax, pz + p.radius);
      }
    }
    const span = xMax - xMin;
    const length = zMax - zMin;
    expect(span / length).toBeGreaterThan(0.67);
    expect(span / length).toBeLessThan(0.82);
  });

  // The wing membranes must hang CLEAR of the flank (the goblin lesson: a
  // limb reads as a limb when there is visible air). Measured off the mesh
  // point cloud: the membrane's inner edge sits ~0.085 ref (0.10 authored)
  // outside the torso wall. daylightOf with the join at the wing root says
  // how much air the free panel has; the ARM fuses at the root by design, so
  // clearOf alone would be the wrong instrument here (it reads the join).
  it('hangs the wing membranes with daylight off the flank', () => {
    const b = built();
    const root = b.bones.get('clavicle.l')!.head;
    const day = daylightOf(b, limb(b, 'armL'), limb(b, 'torso'), root, 0.30);
    expect(day).toBeGreaterThan(-0.02); // surfaces may kiss at the root zone only
  });

  it('keeps the hind legs clear of each other (wide digitigrade stance)', () => {
    const b = built();
    expect(clearOf(b, limb(b, 'legL'), limb(b, 'legR'))).toBeGreaterThan(0);
  });

  // TAIL REACH -- no rig joints exist for ANY tail vert (all 1306 ride
  // Bone_001), so blob:rings cannot see it; pin the measured centreline.
  // Tail tip centroid (z -0.60 bin, x -0.31 y 0.535 ref, frame-shifted):
  // the tail must reach BEHIND the heels and the tip must sit HIGH (the
  // up-left curl: tip y ABOVE the tail base y).
  it('reaches the measured tail tip: behind the body, curled up', () => {
    const b = built();
    let zMin = Infinity, xAtMin = 0, yAtMin = 0;
    for (const p of b.prims) {
      if (p.limb !== 'torso') continue;
      for (const [px, py, pz] of [p.a, p.b] as const) {
        if (pz < zMin) { zMin = pz; xAtMin = px; yAtMin = py; }
      }
    }
    expect(zMin).toBeLessThan(-0.60);            // rig tail sweeps to z -0.71 shifted
    expect(zMin).toBeGreaterThan(-0.85);
    expect(xAtMin).toBeLessThan(-0.20);          // the curl goes LEFT (-x) as the mesh does
    expect(yAtMin).toBeGreaterThan(0.45);        // the tip flicks UP (base y ~0.46)
  });

  // HEAD HEIGHT -- the head+horn cloud (24% of the mesh) is unmapped; pin the
  // measured verticals: crown joint Bone_026 y 1.392 ref x 1.2 = 1.671 (the
  // skull bone's tail), horn tips to 1.70 ref x 1.2 = 2.04, snout tip z 0.71
  // ref -> 0.809 shifted (the dragon's long muzzle is its profile signature).
  it('carries the measured head verticals: skull joint 1.671, horns to 2.04', () => {
    const b = built();
    const skullTail = b.bones.get('skull')!.tail[1];
    expect(skullTail).toBeGreaterThan(1.64);
    expect(skullTail).toBeLessThan(1.70);
    let top = 0;
    for (let y = 1.9; y <= 2.1; y += 0.005)
      for (let x = -0.1; x <= 0.1; x += 0.01)
        for (let z = 0.1; z <= 0.4; z += 0.01)
          if (sdBody([x, y, z], b) < 0) top = Math.max(top, y);
    expect(top).toBeGreaterThan(1.95);   // horn crest
    expect(top).toBeLessThan(2.10);
  });

  it('projects a long snout: muzzle tip past z 0.70 (mesh 0.809 shifted)', () => {
    const b = built();
    let zMax = -Infinity;
    for (const p of b.prims) {
      if (p.limb !== 'head') continue;
      zMax = Math.max(zMax, p.b[2] + (p.radiusB ?? p.radius));
    }
    expect(zMax).toBeGreaterThan(0.70);
    expect(zMax).toBeLessThan(0.90);
  });

  // MEASURED BONES -- the rings precondition (zero BONE LENGTH IS OFF blocks
  // at scale 1.2). clavicle is +8.5% DELIBERATELY (grammar attaches it 17 mm
  // high; the extra length lands the elbow/wrist/tip at rig positions) and
  // foot.r -5.3% is the rig's own L/R asymmetry; both are pinned at their
  // authored values, everything else within 2% of ref x 1.2.
  it('carries the reference bone lengths at 1.2x (within 2%; clavicle +8.5% by design)', () => {
    const measured: Record<string, number> = {
      pelvis: 0.2704, spine1: 0.1312, chest: 0.1391, spine2: 0.1554,
      neck: 0.2327, clavicle: 0.1572, upperarm: 0.1581, forearm: 0.2346,
      thigh: 0.1710, shin: 0.0947, foot: 0.2306,
    };
    const authored: Record<string, number> = { clavicle: 0.1705 };
    const bones = built().bones;
    const len3 = (bn: { readonly head: readonly number[]; readonly tail: readonly number[] }) =>
      Math.hypot(bn.tail[0]! - bn.head[0]!, bn.tail[1]! - bn.head[1]!, bn.tail[2]! - bn.head[2]!);
    const central = new Set(['pelvis', 'spine1', 'chest', 'spine2', 'neck']);
    for (const [name, refLen] of Object.entries(measured)) {
      const key = central.has(name) ? name : `${name}.l`;
      const bone = bones.get(key)!;
      const blen = len3(bone);
      const want = authored[name] ?? refLen;
      const tol = authored[name] !== undefined ? 0.005 : refLen * 0.02;
      expect(Math.abs(blen - want)).toBeLessThan(tol);
    }
  });

  // PALETTE: dark bronze-olive hide with a lighter tan belly wash and DARK
  // membranes (texture-classified: whole-texture mean sRGB (44,33,30); belly
  // slightly lighter; membrane distinctly darker than the hide).
  it('paints the measured scheme: dark olive hide, tan belly wash, darker membranes', () => {
    const b = built();
    const lin = (hex: number) => {
      const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => v / 255);
      return c.map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    };
    const belly = lin(0x7c7a54), membrane = lin(0x2e3d22);
    const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const bellies = b.prims.filter(p => p.limb === 'torso' && p.color &&
      Math.abs(p.color[0]! - belly[0]!) < 0.01 && Math.abs(p.color[1]! - belly[1]!) < 0.01);
    expect(bellies.length).toBeGreaterThanOrEqual(2); // haunch + belly bars
    const membranes = b.prims.filter(p => p.limb !== undefined && p.color &&
      Math.abs(p.color[0]! - membrane[0]!) < 0.01 && Math.abs(p.color[1]! - membrane[1]!) < 0.01);
    expect(membranes.length).toBeGreaterThanOrEqual(6); // 3 lobes per wing x 2
    const fingers = b.prims.filter(p => p.color &&
      Math.abs(p.color[0] - lin(0x6b8148)[0]!) < 0.01 && Math.abs(p.color[1] - lin(0x6b8148)[1]!) < 0.01);
    expect(fingers.length).toBeGreaterThanOrEqual(4);   // 2 spars per wing x 2
    expect(luma(membrane)).toBeLessThan(luma(belly));   // membranes darker than belly
  });
});
