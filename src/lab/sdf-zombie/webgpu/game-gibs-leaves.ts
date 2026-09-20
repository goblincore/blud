// src/lab/sdf-zombie/webgpu/game-gibs-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import { gibTierPlan } from '../gib-parts';
import { type Primitive, type Vec3 } from '../types';
import { type ZombieActor } from './game-actor';
import { type ChunkGpuView } from './zombie-gpu';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import { DEFAULT_BUILD_OPTS, buildBody } from '../build-body';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { type ChunkLook } from '../chunk-bake-field';
import { createBakedChunkMaterial } from './baked-chunks';
import { registerLitChunkMaterial } from './game-bake-leaves';
import { carveBodyIntoPieces, type CarvedPiece } from './gib-carve';
import { makeChunk } from '../gib-chunks';
import { spawnSpritePiece } from './gib-sprite-pieces';
import { rngStreams } from './rng';
import { loadGibSheet, loadGibSpriteAtlas } from './gib-sprites';

/** The archetype whose committed set an actor uses. */
export function gibAssetArchetypeOf(ctx: GameContext, a: ZombieActor): string {
  return a.kind === 'soldier' ? 'soldier' : 'zombie';
}

/** Kick off (or join) the load for the archetypes the assets path can use. */
export function ensureGibAssets(ctx: GameContext): Promise<unknown> {
  return Promise.all([
    ctx.gibs.assetRuntime.ensure('zombie'),
    ctx.gibs.assetRuntime.ensure('soldier'),
  ]);
}

/** True once at least one archetype's committed set is loaded and usable. */
export function gibAssetArmed(ctx: GameContext): boolean {
  return ctx.gibs.assetRuntime.archetypeState('zombie') === 'ready'
    || ctx.gibs.assetRuntime.archetypeState('soldier') === 'ready';
}

/**
 * The two per-view uniforms a chunk's KIND decides, written on EVERY spawn.
 *
 * MEAT AND BONE DO NOT SHADE ALIKE. march.wgsl.ts's pale-bone branch only
 * runs while `meltCfg.x > 0` (it was written for the melt, where the skeleton
 * emerges from thinning flesh), and the chunk view's own torn-meat gore mask
 * and face projection are decided in `reset` from whether the FLESH list is
 * empty. A released ribcage left at meltCfg.x = 0 marches, folds and shades
 * as a meat-coloured cage — the shape would finally be there and still not
 * read as bone, which is half of what the owner asked for.
 *
 * BOTH ARE WRITTEN FOR EVERY KIND, not just for bone. Chunk views are
 * RECYCLED at the maxChunks cap, so a view that was a ribcage last blast
 * keeps meltCfg.x = 1 into its next life as an arm — and a flesh piece
 * rendered through the melt ramp is a pale, matte, wrong-coloured limb. The
 * lab's spawnChunk has carried the same "every spawn, not just bone ones"
 * comment since the melt shipped; this is that rule, not a new one.
 */
export function applyChunkKindLook(ctx: GameContext, view: ChunkGpuView, kind: 'limb' | 'gob' | 'bone'): void {
  view.uniforms.meltCfg.value.x = kind === 'bone' ? 1 : 0;
}

export function primsLongAxis(ctx: GameContext, prims: Primitive[], origin: Vec3): Vec3 {
  let best: Vec3 = [0, 1, 0];
  let bestLen = 0;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l > bestLen) { bestLen = l; best = d; }
  }
  return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
}

/**
 * Apply every impulse whose delay has run out. A piece whose chunk was
 * recycled out of the pool in the meantime is simply gone — the queue is
 * keyed by chunk id, and ids are never reused.
 *
 * THE DELAY COUNTS DRAINS, NOT FRAMES, and that is deliberate. This drain
 * runs LATER IN THE SAME TICK as the detonation that spawned the pieces
 * (stepDynamite is before the chunk step in `tick`), so a frame-indexed
 * queue either releases the first wave before the first frame is drawn — the
 * explosion's opening frame shows pieces already moving, which is the
 * substitution the staging exists to prevent — or needs an off-by-one
 * "+2" that silently breaks the day someone reorders the tick. Counting
 * drains, a delay of 0 still means "not in the tick the blast happened in",
 * because the drain that could have fired it has already run and decremented.
 */
