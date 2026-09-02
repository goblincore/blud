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
  attribute,
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
  splatGooScale: 0.25,
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
  /**
   * Beer-Lambert thickness strength (blood-viscosity spec §d). Multiplies
   * (density - threshold) before the absorption exponential, so it scales
   * how fast a mass darkens as it thickens. 0 flattens the body to a single
   * colour (no thickness falloff) — this is NOT the pre-viscosity look,
   * since the base colour literal changed in this same commit too (0.35,
   * 0.02, 0.05 → 0.62, 0.11, 0.10).
   * 0.55 is the 2D prototype's owner-selected value.
   */
  absorb: 0.55,
  /**
   * Cap on the velocity stretch applied to each density quad: a particle's
   * quad is elongated along its screen-space motion by 1 + min(speed * 0.18,
   * stretchMax). The lab wants this — it turns a slow trail into a strand.
   *
   * It is ACTIVELY WRONG for a gout. Impact droplets leave at up to 8 m/s, so
   * every one of them pins at the cap and points radially outward from the
   * hit, which renders as a starburst of needles rather than a fused mass
   * (owner, 2026-08-31: "reads distinctly as elongated ovals"). The 2D
   * prototype that set the target look had no velocity stretch at all.
   * 0 = round blobs, which is the reference-look setting.
   */
  stretchMax: 0.8,
  /** Specular strength — the wet glint that sells "shiny". */
  spec: 1.4,
  /** Specular exponent. LOW = broad wet sheen, HIGH = a pinpoint star. */
  gloss: 80,
  /** Fresnel rim strength, warm-tinted so edges do not read pink. */
  rim: 0.3,
  /**
   * Unlit deep-red floor added to every goo pixel, so neither heavy
   * absorption nor a grazing light angle can drive blood to black. 0 restores
   * the physically-pure (and, per the owner, wrong-looking) behaviour.
   */
  shadowRed: 0.12,
  /**
   * Reconstruct world-oriented surface normals from the field's own view
   * depth, instead of tilting a camera-facing base by the density gradient.
   * The gradient normal cannot respond to where a surface points in the
   * world, which is what made the goo read as pasted on even once it
   * occluded correctly (owner, 2026-08-31).
   */
  surfaceNormals: true,
} as const;

/**
 * Gate + documentation flag for the gut-mask channel assignment (organs r3):
 * the density target's BLUE channel carries gut-weighted density.
 *
 * NOT alpha, which is what this first tried. The density pass writes through
 * a node material's `colorNode`, and three FORCES that alpha to `opacity`
 * (see the density-pass comment below, which said so before this was
 * written). A custom alpha term is silently discarded, so `.a` accumulated a
 * constant 1 per overlapping quad — and `gutFrac = a/r` then came out >= 1
 * almost everywhere, painting every blood pixel with the organ colour. That
 * is what "the blood looks wrong" was.
 *
 * `.b` is genuinely free, and freeing it cost nothing: the pass wrote `fall`
 * into BOTH `.r` and `.b`, and view depth was reconstructed as `.g/.b`.
 * Dividing by `.r` instead is the same number — same value, same precision —
 * so `.b` was redundant, not spare-by-accident.
 *
 * If a future change needs `.b`, move this flag with the assignment and fix
 * the surface pass in the same commit; never let two meanings share a
 * channel silently.
 */
