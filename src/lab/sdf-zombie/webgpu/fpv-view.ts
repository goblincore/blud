// src/lab/sdf-zombie/webgpu/fpv-view.ts
//
// The FPV render tail for the SDF zombie lab (X1.23 task 4): three small,
// independent views the orchestration (../fpv-mode.ts) drives —
//
//   1. createHandsGpuView — ONE first-person hand, marched as its own small
//      SDF field in its own proxy box (the chunk-view tech): seven flesh
//      prims re-packed in WORLD space every frame, camera-anchored, shaded by
//      the hero's live material template (legacy gamma included) with its own
//      wound ring for the hand-splash flourish, and its own HAND-DETAIL SHEET.
//
//      ONE VIEW PER HAND, and that is what the sheet costs. The march's
//      texture projection (the face path) is driven by a single set of
//      uniforms — headCentre / headAxes / headQuat — so a projection can only
//      ride ONE object. Two hands in one view would have to share it, and any
//      shared anchor swims across the flesh the moment the hands move
//      differently (the support hand's light gesture travels 15 cm). Splitting
//      gives each hand a projection pinned to its own posed prims. It is also
//      no more expensive than it was: each view marches half the prims, the
//      two proxy boxes sit in opposite corners of the frame and barely
//      overlap, and the sheet costs texture fetches at the HIT point, not
//      inside mapBody's inner loop.
//   2. createStickProp / createCigaretteProp — the held props: a cheap
//      cylinder-bundle mesh and a cigarette (never flesh) posed by the hand
//      anchors hands.ts derives, plus their emissive tips (fuse spark, lit
//      ember) as point-sprite spheres — no particle system exists in the lab;
//      this is the spec's sanctioned fallback.
//   3. createBurstLayer — explosion billboards. Prefers the game's
//      already-extracted SEQ atlases at the exact paths src/main.ts loads
//      (/assets/vfx/explosion-{air,ground}-placeholder/manifest.json);
//      those atlases are DEV PLACEHOLDERS that exist only on machines with
//      the local extraction (gitignored), so when either manifest is
//      missing it falls back to a PROCEDURAL FLIPBOOK (colored expanding
//      discs) generated on a canvas — the lab stays runnable from a clean
//      checkout, and no extracted asset is ever committed by this code.
//
// Everything renderer-independent lives in fpv-mode.ts; this file only
// draws what that module already decided.
import * as THREE from 'three/webgpu';
import { texture3D } from 'three/tsl';
import {
  blankFaceTexture, createDataTexture, createMarchMaterial, defaultUniforms,
  marchBody, writeWounds, type MarchUniforms,
} from './zombie-gpu';
import { createFallbackHandVolumeTexture, type HandVolume } from './hand-volume';
import type { HandClipVolume } from './hand-volume-clip';
import {
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE,
} from './march.wgsl';
import { packBody } from '../pack';
import { MAX_PRIMS } from '../validate';
import { WOUND_PROFILES, type Wound } from '../damage';
import { woundWorldPos } from '../damage';
import type { Primitive, Vec3 } from '../types';
import { PROP_MESH } from '../hands';
import type { HandSheet } from './hands-sheet';
import type { BurstVisual } from '../explosion-aoe';

/** Wound-type → shader ring id, mirroring lab-main's TYPE_ID (the shader's
 *  row-6 encoding; single source lives in damage.ts's WoundType order). */
const TYPE_ID: Record<Wound['type'], number> = { pellet: 0, blast: 1, burn: 2 };

// ——— 1. The hands view ————————————————————————————————————————————————————

/** The live sheet projection for one hand, as fpv-mode's
 *  handSheetProjections produces it (WORLD centre + WORLD basis columns). */
export interface HandSheetProjectionIn {
  centre: Vec3;
  basis: { x: Vec3; y: Vec3; z: Vec3 };
  halfExtent: Vec3;
}

/** Volume pose for the baked hand (X1.26): rigid placement plus the distal
 *  warp residue, all in the volume's own anatomical frame. */
export interface HandVolumePoseIn {
  /** Volume world centre (the shader's volumePose0.xyz). */
  centre: Vec3;
  /** local-to-world rotation, xyzw quaternion (the shader's volumePose1). */
  quaternion: [number, number, number, number];
  /** Distal warp offset in LOCAL metres; clamped here to 12 mm. */
  warpLocal: Vec3;
  /** False parks the warp at zero (the static first gate). */
  warpEnabled: boolean;
}

