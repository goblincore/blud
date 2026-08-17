// src/lab/sdf-zombie/webgpu/dynamite-prop.ts
//
// X1.27 task D1 — the AUTHORITED derived dynamite bundle as a runtime prop.
// The procedural four-cylinder `createStickProp` (fpv-view.ts) stays the
// primitive mode's control; clip mode uses THIS wrapper, which loads the
// Task-A derived GLB and is hash-bound to the exact geometry the six hand
// poses were authored against. Its dimensions are a contract, so the bytes
// are integrity-checked BEFORE GLTFLoader ever sees them — the plan forbids
// `GLTFLoader.loadAsync` precisely because it hides the bytes this check
// needs, and a mismatched bundle must never be seated in the authored grip
// (a proxy of a different size is forbidden by the spec).
//
// QUATERNION CONVENTION — (w, x, y, z) tuples throughout this module and
// `BakedPropPose` (hand-volume-pose.ts), matching the clip manifest's
// `modelRotationLocal`. This is DELIBERATELY not BakedHandPose's xyzw: the
// prop pipeline speaks the manifest's convention end to end, and the
// hand→prop boundary (bakedDynamitePose) converts once, in one place.
//
// The loader is GLTFLoader from three's addons (classic build) — the same
// arrangement three's own WebGPU examples use: the parsed scene graph is
// duck-typed, and WebGPURenderer converts the standard materials it carries
// to node materials by property, not instanceof.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sha256Hex } from './hand-volume';
import type { DynamitePropContract } from './hand-volume-clip';
import type { Vec3 } from '../types';

/** The prop's visual state, driven entirely by ownership:
 *  `hand` — the baked clip owns it: position/quaternion are the GLB ROOT
 *           (FlightPivot) in world space, exactly as `bakedDynamitePose`
 *           derived them from the animated hand volume.
 *  `flight` — the deterministic sim owns it: `position` is the flight
 *           state's; the FIRST flight pose after release carries the
 *           rendered root's `releaseQuaternion` (preserved EXACTLY — the
 *           marker-frame orientation continuity the owner gate checks) and
 *           every later pose tumbles (`spin`) composed AFTER that base.
 *  `gone` — no prop: hidden, transform retained. */
export type DynamitePose =
  | { mode: 'hand'; position: Vec3; quaternion: [number, number, number, number]; cooking: boolean }
  | {
    mode: 'flight';
    position: Vec3;
    spin: number;
    fuseBurning: boolean;
    /** (w, x, y, z). Present on the release frame; copied verbatim. */
    releaseQuaternion?: [number, number, number, number];
  }
  | { mode: 'gone' };

export interface DynamiteProp {
  /** The FlightPivot node — add THIS to the scene; it carries the mesh and
   *  both anchors. Posed directly by `pose`. */
  object: THREE.Object3D;
  pose(p: DynamitePose): void;
  /** Spark flicker + cooking pulse (the procedural prop's lab-only pulse,
   *  kept so the two modes read the same); `nowSec` is any clock. */
  flicker(nowSec: number, cooking: boolean): void;
  dispose(): void;
}

function fail(reason: string): never {
  throw new Error(`dynamite prop: ${reason}`);
}

/** Copies a (w, x, y, z) tuple into a THREE.Quaternion ((x, y, z, w)). */
function setQuatWXYZ(q: THREE.Quaternion, t: readonly [number, number, number, number]): void {
  q.set(t[1], t[2], t[3], t[0]);
}

/** Fuse-spark radius — the procedural prop's value, so the authored bundle's
 *  spark reads identically at fuse-tip scale. */
const SPARK_RADIUS_M = 0.011;

/**
 * Loads the derived GLB named by `contract.url`, resolved RELATIVE to the
 * clip manifest's URL (the clip, its atlas and its bundle live together).
 * Fetches the bytes, sha-256 checks them against the contract, and ONLY
 * THEN parses — a tampered or replaced bundle fails closed before any
 * geometry exists. FuseTip/FlightPivot must both be present; the wrapper
 * parents its fuse spark to FuseTip and returns FlightPivot as the posed
 * object. Nothing partially initialized escapes: every failure throws.
 */
