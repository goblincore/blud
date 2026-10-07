// src/lab/sdf-zombie/webgpu/game-chunk-pieces.ts
//
// Chunk gib pieces: creating, dressing and releasing a piece view, spawning a chunk piece, and gibbing chunk meat and baked pieces.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { spawnImpactGout } from '../blood-sim';
import { chunkExtent, chunkSupportSpheres } from '../extent';
import { FLESH_BITS, fleshEviction, fleshOverCap } from '../flesh-bits';
import { makeChunk, type Chunk } from '../gib-chunks';
import { boneChunkRadius } from '../melt-bones';
import { type Primitive, type Vec3 } from '../types';
import { type Quat } from '../vec';
import { BakedChunk, ChunkTemplate, cancelChunkBake, freeBaked } from './game-chunk-bake';
import { applyChunkKindLook, primsLongAxis } from './game-gib-spawn';
import { rngStreams } from './rng';
import { SDF_LAYER } from './sdf-layer';
import { createChunkGpuView, type ChunkGpuView, type MarchUniforms } from './zombie-gpu';


/** A slug/pellet INTO a baked piece: the piece GIBS. Fresh small chunks
 *  spawn at the impact (its own origin body's template, so the meat
 *  matches), a blood gout sprays, and the mesh is deleted. No reverse
 *  path — the design question settled for option 2 (simpler: no dual
 *  representation to keep in sync, and closer to the feel). */
export function gibBakedPiece(ctx: GameContext, b: BakedChunk, at: Vec3): void {
  ctx.telemetry.telemetry.event('baked-piece-hit', { chunk: b.id, world: [...at] });
  ctx.bake.spareViews.push(freeBaked(ctx, b));
  gibChunkMeat(ctx, b.template, at);
}

export function gibChunkMeat(ctx: GameContext, template: ChunkTemplate, at: Vec3): void {
  const rng = rngStreams.misc;
  const gobs = 2 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < gobs; i++) {
    const theta = rng() * Math.PI * 2;
    const spread = 0.01 + rng() * 0.02;
    const r = 0.016 + rng() * 0.02;
    const a: Vec3 = [at[0] + Math.cos(theta) * spread, at[1] + 0.005, at[2] + Math.sin(theta) * spread];
    const bEnd: Vec3 = [a[0] + (rng() - 0.5) * 0.04, a[1] + rng() * 0.03, a[2] + (rng() - 0.5) * 0.04];
    spawnChunkPiece(ctx, {
      limb: 'torso',
      origin: a,
      prims: [{
        limb: 'torso', cluster: 0, op: 'add', a, b: bEnd, radius: r,
        scale: [1, 1, 1], blendK: 0.008,
      } as unknown as Primitive],
      tornAt: [], bones: [],
    }, template);
  }
  if (ctx.vfx.bleedEnabled) {
    // One-shot gib gout: a fresh emitter stream so it never fuses with a
    // nearby wound's stream by proximity.
    spawnImpactGout(ctx.vfx.bloodSim, 'slug', at, [0, 1, 0], rngStreams.bleed, ctx.boot.nextEmitterStream++);
  }
}

/**
 * Spawn one detached piece. `kind` is the piece's MATERIAL AND PHYSICS, not a
 * label: 'bone' picks the CHUNK_TUNING thud (a ribcage that bounces like meat
 * is a rubber skeleton), the bone-only extent recipe, and — below — the two
 * per-view uniforms that make a bone chunk render at all.
 */
