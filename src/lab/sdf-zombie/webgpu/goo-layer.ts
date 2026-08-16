// src/lab/sdf-zombie/webgpu/goo-layer.ts
//
// Screen-space metaball blood (gobs-and-goo spec §3): the viscous goo the
// billboard droplets could never sell. Two passes per frame:
//
//   DENSITY — every goo particle (droplets at/over the mist cutoff + all
//   scraps) billboards a soft radial-falloff quad into a half-res additive
//   float target. R accumulates density, G accumulates density * view depth,
//   B accumulates density again as the divisor that turns G into an average
//   depth. Overlapping blobs therefore SUM, which is the entire metaball
//   trick: density is a scalar field on screen, and thresholding it fuses
//   neighbours into ropey strands and sheets while sparse drops stay beads.
//
//   BLUR — the canonical grapes→sheets fix from screen-space fluid
//   rendering (reference: jeantimex/fluid's screen-space pipeline): every
//   splat resolves as its own density peak, so thresholding the RAW field
//   beads trails into pearls no matter how the size/overlap/threshold are
//   tuned. A separable 9-tap Gaussian (horizontal into one target, vertical
//   into the other, sigma = GOO_TUNING.blurPx density-target pixels) widens
//   each peak until neighbours fuse into ropes and sheets. ALL channels are
//   filtered with the same weights, so the g/b depth ratio recovers a depth
//   smoothed exactly as far as the density itself — downstream unchanged.
//   blurPx = 0 bypasses both passes entirely.
//
//   SURFACE — a fullscreen quad re-thresholds the density field per pixel,
//   derives a normal from the density gradient (central differences, 4
//   taps), shades deep-red blood with the march's own light rig, and writes
//   a fake depth reconstructed from the per-pixel average view depth so the
//   goo interleaves with flesh and floor in the canvas depth buffer. When
//   the blur ran, this reads the blurred buffer instead of the raw density.
//
// WHY HALF-FLOAT, not the FloatType the SDF targets use: the density pass
// BLENDS (additive), and WebGPU core only guarantees blending on 16-bit
// float targets — rgba32f blending needs the optional float32-blendable
// feature. Precision is not a concern at this range: density sums live in
// the tens, and the G/B depth ratio needs far less than half-float's ~0.05
// relative resolution.
//
// Render-target discipline copied from sdf-layer.ts: options, the explicit
// first clear after every (re)allocation (three otherwise lazily initialises
// the texture inside the same encoder as the pass that samples it, and
// WebGPU rejects the whole submit), clear-to-BLACK with restore (the
// renderer's clear colour is the scene background, and a non-zero R channel
// would read as density everywhere), and autoClear off for the canvas
// composite so it cannot wipe the frame it composites onto.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, texture, uv, vec2, vec3, vec4, uniform, float, max, dot, positionView,
} from 'three/tsl';
import type { BloodSim } from '../blood-sim';

/**
 * The goo feel knobs. Everything the panel does not expose is still a named
 * number here, because "blobby merged vs discrete beads" is a two-knob
 * family (threshold, blob size) and the rest only matter when re-tuning the
 * family itself.
 */
