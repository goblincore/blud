// src/lab/sdf-zombie/webgpu/game-bake-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import { type BakedChunkMaterial, createBakedChunkMaterial } from './baked-chunks';
import * as THREE from 'three/webgpu';
import { type ChunkLook } from '../chunk-bake-field';
import { chunkSettled } from '../gib-chunks';
import { BONE_VARIANTS, MEAT_VARIANTS } from '../gore-parts';
import { type Vec3 } from '../types';
import { unpackChunkBake } from './chunk-bake-buffers';
import { bonePartGeometry, meatPartGeometry } from './gore-part-geom';

/** Register a material instance to be lit by the frame's beam. Every
 *  `createBakedChunkMaterial` that is DRAWN must go through this — an
 *  unregistered instance is not merely dimmer, it is lit by a lamp that does
 *  not exist (see the block above). */
export function registerLitChunkMaterial<T extends BakedChunkMaterial>(ctx: GameContext, m: T): T {
  ctx.world.litChunkMaterials.push(m);
  return m;
}

/** WAIT FOR OUTSTANDING BAKE WORKERS (determinism, 2026-09-14). The gib
 *  swap is pinned to the frame after its submit and the corpse swap to the
 *  frame the reply arrives — both only if the reply HAS arrived. Two replays
 *  of the owner's 56 s recording diverged at one sample because one worker
 *  answered before a resolveGpu yield and the other after it. Every
 *  hand-stepped driver (replay, bench, scenario hash) awaits this before a
 *  step, so the reply is always in hand on the pinned frame. Live play never
 *  calls it. */
export async function awaitBakes(ctx: GameContext): Promise<void> {
  await ctx.bake.jobs.settled();
  if (ctx.world.soldierCorpses) await ctx.world.soldierCorpses.settled();
}

