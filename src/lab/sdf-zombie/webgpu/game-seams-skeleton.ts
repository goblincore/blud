// src/lab/sdf-zombie/webgpu/game-seams-skeleton.ts
//
// Skeleton=mesh / bone-tube evidence seams: the bone-mesh switch, the
// body-build cache census, which skeleton path is live, the bone-tube
// diagnostics and the mesh-path hit fixtures. Members moved VERBATIM out
// of game-seams-leftover.ts (leaves wave 1's ctx-only bucket,
// 2026-09-20 split; see the 2026-09-20-seams-leftover-split notes).
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import type { GameContext } from './game-context';
import { type Vec3 } from '../types';
import { bodyBuildCacheStats } from './character-view';
import { applyBoneMesh } from './game-render-leaves';
import { traceProjectile } from './game-weapon';
import { sdBody } from '../validate';

export function createSkeletonSeams(ctx: GameContext) {
  return {
    /** Bone tubes (2026-09-02-bone-tubes, task 5): OFF ships as the field's
     *  bones; ON draws every posed bone as an instanced polygonal tube and
     *  flips every view's packBones off so the field drops its bone rows. */
    setBoneMesh: (on: boolean) => applyBoneMesh(ctx, on),
    /** skeleton=mesh diagnostics: null unless the dev selector resolved;
     *  otherwise the renderer's coverage stats — proof the intended path
     *  ran (segments/verts > 0) and extraction health flags. */
    /** Deterministic actual-hit fixture: front-centre skull slug, same eye
     * event and actor damage path as travelling projectiles. */
    hitMeshSkull: (bodyId?: number) => {
      const a = bodyId === undefined ? ctx.world.actors[0] : ctx.world.actors.find(q => q.id === bodyId);
      if (!a || !ctx.render.segMeshRenderer) return null;
      const sources = ctx.render.skeletonSources.get(a)?.sources;
      const head = sources?.find(s => s.segment === 'head' && s.isLive());
      if (!sources || !head) return null;
      const b = head.bounds, x=(b.min[0]+b.max[0])/2, y=b.min[1]+(b.max[1]-b.min[1])*.61;
      // Resolve the posed FLESH surface, not the buried bone bound. Wound depth
      // probing assumes its anchor starts on skin.
      const start=head.toWorld([x,y,b.max[2]+.20]), end=head.toWorld([x,y,b.min[2]]);
      const point=traceProjectile(start,end,p=>sdBody(p,a.posed()));
      if(!point)return null;
      const dl=Math.hypot(end[0]-start[0],end[1]-start[1],end[2]-start[2])||1;
      const direction:Vec3=[(end[0]-start[0])/dl,(end[1]-start[1])/dl,(end[2]-start[2])/dl];
      const ejected = ctx.render.segMeshRenderer.impact(a, sources, point, direction, 'slug');
      a.beginHits(); const wound = a.hitSlug(point, direction); a.endHits();
      return { actor: a.id, point, ejected, stamped: !!wound };
    },
    meshEyeState: (bodyId?: number) => { const a = bodyId === undefined ? ctx.world.actors[0] : ctx.world.actors.find(q => q.id === bodyId); return a && ctx.render.segMeshRenderer ? ctx.render.segMeshRenderer.eyeState(a) : null; },
    /** Cold-start task 1: how many per-character body builds the memo actually
     *  ran (vs served from cache) and their cumulative CPU time. */
    bodyBuild: () => ({ ...bodyBuildCacheStats() }),
    /** Synchronous active-path proof for capture harnesses. */
    skeletonDiagnostics: () => ({
      requestedMode: ctx.render.skeletonMode,
      activeMode: ctx.render.skeletonMode === 'volume'
        ? (ctx.render.skeletonVolumes.size > 0 ? 'volume' : 'procedural')
        : ctx.render.skeletonMode === 'mesh'
          ? (ctx.render.segMeshRenderer && ctx.render.segMeshRenderer.stats.segments > 0 ? 'mesh' : 'procedural')
          : 'procedural',
      volume: ctx.render.segVolumeCache ? {
        actors: ctx.render.skeletonVolumes.size,
        grids: ctx.render.segVolumeCache.stats().grids,
        gridBytes: ctx.render.segVolumeCache.stats().bytes,
        atlases: ctx.render.sharedVolumeAtlases.size,
        atlasBytes: [...ctx.render.sharedVolumeAtlases.values()].reduce((sum, atlas) => sum + atlas.bytes, 0),
        bakeMs: [...ctx.render.sharedVolumeAtlases.values()].reduce((sum, atlas) => sum + atlas.totalBakeMs, 0),
        atlasBuilds: ctx.telemetry.volumeAtlasBuilds,
      } : null,
    }),
    boneTubes: () => ({
      count: ctx.render.boneInstancer.count,
      overflowed: ctx.render.boneInstancer.overflowed,
      /** WHICH PATHS FEED THE TUBES, and whether the object is drawn at all.
       *  With `gibBoneMesh` a bone gib packs no field rows and its marched proxy
       *  is hidden, so the instancer is the ONLY thing drawing it — and from the
       *  chunk census (which counts marched ROWS) "the skeleton is drawn as
       *  tubes" and "the skeleton silently vanished" are indistinguishable.
       *  These three make them distinguishable. */
      gibBoneMesh: ctx.gibs.boneMesh, bodyBoneMesh: ctx.render.boneMesh, visible: ctx.render.boneInstancer.object.visible,
      /** TASK-6 DIAGNOSTIC (bounded): world endpoints (a, b) of up to 8
       *  posed bone prims — the SAME prim data boneInstancer.update() packs
       *  this frame — so the gate can anchor its tube-texel scan to real
       *  tube geometry instead of a blind screen lattice (visible tube
       *  pixels are 1-2px silhouette slivers that a fixed lattice misses
       *  whenever the frozen gait phase shifts). Never mutates state. */
      tips: (() => {
        const out: number[][] = [];
        for (const a of ctx.world.actors) {
          const prims = a.posed().bonePrims ?? [];
          for (const p of prims) {
            if (p.op !== 'bone') continue;
            out.push([p.a[0], p.a[1], p.a[2]], [p.b[0], p.b[1], p.b[2]]);
            if (out.length >= 16) return out;
          }
        }
        return out;
      })(),
    }),
  };
}
