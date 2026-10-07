// src/lab/sdf-zombie/webgpu/game-skeleton-actors.ts
//
// An actor's skeleton resources: bone field sources, the shared volume atlas (acquire, release), binding and release.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { type ZombieActor } from './game-actor';
import { createSkeletonSources, type BoneFieldSource } from './skeleton-spike/contract';
import { boneSegmentKeyMap, buildSegmentAtlas } from './skeleton-spike/volume';
import { SegmentVolumeBinding, createSegmentAtlasTexture } from './skeleton-spike/volume-gpu';


/** Contract recipe (fixture-contract.md): sources bind against the
 *  actor's CURRENT body + bound rig and follow the live rig/yaw through
 *  accessors. Called at spawn (rig at rest) and on sever re-derive
 *  (body reference change — mid-pose re-bind is a documented prototype
 *  approximation for limb local frames, re-measured in task 4). */
export function buildSkeletonSources(ctx: GameContext, actor: ZombieActor, name: string) {
  return ({
  body: actor.body,
  name,
  sources: createSkeletonSources(actor.body, actor.boundRig(), {
    character: name,
    rig: () => actor.boundRig().rig,
    bodyYaw: () => actor.pose().yaw,
    // Always built: the organ MODE decides whether they are drawn and whether the rows are packed, so a live
    // flip needs no rebuild (game-render-controls.ts applyOrganMode).
    organs: true,
  }),
});
}

export function acquireVolumeAtlas(ctx: GameContext, actor: ZombieActor, sources: readonly BoneFieldSource[]) {
  const key = sources.map(source => source.revision).sort().join('|');
  let shared = ctx.render.sharedVolumeAtlases.get(key);
  if (!shared) {
    const segIds = boneSegmentKeyMap(actor.body, actor.boundRig());
    const atlas = buildSegmentAtlas(sources.flatMap(source => {
      const segId = segIds.get(source.segment);
      return segId === undefined ? [] : [{ segId, grid: ctx.render.segVolumeCache!.get(source) }];
    }));
    shared = Object.assign(atlas, { texture: createSegmentAtlasTexture(atlas), refs: 0 });
    ctx.render.sharedVolumeAtlases.set(key, shared);
    ctx.telemetry.volumeAtlasBuilds++;
  }
  shared.refs++;
  return { key, shared };
}

export function releaseVolumeAtlas(ctx: GameContext, key: string) {
  const shared = ctx.render.sharedVolumeAtlases.get(key);
  if (!shared || --shared.refs > 0) return;
  shared.texture.dispose();
  for (const meta of shared.metas) ctx.render.segVolumeCache?.evict(meta.grid);
  ctx.render.sharedVolumeAtlases.delete(key);
}

export function bindSkeletonVolume(ctx: GameContext, actor: ZombieActor, name: string) {
  const prior = ctx.render.skeletonVolumes.get(actor);
  if (prior) { prior.binding.dispose(); releaseVolumeAtlas(ctx, prior.key); }
  const state = buildSkeletonSources(ctx, actor, name);
  const { key, shared } = acquireVolumeAtlas(ctx, actor, state.sources);
  const binding = new SegmentVolumeBinding(shared, shared.texture, state.sources);
  actor.view.setSkeletonVolume(shared.texture, binding.metaTexture);
  const crowd = actor.crowd;
  if (crowd) {
    // Per-instance segVolumeMeta is a stage-a gap: ONE meta per type means
    // only the first instance's pose can drive 'segment' bone culling. The
    // honest fallback for the rest is 'cluster', which needs no per-instance
    // pose. The type binds the FIRST attached actor's shared atlas/meta (and
    // re-binds it when that actor's own revision changes); a later actor's
    // bind is ignored — its own view still holds the right pair.
    actor.view.setBoneCullMode('cluster');
    if (ctx.crowd.sourceView.get(crowd.type) === actor.view || !ctx.crowd.volumeBound.has(crowd.type)) {
      crowd.type.setSkeletonVolume(shared.texture, binding.metaTexture);
      ctx.crowd.volumeBound.add(crowd.type);
      if (!ctx.crowd.segMetaWarned) {
        ctx.crowd.segMetaWarned = true;
        console.warn('[crowd] segVolumeMeta is per-type from the first attached actor; '
          + 'other instances fall back to cluster bone culling (stage-a gap)');
      }
    }
  } else {
    actor.view.setBoneCullMode('segment');
  }
  // Analytic primitive gradients cannot represent a sampled field.
  actor.view.uniforms.normalGradientCfg.value.x = 0;
  ctx.render.skeletonVolumes.set(actor, { ...state, key, binding });
}

export function releaseSkeletonActor(ctx: GameContext, actor: ZombieActor) {
  actor.crowd?.type.detach(actor.crowd.slot);
  ctx.render.skeletonSources.delete(actor);
  const volume = ctx.render.skeletonVolumes.get(actor);
  if (!volume) return;
  volume.binding.dispose();
  releaseVolumeAtlas(ctx, volume.key);
  ctx.render.skeletonVolumes.delete(actor);
}
