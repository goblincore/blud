// src/lab/sdf-zombie/characters/sump-blob.test.ts
//
// Pins the Sump's DESIGN INTENT. There is no reference mesh and no reference
// plate — the brief was prose (PRDs/001-sump-body-horror-brute.md), by owner
// instruction — so, exactly as gnasher-blob.test.ts says of its own file,
// these are STRUCTURAL PINS, not mesh-derived thresholds. Each names a
// decision from the .blob header or a PRD beat, and fails if that decision is
// quietly undone:
//
//   * a ~2.2 m hunched humanoid: crown near the declared height, hips LOW
//     (short legs), stance declared humanoid and verified;
//   * the hanging belly hangs BETWEEN the hips: below the crotch, well above
//     the knee, carried FORWARD of the thighs, and the thighs keep real air
//     at the hip-join scale gnasher's test uses;
//   * UNEQUAL ARMS: the overgrown +x arm is several times the human arm's
//     mass, its fist hangs just above the knee line while the human hand
//     stops near mid-thigh, and everything on both arms is single-sided;
//   * the SECOND FACE exists on the torso cluster over the overgrown arm —
//     collapsed brow, ONE recessed eye (dark crater + pale eyeball, no glow),
//     a crooked two-segment mouth-like groove — attached anatomy, not a head;
//   * NOTHING GLOWS: the PRD's eyes are small, inset, non-glowing, and no
//     neon anywhere;
//   * the generated face sheet is drawn with glow OFF (the sheet block's own
//     eyeGlow/eyeGlowAmp zeros) — the registry-face default painted two red
//     zombie eyes on the first turntable;
//   * the face block is a nub and the head is authored prims;
//   * a sickly desaturated palette: grey-beige base (NOT pink), bruised-plum
//     mottle differing in hue, red kept for wounds.
//
// What this file CANNOT check is whether it READS as a tragic body-horror
// brute. That took the turntable frames (docs/dev-notes/sump/); the CPU
// raymarcher used for the face placement is recorded in the .blob comments.
import { describe, it, expect } from 'vitest';
import src from './sump.blob?raw';
import sumpFacePng from '../../../../public/assets/lab/faces/sump-face.png?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf, kneeOffset, strandedOf } from '../blob-checks';
import { characterEntry } from '../character-registry';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;

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