export interface HandsGpuView {
  object: THREE.Object3D;
  /** Live uniforms — same exposure as the body/chunk views, for tests and
   *  the panel. */
  uniforms: MarchUniforms;
  /** The 3D texture currently bound to the volume slot: the view's own
   *  1-cubed fallback in primitive mode, the loaded volume in baked mode. */
  readonly volumeTexture: THREE.Texture;
  /** Re-packs THIS hand's world-space prims + its wound ring for the frame.
   *  Wounds must already be rebased onto `prims` (fpv-mode's
   *  splitHandWounds does that). In volume mode the wound rows are still
   *  uploaded but the primitive counts stay zero. */
  update(prims: Primitive[], wounds: readonly Wound[]): void;
  /** Binds the detail sheet. Until called, the view shades as bare flesh. */
  setSheet(sheet: HandSheet | null): void;
  /** Re-aims the sheet projection at this frame's posed hand. */
  setProjection(p: HandSheetProjectionIn): void;
  /** Live tuning of the sheet's two weights (the panel's handTexStrength /
   *  handRelief sliders). Albedo strength should stay at ~0 — see
   *  HAND_SHEET_TUNING for why. */
  setSheetTuning(strength: number, relief: number): void;
  /** A/B switch (X1.26): `prims` is the complete existing interaction path
   *  and restores its march settings; `volume` requires a loaded static v1
   *  HandVolume OR a v2 clip HandClipVolume (X1.27) and zeroes the primitive
   *  fold. Both manifest kinds share boundsMin/boundsMax/voxelSize/
   *  dimensions, so one binding path serves either; only the clip binds a
   *  real frame depth into volumeClip.w (a static v1 binds its nz). */
  setField(field: 'prims' | 'volume', volume?: HandVolume | HandClipVolume): void;
  /** Rigid volume placement + clamped distal warp; also refits the proxy box
   *  from the transformed manifest AABB. */
  setVolumePose(pose: HandVolumePoseIn): void;
  /** Drives the clip's adjacent-frame sample: volumeClip = [frame0, frame1,
   *  alpha, frameDepth]. Indices clamp to [0, frameCount-1] and alpha to
   *  [0,1]; a bound STATIC v1 volume is forced to [0,0,0,nz] (its only
   *  frame is the whole texture); with no volume bound this is a no-op. */
  setVolumeFrame(frame0: number, frame1: number, alpha: number): void;
  /** Neutral-clay look toggle for the baked visual gate; saves and restores
   *  exactly the flesh settings it touches. */
  setClay(on: boolean): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

/** Conservative march settings for the baked field (spec: discrete trilinear
 *  interpolation of an SDF is not exact, so no over-relaxation, a 0.75 step
 *  multiplier, at least 128 steps, and a hit epsilon of at least half the
 *  largest voxel pitch — set from the volume's maxVoxelPitch at setField). */
const VOLUME_MARCH = {
  steps: 128,
  stepMul: 0.75,
  relaxation: 1.0,
} as const;

/** Proxy padding in volume mode, metres: wounds still carve/rim in baked
 *  mode, so their reach needs margin; the warp margin covers the 12 mm
 *  clamped residue; maxVoxelPitch covers the boundary samples. */
const VOLUME_WOUND_MARGIN_M = 0.05;
const VOLUME_WARP_MARGIN_M = 0.012;

/** Neutral clay for the shape gate: raw display channels (the legacy-gamma
 *  path shows linear values raw — the same convention as every preset in
 *  material.ts, so no sRGB conversion here). */
const CLAY = {
  r: 0x9a / 255, g: 0x81 / 255, b: 0x77 / 255,
  specular: 0.15, roughness: 0.7,
} as const;

/**
 * How much of the hand sheet reaches the shading, split exactly the way the
 * face pipeline splits it (the panel's texStrength = faceCfg.y multiplies
 * ALBEDO; texRelief = faceCfg.w perturbs the NORMAL).
 *
 * HANDS ARE RELIEF-ONLY. The first pass ran albedo at 0.55 and it was the
 * dominant bug in the owner's playtest: the sheet's dark crease lines painted
 * onto the flesh as marks ("looks like a bad tattoo") and the whole right hand
 * went brown, because the shader's albedo term is `albedo * (tex.rgb / mean)`
 * — a height map's dark regions multiply the latex pink toward black, and the
 * mean shifts the overall level. A height map is not an albedo map and must
 * never be used as one. The flesh colour now comes ENTIRELY from the material;
 * the sheet only bends the normal.
 */
export const HAND_SHEET_TUNING = {
  /** ZERO, deliberately: no albedo contribution, so the flesh stays uniform
   *  latex pink. mix(albedo, albedo*detail, …*0) is exactly `albedo`, so the
   *  sheet's levels and its mean cannot tint the hands at all. */
  detailStrength: 0,
  /** The only channel the sheet drives, and now a real value rather than the
   *  0.55 workaround: as of 94b12ac the march rotates its relief bump by
   *  headQuat into world before adding it to the normal, so a hand's grooves
   *  shade from the correct direction instead of a skewed one. Set to the face
   *  path's own default (defaultUniforms' faceCfg.w) — the same lighting maths
   *  on the same kind of sheet wants the same weight, and the bake's clamped
   *  0.35..1 height range makes its gradients gentler than a full-range map's,
   *  so this is not as strong as it looks. The panel's handRelief slider is
   *  there to dial it against the real render. */
  relief: 1.4,
  /** The face path treats bright pixels as an emissive mask. A height map's
   *  brightest pixels are just the nearest flesh, so the threshold sits at the
   *  very top of the range — and the glow STRENGTH (faceCfg2.w) is zeroed
   *  outright, so nothing can glow regardless. */
  glowThreshold: 0.99,
} as const;

/**
 * The hands' own marching field: the chunk-view pattern (own data texture,
 * one uniform set copied from the hero's template) applied to a camera-
 * anchored prim set. Every frame is a full re-pack in world space — moving
 * the mesh alone would fly the proxy box off while the flesh stayed put
 * (the project's twice-bitten hazard).
 *
 * Deliberate template deltas: no face, no gore mask (clean latex — wounds
 * still carve), and the full march step budget (the hands are the closest
 * flesh on screen; their quality is the point of the spec's perf gate).
 */
export function createHandsGpuView(
  template: MarchUniforms, limb: 'armL' | 'armR',
): HandsGpuView {
  const { tex: dataTex, texels, writeRow } = createDataTexture();
  const u = defaultUniforms(blankFaceTexture());

  // The hero's look, verbatim — legacy gamma (lodCfg.y) included, so the
  // hands read as the same flesh family under the same panel tuning.
  u.baseColor.value.copy(template.baseColor.value);
  u.deepColor.value.copy(template.deepColor.value);
  u.charColor.value.copy(template.charColor.value);
  u.lightDir.value.copy(template.lightDir.value);
  u.keyColor.value.copy(template.keyColor.value);
  u.lightCfg.value.copy(template.lightCfg.value);
  u.surfCfg.value.copy(template.surfCfg.value);
  u.surfCfg2.value.copy(template.surfCfg2.value);
  u.marchCfg.value.copy(template.marchCfg.value);
  u.woundCfg.value.copy(template.woundCfg.value);
  u.woundCfg2.value.copy(template.woundCfg2.value);
  u.lodCfg.value.copy(template.lodCfg.value);
  u.lodCfg.value.w = 0; // no chunk gore mask — the hands are clean flesh
  // The texture path starts OFF and is switched on by setSheet: the hands
  // borrow the face projection wholesale (planar, un-rotated into the hand's
  // own frame by headQuat's conjugate), which is why nothing in the shader
  // had to change to give hands a sheet.
  u.faceCfg.value.set(0, HAND_SHEET_TUNING.detailStrength, 1, HAND_SHEET_TUNING.relief);
  u.faceCfg2.value.set(0, 0.5, HAND_SHEET_TUNING.glowThreshold, 0);
  // hs in -1..1 over the hand's half-extents -> uv 0..1 across the sheet. The
  // u SIGN is decided per hand in setProjection — see there.
  u.faceProj.value.set(0.5, 0.5, 0.5, 0.5);
  u.faceAtlas.value.set(1, 1, 0, 0);

  // VOLUME SLOT (X1.26): a texture3D NODE rather than a raw texture, so the
  // volume-capable mode (setField) can rebind its .value between this
  // fallback and a loaded volume without recompiling a pipeline. The view
  // owns and disposes the fallback; a loaded volume stays caller-owned.
  const fallbackVolume = createFallbackHandVolumeTexture();
  const volumeNode = texture3D(fallbackVolume);

  // Volume-mode state. primMarch snapshots the TEMPLATE values so switching
  // back is exact, whatever the panel did in between. `volume` is the union
  // of the two manifest kinds: v1 static (version 1) or v2 clip (version 2);
  // everything they share is read through the shared fields, and the clip
  // extras (frameDepth/frameCount) drive volumeClip.w and setVolumeFrame.
  let volume: HandVolume | HandClipVolume | null = null;
  let clay = false;
  let claySaved: { r: number; g: number; b: number; spec: number; rough: number } | null = null;
  const primMarch = {
    marchCfg: u.marchCfg.value.clone(),
    woundCfg2: u.woundCfg2.value.clone(),
  };
  const poseCentre = new THREE.Vector3();
  const poseQuat = new THREE.Quaternion();
  const corner = new THREE.Vector3();

  /** Sizes the proxy box from the TRANSFORMED manifest AABB — never from prim
   *  bounds, which describe a different (seven-capsule) hand. */
  function fitVolumeProxy() {
    if (!volume) return;
    const { boundsMin: mn, boundsMax: mx } = volume.manifest;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let c = 0; c < 8; c++) {
      corner.set(
        (c & 1) ? mx[0]! : mn[0]!,
        (c & 2) ? mx[1]! : mn[1]!,
        (c & 4) ? mx[2]! : mn[2]!);
      corner.applyQuaternion(poseQuat).add(poseCentre);
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
      minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
    }
    const pad = volume.maxVoxelPitch + VOLUME_WOUND_MARGIN_M + VOLUME_WARP_MARGIN_M;
    mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    mesh.scale.set(maxX - minX + pad * 2, maxY - minY + pad * 2, maxZ - minZ + pad * 2);
  }

