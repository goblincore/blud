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
// anchor dirt and the broad skull face cues in segment-local space, so they
// follow animation. BONE_SHADE_WGSL remains the shared forward light compose
// (fill/key/flashlight cone, wet specular, Fresnel), fed by real geometry
// positionWorld/normalWorld. Same uniform factory and per-frame seeding in
// game-main keep the existing lighting conventions. LIT FORWARD MODE ONLY —
// deferred G-buffer output is NOT
// implemented for this prototype (the game wiring refuses skeleton=mesh
// under ?renderer=deferred and reports it).
//
// PROTOTYPE SCOPE / FALLBACKS (counted, not hidden): actor bones mesh;
// chunks, organs and every non-actor bone stay procedural. Limb segments
// pose with the contract's two-anchor approximation (measured 1.26 mm
// worst, task-1.md — below the 1 cm extraction cell).
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute, wgslFn, uniform, texture, vec4, positionLocal, positionWorld, normalWorld, cameraPosition,
} from 'three/tsl';
import {
  BONE_HASH_WGSL, BONE_NOISE_WGSL, BONE_SHADE_WGSL,
  boneInstancerUniforms, type BoneInstancerUniforms,
} from '../bone-instancer';
import type { BoneFieldSource } from './contract';
import type { SegmentMeshCache } from './mesh';
import { meshAppearanceCoord, MESH_BONE_SURFACE_WGSL } from './mesh-appearance';

const MAX_WOUNDS_TEX = 64;

export interface SegmentMeshRenderer {
  object: THREE.Group;
  uniforms: BoneInstancerUniforms;
  /** Re-pose every actor's segments for this frame. `entries[i]` is actor
   *  i's CURRENT contract sources (rebuild the entry on sever re-derive). */
  update(entries: ReadonlyArray<readonly BoneFieldSource[]>): void;
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

export function createSegmentMeshRenderer(cache: SegmentMeshCache): SegmentMeshRenderer {
  const group = new THREE.Group();
  group.name = 'skeleton-segment-meshes';

  const u = boneInstancerUniforms();
  const woundData = new Float32Array(MAX_WOUNDS_TEX * 4);
  const woundTex = new THREE.DataTexture(woundData, MAX_WOUNDS_TEX, 1, THREE.RGBAFormat, THREE.FloatType);
  woundTex.minFilter = THREE.NearestFilter; woundTex.magFilter = THREE.NearestFilter;
  woundTex.generateMipmaps = false;
  woundTex.needsUpdate = true;

  // Dependency-ordered includes, the bone-instancer idiom: hash -> noise ->
  // mesh-local surface material terms -> unchanged forward light compose.
  const [, , surfaceFn, shade] = [
    BONE_HASH_WGSL, BONE_NOISE_WGSL, MESH_BONE_SURFACE_WGSL, BONE_SHADE_WGSL,
  ].reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
  const surf = surfaceFn({
    pWorld: positionWorld, pLocal: positionLocal,
    feature: attribute('meshFeature', 'vec4'),
    boneColor: u.boneColor, deepColor: u.deepColor, look: u.look,
    woundTex: texture(woundTex), woundCount: u.woundCount,
  }) as unknown as { xyz: unknown; w: unknown };
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec4(shade({
    p: positionWorld, n: normalWorld, camPos: cameraPosition,
    deepColor: u.deepColor, ambient: u.ambient, look: u.look,
    lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
    spotPos: u.spotPos, spotAxis: u.spotAxis, spotCfg: u.spotCfg, spotCfg2: u.spotCfg2, spotColor: u.spotColor,
    surfaceIn: surf as never,
  }) as never, 1.0);
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;

  const slots: ActorSlot[] = [];
  const preparedGeometry = new WeakSet<THREE.BufferGeometry>();
  const prepareGeometry = (geometry: THREE.BufferGeometry, source: BoneFieldSource) => {
    if (preparedGeometry.has(geometry)) return;
    const pos = geometry.getAttribute('position');
    const feature = new Float32Array(pos.count * 4);
    const isHead = source.segment === 'head' ? 1 : 0;
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
    stats.actors = stats.segments = stats.rigid = stats.limb = stats.hidden = 0;
    stats.verts = stats.tris = stats.overflow = stats.clamped = stats.droppedQuads = 0;
    group.visible = false;
  };

  return {
    object: group,
    uniforms: u,
    update(entries) {
      stats.actors = entries.length;
      stats.segments = stats.rigid = stats.limb = stats.hidden = 0;
      stats.verts = stats.tris = 0;
      stats.overflow = stats.clamped = stats.droppedQuads = 0;
      entries.forEach((srcs, ai) => {
        let slot = slots[ai];
        if (!slot) { slot = { meshes: [], keys: [] }; slots[ai] = slot; }
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
            mesh.layers.set(0);
            group.add(mesh);
            slot!.meshes[si] = mesh;
            slot!.keys[si] = baked.key;
          } else if (slot!.keys[si] !== baked.key) {
            mesh.geometry = baked.geometry; // revision swap; cache owns disposal
            slot!.keys[si] = baked.key;
          }
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
      // Actors removed since last frame: hide their whole slot.
      for (let ai = entries.length; ai < slots.length; ai++) {
        for (const m of slots[ai]!.meshes) m.visible = false;
      }
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
      woundTex.dispose();
    },
  };
}
