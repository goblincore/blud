// src/lab/sdf-zombie/webgpu/blood-view-gpu.ts
//
// Instanced billboard renderer for blood-sim: gooey specular droplets +
// flat floor splats. WebGPU twin; ../blood-view.ts mirrors it with plain
// three imports. Keep the two in the same shape.
//
// MIST ONLY since gobs-and-goo task 5: droplets at/over the goo cutoff and
// all scraps render through goo-layer's screen-space metaball pass instead —
// this view keeps the fine burst beads too small to fuse into a surface,
// and the floor splats, which already read well.
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { linearDepth, texture, uniform, vec4 } from 'three/tsl';
import { TRAIL_HIST, type BloodSim } from '../blood-sim';
import { GOO_TUNING } from './goo-layer';
import { softParticleFade } from './soft-fade';

const MAX_DROPLETS = 600;
const MAX_SPLATS = 256;

/** Lab-camera compensation: BLOOD_TRAIL.size was tuned for game camera
 *  distances — the lab camera sits much closer, so unscaled droplets read as
 *  big dropping orbs instead of small trailing beads. */
const DROPLET_VIEW_SCALE = 0.45;

/** Radial red droplet with an off-centre white glint and darker rim — the
 *  specular "gooey latex" read, baked into a texture so both renderer paths
 *  look identical with zero custom shader. */
function dropletTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(190, 16, 28, 1)');
  grad.addColorStop(0.55, 'rgba(140, 10, 24, 1)');
  grad.addColorStop(0.85, 'rgba(70, 4, 12, 1)');
  grad.addColorStop(1, 'rgba(40, 2, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Specular glint, offset up-left like the lab's key light.
  const glint = g.createRadialGradient(24, 22, 0, 24, 22, 9);
  glint.addColorStop(0, 'rgba(255, 235, 235, 0.95)');
  glint.addColorStop(0.5, 'rgba(255, 200, 205, 0.35)');
  glint.addColorStop(1, 'rgba(255, 200, 205, 0)');
  g.fillStyle = glint;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function splatTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(90, 6, 14, 0.95)');
  grad.addColorStop(0.7, 'rgba(60, 4, 10, 0.8)');
  grad.addColorStop(1, 'rgba(40, 2, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface BloodView {
  objects: THREE.Object3D[];
  /**
   * Hide the BEADS and RIBBONS, keeping mist and splats.
   *
   * For the goo layer: once the metaball surface carries the fluid body, the
   * cutout bead quads and the ribbon strips are the exact hard-edged shapes
   * the goo exists to replace, and they render the same particles twice.
   * Mist stays (fine haze over the surface) and splats stay (floor decals,
   * which the goo does not draw).
   */
  setBeadsVisible(v: boolean): void;
  /** Hide the MIST haze sprites. They are billboard quads like any other, so
   *  with the goo surface on they are themselves "little oval drops" — the
   *  thing the goo exists to stop looking like. */
  setMistVisible(v: boolean): void;
  /**
   * SOFT-PARTICLE FADE on the MIST (soft-fade.ts), in metres. At 0 (the
   * default) the mist keeps its shipped opaque CUTOUT material — bit-for-bit
   * today's look. Above 0 the mist swaps to a transparent node material whose
   * coverage is multiplied by the fade, so a haze sprite meeting the floor or
   * a body ends in a gradient rather than a hard depth-test cut.
   *
   * The alpha goes through the node material's `colorNode.w` (the repo's
   * WebGPU transparency rule); the scene depth side is read by the shared
   * helper from `viewportLinearDepth`, never passed in by the caller.
   */
  setSoftFade(metres: number): void;
  /** Re-pose every instance from sim state; call once per frame. */
  sync(sim: BloodSim, camera: THREE.Camera): void;
  dispose(): void;
}

export interface BloodViewOpts {
  /** GAME PAGE ONLY (bleeding-wounds plan task 3): the droplet material
   *  writes depth and cuts out (alphaTest) instead of soft-blending. On the
   *  game page the SDF composite depth-tests its flesh against the POLYGONAL
   *  depth buffer (the march's depth rides the target alpha into the
   *  composite's depthNode), so a droplet that wrote no depth is painted
   *  over by any body whose depth beats the wall BEHIND the droplet — the
   *  droplet vanishes exactly when a body is behind it. depthWrite:true lets
   *  the composite's depth test handle occlusion both ways for free. The
   *  lab stays on the default (false): its look is tuned and bit-frozen.
   *  Splats are NOT affected — they lie on the floor and the floor's own
   *  depth already arbitrates them. */
  dropletDepthWrite?: boolean;
  /** Lab-camera compensation override. Default DROPLET_VIEW_SCALE (0.45):
   *  the lab camera sits close. The game camera sits far, so it passes 1
   *  and droplets read at their sim size — the game-tuned BLOOD_TRAIL band. */
  dropletViewScale?: number;
  /** FILAMENT stretch (X1.bleed-look). Default = the lab's frozen behaviour
   *  (k 0.18, max 0.8, no thinning), which reads as oval cells — the owner's
   *  exact words. A liquid filament conserves volume: as it stretches along
   *  velocity it must THIN across it (y /= sqrt(stretch)), and fast spray
   *  wants 4:1+ aspect, not the lab's 1.8:1 cap. */
  stretch?: { k: number; max: number; thin: boolean };
  /** RIBBONS (X1.bleed-look round 2 — owner: "ribbons and blood trails to
   *  create cohesive lines of fluid", and "stylized excess", not realism).
   *  Beads with enough path history render as camera-facing tapered strips
   *  swept through their recent positions — arcs of liquid, not particles.
   *  Beads too young for a ribbon fall back to the stretched quad so fresh
   *  spawns are never invisible. OFF = every bead is a quad (lab default). */
  ribbons?: boolean;
  /** Render 'mist' droplets on a dedicated instanced mesh (X1.bleed-look).
   *  alphaHash + depthWrite: dithered coverage that still writes depth, so
   *  mist survives the SDF composite's depth test (soft-blended depthWrite:
   *  false would vanish against any body behind it — the muzzle-flash trap)
   *  while reading softer than the beads' hard alphaTest cutout. The dither
   *  is period-correct for this game. OFF = mist droplets render nothing. */
  mist?: boolean;
}

export function createBloodView(opts: BloodViewOpts = {}): BloodView {
  const dropDepth = opts.dropletDepthWrite ?? false;
  const viewScale = opts.dropletViewScale ?? DROPLET_VIEW_SCALE;
  const stretchCfg = opts.stretch ?? { k: 0.18, max: 0.8, thin: false };
  const dropGeom = new THREE.PlaneGeometry(1, 1);
  const drops = new THREE.InstancedMesh(
    dropGeom,
    new THREE.MeshBasicMaterial({
      map: dropletTexture(),
      ...(dropDepth
        ? { transparent: false, depthWrite: true, alphaTest: 0.3 }
        : { transparent: true, depthWrite: false }),
    }),
    MAX_DROPLETS,
  );
  drops.frustumCulled = false;
  const splatGeom = new THREE.PlaneGeometry(1, 1);
  const splats = new THREE.InstancedMesh(
    splatGeom,
    new THREE.MeshBasicMaterial({ map: splatTexture(), transparent: true, depthWrite: false }),
    MAX_SPLATS,
  );
  splats.frustumCulled = false;

  // Mist: its own mesh + material. alphaHash needs no sorted transparency
  // and WRITES DEPTH — see BloodViewOpts.mist for why that is load-bearing.
  //
  // TWO materials, one mesh. The shipped CUTOUT is the default (0 fade). The
  // SOFT twin is created alongside and swapped in only when a caller sets a
  // fade distance, so the default path is untouched (the blood-curl-spike
  // requirement: "default 0 = today's look"). The soft twin carries alpha in
  // `colorNode.w` and reads the scene depth through soft-fade's guard.
  const mistTex = opts.mist ? dropletTexture() : null;
  const mistCutoutMaterial = opts.mist
    ? new THREE.MeshBasicMaterial({
      map: mistTex!,
      alphaTest: 0.45,
      depthWrite: true,
    })
    : null;
  const mistFadeUniform = uniform(0);
  const mistSoftMaterial = opts.mist
    ? (() => {
      const tex = texture(mistTex!);
      const mat = new MeshBasicNodeMaterial();
      mat.colorNode = vec4(
        tex.rgb as never,
        (tex.a as never as { mul(v: unknown): unknown })
          .mul(softParticleFade(linearDepth() as never, mistFadeUniform as never)) as never,
      ) as never;
      mat.transparent = true;
      // Keep the cutout's occlusion contract: a faded mist sprite still writes
      // depth, so it does not vanish behind a body the way a depthWrite:false
      // translucent quad would (BloodViewOpts.mist).
      mat.depthWrite = true;
      mat.depthTest = true;
      mat.side = THREE.DoubleSide;
      mat.fog = false;
      return mat;
    })()
    : null;
  const mist: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.Material> | null = opts.mist
    ? new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      mistCutoutMaterial!,
      MAX_DROPLETS,
    )
    : null;
  if (mist) mist.frustumCulled = false;

  // Ribbon mesh: one dynamic geometry for every strip. Preallocated at the
  // worst case (MAX_DROPLETS strips x TRAIL_HIST points x 2 verts); per-frame
  // CPU fill + setDrawRange. Vertex colours carry the head->tail darkening —
  // opaque, depth-writing, so the SDF composite arbitrates it like any
  // geometry (the same reason the beads went cutout).
  const RIB_VPP = 2; // verts per path point
  const ribMax = 600 * TRAIL_HIST * RIB_VPP;
  const ribbons = opts.ribbons
    ? (() => {
      const geo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(ribMax * 3), 3);
      const col = new THREE.BufferAttribute(new Float32Array(ribMax * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      col.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pos);
      geo.setAttribute('color', col);
      const idx = new Uint32Array(600 * (TRAIL_HIST - 1) * 6);
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      return { geo, pos, col, idx, mesh };
    })()
    : null;

  const m = new THREE.Matrix4();
  const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const camInv = new THREE.Quaternion();
  const vCam = new THREE.Vector3();

  let beadsVisible = true;
  let mistVisible = true;
  const ribbonBeads: { pos: [number, number, number] | number[]; size: number; hist?: [number, number, number][] }[] = [];
  const camPos = new THREE.Vector3();
  function sync(sim: BloodSim, camera: THREE.Camera): void {
    camInv.copy(camera.quaternion).invert();
    ribbonBeads.length = 0;
    camera.getWorldPosition(camPos);
    for (let i = 0; i < MAX_DROPLETS; i++) {
      const d = sim.droplets[i];
      // Every droplet poses here, INCLUDING the ones feeding the metaball
      // density field: the sprites layer over the goo surface — sprites
      // carry the game-style density, the goo carries the wet surface
      // (owner mix, 2026-08-16). Scraps stay goo-only (they are flesh, not
      // spray).
      // Every slot writes BOTH meshes every frame — a slot that recycles
      // from mist to bead (or dies) must zero its counterpart, or a stale
      // matrix ghosts at the old position.
      const isMist = d?.kind === 'mist';
      const renderable = !!d && d.kind !== 'scrap' && (!isMist || !!mist)
        && (isMist ? mistVisible : beadsVisible);
      if (!renderable) {
        m.makeScale(0, 0, 0);
        drops.setMatrixAt(i, m);
        if (mist) mist.setMatrixAt(i, m);
        continue;
      }
      // Ribbon-capable bead? Fill its strip and zero both sprite slots.
      // beadsVisible gates ribbons too — they are the other hard-edged shape
      // the goo layer replaces.
      if (beadsVisible && ribbons && d!.kind === 'drop' && d!.ribbon
        && d!.hist && d!.hist.length >= 3) {
        ribbonBeads.push(d!);
        drops.setMatrixAt(i, zeroM);
        if (mist) mist.setMatrixAt(i, zeroM);
        continue;
      }
      p.set(d!.pos[0], d!.pos[1], d!.pos[2]);
      // Billboard, then roll in screen space so the stretch follows velocity.
      vCam.set(d!.vel[0], d!.vel[1], d!.vel[2]).applyQuaternion(camInv);
      const speed = Math.hypot(d!.vel[0], d!.vel[1], d!.vel[2]);
      const stretch = 1 + Math.min(speed * stretchCfg.k, stretchCfg.max);
      // Volume conservation: a stretching filament thins. Off in the lab.
      const thin = stretchCfg.thin ? 1 / Math.sqrt(stretch) : 1;
      roll.setFromAxisAngle(zAxis, Math.atan2(vCam.y, vCam.x));
      q.copy(camera.quaternion).multiply(roll);
      s.set(d!.size * stretch * viewScale, d!.size * thin * viewScale, 1);
      m.compose(p, q, s);
      if (isMist && mist) {
        mist.setMatrixAt(i, m);
        drops.setMatrixAt(i, zeroM);
      } else {
        drops.setMatrixAt(i, m);
        if (mist) mist.setMatrixAt(i, zeroM);
      }
    }
    drops.instanceMatrix.needsUpdate = true;
    if (mist) mist.instanceMatrix.needsUpdate = true;

    if (ribbons) {
      // Sweep a tapered strip through each bead's history. Extrusion is
      // perpendicular to both the local path direction and the view ray, so
      // the strip always shows its face; width tapers tail -> head at 25%.
      const P = ribbons.pos.array as Float32Array;
      const C = ribbons.col.array as Float32Array;
      const I = ribbons.idx;
      let v = 0;
      let ii = 0;
      for (const b of ribbonBeads) {
        // THIN, aspect-locked, absolutely clamped. Capture round 1 rendered
        // half-metre sails (width scaled with burst beads' fat sim sizes);
        // round 2's fixed clamp still read as rigid blades — long straight
        // strips need width tied to their LENGTH or they wedge. Half-width =
        // 4% of the arc, capped at 1.2 cm.
        // Walk BACKWARD from the head accumulating arc; drop samples past
        // the cap so a fast bead's ribbon stays a streak, never a rod.
        const fullHist = b.hist!;
        let arcLen = 0;
        let startK = fullHist.length - 1;
        for (let k = fullHist.length - 1; k >= 1; k--) {
          const a2 = fullHist[k - 1]!;
          const b2 = fullHist[k]!;
          arcLen += Math.hypot(b2[0] - a2[0], b2[1] - a2[1], b2[2] - a2[2]);
          startK = k - 1;
          if (arcLen > 0.5) break;
        }
        const h = fullHist.slice(startK);
        const n = h.length;
        const halfW = Math.min(0.012, Math.max(0.003, arcLen * 0.04));
        const v0 = v;
        for (let k = 0; k < n; k++) {
          const pt = h[k]!;
          const prev = h[Math.max(0, k - 1)]!;
          const next = h[Math.min(n - 1, k + 1)]!;
          let dx = next[0] - prev[0];
          let dy = next[1] - prev[1];
          let dz = next[2] - prev[2];
          // view ray from camera to this point
          const rx = pt[0] - camPos.x;
          const ry = pt[1] - camPos.y;
          const rz = pt[2] - camPos.z;
          // side = normalize(cross(dir, ray))
          let sx = dy * rz - dz * ry;
          let sy = dz * rx - dx * rz;
          let sz = dx * ry - dy * rx;
          const sl = Math.hypot(sx, sy, sz) || 1;
          // Taper INVERTED from round 2: a spurt is thickest at its ROOT
          // (oldest sample, nearest the wound) and breaks up toward the
          // flying tip — root-fat reads as pouring fluid, tip-fat read as
          // shattered glass.
          const t = k / (n - 1);
          const w = halfW * (1.0 - 0.7 * t);
          sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
          P[v * 3] = pt[0] - sx; P[v * 3 + 1] = pt[1] - sy; P[v * 3 + 2] = pt[2] - sz;
          P[v * 3 + 3] = pt[0] + sx; P[v * 3 + 4] = pt[1] + sy; P[v * 3 + 5] = pt[2] + sz;
          // colour: dark tail -> bright arterial head (stylized excess).
          // Gore red — wet-bright at the root, drying dark toward the tip.
          const r = 0.5 - 0.3 * t;
          const g = 0.03 - 0.02 * t;
          const bl = 0.035 - 0.02 * t;
          C[v * 3] = r; C[v * 3 + 1] = g; C[v * 3 + 2] = bl;
          C[v * 3 + 3] = r; C[v * 3 + 4] = g; C[v * 3 + 5] = bl;
          v += 2;
        }
        for (let k = 0; k < n - 1; k++) {
          const a = v0 + k * 2;
          I[ii++] = a; I[ii++] = a + 1; I[ii++] = a + 2;
          I[ii++] = a + 1; I[ii++] = a + 3; I[ii++] = a + 2;
        }
      }
      ribbons.geo.setDrawRange(0, ii);
      ribbons.pos.needsUpdate = true;
      ribbons.col.needsUpdate = true;
      ribbons.geo.index!.needsUpdate = true;
    }

    for (let i = 0; i < MAX_SPLATS; i++) {
      const sp = sim.splats[i];
      if (!sp) { m.makeScale(0, 0, 0); splats.setMatrixAt(i, m); continue; }
      p.set(sp.pos[0], 0.005 + i * 0.0001, sp.pos[2]); // tiny y-ladder beats z-fight
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      roll.setFromAxisAngle(zAxis, sp.yaw);
      q.multiply(roll);
      s.set(sp.size, sp.size, 1);
      m.compose(p, q, s);
      splats.setMatrixAt(i, m);
    }
    splats.instanceMatrix.needsUpdate = true;
  }

  const objects: THREE.Object3D[] = [drops, splats];
  if (mist) objects.push(mist);
  if (ribbons) objects.push(ribbons.mesh);
  return {
    objects,
    setBeadsVisible(v) { beadsVisible = v; },
    setMistVisible(v) { mistVisible = v; },
    setSoftFade(metres: number) {
      const m = Number.isFinite(metres) ? Math.max(0, Math.min(4, metres)) : 0;
      mistFadeUniform.value = m;
      if (mist) mist.material = (m > 0 ? mistSoftMaterial! : mistCutoutMaterial!);
    },
    sync,
    dispose() {
      for (const o of [drops, splats, mist, ribbons?.mesh]) {
        if (!o) continue;
        (o as THREE.Mesh).geometry.dispose();
        ((o as THREE.Mesh).material as THREE.Material).dispose();
      }
      // The mist mesh can only hold ONE of the two materials at a time, so the
      // other is disposed explicitly (disposing the same material twice is a
      // no-op, not an error).
      if (mistCutoutMaterial) mistCutoutMaterial.dispose();
      if (mistSoftMaterial) mistSoftMaterial.dispose();
      if (mistTex) mistTex.dispose();
    },
  };
}
