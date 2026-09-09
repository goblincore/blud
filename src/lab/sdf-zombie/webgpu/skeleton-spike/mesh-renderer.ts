import { meshBoneSource } from './mesh-skull';
// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-renderer.ts
//
// SKELETON REPRESENTATION COMPARISON — Task 2: forward-mode renderer for
// the extracted segment meshes (mesh.ts). One THREE.Mesh per live segment
// per actor, geometry SHARED across actors through the SegmentMeshCache
// (same revision → same BufferGeometry), posed per frame from the contract
// source's pose() (origin + quat — rigid, no scale, so normalWorld is
// exact), hidden the same frame isLive() goes false (the contract sever
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
// PROTOTYPE SCOPE / FALLBACKS (counted, not hidden): actor bones mesh;
// chunks, organs and every non-actor bone stay procedural. Limb segments
// pose with the contract's two-anchor approximation (measured 1.26 mm
// worst, task-1.md — below the 1 cm extraction cell).
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import {
  attribute, wgslFn, mul, add, texture, vec4, positionLocal, positionWorld, normalWorld, cameraPosition,
} from 'three/tsl';
import {
  BONE_HASH_WGSL, BONE_NOISE_WGSL, BONE_SHADE_WGSL,
  boneInstancerUniforms, type BoneInstancerUniforms,
} from '../bone-instancer';
import type { BoneFieldSource } from './contract';
import type { SegmentMeshCache } from './mesh';
import {
  meshAppearanceCoord, MESH_BONE_SURFACE_WGSL, MESH_BONE_WET_WGSL,
  MESH_SKULL_CAVITY_WGSL, MESH_SOCKET_VESSEL_WGSL, MESH_TOOTH_ROW_WGSL,
  MESH_SPEC_SCALE, MESH_FRES_SCALE,
} from './mesh-appearance';
import {
  meshEyePlacements, meshEyeImpactIndices, MESH_EYE_EMISSION_WGSL, MESH_EYE_SURFACE_WGSL, MESH_EYE_VESSEL_WGSL,
} from './mesh-eyes';

const MAX_WOUNDS_TEX = 64;

export interface SegmentMeshRenderer {
  object: THREE.Group;
  uniforms: BoneInstancerUniforms;
  /** Re-pose every actor's segments for this frame. `entries[i]` is actor
   *  i's CURRENT contract sources (rebuild the entry on sever re-derive). */
  update(entries: ReadonlyArray<readonly BoneFieldSource[]>, owners?: readonly object[]): void;
  impact(owner: object, sources: readonly BoneFieldSource[], point: readonly [number, number, number], direction: readonly [number, number, number], kind: 'pellet' | 'slug'): number;
  stepDebris(dt: number): void;
  eyeState(owner: object): { missing: number[]; debris: number };
  /** This frame's craters (world centre + radius) for the exposure gradient. */
  setWounds(wounds: ReadonlyArray<{ pos: readonly [number, number, number]; radius: number }>): void;
  /** Coverage accounting for diagnostics: meshed segment/vertex/triangle
   *  counts from the LAST update, plus cache extraction-health flags. */
  readonly stats: {
    actors: number; segments: number; rigid: number; limb: number;
    hidden: number; verts: number; tris: number;
    overflow: number; clamped: number; droppedQuads: number;
  };
  /** Remove every actor slot while keeping material/uniforms reusable. */
  clear(): void;
  dispose(): void;
}

interface ActorSlot {
  meshes: THREE.Mesh[];
  /** Revisions the slot's meshes were built for — a changed revision swaps
   *  the geometry (anatomy/sever re-derive), never edits it in place. */
  keys: string[];
}

/**
 * `layer` puts every segment mesh (and its eyes) on a THREE layer other than
 * 0. The 'bodies' field style uses this to pull the skeleton out of the
 * full-resolution polygonal pass and render it into the half-height field
 * buffer instead, in lockstep with the marched flesh. Default 0 = the
 * ordinary forward pass.
 */
