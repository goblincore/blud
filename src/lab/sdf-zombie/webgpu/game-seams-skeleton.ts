// src/lab/sdf-zombie/webgpu/game-seams-skeleton.ts
//
// Skeleton=mesh / bone-tube evidence seams: the bone-mesh switch, the
// body-build cache census, which skeleton path is live, the bone-tube
// diagnostics and the mesh-path hit fixtures. Members moved VERBATIM out
// of game-seams-leftover.ts (leaves wave 1's ctx-only bucket,
// 2026-09-20 split; see the 2026-09-20-seams-leftover-split notes).
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import type * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { type Vec3 } from '../types';
import { bodyBuildCacheStats } from './character-view';
import { applyBoneMesh, applyOrganMode } from './game-render-controls';
import { ORGAN_DETAIL_SETS, type OrganLook, type OrganLookName } from './skeleton-spike/mesh-organ';
import { ORGAN_MESHES, organMeshKey, type OrganMeshName } from './skeleton-spike/mesh';
import { segmentBoundSphere } from './skeleton-spike/organ-reach';
import { traceProjectile } from './game-weapon';
import { sdBody } from '../validate';
import { splitLookOk, type SplitLookSet } from './skeleton-spike/mesh-split';
import { sculptVariantOf } from './skeleton-spike/sculpt-variant';
import { HUMANOIDS } from './skeleton-spike/skull-cast';

/** The name of the organ mesh spec the segment mesh cache builds by (null without the mesh skeleton; 'custom' for a
 *  spec that is none of ORGAN_MESHES). */
function organMeshName(ctx: GameContext): OrganMeshName | 'custom' | null {
  const cache = ctx.render.segMeshCache;
  if (!cache) return null;
  const key = organMeshKey(cache.organMesh);
  return (Object.keys(ORGAN_MESHES) as OrganMeshName[]).find(n => organMeshKey(ORGAN_MESHES[n]) === key) ?? 'custom';
}

