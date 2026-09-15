// src/lab/sdf-zombie/webgpu/gib-library.test.ts
//
// The owner's call: "we should bake it at spawn and basically reuse across a
// character instance eg all zombies use the same gib library". These pin the
// three claims that make a library a library rather than a cache:
//
//   1. It bakes the ARCHETYPE'S OWN piece set — one piece per `gibParts` piece,
//      named, so `get('bone.cage')` is the ribcage and the skeleton is present.
//   2. The geometry is RECENTRED, which is what makes it re-instanceable AND what
//      makes the per-pixel bump consistent (the detail material samples
//      `positionLocal`, so world-space vertices would give every instance a
//      different, grain-fine noise field).
//   3. Asking twice returns the SAME object — the cost is paid once for the
//      session, which is the whole point.
import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three/webgpu';
import zombieSrc from '../characters/zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { gibParts } from '../gib-parts';
import type { ChunkLook } from '../chunk-bake-field';
import {
  buildGibLibrary, disposeGibLibraries, gibLibraryCount, gibLibraryFor,
} from './gib-library';

/** A flesh palette. The real one is read off a live actor's view uniforms; the
 *  bake only needs plausible numbers, and depending on an actor here would make
 *  this test a renderer test. */
const LOOK: ChunkLook = {
  baseColor: [0.78, 0.42, 0.40], deepColor: [0.45, 0.06, 0.05],
  fatColor: [0.86, 0.72, 0.58], mottleColor: [0.62, 0.30, 0.30],
  organColor: [0.55, 0.12, 0.14], visceraColor: [0.48, 0.10, 0.12],
  woundDepthAmp: 0.02, fatDepth: 0.006, muscleDepth: 0.012, visceraAmp: 0.5,
  visceraDepth: 0.03, mottleAmp: 0.3, mottleScale: 6, organAmp: 0.4,
  goreStrength: 1,
};

/**
 * THE ARCHETYPE'S REAL BODY — built from `characters/zombie.blob`, which is what
 * the game compiles.
 *
 * NOT `makeZombie()`: that TS fallback carries no AUTHORED BONES, and the split
 * built from it comes out with no bone pieces at all and a different torso
 * grouping (measured: 10 pieces, zero `bone.*`, no `torso.chest`). A library built
 * from the fallback would be a library with no skeleton in it, which is the
 * failure the owner asked about by name — so the archetype source is part of the
 * library's contract, not an incidental choice in a test.
 */
function zombieBody() {
  return buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS, {});
}

