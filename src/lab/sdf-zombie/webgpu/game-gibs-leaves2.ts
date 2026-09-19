// src/lab/sdf-zombie/webgpu/game-gibs-leaves2.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu'
import { chunkExtent, chunkSupportSpheres } from '../extent'
import { makeChunk } from '../gib-chunks'
import { type GibPiece } from '../gib-parts'
import { boneChunkRadius } from '../melt-bones'
import { type Primitive, type Vec3 } from '../types'
import { type Quat } from '../vec'
import { type ZombieActor } from './game-actor'
import { gibAssetArchetypeOf, primsLongAxis } from './game-gibs-leaves'
import { checkGibAssetDeformBounds, gibAssetDeformBoundsOk, gibAssetRowsFromPrims } from './gib-asset-deform'
import { gibAssetMeshEligible } from './gib-asset-runtime'
import { spawnSpritePiece } from './gib-sprite-pieces'
import { pickFrame } from './gib-sprites'
import { rngStreams } from './rng'


/**
 * Spawn one offline-asset mesh piece. Returns false (with a counted reason)
 * when the archetype/part is not available or the runtime piece is damaged;
 * the caller then falls back to the marched path for that piece.
 *
 * The `Chunk` state is built with EXACTLY `spawnChunkPiece`/`spawnSpriteGibPiece`
 * arithmetic — same radius, long axis, support spheres and pre-release spin —
 * so an asset gib settles at the same height, bounces off the same walls and
 * topples the same way as the marched one.
 */
export function spawnAssetGibPiece(ctx: GameContext, 
  a: ZombieActor,
  g: GibPiece,
  impulseVel: Vec3 | null,
  impulseDelay: number,
): boolean {
  const lib = ctx.gibs.assetRuntime.library(gibAssetArchetypeOf(ctx, a));
  if (!lib) { ctx.gibs.assetRuntime.countFallback('no-library'); return false; }
  const piece = lib.byPart.get(g.part);
  if (!piece) { ctx.gibs.assetRuntime.countFallback('no-asset'); return false; }
  // THE HEAD NOW KEEPS THE MESH PATH WHEN A FACE CAN RIDE IT (task 4). The
  // face layer projects from the ACTOR's live `headCentre`/`headQuat`/
  // `headAxes`; a per-instance material built from those uniforms and moved
  // with the chunk gives the mesh head the same face the marched head has.
  // Without a face texture, or with face projection off (a custom/damaged
  // head), the piece still falls back — counted as `head-face`, never silent.
  const faceUniforms = a.view.uniforms;
  const faceSupported = ctx.gibs.assetRuntime.headFaceAvailable()
    && faceUniforms.faceCfg.value.x > 0.5
    && !!faceUniforms.faceTex.value;
  const ineligible = gibAssetMeshEligible(piece.doc, g, faceSupported);
  if (ineligible) { ctx.gibs.assetRuntime.countFallback(ineligible); return false; }
  // ROW ALIGNMENT IS PART OF ELIGIBILITY (and now SEMANTIC, not a count).
  // `gibAssetMeshEligible` -> `gibAssetRowsMatch` walks the bind table against
  // the runtime rows row for row: flesh rows against `g.prims` minus the `sub`
  // cut caps (not bind targets under `GIB_ASSET_BIND_MASK = 'additive-v1'`),
  // bone rows against `g.bones`. A plan that kept the same source set but
  // reordered/grew a row falls back here instead of deforming against the
  // wrong frame.
  const pool = ctx.gibs.assetRuntime.poolFor(lib);
  if (!pool) { ctx.gibs.assetRuntime.countFallback('no-pool'); return false; }
  const kind = g.kind ?? 'limb';
  const boneOnly = g.prims.length === 0 && g.bones.length > 0;
  const extentSource = boneOnly ? g.bones : g.prims;
  const support = chunkSupportSpheres(extentSource, g.origin);
  const state = makeChunk(
    g.limb as never, g.origin, [0, 0, 0],
    boneOnly ? boneChunkRadius(g.bones) : chunkExtent(g.prims, g.origin),
    primsLongAxis(ctx, extentSource, g.origin),
    rngStreams.misc, kind,
    (g.spinQuat || g.spinAngVel) ? { quat: g.spinQuat, angVel: g.spinAngVel } : undefined,
    support.length > 0 ? support : undefined,
  );
  // THE DEFORMATION SOURCE: THE RUNTIME PIECE'S OWN ROW-ALIGNED FRAMES.
  //
  // On the rupture path `g.prims`/`g.bones` are `retargetGibPieces`' output —
  // each SOURCED row is the body's sloughed twin (so the released mesh is the
  // geometry last drawn, no snap-back) — and `displaceGibPieces` has already
  // added the region offset to every row AND to `g.origin`. So deforming
  // against these rows and subtracting `g.origin` cancels that offset and
  // leaves exactly the chunk-relative shape `spawnChunkPiece` marches.
  //
  // WHY NOT `gibAssetPosedRows` HERE (task 3, measured). That helper maps the
  // bind table's SOURCE INDICES into `frame.deformedPrims`, which is equivalent
  // for sourced rows but has NO TWIN for an unsourced `sub` cut cap: those rows
  // fell back to the REST frame, so their vertices stayed at the REST body
  // position while the region rotated — long spike triangles off every piece.
  // The cap IS present row-aligned in the runtime piece (posed, +offset), so
  // the row-aligned frames deform every row, caps included, with one contract.
  const rows = gibAssetRowsFromPrims([...g.prims, ...g.bones]);
  const inst = pool.acquire(g.part);
  pool.deformRows(inst, rows, g.origin);
  // THE DISPLAY GATE (2026-09-17). Finiteness alone cannot tell a torn piece
  // from a spike: the pre-fix cap-bound deform was finite and 4-5 m long. The
  // bounds are derived from the piece's RUNTIME ADDITIVE prims — the exact
  // geometry the deform read — so a vertex outside their union, or a triangle
  // spanning metres, is refused and this piece falls back to the marched path
  // with a counted reason. The pooled buffers are returned exactly once here;
  // nothing downstream has seen the mesh yet. NO clamping: a rogue vertex is
  // never repaired, the invalid piece is not displayed as an asset.
  const additiveWorld = [...g.prims, ...g.bones].filter(p => p.op !== 'sub');
  const bounds = checkGibAssetDeformBounds(piece.doc, piece.decoded, inst.positions, g.origin, additiveWorld);
  if (!gibAssetDeformBoundsOk(bounds)) {
    pool.release(inst);
    ctx.gibs.assetRuntime.countFallback(bounds.finite ? 'deform-bounds' : 'deform-nonfinite');
    return false;
  }
  // PER-INSTANCE FACE FRAME (task 4). The asset's stored `doc.face` is the
  // REST frame; what must be projected is the POSED/sloughed frame the actor
  // is drawing with right now — the same snapshot `spawnChunkPiece` takes from
  // `template.uniforms`. Localise the world centre against `g.origin` (the
  // chunk pivot) and let the resource ride the chunk's own transform through
  // flight, squash, settle and reset. `faceSupported` was checked above.
  let head: import('./gib-asset-head').GibAssetHeadResource | null = null;
  if (piece.doc.face && faceSupported) {
    const hc = faceUniforms.headCentre.value;
    const hq = faceUniforms.headQuat.value;
    const ax = faceUniforms.headAxes.value;
    head = ctx.gibs.assetRuntime.acquireHead(g.part, {
      centre: [hc.x - g.origin[0], hc.y - g.origin[1], hc.z - g.origin[2]],
      quat: [hq.x, hq.y, hq.z, hq.w],
      axes: [ax.x, ax.y, ax.z],
    }, faceUniforms);
    // No material = no face: fall back rather than draw a bare-flesh head.
    if (!head) { pool.release(inst); ctx.gibs.assetRuntime.countFallback('head-face'); return false; }
    head.setFrameFromState(state);
  }
  const sprite = spawnSpritePiece(ctx.vfx.spritePieces, {
    state, render: 'mesh', geometry: inst.geometry, material: head ? (head.material as THREE.Material) : lib.material,
    impulseDelay, impulseVel,
  });
  if (head) {
    const resource = head;
    sprite.onPose = () => resource.setFrameFromState(sprite.state);
  }
  // Return the per-instance buffers to the pool when this piece is retired
  // (evicted over a cap, cleared, or reset) — the pool's whole point. A head
  // also gives back its per-instance face material at the SAME single point.
  sprite.onDetach = () => { pool.release(inst); head?.release(); };
  sprite.mesh.name = `gib-asset-${g.part}`;
  ctx.gibs.assetRuntime.countAssetPiece();
  return true;
}