export function createSkeletonSeams(ctx: GameContext) {
  /** The anatomical skull's kit on this page; null without one. */
  const kitOf = () => ctx.render.segMeshCache?.skullKit ?? null;
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
        /** How organ sources are meshed (skeleton-spike/mesh.ts ORGAN_MESHES), and the vertices and triangles of
         *  the organ instances the last mesh update drew. */
        mesh: organMeshName(ctx),
        /** The surface-detail strengths a sheet compares (mesh-organ.ts), each a Partial<OrganLook> for setOrganLook. */
        detailSets: ORGAN_DETAIL_SETS,
        drawnVerts: r ? r.drawn.reduce((n, d) => n + (d.organ ? d.geometry.getAttribute('position').count : 0), 0) : 0,
        drawnTris: r ? r.drawn.reduce((n, d) => n + (d.organ ? (d.geometry.index?.count ?? 0) / 3 : 0), 0) : 0,
        /** The owner (actor id) of each organ instance the last mesh update drew. */
        drawnBy: r ? r.drawn.filter(d => d.organ).map(d => (d.owner as { id?: number } | null)?.id ?? -1) : [],
        packed: ctx.world.actors.map(a => ({ id: a.id, rows: a.view.uniforms.counts2.value.x })),
      };
    },
    /** Actor `id`'s organ segments (its contract sources of kind 'organ'): key, live, the posed bound sphere the
     *  reach test uses (organ-reach.ts), and its mesh as cached now (how it was made, vertices, triangles, the ms it
     *  took to build). Empty for an actor with no organs, or without the mesh skeleton. */
    organSegments: (bodyId: number) => {
      const a = ctx.world.actors.find(q => q.id === bodyId);
      const sources = a ? ctx.render.skeletonSources.get(a)?.sources ?? [] : [];
      const cache = ctx.render.segMeshCache;
      return sources.filter(s => s.kind === 'organ').map(s => {
        const m = cache?.get(s);
        return {
          segment: s.segment, live: s.isLive(), ...segmentBoundSphere(s.bounds, s.pose()),
          mesh: m ? { mesher: m.mesher, verts: m.verts, tris: m.tris, bakeMs: +m.bakeMs.toFixed(2) } : null,
        };
      });
    },
    /** How organ sources are meshed (organs, low-poly, 2026-10-07): one of ORGAN_MESHES by name ('tubes' ships;
     *  'nets-5mm' is the extraction of 2026-10-06, for a before/after on the same frame). Takes effect at the next
     *  mesh update: each organ segment is built (or found in the cache) under the new spec. Returns the name in
     *  force; null without the mesh skeleton; an unknown name changes nothing. */
    setOrganMesh: (name?: OrganMeshName) => {
      const cache = ctx.render.segMeshCache;
      if (!cache) return null;
      if (name !== undefined && Object.hasOwn(ORGAN_MESHES, name)) cache.organMesh = ORGAN_MESHES[name];
      return organMeshName(ctx);
    },
    /** The organ mesh's look (mesh-organ.ts): one of ORGAN_LOOKS by name, or its numbers. null without the mesh
     *  skeleton. */
    setOrganLook: (look?: OrganLookName | Partial<OrganLook>) => ctx.render.segMeshRenderer?.setOrganLook(look) ?? null,
    /** skeleton=mesh diagnostics: among this frame's instanced bone draws, actor `id`'s copies of a split head (bone
     *  or eye, the piece each is clipped to: 0 the rest, 1 the + half, 2 the - half, and the world matrix it is drawn
     *  with, column-major), and how many draws it has in all. A closed head has no copies: it is drawn as it always
     *  was. `whole`: its draws that are not copies, in the same form with `piece` null. Every row names the material
     *  its batch is drawn on (mesh-renderer.ts SEGMENT_MATERIALS) and, when the bone is one plate of the anatomical
     *  skull (a skull that has lost plates is drawn plate by plate), the plate's id; `plate` is null for the whole
     *  skull, any other bone and an eye. `head`: the row draws the actor's head segment (the sculpted head's mesh, the
     *  anatomical skull whole, or one of its plates). `paint`: the sculpted skull's paint its material draws (1 or 2;
     *  null for an eye and for an anatomical plate). `character`: the actor's character, as its skeleton was built.
     *  null without the mesh skeleton or the actor. */
    skullDrawn: (id: number) => {
      const a = ctx.world.actors.find(q => q.id === id), r = ctx.render.segMeshRenderer;
      if (!a || !r) return null;
      const mine = r.drawn.filter(d => d.owner === a);
      const head = ctx.render.skeletonSources.get(a)?.sources.find(s => s.segment === 'head');
      const plates = (head && ctx.render.segMeshCache?.skullKit?.head(head)?.pieces) || [];
      // A split copy is drawn from its bone's twin geometry: instance data of its own on the bone's vertex data. The
      // shared position attribute says which plate either is.
      const plateOf = (g: THREE.BufferGeometry) => plates.find(p => p.geometry.getAttribute('position') === g.getAttribute('position'))?.id ?? null;
      const batchOf = (g: THREE.BufferGeometry) => r.object.children.find(c => (c as THREE.InstancedMesh).geometry === g) as THREE.InstancedMesh | undefined;
      const materialOf = (g: THREE.BufferGeometry) => (batchOf(g)?.material as THREE.Material | undefined)?.name ?? null;
      const paintOf = (g: THREE.BufferGeometry) => ((batchOf(g)?.material as THREE.Material | undefined)?.userData.sculptPaint as 1 | 2 | undefined) ?? null;
      // The head segment's mesh as cached (a split copy shares its position attribute, as a plate's does).
      const headPosition = head && ctx.render.segMeshCache ? ctx.render.segMeshCache.get(head).geometry.getAttribute('position') : null;
      const isHead = (g: THREE.BufferGeometry) => (headPosition !== null && g.getAttribute('position') === headPosition) || plateOf(g) !== null;
      const row = (d: (typeof mine)[number]) => ({
        eye: d.eye, piece: d.piece, matrix: d.matrix.toArray(), material: materialOf(d.geometry), plate: d.eye ? null : plateOf(d.geometry),
        head: !d.eye && !d.organ && isHead(d.geometry), paint: d.eye || d.organ ? null : paintOf(d.geometry),
      });
      return {
        draws: mine.length, copies: mine.filter(d => d.piece !== null).map(row), whole: mine.filter(d => d.piece === null).map(row),
        character: ctx.render.skeletonSources.get(a)?.name ?? null,
      };
    },
    meshEyeState: (bodyId?: number) => { const a = bodyId === undefined ? ctx.world.actors[0] : ctx.world.actors.find(q => q.id === bodyId); return a && ctx.render.segMeshRenderer ? ctx.render.segMeshRenderer.eyeState(a) : null; },
    skullState: (bodyId?: number) => { const a = bodyId === undefined ? ctx.world.actors[0] : ctx.world.actors.find(q=>q.id===bodyId); return a && ctx.render.segMeshRenderer ? ctx.render.segMeshRenderer.skullState(a) : null; },
    /** skeleton=mesh diagnostics: the anatomical skull's plates as fitted to actor `bodyId`'s head
     *  (anatomical-skull.ts), in SKULL_PIECES order: each plate's id, its pivot and its box (`min`, `max`) in the head
     *  segment's own frame, the frame skullDrawn's matrices take to the world. A fragment is released from its
     *  plate's pivot, and a ray that misses a plate's box cannot meet the plate. null without the anatomical skull,
     *  the actor or its head. */
    skullPlates: (bodyId?: number) => {
      const a = bodyId === undefined ? ctx.world.actors[0] : ctx.world.actors.find(q => q.id === bodyId);
      const head = a && ctx.render.skeletonSources.get(a)?.sources.find(s => s.segment === 'head');
      const fitted = head && ctx.render.segMeshCache?.skullKit?.head(head);
      return fitted ? fitted.pieces.map(p => ({ id: p.id, pivot: [...p.pivot], min: [...p.min], max: [...p.max] })) : null;
    },
    /** skeleton=mesh diagnostics: actor `id`'s eyes as this frame draws them, a closed head's or a split one's copies:
     *  each one's world centre and radius (its instance matrix's) and the piece a copy is clipped to (null: a closed
     *  draw). An actor that draws no eye: []. null without the mesh skeleton or the actor. */
    meshEyes: (id: number) => {
      const a = ctx.world.actors.find(q => q.id === id), r = ctx.render.segMeshRenderer;
      if (!a || !r) return null;
      return r.drawn.filter(d => d.owner === a && d.eye).map(d => ({
        centre: [d.matrix.elements[12]!, d.matrix.elements[13]!, d.matrix.elements[14]!] as Vec3,
        radius: d.matrix.getMaxScaleOnAxis(), piece: d.piece,
      }));
    },
    /** skeleton=mesh diagnostics: how the anatomical skull was fitted to actor `bodyId`'s head (`?skullfit=`,
     *  anatomical-skull.ts): the fit's name; for a fit to the flesh (skull-fit.ts) its axis scales and offset, the
     *  fitted skull's box in the head segment's frame, the furthest stage 2 moved a vertex (m), its passes, whether
     *  it had to shrink the skull after them (1: no) and the fit's wall time (ms); the flesh head it was sized to
     *  (`flesh`: its deepest point and its reach from there to each side); the skull's own orbits and the eye seats
     *  in them, head-local; `eyeHs`, the painted eye line the orbits were held on (null: the bone envelope's);
     *  `madeMs`, the whole fitted skull's (the fit, its geometry, the orbits). The envelope fit answers its name
     *  alone. null without the anatomical skull, the actor, its head, or for a character that draws its sculpted
     *  bone. */
    skullFit: (bodyId?: number) => {
      const a = bodyId === undefined ? ctx.world.actors[0] : ctx.world.actors.find(q => q.id === bodyId);
      const head = a && ctx.render.skeletonSources.get(a)?.sources.find(s => s.segment === 'head');
      const fitted = head && ctx.render.segMeshCache?.skullKit?.head(head);
      if (!fitted) return null;
      const f = fitted.fit;
      return f ? {
        name: f.name, scale: [...f.result.affine.scale], offset: [...f.result.affine.offset], min: [...f.min], max: [...f.max],
        maxMove: f.result.warp.maxMove, passes: f.result.passes.length, shrunk: f.result.shrunk, ms: f.result.ms,
        flesh: { ...f.result.affine.flesh, centre: [...f.result.affine.flesh.centre] },
        orbits: fitted.orbits.map(o => ({ centre: [...o.centre], radius: o.radius })),
        eyes: (fitted.eyes ?? []).map(e => ({ center: [...e.center], radius: e.radius })),
        eyeHs: ctx.render.segMeshCache!.skullKit!.fitOf(head!.character)?.eyeHs ?? null, madeMs: fitted.mesh.bakeMs,
      } : { name: 'envelope' as const };
    },
    /** skeleton=mesh diagnostics: one round at actor `bodyId`'s anatomical skull, through the renderer's own
     *  fractureSkull (mesh-renderer.ts: what a pellet's or a slug's impact calls first): the world ray `point` + t
     *  `direction`, met where the skull is drawn. Nothing else of a hit happens: no wound, no damage to the actor, no
     *  eye. Returns the plates released (three pellets on one plate, or one slug, break it); null without the mesh
     *  skeleton or the actor; false, and nothing done, for a ray that is not two triples of finite numbers or a `kind`
     *  that is neither round. */
    skullShot: (bodyId: number, point: Vec3, direction: Vec3, kind: 'pellet' | 'slug' = 'pellet') => {
      const a = ctx.world.actors.find(q => q.id === bodyId), r = ctx.render.segMeshRenderer;
      if (!a || !r) return null;
      const triple = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(x));
      if (!triple(point) || !triple(direction) || (kind !== 'pellet' && kind !== 'slug')) return false;
      return r.fractureSkull(a, ctx.render.skeletonSources.get(a)?.sources ?? [], [...point] as Vec3, [...direction] as Vec3, kind);
    },
    /** skeleton=mesh diagnostics: the bone the world ray `point` + t `direction` meets first on actor `bodyId`'s
     *  anatomical skull as it is drawn, within `reach` metres (a bullet's reach from the skin, 0.14 m, when omitted):
     *  `{ plate, piece, distance }`, the plate's id, the piece whose copy shows it there (0 the rest, 1 the + half, 2
     *  the - half; a closed skull is all 0) and how far along the ray. The test skullShot makes, with nothing damaged.
     *  null: no bone on the ray, or no mesh skeleton, actor or anatomical skull; false for arguments that are not two
     *  triples of finite numbers and a positive reach. */
    skullRay: (bodyId: number, point: Vec3, direction: Vec3, reach?: number) => {
      const a = ctx.world.actors.find(q => q.id === bodyId), r = ctx.render.segMeshRenderer;
      if (!a || !r) return null;
      const triple = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(x));
      if (!triple(point) || !triple(direction) || (reach !== undefined && !(Number.isFinite(reach) && reach > 0))) return false;
      return r.skullRay(a, ctx.render.skeletonSources.get(a)?.sources ?? [], [...point] as Vec3, [...direction] as Vec3, reach);
    },
    /** The live skull-fragment mesh gibs (game-mesh-gibs.ts, tag 'skull'), oldest first: the plate each was (an
     *  anatomical plate, or a fragment of the sculpted head), its world position and its velocity, and the sculpted
     *  skull's paint its material draws (1 or 2; null for an anatomical plate). */
    skullFragments: () => ctx.gibs.meshGibs.filter(g => g.tag === 'skull')
      .map(g => ({
        plate: g.object.name.replace(/^skull-fragment:/, ''), pos: [...g.state.pos], vel: [...g.state.vel],
        paint: (((g.object.children?.[0] as THREE.Mesh | undefined)?.material as THREE.Material | undefined)?.userData?.sculptPaint as 1 | 2 | undefined) ?? null,
      })),
    /** The sculpted skull's fragment cuts (mesh-renderer.ts fragmentStats): how many head meshes have been cut into
     *  fragments for a pop, and how long the last cut took (ms). null without the mesh skeleton. */
    skullFragmentCuts: () => ctx.render.segMeshRenderer?.fragmentStats() ?? null,
    explodeMeshSkull: (bodyId?: number) => {
      const a = bodyId === undefined ? ctx.world.actors[0] : ctx.world.actors.find(q=>q.id===bodyId);
      return a && ctx.render.segMeshRenderer ? ctx.render.segMeshRenderer.explodeSkull(a,ctx.render.skeletonSources.get(a)?.sources ?? [],[0,1,0]) : 0;
    },
    /** Cold-start task 1: how many per-character body builds the memo actually
     *  ran (vs served from cache) and their cumulative CPU time. */
    bodyBuild: () => ({ ...bodyBuildCacheStats() }),
    /** Synchronous active-path proof for capture harnesses. */
    skeletonDiagnostics: () => ({
      requestedMode: ctx.render.skeletonMode,
      // The page's skull in force: 'anatomical' when the plates are loaded and every humanoid draws them
      // (`?skull=anatomical`), else 'sculpt': the default, where the characters `anatomical` lists draw the plates
      // and every other its sculpted bone, and what any page draws when the plates' asset did not load.
      skull: kitOf() && HUMANOIDS.every(name => kitOf()!.fitOf(name)) ? 'anatomical' : 'sculpt',
      // Who draws the anatomical skull on this page, and under which fit: character to the fit's name (skull-fit.ts;
      // the eight ball-headed humanoids by default, skull-cast.ts). Empty: nobody (no kit).
      anatomical: Object.fromEntries(HUMANOIDS.flatMap(name => { const spec = kitOf()?.fitOf(name); return spec ? [[name, spec.fit]] : []; })),
      // The sculpted skull's recipe in force (sculpt-variant.ts): which sculpt, the head's extraction cell (null: the
      // cache's own) and which paint; and the variant that recipe is. The default is `full`:
      // { shape: 2, headCell: 0.005, paint: 2 }. Under the anatomical skull it is `classic`, which the other bones
      // are drawn with.
      sculpt: ctx.render.segMeshCache ? { ...ctx.render.segMeshCache.sculpt } : null,
      sculptVariant: ctx.render.segMeshCache ? sculptVariantOf(ctx.render.segMeshCache.sculpt) : null,
      // The one fit of a kit that fits every humanoid alike (`?skull=anatomical`: 'envelope', or `?skullfit=`'s);
      // null for the default page, whose characters each have their own, and without a kit.
      skullFit: kitOf()?.fit ?? null,
      // Every skull the kit has fitted since boot: whose, under which fit, and how long it took to make (ms). One
      // per head revision, made when the character's skeleton sources are built (game-skeleton-actors.ts).
      skullFits: kitOf() ? kitOf()!.made.map(m => ({ ...m })) : [],
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