export const GOO_DENSITY_BLUE_IS_GUT_MASK = true;

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
  gooCfg: vec3<f32>,
  gooCfg2: vec4<f32>,
  organColor: vec3<f32>,
  shadowRed: f32,
  normalMode: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(densTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let maxP = vec2<i32>(dims) - vec2<i32>(1, 1);
  let px = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), maxP);
  let c = textureLoad(densTex, px, 0);
  let dens = c.r;
  let thresh = gooCfg.x;
  let specStr = gooCfg2.y;
  let glossPow = gooCfg2.z;
  let rimStr = gooCfg2.w;
  if (dens < thresh) { discard; }

  // The scene-camera ray through this pixel, rebuilt from NDC: the camera
  // looks down -z and the view plane spans tan(halfFov) in y (times aspect
  // in x), so no inverse projection is needed. Computed HERE because the
  // surface-normal reconstruction below needs the same NDC.
  let ndc = st * 2.0 - 1.0;
  let rayCam = normalize(vec3<f32>(ndc.x * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0));
  let ray = normalize((camWorld * vec4<f32>(rayCam, 0.0)).xyz);

  // Four neighbours, loaded WHOLE: .r is density (the gradient normal) and
  // g/b is the density-weighted view depth (the surface normal). One set of
  // taps feeds both paths, so the new normal costs no extra samples.
  let cl = textureLoad(densTex, clamp(px - vec2<i32>(1, 0), vec2<i32>(0, 0), maxP), 0);
  let cr = textureLoad(densTex, clamp(px + vec2<i32>(1, 0), vec2<i32>(0, 0), maxP), 0);
  let cd = textureLoad(densTex, clamp(px - vec2<i32>(0, 1), vec2<i32>(0, 0), maxP), 0);
  let cu = textureLoad(densTex, clamp(px + vec2<i32>(0, 1), vec2<i32>(0, 0), maxP), 0);

  // GRADIENT NORMAL (normalMode 0, the original). The gradient lies in the
  // image plane, so the camera-space normal tilts against it over a flat
  // CAMERA-FACING base. Scaled gently: the density target is low-res, so a
  // blob is only a few texels wide and a steep multiplier turns every texel
  // into a silhouette edge — which fires the fresnel rim across the whole
  // surface and washes the deep red out (measured: fringe G/R 0.68,
  // pink-gray, where the base is 0.25).
  //
  // Its limitation is STRUCTURAL, not tuning: the base is always +z in view
  // space, so every blob is lit as though facing the camera and the lighting
  // cannot respond to where the surface actually points in the world. That is
  // what made the goo read as pasted on even once it occluded correctly.
  let grad = vec2<f32>(cr.r - cl.r, cu.r - cd.r) * ${GOO_TUNING.bump.toFixed(1)};
  let nGrad = normalize(vec3<f32>(-grad.x, -grad.y, 1.0));

  // SURFACE NORMAL (normalMode 1). The standard screen-space fluid
  // reconstruction: turn each texel's view depth back into a view-space
  // POSITION, then cross the screen-space derivatives of that position. The
  // result is a real surface normal that responds to the shape of the blood
  // in 3D. The unnormalised ray with z = -1, scaled by view depth, IS the
  // view position — so this needs no inverse projection either.
  let texel = vec2<f32>(2.0, 2.0) / dims;
  let dC = c.g / max(c.r, 1e-4);
  let pC = vec3<f32>(ndc.x * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0) * dC;
  let pL = vec3<f32>((ndc.x - texel.x) * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0)
    * (cl.g / max(cl.r, 1e-4));
  let pR = vec3<f32>((ndc.x + texel.x) * camCfg.x * camCfg.y, ndc.y * camCfg.x, -1.0)
    * (cr.g / max(cr.r, 1e-4));
  let pD = vec3<f32>(ndc.x * camCfg.x * camCfg.y, (ndc.y - texel.y) * camCfg.x, -1.0)
    * (cd.g / max(cd.r, 1e-4));
  let pU = vec3<f32>(ndc.x * camCfg.x * camCfg.y, (ndc.y + texel.y) * camCfg.x, -1.0)
    * (cu.g / max(cu.r, 1e-4));

  // MIN-DIFFERENCE against silhouettes: at the edge of a blob one neighbour
  // sits on empty field, where g/b is a ratio of two near-zeros and the
  // reconstructed depth is meaningless. Using it would bend the normal hard
  // along every silhouette and ring each mass with a bright rim. Take
  // whichever of the forward/backward difference has the smaller depth jump,
  // and reject a neighbour outright when it carries no density at all.
  var ddx = pR - pC;
  let ddxB = pC - pL;
  if (cr.r < 1e-4 || abs(ddxB.z) < abs(ddx.z)) { ddx = ddxB; }
  var ddy = pU - pC;
  let ddyB = pC - pD;
  if (cu.r < 1e-4 || abs(ddyB.z) < abs(ddy.z)) { ddy = ddyB; }
  var nSurf = cross(ddx, ddy);
  let nSurfLen = length(nSurf);
  // Degenerate on an isolated texel (both differences empty): fall back to
  // the gradient normal rather than emitting a NaN that would blacken the px.
  if (nSurfLen < 1e-8) {
    nSurf = nGrad;
  } else {
    nSurf = nSurf / nSurfLen;
    // The camera looks down -z, so a surface facing it has a +z normal; the
    // cross product's winding depends on which differences survived above.
    if (nSurf.z < 0.0) { nSurf = -nSurf; }
  }

  let nCam = select(nGrad, nSurf, normalMode > 0.5);
  let n = normalize((camWorld * vec4<f32>(nCam, 0.0)).xyz);

  // Fake depth: the density-weighted average view depth accumulated in G/B.
  // Converted to the [0,1] depth-buffer value with the same mapping three's
  // WebGPU perspective matrix produces (Matrix4.makePerspective for the
  // WebGPU coordinate system): far * (d - near) / ((far - near) * d).
  let viewDepth = c.g / max(c.r, 1e-4);
  let near = camCfg.z;
  let far = camCfg.w;
  let depthBuf = clamp(far * (viewDepth - near) / (max(viewDepth, 1e-4) * (far - near)), 0.0, 1.0);

  // Shade with the march's rig, over a BEER-LAMBERT body (blood-viscosity
  // spec §d). The old flat base made every mass the same red whatever its
  // depth, which is exactly why the layer read as stickers rather than
  // fluid. Absorption over the field ABOVE the threshold does NOT make
  // brightness rise monotonically toward the edge: the softEdge mix below
  // dims the outermost sliver of the silhouette (strands taper into
  // darkness there — preserved from the pre-Beer-Lambert version), so the
  // profile is dark right at the edge, brightest orange-red just inside the
  // soft-edge band, then darkens again toward a near-black crimson core as
  // thickness accumulates. That non-monotonic profile IS the volume read,
  // and it is what the reference frames have that the shipped effect did
  // not. Red is absorbed lightly and green and blue hard, which is why
  // blood is red rather than grey at depth.
  let L = normalize(lightDir);
  let Vv = -ray;
  let H = normalize(L + Vv);
  let diff = max(dot(n, L), 0.0);
  let softEdge = smoothstep(thresh, thresh * gooCfg.y, dens);

  let thick = max(dens - thresh, 0.0) * gooCfg2.x;
  let trans = exp(-thick * vec3<f32>(0.30, 2.40, 2.00));
  let lambert = lightCfg.y + diff * lightCfg.x;

  // Guts take the organ colour; blood stays blood. Per-pixel by ratio rather
  // than a global switch, because a disembowelled body bleeds heavily in
  // exactly the pixels the rope occupies. .a accumulated gut-weighted density
  // (see the density pass's colorNode), so a/r IS the gut share of this
  // pixel's field — and it survives the blur, which filters all four
  // channels with the same normalised weights.
  var gutFrac = c.b / max(c.r, 1e-4);
  gutFrac = clamp(gutFrac, 0.0, 1.0);
  let baseCol = mix(vec3<f32>(0.62, 0.11, 0.10), organColor, gutFrac);
  var lit = baseCol * trans * lambert * keyColor
    * mix(0.55, 1.0, softEdge);

  // SHADOW FLOOR (owner, 2026-08-31: "get rid of black for the shadow areas
  // of the blood, i always want it to read red"). Two independent terms drive
  // this surface to zero: absorption at high thickness (trans -> 0 in the
  // core) and the diffuse term at grazing light (lambert -> ambient). Both
  // are correct as transport, and together they make the darkest blood
  // colourless — which reads as a hole in the frame rather than as blood.
  //
  // Rather than weaken either term, add an unlit floor that nothing can
  // subtract from: a deep saturated red standing in for the light that
  // scatters back out of a thick medium instead of being absorbed by it.
  // The result is that the darkest possible blood is DARK RED, never black.
  // Added, not maxed, so it lifts the shadows without flattening the
  // gradient the thickness term produces. Scaled by softEdge so the very
  // outer sliver still tapers out rather than ending on a lit fringe.
  lit = lit + vec3<f32>(1.0, 0.055, 0.07) * shadowRed * softEdge;

  // Highlights ride ON TOP of the absorbed body and are NOT absorbed — a
  // surface reflection never travelled through the blood, so neither term
  // below carries the trans factor. The glint is tight but NOT white: it
  // takes the key light's own colour (keyColor), same as the diffuse term.
  // The rim also rides keyColor (GooLightRig's own doc: one re-tune moves
  // both) but keeps its own warm tint on top, so a fringe cannot wash the
  // mass pink — a neutral rim did that at high bump values.
  let glint = pow(max(dot(n, H), 0.0), glossPow);
  lit = lit + keyColor * glint * specStr * softEdge;
  // Fresnel exponent 3.0 (was 4.0 pre-viscosity) — a slightly wider rim band.
  let fres = pow(1.0 - max(dot(n, Vv), 0.0), 3.0);
  lit = lit + keyColor * vec3<f32>(0.85, 0.14, 0.12) * fres * rimStr * softEdge;

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
 * Overlay mode's alpha (blood-viscosity spec §c). `gooSurface` spends its w
 * on the reconstructed depth value, so the soft-edge band that overlay mode
 * blends with comes from here — one texel load, no gradient taps.
 *
 * The discard condition is duplicated deliberately and must stay identical
 * to the surface pass's: if the two disagreed on the cutoff, overlay would
 * blend a colour the surface never shaded.
 *
 * Returns a vec4 rather than a bare f32 so it swizzles through the same
 * `Swizzled` cast every other pass here uses.
 */
