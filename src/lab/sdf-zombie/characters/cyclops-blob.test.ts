// src/lab/sdf-zombie/characters/cyclops-blob.test.ts
//
// The cyclops has no TypeScript twin to diff against, so — like the mouse —
// this pins its own MEASURED properties: every threshold below is a number
// taken off docs/dev-notes/refs/cyclops-mesh/cyclops.glb (the static
// reference mesh, height 1.0 in its own units, scaled here by the declared
// height 1.35 m), not a round figure picked for looks. See
// mouse-blob.test.ts for the pattern's origin.
//
// What this file CANNOT check is whether the cyclops reads as the reference
// brute. That needs the turntable and an eye (see the authoring skill); the
// 2026-08-22 pass confirmed one pale eye, a five-fang maw, clawed arms and
// the hooked tail on frames 00/02.
import { describe, it, expect } from 'vitest';
import src from './cyclops.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));

describe('cyclops.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, so a
  // face/sheet/palette key typo is invisible unless each block is compiled
  // explicitly — same trap the mouse's test records.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  // =====================================================================
  // NO LEGS — the character's defining fact. `leg`/`arm` limbs require a
  // mirrored prim (a grammar limit probed 2026-08-22), so the tail is a
  // chain of plain bones under the root with its blobs on limb `torso`,
  // and no leg cluster can ever exist. The reference silhouette has ONE
  // run below the waist (no leg split anywhere).
  // =====================================================================
  it('has no legs and carries its tail as a bone chain under the root', () => {
    const b = built();
    expect(b.clusters.some(c => c.limb === 'legL' || c.limb === 'legR')).toBe(false);
    // The tail chain: four bones descending from the pelvis, ending in the
    // upward hook (tail4 pitches up and back). Parentage is read off the
    // PARSED doc — the resolved bone map carries no parent field.
    for (const name of ['tail1', 'tail2', 'tail3', 'tail4'])
      expect(doc.bones.some(x => x.name === name)).toBe(true);
    expect(doc.bones.find(x => x.name === 'tail1')!.parent).toBe('pelvis');
    const hook = b.bones.get('tail4')!;
    expect(hook.tail[1]).toBeGreaterThan(hook.head[1]); // rises
    expect(hook.tail[2]).toBeLessThan(hook.head[2] - 0.05); // and sweeps back
  });

  // Ground contact: the mesh rests on its BELLY — contact strip z -0.31..0.0
  // m behind the centreline at y 0. Marching straight down finds flesh at
  // the floor only in that strip, and none forward of it.
  it('rests on its belly: flesh reaches the floor behind the centreline', () => {
    const b = built();
    const lowest = (x: number, z: number) => {
      for (let y = 0.004; y < 0.4; y += 0.002)
        if (sdBody([x, y, z], b) < 0) return y;
      return 1;
    };
    expect(lowest(0.03, -0.15)).toBeLessThan(0.01);  // belly contact
    expect(lowest(0.0, 0.15)).toBeGreaterThan(0.05); // nothing ahead of it
  });

  // =====================================================================
  // THE EYE — the character. One pale high-gloss dome in the upper chest:
  // mesh front z 0.41 of height (0.554 m) held over y 0.84..0.90 of height
  // (1.13..1.21 m). Painted e8dcc0 / gloss 0.9 per the brief; the pupil is
  // the one dark prim just proud of the dome's front so nearest-prim paint
  // keeps it visible.
  // =====================================================================
  const eyePrims = () => {
    const b = built();
    return b.prims.filter(p => p.color && p.color[0] > 0.6 && p.gloss === 0.9);
  };

  it('wears exactly one pale glossy eye, centred on the chest line', () => {
    const eyes = eyePrims();
    expect(eyes.length).toBe(1);
    const eye = eyes[0]!;
    expect(Math.abs(eye.a[0])).toBeLessThan(0.01);       // on the centreline
    expect(eye.a[1]).toBeGreaterThan(1.10);             // upper chest
    expect(eye.a[1]).toBeLessThan(1.22);
    // The dome must stand proud of the chest: front face past z 0.55.
    expect(eye.a[2] + eye.radius * eye.scale[2]).toBeGreaterThan(0.55);
    // And a dark pupil sits on it (the only other painted gloss prim).
    const pupil = b_pupil();
    expect(pupil).not.toBeNull();
    expect(pupil!.a[2] + pupil!.radius).toBeGreaterThan(eye.a[2] + eye.radius * eye.scale[2] - 0.01);
    expect(pupil!.color![0]).toBeLessThan(0.1);
  });

  const b_pupil = () => {
    const b = built();
    return b.prims.find(p => p.color && p.color[0] < 0.1 && p.gloss !== undefined) ?? null;
  };

  // The maw is the FRONTMOST point of the whole model: mesh z 0.463 of
  // height = 0.625 m over y 0.66..0.82 of height (0.89..1.11 m). With the
  // fangs hanging to y 0.90 the front must still clear 0.58 at the lip's
  // own latitude.
  it('the maw is the frontmost mass of the body', () => {
    const b = built();
    let front = 0;
    for (let y = 0.89; y <= 1.11; y += 0.01)
      for (let x = -0.35; x <= 0.35; x += 0.02)
        for (let z = 0.5; z <= 0.8; z += 0.002)
          if (sdBody([x, y, z], b) < 0) { front = Math.max(front, z); break; }
    expect(front).toBeGreaterThan(0.58);
  });

  // Five pale fangs (r2 true points) hanging from the lip, y 0.90..1.03 —
  // measured off the mesh's frontmost band and painted pale because the
  // mesh's texture is uniformly dark (see the .blob's fang comment).
  it('hangs five pale fangs under the lip', () => {
    const b = built();
    const fangs = b.prims.filter(p => p.color && p.color[0] > 0.4
      && (p.radiusB ?? 0) > 0 && p.a[1] > 0.9 && p.a[1] < 1.1);
    expect(fangs.length).toBe(5);
    for (const f of fangs) {
      expect(f.b[1]).toBeLessThan(f.a[1] - 0.1); // pointing down, ~13 cm long
      expect(f.a[2]).toBeGreaterThan(0.55);      // seated at the lip's face
    }
  });

  // THE CLAWS: three tapered bars per arm, fanning to the model's widest
  // span (mesh x 0.467 of height = 0.63 m at y 0.44..0.56 of height).
  it.each(['armL', 'armR'] as const)('%s ends in three true-point claws', arm => {
    const b = built();
    // Claws are the tapered prims on the c_* bones — the elbow spur is
    // tapered too and must not count.
    const claws = b.prims.filter(p => p.limb === arm && (p.radiusB ?? 0) > 0
      && (p.bone ?? '').startsWith('c_'));
    expect(claws.length).toBe(3);
    let widest = 0;
    for (const c of claws) widest = Math.max(widest, Math.abs(c.b[0]));
    expect(widest).toBeGreaterThan(0.55);
  });

  // The hood crest owns the standing height: spikes reach y 1.35 with
  // NOTHING above (the mesh crowns at exactly 1.0 of height).
  it('crowns at the declared height via the spiked hood', () => {
    const b = built();
    let top = 0;
    for (let x = -0.2; x <= 0.2; x += 0.02)
      for (let z = -0.1; z <= 0.25; z += 0.02) {
        let y = 1.5;
        while (y > 1.0 && sdBody([x, y, z], b) > 0) y -= 0.002;
        top = Math.max(top, y);
      }
    expect(top).toBeGreaterThan(1.30);
    // 1.38, not 1.35: the spike tips crown at 1.35 and the 0.004 blends add
    // a few mm — the assertion's point is that NOTHING like a head sits
    // above the hood, and the mesh crowns at exactly 1.0 of height.
    expect(top).toBeLessThan(1.38);
  });

  // Dark olive-brown hide, measured off the mesh texture (#312815..#524122):
  // red over green over blue, all dark — and wounds stay red.
  it('wears dark olive armour, not the lab default pink', () => {
    const m = compilePalette(doc)!;
    const [r, g, bl] = m.baseColor;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(bl);
    // Olive-brown, not pink and not white: r stays under 0.3 (the owner asked
    // for "lighter and shinier" on first look, 2026-08-23 — base moved from
    // the texture's AO-darkened mean 0.062 to its lit mid-tone 0.15).
    expect(r).toBeLessThan(0.30);
    expect(m.deepColor[0]).toBeGreaterThan(m.deepColor[1]);
  });
});