export function stepPendingGibImpulses(ctx: GameContext): void {
  for (let i = ctx.gibs.pendingGibImpulses.length - 1; i >= 0; i--) {
    const p = ctx.gibs.pendingGibImpulses[i]!;
    if (p.delay > 0) { p.delay--; continue; }
    const c = ctx.bake.liveChunks.find(q => q.id === p.id);
    if (c) c.state.vel = [p.vel[0], p.vel[1], p.vel[2]];
    ctx.gibs.pendingGibImpulses.splice(i, 1);
  }
}

/** Give the hand a bundle again once the throw has RECOVERED.
 *
 *  `cook.phase` must be 'idle', not merely "not cooking": fpv.ts spends
 *  throwRecoverSec (0.4 s) in 'cooldown' after every release, and that beat is
 *  the throw animation — handing the player the next bundle the instant the
 *  last one leaves would put a bundle back in a hand that is still visibly
 *  mid-throw. An overcook returns straight to 'idle', so the replacement is
 *  immediate there, which is right: nothing was thrown. */
export function reacquireHeldProp(ctx: GameContext): void {
  if (ctx.weapon.heldProp || !ctx.bake.bundleReady) return;
  if (ctx.vfx.cook.phase !== 'idle') return;
  const p = ctx.bake.spareBundles.pop() ?? (() => {
    const oldest = ctx.bake.liveBundles.find(b => b.prop);
    if (!oldest || !oldest.prop) return null;
    const q = oldest.prop;
    oldest.prop = null;
    return q;
  })();
  if (!p) return;
  p.object.removeFromParent();
  ctx.bake.bundleRig.add(p.object);
  // RESET THE LOCAL TRANSFORM, and this is the whole bug (owner report
  // 2026-09-10: "after like the first 2 throws i dont see the dynamite").
  //
  // `pose({ mode: 'flight' })` writes the bundle's WORLD position and its
  // tumble quaternion onto the object. Reparenting that object into the rig
  // does not undo any of it, so a re-acquired bundle stayed exactly where it
  // detonated — measured, `local [28.235, 0.097, -12.354]` in a rig that sits
  // 0.42 m in front of the eye. Drawn metres off-screen: the player was
  // holding a bundle they could not see, and the first two throws looked fine
  // only because the first re-acquire happened to draw a prop that had never
  // flown.
  //
  // The rig carries the hold pose (BUNDLE_HOLD), so the prop's own local
  // transform must be the identity. One owner for the hold transform.
  p.object.position.set(0, 0, 0);
  p.object.quaternion.identity();
  p.object.scale.setScalar(1);
  p.object.visible = true;
  ctx.weapon.heldProp = p;
}

// THE DETONATION — one blast, everything it does.
// -----------------------------------------------------------------------
/** Per-phase timings of the LAST detonation, ms. The blast is one frame of
 *  work with four very different costs in it, and "the explosion pauses the
 *  game" is not actionable until the split is known. */
export function newBlastProfile(ctx: GameContext) {
  return { resolve: 0, gib: 0, wound: 0, blood: 0, chunksSpawned: 0, bodies: 0, total: 0 };
}

/**
 * SCHEDULE A GIB — the pre-tear window's entry point (dev-note §3c).
 *
 * With `?gibtear=0` this IS the old path: the body becomes pieces in the frame
 * the bundle goes off. With a window, the body is BENT by the shockwave for
 * `gibTearSec` first and the pieces are spawned when the window closes, which
 * is the owner's own description of what the transition should do — "the SDF
 * flesh ... distort the flesh from the shockwave and jiggle and then rip
 * away".
 *
 * A body already in the window is NOT scheduled twice: a second bundle landing
 * on a doomed body inside 0.1 s finds it mid-tear and leaves it alone, which
 * is also what keeps the piece census honest (one body, one gib).
 */