  const material = createMarchMaterial(dataTex, volumeNode, u, marchBody);
  // Unit box; the true axis-aligned cover is applied per frame via scale.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.frustumCulled = false; // camera-anchored: culling flakes on near moves

  /** Packs this hand as a ONE-cluster field and sizes the proxy box. */
  function apply(prims: Primitive[]) {
    const members = prims.filter(p => p.op !== 'sub');
    let cx = 0, cy = 0, cz = 0;
    for (const m of members) {
      cx += m.a[0] + m.b[0]; cy += m.a[1] + m.b[1]; cz += m.a[2] + m.b[2];
    }
    const n = Math.max(1, members.length * 2);
    const center: Vec3 = [cx / n, cy / n, cz / n];
    let radius = 0;
    for (const m of members) {
      const s = Math.max(m.scale[0], m.scale[1], m.scale[2]) * m.radius;
      for (const e of [m.a, m.b]) {
        const d = Math.hypot(e[0] - center[0], e[1] - center[1], e[2] - center[2]);
        radius = Math.max(radius, d + s);
      }
    }
    const packed = packBody({
      prims,
      clusters: [{
        id: 0, limb, start: 0, count: members.length,
        center, radius: radius || 0.1, alive: true,
      }],
      bones: new Map(),
    });
    writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, packed.clusterBounds, 1);
    writeRow(ROW_CLUSTER_RANGE, packed.clusterRange, 1);
    u.counts.value.set(packed.primCount, 1, packed.carveCount, packed.maxBlendK);
    dataTex.needsUpdate = true;