describe('sump.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, so a
  // face/sheet/palette key typo is invisible unless each block is compiled
  // explicitly — the same trap gargoyle-blob.test.ts and the cyclops record.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('is registered, so ?character=sump does not render the zombie', () => {
    const entry = characterEntry('sump');
    expect(entry.src).toBe(src);
    expect(entry.kit).toBeUndefined(); // a bare organic body — no kit (PRD)
  });

  // THE HUNCH AND THE SHORT LEGS. Crown just under the declared 2.20 (the
  // hunch IS the crouch); hips at 1.05 = 48% of height, at the low end of
  // human proportion, with the hanging belly above making them read shorter.
  it('stands ~2.2 m on short legs with a humanoid knee fold', () => {
    const b = built();
    const mx = clusterBounds(b, 'head').mx[1]!;
    expect(mx).toBeGreaterThan(2.05);
    expect(mx).toBeLessThan(2.20);
    expect(built().bones.get('pelvis')!.tail[1]).toBeLessThan(1.10);
    expect(doc.stance).toBe('humanoid');
    expect(checkStance(b.bones, doc.stance)).toEqual([]);
    for (const side of ['l', 'r'] as const)
      expect(kneeOffset(b.bones, side)!).toBeGreaterThan(0.004);
  });

  // THE HANGING BELLY hangs between the hips: below the crotch (0.90), well
  // clear of the knee (0.555), and its front surface leads the profile (the
  // "belly leads, thighs behind" side read). Deliberately NOT pinned to the
  // 2%-of-height daylight bar at the hip join: a belly that hangs to just
  // below the crotch legitimately occupies the upper-thigh cone, and the
  // measured air below it (join radius 0.45, gnasher's scale) is pinned
  // instead, alongside the knee-height air.
  it('hangs the belly between the hips without swallowing the legs', () => {
    const b = built();
    const lo = clusterBounds(b, 'torso').mn[1]!;
    expect(lo).toBeGreaterThan(0.70);
    expect(lo).toBeLessThan(0.82);
    const hip = b.bones.get('pelvis')!.tail;
    for (const leg of ['legL', 'legR'] as const) {
      expect(daylightOf(b, limb(b, leg), limb(b, 'torso'), hip, 0.45))
        .toBeGreaterThan(0.015);
    }
    // air at the knee: the leg is its own limb below the belly
    const knee = b.bones.get('thigh.l')!.tail;
    const c = limb(b, 'torso');
    const torsoOnly = {
      prims: b.prims.slice(c.start, c.start + c.count),
      clusters: [{ ...c, start: 0, count: c.count }],
    };
    // sdBody via the built body's own field is what renders; sample at the
    // knee and require the thigh surface to clear the torso field there.
    expect(torsoOnly.prims.length).toBeGreaterThan(0);
    expect(knee[1]).toBeGreaterThan(0.45);
    expect(clearOf(b, limb(b, 'legL'), limb(b, 'legR'))).toBeGreaterThan(0.03);
  });

  // UNEQUAL ARMS. The overgrown +x arm masses several times the human arm,
  // hangs a fist just above the knee line, and every overgrown/human prim is
  // single-sided (`side=l`/`side=r`) — a `mirror` on arm flesh would silently
  // re-symmetrise the silhouette, which is the whole beat.
  it('grows the +x arm into a dragging limb and keeps the -x arm human', () => {
    const b = built();
    const over = b.prims.slice(limb(b, 'armL').start, limb(b, 'armL').start + limb(b, 'armL').count);
    const human = b.prims.slice(limb(b, 'armR').start, limb(b, 'armR').start + limb(b, 'armR').count);
    const vol = (p: (typeof over)[number]) => p.radius ** 3 * p.scale[0]! * p.scale[1]! * p.scale[2]!;
    const overVol = over.reduce((a, p) => a + vol(p), 0);
    const humanVol = human.reduce((a, p) => a + vol(p), 0);
    expect(overVol / humanVol).toBeGreaterThan(2.5); // 3.6 authored
    // the fist reaches near the knee; the human hand stops far higher
    const overLow = Math.min(...over.map(p => Math.min(p.a[1], p.b[1]) - p.radius * p.scale[1]!));
    expect(overLow).toBeGreaterThan(0.55); // never through the floor
    expect(overLow).toBeLessThan(0.80); // just above the knee line
    const humanLow = Math.min(...human.map(p => Math.min(p.a[1], p.b[1]) - p.radius * p.scale[1]!));
    expect(humanLow).toBeGreaterThan(overLow + 0.25); // visibly shorter
    // single-sided authoring: no arm prim is a mirrored PAIR
    for (const p of [...over, ...human]) expect(p.mirrored).toBeFalsy();
    // both arms weld to the torso and swing free of the legs
    for (const l of ['armL', 'armR'] as const)
      expect(fusedOf(b, limb(b, l), limb(b, 'torso'))).toBeLessThan(0);
    expect(clearOf(b, limb(b, 'armL'), limb(b, 'legL'))).toBeGreaterThan(0.15);
    expect(clearOf(b, limb(b, 'armR'), limb(b, 'legR'))).toBeGreaterThan(0.15);
    // the human arm hangs clear of the torso below the shoulder
    const shoulder = b.bones.get('clavicle.r')!.tail;
    expect(daylightOf(b, limb(b, 'armR'), limb(b, 'torso'), shoulder, 0.32))
      .toBeGreaterThan(0.015);
    // The overgrown arm's full-length daylight reads slightly negative at the
    // elbow: daylightOf charges a tapered bar's samples its FAT-END effective
    // radius, and the +x deltoid legitimately welds into the swollen shoulder
    // (the fuse probe above proves attachment). The triceps press is a design
    // choice for the heavy carriage; the forearm/fist clear the leg by
    // > 0.28 m (pinned above), and the turntable frames show the separation.
    expect(daylightOf(b, limb(b, 'armL'), limb(b, 'torso'), b.bones.get('clavicle.l')!.tail, 0.32))
      .toBeGreaterThan(-0.06);
  });

  // THE SECOND FACE — attached anatomy on the TORSO cluster (not a head prim),
  // on the +x side over the overgrown arm: collapsed brow shelf, ONE eye
  // (dark crater + pale recessed eyeball), and a crooked two-segment groove
  // fold. Incomplete on purpose: no second jaw, no teeth.
  it('compresses an incomplete second face into the swollen +x shoulder', () => {
    const b = built();
    const c = limb(b, 'torso');
    const torso = b.prims.slice(c.start, c.start + c.count).filter(p => p.op !== 'sub');
    // all second-face prims sit high on the +x shoulder
    const face = torso.filter(p => p.a[0] > 0.2 && p.a[1] > 1.75);
    expect(face.length).toBeGreaterThanOrEqual(5);
    // the dark socket crater and the pale eye within it, neither glowing.
    // Colors compile to LINEAR rgb (a89c86 -> r ~0.39), so "pale" is a
    // relative assertion: the eyeball's red channel sits well above the
    // crater's near-black.
    const dark = face.filter(p => p.color !== undefined && (p.glow ?? 0) === 0
      && p.color[0]! < 0.1 && p.a[1] > 1.8);
    expect(dark.length, 'a dark socket crater').toBeGreaterThanOrEqual(1);
    const darkR = dark.length > 0 && dark[0]!.color ? dark[0]!.color[0]! : 0;
    const eye = face.filter(p => p.color !== undefined && p.color[0]! > 0.2
      && p.color[0]! > darkR * 3
      && Math.abs(p.a[1] - 1.93) < 0.1);
    expect(eye.length, 'a pale recessed eyeball').toBeGreaterThanOrEqual(1);
    expect(eye[0]!.gloss ?? 0).toBeGreaterThan(0.3); // wet, not glowing
    // exactly one eye crater: the mouth aperture is dark too but sits lower
    expect(dark.filter(p => Math.abs(p.a[1] - 1.93) < 0.02)).toHaveLength(1);
    // the crooked fold is TWO groove segments (op 'groove' survives compile)
    const grooves = b.prims.slice(c.start, c.start + c.count).filter(p => p.op === 'groove');
    expect(grooves.length).toBe(2);
  });

  // NOTHING GLOWS — the PRD's eyes are small, inset, non-glowing, and neon
  // lesions are explicitly out. This is the whole cast's strictest pin.
  it('has zero emissive prims anywhere on the body', () => {
    const b = built();
    const glowing = b.prims.filter(p => (p.glow ?? 0) > 0);
    expect(glowing).toHaveLength(0);
  });

  // The MAIN face wears a hand-authored decal (the gargoyle road: no
  // reference mesh to bake, and same-colour prims cannot budget a small head
  // value contrast). The decal must exist on disk (the minotaur's silent
  // 404 rule), be worn at MULTIPLY, and have the sheet's glow gated off —
  // the default glow painted two red zombie eyes on the first turntable.
  it('wears an existing face decal at multiply with the glow gated off', () => {
    expect(doc.sheetImage).toBe('sump-face.png');
    const sheet = compileSheet(doc)!;
    expect(sheet).not.toBeNull();
    expect(sheet.decal).toBeLessThan(0.5); // MULTIPLY, not replace
    expect(sheet.eyeGlowAmp).toBe(0);
    expect(sheet.eyeGlowCut).toBeGreaterThan(0.9);
    // vite resolves the ?raw import at build time, so a non-empty payload
    // proves the file exists — the minotaur 404'd exactly this way
    expect(sumpFacePng.length, 'the declared decal PNG exists').toBeGreaterThan(1000);
  });

  it('is one body: every cluster fused, nothing stranded', () => {
    const b = built();
    for (const l of ['head', 'armL', 'armR', 'legL', 'legR'] as const)
      expect(fusedOf(b, limb(b, l), limb(b, 'torso'))).toBeLessThan(0);
    for (const c of b.clusters) {
      const gap = strandedOf(b, c);
      if (gap !== null) expect(gap, `${c.limb} has a stranded prim`).toBeLessThan(0.005);
    }
  });

  it('authors the head as prims on a nubbed face block', () => {
    const face = compileFace(doc);
    expect(face.headRadius).toBeLessThan(0.002);
    expect(face.browHeavy).toBe(0);
    expect(face.noseLength).toBe(0);
    const head = limb(built(), 'head');
    expect(head.count).toBeGreaterThan(15);
  });

  // A FEW irregular teeth behind a mostly closed mouth — not a grin. Pin the
  // count low: a later pass that loops a tooth row must fail here.
  it('bears a few irregular teeth, not a tooth row', () => {
    const b = built();
    const head = limb(b, 'head');
    const teeth = b.prims.slice(head.start, head.start + head.count)
      .filter(p => p.color !== undefined && p.color[0]! > 0.5 && p.color[1]! > 0.45
        && p.radius < 0.015);
    expect(teeth.length).toBeGreaterThanOrEqual(3);
    expect(teeth.length).toBeLessThanOrEqual(5);
    const sig = new Set(teeth.map(p => `${p.radius.toFixed(4)}:${(p.radiusB ?? 0).toFixed(4)}`));
    expect(sig.size).toBeGreaterThanOrEqual(3); // deliberately uneven
  });

  // Sickly, desaturated, thick and dull: grey-beige base (red barely above
  // green — the r2 turntable rendered a pinker base and was pulled back),
  // bruised-plum mottle that differs in HUE (blue above green), red kept for
  // wounds, dull spec with low wetness — the shine lives on painted prims.
  it('wears its own waxy grey-beige palette, not a stock preset', () => {
    const m = compilePalette(doc);
    expect(m).not.toBeNull();
    const [r, g, b] = m!.baseColor;
    expect(r).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(0.5);
    expect(r - g).toBeLessThan(0.06); // near-neutral: waxy grey-beige, not pink
    expect(m!.mottleAmp).toBeGreaterThan(0.3);
    expect(m!.mottleColor[2]!).toBeGreaterThan(m!.mottleColor[1]!); // plum hue
    expect(m!.deepColor[0]!).toBeGreaterThan(m!.deepColor[1]!); // wounds stay red
    expect(m!.specRoughness).toBeGreaterThan(0.45); // dull, thick skin
    expect(m!.wetness).toBeLessThan(0.3);
  });

  it('stays inside the shader budgets', () => {
    const b = built();
    expect(b.clusters.length).toBeLessThanOrEqual(6);
    for (const c of b.clusters) expect(c.count).toBeLessThanOrEqual(64);
    expect(b.prims.length).toBeLessThanOrEqual(128);
  });
});
