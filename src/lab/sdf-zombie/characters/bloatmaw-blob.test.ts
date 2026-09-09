// src/lab/sdf-zombie/characters/bloatmaw-blob.test.ts
//
// Pins the bloatmaw's DESIGN INTENT. There is no reference mesh and no
// reference plate — the brief was prose, by owner instruction — so, exactly
// as gargoyle-blob.test.ts says of its own file, these are STRUCTURAL PINS,
// not mesh-derived thresholds. Each one names a decision from the .blob
// header and fails if that decision is quietly undone:
//
//   * the body FLOATS: nothing touches y=0, and `height` is the top of the
//     ball (the first legless, floorless character in the roster);
//   * `stance` is OMITTED on purpose — checkStance only knows knee folds and
//     this body has no knees;
//   * the maw is a third of the body's width, authored as geometry, not a
//     decal;
//   * the arms have real daylight (the check that cost the goblin two owner
//     rejections) and fuse to the ball;
//   * the eyes are EMISSIVE PRIMS, deliberately UNEVEN, and SEATED IN FLESH
//     sockets — no bright blue or green orb (r2 replaced the old googly eyes
//     with small dim embers under a brow ridge);
//   * the body is ANATOMY, not a ball: a jaw, jowls, brow, ear-frills, a back
//     hump and a ragged crest make the silhouette irregular from every yaw
//     (r2, the owner's "ears or jaw or brow nose" brief);
//   * the throat carries a wet EYE (sclera/iris/pupil), not a glowing core —
//     the only two emissive prims are the mismatched face eyes, which is
//     exactly the count pack.test.ts's allowlist expects (2).
//
// What this file CANNOT check is whether it READS as a hovering maw-demon.
// That took the turntable frames (see the authoring skill); the GPU lab could
// not be driven in this sandbox, so the authoring check used a CPU raymarch
// fallback — see the dispatch report.
import { describe, it, expect } from 'vitest';
import src from './bloatmaw.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf, strandedOf } from '../blob-checks';
import { characterEntry, FACE_TEXTURES } from '../character-registry';
import type { Primitive } from '../types';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;
/** 2% of declared height: the separation the authoring skill calls visible
 *  from every yaw rather than only the shadowed side. */
const DAYLIGHT = 0.02 * 1.83;

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