    // Proxy box: world AABB of the endpoints (plus radius + blend margin) —
    // axis-aligned, so no orientation bookkeeping while the camera turns.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of prims) {
      const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]) + 0.02;
      for (const e of [p.a, p.b]) {
        minX = Math.min(minX, e[0] - r); maxX = Math.max(maxX, e[0] + r);
        minY = Math.min(minY, e[1] - r); maxY = Math.max(maxY, e[1] + r);
        minZ = Math.min(minZ, e[2] - r); maxZ = Math.max(maxZ, e[2] + r);
      }
    }
    const pad = packed.maxBlendK * 2;
    mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    mesh.scale.set(maxX - minX + pad, maxY - minY + pad, maxZ - minZ + pad);
  }

  apply([]);
  const basisM = new THREE.Matrix4();
  const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();
  const projQ = new THREE.Quaternion();
  return {
    object: mesh,
    uniforms: u,
    get volumeTexture() { return volumeNode.value as THREE.Texture; },
    setSheet(sheet) {
      if (!sheet) { u.faceCfg.value.x = 0; return; }
      u.faceTex.value = sheet.tex;
      u.faceCfg2.value.y = sheet.mean;
      u.faceCfg.value.x = 1;
    },
    setSheetTuning(strength, relief) {
      u.faceCfg.value.y = strength;
      u.faceCfg.value.w = relief;
    },
    setProjection(p) {
      u.headCentre.value.set(p.centre[0], p.centre[1], p.centre[2]);
      u.headAxes.value.set(p.halfExtent[0], p.halfExtent[1], p.halfExtent[2]);
      // headQuat's columns ARE the hand frame (thumb-ward, knuckle-ward, back),
      // because the shader un-rotates by its conjugate — so head-space x lands
      // across the hand toward the thumb and y along it, which is exactly the
      // frame the sheet was baked in.
      //
      // HANDEDNESS, resolved here rather than authored. Two independent flips
      // stack up: (thumb, knuckles, back) is a LEFT-handed triple for a right
      // hand and right-handed for a left one, and the camera→world map is
      // itself orientation-reversing (camera +z is forward). Whatever the net
      // parity, a left-handed basis fed to makeBasis is a REFLECTION, and
      // setFromRotationMatrix extracts a meaningless quaternion from it — the
      // sheet then smears across the hand at a random angle. So: measure the
      // determinant, negate the x column when it is negative to get a real
      // rotation, and put the matching −1 in faceProj.x so uv comes back
      // unmirrored. Deriving it per frame means no per-hand flag can go stale
      // when a re-bake or a re-solve changes the parity.
      bx.set(p.basis.x[0], p.basis.x[1], p.basis.x[2]);
      by.set(p.basis.y[0], p.basis.y[1], p.basis.y[2]);
      bz.set(p.basis.z[0], p.basis.z[1], p.basis.z[2]);
      const flip = bx.clone().cross(by).dot(bz) < 0;
      if (flip) bx.negate();
      u.faceProj.value.x = flip ? -0.5 : 0.5;
      basisM.makeBasis(bx, by, bz);
      projQ.setFromRotationMatrix(basisM);
      u.headQuat.value.set(projQ.x, projQ.y, projQ.z, projQ.w);
    },
    update(prims, wounds) {
      // Volume mode (X1.26): the wound ring still uploads (wounds are stamped
      // on the baked field after either branch), but the primitive fold is
      // dead — counts zeroed and no prim packing, so stale rows cannot ghost.
      if (volume) {
        u.woundCfg.value.x = writeWounds(
          texels,
          wounds.map(w => woundWorldPos(prims, w)),
          wounds.map(w => w.radius),
          wounds.map(w => TYPE_ID[w.type]),
          wounds.map(w => w.ageSec),
          wounds.map(w => WOUND_PROFILES[w.type].rimSplayScale),
          wounds.map(w => WOUND_PROFILES[w.type].rimOffsetScale),
        );
        u.counts.value.set(0, 0, 0, 0);
        dataTex.needsUpdate = true;
        return;
      }
      apply(prims);
      u.woundCfg.value.x = writeWounds(
        texels,
        wounds.map(w => woundWorldPos(prims, w)),
        wounds.map(w => w.radius),
        wounds.map(w => TYPE_ID[w.type]),
        wounds.map(w => w.ageSec),
        wounds.map(w => WOUND_PROFILES[w.type].rimSplayScale),
        wounds.map(w => WOUND_PROFILES[w.type].rimOffsetScale),
      );
    },
    setField(field, vol) {
      if (field === 'volume') {
        if (!vol) {
          throw new Error('setField(volume): a loaded HandVolume or HandClipVolume is required — load first (task C2 gates this)');
        }
        volume = vol;
        volumeNode.value = vol.texture;
        const mn = vol.manifest.boundsMin, mx = vol.manifest.boundsMax;
        u.volumeMin.value.set(mn[0], mn[1], mn[2]);
        u.volumeInvExtent.value.set(
          1 / (mx[0]! - mn[0]!), 1 / (mx[1]! - mn[1]!), 1 / (mx[2]! - mn[2]!));
        // Static v1 binds [0,0,0,nz] — frame 0 of the whole texture, alpha
        // 0, the bit-identical X1.26 sample. A v2 clip binds its real frame
        // depth and starts parked on frame 0 (the open hand).
        const depth = vol.manifest.version === 2
          ? vol.manifest.frameDepth
          : vol.manifest.dimensions[2]!;
        u.volumeClip.value.set(0, 0, 0, depth);
        // Conservative stepping for a non-exact trilinear field (spec).
        u.marchCfg.value.x = Math.max(VOLUME_MARCH.steps, primMarch.marchCfg.x);
        u.marchCfg.value.y = VOLUME_MARCH.stepMul;
        u.woundCfg2.value.y = VOLUME_MARCH.relaxation;
        u.woundCfg2.value.w = vol.maxVoxelPitch / 2; // hit eps >= half the largest pitch
        u.volumePose0.value.w = 1;
        fitVolumeProxy();
      } else {
        volume = null;
        u.volumePose0.value.w = 0;
        volumeNode.value = fallbackVolume;
        u.volumeClip.value.set(0, 0, 0, 1); // fallback frame semantics
        u.marchCfg.value.copy(primMarch.marchCfg);
        u.woundCfg2.value.copy(primMarch.woundCfg2);
        // The prim path refits the proxy on the next update().
      }
    },
    setVolumeFrame(frame0, frame1, alpha) {
      // No volume bound: the volume branch is disabled entirely and the
      // uniform keeps its fallback [0,0,0,1] — nothing to drive.
      if (!volume) return;
      // Static v1 has ONE frame: the whole texture. Forcing the full-depth
      // slab keeps the sample bit-identical whatever a caller passes.
      if (volume.manifest.version === 1) {
        u.volumeClip.value.set(0, 0, 0, volume.manifest.dimensions[2]!);
        return;
      }
      const count = volume.manifest.frameCount;
      const f0 = Math.min(Math.max(Math.round(frame0), 0), count - 1);
      const f1 = Math.min(Math.max(Math.round(frame1), 0), count - 1);
      const a = Math.min(Math.max(Number.isFinite(alpha) ? alpha : 0, 0), 1);
      u.volumeClip.value.set(f0, f1, a, volume.manifest.frameDepth);
    },
    setVolumePose(p) {
      poseCentre.set(p.centre[0], p.centre[1], p.centre[2]);
      poseQuat.set(p.quaternion[0], p.quaternion[1], p.quaternion[2], p.quaternion[3]);
      u.volumePose0.value.set(p.centre[0], p.centre[1], p.centre[2], u.volumePose0.value.w);
      u.volumePose1.value.set(p.quaternion[0], p.quaternion[1], p.quaternion[2], p.quaternion[3]);
      // Warp: clamped to 12 mm (the spec's ceiling) and parked at zero when
      // disabled — the static/unwarped render is the first visual gate.
      const wl = Math.hypot(p.warpLocal[0], p.warpLocal[1], p.warpLocal[2]);
      const s = p.warpEnabled && wl > 1e-9 ? Math.min(1, VOLUME_WARP_MARGIN_M / wl) : 0;
      u.volumeWarp.value.set(p.warpLocal[0] * s, p.warpLocal[1] * s, p.warpLocal[2] * s, 0);
      fitVolumeProxy();
    },
    setClay(on) {
      if (on === clay) return;
      if (on) {
        claySaved = {
          r: u.baseColor.value.r, g: u.baseColor.value.g, b: u.baseColor.value.b,
          spec: u.surfCfg.value.x, rough: u.surfCfg.value.y,
        };
        u.baseColor.value.setRGB(CLAY.r, CLAY.g, CLAY.b);
        u.surfCfg.value.x = CLAY.specular;
        u.surfCfg.value.y = CLAY.roughness;
        clay = true;
      } else {
        const s = claySaved!;
        u.baseColor.value.setRGB(s.r, s.g, s.b);
        u.surfCfg.value.x = s.spec;
        u.surfCfg.value.y = s.rough;
        claySaved = null;
        clay = false;
      }
    },
    setVisible(on) { mesh.visible = on; },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      dataTex.dispose();
      fallbackVolume.dispose(); // a loaded volume stays caller-owned
    },
  };
}