export const GOO_TUNING = {
  /** InstancedMesh cap for the density pass (droplets + scraps + splats). */
  maxParticles: 1000,
  /**
   * Droplets with sim size UNDER this stay billboard mist (blood-view-gpu);
   * at/over it they feed the density field. 0.05 sits inside the burst band
   * (0.03-0.06), so a gib's burst keeps some fine beads while every trail
   * droplet (BLOOD_TRAIL.size 0.22 ± jitter) goes goo — trails are what
   * strands are made of.
   */
  mistMaxSize: 0.05,
  /** Density target size as a fraction of the SDF layer's size. */
  densityScale: 0.5,
  /**
   * Quad edge, in particle-size units. The falloff reaches zero at the quad
   * EDGE (not corner), so a particle's effective blob radius is
   * size * quadScale / 2. 2.2 puts a trail droplet's radius near 0.24 world
   * units — about half the 20 Hz trail spacing of a fast chunk, which is
   * the minimum for neighbours to fuse into a strand.
   */
  quadScale: 3.2,
  /**
   * World-size multiplier applied to every particle before it splats into the
   * density field. The sim sizes are the game's BILLBOARD sprite sizes
   * (BLOOD_TRAIL.size 0.22 was tuned for game-camera sprites); used raw as
   * physical blob radii they built quarter-metre goo towers (playtest
   * 2026-08-16). Same reasoning as the billboard view's DROPLET_VIEW_SCALE.
   * 0.4 read as thick hose-water ropes once the blur landed; 0.15 broke the
   * air trails into disconnected beads. 0.22 is the owner's mix point: thin
   * CONNECTED liquid strands in the air, with the billboard sprites layered
   * on top carrying the density (owner playtest 2026-08-16).
   */
  sizeScale: 0.22,
  /**
   * Floor-pool radius multiplier on a sim splat's decal size. Splats are the
   * PERSISTENT blood record (they never age out — blood-sim keeps a 256 ring
   * buffer), so feeding them into the density field is what makes pools stay
   * after their droplets die (owner note 2026-08-16: pools vanished with the
   * droplets). Each splat is a billboarded blob at its floor point (flat
   * quads stripe near edge-on in the low-res buffer), elongated 1.4-2.6x
   * along its stamp yaw so pools merge into smears, not perfect circles.
   */
  splatGooScale: 0.35,
  /** Density above which a pixel is goo. A lone blob peaks near 1.0. */
  threshold: 0.4,
  /** Soft-edge band start, as a multiple of the threshold. */
  edge: 1.6,
  /** Density-gradient to normal strength (see GOO_SURFACE_WGSL). */
  bump: 2.5,
  /**
   * Gaussian blur sigma, in density-target pixels, applied separably (H
   * then V) between the density pass and the surface pass — see the BLUR
   * note in the file header. 0 bypasses both blur passes entirely.
   */
  blurPx: 2.5,
} as const;

/**
 * The surface pass. Returns vec4(lit colour, depth-buffer value).
 *
 * No matrices are bound from the quad's own camera (that camera is an
 * orthographic trick at z=1): the SCENE camera's world matrix, position and
 * lens (tan half-fov, aspect, near, far) come in as uniforms, and the pixel
 * ray is rebuilt from NDC by hand. That keeps the pass a single wgslFn with
 * plain parameters — the same shape every other pass here takes — and it
 * sidesteps the alpha trap that forced the march into outputNode: colour
 * goes out through colorNode (so three applies the output sRGB encode),
 * depth through depthNode.
 */