export function createSegmentMeshRenderer(cache: SegmentMeshCache, layer = 0): SegmentMeshRenderer {
  const group = new THREE.Group();
  group.name = 'skeleton-segment-meshes';

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
    MESH_SOCKET_VESSEL_WGSL, MESH_BONE_SURFACE_WGSL, MESH_BONE_WET_WGSL, BONE_SHADE_WGSL,
  ]) fns.push(wgslFn(src, fns.slice()));
  const [surfaceFn, wetFn, shade] = [fns[5]!, fns[6]!, fns[7]!];
  const featureAttr = attribute('meshFeature', 'vec4');
  const surf = surfaceFn({
    pWorld: positionWorld, pLocal: positionLocal,
    feature: featureAttr,
    boneColor: u.boneColor, deepColor: u.deepColor, look: u.look,
    woundTex: texture(woundTex), woundCount: u.woundCount,
  }) as unknown as { xyz: unknown; w: unknown };
  // Per-fragment gloss from an INDEPENDENT wetness field: dry tissue stays
  // matte, wet patches keep a tight highlight, skull cavities get none. This
  // replaces the old blanket `max(look.z, 0.85)` gloss floor.
  const gloss = wetFn({ pLocal: positionLocal, feature: featureAttr, expo: surf.w }) as never;
  const meshLook = vec4(
    u.look.x, u.look.y,
    mul(mul(u.look.z, gloss), MESH_SPEC_SCALE),
    mul(mul(u.look.w, gloss), MESH_FRES_SCALE),
  );
  const lit = (surface: unknown, look: unknown) => vec4(shade({
    p: positionWorld, n: normalWorld, camPos: cameraPosition,
    deepColor: u.deepColor, ambient: u.ambient, look: look as never,
    lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
    spotPos: u.spotPos, spotAxis: u.spotAxis, spotCfg: u.spotCfg, spotCfg2: u.spotCfg2, spotColor: u.spotColor,
    surfaceIn: surface as never,
  }) as never, 1.0);
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
  const eyeSurface = eyeSurfaceFn({ p: positionLocal });
  const eyeEmission = eyeEmissionFn({ p: positionLocal }) as unknown as { xyz: Node<'vec3'> };
  // Eyes keep the previous uniform look path exactly (u.look === the old
  // wetLook under defaults); the eye material never reads meshFeature. The
  // restrained red pupil/iris glow is added AFTER the light compose: a
  // per-eye emissive term, not a scene light, and it never reaches the bone
  // material or the shared light uniforms.
  const eyeShaded = lit(eyeSurface, u.look) as unknown as { xyz: Node<'vec3'> };
  eyeMaterial.colorNode = vec4(add(eyeShaded.xyz, eyeEmission.xyz), 1.0);
  eyeMaterial.depthTest = true;
  eyeMaterial.depthWrite = true;
  const eyeGeometry = new THREE.SphereGeometry(1, 24, 16);
  let absent = new WeakMap<object, Set<number>>();
  const debris: { mesh: THREE.Mesh; velocity: THREE.Vector3; age: number; owner: object }[] = [];
  const syncEyes = (mesh: THREE.Mesh, source: BoneFieldSource, owner: object) => {
    // Called only on creation/revision swap; removing children leaves shared
    // geometry/material alive until renderer disposal.
    mesh.clear();
    for (const [index, { center, radius }] of meshEyePlacements(meshBoneSource(source)).entries()) {
      if (absent.get(owner)?.has(index)) continue;
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      // Layers are NOT inherited from the parent in three — a child left on
      // layer 0 simply does not render when the camera only enables the field
      // layer, so the skull would come through eyeless.
      eye.layers.set(layer);
      eye.name = 'skeleton-fleshy-eye';
      eye.userData.eyeIndex = index;
      eye.position.set(...center);
      eye.scale.setScalar(radius);
      mesh.add(eye);
    }
  };
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;

  const slots: ActorSlot[] = [];
  const preparedGeometry = new WeakSet<THREE.BufferGeometry>();
  const prepareGeometry = (geometry: THREE.BufferGeometry, source: BoneFieldSource) => {
    if (preparedGeometry.has(geometry)) return;
    const pos = geometry.getAttribute('position');
    const feature = new Float32Array(pos.count * 4);
    const isHead = source.segment === 'head' ? (source.character === 'soldier' ? 2 : 1) : 0;
    for (let i = 0; i < pos.count; i++) {
      const q = meshAppearanceCoord(source.bounds, [pos.getX(i), pos.getY(i), pos.getZ(i)]);
      feature.set([q[0], q[1], q[2], isHead], i * 4);
    }
    geometry.setAttribute('meshFeature', new THREE.BufferAttribute(feature, 4));
    preparedGeometry.add(geometry);
  };
  const stats = {
    actors: 0, segments: 0, rigid: 0, limb: 0, hidden: 0, verts: 0, tris: 0,
    overflow: 0, clamped: 0, droppedQuads: 0,
  };
  const clear = () => {
    for (const slot of slots) for (const mesh of slot.meshes) group.remove(mesh);
    slots.length = 0;
    absent = new WeakMap();
    for (const d of debris) group.remove(d.mesh);
    debris.length = 0;
    stats.actors = stats.segments = stats.rigid = stats.limb = stats.hidden = 0;
    stats.verts = stats.tris = stats.overflow = stats.clamped = stats.droppedQuads = 0;
    group.visible = false;
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
        const mesh = new THREE.Mesh(eyeGeometry, eyeMaterial);
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
    update(entries, owners) {
      stats.actors = entries.length;
      stats.segments = stats.rigid = stats.limb = stats.hidden = 0;
      stats.verts = stats.tris = 0;
      stats.overflow = stats.clamped = stats.droppedQuads = 0;
      const liveOwners = new Set(owners ?? entries);
      for (let i = debris.length - 1; i >= 0; i--) if (owners && !liveOwners.has(debris[i]!.owner)) { group.remove(debris[i]!.mesh); debris.splice(i, 1); }
      entries.forEach((srcs, ai) => {
        let slot = slots[ai];
        if (!slot) { slot = { meshes: [], keys: [] }; slots[ai] = slot; }
        const owner = owners?.[ai] ?? slot;
        // Shrink/grow the slot to the source set (sever re-derive changes it).
        while (slot.meshes.length > srcs.length) {
          const m = slot.meshes.pop()!;
          group.remove(m);
          slot.keys.pop();
        }
        srcs.forEach((s, si) => {
          const baked = cache.get(s);
          prepareGeometry(baked.geometry, s);
          let mesh = slot!.meshes[si];
          if (!mesh) {
            mesh = new THREE.Mesh(baked.geometry, material);
            mesh.frustumCulled = true; // per-segment bounds are tight and real
            mesh.layers.set(layer);
            syncEyes(mesh, s, owner);
            group.add(mesh);
            slot!.meshes[si] = mesh;
            slot!.keys[si] = baked.key;
          } else if (slot!.keys[si] !== baked.key) {
            mesh.geometry = baked.geometry; // revision swap; cache owns disposal
            syncEyes(mesh, s, owner);
            slot!.keys[si] = baked.key;
          }
          for (const eye of mesh.children) eye.visible = !absent.get(owner)?.has(eye.userData.eyeIndex);
          // Actor ordering may change when a neighbour is removed.
          if (mesh.userData.eyeOwner !== owner) { syncEyes(mesh, s, owner); mesh.userData.eyeOwner = owner; }
          stats.segments++;
          if (s.rigidity === 'rigid') stats.rigid++; else stats.limb++;
          if (baked.overflow) stats.overflow++;
          if (baked.clamped) stats.clamped++;
          if (baked.droppedQuads) stats.droppedQuads += baked.droppedQuads;
          const live = s.isLive();
          mesh.visible = live;
          if (!live) { stats.hidden++; return; }
          stats.verts += baked.verts;
          stats.tris += baked.tris;
          const pose = s.pose();
          mesh.position.set(pose.origin[0], pose.origin[1], pose.origin[2]);
          mesh.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
        });
      });
      // Release removed slots so they cannot retain actor ownership.
      for (let ai = entries.length; ai < slots.length; ai++) {
        for (const m of slots[ai]!.meshes) { m.visible = false; group.remove(m); }
      }
      slots.length = entries.length;
      group.visible = stats.segments > 0;
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
    get stats() { return stats; },
    clear,
    dispose() {
      clear();
      material.dispose();
      eyeMaterial.dispose();
      eyeGeometry.dispose();
      woundTex.dispose();
    },
  };
}