export function scheduleGib(ctx: GameContext, 
  a: ZombieActor, at: Vec3, falloff: number, allowance: number,
): ReturnType<typeof gibTierPlan> | null {
  if (ctx.gibs.tearSec <= 0) return null; // caller gibs immediately
  if (a.tearing() || ctx.gibs.pendingGibs.some(q => q.actor === a)) return null;
  a.setTearTuning({ sec: ctx.gibs.tearSec, ...ctx.vfx.tearShape });
  // THE PLAN IS PREPARED ONCE, from the clean posed body, and reused for the
  // whole visualization AND the release. `gibParts` would re-derive it at
  // release from a body the rupture has already moved; the plan's own region
  // offsets are what the chunks are spawned with instead (spawnScheduledGibs).
  //
  // THE TIER IS CHOSEN HERE, not at release (task 3). `gibTierPlan` runs the
  // same ladder `gibActor` would, against the allowance this body is handed,
  // and the wiring locks `gibActor` to the result — so a tight pool previews
  // the cheap shape it will actually spawn instead of the full partition.
  // `?gib=pieces` is the one shape with no source indices yet; it keeps the
  // old preview-then-spawn route (see RESULTS.md Task 3 limits).
  const mode = ctx.gibs.mode === 'clusters' ? 'clusters' : 'parts';
  const planned = gibTierPlan(a.posed(), allowance, { bones: ctx.gibs.bones, mode, at });
  a.beginTear(at, falloff, planned.plan);
  ctx.gibs.pendingGibs.push({
    actor: a, at: [at[0], at[1], at[2]], falloff, plan: planned.plan,
    tier: planned.tier, reserve: planned.reserve,
  });
  return planned;
}

/** Take a gibbed actor out of the world: hidden from every pass, out of the
 *  router, out of the roster. The view is retained — see gibActor. */
export function retireActor(ctx: GameContext, a: ZombieActor): void {
  // A burning body leaving the world: burn-down mark + card release.
  ctx.vfx.burning.retire(a);
  // Equipment is a scene sibling of the flesh proxies, not their child.
  // This actor stops ticking here, so its attachments must retire too.
  a.character?.retireEquipment();
  const pi = ctx.gibs.pendingGibs.findIndex(q => q.actor === a);
  if (pi >= 0) ctx.gibs.pendingGibs.splice(pi, 1);
  a.view.object.visible = false;
  a.view.coneObject.visible = false;
  ctx.boot.deferredApi?.router.unregister(a.view.object);
  ctx.boot.deferredApi?.router.unregister(a.view.coneObject);
  a.view.object.removeFromParent();
  a.view.coneObject.removeFromParent();
  const i = ctx.world.actors.indexOf(a);
  if (i >= 0) ctx.world.actors.splice(i, 1);
}

export function ensureCarvedLibrary(ctx: GameContext): boolean {
  if (ctx.bake.carvedLibrary && ctx.bake.carvedMaterial) return true;
  if (ctx.bake.carvedLibrary) return true;
  const a = ctx.world.actors[0];
  if (!a) return false;
  try {
    const look: ChunkLook = (() => {
      const u = a.view.uniforms;
      const col = (v: { r: number; g: number; b: number }): Vec3 => [v.r, v.g, v.b];
      return {
        baseColor: col(u.baseColor.value), deepColor: col(u.deepColor.value),
        fatColor: col(u.fatColor.value), mottleColor: col(u.mottleColor.value),
        organColor: col(u.organColor.value), visceraColor: col(u.visceraColor.value),
        woundDepthAmp: u.surfCfg3.value.x, fatDepth: u.surfCfg3.value.y,
        muscleDepth: u.surfCfg3.value.z, visceraAmp: u.surfCfg3.value.w,
        visceraDepth: u.visceraDepth.value, mottleAmp: u.surfCfg2.value.z,
        mottleScale: u.surfCfg2.value.w, organAmp: u.organAmp.value, goreStrength: 1,
      };
    })();
    const t0 = performance.now();
    const body = buildBody(compileBlob(parseBlob(zombieBlobSrc)), DEFAULT_BUILD_OPTS, {});
    ctx.bake.carvedLibrary = carveBodyIntoPieces({
      archetype: 'zombie', body, look,
      cells: ctx.gibs.carveCells, cellSize: ctx.gibs.carveCellSize,
    });
    ctx.bake.carvedBuildMs = performance.now() - t0;
    if (!ctx.bake.carvedMaterial) {
      ctx.bake.carvedMaterial = registerLitChunkMaterial(ctx, createBakedChunkMaterial({ goreDetail: true, bakedAo: true }));
      ctx.bake.carvedMaterial.uniforms.goreCfg.value.set(
        ctx.vfx.gorePartDetail.x, ctx.vfx.gorePartDetail.y, ctx.vfx.gorePartDetail.z, ctx.vfx.gorePartDetail.w,
      );
      ctx.bake.carvedMaterial.uniforms.goreCfg2.value.set(
        ctx.vfx.gorePartStain.x, ctx.vfx.gorePartStain.y, ctx.vfx.gorePartStain.z, ctx.vfx.gorePartStain.w,
      );
    }
    console.log(`[gib-carve] zombie library: ${ctx.bake.carvedLibrary.pieces.length} pieces, `
      + `${ctx.bake.carvedLibrary.totalVerts} verts, ${ctx.bake.carvedLibrary.bonePrims} bone prims in the field, `
      + `${ctx.bake.carvedBuildMs.toFixed(0)} ms (cells ${ctx.gibs.carveCells})`);
    return true;
  } catch (err) {
    ctx.bake.carvedLibrary = null;
    if (!ctx.bake.carvedWarned) {
      ctx.bake.carvedWarned = true;
      console.warn(`[gib-carve] library build failed: ${String(err)} — `
        + 'falling back to marched pieces for this session');
    }
    return false;
  }
}