/**
 * THE SPRITE PATH'S TWIN OF `spawnChunkPiece` — one detached piece, as a
 * billboard instead of a marched view.
 *
 * The chunk-construction arithmetic is DELIBERATELY the same lines as above,
 * because the two modes must not disagree about a piece's physics: the same
 * `chunkExtent`/`boneChunkRadius` radius (so a piece settles at the same
 * height off the floor and collides with the same walls), the same
 * `primsLongAxis` (so it topples the same way), the same `makeChunk` seed
 * discipline, and the same `kind` (so a bone piece THUDS in both).
 *
 * The DIFFERENCE is everything that is absent: no `template` (no SDF uniforms,
 * no volume texture), no `ChunkGpuView`, no view budget, and no bake. What a
 * sprite piece needs from the body is its own geometry's EXTENT and its limb's
 * identity — nothing about how the body was marching.
 *
 * Returns false when there is no atlas to cut a frame from, which is the one
 * way this can decline; the caller falls back to the marched path rather than
 * dropping a body's gore.
 */
export function spawnSpriteGibPiece(ctx: GameContext, 
  piece: {
    limb: string; origin: Vec3; prims: Primitive[]; bones: Primitive[];
    kind?: 'limb' | 'gob' | 'bone';
    spinQuat?: Quat; spinAngVel?: Vec3;
  },
  impulseVel: Vec3 | null,
  impulseDelay: number,
): boolean {
  if (!ctx.gibs.atlas) return false;
  const rng = rngStreams.misc;
  const kind = piece.kind ?? 'limb';
  const boneOnly = piece.prims.length === 0 && piece.bones.length > 0;
  const extentSource = boneOnly ? piece.bones : piece.prims;
  const support = chunkSupportSpheres(extentSource, piece.origin);
  const state = makeChunk(
    piece.limb as never, piece.origin, [0, 0, 0],
    boneOnly ? boneChunkRadius(piece.bones) : chunkExtent(piece.prims, piece.origin),
    primsLongAxis(ctx, extentSource, piece.origin),
    rng, kind,
    (piece.spinQuat || piece.spinAngVel)
      ? { quat: piece.spinQuat, angVel: piece.spinAngVel }
      : undefined,
    support.length > 0 ? support : undefined,
  );
  spawnSpritePiece(ctx.vfx.spritePieces, {
    state, frame: pickFrame(ctx.gibs.atlas, rng()),
    impulseDelay, impulseVel, sizeScale: ctx.gibs.spriteSizeScale,
  });
  return true;
}
