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
// piece along the fracture (mesh-split.ts) and paint back faces as the bone's dark inner wall. A closed head never
// touches any of it: same batches, same material, same instances as before.
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
  attribute, wgslFn, mul, add, mix, float, texture, uniform, vec4, positionGeometry, positionWorld, normalWorld,
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
} from './mesh-eyes';
import { HEAD_SPLIT, skullPieces, skullSplitOf, type SkullFollow, type SkullSplit, type SplitWarp } from '../../head-split';
import {
  MESH_ORGAN_SHADE_WGSL, MESH_ORGAN_SURFACE_WGSL, MESH_ORGAN_WET_WGSL, ORGAN_LOOKS, ORGAN_LOOK_DEFAULT, type OrganLook, type OrganLookName,
} from './mesh-organ';
import { organReached, segmentBoundSphere, type ReachSphere } from './organ-reach';
import {
  MESH_SPLIT_CLIP_WGSL, MESH_SPLIT_INSIDE_WGSL, MESH_SPLIT_JAG_WGSL, SPLIT_INSTANCE_ATTRS, SPLIT_INSTANCE_FLOATS,
  meshSplitJagMax, packSplitInstance,
} from './mesh-split';

const MAX_WOUNDS_TEX = 64;
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
   *  breaks along its own pattern, the same one whatever else split before it); omitted = 0.
   *  `reach` (organs as mesh): the owner's wound exposure spheres (cut-wound.ts boneExposureOf), or null for none. An
   *  organ source is drawn only when one reaches its posed bound (organNeeded). Omitted = no reach test. */
  update(
    entries: ReadonlyArray<readonly BoneFieldSource[]>, owners?: readonly object[], shown?: ReadonlySet<unknown>,
    exposed?: ReadonlySet<unknown>, extra?: (owner: object, segment: string) => ArrayLike<number> | null,
    split?: { warp(owner: object, segment: string): SplitWarp | null; seed?(owner: object): number },
    reach?: (owner: object) => ReadonlyArray<ReachSphere> | null,
  ): void;
  /** The organ material's look, live (mesh-organ.ts): `tint` = (organColor, organAmp), the march's own two values,
   *  copied from a body view by the game; `cfg`, `gloss` and `occ` as OrganLook. */
  readonly organLook: { tint: { value: THREE.Vector4 }; cfg: { value: THREE.Vector4 }; gloss: { value: THREE.Vector4 }; occ: { value: THREE.Vector4 } };
  /** Set the organ look: one of ORGAN_LOOKS by name, or its numbers. Returns the values in force. */
  setOrganLook(look?: OrganLookName | Partial<OrganLook>): OrganLook;
  /** The split skull's look, live: `follow` set by hand replaces HEAD_SPLIT.skull.follow (null = that table; a
   *  number is one share for every stage, 1 rides the flesh, 0 the whole skull; or another table); `jag` = (zigAmp,
   *  zigLen, chipAmp, chipLen) and `jagShape` = (wobble, wobbleAlong, wobbleUp, upFreq), the fracture edge
   *  (mesh-split.ts meshSplitJag); `inside` the bone's inner wall; `rim` = (the broken edge's colour, its width in
   *  metres). */
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
  impact(owner: object, sources: readonly BoneFieldSource[], point: readonly [number, number, number], direction: readonly [number, number, number], kind: 'pellet' | 'slug'): number;
  stepDebris(dt: number): void;
  eyeState(owner: object): { missing: number[]; debris: number };
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
export function createSegmentMeshRenderer(cache: SegmentMeshCache, layer = 0, lightList?: unknown): SegmentMeshRenderer {
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
  const lightArgs = (surface: unknown, look: unknown) => ({
    p: positionWorld, n: normalWorld, camPos: cameraPosition,
    deepColor: u.deepColor, ambient: u.ambient, look: look as never,
    lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
    spotPos: u.spotPos, spotAxis: u.spotAxis, spotCfg: u.spotCfg, spotCfg2: u.spotCfg2, spotColor: u.spotColor,
    surfaceIn: surface as never,
    picks: picksAttr, lights: listNode, listOn: u.lightListCfg.x, fill: fillAttr,
  });
  const lit = (surface: unknown, look: unknown) => vec4(shade(lightArgs(surface, look)) as never, 1.0);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = lit(surf, meshLook);
  // Eye shader chain: hash -> noise -> sclera vessels -> surface -> emission.
  // Reuse identical TSL nodes: shade already includes these dependencies.
  // Recreating them emits duplicate WGSL declarations in the eye pipeline.
  const eyeFns: ReturnType<typeof wgslFn>[] = fns.slice(0, 2);
  for (const src of [
    MESH_EYE_VESSEL_WGSL, MESH_EYE_SURFACE_WGSL, MESH_EYE_EMISSION_WGSL,
  ]) eyeFns.push(wgslFn(src, eyeFns.slice()));
  const [eyeSurfaceFn, eyeEmissionFn] = [eyeFns[3]!, eyeFns[4]!];
  const eyeMaterial = new MeshBasicNodeMaterial();
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
  const organLook = {
    tint: uniform(new THREE.Vector4(0.72, 0.32, 0.30, 1)),
    cfg: uniform(new THREE.Vector4(...ORGAN_LOOKS[ORGAN_LOOK_DEFAULT].cfg)),
    gloss: uniform(new THREE.Vector4(...ORGAN_LOOKS[ORGAN_LOOK_DEFAULT].gloss)),
    occ: uniform(new THREE.Vector4(...ORGAN_LOOKS[ORGAN_LOOK_DEFAULT].occ)),
  };
  const organShade = wgslFn(MESH_ORGAN_SHADE_WGSL, fns.slice());
  const organSurfaceFn = wgslFn(MESH_ORGAN_SURFACE_WGSL, fns.slice(0, 2));
  const organWetFn = wgslFn(MESH_ORGAN_WET_WGSL, fns.slice(0, 2));
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
    occ: organLook.occ,
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
  const clip = clipFn({
    pWorld: positionWorld, sn: attribute('iSplitN', 'vec4'), sh: attribute('iSplitH', 'vec4'),
    sa: attribute('iSplitA', 'vec4'), sk: attribute('iSplitK', 'vec4'), jag: splitLook.jag, shape: splitLook.jagShape,
  }) as unknown as { xyz: Node<'vec3'>; w: Node<'float'> };
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
  const kept = (colour: () => unknown) => Fn(() => {
    const out = vec4(0.0, 0.0, 0.0, 1.0).toVar();
    If(clip.w.greaterThanEqual(0.0), () => { out.assign(colour() as never); });
    return out;
  })() as never;
  const splitMaterial = new MeshBasicNodeMaterial();
  splitMaterial.colorNode = kept(() => lit(
    innerWall(splitSurf),
    vec4(u.look.x, u.look.y, mul(mul(u.look.z, splitGloss), MESH_SPEC_SCALE), mul(mul(mul(u.look.w, splitGloss), MESH_FRES_SCALE), front)),
  ));
  splitSided(splitMaterial);
  // A split eye: the eye's own surface outside, the same wall inside, and no glow from the back.
  const eyeSplitMaterial = new MeshBasicNodeMaterial();
  eyeSplitMaterial.colorNode = kept(() => {
    const shaded = lit(innerWall(eyeSurface), u.look) as unknown as { xyz: Node<'vec3'> };
    return vec4(add(shaded.xyz, mul(eyeEmission.xyz, front)), 1.0);
  });
  splitSided(eyeSplitMaterial);
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
   *  pipeline may bind 8 vertex buffers, and position, normal, meshFeature, the instance matrix, iLights and iFill
   *  are six. At least `cap` rows (grown with the batch; the rows are rewritten every update). */
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
      const mesh = new THREE.InstancedMesh(geometry, organ ? organMaterial : split ? (eye ? eyeSplitMaterial : splitMaterial) : (eye ? eyeMaterial : material), 16);
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
    // The organ material reads no meshFeature.
    if (source.kind === 'organ') return;
    const pos = geometry.getAttribute('position');
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
  const jagNow = { zigAmp: 0, chipAmp: 0 };
  /** Draw one segment (or eye) whose closed world matrix is `m` and whose bone lies in the sphere `centre`, `radius`
   *  of the closed head. `skull` null, or a sphere the rest owns alone: one instance in the closed batch, as ever.
   *  Else one copy per piece that owns part of the sphere, in the split batch: the rest at `m`, a half turned about
   *  the hinge by its bone angle, each with its split record. Returns the instances drawn. */
  const drawPieces = (
    geometry: THREE.BufferGeometry, eye: boolean, m: THREE.Matrix4, owner: unknown, skull: SkullSplit | null,
    centre: THREE.Vector3, radius: number, organ = false,
  ): number => {
    jagNow.zigAmp = splitLook.jag.value.x; jagNow.chipAmp = splitLook.jag.value.z;
    const mask = skull ? skullPieces(skull, [centre.x, centre.y, centre.z], radius + meshSplitJagMax(jagNow)) : 1;
    if (!skull || mask === 1) {
      push(batchFor(geometry, eye, false, organ), m, owner);
      drawn.push({ owner, eye, organ, matrix: m.clone(), geometry, piece: null });
      return 1;
    }
    let copies = 0;
    const sg = splitGeometryOf(geometry), b = batchFor(sg, eye, true), w = skull.frame.w;
    for (const piece of [0, 1, 2] as const) {
      if (!(mask & (1 << piece))) continue;
      const angle = piece === 1 ? skull.angleP : piece === 2 ? skull.angleM : 0;
      let copy = m;
      if (angle !== 0) {
        // T(h) R(a, angle) T(-h): the turn about the hinge line, premultiplied (the instance matrix is the world's).
        hingeV.set(w.h[0], w.h[1], w.h[2]);
        turnM.makeRotationAxis(axisV.set(w.a[0], w.a[1], w.a[2]), angle);
        turnM.setPosition(shiftV.copy(hingeV).applyMatrix4(turnM).negate().add(hingeV));
        copy = pieceM.multiplyMatrices(turnM, m);
      }
      push(b, copy, owner);
      packSplitInstance(splitRows(sg).array as Float32Array, b.count - 1, skull, piece);
      drawn.push({ owner, eye, organ: false, matrix: copy.clone(), geometry: sg, piece });
      copies++;
    }
    return copies;
  };

  return {
    object: group,
    uniforms: u,
    impact(owner, sources, point, direction, kind) {
      const head = sources.find(s => s.segment === 'head' && s.isLive() && s.character === 'zombie');
      if (!head) return 0;
      const eyes = meshEyePlacements(meshBoneSource(head));
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
            slot!.eyes[si] = [...meshEyePlacements(meshBoneSource(s)).entries()].map(([index, e]) => ({ index, center: e.center, radius: e.radius }));
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
          const drawnSplit = split?.warp(owner as object, s.segment) ?? null;
          const skull = drawnSplit ? skullSplitOf(drawnSplit, splitLook.follow, split?.seed?.(owner as object) ?? 0) : null;
          let radius = 0, scale = 1;
          if (skull) {
            const { min, max } = s.bounds;
            centreV.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2).applyMatrix4(segM);
            scale = segM.getMaxScaleOnAxis();
            radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 * scale;
          }
          // What is drawn: a split segment's vertices and triangles once per copy.
          const copies = drawPieces(baked.geometry, false, segM, owner, skull, centreV, radius);
          stats.verts += baked.verts * copies;
          stats.tris += baked.tris * copies;
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
      const cfg = set?.cfg, gloss = set?.gloss, occ = set?.occ;
      if (cfg) organLook.cfg.value.set(cfg[0], cfg[1], cfg[2], cfg[3]);
      if (gloss) organLook.gloss.value.set(gloss[0], gloss[1], gloss[2], gloss[3]);
      if (occ) organLook.occ.value.set(occ[0], occ[1], occ[2], occ[3]);
      const c = organLook.cfg.value, g = organLook.gloss.value, o = organLook.occ.value;
      return { cfg: [c.x, c.y, c.z, c.w], gloss: [g.x, g.y, g.z, g.w], occ: [o.x, o.y, o.z, o.w] };
    },
    show,
    get drawn() { return drawn; },
    get draws() { let n = 0; for (const b of batches.values()) if (b.count > 0) n++; return n; },
    clear,
    dispose() {
      clear();
      material.dispose();
      eyeMaterial.dispose();
      organMaterial.dispose();
      splitMaterial.dispose();
      eyeSplitMaterial.dispose();
      eyeGeometry.dispose();
      debrisEyeGeometry.dispose();
      woundTex.dispose();
    },
  };
}