/**
 * Spawn one carved mesh piece. The geometry is SHARED from the library and the
 * material is the library's own instance, so a spawn allocates nothing but the
 * Mesh and its `Chunk` state — which is why "bake at spawn" costs nothing once
 * the library exists.
 */
export function spawnCarvedPiece(ctx: GameContext, 
  piece: CarvedPiece, origin: Vec3, kind: 'limb' | 'gob' | 'bone',
  impulseVel: Vec3 | null, impulseDelay: number,
): boolean {
  if (!ensureCarvedLibrary(ctx) || !ctx.bake.carvedMaterial) return false;
  const rng = rngStreams.misc;
  const state = makeChunk(
    piece.limb as never, origin, [0, 0, 0], piece.radius,
    piece.longAxis as never, rng, kind,
  );
  spawnSpritePiece(ctx.vfx.spritePieces, {
    state,
    impulseDelay, impulseVel,
    render: 'mesh', geometry: piece.geometry, material: ctx.bake.carvedMaterial.material,
  });
  return true;
}

export const GIB_ATLAS_URL = '/assets/gibs-placeholder/manifest.json';
/** The GENERATED sheet: own render, own resolution, committable. */
export const GIB_SHEET_URL = '/assets/lab/gore/manifest.json';

/** Load the dev-only atlas on demand. A missing one is reported, not hidden:
 *  the bench is meaningless without it and a silent empty group reads as a bug
 *  in the renderer. */
export async function ensureGibAtlas(ctx: GameContext, which: 'placeholder' | 'sheet' = ctx.gibs.atlasSource): Promise<number> {
  if (ctx.gibs.atlas && ctx.gibs.atlasSource === which) return ctx.gibs.atlas.frames.length;
  ctx.gibs.atlas?.dispose();
  ctx.gibs.atlas = null;
  ctx.gibs.atlasSource = which;
  const url = which === 'sheet' ? GIB_SHEET_URL : GIB_ATLAS_URL;
  try {
    ctx.gibs.atlas = which === 'sheet' ? await loadGibSheet(url) : await loadGibSpriteAtlas(url);
    console.log(`[gib-sprites] ${which} atlas: ${ctx.gibs.atlas.frames.length} frames from ${url}`);
  } catch (err) {
    console.warn(`[gib-sprites] no ${which} atlas at ${url}`
      + (which === 'placeholder'
        ? ' — run scripts/link-dev-assets.sh (the Blood extracts are dev-only placeholders)'
        : ' — generate it with: npm run blob:shot -- zombie (BLOB_MASK=1) then node scripts/gib-sheet.mjs')
      + `: ${String(err)}`);
    return 0;
  }
  return ctx.gibs.atlas.frames.length;
}