export const GOO_ALPHA_WGSL = /* wgsl */ `fn gooAlpha(
  densTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  gooCfg: vec3<f32>
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(densTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let maxP = vec2<i32>(dims) - vec2<i32>(1, 1);
  let px = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), maxP);
  let dens = textureLoad(densTex, px, 0).r;
  let thresh = gooCfg.x;
  if (dens < thresh) { discard; }
  let a = smoothstep(thresh, thresh * gooCfg.y, dens);
  return vec4<f32>(0.0, 0.0, 0.0, a);
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
  /**
   * Redirects the surface composite (normally canvas-bound) into this
   * target; null restores the canvas. post-aa captures the frame this way.
   * The target MUST carry a depth buffer — the surface depth-tests against
   * what the sdf composite left behind.
   */
  setOutputTarget(t: THREE.RenderTarget | null): void;
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
  /** World-size multiplier per particle (GOO_TUNING.sizeScale). Bigger blobs
   *  overlap more, which is what turns beads into ropes and sheets — the
   *  file's own tuning note: 0.15 breaks trails into disconnected beads,
   *  0.22 gives thin connected strands, 0.4 reads as thick hose-water ropes. */
  setSizeScale(v: number): void;
  /** Beer-Lambert thickness strength — 0 flattens the body to a single
   *  colour; NOT the pre-viscosity look, since the base colour literal
   *  changed in the same commit that added this. */
  setAbsorb(v: number): void;
  /** Specular strength (the wet glint). */
  setSpec(v: number): void;
  /** Specular exponent — low is a broad sheen, high is a pinpoint. */
  setGloss(v: number): void;
  /** Fresnel rim strength. */
  setRim(v: number): void;
  /** Velocity-stretch cap (GOO_TUNING.stretchMax). 0 = round blobs. */
  setStretch(v: number): void;
  /** Deep-red floor so blood never reads black. 0 = off. */
  setShadowRed(v: number): void;
  /** true = world-oriented surface normals reconstructed from depth;
   *  false = the original screen-space density-gradient normals. */
  setSurfaceNormals(on: boolean): void;
  /**
   * 'overlay' (default) composites the goo over the finished frame with no
   * depth involvement. 'depth' restores the original reconstructed-depth
   * interleaving — kept as the escape hatch if the overlay reads wrong
   * against walls in play.
   */
  setMode(m: 'overlay' | 'depth'): void;
  readonly mode: 'overlay' | 'depth';
  readonly sizeScale: number;
  /** Mirror of the march's legacy-gamma flag — keep both on one switch. */
  setLegacyGamma(on: boolean): void;
  readonly threshold: number;
  readonly edge: number;
  readonly blurPx: number;
  readonly absorb: number;
  readonly spec: number;
  readonly gloss: number;
  readonly rim: number;
  readonly stretch: number;
  readonly shadowRed: number;
  readonly surfaceNormals: boolean;
  readonly targetSize: { width: number; height: number };
  /** DIAGNOSTIC: how many density quads the last sync() posed. 0 while blood
   *  is on screen means the mist/size cutoff rejected everything. */
  /** DIAGNOSTIC: the density targets, for console/headless readback. Reading
   *  these is how you tell "the field is empty" apart from "the field is full
   *  and the surface is not drawing it" — the two look identical on screen. */
  readonly debugTargets: { density: THREE.RenderTarget; blurred: THREE.RenderTarget };
  readonly liveCount: number;
  /** DIAGNOSTIC: how many times sync() has been called. STAYS 0 if the host
   *  page never wired it — the failure that hid this layer entirely on the
   *  game page, and which no amount of tuning could have revealed. */
  readonly syncCalls: number;
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
  /** Runtime sizeScale — see setSizeScale. */
  let sizeScale: number = GOO_TUNING.sizeScale;
  // Matches the march's lodCfg.y default (legacy gamma ON) — lab-main's
  // setLegacyGamma drives both together.
  const uLegacy = uniform(1);
  const uEdge = uniform(GOO_TUNING.edge);
  const uBlurPx = uniform(GOO_TUNING.blurPx);
  const uAbsorb = uniform(GOO_TUNING.absorb);
  const uSpec = uniform(GOO_TUNING.spec);
  const uGloss = uniform(GOO_TUNING.gloss);
  const uRim = uniform(GOO_TUNING.rim);
  const uShadowRed = uniform(GOO_TUNING.shadowRed);
  // The organ colour the gut fraction lerps toward (organs r3) — the same
  // pale salmon the flesh presets carry as organColor, so the spilled rope
  // and the cavity viscera read as one material.
  const uOrganColor = uniform(new THREE.Vector3(0.72, 0.32, 0.30));
  const uNormalMode = uniform(GOO_TUNING.surfaceNormals ? 1 : 0);
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
  // Per-instance gut flag (organs r3): 1 on a gut rope's droplets, 0 on
  // blood. Read as a vertex attribute; the fragment stage gets it through a
  // varying, the standard path for geometry attributes in a colorNode.
  const gutMask = attribute<'float'>('gutMask', 'float');
  const densMat = new MeshBasicNodeMaterial();
  // ALPHA IS THE GUT MASK (organs r3). It was a constant 1 and never read —
  // .r is density and .g/.b reconstruct view depth, all consumed — so this is
  // the one free channel. Writing fall * gutMask makes .a accumulate
  // gut-weighted density, and a/r is then the per-pixel gut fraction the
  // surface pass lerps by (gutFrac in GOO_SURFACE_WGSL).
  //
  // Additive blending with premultipliedAlpha blends RGB as ONE,ONE, and the
  // alpha term the same, so carrying a mask in .a cannot perturb the colour
  // channels. The gate for that: the density target must CLEAR its alpha to
  // 0 (three's setClearColor defaults to 1 — pinned in render()).
  densMat.colorNode = vec4(fall, fall.mul(viewDepth), fall.mul(gutMask), 1);
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
  // The gut flag's storage (organs r3): one float per instance, written in
  // sync() alongside the instance matrices. InstancedBufferAttribute so the
  // vertex buffer steps per instance, not per vertex.
  const gutAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(GOO_TUNING.maxParticles), 1,
  );
  quads.geometry.setAttribute('gutMask', gutAttr);
  const gutArr = gutAttr.array as Float32Array;
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
  const alphaFn = wgslFn(GOO_ALPHA_WGSL);

  /** The shaded colour, shared by both modes. */
  function shadeOf(densTexture: THREE.Texture): Swizzled {
    return surface({
      densTex: texture(densTexture),
      texCoord: uv(),
      flipY: uFlipY,
      lightDir: rig.lightDir,
      keyColor: rig.keyColor,
      lightCfg: rig.lightCfg,
      camWorld: uCamWorld,
      camCfg: uCamCfg,
      gooCfg: vec3(uThresh, uEdge, uLegacy),
      gooCfg2: vec4(uAbsorb, uSpec, uGloss, uRim),
      organColor: uOrganColor,
      shadowRed: uShadowRed,
      normalMode: uNormalMode,
    }) as unknown as Swizzled;
  }

  /**
   * OVERLAY (default). No depth at all: the goo composites over the finished
   * frame. This DELETES the depth blocker rather than fixing it — the
   * reconstruction from the density field's average view depth rejected
   * near-body blood, so goo appeared only against distant background. The
   * accepted cost is that a burst behind a pillar still paints over it,
   * which for a sub-second event centred on the thing you just shot is close
   * to theoretical.
   */
  function makeOverlayMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const shaded = shadeOf(densTexture);
    const a = alphaFn({
      densTex: texture(densTexture),
      texCoord: uv(),
      flipY: uFlipY,
      gooCfg: vec3(uThresh, uEdge, uLegacy),
    }) as unknown as Swizzled;
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(shaded.xyz as never, a.w as never);
    m.depthWrite = false;
    m.depthTest = false;
    m.transparent = true;
    m.fog = false;
    return m;
  }

  /** DEPTH (the escape hatch). The original behaviour, kept intact. */
  function makeDepthMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const shaded = shadeOf(densTexture);
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(shaded.xyz as never, 1.0);
    m.depthNode = shaded.w as never;
    m.depthWrite = true;
    m.depthTest = true;
    m.fog = false;
    return m;
  }

  const surfMats = {
    overlay: { raw: makeOverlayMat(target.texture), blur: makeOverlayMat(blurB.texture) },
    depth: { raw: makeDepthMat(target.texture), blur: makeDepthMat(blurB.texture) },
  };
  let mode: 'overlay' | 'depth' = 'overlay';

  // DIAGNOSTIC counters — see the note where they are assigned in sync().
  let stretchMax: number = GOO_TUNING.stretchMax;
  let syncCalls = 0;
  let liveCount = 0;

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), surfMats.overlay.raw);
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
  // writes: no blending, nothing depends on the clear colour. The filtered
  // .w IS written back (organs r3): the gut mask rides the field's .a and
  // must survive the blur, which filters all four channels with the same
  // weights — a constant 1 here would repaint every blurred pixel as full
  // gut. No premultiplied-alpha concern: these materials are opaque, so the
  // fragment output lands in the target unblended.
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

  /** Where the surface composite draws — null is the canvas. See setOutputTarget. */
  let outputTarget: THREE.RenderTarget | null = null;

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
      // ALPHA 0, explicitly: setClearColor's alpha parameter defaults to 1,
      // and a cleared-to-1 alpha is a gut mask of 1 in every EMPTY pixel —
      // a/r would clamp to full gut across the whole layer (organs r3).
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
      // or this wipes the frame it is composited onto. The material is picked
      // per frame from BOTH live axes — mode (overlay/depth) and blurred-vs-raw
      // density — and reassigned only when the pick actually differs from what
      // the quad already holds, so a steady frame mutates nothing while
      // setMode() still takes effect on the very next frame rather than
      // waiting for a blurPx = 0 crossing.
      const wantMat = surfMats[mode][blurred ? 'blur' : 'raw'];
      if (quad.material !== wantMat) quad.material = wantMat;
      renderer.setRenderTarget(outputTarget);
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
        //
        // The explicit 'mist' kind (bleeding-wounds, 2026-08-31) is haze by
        // construction and NEVER feeds density, whatever its size — some
        // stump mist rolls above mistMaxSize, and letting it in fogs the
        // field instead of thickening the stream. No-op for the lab, which
        // has no mist particles.
        if (d.kind === 'mist') continue;
        if (d.kind !== 'scrap' && d.size < GOO_TUNING.mistMaxSize) continue;
        p.set(d.pos[0], d.pos[1], d.pos[2]);
        // Billboard, then roll in screen space so the stretch follows velocity.
        vCam.set(d.vel[0], d.vel[1], d.vel[2]).applyQuaternion(camInv);
        const speed = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
        const stretch = 1 + Math.min(speed * 0.18, stretchMax);
        roll.setFromAxisAngle(zAxis, Math.atan2(vCam.y, vCam.x));
        q.copy(camera.quaternion).multiply(roll);
        const gs = d.size * sizeScale;
        s.set(gs * stretch * GOO_TUNING.quadScale, gs * GOO_TUNING.quadScale, 1);
        m.compose(p, q, s);
        gutArr[n] = d.kind === 'gut' ? 1 : 0;
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
        gutArr[n] = 0; // floor pools are blood, never gut
        quads.setMatrixAt(n++, m);
      }
      for (let i = n; i < GOO_TUNING.maxParticles; i++) {
        m.makeScale(0, 0, 0);
        quads.setMatrixAt(i, m);
        gutArr[i] = 0;
      }
      quads.instanceMatrix.needsUpdate = true;
      gutAttr.needsUpdate = true;
      // Draw only the live instances. At 0 the pass still runs (and clears),
      // which the first-clear discipline depends on.
      quads.count = n;
      // DIAGNOSTIC (blood-viscosity): the two numbers that tell you whether
      // this layer is being fed at all. syncCalls proves sync() is wired into
      // the host page's frame at all — it shipped MISSING on the game page,
      // which made the density field empty forever and every threshold sweep
      // unwinnable. liveCount is how many quads the last sync actually posed:
      // 0 with blood visible on screen means the cutoff rejected everything,
      // non-zero means the field has input and any remaining problem is
      // downstream in the density/surface passes.
      syncCalls++;
      liveCount = n;
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
    setOutputTarget(t) { outputTarget = t; },
    setFlipY(on) { uFlipY.value = on ? 1 : 0; },
    // CEILING RAISED TO 4 (2026-08-31). It was 0.95, and the file's own note
    // says "a lone blob peaks near 1.0" — so no threshold in the old range
    // could ever REJECT a single droplet, and the field rendered every
    // isolated bead as its own oval blob no matter how it was tuned. Owner
    // read that as "little oval drops" three rounds running. Above 1 the
    // threshold starts demanding genuine overlap, which is the whole point
    // of a metaball: 2 blobs to cross ~1.5, 3 to cross ~2.5. The lab keeps
    // its 0.4 default, so nothing there moves.
    setThreshold(v) { uThresh.value = Math.max(0.05, Math.min(4, v)); },
    setEdge(v) { uEdge.value = Math.max(1.01, Math.min(4, v)); },
    // Ceiling 5 -> 16: wider blur is how neighbouring peaks merge before the
    // threshold sees them. (5.5 was being silently clamped to 5.)
    setBlurPx(v) { uBlurPx.value = Math.max(0, Math.min(16, v)); },
    setSizeScale(v) { sizeScale = Math.max(0.05, Math.min(1.5, v)); },
    // CLAMP RANGES are checked against what the shader actually produces, not
    // guessed — see the setThreshold note above for what guessing cost.
    // absorb: 0 flattens the body to one colour (not the pre-viscosity look
    // — the base literal changed too, see GOO_TUNING.absorb above). Ceiling
    // kept at 3: it is the CORE that saturates, not the fringe — the fringe
    // band (dens - thresh <= ~0.24 at default threshold/edge) still
    // transmits ~81% red at absorb 3, but past absorb ~2.5 a core of dens
    // ~2 is already down to ~24% red survival (and near-zero green/blue),
    // so a higher ceiling would only push the fringe darker, not recover
    // any usable range in the core.
    setAbsorb(v) { uAbsorb.value = Math.max(0, Math.min(3, v)); },
    setSpec(v) { uSpec.value = Math.max(0, Math.min(4, v)); },
    // gloss FLOOR of 8, not 1: below ~8 the lobe is wider than the blob and
    // the whole surface reads as flat white, which looks like a broken pass.
    setGloss(v) { uGloss.value = Math.max(8, Math.min(400, v)); },
    setRim(v) { uRim.value = Math.max(0, Math.min(1, v)); },
    // CEILING RAISED 4 -> 8 (2026-08-31): the owner's chosen value landed
    // exactly ON the old ceiling, which is the signature of a clamp that is
    // silently capping intent rather than guarding a range. Same reason the
    // gloss ceiling went 220 -> 400. Both were guesses; neither was measured.
    // Ceiling 4, not 0.8: the old hard-coded 0.8 was a floor-to-ceiling range
    // of exactly one value, and the knob is only interesting BELOW it anyway.
    setStretch(v) { stretchMax = Math.max(0, Math.min(8, v)); },
    setShadowRed(v) { uShadowRed.value = Math.max(0, Math.min(0.6, v)); },
    setSurfaceNormals(on) { uNormalMode.value = on ? 1 : 0; },
    setMode(m: 'overlay' | 'depth') { mode = m; },
    get mode() { return mode; },
    get debugTargets() { return { density: target, blurred: blurB }; },
    get liveCount() { return liveCount; },
    get syncCalls() { return syncCalls; },
    setLegacyGamma(on) { uLegacy.value = on ? 1 : 0; },
    get threshold() { return uThresh.value; },
    get sizeScale() { return sizeScale; },
    get edge() { return uEdge.value; },
    get blurPx() { return uBlurPx.value; },
    get absorb() { return uAbsorb.value; },
    get spec() { return uSpec.value; },
    get gloss() { return uGloss.value; },
    get rim() { return uRim.value; },
    get stretch() { return stretchMax; },
    get shadowRed() { return uShadowRed.value; },
    get surfaceNormals() { return uNormalMode.value > 0.5; },
    get targetSize() { return { width: target.width, height: target.height }; },
    dispose() {
      target.dispose();
      blurA.dispose();
      blurB.dispose();
      quads.geometry.dispose();
      densMat.dispose();
      quad.geometry.dispose();
      for (const byMode of Object.values(surfMats)) {
        for (const m of Object.values(byMode)) m.dispose();
      }
      blurH.quad.geometry.dispose();
      blurV.quad.geometry.dispose();
      blurHMat.dispose();
      blurVMat.dispose();
    },
  };
}