// ——— 2. The stick prop ————————————————————————————————————————————————————

export type StickPose =
  /** Held: `pos` is WORLD (the hand anchor, already transformed by the
   *  wiring), `axis` is the bundle's up-direction in CAMERA-local space —
   *  hands.ts's propAnchor produces exactly this pair, so the bundle tilts
   *  with the fist instead of standing to attention. */
  | { mode: 'hand'; pos: Vec3; axis: Vec3; camQuat: THREE.Quaternion; cooking: boolean }
  | { mode: 'flight'; pos: Vec3; spin: number; fuseBurning: boolean }
  | { mode: 'gone' };

export interface StickProp {
  object: THREE.Object3D;
  pose(p: StickPose): void;
  /** Spark flicker + cooking pulse; `nowSec` is any clock. */
  flicker(nowSec: number, cooking: boolean): void;
  dispose(): void;
}

/**
 * Orients a prop whose model-space up is +Y so that up lands along `axis`
 * expressed in CAMERA-local space, then rotates the whole thing into world by
 * `camQuat`. Shared by both held props.
 */
const UP_Y = new THREE.Vector3(0, 1, 0);
const axisVec = new THREE.Vector3();
const alignQ = new THREE.Quaternion();
const heldUp = new THREE.Vector3();
function orientHeld(obj: THREE.Object3D, axis: Vec3, camQuat: THREE.Quaternion): void {
  axisVec.set(axis[0], axis[1], axis[2]);
  if (axisVec.lengthSq() < 1e-12) axisVec.copy(UP_Y);
  else axisVec.normalize();
  alignQ.setFromUnitVectors(UP_Y, axisVec);
  obj.quaternion.copy(camQuat).multiply(alignQ);
}

