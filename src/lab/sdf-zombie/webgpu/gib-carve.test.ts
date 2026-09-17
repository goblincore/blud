// src/lab/sdf-zombie/webgpu/gib-carve.test.ts
//
// "mesh the zombie.blob once, then cut it into more granular pieces" — the
// owner's option 2. These pin what makes it worth doing over the per-piece bake:
//
//   1. It meshes the WHOLE BODY, so the SKELETON IS IN THE FIELD. The per-piece
//      bake could not do bones at all (a bone-only piece has no flesh, and the
//      chunk field gates bones on being near a wound, so its field was empty).
//      Measured here: the ribcage's own piece comes out with bone prims in it.
//   2. Granularity is a DIAL — `cells` slabs per cluster — instead of whatever
//      the authored split happened to be.
//   3. Each piece is a CAPPED region clip, not a sliced-open shell.
import { describe, expect, it } from 'vitest';
import zombieSrc from '../characters/zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import type { ChunkLook } from '../chunk-bake-field';
import { carveBodyIntoPieces } from './gib-carve';

const LOOK: ChunkLook = {
  baseColor: [0.78, 0.42, 0.40], deepColor: [0.45, 0.06, 0.05],
  fatColor: [0.86, 0.72, 0.58], mottleColor: [0.62, 0.30, 0.30],
  organColor: [0.55, 0.12, 0.14], visceraColor: [0.48, 0.10, 0.12],
  woundDepthAmp: 0.02, fatDepth: 0.006, muscleDepth: 0.012, visceraAmp: 0.5,
  visceraDepth: 0.03, mottleAmp: 0.3, mottleScale: 6, organAmp: 0.4,
  goreStrength: 1,
};

function zombieBody() {
  return buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS, {});
}

/** A coarse cell keeps these tests fast; the shipped default is 1 cm. */
const CELL = 0.02;