export async function loadDynamiteProp(
  manifestUrl: string,
  contract: DynamitePropContract,
): Promise<DynamiteProp> {
  const glbUrl = new URL(contract.url, manifestUrl);
  const res = await fetch(glbUrl);
  if (!res.ok) fail(`GLB fetch ${glbUrl.href} failed: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();

  // Integrity BEFORE parse (see header): a mismatch refuses the animated
  // clip's prop outright rather than seating a differently sized bundle.
  const digest = await sha256Hex(bytes);
  if (digest !== contract.sha256) {
    fail(`sha-256 mismatch for ${glbUrl.href}: contract says ${contract.sha256}, payload is ${digest}`);
  }

  const gltf = await new GLTFLoader().parseAsync(bytes, glbUrl.href);
  const scene = gltf.scene;
  if (!scene) fail('GLB has no scene');

  const fuseTip = scene.getObjectByName(contract.fuseTipNode);
  if (!fuseTip) fail(`GLB is missing the ${contract.fuseTipNode} anchor node`);
  const object = scene.getObjectByName(contract.flightPivotNode);
  if (!object) fail(`GLB is missing the ${contract.flightPivotNode} anchor node`);

  // The fuse spark: a small emissive sphere AT the FuseTip anchor (the
  // derived GLB authorizes the exact distal-fuse position), flickering via
  // flicker() exactly like the procedural prop's tip spark.
  const sparkGeometry = new THREE.SphereGeometry(SPARK_RADIUS_M, 6, 6);
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffd070 });
  const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
  fuseTip.add(spark);

  // The release-frame orientation base. Set by the first flight pose that
  // carries releaseQuaternion; cleared whenever the prop returns to hand
  // ownership (a fresh hold requires a fresh release).
  let releaseBase: THREE.Quaternion | null = null;

  const spinEuler = new THREE.Euler();
  const spinQ = new THREE.Quaternion();

  // Disposal roots: the whole GLTF scene AND the returned pivot (the caller
  // may have reparented the pivot out of the scene — Sets dedupe overlap).
  const roots: readonly THREE.Object3D[] = [scene, object, fuseTip];
  let disposed = false;

  return {
    object,
    pose(p) {
      if (p.mode === 'gone') {
        object.visible = false;
        return;
      }
      object.visible = true;
      object.position.set(p.position[0], p.position[1], p.position[2]);
      if (p.mode === 'hand') {
        releaseBase = null;
        // Exact copy — the baked pose is already normalized, and the held
        // transform must be bit-faithful to what the clip derived.
        setQuatWXYZ(object.quaternion, p.quaternion);
        return;
      }
      if (p.releaseQuaternion) {
        // The release marker frame: preserve the rendered orientation
        // verbatim (no spin yet) and remember it as the flight base.
        releaseBase ??= new THREE.Quaternion();
        setQuatWXYZ(releaseBase, p.releaseQuaternion);
        setQuatWXYZ(object.quaternion, p.releaseQuaternion);
        return;
      }
      // Later flight frames: end-over-end tumble (the procedural prop's
      // Euler) composed AFTER the release base — the bundle keeps leaving
      // the palm in the orientation the hand gave it, then spins.
      spinEuler.set(p.spin * 0.4, 0, p.spin);
      spinQ.setFromEuler(spinEuler);
      if (releaseBase) object.quaternion.copy(releaseBase).multiply(spinQ);
      else object.quaternion.copy(spinQ);
    },
    flicker(nowSec, cooking) {
      // Lab-only pulse, unchanged from createStickProp.
      const f = cooking
        ? 0.9 + 0.6 * Math.abs(Math.sin(nowSec * 41)) + Math.random() * 0.3
        : 0.55 + 0.35 * Math.abs(Math.sin(nowSec * 33));
      spark.scale.setScalar(f);
      sparkMaterial.color.setHex(cooking ? 0xffd070 : 0xffa040);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // UNIQUE resources only: GLTFLoader shares one material instance
      // across primitives that reference the same glTF material (and the
      // spark joins the traversal through fuseTip), so collect through
      // Sets and dispose each exactly once.
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      for (const root of roots) {
        root.traverse(o => {
          const m = o as THREE.Mesh;
          if (m.isMesh !== true) return;
          if (m.geometry) geometries.add(m.geometry);
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) if (mat) materials.add(mat as THREE.Material);
        });
      }
      const textures = new Set<THREE.Texture>();
      for (const mat of materials) {
        for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
          if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
        }
      }
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