/**
 * The dynamite bundle: four chunky claymation cylinders banded together,
 * standing in the lead hand while held, tumbling in flight. A tiny emissive
 * sphere at the tip is the fuse spark — flickering while the fuse burns
 * (cooking or airborne) via flicker(), parked at zero scale otherwise.
 */
export function createStickProp(): StickProp {
  const group = new THREE.Group();
  // hands.ts owns where the bundle sits relative to the grip: `below` of it
  // hides inside the fist, `above` stands clear. The mesh is built centred and
  // the group is offset by `centre` in hand mode, so flight still tumbles
  // about the bundle's middle.
  const LEN = PROP_MESH.stick.below + PROP_MESH.stick.above;
  const CENTRE = (PROP_MESH.stick.above - PROP_MESH.stick.below) / 2;
  const stickGeo = new THREE.CylinderGeometry(0.013, 0.013, LEN, 8);
  const paperMat = new THREE.MeshStandardMaterial({ color: 0x7a2a20, roughness: 0.85 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x2c1c14, roughness: 0.9 });
  // The bundle: four sticks, fanned 2×2, with two dark bands around the middle.
  const offs: [number, number][] = [[-0.014, 0], [0.014, 0], [0, -0.014], [0, 0.014]];
  for (const [x, z] of offs) {
    const s = new THREE.Mesh(stickGeo, paperMat);
    s.position.set(x, 0, z);
    s.rotation.z = -x * 1.2;
    s.rotation.x = z * 1.2;
    group.add(s);
  }
  const bandGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.014, 8);
  for (const y of [-LEN * 0.23, LEN * 0.2]) {
    const b = new THREE.Mesh(bandGeo, bandMat);
    b.position.y = y;
    group.add(b);
  }
  // Fuse stub + spark at the tip.
  const fuse = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, 0.03, 4),
    new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 1 }),
  );
  fuse.position.y = LEN / 2 + 0.012;
  group.add(fuse);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd070 });
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 6), sparkMat);
  spark.position.y = LEN / 2 + 0.032;
  group.add(spark);

  const spinQ = new THREE.Quaternion();

  return {
    object: group,
    pose(p) {
      if (p.mode === 'gone') { group.visible = false; return; }
      group.visible = true;
      if (p.mode === 'hand') {
        // Held in the lead fist: the anchor rides the posed prims, so the
        // bundle inherits the pose, the idle bob AND the verlet jiggle. `pos`
        // is the GRIP point, so slide the mesh's centre up the axis from it —
        // that is what buries the bundle's lower end in the fist.
        orientHeld(group, p.axis, p.camQuat);
        heldUp.set(0, 1, 0).applyQuaternion(group.quaternion).multiplyScalar(CENTRE);
        group.position.set(p.pos[0] + heldUp.x, p.pos[1] + heldUp.y, p.pos[2] + heldUp.z);
        group.scale.setScalar(1);
      } else {
        // Ballistic: tumbling end over end about the horizontal axis the
        // flight's roll parameter drives.
        spinQ.setFromEuler(new THREE.Euler(p.spin * 0.4, 0, p.spin));
        group.quaternion.copy(spinQ);
        group.position.set(p.pos[0], p.pos[1], p.pos[2]);
        group.scale.setScalar(1);
      }
    },
    flicker(nowSec, cooking) {
      const f = cooking
        ? 0.9 + 0.6 * Math.abs(Math.sin(nowSec * 41)) + Math.random() * 0.3
        : 0.55 + 0.35 * Math.abs(Math.sin(nowSec * 33));
      spark.scale.setScalar(f);
      sparkMat.color.setHex(cooking ? 0xffd070 : 0xffa040);
    },
    dispose() {
      stickGeo.dispose(); bandGeo.dispose(); fuse.geometry.dispose();
      spark.geometry.dispose(); paperMat.dispose(); bandMat.dispose();
      sparkMat.dispose(); (fuse.material as THREE.Material).dispose();
    },
  };
}

// ——— 2b. The cigarette prop ————————————————————————————————————————————————

export type CigarettePose =
  /** Held: `pos` is the WORLD pinch point (hands.ts's cig anchor), `axis` the
   *  cigarette's direction in CAMERA-local space. */
  | { mode: 'hand'; pos: Vec3; axis: Vec3; camQuat: THREE.Quaternion; hot: boolean }
  | { mode: 'gone' };

export interface CigaretteProp {
  object: THREE.Object3D;
  pose(p: CigarettePose): void;
  /** Ember flicker; `nowSec` is any clock. */
  flicker(nowSec: number): void;
  dispose(): void;
}