/** The cheapest tier's piece count — one chunk per limb cluster, i.e. the
 *  shape a body falls back to when the pool cannot afford anything better.
 *  Held back for every body still to come in a blast, so no body is left with
 *  less than this and none of them simply disappears. */
// 7, ONE CHUNK PER LIMB PLUS THE RIBCAGE — see the ladder's `clusters+cage`
// rung. Not 6: a reserve of 6 lets a crowded blast spend every body's slots on
// the shape whose bones are BURIED, and measured in the arena a point-blank
// bundle gibs five bodies, so that is not an edge case — it is what the owner
// sees in the room he tests in. Measured after the change, below.
export const GIB_TIER_FLOOR = 7;

/**
 * THE POOL A BLAST ALLOCATES FROM, per render mode.
 *
 * The marched path's budget is the view pool's free slots PLUS whatever older
 * gore can be recycled — see the long note at its call site. The sprite path
 * has no view pool to divide: a quad has no proxy box and no bake, so the only
 * thing left worth bounding is the COUNT, and the count is its own cap. Note
 * what this means for the owner's "tubes and orbs" report: a body only ever
 * degraded because the marched pool could not afford its full set, so in
 * sprite mode the ladder below has nothing to react to and never fires.
 * RESTING pieces do not count against it either — they have already left the
 * live list (`stepSpritePieces` parks them), so a pile of old gore on the
 * floor never eats a new blast's budget.
 */
export function gibBudget(ctx: GameContext) {
  return (ctx.gibs.renderMode !== 'march'
  ? ctx.gibs.spriteLiveCap
  : Math.max(1, ctx.bake.liveChunks.length + Math.max(0, ctx.bake.maxChunks - ctx.bake.views.length) - gibReserved(ctx)));
}

/**
 * SLOTS A PENDING RUPTURE IS HOLDING (body-to-gib task 3). The tier is chosen
 * when the body is SCHEDULED, and `gibActor` is locked to that plan at
 * release, so the views it will need must not be spent by a later blast in
 * the meantime. Counting them out of `gibBudget()` makes a second blast (or
 * an immediate `gibtear=0` gib) budget around them, which is what keeps the
 * preview and the release the same shape without raising any cap. The slot is
 * freed when the body is spliced out of `pendingGibs` at release.
 */
export function gibReserved(ctx: GameContext) {
  let n = 0;
  for (const q of ctx.gibs.pendingGibs) n += q.reserve;
  return n;
}

/** What one body may take this blast. Identical in both modes EXCEPT that the
 *  sprite path reserves no tier floor: the floor exists to guarantee every
 *  body in a blast can afford the cheapest SHAPE, and sprite mode has no
 *  shapes to choose between.
 *
 *  CLAMPED TO `remaining` (2026-09-16 task 2, adversarial caps). The floor is
 *  the cheapest shape's slot count, but it is a RESERVATION, not extra
 *  capacity: at `?maxchunks=5` the old `max(floor, remaining - reserve)`
 *  handed a body 7 slots from a 5-slot pool, so the recycler overwrote two of
 *  its own pieces inside the same call — the "pieces jumping into positions"
 *  defect the budget exists to prevent. A body can now never be allowed more
 *  than the pool actually holds. */
export function gibAllowance(ctx: GameContext, remaining: number, condemnedLeft: number) {
  return (ctx.gibs.renderMode !== 'march'
  ? Math.max(1, remaining)
  : Math.max(1, Math.min(remaining,
    Math.max(GIB_TIER_FLOOR, remaining - GIB_TIER_FLOOR * Math.max(0, condemnedLeft - 1)))));
}

/** And what that body actually spent. The marched path debits at least a
 *  floor's worth whatever it made, because the floor's slots are reserved for
 *  it either way; sprite mode debits exactly what it made. */
export function gibDebit(ctx: GameContext, remaining: number, made: number) {
  return (ctx.gibs.renderMode !== 'march'
  ? Math.max(0, remaining - made)
  : Math.max(0, remaining - Math.max(made, GIB_TIER_FLOOR)));
}
