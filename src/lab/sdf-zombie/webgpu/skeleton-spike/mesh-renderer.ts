// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-renderer.ts
//
// The forward-mode renderer for skeleton segment meshes: one pooled mesh per live bone segment per actor, posed from the bone contract.

import { meshBoneSource } from './mesh-skull';
// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-renderer.ts
//
// SKELETON REPRESENTATION COMPARISON — Task 2: forward-mode renderer for
// the extracted segment meshes (mesh.ts). One THREE.Mesh per live segment
// per actor, geometry SHARED across actors through the SegmentMeshCache
// (same revision → same BufferGeometry), posed per frame from the contract
// source's pose() (origin + quat — rigid, no scale, so normalWorld is
// exact; the one exception, the head deform's extra affine on the skull
// segment, is non-uniform: the instance normal transform is exact for its
// axis scales and only approximate for its small dent shear), hidden the same frame isLive() goes false (the contract sever
// rule: pack.ts drops the bone rows, we drop the segment).
//
// WOUND/FLESH EXPOSURE RULE — smax-then-min, NOT depth-only hiding: the
// game wiring (?skeleton=mesh) flips view.setPackBones(false) on the
// meshed actors, so the marched field carries flesh (+wound smax) and NO
// bone rows; the bone surface comes solely from these meshes, composited
// by the depth test against the marched flesh. Because the shipped bone
// fold is a HARD MIN applied after the wound smax (foldBoneRange — "meat
// meeting bone should crease"), nearest-surface depth composition IS the
// field's min composition for opaque surfaces: bone shows exactly where
// the wound carve reached it, never through intact flesh. Depth-only
// hiding WITHOUT removing the field bones would double-draw — that is the
// incorrect rule this wiring avoids.
//
// SHADING: mesh-only material terms keep wound exposure in world space but
// anchor wet tissue, the painted patch classes, the two tooth rows, the
// irregular socket vessels and the broad skull face cues in segment-local
// space, so they follow animation.
// Specular/Fresnel gain is a per-fragment gloss mask from an independent
// wetness field (dry tissue matte, wet patches glossy, cavities unlit);
// there is no blanket gloss floor. BONE_SHADE_WGSL remains the shared forward
// light compose (fill/key/flashlight cone, wet specular, Fresnel), fed by real
// geometry positionWorld/normalWorld. The seated eyes reuse that compose with
// u.look and add a restrained light-independent red pupil/iris emission AFTER
// it: the glow is per-eye, reads in darkness and is never a scene light.
// Same uniform factory and per-frame
// seeding in game-main keep the existing lighting conventions. LIT FORWARD
// MODE ONLY — deferred G-buffer output is NOT
// implemented for this prototype (the game wiring refuses skeleton=mesh
// under ?renderer=deferred and reports it).
//
// THE HEAD SPLIT (head-split.ts skullSplitOf): a segment the caller's `split` hook answers for (the skull, of a head
// whose split the march draws) is drawn once per PIECE that owns part of it: the unmoved rest, and a copy turned about
// the hinge for each half whose bone turns. The copies go to their own batches (a second geometry sharing the
// segment's vertex data, with its own instance data) on their own two-sided materials, which clip each copy to its
// piece along the fracture (mesh-split.ts). The sculpted skull and the eyes are thin closed shells: their back faces
// are painted as the bone's dark inner wall. An anatomical plate has thickness, and an inside of its own geometry: its
// copies keep the plate's surface and normal map on both faces, and are cut bone at the fracture edge. A closed head
// never touches any of it: same batches, same material, same instances as before.
// A shot goes by the same copies: fractureSkull tests its ray against the plates where they are drawn
// (skull-split-hit.ts), and a plate that comes off leaves from its copy's turned place. An open head has bone with no
// flesh in front of it, so a projectile's step is cast from its start there (impact's `step`), and a step that meets
// no flesh of the actor is cast as well (skullPass).
//
// ORGANS (organs as mesh, 2026-10-06): a source of contract kind 'organ' is drawn like a bone segment (same cache,
// same instanced batches, same depth rule: it shows exactly where a carve reached it) on its own material
// (mesh-organ.ts), and only for an owner whose wounds REACH it (organ-reach.ts). Organs carry no eyes and never split.
//
// PROTOTYPE SCOPE / FALLBACKS (counted, not hidden): actor bones (and, when their sources are passed, organs) mesh;
// chunks and every non-actor bone stay procedural. Limb segments
// pose with the contract's two-anchor approximation (measured 1.26 mm
// worst, task-1.md — below the 1 cm extraction cell).
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  attribute, wgslFn, mul, add, mix, float, texture, uniform, vec4, vec2, uv, positionGeometry, positionWorld, normalWorld,
  cameraPosition, frontFacing, Fn, If,
} from 'three/tsl';
import {
  BONE_HASH_WGSL, BONE_NOISE_WGSL, BONE_SHADE_WGSL, NO_OWNER_PICKS,
  boneInstancerUniforms, type BoneInstancerUniforms, type PicksLike,
} from '../bone-instancer';
import { BODY_LIGHTS } from '../march/body-lights.wgsl';
import { fallbackLightListNode } from '../zombie-gpu';
import type { BoneFieldSource } from './contract';
import type { SegmentMeshCache } from './mesh';
import {
  meshAppearanceCoord, MESH_BONE_SURFACE_WGSL, MESH_BONE_WET_WGSL,
  MESH_SKULL_CAVITY_WGSL, MESH_SOCKET_VESSEL_WGSL, MESH_TOOTH_ROW_WGSL,
  MESH_SPEC_SCALE, MESH_FRES_SCALE, MESH_GLOSS_WET,
} from './mesh-appearance';
import {
  meshEyePlacements, meshEyeImpactIndices, MESH_EYE_EMISSION_WGSL, MESH_EYE_SURFACE_WGSL, MESH_EYE_VESSEL_WGSL,
  type MeshEyePlacement,
} from './mesh-eyes';
import { ANATOMICAL_SKULL_NORMAL_WGSL, ANATOMICAL_SKULL_SURFACE_WGSL } from './anatomical-skull.wgsl';
import { SCULPT_PAINT_SHAPE1, SCULPT_PAINT_SHAPE2, sculptPaintSources } from './sculpt-paint';
import { SKULL_REACH, damageSkull, explodeSkull, intactSkull, skullPieceLaunch, type SkullDamage } from '../../skull-fracture';
import { fragmentVertexData, partitionSculptMesh } from './sculpt-fragments';
import { sculptPaintOf } from './sculpt-variant';
import type { FittedSkull } from './anatomical-skull';
import type { Vec3 } from '../../types';
import { HEAD_SPLIT, skullPieceAngle, skullPieces, skullSplitOf, type SkullFollow, type SkullSplit, type SplitWarp } from '../../head-split';
import {
  MESH_ORGAN_DETAIL_WGSL, MESH_ORGAN_HEIGHT_WGSL, MESH_ORGAN_SHADE_WGSL, MESH_ORGAN_SURFACE_WGSL, MESH_ORGAN_WET_WGSL,
  ORGAN_LOOKS, ORGAN_LOOK_DEFAULT, type OrganLook, type OrganLookName,
} from './mesh-organ';
import { organReached, segmentBoundSphere, type ReachSphere } from './organ-reach';
import {
  MESH_SPLIT_CLIP_WGSL, MESH_SPLIT_CUT_BONE_WGSL, MESH_SPLIT_FRACTURE_WGSL, MESH_SPLIT_INSIDE_WGSL, MESH_SPLIT_JAG_WGSL,
  SPLIT_INSTANCE_ATTRS, SPLIT_INSTANCE_FLOATS, meshSplitJagMax, packSplitInstance, type SplitJag,
} from './mesh-split';
import {
  skullCopiesBound, skullOwnerAt, skullShotCast, skullSplitRayHit, skullStruck,
  type SkullHeadFrame, type SkullShotStep, type SkullStrikes,
} from './skull-split-hit';

const MAX_WOUNDS_TEX = 64;
/** The materials' names, by what each draws: a bone segment (the sculpted skull among them), a plate of the anatomical
 *  skull and a seated eye, closed and as a split head's clipped copies. Diagnostics only: the skullDrawn seam reports
 *  the one an instance's batch is drawn on, and three leaves a material's name out of its pipeline key. */
export const SEGMENT_MATERIALS = {
  bone: 'skeleton-bone', plate: 'skeleton-plate', eye: 'skeleton-eye',
  boneSplit: 'skeleton-bone-split', plateSplit: 'skeleton-plate-split', eyeSplit: 'skeleton-eye-split',
} as const;
/** Updates a segment batch may sit unused before it is dropped (a stale revision's geometry). */
const BATCH_IDLE_UPDATES = 120;

/** The per-segment draw decision of the visual-actor cull (pure, exported
 *  for vitest — see mesh-renderer.test.ts). A segment is drawn when its
 *  contract sever rule says it is live AND — when the caller passes `shown`
 *  (the visual-actor set) — its owner is in that set. With no `shown`, the
 *  owner test is skipped, which is the pre-cull behaviour exactly.
 *  Ownership only: slot indexing is untouched (entries stay one per actor,
 *  in actor order); a hidden segment keeps its mesh and just skips the
 *  pose writes, the same path a severed (non-live) segment takes. */
export function segmentDrawn(live: boolean, owner: unknown, shown?: ReadonlySet<unknown>): boolean {
  if (shown && !shown.has(owner)) return false;
  return live;
}

/** BONE EXPOSURE CULL (optimisation pass, 2026-09-26): bone shows only where a wound carve
 *  reached it (the header's smax-then-min rule), so an owner with nothing exposed draws only the
 *  segments that carry something visible through intact flesh: the eyes. `exposed` omitted =
 *  every owner is exposed (the pre-cull behaviour). Night Train: ~250 draws a frame were whole
 *  skeletons hidden inside unwounded bodies. */
export function segmentNeeded(owner: unknown, hasEyes: boolean, exposed?: ReadonlySet<unknown>): boolean {
  return !exposed || exposed.has(owner) || hasEyes;
}

/** The organ segment's draw decision (organs as mesh, 2026-10-06): the owner is exposed (as a bone segment's, with no
 *  eye clause), AND one of its wounds' exposure spheres reaches the segment's posed bound (organ-reach.ts). `spheres`
 *  undefined = no reach test (every exposed owner's organs draw); null or empty = nothing reaches. */
export function organNeeded(
  owner: unknown, exposed: ReadonlySet<unknown> | undefined, spheres: ReadonlyArray<ReachSphere> | null | undefined,
  centre: readonly [number, number, number], radius: number,
): boolean {
  if (exposed && !exposed.has(owner)) return false;
  if (spheres === undefined) return true;
  return spheres !== null && organReached(spheres, centre, radius);
}