/**
 * The lit cigarette in the support hand — the ignition source, and a much
 * better silhouette than the zippo box it replaced: a thin bright line with a
 * glowing dot on the end reads instantly at bottom-of-frame scale, where a
 * small dark box just read as a lump embedded in the knuckles.
 *
 * Model space: +Y along the cigarette, ORIGIN AT THE PINCH, so the butt hangs
 * below the fingers and the paper runs up past them to the ember — exactly the
 * layout PROP_MESH.cig describes and the two pinching prims are wrapped
 * around. `hot` flares the ember while it meets the fuse and through the burn;
 * it stays lit either way, because a lit cigarette is lit.
 */
export function createCigaretteProp(): CigaretteProp {
  const M = PROP_MESH.cig;
  const group = new THREE.Group();
  const LEN = M.below + M.above;
  // Paper: cream, matte. Centre it so the pinch sits at the group origin.
  const paperGeo = new THREE.CylinderGeometry(0.0045, 0.0045, LEN, 7);
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.95 });
  const paper = new THREE.Mesh(paperGeo, paperMat);
  paper.position.y = (M.above - M.below) / 2;
  group.add(paper);
  // Filter stub at the butt end.
  const filtGeo = new THREE.CylinderGeometry(0.0047, 0.0047, 0.014, 7);
  const filtMat = new THREE.MeshStandardMaterial({ color: 0xb98c4e, roughness: 1 });
  const filt = new THREE.Mesh(filtGeo, filtMat);
  filt.position.y = -M.below + 0.007;
  group.add(filt);
  // A short blackened ash band just under the coal.
  const ashGeo = new THREE.CylinderGeometry(0.0044, 0.0040, 0.008, 7);
  const ashMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 1 });
  const ash = new THREE.Mesh(ashGeo, ashMat);
  ash.position.y = M.above - 0.004;
  group.add(ash);
  // The ember: a small emissive coal at the very tip.
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff6a1c });
  const emberGeo = new THREE.SphereGeometry(M.emberM, 7, 7);
  const ember = new THREE.Mesh(emberGeo, emberMat);
  ember.position.y = M.above + M.emberM * 0.5;
  group.add(ember);

  let hot = false;
  return {
    object: group,
    pose(p) {
      if (p.mode === 'gone') { group.visible = false; return; }
      group.visible = true;
      hot = p.hot;
      orientHeld(group, p.axis, p.camQuat);
      group.position.set(p.pos[0], p.pos[1], p.pos[2]);
    },
    flicker(nowSec) {
      // Two detuned sines: a slow breath plus a fast shimmer. Hot adds a
      // draw-on-it brighten and a little more swell.
      const base = hot ? 1.25 : 1.0;
      const f = base * (0.9 + 0.14 * Math.sin(nowSec * 3.1) + 0.06 * Math.sin(nowSec * 17.7));
      ember.scale.setScalar(f);
      emberMat.color.setHex(hot ? 0xffb03a : 0xff6a1c);
    },
    dispose() {
      paperGeo.dispose(); filtGeo.dispose(); ashGeo.dispose(); emberGeo.dispose();
      paperMat.dispose(); filtMat.dispose(); ashMat.dispose(); emberMat.dispose();
    },
  };
}

// ——— 3. The burst layer ————————————————————————————————————————————————————

interface BurstFrameSource {
  frameCount: number;
  frameDurationMs: number;
  get(i: number): THREE.Texture;
  aspect(i: number): number;
}

interface ActiveBurst {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  frame: number;
  elapsedMs: number;
  halfHeight: number;
  src: BurstFrameSource;
}

export interface BurstLayer {
  spawn(visual: BurstVisual): void;
  update(dtSec: number, camera: THREE.Camera): void;
  /** True once the game's extracted SEQ atlases loaded; false = procedural. */
  readonly usingAtlas: boolean;
  dispose(): void;
}

const MANIFEST_AIR = '/assets/vfx/explosion-air-placeholder/manifest.json';
const MANIFEST_GROUND = '/assets/vfx/explosion-ground-placeholder/manifest.json';

/**
 * Explosion billboards. Air bursts centre on the detonation point; ground
 * bursts bottom-anchor (the dome blooms up from the floor) — the game's
 * ExplosionVfx anchoring, driven by BurstVisual.kind from the resolver.
 */