export const GOO_SURFACE_WGSL = /* wgsl */ `fn gooSurface(
  densTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  camWorld: mat4x4<f32>,
  camCfg: vec4<f32>,
  gooCfg: vec3<f32>
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(densTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let maxP = vec2<i32>(dims) - vec2<i32>(1, 1);
  let px = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), maxP);
  let c = textureLoad(densTex, px, 0);
  let dens = c.r;
  let thresh = gooCfg.x;
  if (dens < thresh) { discard; }

  // Normal from the density gradient, central differences (4 taps). The
  // gradient lies in the image plane, so the camera-space normal tilts
  // against it over a flat-facing base. Scaled GENTLY: the density target
  // is low-res, so a blob is only a few texels wide and a steep multiplier
  // turns every texel into a silhouette edge — which fires the fresnel rim
  // across the whole surface and washes the deep red out (measured: the
  // fringe averaged G/R 0.68, i.e. pink-gray, where the base is 0.25).
  let dl = textureLoad(densTex, clamp(px - vec2<i32>(1, 0), vec2<i32>(0, 0), maxP), 0).r;
  let dr = textureLoad(densTex, clamp(px + vec2<i32>(1, 0), vec2<i32>(0, 0), maxP), 0).r;
  let dn = textureLoad(densTex, clamp(px - vec2<i32>(0, 1), vec2<i32>(0, 0), maxP), 0).r;
  let du = textureLoad(densTex, clamp(px + vec2<i32>(0, 1), vec2<i32>(0, 0), maxP), 0).r;
  let grad = vec2<f32>(dr - dl, du - dn) * ${GOO_TUNING.bump.toFixed(1)};
  let nCam = normalize(vec3<f32>(-grad.x, -grad.y, 1.0));
  let n = normalize((camWorld * vec4<f32>(nCam, 0.0)).xyz);

  // The scene-camera ray through this pixel, rebuilt from NDC: the camera
  // looks down -z and the view plane spans tan(halfFov) in y (times aspect
  // in x), so no inverse projection is needed.
  let ndc = st * 2.0 - 1.0;
  let rayCam = normalize(vec3<f32>(ndc.x * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0));
  let ray = normalize((camWorld * vec4<f32>(rayCam, 0.0)).xyz);

  // Fake depth: the density-weighted average view depth accumulated in G/B.
  // Converted to the [0,1] depth-buffer value with the same mapping three's
  // WebGPU perspective matrix produces (Matrix4.makePerspective for the
  // WebGPU coordinate system): far * (d - near) / ((far - near) * d).
  let viewDepth = c.g / max(c.b, 1e-4);
  let near = camCfg.z;
  let far = camCfg.w;
  let depthBuf = clamp(far * (viewDepth - near) / (max(viewDepth, 1e-4) * (far - near)), 0.0, 1.0);

  // Shade with the march's rig: deep red base, key diffuse, a tight wet
  // glint and a fresnel rim. The soft-edge factor darkens and de-glints the
  // thin fringe, so strands taper into darkness rather than ending in a
  // bright hard cut — alpha itself stays 1 (opaque, depth-written).
  let L = normalize(lightDir);
  let Vv = -ray;
  let H = normalize(L + Vv);
  let diff = max(dot(n, L), 0.0);
  let glint = pow(max(dot(n, H), 0.0), 90.0);
  let rim = pow(1.0 - max(dot(n, Vv), 0.0), 4.0) * 0.35;
  let softEdge = smoothstep(thresh, thresh * gooCfg.y, dens);
  let base = vec3<f32>(0.35, 0.02, 0.05);
  var lit = base * (lightCfg.y + diff * lightCfg.x) * keyColor * mix(0.55, 1.0, softEdge);
  lit = lit + keyColor * (glint * 1.2 + rim) * softEdge;

  // Legacy display look (gooCfg.z) — the SAME decode marchBody applies (see
  // march.wgsl.ts): without it the flesh renders through the legacy chain
  // while the blood renders through the honest one, and the pools read
  // washed gray-pink next to the saturated flesh.
  if (gooCfg.z > 0.5) {
    let c = max(lit, vec3<f32>(0.0));
    let lo = c / 12.92;
    let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    lit = select(hi, lo, c <= vec3<f32>(0.04045));
  }

  return vec4<f32>(lit, depthBuf);
}`;

/**
 * One axis of the separable blur (the pass runs twice: dir = (1,0) then
 * (0,1)). Integer-coordinate textureLoad with edge clamping, the same fetch
 * shape the surface pass and coneFetch use — and NO flipY: target-to-target
 * fullscreen sampling is orientation-preserving on this backend (the cone
 * pre-pass proves it), the inversion only appears at the canvas boundary.
 *
 * The 9 weights are derived from sigma at runtime (the slider owns sigma)
 * and normalised, so the kernel preserves the field's total density and the
 * surface threshold stays calibrated at any setting. rgb all take the same
 * weights — g/b stays density*depth over density.
 */
export const GOO_BLUR_WGSL = /* wgsl */ `fn gooBlur(
  srcTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  dir: vec2<f32>,
  sigma: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTex, 0));
  let maxP = vec2<i32>(dims) - vec2<i32>(1, 1);
  let base = vec2<i32>(floor(texCoord * dims));
  var sum = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var i = -4; i <= 4; i = i + 1) {
    let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
    let c = clamp(base + vec2<i32>(dir * f32(i)), vec2<i32>(0, 0), maxP);
    sum = sum + textureLoad(srcTex, c, 0) * w;
    wsum = wsum + w;
  }
  return sum / wsum;
}`;