export interface SegmentMeshRenderer {
  object: THREE.Group;
  uniforms: BoneInstancerUniforms;
  /** Re-pose every actor's segments for this frame. `entries[i]` is actor
   *  i's CURRENT contract sources (rebuild the entry on sever re-derive).
   *  `shown` (visual-actor-cull task 2) is the set of owners to draw: an
   *  owner outside it has its meshes set invisible and receives NO pose
   *  writes (meshes stay allocated, so re-showing is one update away).
   *  Omitted = draw every entry, the pre-cull behaviour.
   *  `extra` (melee head damage, Task 10): an optional WORLD-space affine
   *  (column-major 4x4) applied after a segment's rigid pose, per owner and
   *  segment key — the head deform's squash and dents on the 'head' skull
   *  segment, so the skull deforms with the flesh (its seated eyes ride the
   *  same matrix). Null = the rigid pose.
   *  `split` (the head split): `warp` answers the split the march DRAWS for this owner's segment (the view's
   *  splitDrawn for the 'head' segment), or null. The segment and its eyes are then drawn once per piece of the
   *  skull's split (head-split.ts skullSplitOf), each copy turned by its piece's bone angle and clipped to it. Null,
   *  or `split` omitted = the closed draw, exactly. `seed` answers the owner's fracture seed (its actor id: each head
   *  breaks along its own pattern, the same one whatever else split before it); omitted = 0. The hook is kept until
   *  the next update: fractureSkull and explodeSkull ask it for the split their owner's skull is drawn with.
   *  `reach` (organs as mesh): the owner's wound exposure spheres (cut-wound.ts boneExposureOf), or null for none. An
   *  organ source is drawn only when one reaches its posed bound (organNeeded). Omitted = no reach test. */
  update(
    entries: ReadonlyArray<readonly BoneFieldSource[]>, owners?: readonly object[], shown?: ReadonlySet<unknown>,
    exposed?: ReadonlySet<unknown>, extra?: (owner: object, segment: string) => ArrayLike<number> | null,
    split?: { warp(owner: object, segment: string): SplitWarp | null; seed?(owner: object): number },
    reach?: (owner: object) => ReadonlyArray<ReachSphere> | null,
  ): void;
  /** The organ material's look, live (mesh-organ.ts): `tint` = (organColor, organAmp), the march's own two values,
   *  copied from a body view by the game; `cfg`, `gloss`, `occ`, `detail` and `relief` as OrganLook. */
  readonly organLook: {
    tint: { value: THREE.Vector4 }; cfg: { value: THREE.Vector4 }; gloss: { value: THREE.Vector4 }; occ: { value: THREE.Vector4 };
    detail: { value: THREE.Vector4 }; relief: { value: THREE.Vector4 };
  };
  /** Set the organ look: one of ORGAN_LOOKS by name, or its numbers. Returns the values in force. */
  setOrganLook(look?: OrganLookName | Partial<OrganLook>): OrganLook;
  /** The split skull's look, live: `follow` set by hand replaces HEAD_SPLIT.skull.follow (null = that table; a
   *  number is one share for every stage, 1 rides the flesh, 0 the whole skull; or another table); `jag` = (zigAmp,
   *  zigLen, chipAmp, chipLen) and `jagShape` = (wobble, wobbleAlong, wobbleUp, upFreq), the fracture edge
   *  (mesh-split.ts meshSplitJag); `inside` the bone's inner wall (the sculpted skull's and the eyes': an anatomical
   *  plate has none); `rim` = (the broken edge's colour, its width in metres). */
  readonly splitLook: {
    follow: SkullFollow | null; jag: { value: THREE.Vector4 }; jagShape: { value: THREE.Vector4 };
    inside: { value: THREE.Color }; rim: { value: THREE.Vector4 };
  };
  /** Diagnostics: which batches are drawn (both true by default). A capture tells bone or eye pixels from everything
   *  else by a shown / hidden pair of the same frame. Takes effect at the next update. */
  readonly show: { bones: boolean; eyes: boolean; organs: boolean };
  /** Copy each drawn instance's OWNER picks into its batch's iLights (shared light list, Task
   *  11): `lightsOf(owner)` is the owner actor's `bodyLights` value, read NOW, so call it after
   *  this frame's picks are written (the game's light loop runs after update). Undefined/null =
   *  no owner picks (the instance keeps the old key). `fillOf(owner)` (Task 11b) is the owner
   *  room's fill factor, written to iFill (the list branch scales the bone ambient by it); omitted,
   *  or an owner with no picks: 1. Allocation-free. */
  syncLights(lightsOf: (owner: unknown) => PicksLike | null | undefined, fillOf?: (owner: unknown) => number): void;
  /** Diagnostic: the iFill values of this owner's drawn instances, eyes included. */
  ownerFill(owner: unknown): number[];
  /** Diagnostic: the iLights rows (4 packed picks each) of this owner's drawn instances, eyes
   *  included, as last written by syncLights. */
  ownerLights(owner: unknown): number[][];
  /** A pellet or slug that met `owner`'s flesh at `point`: the skull is cast (fractureSkull), then an eye near the
   *  hit is ejected. Returns the eyes ejected.
   *  `step` (a travelling projectile): `from` is where its step began and `by` the projectile, which remembers the
   *  skulls it has damaged. On a head whose split is drawn, on the anatomical skull, the skull is then cast from
   *  `from`, as far as the flesh and a bullet's reach on, so bone standing in front of the flesh counts; and not at
   *  all when `by` has damaged this skull already (skull-split-hit.ts skullShotCast). Every other head, and `step`
   *  omitted: from `point`, a bullet's reach on, as ever. */
  impact(
    owner: object, sources: readonly BoneFieldSource[], point: readonly [number, number, number], direction: readonly [number, number, number],
    kind: 'pellet' | 'slug', step?: { from: Vec3; by?: SkullStrikes },
  ): number;
  /** A projectile's step `from`..`to` that met NO flesh of `owner` (`to`: where the step ends, or where the
   *  projectile stopped in something else). On a head whose split is drawn, on the anatomical skull, bone stands in
   *  the gap with no flesh in front of it: when the step passes the skull it is cast along its length, and the first
   *  plate it meets is damaged (a plate that breaks leaves as fractureSkull's does). `by`, the projectile, then
   *  remembers this skull, and a projectile that has damaged it already is not cast. Nothing else of a hit happens,
   *  and any other head is left alone. Returns the plates released. */
  skullPass(owner: object, sources: readonly BoneFieldSource[], from: Vec3, to: Vec3, direction: Vec3, kind: 'pellet' | 'slug', by?: SkullStrikes): number;
  /** Diagnostics: the bone the world ray `point` + t `direction` meets first on `owner`'s anatomical skull as it is
   *  drawn, within `reach` (m; a bullet's reach when omitted): the plate's id, the piece whose copy shows it there and
   *  the distance along the ray. The test fractureSkull makes, with nothing damaged. Null: no bone, or no such skull. */
  skullRay(owner: object, sources: readonly BoneFieldSource[], point: Vec3, direction: Vec3, reach?: number): { plate: string; piece: 0 | 1 | 2; distance: number } | null;
  stepDebris(dt: number): void;
  eyeState(owner: object): { missing: number[]; debris: number };
  skullState(owner: object): { missing: number; pieces: string[] };
  /** A pellet or slug at the anatomical skull: the world ray `point` + t `direction` damages the first plate it
   *  meets (skull-fracture.ts damageSkull), and a plate that breaks is released as a fragment. On a head the last
   *  update's `split` hook answers for, the ray is tested against the plates where their copies are DRAWN
   *  (skull-split-hit.ts), and the fragment leaves from the turn of the piece that was hit: its position, its
   *  orientation and its launch. A closed head: the closed head's frame, as ever. Returns the plates released. */
  fractureSkull(owner: object, sources: readonly BoneFieldSource[], point: Vec3, direction: Vec3, kind: 'pellet' | 'slug'): number;
  /** THE SKULL COMES APART (a head pop). The anatomical skull releases every plate it still has. A SCULPTED head
   *  mesh has no plates: it is cut into the named fragments of sculpt-fragments.ts, each thrown as a mesh gib the way
   *  a plate is (the same launch rule and support points; its geometry its own, freed when the gib is evicted), with
   *  the sculpt's paint outside and the bone's dark inner wall on its back faces; the owner's head segment and its
   *  seated eyes stop being drawn at once, in the batches as they stand, so no frame shows both and none neither.
   *  The cut is made at a mesh's first pop and kept (fragmentStats). On a split head each piece leaves from the turn
   *  of the split piece that owns its pivot. Returns the pieces released. */
  explodeSkull(owner: object, sources: readonly BoneFieldSource[], direction: Vec3): number;
  /** The sculpted skull's fragment cuts so far: how many head meshes have been cut, and the last cut's time (ms). */
  fragmentStats(): { meshes: number; lastMs: number };
  /** This frame's craters (world centre + radius) for the exposure gradient. */
  setWounds(wounds: ReadonlyArray<{ pos: readonly [number, number, number]; radius: number }>): void;
  /** Diagnostics: the exposure rows setWounds last uploaded (what the shader reads), as [x, y, z, radius]. */
  exposureRows(): number[][];
  /** Coverage accounting for diagnostics: meshed segment/vertex/triangle
   *  counts from the LAST update, plus cache extraction-health flags. */
  readonly stats: {
    actors: number; segments: number; rigid: number; limb: number;
    hidden: number; verts: number; tris: number;
    overflow: number; clamped: number; droppedQuads: number;
    /** Organ instances drawn by the last update (0 with no organ source, or none reached). */
    organs: number;
  };
  /** This update's instanced draws (tests, diagnostics): owner, eye or segment, world matrix, and for a copy of a
   *  split head the piece it is clipped to (0 the rest, 1 the + half, 2 the - half; null = not split). */
  readonly drawn: ReadonlyArray<{ owner: unknown; eye: boolean; organ: boolean; matrix: THREE.Matrix4; geometry: THREE.BufferGeometry; piece: 0 | 1 | 2 | null }>;
  /** How many instanced draws this update issued (one per segment geometry in use, plus eyes). */
  readonly draws: number;
  /** Remove every actor slot while keeping material/uniforms reusable. */
  clear(): void;
  dispose(): void;
}


/**
 * `layer` puts every segment mesh (and its eyes) on a THREE layer other than
 * 0. The 'bodies' field style uses this to pull the skeleton out of the
 * full-resolution polygonal pass and render it into the half-height field
 * buffer instead, in lockstep with the marched flesh. Default 0 = the
 * ordinary forward pass.
 */
/** `lightList`: the shared light-list storage node (ctx.world.light.list.node); omitted, the zero
 *  fallback is bound and lightListCfg.x stays 0. */