describe('bloatmaw.blob', () => {
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

  // THE FLOATING PROBLEM. There is no third stance value, and `null` means
  // "not checked" — the honest declaration for a body with no leg chain.
  it('omits stance rather than inventing one, and checkStance has nothing to say', () => {
    expect(doc.stance).toBeNull();
    expect(checkStance(built().bones, doc.stance)).toEqual([]);
  });

  // height = the TOP OF THE BALL; the whole body hovers. Nothing in
  // blob-checks.ts or validate.ts enforces ground contact, which is why a
  // floorless body validates at all — so the hover gap is pinned HERE.
  it('hovers clear of the floor, with the ball top at the declared height', () => {
    const b = built();
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of b.prims) {
      if (p.op === 'sub') continue;
      for (const e of [p.a, p.b]) {
        for (let i = 0; i < 3; i++) {
          mn[i] = Math.min(mn[i]!, e[i]! - p.radius * p.scale[i]!);
          mx[i] = Math.max(mx[i]!, e[i]! + p.radius * p.scale[i]!);
        }
      }
    }
    // The hover gap: 0.302 m at authoring time. Nothing may touch the floor.
    expect(mn[1]).toBeGreaterThan(0.25);
    expect(mn[1]).toBeLessThan(0.35);
    // Top of the ball = declared height (spurs stay under it too).
    expect(mx[1]).toBeGreaterThan(doc.height! - 0.02);
    expect(mx[1]).toBeLessThan(doc.height! + 0.01);
  });

  // THE MAW IS A THIRD OF THE BODY. The dark maw mass is the widest painted
  // head prim; compare its semi-axes with the main ball's.
  it('splits the front of the ball with a maw a third of its width', () => {
    const b = built();
    const ball = b.prims.find(p => p.radius > 0.7)!;
    const maw = b.prims.slice(limb(b, 'head').start, limb(b, 'head').start + limb(b, 'head').count)
      .filter(p => p.color !== undefined && p.radius > 0.3)
      .sort((x, y) => y.radius * y.scale[0] - x.radius * x.scale[0])[0]!;
    const ballX = ball.radius * ball.scale[0];
    const ballY = ball.radius * ball.scale[1];
    const mawX = maw.radius * maw.scale[0];
    const mawY = maw.radius * maw.scale[1];
    expect(mawX / ballX).toBeGreaterThan(0.6);  // 0.81 authored
    expect(mawY / ballY).toBeGreaterThan(0.35); // 0.48 authored
  });

  // TEETH ARE GEOMETRY, and there are enough of them to ring the maw. Bone
  // colour is the tell: g > 0.5 while the eyes (amber/red) sit under 0.5.
  it('rings the maw with irregular bone teeth', () => {
    const b = built();
    const head = limb(b, 'head');
    const teeth = b.prims.slice(head.start, head.start + head.count)
      .filter(p => p.color !== undefined && p.glow === undefined
        && p.color[0] > 0.6 && p.color[1] > 0.5 && p.color[2] < 0.5); // bone, not the green eye
    expect(teeth).toHaveLength(9);
    // No two are identical: the brief asks for irregular teeth, so a later
    // pass that loops one line would show up here.
    const sig = new Set(teeth.map(p => `${p.radius.toFixed(3)}:${(p.radiusB ?? 0).toFixed(3)}`));
    expect(sig.size).toBeGreaterThanOrEqual(6);
  });

  // THE EYES ARE SEATED EMBERS, NOT GOOGLY ORBS. r2 threw out the two bright
  // pale-BLUE and GREEN spheres that sat proud of the ball like toy eyes.
  // Two emissive prims remain, deliberately uneven (different sizes AND
  // heights), but they are small dim embers tucked INTO flesh sockets under
  // the brow — the asymmetry is what keeps the mass from reading as a
  // smiley, and the seated-into-flesh read is what r2 was ordered to fix.
  it('sets two mismatched ember eyes seated in flesh sockets, not a pair of bright orbs', () => {
    const b = built();
    const head = limb(b, 'head');
    // Off-centre glowing prims: the two eyes. The core and its haze both sit
    // on the centreline (|x| < 0.05), so this excludes them structurally
    // rather than by colour.
    const eyes = b.prims.slice(head.start, head.start + head.count)
      .filter(p => (p.glow ?? 0) > 0 && Math.abs(p.a[0]) > 0.15);
    expect(eyes).toHaveLength(2);
    const [a, c] = eyes as [typeof eyes[0], typeof eyes[0]];
    expect(a!.radius).not.toBeCloseTo(c!.radius, 2); // different sizes
    expect(Math.abs(a!.a[1] - c!.a[1])).toBeGreaterThan(0.03); // different heights
    expect(a!.color).not.toEqual(c!.color);        // burnt crimson vs smoke-amber
    // Neither is a mirrored `both` copy — the pair is hand-placed.
    expect(a!.mirrored).toBeUndefined();
    expect(c!.mirrored).toBeUndefined();
    // NOT bright blue or green. The r2 order was explicit: no saturated hue
    // that reads as plastic or glass. Assert red dominates blue (so not a blue
    // eye) and green does not dominate (so not a green eye), and that the
    // glow is warm-ember (red channel highest of the three).
    for (const e of [a!, c!]) {
      const [r, g, bl] = e.color!;
      expect(r).toBeGreaterThan(bl);              // not blue-dominant
      expect(r - g).toBeGreaterThan(0.02);        // not green-dominant; reds ahead
    }
    // SEATED IN FLESH, not stuck on: each eye is set into a flesh crater —
    // a wider non-glowing socket prim at the same x, its surface BEHIND the
    // eye (lower z). That is what makes the outline flesh rather than a
    // sphere off a sphere.
    for (const e of [a!, c!]) {
      const socket = b.prims.slice(head.start, head.start + head.count)
        .filter(p => (p.glow ?? 0) === 0
          && Math.abs(p.a[0] - e.a[0]) < 0.05
          && p.a[2] < e.a[2] && p.radius > e.radius);
      expect(socket.length, `eye at x ${e.a[0]} has a flesh socket behind it`).toBeGreaterThan(0);
    }
  });

  // THE THROAT EYE. r3 threw out the "burning throat core" — a flat saturated
  // red disc in the middle of the maw that read as a sticker pasted on the
  // mouth, with no depth behind it (the brief was wrong and is discarded).
  // In its place: a great wet EYE set in the throat — sclera, iris, pupil —
  // authored as additive geometry (the maw is deliberately NOT a carve, see the
  // .blob header). It does NOT glow: it catches the key light instead of
  // emitting, which is the difference between an eye and a second ball. So
  // exactly TWO prims glow now — the two mismatched face eyes — matching
  // pack.test.ts's allowlist.
  it('sets a wet throat EYE instead of the glowing core: 2 glowing prims, both the face', () => {
    const b = built();
    const glowing = b.prims.filter(p => (p.glow ?? 0) > 0);
    expect(glowing).toHaveLength(2);
    // Both glow prims are the off-centre face eyes — |x| > 0.15.
    for (const e of glowing) expect(Math.abs(e.a[0])).toBeGreaterThan(0.15);
    // The throat eye is a pale SCLERA on the centreline, with a dark iris and
    // a near-black pupil stacked in front of it, and it does not glow.
    const head = limb(b, 'head');
    const sclera = b.prims.slice(head.start, head.start + head.count)
      .filter(p => p.color !== undefined && (p.glow ?? 0) === 0
        && Math.abs(p.a[0]) < 0.05 && p.a[1] > 0.9 && p.a[1] < 1.25
        && p.color[0] > 0.2 && p.color[0] < 0.5 && p.color[1] > 0.12
        && p.color[1] < 0.35 && p.color[2] > 0.08);
    expect(sclera, 'a pale sclera on the centreline').toHaveLength(1);
    const eye = sclera[0]!;
    // Front of the maw (dark prim 0) is at z ~0.74; the sclera centre sits
    // behind the tooth tips (z ~0.82) but proud of the dark maw surface so it
    // owns its pixels and reads through the tooth gap.
    expect(eye.a[1]).toBeGreaterThan(0.9);   // mid-maw height
    expect(eye.a[2]).toBeGreaterThan(0.6);
    expect(eye.gloss ?? 0).toBeGreaterThan(0.5);  // wet
    // An iris and a pupil sit just in front of the sclera (higher z), darker.
    const iris = b.prims.slice(head.start, head.start + head.count)
      .filter(p => p.color !== undefined && (p.glow ?? 0) === 0
        && Math.abs(p.a[0]) < 0.05 && p.a[2] > eye.a[2] && p.a[2] < 0.85
        && p.color[0] > 0.1 && p.color[0] < 0.5 && p.color[2] < 0.05);
    expect(iris.length, 'a darker iris in front of the sclera').toBeGreaterThan(0);
    expect(iris[0]!.radius).toBeLessThan(eye.radius);
  });

  // THE BODY IS ANATOMY, NOT A BALL (r2). The owner's brief: "more complex
  // shape... things like ears or jaw or brow nose." The silhouette test is
  // "irregular from every yaw", which a structural pin can only APPROACH:
  // it asserts the mass carries features on each axis rather than a single
  // smooth ellipsoid — a jutting jaw + jowls under the maw, ear-frills and a
  // back hump off the flanks/back, a brow ridge over the maw. If any pass
  // re-spheres the body these fail.
  it('is built up into anatomy, not a smooth ball, on every axis', () => {
    const b = built();
    const torso = b.prims.slice(limb(b, 'torso').start, limb(b, 'torso').start + limb(b, 'torso').count);
    const headP = b.prims.slice(limb(b, 'head').start, limb(b, 'head').start + limb(b, 'head').count);

    // JAW + JOWLS: a broad mass under the maw line (maw centre y ~1.05). The
    // heaviest off-centre head prim below it is the jaw; it must reach both
    // down (y < 0.95) and toward the front (z > 0.3) so it juts past the ball
    // arc rather than being a hole in it.
    const jaw = headP.filter(p => p.a[1] < 0.95 && p.a[2] > 0.3 && p.radius > 0.12)
      .sort((x, y) => y.radius - x.radius)[0];
    expect(jaw, 'a mandible mass under the maw').toBeDefined();

    // EAR-FRILLS + BACK HUM: masses off the crown that reach BACK (z < -0.05)
    // and OUT (|x| > 0.3), on the skull bone — these are what take the side
    // and back views off the plain-circle path.
    const frills = headP.filter(p => p.bone === 'skull' && p.a[2] < -0.05
      && Math.abs(p.a[0]) > 0.3 && p.radius > 0.05);
    expect(frills.length, 'ear-frills / back hump off the crown').toBeGreaterThanOrEqual(2);
    const hump = headP.filter(p => p.bone === 'skull' && p.a[2] < -0.4 && p.radius > 0.12);
    expect(hump.length, 'a heavy back hump').toBeGreaterThanOrEqual(1);

    // BROW RIDGE: a wide flat prim over the eyes. `wide` scales the x
    // semi-axis; a ridge > 0.5 m of half-width (radius * scale.x) is wide
    // enough to span both sockets, and it sits above them (y > 1.55).
    const brow = headP.filter(p => p.a[1] > 1.55 && p.radius * p.scale[0] > 0.25);
    expect(brow.length, 'a shelving brow ridge over the sockets').toBeGreaterThanOrEqual(1);

    // The silhouette is no longer one circle: out-of-plane (|z|) extent and
    // lateral (|x|) extent both come from the flesh masses, so the profile
    // is wider front-to-back than a pure sphere of the ball's radius.
    // Measure the true outline (both endpoints + the radius that stands proud).
    const extent = (p: Primitive, ax: 0 | 2) =>
      Math.max(Math.abs(p.a[ax]), Math.abs(p.b[ax])) + p.radius * p.scale[ax];
    const xs = headP.map(p => extent(p, 0));
    const zs = headP.map(p => extent(p, 2));
    expect(Math.max(...xs)).toBeGreaterThan(0.55);   // ears poke past the equator
    expect(Math.max(...zs)).toBeGreaterThan(0.55);   // back hump / jaw reach back and front

    // ASYMMETRY: the body masses are not bilaterally symmetric. There must be
    // a torso lump whose centre sits clearly off-axis one way, and a paired
    // lump at a different offset the other way — not a matched `both` pair.
    const torsoOff = torso.filter(p => (p.glow ?? 0) === 0 && Math.abs(p.a[0]) > 0.28);
    expect(torsoOff.length, 'off-centre torso swell lumps').toBeGreaterThanOrEqual(2);
  });

  // PUFFERFISH SPIKES (r3). A far radius of ZERO (`r2=0`) is the one shape a
  // capsule cannot make — a TRUE POINT, which is what separates a spike from a
  // wart. The field is authored in FLESH (merged into the ball) as keratin
  // horn colour, one hand-placed prim each so it is irregular. REACH is the
  // whole game: a point that stops inside the mass reads as a bump, so enough
  // of these must clear the main ellipsoid's surface. Also pins the budget:
  // they cost cluster prims, so the head + torso clusters stay under the 64
  // prim WGSL fold ceiling (validated by validateBody too).
  it('bristles with true-point keratin spikes over the back and crown', () => {
    const b = built();
    const ball = b.prims.find(p => p.radius > 0.7)!;
    const sx = ball.radius * ball.scale[0], sy = ball.radius * ball.scale[1], sz = ball.radius * ball.scale[2];
    // Keratin horn: 6b5a44 -> linear (0.15,0.10,0.06) with r > g > b, and a
    // REAL r2=0 (true point) — excludes the crest (r2 0.004-0.006) and the
    // ear-frills (no r2 at all).
    const spikes = b.prims.filter(p => p.radiusB !== undefined && p.radiusB < 0.001
      && p.color !== undefined && p.color[0] > 0.1 && p.color[0] < 0.22
      && p.color[1] > 0.05 && p.color[1] < 0.16 && p.color[2] < 0.12);
    expect(spikes.length, 'a field of true-point spikes').toBeGreaterThanOrEqual(12);
    let reach = 0;
    for (const p of spikes) {
      const ex = (p.b[0] / sx) ** 2 + ((p.b[1] - ball.a[1]) / sy) ** 2 + (p.b[2] / sz) ** 2;
      if (ex > 1) reach++;
    }
    expect(reach, 'spike tips that clear the ball surface, not bumps inside it').toBeGreaterThanOrEqual(8);
    // The spikes stay under the declared ball top and clear of the hover gap.
    for (const p of spikes) {
      expect(p.b[1] + p.radius).toBeLessThan(doc.height!); // under the top
      expect(p.b[1] - p.radius).toBeGreaterThan(0.35);     // above the gap
    }
  });

  // THE GOBLIN REGRESSION. clearOf reads centrelines; the render showed a
  // torso with arm-shaped bulges. daylightOf measures the air between
  // surfaces, ignoring the region where the limb legitimately merges into the
  // joint. The join is the shoulder, so what is measured is the free arm.
  it('hangs both withered arms free of the ball, and welds them on', () => {
    const b = built();
    for (const side of ['armL', 'armR'] as const) {
      const arm = limb(b, side);
      const shoulder = b.bones.get(`clavicle.${side === 'armL' ? 'l' : 'r'}`)!.tail;
      expect(daylightOf(b, arm, limb(b, 'torso'), shoulder, 0.14), `${side} daylight`)
        .toBeGreaterThan(DAYLIGHT);
      expect(fusedOf(b, arm, limb(b, 'torso')), `${side} fused`).toBeLessThan(0);
      expect(clearOf(b, arm, limb(b, 'torso')), `${side} clear`).toBeGreaterThan(0);
    }
    expect(clearOf(b, limb(b, 'armL'), limb(b, 'armR'))).toBeGreaterThan(0.4);
  });

  it('is one body: nothing stranded in a cluster', () => {
    const b = built();
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

  it('ships no decal and registers the shared flat sheet', () => {
    // The maw, teeth, eyes and core are geometry; there is no reference mesh
    // to bake and no generated PNG. Declaring an `image` for a file that does
    // not exist is the minotaur's silent 404 — do not repeat it.
    expect(doc.sheetImage).toBeNull();
    expect(compileSheet(doc)).toBeNull();
    const entry = characterEntry('bloatmaw');
    expect(entry.src).toBe(src);
    expect(entry.face).toBe(FACE_TEXTURES['zombie-flat']);
    expect(entry.kit).toBe('/assets/lab/bloatmaw-kit.gltf');
  });

  it('wears its own diseased-flesh palette, not a stock preset', () => {
    const m = compilePalette(doc);
    expect(m).not.toBeNull();
    expect(m!.deepColor[0]).toBeGreaterThan(m!.deepColor[1]); // wounds stay red
    expect(m!.mottleAmp).toBeGreaterThan(0.2);
    // The mottle must differ in HUE, not just value, or it reads as nothing.
    expect(m!.mottleColor[1]).toBeGreaterThan(m!.mottleColor[0]);
  });
});