/** Uniform nodes the goo shares with the march, so one re-tune moves both. */
export interface GooLightRig {
  lightDir: ReturnType<typeof uniform>;
  keyColor: ReturnType<typeof uniform>;
  lightCfg: ReturnType<typeof uniform>;
}

/** three 0.185 types wgslFn's result as a plain Node; this keeps the swizzles honest. */
type Swizzled = { xyz: unknown; w: unknown };

export interface GooLayer {
  /**
   * The frame: density pass, then the separable blur (unless blurPx is 0),
   * then the caller's middle (the whole sdf/cone/occluder/composite flow —
   * see how lab-main installs this over sdfLayer.render), then the surface
   * pass composited onto the canvas.
   */
  render(camera: THREE.PerspectiveCamera, between: () => void): void;
  /** Re-pose the density quads from sim state; call once per frame, before render. */
  sync(sim: BloodSim, camera: THREE.Camera): void;
  /** Density target = densityScale * the SDF layer's size. */
  setSize(sdfWidth: number, sdfHeight: number): void;
  /** Whether the density target comes back inverted relative to the canvas. */
  setFlipY(on: boolean): void;
  setThreshold(v: number): void;
  setEdge(v: number): void;
  /** Gaussian sigma in density-target pixels; 0 bypasses the blur passes. */
  setBlurPx(v: number): void;
  /** Mirror of the march's legacy-gamma flag — keep both on one switch. */
  setLegacyGamma(on: boolean): void;
  readonly threshold: number;
  readonly edge: number;
  readonly blurPx: number;
  readonly targetSize: { width: number; height: number };
  dispose(): void;
}