export function spawnChunkPiece(ctx: GameContext, 
  piece: {
    limb: string; origin: Vec3; prims: Primitive[]; tornAt: Vec3[];
    bones: Primitive[]; kind?: 'limb' | 'gob' | 'bone';
    /** Pre-release orientation + angular velocity (body-to-gib task 4). */
    spinQuat?: Quat; spinAngVel?: Vec3;
    /** Bounce overrides (Chunk.restitution / wallRestitution) and the snapped eye's tag (GorePiece). */
    restitution?: number; wallRestitution?: number; tag?: 'eye' | 'flesh';
  },
  template: { uniforms: import('./zombie-gpu').MarchUniforms; volumeTexture: THREE.Texture },
  initialVelocity?: Vec3,
) {
  // A FLESH BIT (flesh-bits.ts) draws its throwaway launch and tumble from its own stream, so flesh on or
  // off leaves rngStreams.misc — every other piece's sequence — untouched.
  const rng = piece.tag === 'flesh' ? ctx.gibs.fleshSpawnRng : rngStreams.misc;
  const vel: Vec3 = [
    (rng() - 0.5) * 4.5,
    2.5 + rng() * 2.5,
    (rng() - 0.5) * 4.5,
  ];
  const kind = piece.kind ?? 'limb';
  // A BONE-ONLY PIECE HAS NO FLESH TO MEASURE. `chunkExtent` over an empty
  // prim list is 0, which would size the proxy box at 5 cm and cull the very
  // ribcage it exists to draw; `boneChunkRadius` (melt-bones.ts) is the
  // resting radius and is shared with the melt's released groups, which is
  // also what keeps a released shin from coming to rest floating half its
  // length above the floor.
  const boneOnly = piece.prims.length === 0 && piece.bones.length > 0;
  const extentSource = boneOnly ? piece.bones : piece.prims;
  // NARROW-PHASE floor support (2026-09-16 task 3): the piece's own capsule
  // ends, so a flat shin rests on its thickness instead of hovering at its
  // half-length `chunkExtent`. Falls back to the old single radius when the
  // prims carry no usable geometry.
  const support = chunkSupportSpheres(extentSource, piece.origin);
  const state = makeChunk(
    piece.limb as never, piece.origin, initialVelocity ?? vel,
    boneOnly ? boneChunkRadius(piece.bones) : chunkExtent(piece.prims, piece.origin),
    primsLongAxis(ctx, extentSource, piece.origin),
    rng, kind,
    (piece.spinQuat || piece.spinAngVel)
      ? { quat: piece.spinQuat, angVel: piece.spinAngVel }
      : undefined,
    support.length > 0 ? support : undefined,
  );
  if (piece.restitution !== undefined) state.restitution = piece.restitution;
  if (piece.wallRestitution !== undefined) state.wallRestitution = piece.wallRestitution;
  const tag = piece.tag;
  // FLESH CAP (flesh-bits.ts): over FLESH_BITS.cap live flesh bits, the oldest one gives up its view.
  let recycled: ChunkGpuView | undefined;
  if (tag === 'flesh') {
    const at = fleshOverCap(ctx.bake.liveChunks, FLESH_BITS.cap);
    if (at >= 0) recycled = releaseLive(ctx, at);
  }
  // View budget. Order matters with the bake on: a BAKED piece is the
  // oldest, least-relevant gore, so its view recycles FIRST; only when
  // every view is live-and-flying does the old oldest-live rule apply.
  // Either way views stay bounded at `maxChunks` — the leak gate. It reads the
  // KNOB, not MAX_CHUNKS: the budget is raisable (?maxchunks) precisely
  // because a full-body gib is 19-20 pieces, and a gate here that still
  // recycled at the old constant would leave `cap: 24` reporting a pool that
  // is actually 12 — which is what the dynamite gate's census caught.
  recycled ??= ctx.bake.spareViews.pop();
  if (!recycled && ctx.bake.views.length >= ctx.bake.maxChunks) {
    // Live FLESH bits go first (flesh-bits.ts fleshEviction), then the oldest baked gib, then the oldest
    // other live piece; a snapped EYE is evicted last (the comic flight must play out).
    const ev = fleshEviction(ctx.bake.liveChunks, ctx.bake.chunks.length);
    if (ev?.from === 'baked') recycled = freeBaked(ctx, ctx.bake.chunks.shift()!);
    else if (ev) recycled = releaseLive(ctx, ev.index);
  }
  if (recycled) {
    recycled.reset(state, piece.prims,
      piece.tornAt.length ? piece.tornAt : undefined, piece.bones, template.uniforms);
    dressPieceView(ctx, recycled, kind, boneOnly);
    ctx.bake.liveChunks.push({ id: ctx.bake.nextId++, state, view: recycled, template, kind, boneOnly, ...(tag ? { tag } : {}) });
  } else {
    const view = createPieceView(ctx, state, piece.prims,
      piece.tornAt.length ? piece.tornAt : undefined, piece.bones, template, kind, boneOnly);
    ctx.bake.liveChunks.push({ id: ctx.bake.nextId++, state, view, template, kind, boneOnly, ...(tag ? { tag } : {}) });
  }
}

/** Take live piece `index` out of the physics (cancelling its bake): its view, for the caller to reuse. */
export function releaseLive(ctx: GameContext, index: number): ChunkGpuView | undefined {
  const c = ctx.bake.liveChunks.splice(index, 1)[0];
  if (!c) return undefined;
  if (ctx.bake.jobs.pendingId === c.id) cancelChunkBake(ctx);
  return c.view;
}

/** The per-spawn look of a piece view, fresh or recycled. */
export function dressPieceView(ctx: GameContext, view: ChunkGpuView, kind: 'limb' | 'gob' | 'bone', boneOnly: boolean): void {
  // A bone-only chunk needs its bone ROWS packed whatever the bone-tube
  // mode is: with packBones off (the `?boneMesh` path) `reset` writes
  // organ rows only, so a chunk whose flesh list is empty packs NOTHING and
  // marches an empty field — an invisible skeleton, which is the exact
  // failure this whole piece set exists to end.
  view.setPackBones(boneOnly ? !ctx.gibs.boneMesh : !ctx.render.boneMesh);
  applyChunkKindLook(ctx, view, kind);
  // May be arriving from a baked retirement; and a bone piece spawned while
  // the differential hides the skeleton must stay hidden.
  // With `gibBoneMesh` the tubes draw this piece and its packed rows are
  // gone, so the marched proxy has an EMPTY field: it would march and
  // discard every pixel of its box for nothing. Hidden, not merely empty.
  view.object.visible = !ctx.bake.hidden
    && (kind !== 'bone' || (ctx.render.bonesVisible && !(boneOnly && ctx.gibs.boneMesh)));
}

/** A NEW pooled piece view: created on the shared material (throws when its
 *  slots are full), dressed, added to the scene and the deferred router, and
 *  counted in `ctx.bake.views`. */
export function createPieceView(ctx: GameContext, 
  state: Chunk, prims: Primitive[], tornAt: Vec3[] | undefined, bones: Primitive[],
  template: { uniforms: import('./zombie-gpu').MarchUniforms; volumeTexture: THREE.Texture },
  kind: 'limb' | 'gob' | 'bone', boneOnly: boolean,
): ChunkGpuView {
  const view = createChunkGpuView(
    state, prims, template.uniforms, tornAt,
    template.volumeTexture, ctx.bake.material, bones,
    // Matching options with the shared material (task-2 contract: with a
    // shared material the material's mode wins; the view must agree).
    ctx.boot.deferredMode ? { output: 'surface', shadowReceiver: 'level-only' } : undefined,
  );
  dressPieceView(ctx, view, kind, boneOnly);
  view.object.layers.set(SDF_LAYER);
  ctx.boot.handle.scene.add(view.object);
  ctx.boot.deferredApi?.router.register(view.object, 'sdf');
  ctx.bake.views.push(view);
  return view;
}
