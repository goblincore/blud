// src/lab/sdf-zombie/webgpu/fpv-view.ts
//
// The FPV render tail for the SDF zombie lab (X1.23 task 4): three small,
// independent views the orchestration (../fpv-mode.ts) drives —
//
//   1. createHandsGpuView — the first-person hands, marched as their own
//      small SDF field in their own proxy box (the chunk-view tech): ten
//      flesh prims re-packed in WORLD space every frame, camera-anchored,
//      shaded by the hero's live material template (legacy gamma included)
//      with their own wound ring for the hand-splash flourish.
//   2. createStickProp — the dynamite bundle: a cheap cylinder-bundle mesh
//      (never flesh) held in hand / ballistic in flight, plus a flickering
//      fuse spark (point-sprite sphere — no particle system exists in the
//      lab; this is the spec's sanctioned fallback).
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
import {
  blankFaceTexture, createDataTexture, createMarchMaterial, defaultUniforms,
  marchBody, writeWounds, type MarchUniforms,
} from './zombie-gpu';
import {
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE,
} from './march.wgsl';
import { packBody } from '../pack';
import { MAX_PRIMS } from '../validate';
import { WOUND_PROFILES, type Wound } from '../damage';
import { woundWorldPos } from '../damage';
import type { Primitive, Vec3 } from '../types';
import type { BurstVisual } from '../explosion-aoe';

/** Wound-type → shader ring id, mirroring lab-main's TYPE_ID (the shader's
 *  row-6 encoding; single source lives in damage.ts's WoundType order). */
const TYPE_ID: Record<Wound['type'], number> = { pellet: 0, blast: 1, burn: 2 };

// ——— 1. The hands view ————————————————————————————————————————————————————

export interface HandsGpuView {
  object: THREE.Object3D;
  /** Re-packs the world-space hand prims + their wound ring for this frame.
   *  `prims` is [leftHand(5), rightHand(5)] world space — exactly what
   *  fpv-mode's handPrimsToWorld produces (wounds bind to that order). */
  update(prims: Primitive[], wounds: readonly Wound[]): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

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
export function createHandsGpuView(template: MarchUniforms): HandsGpuView {
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
  u.faceCfg.value.x = 0; // never a face

  const material = createMarchMaterial(dataTex, u, marchBody);
  // Unit box; the true axis-aligned cover is applied per frame via scale.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.frustumCulled = false; // camera-anchored: culling flakes on near moves

  /** Packs `prims` as a two-cluster field (left cluster 0, right cluster 1 —
   *  the authored HAND_PRIMS cluster tags) and sizes the proxy box. */
  function apply(prims: Primitive[]) {
    const hand = (cluster: number, limb: Primitive['limb']) => {
      const members = prims.filter(p => p.cluster === cluster && p.op !== 'sub');
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
      return {
        id: cluster, limb,
        start: Math.max(0, prims.findIndex(p => p.cluster === cluster)),
        count: members.length, center, radius: radius || 0.1, alive: true,
      };
    };
    const packed = packBody({
      prims,
      clusters: [hand(0, 'armL'), hand(1, 'armR')],
      bones: new Map(),
    });
    writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, packed.clusterBounds, 2);
    writeRow(ROW_CLUSTER_RANGE, packed.clusterRange, 2);
    u.counts.value.set(packed.primCount, 2, packed.carveCount, packed.maxBlendK);
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
  return {
    object: mesh,
    update(prims, wounds) {
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
    setVisible(on) { mesh.visible = on; },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      dataTex.dispose();
    },
  };
}

// ——— 2. The stick prop ————————————————————————————————————————————————————

export type StickPose =
  | { mode: 'hand'; localPos: Vec3; camQuat: THREE.Quaternion; cooking: boolean }
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
 * The dynamite bundle: four chunky claymation cylinders banded together,
 * standing in the lead hand while held, tumbling in flight. A tiny emissive
 * sphere at the tip is the fuse spark — flickering while the fuse burns
 * (cooking or airborne) via flicker(), parked at zero scale otherwise.
 */
export function createStickProp(): StickProp {
  const group = new THREE.Group();
  const stickGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.15, 8);
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
  for (const y of [-0.035, 0.03]) {
    const b = new THREE.Mesh(bandGeo, bandMat);
    b.position.y = y;
    group.add(b);
  }
  // Fuse stub + spark at the tip.
  const fuse = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, 0.03, 4),
    new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 1 }),
  );
  fuse.position.y = 0.09;
  group.add(fuse);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd070 });
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 6), sparkMat);
  spark.position.y = 0.11;
  group.add(spark);

  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0, -0.1));
  const q = new THREE.Quaternion();
  const spinQ = new THREE.Quaternion();

  return {
    object: group,
    pose(p) {
      if (p.mode === 'gone') { group.visible = false; return; }
      group.visible = true;
      if (p.mode === 'hand') {
        // Held standing in the lead hand, tilted toward screen centre.
        q.copy(p.camQuat).multiply(tilt);
        group.quaternion.copy(q);
        group.position.set(p.localPos[0], p.localPos[1], p.localPos[2]);
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