export function createGooLayer(
  renderer: THREE.WebGPURenderer,
  rig: GooLightRig,
): GooLayer {
  // ---------------------------------------------------------------
  // Density target. Half-float for blendability (file header), no depth
  // (nothing in the accumulation ever depth-tests), nearest because every
  // fetch is an integer textureLoad.
  // ---------------------------------------------------------------
  const target = new THREE.RenderTarget(1, 1, {
    depthBuffer: false,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  // The blur ping-pong pair: horizontal reads the density target and writes
  // blurA, vertical reads blurA and writes blurB, the surface reads blurB.
  // Never sampled with blending and never read while written, so they take
  // the density target's own options verbatim (half-float, nearest, no
  // depth) and live at its exact size — one blur texel is one density texel.
  const blurOpts = {
    depthBuffer: false,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  } as const;
  const blurA = new THREE.RenderTarget(1, 1, blurOpts);
  const blurB = new THREE.RenderTarget(1, 1, blurOpts);

  // Same backend property sdf-layer pinned: render targets come back
  // y-inverted relative to the canvas, flipped on with a uniform so a future
  // three can be corrected from the console rather than the source.
  const uFlipY = uniform(1);
  const uThresh = uniform(GOO_TUNING.threshold);
  // Matches the march's lodCfg.y default (legacy gamma ON) — lab-main's
  // setLegacyGamma drives both together.
  const uLegacy = uniform(1);
  const uEdge = uniform(GOO_TUNING.edge);
  const uBlurPx = uniform(GOO_TUNING.blurPx);
  const uCamWorld = uniform(new THREE.Matrix4());
  // x tan(halfFovY), y aspect, z near, w far.
  const uCamCfg = uniform(new THREE.Vector4(1, 1, 0.1, 200));

  // ---------------------------------------------------------------
  // Density pass: one InstancedMesh of unit quads, additively blending a
  // radial falloff. premultipliedAlpha + AdditiveBlending is the One/One
  // blend pair on the WebGPU backend, so the accumulated sum is never
  // modulated by an alpha the node pipeline never lets us set anyway
  // (DiffuseColor.a is forced to opacity, and opacity is 1).
  // ---------------------------------------------------------------
  const fallQ = uv().sub(0.5).mul(2);              // [-1,1]^2 across the quad
  const fall = max(float(0), dot(fallQ, fallQ).oneMinus());  // max(0, 1 - r*r)
  // View depth of the billboarded quad centre, per fragment: the quads face
  // the camera, so this is constant across each instance.
  const viewDepth = positionView.z.negate();
  const densMat = new MeshBasicNodeMaterial();
  densMat.colorNode = vec4(fall, fall.mul(viewDepth), fall, 1);
  densMat.blending = THREE.AdditiveBlending;
  densMat.premultipliedAlpha = true;
  densMat.transparent = true;
  densMat.depthWrite = false;
  densMat.depthTest = false;
  densMat.fog = false;

  const quads = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1), densMat, GOO_TUNING.maxParticles,
  );
  quads.frustumCulled = false;
  const gooScene = new THREE.Scene();
  gooScene.add(quads);

  // ---------------------------------------------------------------
  // Surface pass: the same fullscreen-quad composite shape sdf-layer uses.
  // Colour through colorNode (three applies the output sRGB encode), fake
  // depth through depthNode, so the hardware interleaves the goo with the
  // flesh and floor already in the canvas depth buffer.
  //
  // TWO instantiations of the same fn, identical except which texture
  // densTex binds: the blurred buffer when the blur ran, the raw density
  // target when it was bypassed. They share every uniform NODE, so slider
  // state cannot drift between them; render() picks per frame by swapping
  // the quad's material, because a texture binding is baked into the node
  // graph at construction.
  // ---------------------------------------------------------------
  const surface = wgslFn(GOO_SURFACE_WGSL);
  function makeSurfaceMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const surfaced = surface({
      densTex: texture(densTexture),
      texCoord: uv(),
      flipY: uFlipY,
      lightDir: rig.lightDir,
      keyColor: rig.keyColor,
      lightCfg: rig.lightCfg,
      camWorld: uCamWorld,
      camCfg: uCamCfg,
      gooCfg: vec3(uThresh, uEdge, uLegacy),
    }) as unknown as Swizzled;
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(surfaced.xyz as never, 1.0);
    m.depthNode = surfaced.w as never;
    m.depthWrite = true;
    m.depthTest = true;
    return m;
  }
  const surfRawMat = makeSurfaceMat(target.texture);
  const surfBlurMat = makeSurfaceMat(blurB.texture);

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), surfRawMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  // z = 1 so the plane at z = 0 sits inside the [0,1] depth range rather
  // than exactly on the near plane, which is degenerate. (sdf-layer's trap.)
  // Shared by the blur quads below — an ortho camera is scene-independent.
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  quadCam.position.z = 1;

  // ---------------------------------------------------------------
  // Blur passes: one fullscreen quad PER DIRECTION (swapping materials on a
  // shared quad every frame would dirty three's render lists for nothing),
  // horizontal density→blurA then vertical blurA→blurB. Opaque full-viewport
  // writes: no blending, nothing depends on the clear colour. Alpha is dead
  // — nothing downstream reads .a — so plain colorNode is safe here despite
  // the alpha-never-reaches-the-target trap (which forces it to 1 anyway).
  // ---------------------------------------------------------------
  const blur = wgslFn(GOO_BLUR_WGSL);
  function makeBlurMat(
    srcTexture: THREE.Texture, dirX: number, dirY: number,
  ): MeshBasicNodeMaterial {
    const blurred = blur({
      srcTex: texture(srcTexture),
      texCoord: uv(),
      dir: vec2(dirX, dirY),
      sigma: uBlurPx,
    }) as unknown as Swizzled;
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(blurred.xyz as never, 1.0);
    m.depthWrite = false;
    m.depthTest = false;
    m.fog = false;
    return m;
  }
  const blurHMat = makeBlurMat(target.texture, 1, 0);
  const blurVMat = makeBlurMat(blurA.texture, 0, 1);

  /** A fullscreen quad scene for a blur direction (or the composite). */
  function fullscreenScene(mat: MeshBasicNodeMaterial): {
    scene: THREE.Scene; quad: THREE.Mesh;
  } {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    q.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(q);
    return { scene: s, quad: q };
  }
  const blurH = fullscreenScene(blurHMat);
  const blurV = fullscreenScene(blurVMat);

  /** Explicit first clear after every (re)allocation — see file header. */
  let targetsNeedInit = true;
  const emptyScene = new THREE.Scene();
  const clearColorScratch = new THREE.Color();

  // Scratch for sync — the same matrix compose blood-view-gpu uses,
  // including the velocity stretch: stretched blobs overlap along their
  // motion, which is what fuses a trail into a strand.
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const camInv = new THREE.Quaternion();
  const vCam = new THREE.Vector3();

  return {
    render(camera, between) {
      // The scene camera's lens and pose, as uniforms — the surface pass
      // rebuilds its pixel rays from these (see GOO_SURFACE_WGSL).
      // updateMatrixWorld first: this runs in the drawFn, after the render
      // callback moved the camera but before any render call has refreshed
      // its matrixWorld — without it the goo would lag a frame behind the
      // flesh on every camera move.
      camera.updateMatrixWorld();
      uCamWorld.value.copy(camera.matrixWorld);
      uCamCfg.value.set(
        Math.tan((camera.fov * Math.PI) / 360),
        camera.aspect,
        camera.near,
        camera.far,
      );

      if (targetsNeedInit) {
        targetsNeedInit = false;
        // All three targets — the blur pair needs the same explicit first
        // clear as the density target itself: setSize reallocates the
        // backing texture, and a lazily-initialised texture inside the same
        // encoder as the pass that samples it gets the whole submit rejected.
        // The clear colour is irrelevant (see sdf-layer's note); what matters
        // is that each texture exists before anything samples it.
        for (const t of [target, blurA, blurB]) {
          renderer.setRenderTarget(t);
          void renderer.render(emptyScene, camera);
        }
      }

      // Pass A — density. Cleared BLACK: the renderer's clear colour is the
      // scene background (0x1a1116), whose red channel would read as a
      // uniform 0.1 density across the whole screen and threshold into a
      // full-frame goo sheet. (Same trap as the occluder pass's clear.)
      const restore = camera.layers.mask;
      const prevClear = renderer.getClearColor(clearColorScratch).getHex();
      renderer.setClearColor(0x000000);
      renderer.setRenderTarget(target);
      void renderer.render(gooScene, camera);
      renderer.setClearColor(prevClear);
      camera.layers.mask = restore;

      // Pass A2 — the separable blur, horizontal then vertical, each a
      // fullscreen quad at the density target's own resolution. Bypassed
      // ENTIRELY at blurPx = 0: not even a degenerate copy pass runs, and
      // the surface reads the raw density target below.
      const blurred = uBlurPx.value > 0;
      if (blurred) {
        renderer.setRenderTarget(blurA);
        void renderer.render(blurH.scene, quadCam);
        renderer.setRenderTarget(blurB);
        void renderer.render(blurV.scene, quadCam);
      }

      // The middle of the frame belongs to whoever composed us — the whole
      // polygon/sdf/cone/occluder/composite flow. Density already sits in
      // its target, so the surface pass can run after it for free.
      between();

      // Pass B — composite the goo surface onto the canvas. autoClear off,
      // or this wipes the frame it is composited onto. The material picks
      // blurred-vs-raw density; reassigned only on crossings of the
      // blurPx = 0 line so the steady frame mutates nothing.
      const wantMat = blurred ? surfBlurMat : surfRawMat;
      if (quad.material !== wantMat) quad.material = wantMat;
      renderer.setRenderTarget(null);
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      void renderer.render(quadScene, quadCam);
      renderer.autoClear = prevAutoClear;
    },

    sync(sim, camera) {
      camInv.copy(camera.quaternion).invert();
      let n = 0;
      for (let i = 0; i < sim.droplets.length && n < GOO_TUNING.maxParticles; i++) {
        const d = sim.droplets[i]!;
        // Mist cutoff: the fine beads stay in the billboard view; everything
        // else feeds the density field. Scraps always go.
        if (d.kind !== 'scrap' && d.size < GOO_TUNING.mistMaxSize) continue;
        p.set(d.pos[0], d.pos[1], d.pos[2]);
        // Billboard, then roll in screen space so the stretch follows velocity.
        vCam.set(d.vel[0], d.vel[1], d.vel[2]).applyQuaternion(camInv);
        const speed = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
        const stretch = 1 + Math.min(speed * 0.18, 0.8);
        roll.setFromAxisAngle(zAxis, Math.atan2(vCam.y, vCam.x));
        q.copy(camera.quaternion).multiply(roll);
        const gs = d.size * GOO_TUNING.sizeScale;
        s.set(gs * stretch * GOO_TUNING.quadScale, gs * GOO_TUNING.quadScale, 1);
        m.compose(p, q, s);
        quads.setMatrixAt(n++, m);
      }
      // Floor pools: every splat becomes an elongated density blob at its
      // floor point (see the splatGooScale note). BILLBOARDED, not laid
      // flat: a flat quad viewed near edge-on covers only a few rows of the
      // low-res density buffer and stripes. The blob is rolled in screen
      // space by the stamp yaw so pools still smear directionally. Droplets
      // take the budget first — they are the flying action — but the splat
      // ring is capped at 256 so both fit.
      for (let i = 0; i < sim.splats.length && n < GOO_TUNING.maxParticles; i++) {
        const sp = sim.splats[i]!;
        p.set(sp.pos[0], 0.02, sp.pos[2]);
        roll.setFromAxisAngle(zAxis, sp.yaw);
        q.copy((camera as THREE.PerspectiveCamera).quaternion).multiply(roll);
        // Deterministic per-splat eccentricity hashed from the stamp yaw.
        const h = Math.sin(sp.yaw * 78.233) * 43758.5453;
        const ecc = 1.4 + (h - Math.floor(h)) * 1.2;
        const gr = sp.size * GOO_TUNING.splatGooScale * 2; // quad edge = 2x radius
        s.set(gr * ecc, gr, 1);
        m.compose(p, q, s);
        quads.setMatrixAt(n++, m);
      }
      for (let i = n; i < GOO_TUNING.maxParticles; i++) {
        m.makeScale(0, 0, 0);
        quads.setMatrixAt(i, m);
      }
      quads.instanceMatrix.needsUpdate = true;
      // Draw only the live instances. At 0 the pass still runs (and clears),
      // which the first-clear discipline depends on.
      quads.count = n;
    },

    setSize(sdfWidth, sdfHeight) {
      const w = Math.max(1, Math.round(sdfWidth * GOO_TUNING.densityScale));
      const h = Math.max(1, Math.round(sdfHeight * GOO_TUNING.densityScale));
      target.setSize(w, h);
      blurA.setSize(w, h);
      blurB.setSize(w, h);
      // setSize reallocates the backing texture — the lazy-init conflict
      // would return on the next frame without a fresh explicit clear.
      targetsNeedInit = true;
    },
    setFlipY(on) { uFlipY.value = on ? 1 : 0; },
    setThreshold(v) { uThresh.value = Math.max(0.05, Math.min(0.95, v)); },
    setEdge(v) { uEdge.value = Math.max(1.01, Math.min(4, v)); },
    setBlurPx(v) { uBlurPx.value = Math.max(0, Math.min(5, v)); },
    setLegacyGamma(on) { uLegacy.value = on ? 1 : 0; },
    get threshold() { return uThresh.value; },
    get edge() { return uEdge.value; },
    get blurPx() { return uBlurPx.value; },
    get targetSize() { return { width: target.width, height: target.height }; },
    dispose() {
      target.dispose();
      blurA.dispose();
      blurB.dispose();
      quads.geometry.dispose();
      densMat.dispose();
      quad.geometry.dispose();
      surfRawMat.dispose();
      surfBlurMat.dispose();
      blurH.quad.geometry.dispose();
      blurV.quad.geometry.dispose();
      blurHMat.dispose();
      blurVMat.dispose();
    },
  };
}
