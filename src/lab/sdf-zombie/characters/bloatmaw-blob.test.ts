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
//   * the eyes are EMISSIVE PRIMS and deliberately UNEVEN — a neat pair on a
//     sphere reads as a smiley face;
//   * the throat core glows, and the glowing-prim count is exactly what
//     pack.test.ts's allowlist expects (4).
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

  // THE EYES ARE UNEVEN. Two emissive prims, different sizes AND different
  // heights — the asymmetry is what stops a sphere reading as a smiley.
  it('sets two mismatched emissive eyes, not a pair', () => {
    const b = built();
    const head = limb(b, 'head');
    // Off-centre glowing prims: the two eyes. The core and its haze both sit
    // on the centreline (|x| < 0.05), so this excludes them structurally
    // rather than by colour — the eyes are deliberately cold/pale against the
    // orange throat, and a colour filter would go stale the moment they are
    // retinted.
    const eyes = b.prims.slice(head.start, head.start + head.count)
      .filter(p => (p.glow ?? 0) > 0 && Math.abs(p.a[0]) > 0.15);
    expect(eyes).toHaveLength(2);
    const [a, c] = eyes as [typeof eyes[0], typeof eyes[0]];
    expect(a!.radius).not.toBeCloseTo(c!.radius, 2); // different sizes
    expect(Math.abs(a!.a[1] - c!.a[1])).toBeGreaterThan(0.03); // different heights
    expect(a!.color).not.toEqual(c!.color);        // pale blue vs sick green
    // Neither is a mirrored `both` copy — the pair is hand-placed.
    expect(a!.mirrored).toBeUndefined();
    expect(c!.mirrored).toBeUndefined();
  });

  // THE THROAT CORE. One hot ember deep in the maw, plus a duller haze ring:
  // 4 glowing prims in total, which pack.test.ts's allowlist expects.
  it('burns a lit core in the throat: 4 glowing prims, one of them the core', () => {
    const b = built();
    const glowing = b.prims.filter(p => (p.glow ?? 0) > 0);
    expect(glowing).toHaveLength(4);
    // The core is the ONLY glowing prim on the centreline; the two eyes are
    // off to the sides.
    const hot = glowing.filter(p => (p.glow ?? 0) >= 0.9);
    expect(hot).toHaveLength(1);
    const core = hot[0]!;
    expect(Math.abs(core.a[0])).toBeLessThan(0.05); // on the centreline
    expect(Math.abs(core.a[0])).toBeLessThan(0.05);
    expect(core.a[1]).toBeGreaterThan(0.9);
    expect(core.a[1]).toBeLessThan(1.2);
    expect(core.a[2]).toBeGreaterThan(0.5);
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