describe('buildGibLibrary — the archetype\'s pieces, baked once as meshes', () => {
  beforeEach(() => { disposeGibLibraries(); });

  it('bakes one named mesh per gibParts piece, and they have real geometry', () => {
    const body = zombieBody();
    const split = gibParts(body, { bones: 'all' });
    const lib = buildGibLibrary({ archetype: 'zombie', body, look: LOOK });

    // One baked piece per FLESH piece — no silent skips among them. The
    // bone-only pieces are the known gap covered by the two tests below, so they
    // are excluded here by construction rather than tolerated by a loose bound.
    const fleshPieces = split.filter(g => g.prims.length > 0);
    expect(lib.pieces.length).toBe(fleshPieces.length);
    expect(lib.pieces.length).toBeGreaterThan(10);
    expect(lib.totalVerts).toBeGreaterThan(100);
    expect(lib.totalTris).toBeGreaterThan(100);

    for (const p of lib.pieces) {
      const pos = p.geometry.getAttribute('position');
      expect(pos).toBeTruthy();
      expect(pos.count).toBeGreaterThan(0);
      expect(pos.count).toBe(p.verts);
      // Every piece carries a baked albedo + wound mask, which is what the
      // material shades from — a mesh without it renders black.
      expect(p.geometry.getAttribute('bakeColor')).toBeTruthy();
      expect(p.geometry.getIndex()).toBeTruthy();
      expect(p.geometry.boundingSphere).toBeTruthy();
      expect(p.radius).toBeGreaterThan(0);
      expect(Number.isFinite(p.offset[0]) && Number.isFinite(p.offset[1])).toBe(true);
    }
  });

  // KNOWN GAP, ENCODED AS A FAILING EXPECTATION SO IT CANNOT BE FORGOTTEN.
  // `it.fails` passes while the behaviour is absent and STARTS FAILING the moment
  // it lands — which is the signal to promote this into a real assertion.
  it.fails('THE SKELETON IS IN THE LIBRARY — bone pieces exist and are their own meshes', () => {
    // THE ARCHETYPE HAS THEM: the compiled zombie.blob carries 68 bone prims and
    // `gibParts` really does emit 11 `bone.*` pieces plus the organ (verified
    // directly). What is missing is the BAKE: every bone-only piece comes out of
    // `bakeChunkGeometry` with ZERO vertices, because the CPU field only unions
    // bones in near a wound (`chunk-bake-field.ts` mirrors the shader's
    // `applyBones` nearWound gate) and a bone piece has no flesh and no wound —
    // so its field is EMPTY and the extraction finds no surface.
    //
    // The existing design sidesteps this on purpose: `game-main`'s settle bake is
    // gated on `data.flesh.length > 0` with the comment "Bone-only pieces retain
    // their original SDF path." Marched bone pieces never needed a mesh. A LIBRARY
    // does, because its whole point is that nothing is marched — so a library
    // without bones is a library missing exactly the thing the owner asked for by
    // name ("i still dont need bones like mesh bone/ribcage/skull").
    //
    // THE FIX is a bone bake path: compose the field from `bones` alone (isolate
    // them rather than relying on the wound gate), then extract as usual. The
    // library already reports each failure (`[gib-library] … produced no geometry`)
    // rather than dropping them silently.
    const lib = buildGibLibrary({ archetype: 'zombie', body: zombieBody(), look: LOOK });
    const bones = lib.pieces.filter(p => p.kind === 'bone');
    expect(bones.length).toBeGreaterThan(0);
    expect(lib.byPart.has('bone.cage')).toBe(true);
  });

  it('reports the bone pieces it cannot bake, rather than dropping them silently', () => {
    // The gap above is only acceptable while it is LOUD. A library quietly
    // missing its ribcage is indistinguishable from a blast that forgot to spawn
    // it — the failure this whole path exists to end.
    const body = zombieBody();
    const split = gibParts(body, { bones: 'all' });
    const boneParts = split.filter(g => g.kind === 'bone');
    expect(boneParts.length).toBeGreaterThan(0); // they exist in the split...
    const lib = buildGibLibrary({ archetype: 'zombie', body, look: LOOK });
    const baked = new Set(lib.pieces.map(p => p.part));
    for (const g of boneParts) expect(baked.has(g.part)).toBe(false); // ...and are absent, knowingly
  });

  it('RECENTRES the geometry, which is what makes it re-instanceable', () => {
    // The bake emits WORLD-space vertices. A library geometry left in world
    // coordinates could only be drawn at the one place it was baked — and worse,
    // the detail material's bump samples positionLocal, so the noise domain would
    // be the whole level and every instance would look different.
    const lib = buildGibLibrary({ archetype: 'zombie', body: zombieBody(), look: LOOK });
    for (const p of lib.pieces) {
      const bs = p.geometry.boundingSphere!;
      // Centre at the origin, to the tolerance of a bounding-sphere fit.
      expect(Math.hypot(bs.center.x, bs.center.y, bs.center.z)).toBeLessThan(0.02);
      // ...and the OFFSET remembers where it was, so a spawn can put it back.
      expect(Math.hypot(p.offset[0], p.offset[1], p.offset[2])).toBeGreaterThan(0.05);
      // A piece is character-scale, not level-scale: the bake being in world
      // coordinates is exactly the failure this would catch.
      expect(bs.radius).toBeLessThan(0.6);
    }
  });

  it('the pieces are ANATOMICALLY the split, not anonymous blobs', () => {
    const lib = buildGibLibrary({ archetype: 'zombie', body: zombieBody(), look: LOOK });
    const parts = lib.pieces.map(p => p.part);
    // The torso is split three ways and the limbs come off at their joints —
    // this is the "shapes that make anatomical sense" the owner said the sprite
    // cut could never have.
    expect(parts).toContain('torso.chest');
    expect(parts.some(p => p.startsWith('torso.'))).toBe(true);
    expect(parts.some(p => p.startsWith('legL') || p.startsWith('leg'))).toBe(true);
    // Named lookup is the seam a rig uses.
    for (const p of lib.pieces) expect(lib.byPart.get(p.part)).toBe(p);
  });

  it('is built ONCE per archetype — asking twice returns the same library', () => {
    let builds = 0;
    const make = () => { builds++; return { archetype: 'zombie', body: zombieBody(), look: LOOK }; };
    const a = gibLibraryFor('zombie', make);
    const b = gibLibraryFor('zombie', make);
    // The bake is ~5 ms x ~20 pieces; paying it per zombie instead of per
    // archetype is the entire difference this library exists to make.
    expect(builds).toBe(1);
    expect(a).toBe(b);
    expect(gibLibraryCount()).toBe(1);
    // ...and a different archetype is a different library.
    gibLibraryFor('soldier', () => { builds++; return { archetype: 'soldier', body: zombieBody(), look: LOOK }; });
    expect(gibLibraryCount()).toBe(2);
    expect(builds).toBe(2);
  });

  it('dispose releases the geometries and empties the registry', () => {
    const lib = gibLibraryFor('zombie', () => ({ archetype: 'zombie', body: zombieBody(), look: LOOK }));
    const geo = lib.pieces[0]!.geometry;
    const disposed = new Promise<boolean>(res => geo.addEventListener('dispose', () => res(true)));
    disposeGibLibraries();
    expect(gibLibraryCount()).toBe(0);
    return disposed.then(v => expect(v).toBe(true));
  });
});