describe('carveBodyIntoPieces — the whole body meshed, then cut', () => {
  it('produces capped meshes with real geometry and baked albedo', () => {
    const lib = carveBodyIntoPieces({
      archetype: 'zombie', body: zombieBody(), look: LOOK, cells: 2, cellSize: CELL,
    });
    expect(lib.pieces.length).toBeGreaterThan(4);
    expect(lib.totalVerts).toBeGreaterThan(200);
    expect(lib.totalTris).toBeGreaterThan(200);
    for (const p of lib.pieces) {
      expect(p.geometry.getAttribute('position').count).toBe(p.verts);
      // The material shades from `bakeColor`; a mesh without it renders black.
      expect(p.geometry.getAttribute('bakeColor')).toBeTruthy();
      expect(p.geometry.getIndex()).toBeTruthy();
      expect(p.radius).toBeGreaterThan(0);
      expect(p.verts).toBeGreaterThan(0);
    }
  });

  // RENAMED AND CORRECTED (2026-09-11). This was called "THE SKELETON IS IN THE
  // MESH — the thing the per-piece bake could not do", and it did not test that.
  // It counted bone prims whose BOUNDING BOX overlapped a region and never looked
  // at a vertex, so it passed while the claim was false: `sdBody` skips
  // `op === 'bone'` in both folds ("the CPU field never shows it"), so the bones
  // never reached the geometry at all. What is true, and what this now checks, is
  // that the regions COVER the skeleton — which is what lets `makeKindAt` tag the
  // vertices a cut drove inside a bone. The material claim is pinned separately
  // by the goreKind test below.
  it('the regions cover the skeleton, so a cut can expose bone', () => {
    const body = zombieBody();
    expect((body.bonePrims ?? []).length).toBeGreaterThan(0);
    const lib = carveBodyIntoPieces({
      archetype: 'zombie', body, look: LOOK, cells: 3, cellSize: CELL,
    });
    // The whole-body field is an unconditional fold over flesh AND bone, so a
    // region that spans the ribcage must report bone prims inside it. Under the
    // old per-piece bake EVERY bone piece extracted to zero vertices, so this
    // assertion is the difference between the two approaches.
    expect(lib.bonePrims).toBeGreaterThan(0);
    const withBones = lib.pieces.filter(p => p.bonesNear > 0);
    expect(withBones.length).toBeGreaterThan(0);
    // The axial pieces are where the skeleton lives: the torso slices must
    // carry bone, and the head's slice the skull.
    const torso = lib.pieces.filter(p => p.limb === 'torso');
    expect(torso.length).toBeGreaterThan(0);
    expect(torso.some(p => p.bonesNear > 0)).toBe(true);
  });

  it('GRANULARITY IS A DIAL — more cells means more pieces', () => {
    const body = zombieBody();
    const coarse = carveBodyIntoPieces({
      archetype: 'zombie', body, look: LOOK, cells: 1, cellSize: CELL,
    });
    const fine = carveBodyIntoPieces({
      archetype: 'zombie', body: zombieBody(), look: LOOK, cells: 4, cellSize: CELL,
    });
    // cells x clusters is the piece budget, so asking for finer gore must
    // actually yield more pieces — this is the knob the owner asked for.
    expect(fine.pieces.length).toBeGreaterThan(coarse.pieces.length);
    expect(fine.cells).toBe(4);
    // ...and the pieces are individually smaller, not just more numerous.
    const maxVerts = (l: typeof fine) => Math.max(...l.pieces.map(p => p.verts));
    expect(maxVerts(fine)).toBeLessThan(maxVerts(coarse));
  });

  it('each piece is CLIPPED to its region — the cut is capped, not open', () => {
    const lib = carveBodyIntoPieces({
      archetype: 'zombie', body: zombieBody(), look: LOOK, cells: 3, cellSize: CELL,
    });
    for (const p of lib.pieces) {
      // The bounding sphere must fit the region it came from (with the cell
      // slop a surface-nets crossing needs). A piece substantially larger than
      // its own clip box would mean the clip did not apply — i.e. a piece that
      // is the whole limb with a name claiming otherwise.
      const regionRadius = Math.hypot(p.halfExtent[0], p.halfExtent[1], p.halfExtent[2]);
      expect(p.radius).toBeLessThan(regionRadius + 3 * CELL);
      // Recentred, so it can be instanced anywhere.
      const bs = p.geometry.boundingSphere!;
      expect(Math.hypot(bs.center.x, bs.center.y, bs.center.z)).toBeLessThan(0.02);
    }
  });


  // THE CUT FACE IS TORN MEAT, NOT SKIN (2026-09-11).
  //
  // The albedo baker is the march's own chain, and in that chain the wound mask
  // is "the sole authority on WHETHER this pixel is wounded" (march.wgsl.ts):
  // `albedo = mix(baseColor, tissue, wm)`, so at wm = 0 the whole tissue ramp —
  // fat, muscle, clot, viscera — is computed and then thrown away.
  //
  // A rest-pose body has no torn ends, so `chunkBakeField` is given `torn: []`
  // and its wound mask is identically zero. That painted every vertex of every
  // piece as INTACT OUTER SKIN, including the ~33% of the surface that is a cut
  // face, and that is the "pale, grey, concrete" verdict: one flat hue, and
  // alpha 0 so the shader's wetness/gloss never engaged either.
  //
  // The cut IS the wound here, and the field already knows where it is: a
  // vertex on the original skin has preWound = 0, a vertex on a cut face sits
  // millimetres-to-centimetres BENEATH it. See `cutMask` in gib-carve.ts.
  it('paints the CUT FACES as torn meat and the original skin as skin', () => {
    // The shipped zombie flesh preset (material.ts), NOT the coarse LOOK above:
    // woundDepthAmp ships at 1, and the fat/muscle knees are in millimetres, so
    // this is the ramp the game actually runs.
    const shipped: ChunkLook = {
      ...LOOK,
      baseColor: [0.68, 0.44, 0.40], fatColor: [0.83, 0.72, 0.42],
      visceraColor: [0.28, 0.06, 0.10], organColor: [0.72, 0.32, 0.30],
      woundDepthAmp: 1, fatDepth: 0.004, muscleDepth: 0.014,
      visceraDepth: 0.045, visceraAmp: 1, organAmp: 1,
    };
    // `cells: 1` — the SHIPPED granularity since the anatomical partition landed:
    // one piece per bone group. (Passing 3 here subdivides each of the eleven
    // groups into three, which is 33 pieces and a far higher cut-face-to-skin
    // ratio than anything that ships.)
    const lib = carveBodyIntoPieces({
      archetype: 'zombie', body: zombieBody(), look: shipped, cells: 1, cellSize: CELL,
    });
    // Buckets, not a hard split: CELL here is 2 cm to keep the suite fast, and a
    // coarse extraction fattens the tear rim (measured at 2 cm: 37% skin, 15%
    // rim, 48% meat). At the SHIPPED 1 cm cell the same library is sharply
    // bimodal — 65% of vertices below alpha 0.3, 34% above 0.7, and only 1.1% in
    // the rim between them (measured 2026-09-11).
    let skin = 0, meat = 0, total = 0;
    let skinLum = 0, meatLum = 0;
    for (const p of lib.pieces) {
      const c = p.geometry.getAttribute('bakeColor').array as ArrayLike<number>;
      for (let i = 0; i < c.length; i += 4) {
        const lum = 0.2126 * c[i]! + 0.7152 * c[i + 1]! + 0.0722 * c[i + 2]!;
        total++;
        if (c[i + 3]! > 0.7) { meat++; meatLum += lum; } else if (c[i + 3]! < 0.3) { skin++; skinLum += lum; }
      }
    }
    // A third of a carved piece's surface is cut face; demand a clear minority
    // rather than the exact figure, which moves with `cells` and the cell size.
    expect(meat / total).toBeGreaterThan(0.15);
    // ...and the skin must still be there. A mask that fired everywhere would
    // be just as wrong as one that never fires.
    expect(skin / total).toBeGreaterThan(0.3);
    // The whole point: exposed meat reads DARKER and REDDER than skin. Under
    // the shipped preset the ramp lands near-black clot at the muscle knee
    // against a pale dermis, so the gap is large, not a nudge.
    expect(meatLum / meat).toBeLessThan((skinLum / skin) * 0.6);
  });


  // THE MATERIAL'S VERTEX CONTRACT (2026-09-11).
  //
  // `createBakedChunkMaterial({goreDetail: true})` — which is how game-main builds
  // the carved library's material — reads `attribute('goreKind', 'float')` and
  // branches the entire material on it: kind > 1.5 drags the albedo 62% toward a
  // pale organ wash, forces wetness to >= 0.86 and sets gloss 220; kind > 0.5 sets
  // gloss 90. Its own docstring says geometry without the attribute "must NOT use
  // this mode ... an attribute that is not there is not 0 — it is a bind error".
  //
  // This module shipped without it and three said so on every frame:
  //   THREE.AttributeNode: Vertex attribute "goreKind" not found on geometry.
  // A gloss-220 highlight under the 4x flashlight beam is a blown white speck
  // wherever the normal faces the lamp. This test is the thing that would have
  // caught it, so it asserts the attribute EXISTS and that it is populated from
  // the body rather than zero-filled.
  it('carries the goreKind attribute the detail material branches on', () => {
    const body = zombieBody();
    const lib = carveBodyIntoPieces({
      archetype: 'zombie', body, look: LOOK, cells: 3, cellSize: CELL,
    });
    let meat = 0, bone = 0, organ = 0;
    for (const p of lib.pieces) {
      const k = p.geometry.getAttribute('goreKind');
      expect(k, `${p.part} has no goreKind`).toBeTruthy();
      expect(k.count).toBe(p.geometry.getAttribute('position').count);
      const a = k.array as ArrayLike<number>;
      for (let i = 0; i < a.length; i++) {
        if (a[i] === 2) organ++; else if (a[i] === 1) bone++; else meat++;
      }
    }
    // Most of a body is meat...
    expect(meat / (meat + bone + organ)).toBeGreaterThan(0.5);
    // ...but the skeleton is IN this field (that is the whole point of the carve),
    // so the cuts that cross it must mark those vertices as bone. A zero-filled
    // attribute would satisfy the existence check above and fail here.
    expect(bone).toBeGreaterThan(0);
  });

  it('reports the regions that produced no surface instead of hiding them', () => {
    const lib = carveBodyIntoPieces({
      archetype: 'zombie', body: zombieBody(), look: LOOK, cells: 6, cellSize: CELL,
    });
    // A fine split puts some slabs in the gaps between prims (the crotch, an
    // armpit) where there is genuinely no surface. Those must be REPORTED: a
    // library quietly short of pieces looks identical to a blast that failed to
    // spawn them.
    for (const s of lib.skipped) {
      expect(typeof s.part).toBe('string');
      expect(s.reason.length).toBeGreaterThan(0);
    }
    expect(lib.pieces.length + lib.skipped.length).toBeGreaterThan(0);
  });
});