export function spawnGoreShowcase(ctx: GameContext): number {
  const look = ((): ChunkLook | null => {
    // The palette comes from a live actor's own view uniforms, so the parts
    // are painted with the same flesh the bodies in this level use.
    const a = ctx.world.actors[0];
    if (!a) return null;
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
  if (!look) return 0;
  if (!ctx.vfx.goreShowcase) {
    ctx.vfx.goreShowcase = new THREE.Group();
    ctx.vfx.goreShowcase.name = 'gore-showcase';
    ctx.boot.handle.scene.add(ctx.vfx.goreShowcase);
    ctx.boot.deferredApi?.router.register(ctx.vfx.goreShowcase, 'mesh', 'level-only');
  }
  for (const child of [...ctx.vfx.goreShowcase.children]) {
    ctx.vfx.goreShowcase.remove(child);
    const m = child as THREE.Mesh;
    m.geometry?.dispose();
  }
  // ITS OWN material instance WITH the procedural detail layer on: bump, blood
  // decals and organ gloss are opt-in per instance (`goreCfg.x`), so the baked
  // chunks keep exactly the shading they had while the parts get the per-pixel
  // detail the owner asked for ("no bumps or normal maps no stains no blood
  // decals"). Assigning it to `bakedChunkMat` instead would silently restyle
  // every settled piece at the same time, which is a decision to take on its
  // own evidence.
  if (!ctx.vfx.gorePartMat) {
    ctx.vfx.gorePartMat = registerLitChunkMaterial(ctx, createBakedChunkMaterial({ goreDetail: true }));
    ctx.vfx.gorePartMat.uniforms.goreCfg.value.set(
      ctx.vfx.gorePartDetail.x, ctx.vfx.gorePartDetail.y, ctx.vfx.gorePartDetail.z, ctx.vfx.gorePartDetail.w,
    );
    ctx.vfx.gorePartMat.uniforms.goreCfg2.value.set(
      ctx.vfx.gorePartStain.x, ctx.vfx.gorePartStain.y, ctx.vfx.gorePartStain.z, ctx.vfx.gorePartStain.w,
    );
  }
  const mat = ctx.vfx.gorePartMat;
  // A grid 2.4 m ahead, 0.42 m apart, at chest height, so a full set fills the
  // view without needing to walk around it.
  const fwd: Vec3 = [Math.sin(ctx.player.player.yaw), 0, -Math.cos(ctx.player.player.yaw)];
  const right: Vec3 = [Math.cos(ctx.player.player.yaw), 0, Math.sin(ctx.player.player.yaw)];
  const rows: { geo: ReturnType<typeof meatPartGeometry>; bone: boolean }[] = [];
  let seed = 1;
  for (const v of MEAT_VARIANTS) {
    for (const size of [0.075, 0.115]) {
      rows.push({ geo: meatPartGeometry(v, size, seed++, look), bone: false });
    }
  }
  for (const v of BONE_VARIANTS) {
    rows.push({ geo: bonePartGeometry(v, 0.075, seed++, look), bone: true });
    rows.push({ geo: bonePartGeometry(v, 0.115, seed++, look), bone: true });
  }
  const perRow = 6;
  rows.forEach((row, i) => {
    const col = i % perRow, line = Math.floor(i / perRow);
    const along = 1.6 + line * 0.55;
    const across = (col - (perRow - 1) / 2) * 0.34;
    const mesh = new THREE.Mesh(row.geo.geometry, mat.material);
    mesh.position.set(
      ctx.player.player.pos[0] + fwd[0] * along + right[0] * across,
      0.42 + (row.bone ? 0.05 : 0),
      ctx.player.player.pos[2] + fwd[2] * along + right[2] * across,
    );
    // A deterministic tumble per slot, so every face of every part is visible
    // from one spot instead of all of them axis-aligned.
    mesh.rotation.set((i * 0.7) % Math.PI, (i * 1.31) % (Math.PI * 2), (i * 0.43) % Math.PI);
    mesh.frustumCulled = true;
    ctx.vfx.goreShowcase!.add(mesh);
  });
  return rows.length;
}

/** Consume at most one completed mesh in a frame. All extraction, welding,
 * colour and normal work ran in the worker; only wrap buffers and swap here.
 * Recycled IDs are never reused, so an old reply cannot hide a new piece. */
export function finishChunkBake(ctx: GameContext): void {
  // FRAME PIN (determinism stage 1, 2026-09-14). The worker reply used to be
  // applied on whichever frame it happened to arrive, so a fast worker swapped
  // on the submit frame and a slow one a frame or two later — the swap is a
  // sim-state change (`liveChunks` -> `bakedChunks`) and the census and any
  // downstream pellet-vs-chunk interaction read it. Hold the result until the
  // first frame AFTER the one the job was submitted on, so a replay swaps at
  // the same frame regardless of worker speed. Do NOT call takeCompleted()
  // before this check: consuming here would drop the result and the piece
  // would never bake.
  if (ctx.bake.jobs.pendingId !== null && ctx.demo.simFrame < ctx.bake.submitFrame + 1) return;
  const done = ctx.bake.jobs.takeCompleted();
  if (!done) return;
  ctx.telemetry.telemetry.event('chunk-bake-complete', { chunk: done.id });
  const data = ctx.bake.input;
  ctx.bake.input = null;
  const index = ctx.bake.liveChunks.findIndex(c => c.id === done.id);
  if (!ctx.bake.enabled || index < 0 || !data) return;
  const entry = ctx.bake.liveChunks[index]!;
  if (!chunkSettled(entry.state)) return;
  const t0 = performance.now();
  const swapTiming = ctx.telemetry.telemetry.begin();
  const baked = unpackChunkBake(done.result);
  if (!ctx.bake.mat) {
    // REGISTERED, like the corpse path's identical construction a few thousand
    // lines up. It was not, and this is the site that WINS in normal play: the
    // corpse bake only runs if a soldier corpse settles first, so in a plain
    // dynamite gib THIS line created the shared baked-chunk material and left
    // it out of `litChunkMaterials`.
    //
    // The registry is not cosmetic. Everything the per-frame block pushes went
    // past this material: the FLASHLIGHT (so a settled piece kept the static
    // defaults — `spotCfg.x = 0`, beam OFF, against a fixed 2.4 directional
    // key, i.e. lit by a lamp that is not there at ~2.5x, which is what blows
    // flesh albedo pale) and, since this session, `fleshDetail`. The registry
    // exists BECAUSE of exactly this class of miss — its own docstring says
    // "the per-frame beam update touched ONLY bakedChunkMat" — and then the
    // settled-chunk path was left out of the fix.
    //
    // Caught by `__sdfGame.chunkDetailApplied()` reading `[]` while the census
    // reported 12 baked pieces on screen.
    ctx.bake.mat = registerLitChunkMaterial(ctx, createBakedChunkMaterial(
      // DEFERRED MODE: baked chunks are static flesh — level-only receivers
      // with a surface G-buffer producer material.
      // `bakedAo`: the settled bake writes a `bakeAo` attribute now, and
      // without reading it every piece shades at ao = 1.0 and can never be in
      // shadow — half of "way too light and dont follow the lighting".
      ctx.boot.deferredMode
        ? { output: 'surface', shadowReceiver: 'level-only', bakedAo: true }
        : { bakedAo: true, fleshResponse: true },
    ));
    ctx.bake.seed?.(ctx.bake.mat);
  }
  ctx.bake.liveChunks.splice(index, 1);
  // Face detail stays per-fragment at the source atlas resolution. A head
  // owns its projection snapshot/material; other chunks share the plain one.
  const faceMaterial = entry.view.uniforms.faceCfg.value.x > 0.5
    ? registerLitChunkMaterial(ctx, createBakedChunkMaterial({
      bakedAo: true, fleshResponse: true, face: entry.view.uniforms,
      ...(ctx.boot.deferredMode ? { output: 'surface' as const, shadowReceiver: 'level-only' as const } : {}),
    })) : undefined;
  if (faceMaterial) ctx.bake.seed?.(faceMaterial);
  const mesh = new THREE.Mesh(baked.geometry, (faceMaterial ?? ctx.bake.mat).material);
  mesh.frustumCulled = true; // it is a static bounded mesh — let three cull it
  ctx.boot.handle.scene.add(mesh);
  // DEFERRED MODE: the bake swaps the piece between producer routes —
  // marched proxy (SDF producer) -> static mesh (level-only G-buffer
  // producer). The proxy is only HIDDEN (its registration stays valid for
  // the recycle ring).
  ctx.boot.deferredApi?.router.register(mesh, 'mesh', 'level-only');
  entry.view.object.visible = ctx.bake.reference;
  mesh.visible = !ctx.bake.reference; // normally the proxy leaves the SDF passes
  ctx.bake.chunks.push({
    id: entry.id, mesh, view: entry.view, state: entry.state, faceMaterial,
    centre: baked.centre, radius: baked.radius, bakeMs: baked.bakeMs,
    template: entry.template,
  });
  ctx.bake.totalBakes++;
  ctx.bake.lastBakeMs = baked.bakeMs;
  ctx.bake.lastBakeInfo = {
    id: entry.id, verts: baked.verts, tris: baked.tris,
    bakeMs: baked.bakeMs, overflow: baked.overflow ? 1 : 0,
    droppedQuads: baked.droppedQuads,
    extent: data.extent, flesh: data.flesh.length, bones: data.bones.length,
    torn: data.torn.length, gore: data.gore,
    radius: baked.radius,
  };
  ctx.bake.lastSwapMs = performance.now() - t0;
  // The frame this swap landed on — a recorded number, so a replay can assert
  // the same landing frame (chunkStats().bakeSwapFrame).
  ctx.bake.lastSwapFrame = ctx.demo.simFrame;
  ctx.telemetry.telemetry.end('chunk-bake-swap', swapTiming);
  ctx.telemetry.telemetry.event('chunk-bake-swap', { chunk: entry.id, workerMs: baked.bakeMs, swapCpuMs: ctx.bake.lastSwapMs, vertices: baked.verts, triangles: baked.tris });
  if (baked.overflow || baked.droppedQuads > 0) {
    console.warn(`[chunk-bake] chunk ${entry.id}: overflow=${baked.overflow} droppedQuads=${baked.droppedQuads} — geometry holes`);
  }
}