export function createSegmentMeshRenderer(cache: SegmentMeshCache, layer = 0, lightList?: unknown, spawnSkull?: (object: THREE.Object3D, pos: Vec3, vel: Vec3, angular: Vec3, radius: number, support: readonly {c:Vec3;r:number}[]) => void): SegmentMeshRenderer {
  const group = new THREE.Group();
  group.name = 'skeleton-segment-meshes';
  const extraM = new THREE.Matrix4();

  const u = boneInstancerUniforms();
  const woundData = new Float32Array(MAX_WOUNDS_TEX * 4);
  const woundTex = new THREE.DataTexture(woundData, MAX_WOUNDS_TEX, 1, THREE.RGBAFormat, THREE.FloatType);
  woundTex.minFilter = THREE.NearestFilter; woundTex.magFilter = THREE.NearestFilter;
  woundTex.generateMipmaps = false;
  woundTex.needsUpdate = true;

  // Dependency-ordered includes, the bone-instancer idiom. Each function is
  // built with every EARLIER function as an include (transitive include
  // resolution), so the order below is load-bearing: hash -> noise -> tooth
  // row -> skull cavity -> socket vessels -> surface material -> wet gloss ->
  // unchanged forward light compose.
  const fns: ReturnType<typeof wgslFn>[] = [];
  for (const src of [
    BONE_HASH_WGSL, BONE_NOISE_WGSL, MESH_TOOTH_ROW_WGSL, MESH_SKULL_CAVITY_WGSL,
    MESH_SOCKET_VESSEL_WGSL, MESH_BONE_SURFACE_WGSL, MESH_BONE_WET_WGSL, BODY_LIGHTS, BONE_SHADE_WGSL,
  ]) fns.push(wgslFn(src, fns.slice()));
  const [surfaceFn, wetFn, shade] = [fns[5]!, fns[6]!, fns[8]!];
  // THE SECOND PAINT (sculpt-paint.ts), when the cache's recipe asks for it: its own chain on the same hash and
  // noise, in the layout of the sculpt the cache extracts. `tilt` is the shading normal the painted height tilts
  // (xyz) and the pixel's footprint on the surface (w); it takes screen derivatives, so a material that shades inside
  // a branch declares it ahead of the branch. Null: the first paint alone, built below exactly as it always was.
  // With it there are two bone materials, and a character's bones are drawn on its own paint's (sculptPaintOf: the
  // second paint is fitted to some characters' heads and not to others').
  const paint2 = cache.sculpt.paint === 2 ? (() => {
    const chain: ReturnType<typeof wgslFn>[] = fns.slice(0, 2);
    for (const src of sculptPaintSources(cache.sculpt.shape === 2 ? SCULPT_PAINT_SHAPE2 : SCULPT_PAINT_SHAPE1)) chain.push(wgslFn(src, chain.slice()));
    const [tiltFn, surface2Fn, wet2Fn] = [chain[10]!, chain[11]!, chain[12]!];
    return {
      tilt: () => tiltFn({ p: positionWorld, n: normalWorld, feature: attribute('meshFeature', 'vec4') }) as unknown as Node<'vec4'> & { xyz: Node<'vec3'>; w: Node<'float'> },
      surface: (pWorld: unknown, foot: unknown) => surface2Fn({
        pWorld: pWorld as never, pLocal: positionGeometry, feature: attribute('meshFeature', 'vec4'),
        boneColor: u.boneColor, deepColor: u.deepColor, foot: foot as never,
        woundTex: texture(woundTex), woundCount: u.woundCount,
      }) as unknown as { xyz: unknown; w: unknown },
      wet: (expo: unknown) => wet2Fn({ pLocal: positionGeometry, feature: attribute('meshFeature', 'vec4'), expo: expo as never }),
    };
  })() : null;
  // The owner's 4 list lights, per instance (iLights, an InstancedBufferAttribute on every batch
  // geometry, sized with the batch). The eye material reads it too (it reuses `lit`).
  const picksAttr = attribute('iLights', 'vec4');
  // The owner room's fill factor (Task 11b), per instance beside iLights, grown in step with it.
  const fillAttr = attribute('iFill', 'float');
  const listNode = (lightList ?? fallbackLightListNode()) as never;
  const featureAttr = attribute('meshFeature', 'vec4');
  const surf = surfaceFn({
    pWorld: positionWorld, pLocal: positionGeometry,
    feature: featureAttr,
    boneColor: u.boneColor, deepColor: u.deepColor, look: u.look,
    woundTex: texture(woundTex), woundCount: u.woundCount,
  }) as unknown as { xyz: unknown; w: unknown };
  // Per-fragment gloss from an INDEPENDENT wetness field: dry tissue stays
  // matte, wet patches keep a tight highlight, skull cavities get none. This
  // replaces the old blanket `max(look.z, 0.85)` gloss floor.
  const gloss = wetFn({ pLocal: positionGeometry, feature: featureAttr, expo: surf.w }) as never;
  const meshLook = vec4(
    u.look.x, u.look.y,
    mul(mul(u.look.z, gloss), MESH_SPEC_SCALE),
    mul(mul(u.look.w, gloss), MESH_FRES_SCALE),
  );
  const lightArgs = (surface: unknown, look: unknown, normal: unknown = normalWorld) => ({
    p: positionWorld, n: normal as never, camPos: cameraPosition,
    deepColor: u.deepColor, ambient: u.ambient, look: look as never,
    lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
    spotPos: u.spotPos, spotAxis: u.spotAxis, spotCfg: u.spotCfg, spotCfg2: u.spotCfg2, spotColor: u.spotColor,
    surfaceIn: surface as never,
    picks: picksAttr, lights: listNode, listOn: u.lightListCfg.x, fill: fillAttr,
  });
  const lit = (surface: unknown, look: unknown, normal: unknown = normalWorld) => vec4(shade(lightArgs(surface, look, normal)) as never, 1.0);
  const material = new MeshBasicNodeMaterial();
  material.name = SEGMENT_MATERIALS.bone;
  material.colorNode = lit(surf, meshLook);
  material.userData.sculptPaint = 1;
  // The second paint's bone material: the same name (it draws a bone segment), its own colour.
  let material2: MeshBasicNodeMaterial | null = null;
  if (paint2) {
    const tilt = paint2.tilt();
    const painted = paint2.surface(positionWorld, tilt.w);
    const wet = paint2.wet(painted.w) as never;
    material2 = new MeshBasicNodeMaterial();
    material2.name = SEGMENT_MATERIALS.bone;
    material2.colorNode = lit(painted, vec4(u.look.x, u.look.y, mul(mul(u.look.z, wet), MESH_SPEC_SCALE), mul(mul(u.look.w, wet), MESH_FRES_SCALE)), tilt.xyz);
    material2.userData.sculptPaint = 2;
    material2.depthWrite = true;
    material2.depthTest = true;
    material2.side = THREE.FrontSide;
  }
  let skullMaterial: MeshBasicNodeMaterial | null = null;
  // The anatomical plates' shading, in parts, for the closed material here and the split one below: the surface with
  // its craters read at `pWorld`, the atlas sample, the normal that sample tilts (from the fragment's own world
  // position and normal), and the look.
  let plate: { surface(pWorld: unknown): unknown; texel(): Node<'vec3'>; normal(texel: unknown): Node<'vec3'>; look: unknown } | null = null;
  if (cache.skullKit) {
    const sf = wgslFn(ANATOMICAL_SKULL_SURFACE_WGSL, fns.slice(0,2));
    const nf = wgslFn(ANATOMICAL_SKULL_NORMAL_WGSL);
    const kit = cache.skullKit;
    plate = {
      surface: pWorld => sf({pWorld:pWorld as never,pLocal:positionGeometry,boneColor:u.boneColor,deepColor:u.deepColor,
        woundTex:texture(woundTex),woundCount:u.woundCount}),
      texel: () => texture(kit.normalMap).xyz as unknown as Node<'vec3'>,
      normal: texel => nf({p:positionWorld,n:normalWorld,uv:uv(),texel:texel as never,
        normalScale:vec2(kit.normalScale.x,kit.normalScale.y)}) as unknown as Node<'vec3'>,
      look: vec4(u.look.x,u.look.y,mul(u.look.z,0.12),mul(u.look.w,0.10)),
    };
    skullMaterial = new MeshBasicNodeMaterial();
    skullMaterial.name = SEGMENT_MATERIALS.plate;
    skullMaterial.colorNode = lit(plate.surface(positionWorld),plate.look,plate.normal(plate.texel()));
    skullMaterial.depthTest = true; skullMaterial.depthWrite = true;
    skullMaterial.side = THREE.DoubleSide;
  }
  // Eye shader chain: hash -> noise -> sclera vessels -> surface -> emission.
  // Reuse identical TSL nodes: shade already includes these dependencies.
  // Recreating them emits duplicate WGSL declarations in the eye pipeline.
  const eyeFns: ReturnType<typeof wgslFn>[] = fns.slice(0, 2);
  for (const src of [
    MESH_EYE_VESSEL_WGSL, MESH_EYE_SURFACE_WGSL, MESH_EYE_EMISSION_WGSL,
  ]) eyeFns.push(wgslFn(src, eyeFns.slice()));
  const [eyeSurfaceFn, eyeEmissionFn] = [eyeFns[3]!, eyeFns[4]!];
  const eyeMaterial = new MeshBasicNodeMaterial();
  eyeMaterial.name = SEGMENT_MATERIALS.eye;
  const eyeSurface = eyeSurfaceFn({ p: positionGeometry });
  const eyeEmission = eyeEmissionFn({ p: positionGeometry }) as unknown as { xyz: Node<'vec3'> };
  // Eyes keep the previous uniform look path exactly (u.look === the old
  // wetLook under defaults); the eye material never reads meshFeature. The
  // restrained red pupil/iris glow is added AFTER the light compose: a
  // per-eye emissive term, not a scene light, and it never reaches the bone
  // material or the shared light uniforms.
  const eyeShaded = lit(eyeSurface, u.look) as unknown as { xyz: Node<'vec3'> };
  eyeMaterial.colorNode = vec4(add(eyeShaded.xyz, eyeEmission.xyz), 1.0);
  eyeMaterial.depthTest = true;
  eyeMaterial.depthWrite = true;
  // THE ORGAN MATERIAL (organs as mesh; mesh-organ.ts). Its surface and gloss are their own WGSL on the SAME hash and
  // noise nodes (a second copy would declare them twice in one pipeline, as the eye chain notes); the light compose is
  // the bone's with the cavity's occlusion on every light but the beam (meshOrganShade, built on the same body-lights
  // and boneShade nodes). No meshFeature, no split: an organ is one closed wet surface in its segment's frame.
  // Its one attribute of its own is `organTube` (mesh-organ-tubes.ts): where the vertex is on its tube, and its
  // crease shade. The detail normal (haustra, wrinkles) is a height over that, per pixel (meshOrganDetail).
  const organLook = {
    tint: uniform(new THREE.Vector4(0.72, 0.32, 0.30, 1)),
    cfg: uniform(new THREE.Vector4(...ORGAN_LOOKS[ORGAN_LOOK_DEFAULT].cfg)),
    gloss: uniform(new THREE.Vector4(...ORGAN_LOOKS[ORGAN_LOOK_DEFAULT].gloss)),
    occ: uniform(new THREE.Vector4(...ORGAN_LOOKS[ORGAN_LOOK_DEFAULT].occ)),
    detail: uniform(new THREE.Vector4(...ORGAN_LOOKS[ORGAN_LOOK_DEFAULT].detail)),
    relief: uniform(new THREE.Vector4(...ORGAN_LOOKS[ORGAN_LOOK_DEFAULT].relief)),
  };
  const organShade = wgslFn(MESH_ORGAN_SHADE_WGSL, fns.slice());
  const organSurfaceFn = wgslFn(MESH_ORGAN_SURFACE_WGSL, fns.slice(0, 2));
  const organWetFn = wgslFn(MESH_ORGAN_WET_WGSL, fns.slice(0, 2));
  const organHeightFn = wgslFn(MESH_ORGAN_HEIGHT_WGSL, fns.slice(0, 2));
  const organDetailFn = wgslFn(MESH_ORGAN_DETAIL_WGSL, [...fns.slice(0, 2), organHeightFn]);
  const organDetail = organDetailFn({
    n: normalWorld, pWorld: positionWorld, tube: attribute('organTube', 'vec4'), detail: organLook.detail,
    relief: organLook.relief,
  }) as unknown as { xyz: Node<'vec3'>; w: Node<'float'> };
  const organSurf = organSurfaceFn({
    pWorld: positionWorld, pLocal: positionGeometry, tint: organLook.tint, deepColor: u.deepColor, cfg: organLook.cfg,
    woundTex: texture(woundTex), woundCount: u.woundCount,
  });
  const organGloss = organWetFn({ pLocal: positionGeometry, lo: organLook.gloss.z }) as never;
  const organMaterial = new MeshBasicNodeMaterial();
  organMaterial.colorNode = vec4(organShade({
    ...lightArgs(organSurf, vec4(
      u.look.x, u.look.y,
      mul(mul(u.look.z, organGloss), organLook.gloss.x),
      mul(mul(u.look.w, organGloss), organLook.gloss.y),
    )),
    n: organDetail.xyz, occ: organLook.occ, gloss: organLook.gloss, cav: organDetail.w,
  }) as never, 1.0);
  organMaterial.depthTest = true;
  organMaterial.depthWrite = true;
  organMaterial.side = THREE.FrontSide;
  // THE SPLIT COPIES' MATERIALS (see the header). The clip takes the fragment back to the un-turned point q and
  // answers whether this copy's piece owns it; craters and bone exposure are stored on the closed head, so the
  // surface reads q where the closed material reads positionWorld. Lighting stays at the turned place. Two-sided: a
  // clipped shell shows its inside, and a back face is the bone's inner wall (three flips normalWorld there).
  const splitLook = {
    follow: null as SkullFollow | null,
    jag: uniform(new THREE.Vector4(HEAD_SPLIT.skull.jag.zigAmp, HEAD_SPLIT.skull.jag.zigLen, HEAD_SPLIT.skull.jag.chipAmp, HEAD_SPLIT.skull.jag.chipLen)),
    jagShape: uniform(new THREE.Vector4(HEAD_SPLIT.skull.jag.wobble, HEAD_SPLIT.skull.jag.wobbleAlong, HEAD_SPLIT.skull.jag.wobbleUp, HEAD_SPLIT.skull.jag.upFreq)),
    inside: uniform(new THREE.Color(...HEAD_SPLIT.skull.inside)),
    rim: uniform(new THREE.Vector4(...HEAD_SPLIT.skull.rim.color, HEAD_SPLIT.skull.rim.width)),
  };
  const jagFn = wgslFn(MESH_SPLIT_JAG_WGSL, fns.slice(0, 2));
  const clipFn = wgslFn(MESH_SPLIT_CLIP_WGSL, [...fns.slice(0, 2), jagFn]);
  const insideFn = wgslFn(MESH_SPLIT_INSIDE_WGSL);
  const record = {
    sn: attribute('iSplitN', 'vec4'), sh: attribute('iSplitH', 'vec4'), sa: attribute('iSplitA', 'vec4'),
    sk: attribute('iSplitK', 'vec4'), jag: splitLook.jag, shape: splitLook.jagShape,
  };
  const clip = clipFn({ pWorld: positionWorld, ...record }) as unknown as { xyz: Node<'vec3'>; w: Node<'float'> };
  const front = float(frontFacing);
  const splitSided = (m: MeshBasicNodeMaterial) => {
    m.maskNode = clip.w.greaterThanEqual(0.0);
    m.side = THREE.DoubleSide;
    m.depthTest = true;
    m.depthWrite = true;
  };
  const splitSurf = surfaceFn({
    pWorld: clip.xyz, pLocal: positionGeometry,
    feature: featureAttr,
    boneColor: u.boneColor, deepColor: u.deepColor, look: u.look,
    woundTex: texture(woundTex), woundCount: u.woundCount,
  }) as unknown as { xyz: unknown; w: unknown };
  const innerWall = (surface: unknown) => insideFn({ surface: surface as never, front, inside: splitLook.inside, keep: clip.w, rim: splitLook.rim });
  // The inner wall is wet all over, with no grazing sheen (it is a hollow); the outside keeps its patchy gloss.
  const splitGloss = mix(float(MESH_GLOSS_WET), wetFn({ pLocal: positionGeometry, feature: featureAttr, expo: splitSurf.w }) as never, front);
  // A clipped fragment is discarded by the mask, but a discard does not end the shader: the colour is behind a real
  // branch on the same test, so what the copy does not own skips the surface and the lighting. (Legal in a branch:
  // the surface reads its craters with textureLoad, and nothing in the chain takes a derivative.)
  // A colour that does take a derivative, or samples a texture, may not do it there: WGSL allows both only in uniform
  // control flow, and the branch is on a varying. It takes them in `ahead`, which runs before the branch and hands
  // its values to `colour`. Each must be declared there with .toVar(): a node that is not is written into the shader
  // where it is first read, which is inside the branch.
  const kept = <T = undefined>(colour: (ahead: T) => unknown, ahead?: () => T) => Fn(() => {
    const before = ahead?.() as T;
    const out = vec4(0.0, 0.0, 0.0, 1.0).toVar();
    If(clip.w.greaterThanEqual(0.0), () => { out.assign(colour(before) as never); });
    return out;
  })() as never;
  const splitMaterial = new MeshBasicNodeMaterial();
  splitMaterial.name = SEGMENT_MATERIALS.boneSplit;
  splitMaterial.colorNode = kept(() => lit(
    innerWall(splitSurf),
    vec4(u.look.x, u.look.y, mul(mul(u.look.z, splitGloss), MESH_SPEC_SCALE), mul(mul(mul(u.look.w, splitGloss), MESH_FRES_SCALE), front)),
  ));
  splitMaterial.userData.sculptPaint = 1;
  let splitMaterial2: MeshBasicNodeMaterial | null = null;
  if (paint2) {
    // The second paint's split copies: the same wall inside; outside, the painted surface read at the un-turned
    // point, under the tilted normal. The tilt's derivatives are taken ahead of the branch.
    splitMaterial2 = new MeshBasicNodeMaterial();
    splitMaterial2.name = SEGMENT_MATERIALS.boneSplit;
    splitMaterial2.userData.sculptPaint = 2;
    splitMaterial2.colorNode = kept(
      tilt => {
        const painted = paint2.surface(clip.xyz, tilt.w);
        const gloss2 = mix(float(MESH_GLOSS_WET), paint2.wet(painted.w) as never, front);
        return lit(
          innerWall(painted),
          vec4(u.look.x, u.look.y, mul(mul(u.look.z, gloss2), MESH_SPEC_SCALE), mul(mul(mul(u.look.w, gloss2), MESH_FRES_SCALE), front)),
          mix(normalWorld, tilt.xyz, front),
        );
      },
      () => paint2.tilt().toVar() as unknown as ReturnType<typeof paint2.tilt>,
    );
    splitSided(splitMaterial2);
  }
  splitSided(splitMaterial);
  /** The bone materials a segment geometry is drawn on, closed and split: its character's paint's (prepareGeometry
   *  writes the paint on the geometry; a split twin and a fragment carry their base's). */
  const boneMaterialOf = (geometry: THREE.BufferGeometry) => (geometry.userData.sculptPaint === 2 && material2 ? material2 : material);
  const boneSplitMaterialOf = (geometry: THREE.BufferGeometry) => (geometry.userData.sculptPaint === 2 && splitMaterial2 ? splitMaterial2 : splitMaterial);
  // A split eye: the eye's own surface outside, the same wall inside, and no glow from the back.
  const eyeSplitMaterial = new MeshBasicNodeMaterial();
  eyeSplitMaterial.name = SEGMENT_MATERIALS.eyeSplit;
  eyeSplitMaterial.colorNode = kept(() => {
    const shaded = lit(innerWall(eyeSurface), u.look) as unknown as { xyz: Node<'vec3'> };
    return vec4(add(shaded.xyz, mul(eyeEmission.xyz, front)), 1.0);
  });
  splitSided(eyeSplitMaterial);
  // A split anatomical plate. It is two-sided closed as well, its inside real geometry, so nothing of it is a wall:
  // both faces keep the plate's surface (its craters read at q, as the sculpt's are) and the closed plate's look, and
  // go to cut bone within the rim's width of the fracture. That is the fracture's own distance, not the clip's: the
  // clip's is to the copy's nearest edge, and on a plate's outside the hinge plane and the hold ball, where a half
  // meets the rest of the same bone, would be painted broken too. The normal is the closed material's own, from the
  // turned copy's position and normal (the instance matrix carries the turn): on a back face three hands it the
  // vertex normal turned to face the eye, and the atlas's tilt turns with it, so the inside of a plate is lit as a
  // surface facing the eye, split or closed.
  let skullSplitMaterial: MeshBasicNodeMaterial | null = null;
  if (plate) {
    const cutBoneFn = wgslFn(MESH_SPLIT_CUT_BONE_WGSL), parts = plate;
    const fractureFn = wgslFn(MESH_SPLIT_FRACTURE_WGSL, [...fns.slice(0, 2), jagFn]);
    skullSplitMaterial = new MeshBasicNodeMaterial();
    skullSplitMaterial.name = SEGMENT_MATERIALS.plateSplit;
    skullSplitMaterial.colorNode = kept(
      normal => lit(cutBoneFn({
        surface: parts.surface(clip.xyz) as never, keep: fractureFn({ q: clip.xyz, ...record }) as never, rim: splitLook.rim,
      }), parts.look, normal),
      // The atlas is sampled and the normal takes dpdx / dpdy: both ahead of the branch.
      () => parts.normal(parts.texel().toVar()).toVar(),
    );
    splitSided(skullSplitMaterial);
  }
  const eyeGeometry = new THREE.SphereGeometry(1, 24, 16);
  // Ejected eyes are plain meshes on the eye material, so they need an iLights of their own (one
  // instance, no owner: the old key). Their own geometry, so the eye batch can grow its attribute.
  const debrisEyeGeometry = eyeGeometry.clone();
  debrisEyeGeometry.setAttribute('iLights', new THREE.InstancedBufferAttribute(new Float32Array(4).fill(NO_OWNER_PICKS), 4));
  debrisEyeGeometry.setAttribute('iFill', new THREE.InstancedBufferAttribute(new Float32Array(1).fill(1), 1));
  let absent = new WeakMap<object, Set<number>>();
  const debris: { mesh: THREE.Mesh; velocity: THREE.Vector3; age: number; owner: object }[] = [];
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;

  // INSTANCED DRAWS (optimisation pass, 2026-09-26; owner: "instance the skeleton bones"). One
  // InstancedMesh per segment geometry (shared across actors through the cache) and one for every
  // seated eye, filled per update with this frame's drawn segments. It was one THREE.Mesh per live
  // segment per actor (~250 draws on Night Train). The shaders read `positionGeometry`, not
  // `positionLocal`: an InstancedMesh folds the instance matrix into positionLocal, and the
  // segment-local appearance (patches, teeth, iris) must stay in the segment's own frame.
  interface Batch { mesh: THREE.InstancedMesh; count: number; eye: boolean; organ: boolean; split: boolean; idle: number; owners: unknown[] }
  /** Take a batch out of the scene. A split batch's geometry is its twin (splitGeometryOf), which this renderer owns:
   *  disposed here, or three keeps it (its instance buffers, and through it the vertex data) for good. Disposing it
   *  also frees the GPU buffers of the vertex attributes it SHARES with the segment's geometry; three makes those
   *  again when the segment's geometry is next drawn (checked on the GPU: NOTES.md, B7). A closed batch's geometry is
   *  the cache's, or the eye's: not ours to dispose. */
  const dropBatch = (geo: THREE.BufferGeometry, b: Batch) => {
    group.remove(b.mesh); b.mesh.dispose();
    if (b.split) geo.dispose();
    batches.delete(geo);
  };
  const batches = new Map<THREE.BufferGeometry, Batch>();
  // The split copies' geometry for a segment (or the eye) geometry: the SAME vertex attributes and index (shared
  // objects, so one set of GPU buffers), and instance attributes of its own. The batch map is keyed by the geometry a
  // batch draws, so a closed batch and its split twin never share instance data.
  const splitGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
  const splitGeometryOf = (base: THREE.BufferGeometry): THREE.BufferGeometry => {
    let g = splitGeometries.get(base);
    if (!g) {
      const twin = new THREE.BufferGeometry();
      // Disposed with its batch (dropBatch): the next split of this segment makes a new twin.
      twin.addEventListener('dispose', () => { if (splitGeometries.get(base) === twin) splitGeometries.delete(base); });
      g = twin;
      for (const [name, attr] of Object.entries(base.attributes)) {
        if (!(attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) g.setAttribute(name, attr as THREE.BufferAttribute);
      }
      g.setIndex(base.index);
      // A plate's twin is a plate, and a bone's twin is under its bone's paint: batchFor picks the material by these.
      if (base.userData.anatomicalSkull) g.userData.anatomicalSkull = true;
      g.userData.sculptPaint = base.userData.sculptPaint;
      splitGeometries.set(base, g);
    }
    return g;
  };
  /** The geometry's per-instance `name` attribute (itemSize floats, `init` fill), at least `cap`
   *  instances (grown in step with the batch, contents kept). */
  const ensureInstanced = (geometry: THREE.BufferGeometry, name: string, itemSize: number, init: number, cap: number): THREE.InstancedBufferAttribute => {
    const cur = geometry.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
    if (cur && cur.count >= cap) return cur;
    const next = new THREE.InstancedBufferAttribute(new Float32Array(cap * itemSize).fill(init), itemSize);
    next.setUsage(THREE.DynamicDrawUsage);
    if (cur) (next.array as Float32Array).set(cur.array as Float32Array);
    geometry.setAttribute(name, next);
    return next;
  };
  /** A split geometry's records (mesh-split.ts packSplitInstance): ONE interleaved instance buffer of
   *  SPLIT_INSTANCE_FLOATS a row, read as the four vec4 attributes SPLIT_INSTANCE_ATTRS. One buffer, not four: the
   *  pipeline may bind 8 vertex buffers, and position, normal, meshFeature (an anatomical plate: uv in its place),
   *  the instance matrix, iLights and iFill are six. At least `cap` rows (grown with the batch; the rows are
   *  rewritten every update). */
  const splitRows = (geometry: THREE.BufferGeometry, cap = 0): THREE.InstancedInterleavedBuffer => {
    const cur = (geometry.getAttribute(SPLIT_INSTANCE_ATTRS[0]) as THREE.InterleavedBufferAttribute | undefined)?.data as THREE.InstancedInterleavedBuffer | undefined;
    if (cur && cur.count >= cap) return cur;
    const next = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * SPLIT_INSTANCE_FLOATS), SPLIT_INSTANCE_FLOATS);
    next.setUsage(THREE.DynamicDrawUsage);
    if (cur) (next.array as Float32Array).set(cur.array as Float32Array);
    SPLIT_INSTANCE_ATTRS.forEach((name, k) => geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(next, 4, k * 4)));
    return next;
  };
  /** iLights (4 packed picks) and iFill (1 float), both sized to `cap` instances; a split batch's records with them. */
  const ensureLights = (geometry: THREE.BufferGeometry, cap: number, split: boolean) => {
    ensureInstanced(geometry, 'iLights', 4, NO_OWNER_PICKS, cap);
    ensureInstanced(geometry, 'iFill', 1, 1, cap);
    if (split) splitRows(geometry, cap);
  };
  /** Upload only the live instances (M3): the attribute is DynamicDrawUsage, so three uploads it
   *  every frame, whole, unless a range is set; r186's WebGPU backend honours BufferAttribute
   *  updateRanges (and clears them after the write). */
  const markLive = (attr: THREE.InstancedBufferAttribute | THREE.InstancedInterleavedBuffer, count: number, floats = (attr as THREE.InstancedBufferAttribute).itemSize) => {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, Math.max(count, 1) * floats);
    attr.needsUpdate = true;
  };
  /** The batch that draws `geometry`. `split`: `geometry` is a splitGeometryOf, drawn on the split materials. */
  const batchFor = (geometry: THREE.BufferGeometry, eye: boolean, split = false, organ = false): Batch => {
    let b = batches.get(geometry);
    if (!b) {
      const anatomical = !eye && !!geometry.userData.anatomicalSkull;
      const closed = eye ? eyeMaterial : anatomical ? skullMaterial! : boneMaterialOf(geometry);
      const open = eye ? eyeSplitMaterial : anatomical ? skullSplitMaterial! : boneSplitMaterialOf(geometry);
      const mesh = new THREE.InstancedMesh(geometry, organ ? organMaterial : split ? open : closed, 16);
      mesh.name = organ ? 'skeleton-organs' : (eye ? 'skeleton-fleshy-eyes' : 'skeleton-segments') + (split ? '-split' : '');
      mesh.frustumCulled = false;
      mesh.layers.set(layer);
      mesh.count = 0;
      ensureLights(geometry, mesh.instanceMatrix.count, split);
      group.add(mesh);
      b = { mesh, count: 0, eye, organ, split, idle: 0, owners: [] };
      batches.set(geometry, b);
    }
    return b;
  };
  const push = (b: Batch, m: THREE.Matrix4, owner: unknown) => {
    if (b.count >= b.mesh.instanceMatrix.count) {
      const old = b.mesh;
      const grown = new THREE.InstancedMesh(old.geometry, old.material as THREE.Material, old.instanceMatrix.count * 2);
      grown.name = old.name; grown.frustumCulled = false; grown.layers.mask = old.layers.mask;
      (grown.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
      ensureLights(old.geometry, grown.instanceMatrix.count, b.split);
      group.remove(old); old.dispose();
      group.add(grown);
      b.mesh = grown;
    }
    b.owners[b.count] = owner;
    b.mesh.setMatrixAt(b.count++, m);
  };

  interface Slot { keys: string[]; eyes: { index: number; center: readonly [number, number, number]; radius: number }[][] }
  const slots: Slot[] = [];
  const preparedGeometry = new WeakSet<THREE.BufferGeometry>();
  const prepareGeometry = (geometry: THREE.BufferGeometry, source: BoneFieldSource) => {
    if (preparedGeometry.has(geometry)) return;
    preparedGeometry.add(geometry);
    const pos = geometry.getAttribute('position');
    if (source.kind === 'organ') {
      // The organ material reads no meshFeature, and always organTube: a swept mesh brings its own; an extracted one
      // has no tube coordinates (zero: meshOrganDetail leaves its normal alone) and no crease (w = 1).
      if (!geometry.getAttribute('organTube')) {
        const tube = new Float32Array(pos.count * 4);
        for (let i = 3; i < tube.length; i += 4) tube[i] = 1;
        geometry.setAttribute('organTube', new THREE.BufferAttribute(tube, 4));
      }
      return;
    }
    geometry.userData.sculptPaint = sculptPaintOf(cache.sculpt, source.character);
    const feature = new Float32Array(pos.count * 4);
    const isHead = source.segment === 'head' ? (source.character === 'soldier' ? 2 : 1) : 0;
    for (let i = 0; i < pos.count; i++) {
      const q = meshAppearanceCoord(source.bounds, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
      feature.set([q[0], q[1], q[2], isHead], i * 4);
    }
    geometry.setAttribute('meshFeature', new THREE.BufferAttribute(feature, 4));
  };
  const stats = {
    actors: 0, segments: 0, rigid: 0, limb: 0, hidden: 0, verts: 0, tris: 0,
    overflow: 0, clamped: 0, droppedQuads: 0, organs: 0,
  };
  const clear = () => {
    for (const [geo, b] of [...batches]) dropBatch(geo, b);
    drawn.length = 0;
    slots.length = 0;
    absent = new WeakMap();
    skullDamage = new WeakMap();
    exploded = new WeakSet();
    // The hooks of the last update answer for owners that are gone with it: a shot before the next one is the closed
    // head's, in the rigid pose.
    extraOf = undefined;
    splitOf = undefined;
    for (const d of debris) group.remove(d.mesh);
    debris.length = 0;
    stats.actors = stats.segments = stats.rigid = stats.limb = stats.hidden = 0;
    stats.verts = stats.tris = stats.overflow = stats.clamped = stats.droppedQuads = stats.organs = 0;
    group.visible = false;
  };
  const segM = new THREE.Matrix4(), eyeM = new THREE.Matrix4(), tmpM = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3(), qv = new THREE.Quaternion();
  const show = { bones: true, eyes: true, organs: true };
  /** Test/diagnostic view of this update's instanced draws. */
  const drawn: { owner: unknown; eye: boolean; organ: boolean; matrix: THREE.Matrix4; geometry: THREE.BufferGeometry; piece: 0 | 1 | 2 | null }[] = [];
  const turnM = new THREE.Matrix4(), pieceM = new THREE.Matrix4(), axisV = new THREE.Vector3(), hingeV = new THREE.Vector3();
  const shiftV = new THREE.Vector3(), centreV = new THREE.Vector3();
  const jagNow: SplitJag = { ...HEAD_SPLIT.skull.jag };
  /** The fracture the split materials draw with (splitLook's two uniforms, which the tuning seam sets), as the pure
   *  rule's SplitJag. */
  const liveJag = (): SplitJag => {
    const j = splitLook.jag.value, sh = splitLook.jagShape.value;
    jagNow.zigAmp = j.x; jagNow.zigLen = j.y; jagNow.chipAmp = j.z; jagNow.chipLen = j.w;
    jagNow.wobble = sh.x; jagNow.wobbleAlong = sh.y; jagNow.wobbleUp = sh.z; jagNow.upFreq = sh.w;
    return jagNow;
  };
  /** The turn of `piece`'s copy of the split `skull`, written into `out`: T(h) R(a, angle) T(-h), the piece's bone
   *  angle about the hinge line, in the world (it premultiplies a world matrix). Null for a piece that does not turn
   *  (the rest, a half whose bone stays): its copy is where the closed head has it. */
  const pieceTurn = (skull: SkullSplit, piece: 0 | 1 | 2, out: THREE.Matrix4): THREE.Matrix4 | null => {
    const angle = skullPieceAngle(skull, piece);
    if (angle === 0) return null;
    const w = skull.frame.w;
    hingeV.set(w.h[0], w.h[1], w.h[2]);
    out.makeRotationAxis(axisV.set(w.a[0], w.a[1], w.a[2]), angle);
    return out.setPosition(shiftV.copy(hingeV).applyMatrix4(out).negate().add(hingeV));
  };
  /** Draw one segment (or eye) whose closed world matrix is `m` and whose bone lies in the sphere `centre`, `radius`
   *  of the closed head. `skull` null, or a sphere the rest owns alone: one instance in the closed batch, as ever.
   *  Else one copy per piece that owns part of the sphere, in the split batch: the rest at `m`, a half turned about
   *  the hinge by its bone angle, each with its split record. Returns the instances drawn. */
  const drawPieces = (
    geometry: THREE.BufferGeometry, eye: boolean, m: THREE.Matrix4, owner: unknown, skull: SkullSplit | null,
    centre: THREE.Vector3, radius: number, organ = false,
  ): number => {
    const mask = skull ? skullPieces(skull, [centre.x, centre.y, centre.z], radius + meshSplitJagMax(liveJag())) : 1;
    if (!skull || mask === 1) {
      push(batchFor(geometry, eye, false, organ), m, owner);
      drawn.push({ owner, eye, organ, matrix: m.clone(), geometry, piece: null });
      return 1;
    }
    let copies = 0;
    const sg = splitGeometryOf(geometry), b = batchFor(sg, eye, true);
    for (const piece of [0, 1, 2] as const) {
      if (!(mask & (1 << piece))) continue;
      // The turn about the hinge line, premultiplied (the instance matrix is the world's).
      const turn = pieceTurn(skull, piece, turnM);
      const copy = turn ? pieceM.multiplyMatrices(turn, m) : m;
      push(b, copy, owner);
      packSplitInstance(splitRows(sg).array as Float32Array, b.count - 1, skull, piece);
      drawn.push({ owner, eye, organ: false, matrix: copy.clone(), geometry: sg, piece });
      copies++;
    }
    return copies;
  };
  /** Draw one bone geometry of the segment at segM, whose bone lies in the box `min`..`max` of the segment's frame:
   *  once per piece of the split `skull` that owns part of that box (drawPieces; null: the closed draw). A split
   *  geometry's vertices and triangles count once per copy. `scale` is segM's largest axis scale. */
  const drawBone = (
    geometry: THREE.BufferGeometry, min: readonly number[], max: readonly number[], verts: number, tris: number,
    owner: unknown, skull: SkullSplit | null, scale: number,
  ) => {
    let radius = 0;
    if (skull) {
      centreV.set((min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2).applyMatrix4(segM);
      radius = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) / 2 * scale;
    }
    const copies = drawPieces(geometry, false, segM, owner, skull, centreV, radius);
    stats.verts += verts * copies;
    stats.tris += tris * copies;
  };
  let skullDamage = new WeakMap<object,SkullDamage>();
  let extraOf: ((owner: object, segment: string) => ArrayLike<number> | null) | undefined;
  let splitOf: { warp(owner: object, segment: string): SplitWarp | null; seed?(owner: object): number } | undefined;
  /** The skull's own split of `owner`'s `segment`, for the split the march draws there (the last update's `split`
   *  hook; null: closed). The draw and the hit path both ask here, so a shot meets the copies that are drawn. */
  const skullSplitFor = (owner: object, segment: string): SkullSplit | null => {
    const drawnSplit = splitOf?.warp(owner, segment) ?? null;
    return drawnSplit ? skullSplitOf(drawnSplit, splitLook.follow, splitOf?.seed?.(owner) ?? 0) : null;
  };
  const headMatrix = (owner: object, source: BoneFieldSource): THREE.Matrix4 => {
    const p = source.pose();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p.origin),new THREE.Quaternion(...p.quat),one);
    const extra = extraOf?.(owner,'head');
    if (extra) m.premultiply(new THREE.Matrix4().fromArray(extra));
    return m;
  };
  /** Release the plates `indices` as fragments. `turnOf` null (a closed head): each from the closed head's frame.
   *  Else each from that frame turned as `turnOf` answers for it (the plate's index, and its pivot on the closed
   *  head, in the world): the turn of the piece whose copy draws it (pieceTurn; null for a piece that does not turn).
   *  The turn carries the fragment's position, its orientation and its launch. */
  const detach = (
    owner: object, source: BoneFieldSource, skull: FittedSkull, indices: number[], direction: Vec3,
    turnOf: ((index: number, pivot: Vec3) => THREE.Matrix4 | null) | null = null,
  ) => {
    if (!spawnSkull || !skullMaterial) return;
    const closed = headMatrix(owner,source);
    const centre = skull.mesh.geometry.boundingSphere!.center;
    for (const index of indices) {
      const piece = skull.pieces[index]!;
      const turn = turnOf ? turnOf(index, new THREE.Vector3(...piece.pivot).applyMatrix4(closed).toArray() as Vec3) : null;
      const matrix = turn ? turn.clone().multiply(closed) : closed;
      // Geometry has per-instance light attributes: free debris needs its own
      // light row, so two victims in different rooms cannot overwrite it.
      const geometry = piece.debrisGeometry.clone();
      geometry.userData.ownedSkullDebris = true;
      const mesh = new THREE.Mesh(geometry,skullMaterial);
      ensureLights(geometry, 1, false);
      for (const batch of batches.values()) {
        const slot = batch.owners.indexOf(owner);
        if (slot < 0) continue;
        const lights = batch.mesh.geometry.getAttribute('iLights');
        const fill = batch.mesh.geometry.getAttribute('iFill');
        const target = geometry.getAttribute('iLights') as THREE.InstancedBufferAttribute;
        target.setXYZW(0,lights.getX(slot),lights.getY(slot),lights.getZ(slot),lights.getW(slot));
        (geometry.getAttribute('iFill') as THREE.InstancedBufferAttribute).setX(0,fill.getX(slot));
        break;
      }
      mesh.layers.set(layer);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(matrix).setPosition(0,0,0);
      const group = new THREE.Group(); group.name = `skull-fragment:${piece.id}`; group.add(mesh);
      group.layers.set(layer);
      const pivot = new THREE.Vector3(...piece.pivot).applyMatrix4(matrix);
      const localDirection = new THREE.Vector3(...direction).transformDirection(matrix.clone().invert());
      const launch = skullPieceLaunch(piece.pivot,centre.toArray() as Vec3,localDirection.toArray() as Vec3,index);
      const velocity = new THREE.Vector3(...launch.velocity).transformDirection(matrix).multiplyScalar(Math.hypot(...launch.velocity));
      const size = new THREE.Vector3(...piece.max).sub(new THREE.Vector3(...piece.min));
      const scales = new THREE.Vector3().setFromMatrixScale(matrix);
      const stretch = Math.max(scales.x,scales.y,scales.z);
      // Actual extremal vertices in 26 directions approximate the convex
      // support hull. Thin plates land on their surface, not a huge sphere.
      const position = geometry.getAttribute('position');
      const points = Array.from({length:position.count},(_,i)=>new THREE.Vector3(position.getX(i),position.getY(i),position.getZ(i)).applyMatrix4(mesh.matrix));
      const support: {c:Vec3;r:number}[] = [];
      const used = new Set<number>();
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++) {
        if(!x&&!y&&!z)continue;
        const axis = new THREE.Vector3(x,y,z);let best=0,value=-Infinity;
        points.forEach((p,i)=>{const d=p.dot(axis);if(d>value){value=d;best=i;}});
        if(!used.has(best)){used.add(best);support.push({c:points[best]!.toArray() as Vec3,r:0.001});}
      }
      spawnSkull(group,pivot.toArray() as Vec3,velocity.toArray() as Vec3,launch.angular,Math.max(0.012,size.length()*.5*stretch),support);
    }
  };

  /** The live head of `sources` that carries the anatomical skull (undefined: none). */
  /** A head's eye seats, head-local: the orbits of an anatomical skull fitted to the head's flesh (FittedSkull.eyes),
   *  else the sculpted skull's sockets. The one answer for the seated eyes, their copies in a split head and the
   *  ejected ones. */
  const eyeSeats = (source: BoneFieldSource): readonly MeshEyePlacement[] =>
    cache.skullKit?.head(source)?.eyes ?? meshEyePlacements(meshBoneSource(source, cache.sculpt.shape));
  const skullSourceOf = (sources: readonly BoneFieldSource[]) => sources.find(s=>s.segment==='head' && s.isLive() && cache.skullKit?.supports(s));
  /** What the world ray `point` + t `direction`, `reach` long, meets on `owner`'s anatomical skull where it is drawn
   *  (`hit` null: no bone), with the skull, its split and its damage as the ray found them. Null: no such skull. */
  const meetSkull = (owner: object, sources: readonly BoneFieldSource[], point: Vec3, direction: Vec3, reach: number) => {
      const skullSource = skullSourceOf(sources);
      const skull = skullSource && cache.skullKit?.head(skullSource);
      if (!skullSource || !skull || !spawnSkull) return null;
      const matrix = headMatrix(owner,skullSource), inverse = matrix.clone().invert();
      // The closed head's frame, the plates' own. A closed head's ray is taken into it as it always was.
      const frame: SkullHeadFrame = {
        toLocal: p => new THREE.Vector3(...p).applyMatrix4(inverse).toArray() as Vec3,
        toWorld: p => new THREE.Vector3(...p).applyMatrix4(matrix).toArray() as Vec3,
        dirToLocal: v => new THREE.Vector3(...v).transformDirection(inverse).toArray() as Vec3,
      };
      const split = skullSplitFor(owner,skullSource.segment);
      const before = skullDamage.get(owner) ?? intactSkull(skull.pieces.length);
      const hit = skullSplitRayHit(skull.pieces,before,split,frame,[...point] as Vec3,[...direction] as Vec3,liveJag(),reach);
      return { skullSource, skull, split, before, hit };
  };
  /** Cast that ray and damage the plate it meets (null: none). A plate that breaks leaves from the copy the ray met. */
  const castSkull = (
    owner: object, sources: readonly BoneFieldSource[], point: Vec3, direction: Vec3, kind: 'pellet' | 'slug', reach: number,
  ): { released: number; plate: number | null } => {
      const met = meetSkull(owner,sources,point,direction,reach);
      if (!met) return { released: 0, plate: null };
      const { hit, split } = met;
      const result = damageSkull(met.before,hit ? hit.plate : null,kind);
      skullDamage.set(owner,result.state);
      // The plate that breaks is the one that was hit: it leaves from the copy the ray met.
      detach(owner,met.skullSource,met.skull,result.detached,[...direction] as Vec3,split && hit ? () => pieceTurn(split,hit.piece,turnM) : null);
      return { released: result.detached.length, plate: hit ? hit.plate : null };
  };
  const fractureSkull = (owner: object, sources: readonly BoneFieldSource[], point: Vec3, direction: Vec3, kind: 'pellet' | 'slug'): number =>
    castSkull(owner,sources,point,direction,kind,SKULL_REACH).released;
  /** One step of a projectile at `owner`'s skull (skull-split-hit.ts skullShotCast decides the ray). The head is OPEN
   *  when the march draws its split (the last update's hook) and its skull is the anatomical one: only then does the
   *  step's start, a step with no flesh, or the projectile's memory `by` matter. Returns the plates released. */
  const shootSkull = (owner: object, sources: readonly BoneFieldSource[], step: SkullShotStep, kind: 'pellet' | 'slug', by?: SkullStrikes): number => {
    const source = spawnSkull && splitOf?.warp(owner,'head') ? skullSourceOf(sources) : undefined;
    const skull = source && cache.skullKit?.head(source);
    const open = !!source && !!skull;
    const cast = skullShotCast(open, step, open && skullStruck(by,owner), () => {
      // Every copy of the skull, the closed bone's sphere turned about the hinge.
      const m = headMatrix(owner,source!), sphere = skull!.mesh.geometry.boundingSphere!;
      return skullCopiesBound(sphere.center.clone().applyMatrix4(m).toArray() as Vec3, sphere.radius * m.getMaxScaleOnAxis(), skullSplitFor(owner,'head'));
    });
    if (!cast) return 0;
    const hit = castSkull(owner,sources,cast.origin,cast.direction,kind,cast.reach);
    if (open && by && hit.plate !== null) (by.skulls ??= []).push(owner);
    return hit.released;
  };
  // THE SCULPTED SKULL'S FRAGMENTS (sculpt-fragments.ts): one prototype geometry a fragment, cut from a head mesh at
  // its first pop and kept with it. A thrown fragment is a clone (its own light row, as a plate's debris has).
  interface FragmentProto { id: string; geometry: THREE.BufferGeometry; pivot: Vec3; min: Vec3; max: Vec3 }
  const sculptFragments = new WeakMap<THREE.BufferGeometry, FragmentProto[]>();
  const fragmentCuts = { meshes: 0, lastMs: 0 };
  /** Fragments with fewer triangles than this are not thrown: on a head neither sculpt carves (the cultist's plain
   *  bone) some regions hold a sliver or nothing. Both sculpts' smallest fragment has over 150. */
  const FRAGMENT_MIN_TRIS = 12;
  const fragmentsOf = (base: THREE.BufferGeometry, source: BoneFieldSource): FragmentProto[] => {
    let list = sculptFragments.get(base);
    if (list) return list;
    const t0 = performance.now();
    const attrs: Record<string, { array: ArrayLike<number>; itemSize: number }> = {};
    for (const name of ['position', 'normal', 'meshFeature']) {
      const a = base.getAttribute(name);
      if (a) attrs[name] = { array: a.array, itemSize: a.itemSize };
    }
    list = [];
    for (const f of partitionSculptMesh(base.getAttribute('position').array, base.index!.array, source.bounds)) {
      if (f.indices.length / 3 < FRAGMENT_MIN_TRIS) continue;
      const data = fragmentVertexData(f, attrs);
      const geometry = new THREE.BufferGeometry();
      for (const [name, array] of Object.entries(data.attributes)) geometry.setAttribute(name, new THREE.BufferAttribute(array, attrs[name]!.itemSize));
      geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
      list.push({ id: f.id, geometry, pivot: f.pivot, min: f.min, max: f.max });
    }
    fragmentCuts.meshes++;
    fragmentCuts.lastMs = performance.now() - t0;
    sculptFragments.set(base, list);
    return list;
  };
  /** Owners whose sculpted skull has been thrown: their head segment is not drawn again. */
  let exploded = new WeakSet<object>();
  /** Take `owner`'s instances out of the batches that draw `base` (closed, and its split twin) as they stand: the
   *  matrix goes to zero scale, and the diagnostics' list drops them. The next update leaves them out by itself. */
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  const undraw = (owner: object, base: THREE.BufferGeometry) => {
    for (const g of [base, splitGeometries.get(base)]) {
      const b = g && batches.get(g);
      if (!b) continue;
      for (let i = 0; i < b.count; i++) if (b.owners[i] === owner) { b.mesh.setMatrixAt(i, zeroM); b.mesh.instanceMatrix.needsUpdate = true; }
      for (let i = drawn.length - 1; i >= 0; i--) if (drawn[i]!.owner === owner && drawn[i]!.geometry === g) drawn.splice(i, 1);
    }
  };
  /** explodeSkull for a sculpted head (the interface's note). */
  const explodeSculpt = (owner: object, sources: readonly BoneFieldSource[], direction: Vec3): number => {
    const source = sources.find(s => s.segment === 'head' && s.kind !== 'organ');
    if (!spawnSkull || !source || cache.skullKit?.supports(source) || exploded.has(owner)) return 0;
    const base = cache.get(source).geometry;
    if (!base.index) return 0;
    prepareGeometry(base, source);
    const fragments = fragmentsOf(base, source);
    exploded.add(owner);
    const closed = headMatrix(owner, source);
    const split = skullSplitFor(owner, source.segment), jag = liveJag();
    const b = source.bounds;
    const centre: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    // The owner's light row, from the batch that was drawing its head (or any of its bones).
    let picks: [number, number, number, number] | null = null, fill = 1;
    for (const g of [base, splitGeometries.get(base)]) {
      const batch = g && batches.get(g), slot = batch ? batch.owners.indexOf(owner) : -1;
      if (!batch || slot < 0) continue;
      const lights = batch.mesh.geometry.getAttribute('iLights');
      picks = [lights.getX(slot), lights.getY(slot), lights.getZ(slot), lights.getW(slot)];
      fill = batch.mesh.geometry.getAttribute('iFill').getX(slot);
      break;
    }
    undraw(owner, base);
    undraw(owner, eyeGeometry);
    fragments.forEach((f, index) => {
      const pivotWorld = new THREE.Vector3(...f.pivot).applyMatrix4(closed);
      // A split head: the fragment leaves from the turn of the piece that owns its pivot, as a plate does.
      const turn = split ? pieceTurn(split, skullOwnerAt(split, pivotWorld.toArray() as Vec3, jag), turnM) : null;
      const matrix = turn ? turn.clone().multiply(closed) : closed;
      const geometry = f.geometry.clone();
      geometry.userData.ownedSkullDebris = true;
      // One instance: its light row, and a split record of zeros, which keeps every fragment of the mesh (the piece
      // is the rest and neither half turns: mesh-split.ts MESH_SPLIT_CLIP_WGSL) and leaves the surface where it is.
      ensureLights(geometry, 1, true);
      if (picks) (geometry.getAttribute('iLights') as THREE.InstancedBufferAttribute).setXYZW(0, picks[0], picks[1], picks[2], picks[3]);
      (geometry.getAttribute('iFill') as THREE.InstancedBufferAttribute).setX(0, fill);
      // The split material of the head's own paint: the painted bone outside, the dark inner wall on back faces,
      // two-sided.
      const mesh = new THREE.Mesh(geometry, boneSplitMaterialOf(base));
      mesh.layers.set(layer);
      mesh.matrixAutoUpdate = false;
      // The vertices stay in the head's own frame (the paint reads them there): the pivot is moved to the origin.
      mesh.matrix.copy(matrix).setPosition(0, 0, 0).multiply(tmpM.makeTranslation(-f.pivot[0], -f.pivot[1], -f.pivot[2]));
      const piece = new THREE.Group(); piece.name = `skull-fragment:${f.id}`; piece.add(mesh);
      piece.layers.set(layer);
      const pivot = new THREE.Vector3(...f.pivot).applyMatrix4(matrix);
      const localDirection = new THREE.Vector3(...direction).transformDirection(matrix.clone().invert());
      const launch = skullPieceLaunch(f.pivot, centre, localDirection.toArray() as Vec3, index);
      const velocity = new THREE.Vector3(...launch.velocity).transformDirection(matrix).multiplyScalar(Math.hypot(...launch.velocity));
      const size = new THREE.Vector3(...f.max).sub(new THREE.Vector3(...f.min));
      const scales = new THREE.Vector3().setFromMatrixScale(matrix);
      // The extremal vertices in 26 directions stand for the convex support hull, as a plate's do.
      const position = geometry.getAttribute('position');
      const points = Array.from({ length: position.count }, (_, i) => new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrix));
      const support: { c: Vec3; r: number }[] = [];
      const used = new Set<number>();
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        if (!x && !y && !z) continue;
        const axis = new THREE.Vector3(x, y, z); let best = 0, value = -Infinity;
        points.forEach((q, i) => { const d = q.dot(axis); if (d > value) { value = d; best = i; } });
        if (!used.has(best)) { used.add(best); support.push({ c: points[best]!.toArray() as Vec3, r: 0.001 }); }
      }
      spawnSkull(piece, pivot.toArray() as Vec3, velocity.toArray() as Vec3, launch.angular, Math.max(0.012, size.length() * 0.5 * Math.max(scales.x, scales.y, scales.z)), support);
    });
    return fragments.length;
  };
  return {
    object: group,
    uniforms: u,
    fractureSkull,
    skullPass: (owner, sources, from, to, direction, kind, by) => shootSkull(owner,sources,{ from, to, direction, flesh: null },kind,by),
    skullRay(owner, sources, point, direction, reach = SKULL_REACH) {
      const hit = meetSkull(owner,sources,point,direction,reach)?.hit;
      return hit ? { plate: cache.skullKit!.source[hit.plate]!.id, piece: hit.piece, distance: hit.distance } : null;
    },
    impact(owner, sources, point, direction, kind, step) {
      if (step) shootSkull(owner,sources,{ from: step.from, to: [...point], direction: [...direction], flesh: [...point] },kind,step.by);
      else fractureSkull(owner,sources,point,direction,kind);
      const head = sources.find(s => s.segment === 'head' && s.isLive() && (s.character === 'zombie' || cache.skullKit?.supports(s)));
      if (!head) return 0;
      const eyes = eyeSeats(head);
      const lost = absent.get(owner) ?? new Set<number>();
      absent.set(owner, lost);
      let count = 0;
      for (const i of meshEyeImpactIndices(eyes, head.toLocal(point), kind)) {
        if (lost.has(i)) continue;
        lost.add(i); count++;
        const eye = eyes[i]!;
        const mesh = new THREE.Mesh(debrisEyeGeometry, eyeMaterial);
        mesh.layers.set(layer);
        mesh.name = 'skeleton-ejected-eye';
        mesh.position.set(...head.toWorld(eye.center));
        mesh.scale.setScalar(eye.radius);
        mesh.quaternion.set(...head.pose().quat);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
        const velocity = forward.multiplyScalar(1.8).addScaledVector(new THREE.Vector3(...direction), 0.6);
        velocity.y += 1.15;
        debris.push({ mesh, velocity, age: 0, owner }); group.add(mesh);
      }
      return count;
    },
    skullState(owner) {
      const missing = skullDamage.get(owner)?.missing ?? 0;
      return { missing, pieces: cache.skullKit ? cache.skullKit.source.filter((_,i)=>missing & (1<<i)).map(p=>p.id) : [] };
    },
    fragmentStats: () => ({ ...fragmentCuts }),
    explodeSkull(owner,sources,direction) {
      const source = sources.find(s=>s.segment==='head' && cache.skullKit?.supports(s));
      const skull = source && cache.skullKit?.head(source);
      // No anatomical skull on this head: the sculpted mesh is cut into fragments.
      if (!source || !skull || !spawnSkull) return explodeSculpt(owner, sources, direction);
      const result = explodeSkull(skullDamage.get(owner) ?? intactSkull(skull.pieces.length));
      skullDamage.set(owner,result.state);
      // A plate the fracture runs through is drawn in two copies; the fragment is the whole plate, and goes with the
      // piece that owns its pivot.
      const split = skullSplitFor(owner,source.segment), jag = liveJag();
      detach(owner,source,skull,result.detached,direction,split ? (_index,pivot) => pieceTurn(split,skullOwnerAt(split,pivot,jag),turnM) : null);
      return result.detached.length;
    },
    eyeState(owner) { return { missing: [...(absent.get(owner) ?? [])], debris: debris.filter(d => d.owner === owner).length }; },
    stepDebris(dt) {
      const step = Math.min(Math.max(dt, 0), 0.05);
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i]!; d.age += step;
        d.velocity.y -= 9.8 * step;
        d.mesh.position.addScaledVector(d.velocity, step);
        d.mesh.rotateX(step * 7); d.mesh.rotateY(step * 4);
        if (d.mesh.position.y < 0.025) { d.mesh.position.y = 0.025; d.velocity.multiplyScalar(0.35); d.velocity.y = Math.abs(d.velocity.y); }
        if (d.age > 2.5) { group.remove(d.mesh); debris.splice(i, 1); }
      }
    },
    update(entries, owners, shown, exposed, extra, split, reach) {
      extraOf = extra;
      splitOf = split;
      stats.actors = entries.length;
      stats.segments = stats.rigid = stats.limb = stats.hidden = stats.organs = 0;
      stats.verts = stats.tris = 0;
      stats.overflow = stats.clamped = stats.droppedQuads = 0;
      drawn.length = 0;
      for (const b of batches.values()) b.count = 0;
      const liveOwners = new Set(owners ?? entries);
      for (let i = debris.length - 1; i >= 0; i--) if (owners && !liveOwners.has(debris[i]!.owner)) { group.remove(debris[i]!.mesh); debris.splice(i, 1); }
      batchFor(eyeGeometry, true);
      entries.forEach((srcs, ai) => {
        let slot = slots[ai];
        if (!slot) { slot = { keys: [], eyes: [] }; slots[ai] = slot; }
        const owner = owners?.[ai] ?? slot;
        slot.keys.length = Math.min(slot.keys.length, srcs.length);
        slot.eyes.length = Math.min(slot.eyes.length, srcs.length);
        const lost = absent.get(owner);
        srcs.forEach((s, si) => {
          const baked = cache.get(s);
          prepareGeometry(baked.geometry, s);
          if (slot!.keys[si] !== baked.key) {
            // Revision swap (anatomy/sever re-derive): the eye seats come from the new source.
            slot!.keys[si] = baked.key;
            slot!.eyes[si] = [...eyeSeats(s).entries()].map(([index, e]) => ({ index, center: e.center, radius: e.radius }));
          }
          const eyes = (slot!.eyes[si] ?? []).filter(e => !lost?.has(e.index));
          stats.segments++;
          if (s.rigidity === 'rigid') stats.rigid++; else stats.limb++;
          if (baked.overflow) stats.overflow++;
          if (baked.clamped) stats.clamped++;
          if (baked.droppedQuads) stats.droppedQuads += baked.droppedQuads;
          // Visual-actor cull + bone exposure cull: a culled segment is simply not an instance
          // this frame (no pose read, no write).
          const organ = s.kind === 'organ';
          // A sculpted skull that has been thrown as fragments is not drawn again, whatever the source says.
          if (!organ && s.segment === 'head' && exploded.has(owner as object)) { stats.hidden++; return; }
          const live = segmentDrawn(s.isLive(), owner, shown)
            && (organ ? (!exposed || exposed.has(owner)) : segmentNeeded(owner, eyes.length > 0, exposed));
          if (!live) { stats.hidden++; return; }
          const pose = s.pose();
          if (organ) {
            // An organ is drawn only where one of its owner's wounds reaches it (the pose is read first: the bound
            // is the posed one). No extra affine, no split, no eyes.
            const bound = segmentBoundSphere(s.bounds, pose);
            if (!organNeeded(owner, exposed, reach ? reach(owner as object) : undefined, bound.centre, bound.radius)) { stats.hidden++; return; }
            pv.set(pose.origin[0], pose.origin[1], pose.origin[2]);
            qv.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
            segM.compose(pv, qv, one);
            stats.organs += drawPieces(baked.geometry, false, segM, owner, null, centreV, 0, true);
            stats.verts += baked.verts;
            stats.tris += baked.tris;
            return;
          }
          pv.set(pose.origin[0], pose.origin[1], pose.origin[2]);
          qv.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
          segM.compose(pv, qv, one);
          // The group sits at the scene origin, so the instance matrix IS the
          // world matrix and a world-space affine premultiplies it.
          const x = extra?.(owner as object, s.segment) ?? null;
          if (x) segM.premultiply(extraM.fromArray(x));
          // The head split: the skull's own split for the one the march draws (null: closed, and the draws below
          // are the closed ones).
          const skull = skullSplitFor(owner as object, s.segment);
          const scale = skull ? segM.getMaxScaleOnAxis() : 1;
          // An anatomical skull that has lost plates (skull-fracture.ts) is drawn as its surviving plates, each one
          // a segment geometry of its own; whole, it is the one merged geometry `baked`.
          const fitted = cache.skullKit?.head(s) ?? null;
          const missing = fitted ? skullDamage.get(owner as object)?.missing ?? 0 : 0;
          if (fitted && missing) {
            for (let i = 0; i < fitted.pieces.length; i++) {
              if (missing & (1 << i)) continue;
              const plate = fitted.pieces[i]!;
              prepareGeometry(plate.geometry, s);
              drawBone(plate.geometry, plate.min, plate.max, plate.geometry.getAttribute('position').count, plate.geometry.index!.count / 3, owner, skull, scale);
            }
          } else {
            // The whole skull's box: the bone envelope holds the envelope fit, and a skull fitted to the flesh
            // (FittedSkull.fit) brings its own, which may stand outside it.
            const box = fitted?.fit ?? s.bounds;
            drawBone(baked.geometry, box.min, box.max, baked.verts, baked.tris, owner, skull, scale);
          }
          for (const e of eyes) {
            eyeM.copy(segM).multiply(tmpM.makeTranslation(e.center[0], e.center[1], e.center[2]))
              .multiply(tmpM.makeScale(e.radius, e.radius, e.radius));
            if (skull) centreV.setFromMatrixPosition(eyeM);
            drawPieces(eyeGeometry, true, eyeM, owner, skull, centreV, e.radius * scale);
          }
        });
      });
      slots.length = entries.length;
      for (const [geo, b] of batches) {
        b.mesh.count = b.count;
        b.owners.length = b.count;
        b.mesh.visible = b.count > 0 && (b.organ ? show.organs : b.eye ? show.eyes : show.bones);
        if (b.count > 0) {
          b.mesh.instanceMatrix.needsUpdate = true; b.idle = 0;
          if (b.split) markLive(splitRows(geo), b.count, SPLIT_INSTANCE_FLOATS);
        }
        // A segment geometry nobody has drawn for a while (a revision replaced it: a sever, an
        // anatomy change) drops its batch; the cache owns the geometry itself.
        else if (!b.eye && ++b.idle > BATCH_IDLE_UPDATES) dropBatch(geo, b);
      }
      group.visible = stats.segments > 0;
    },
    syncLights(lightsOf, fillOf) {
      for (const b of batches.values()) {
        if (b.count === 0) continue;
        const attr = b.mesh.geometry.getAttribute('iLights') as THREE.InstancedBufferAttribute;
        const fAttr = b.mesh.geometry.getAttribute('iFill') as THREE.InstancedBufferAttribute;
        const arr = attr.array as Float32Array;
        const fArr = fAttr.array as Float32Array;
        for (let i = 0; i < b.count; i++) {
          const owner = b.owners[i];
          const l = lightsOf(owner);
          const o = i * 4;
          if (l) { arr[o] = l.x; arr[o + 1] = l.y; arr[o + 2] = l.z; arr[o + 3] = l.w; }
          else { arr[o] = NO_OWNER_PICKS; arr[o + 1] = NO_OWNER_PICKS; arr[o + 2] = NO_OWNER_PICKS; arr[o + 3] = NO_OWNER_PICKS; }
          fArr[i] = l && fillOf ? fillOf(owner) : 1;
        }
        markLive(attr, b.count);
        markLive(fAttr, b.count);
      }
    },
    ownerLights(owner) {
      const out: number[][] = [];
      for (const b of batches.values()) {
        const arr = (b.mesh.geometry.getAttribute('iLights') as THREE.InstancedBufferAttribute).array as Float32Array;
        for (let i = 0; i < b.count; i++) if (b.owners[i] === owner) out.push(Array.from(arr.subarray(i * 4, i * 4 + 4)));
      }
      return out;
    },
    ownerFill(owner) {
      const out: number[] = [];
      for (const b of batches.values()) {
        const arr = (b.mesh.geometry.getAttribute('iFill') as THREE.InstancedBufferAttribute).array as Float32Array;
        for (let i = 0; i < b.count; i++) if (b.owners[i] === owner) out.push(arr[i]!);
      }
      return out;
    },
    setWounds(wounds) {
      const n = Math.min(wounds.length, MAX_WOUNDS_TEX);
      for (let i = 0; i < n; i++) {
        const w = wounds[i]!;
        woundData.set([w.pos[0], w.pos[1], w.pos[2], w.radius], i * 4);
      }
      u.woundCount.value = n;
      woundTex.needsUpdate = true;
    },
    exposureRows() {
      const out: number[][] = [];
      for (let i = 0; i < u.woundCount.value; i++) out.push(Array.from(woundData.subarray(i * 4, i * 4 + 4)));
      return out;
    },
    get stats() { return stats; },
    splitLook,
    organLook,
    setOrganLook(look) {
      const set = typeof look === 'string' ? ORGAN_LOOKS[look] : look;
      const cfg = set?.cfg, gloss = set?.gloss, occ = set?.occ, detail = set?.detail, relief = set?.relief;
      if (cfg) organLook.cfg.value.set(cfg[0], cfg[1], cfg[2], cfg[3]);
      if (gloss) organLook.gloss.value.set(gloss[0], gloss[1], gloss[2], gloss[3]);
      if (occ) organLook.occ.value.set(occ[0], occ[1], occ[2], occ[3]);
      if (detail) organLook.detail.value.set(detail[0], detail[1], detail[2], detail[3]);
      if (relief) organLook.relief.value.set(relief[0], relief[1], relief[2], relief[3]);
      const c = organLook.cfg.value, g = organLook.gloss.value, o = organLook.occ.value, d = organLook.detail.value, r = organLook.relief.value;
      return {
        cfg: [c.x, c.y, c.z, c.w], gloss: [g.x, g.y, g.z, g.w], occ: [o.x, o.y, o.z, o.w],
        detail: [d.x, d.y, d.z, d.w], relief: [r.x, r.y, r.z, r.w],
      };
    },
    show,
    get drawn() { return drawn; },
    get draws() { let n = 0; for (const b of batches.values()) if (b.count > 0) n++; return n; },
    clear,
    dispose() {
      clear();
      material.dispose();
      material2?.dispose();
      skullMaterial?.dispose();
      eyeMaterial.dispose();
      organMaterial.dispose();
      splitMaterial.dispose();
      splitMaterial2?.dispose();
      skullSplitMaterial?.dispose();
      eyeSplitMaterial.dispose();
      eyeGeometry.dispose();
      debrisEyeGeometry.dispose();
      woundTex.dispose();
    },
  };
}