export function createBurstLayer(scene: THREE.Scene): BurstLayer {
  const active: ActiveBurst[] = [];
  let air: BurstFrameSource | null = null;
  let ground: BurstFrameSource | null = null;
  /** Flips true only if the game's extracted atlases actually loaded — the
   *  dev-notes record which source the bench/verification saw. */
  let atlasLoaded = false;

  /** The game's atlas loader path (src/engine/asset-loader.ts), lab-local so
   *  the lab never imports the game's THREE-core modules. */
  async function tryLoadAtlas(url: string): Promise<BurstFrameSource | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const manifest = await res.json() as {
        frames: { file: string }[]; frameDurationMs?: number;
      };
      const baseDir = url.replace(/\/manifest\.json$/, '/');
      const loader = new THREE.TextureLoader();
      const frames = await Promise.all(manifest.frames.map(f => new Promise<THREE.Texture>(
        (resolve, reject) => loader.load(baseDir + f.file, t => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.magFilter = THREE.NearestFilter;
          t.minFilter = THREE.NearestFilter;
          t.generateMipmaps = false;
          resolve(t);
        }, undefined, reject),
      )));
      if (frames.length === 0) return null;
      const aspectOf = (t: THREE.Texture): number => {
        const img = t.image as { width?: number; height?: number } | undefined;
        const w = img?.width ?? 1, h = img?.height ?? 1;
        return h > 0 ? w / h : 1;
      };
      return {
        frameCount: frames.length,
        frameDurationMs: manifest.frameDurationMs ?? 67,
        get: i => frames[Math.min(Math.max(i, 0), frames.length - 1)]!,
        aspect: i => aspectOf(frames[Math.min(Math.max(i, 0), frames.length - 1)]!),
      };
    } catch {
      return null; // clean checkout — the procedural flipbook serves
    }
  }

  // Procedural fallback: colored expanding discs (air: concentric fireball
  // rings; ground: a dome blooming up with a rising smoke head). 6 frames,
  // 100 ms each — Blood's 5-frame/0.5 s SEQ cadence, give or take a frame.
  function proceduralAtlas(kind: 'air' | 'ground'): BurstFrameSource {
    const N = 6;
    const frames: THREE.CanvasTexture[] = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const c = document.createElement('canvas');
      c.width = 64; c.height = kind === 'air' ? 64 : 80;
      const g = c.getContext('2d')!;
      const W = c.width, H = c.height;
      if (kind === 'air') {
        // Fireball: hot core → orange shell → dark smoke ring, expanding.
        const cx = W / 2, cy = H / 2;
        const rCore = 4 + 22 * t, rShell = 8 + 26 * t, rSmoke = 12 + 30 * t;
        g.globalAlpha = 1 - 0.75 * t * t;
        g.fillStyle = '#3a2620';
        g.beginPath(); g.arc(cx, cy, rSmoke, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#c8481a';
        g.beginPath(); g.arc(cx, cy, rShell, 0, Math.PI * 2); g.fill();
        g.fillStyle = t < 0.5 ? '#ffd890' : '#f09040';
        g.beginPath(); g.arc(cx, cy, rCore * (1 - t * 0.7), 0, Math.PI * 2); g.fill();
      } else {
        // Ground: a dome swelling from the bottom + a rising mushroom head.
        const domeR = 8 + 22 * t;
        const headY = H - 10 - 46 * t;
        const headR = 5 + 13 * t + 4 * Math.sin(t * Math.PI);
        g.globalAlpha = 1 - 0.8 * t * t;
        g.fillStyle = '#4a2e22';
        g.beginPath(); g.arc(W / 2, headY, headR + 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#c8481a';
        g.beginPath();
        g.arc(W / 2, H - 8, domeR, Math.PI, 0);
        g.closePath(); g.fill();
        g.fillStyle = t < 0.45 ? '#ffd890' : '#f09040';
        g.beginPath();
        g.arc(W / 2, H - 8, domeR * 0.55 * (1 - t * 0.6), Math.PI, 0);
        g.closePath(); g.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      frames.push(tex);
    }
    return {
      frameCount: N,
      frameDurationMs: 100,
      get: i => frames[Math.min(Math.max(i, 0), N - 1)]!,
      aspect: () => (kind === 'air' ? 1 : 64 / 80),
    };
  }

  air = proceduralAtlas('air');
  ground = proceduralAtlas('ground');
  void tryLoadAtlas(MANIFEST_AIR).then(a => { if (a) { air = a; atlasLoaded = true; } });
  void tryLoadAtlas(MANIFEST_GROUND).then(g => { if (g) { ground = g; atlasLoaded = true; } });

  return {
    get usingAtlas() { return atlasLoaded; },
    spawn(visual: BurstVisual) {
      const src = visual.kind === 'air' ? air! : ground!;
      const mat = new THREE.MeshBasicMaterial({
        map: src.get(0), transparent: true, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      const anchorY = visual.kind === 'air' ? 0 : visual.heightM;
      mesh.position.set(visual.at[0], visual.at[1] + anchorY, visual.at[2]);
      const a0 = src.aspect(0);
      mesh.scale.set(visual.heightM * 2 * a0, visual.heightM * 2, 1);
      scene.add(mesh);
      active.push({ mesh, mat, frame: 0, elapsedMs: 0, halfHeight: visual.heightM, src });
    },
    update(dtSec, camera) {
      for (let i = active.length - 1; i >= 0; i--) {
        const e = active[i]!;
        e.elapsedMs += dtSec * 1000;
        const next = Math.floor(e.elapsedMs / e.src.frameDurationMs);
        if (next >= e.src.frameCount) {
          scene.remove(e.mesh);
          e.mesh.geometry.dispose();
          e.mat.dispose();
          active.splice(i, 1);
          continue;
        }
        if (next !== e.frame) {
          e.frame = next;
          e.mat.map = e.src.get(next);
          e.mat.needsUpdate = true;
          const a = e.src.aspect(next);
          e.mesh.scale.set(e.halfHeight * 2 * a, e.halfHeight * 2, 1);
        }
        e.mesh.lookAt(camera.position);
      }
    },
    dispose() {
      for (const e of active) {
        scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        e.mat.dispose();
      }
      active.length = 0;
    },
  };
}
