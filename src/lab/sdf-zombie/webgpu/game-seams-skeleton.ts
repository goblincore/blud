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
import { applyBoneMesh, applyOrganMode } from './game-render-leaves';
import type { OrganLook, OrganLookName } from './skeleton-spike/mesh-organ';
import { segmentBoundSphere } from './skeleton-spike/organ-reach';
import { traceProjectile } from './game-weapon';
import { sdBody } from '../validate';
import { splitLookOk, type SplitLookSet } from './skeleton-spike/mesh-split';

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
      // The head bound's centre and its +x edge in world space (Task 11b: the gate centres its
      // skull and surrounding-flesh regions on the projected skull, not on the crater point).
      const mid: Vec3 = [x, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      return { actor: a.id, point, ejected, stamped: !!wound, headCenter: head.toWorld(mid), headEdge: head.toWorld([b.max[0], mid[1], mid[2]]) };
    },
    /** Shared light list (plan 1, Task 11): the iLights picks of one actor's drawn bone-mesh
     *  instances (its owner picks, `index + weight`, -1 empty, -2 no owner), their iFill (the
     *  owner room's fill factor, Task 11b) and the renderer's list switch. null without the mesh skeleton or the actor. */
    boneLights: (bodyId?: number) => {
      const a = bodyId === undefined ? ctx.world.actors[0] : ctx.world.actors.find(q => q.id === bodyId);
      const r = ctx.render.segMeshRenderer;
      if (!a || !r) return null;
      return { listOn: r.uniforms.lightListCfg.value.x, instances: r.ownerLights(a), fill: r.ownerFill(a), body: a.view.uniforms.bodyLights.value.toArray() };
    },
    /** skeleton=mesh: the bone-exposure spheres game-main last fed the segment meshes ([x, y, z, radius] rows, every
     *  visual actor's in order; cut-wound.ts boneExposureOf). null without the mesh skeleton. The cut gate's turned-body
     *  check reads these against the wound's uploaded slot. */
    meshExposure: () => ctx.render.segMeshRenderer ? ctx.render.segMeshRenderer.exposureRows() : null,
    /** The split skull's look (head-split.ts HEAD_SPLIT.skull; mesh-renderer.ts splitLook), read and set live.
     *  `follow`: a number is one share for every stage (1 = the bone rides its flesh, 0 = the whole skull), a table of
     *  [flesh opening, share] knots replaces the staged one, null puts HEAD_SPLIT's back. `zigAmp` / `zigLen` /
     *  `chipAmp` / `chipLen` (m) and `wobble` / `wobbleAlong` / `wobbleUp` / `upFreq`: the fracture edge
     *  (mesh-split.ts meshSplitJag); both amplitudes 0 = a clean plane. `inside`: the bone's inner wall, [r, g, b].
     *  `rim` / `rimWidth`: the broken edge's colour and width (m; 0 = no rim). Returns the values in force; null
     *  without the mesh skeleton. The seam is called from a console: a set with anything that is not a finite number
     *  where one belongs (mesh-split.ts splitLookOk) is refused whole, and answers false. */
    skullSplit: (set?: SplitLookSet) => {
      const look = ctx.render.segMeshRenderer?.splitLook;
      if (!look) return null;
      if (set !== undefined) {
        if (!splitLookOk(set)) return false;
        if (set.follow !== undefined) look.follow = set.follow;
        const j = look.jag.value, sh = look.jagShape.value, r = look.rim.value;
        j.set(set.zigAmp ?? j.x, set.zigLen ?? j.y, set.chipAmp ?? j.z, set.chipLen ?? j.w);
        sh.set(set.wobble ?? sh.x, set.wobbleAlong ?? sh.y, set.wobbleUp ?? sh.z, set.upFreq ?? sh.w);
        if (set.inside) look.inside.value.setRGB(set.inside[0], set.inside[1], set.inside[2]);
        r.set(set.rim?.[0] ?? r.x, set.rim?.[1] ?? r.y, set.rim?.[2] ?? r.z, set.rimWidth ?? r.w);
      }
      const j = look.jag.value, sh = look.jagShape.value, r = look.rim.value;
      return {
        follow: look.follow, zigAmp: j.x, zigLen: j.y, chipAmp: j.z, chipLen: j.w,
        wobble: sh.x, wobbleAlong: sh.y, wobbleUp: sh.z, upFreq: sh.w,
        inside: look.inside.value.toArray(), rim: [r.x, r.y, r.z], rimWidth: r.w,
      };
    },
    /** skeleton=mesh diagnostics: draw or hide the bone meshes and the seated eyes (both drawn by default), so a
     *  capture can tell their pixels from the flesh's by a shown / hidden pair. Returns the state; null without the
     *  mesh skeleton; false (and nothing changed) for a flag that is not a boolean. */
    meshSkeletonShow: (set?: { bones?: boolean; eyes?: boolean; organs?: boolean }) => {
      const show = ctx.render.segMeshRenderer?.show;
      if (!show) return null;
      if (set !== undefined) {
        const flag = (v: unknown) => v === undefined || typeof v === 'boolean';
        if (set === null || typeof set !== 'object' || !flag(set.bones) || !flag(set.eyes) || !flag(set.organs)) return false;
        if (set.bones !== undefined) show.bones = set.bones;
        if (set.eyes !== undefined) show.eyes = set.eyes;
        if (set.organs !== undefined) show.organs = set.organs;
      }
      return { ...show };
    },
    /** Organs as mesh (2026-10-06): switch mesh-skeleton actors' organs between segment meshes ('mesh', the default)
     *  and field rows the march folds ('sdf', the A/B reference). Takes effect at once, on a frozen frame too (the
     *  views re-pack). Returns the mode in force: always 'sdf' without the mesh skeleton; anything but the two names
     *  changes nothing. */
    setOrgans: (mode: 'mesh' | 'sdf') => (mode === 'mesh' || mode === 'sdf' ? applyOrganMode(ctx, mode) : ctx.render.organMode),
    /** The organ state: the mode, the organ instances the last mesh update drew, the look in force, and per actor the
     *  inside-flesh rows its body packs (counts2.x: 0 means the march never calls applyBones for it). */
    organs: () => {
      const r = ctx.render.segMeshRenderer;
      return {
        mode: ctx.render.organMode, drawn: r ? r.stats.organs : 0, look: r ? r.setOrganLook() : null,
        tint: r ? r.organLook.tint.value.toArray() : null,
        /** The owner (actor id) of each organ instance the last mesh update drew. */
        drawnBy: r ? r.drawn.filter(d => d.organ).map(d => (d.owner as { id?: number } | null)?.id ?? -1) : [],
        packed: ctx.world.actors.map(a => ({ id: a.id, rows: a.view.uniforms.counts2.value.x })),
      };
    },
    /** Actor `id`'s organ segments (its contract sources of kind 'organ'): key, live, and the posed bound sphere the
     *  reach test uses (organ-reach.ts). Empty for an actor with no organs, or without the mesh skeleton. */
    organSegments: (bodyId: number) => {
      const a = ctx.world.actors.find(q => q.id === bodyId);
      const sources = a ? ctx.render.skeletonSources.get(a)?.sources ?? [] : [];
      return sources.filter(s => s.kind === 'organ').map(s => ({ segment: s.segment, live: s.isLive(), ...segmentBoundSphere(s.bounds, s.pose()) }));
    },
    /** The organ mesh's look (mesh-organ.ts): one of ORGAN_LOOKS by name, or its numbers. null without the mesh
     *  skeleton. */
    setOrganLook: (look?: OrganLookName | Partial<OrganLook>) => ctx.render.segMeshRenderer?.setOrganLook(look) ?? null,
    /** skeleton=mesh diagnostics: among this frame's instanced bone draws, actor `id`'s copies of a split head (bone
     *  or eye, the piece each is clipped to: 0 the rest, 1 the + half, 2 the - half, and the world matrix it is drawn
     *  with, column-major), and how many draws it has in all. A closed head has no copies: it is drawn as it always
     *  was. null without the mesh skeleton or the actor. */
    skullDrawn: (id: number) => {
      const a = ctx.world.actors.find(q => q.id === id), r = ctx.render.segMeshRenderer;
      if (!a || !r) return null;
      const mine = r.drawn.filter(d => d.owner === a);
      return { draws: mine.length, copies: mine.filter(d => d.piece !== null).map(d => ({ eye: d.eye, piece: d.piece, matrix: d.matrix.toArray() })) };
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
