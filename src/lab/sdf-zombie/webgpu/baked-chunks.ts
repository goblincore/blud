// src/lab/sdf-zombie/webgpu/baked-chunks.ts
//
// The settled-chunk BAKE (close-up task 5): a chunk that has come to rest is
// extracted ONCE into a static triangle mesh and never marched again.
//
// WHY A MESH AND NOT THE HULL RENDERER. The parked hull renderer (2026-09-02)
// re-extracted EVERY frame and still had to band-walk the march in the
// fragment shader, so its ~3-4 ms extraction was a per-frame tax it never
// repaid. A settled chunk never re-extracts: the cost is paid once at the
// settle frame, and the mesh is then a plain rigid, static draw — a normal
// early-Z occluder in the MAIN scene instead of another frag_depth + discard
// proxy. The hull's per-frame objections do not shrink here; they are deleted.
//
// WHERE IT DRAWS. The main scene, default layer — NOT the SDF layer. The
// sdf-layer composite depth-tests the march's written depth against the main
// pass (sdf-layer.ts header), so a depth-writing mesh in the main scene both
// occludes marched bodies behind it and is correctly occluded by walls. This
// is the same layer contract the bone instancer ships under.
//
// LOOK PARITY. Albedo is BAKED per vertex (chunk-bake-field.ts mirrors the
// march's albedo chain: tissue ramp, wound mask, organ tint, mottle, gore
// mask); the WOUND MASK rides the albedo's alpha. Lighting stays LIVE —
// chunkShade below is boneShade's exact key + flashlight cone + wrapped
// diffuse + specular + fresnel (the march's own formula, per bone-tubes),
// with the wet terms boosted by the baked mask. The uniform set mirrors
// bone-instancer's and is refreshed per frame by the page from the same
// flashlight values — baked chunks track the flashlight like tubes do.
import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, texture, float, normalWorld, positionLocal, positionWorld, uniform, vec4, wgslFn,
  mrt, cameraProjectionMatrix, cameraViewMatrix,
} from 'three/tsl';
import { len } from '../vec';
import type { Vec3 } from '../types';
import { encodeSurfaceClass, SURFACE_CLASS_MESH, type SurfaceOutputOptions } from './deferred-surface';
// The march's OWN noise source strings, included verbatim as wgslFn
// dependencies rather than re-derived here. Parity is then structural: if the
// creature's micro-detail changes, a settled piece of it changes with it.
import type { MarchUniforms } from './zombie-gpu';
import { HASH13, NOISE3, FBM, TEXEL, FLICKER, FACE_LAYER_WGSL } from './march.wgsl';

/**
 * Live lighting for every baked chunk. Same uniform names and semantics as
 * the bone instancer's set (the page updates both from the same flashlight
 * block), minus woundTex: the wound proximity is baked per-vertex instead.
 * look = (keyFloor, wetTint, specGain, fresGain).
 *
 * `look.x` WAS "stain [unused, albedo carries it]" — a dead slot. It now carries
 * the DIFFUSE KEY FLOOR, which is the term that made settled gore impossible to
 * darken: the compose read `0.15 + 0.85 * ndl`, so a surface facing directly
 * away from the light still took 15% of it. The march has no such floor. At 0
 * this is plain `ndl` and a piece can actually be in shadow.
 */
const bakedChunkUniforms = () => ({
  deepColor: uniform(new THREE.Color(0.45, 0.06, 0.05)),
  ambient: uniform(new THREE.Color(0.06, 0.06, 0.06)),
  /** (keyFloor, wetTint, specGain, fresGain). The last two are DELIBERATELY
   *  below the live creature's: a gib is a small tumbling lump seen against a
   *  dark floor, and at the body's fresnel every one of them wears a bright rim
   *  — the owner's "edge glow around them". Grazing angles dominate a small
   *  convex piece, so the same number that reads as a wet sheen on a torso reads
   *  as an outline on a gib. */
  look: uniform(new THREE.Vector4(0.04, 0.5, 0.9, 0.18)),
  lightDir: uniform(new THREE.Vector3(0.3, 0.8, 0.5)),
  keyColor: uniform(new THREE.Color(1, 0.95, 0.9)),
  lightCfg: uniform(new THREE.Vector2(2.4, 0.06)),
  spotPos: uniform(new THREE.Vector3()),
  spotAxis: uniform(new THREE.Vector3(0, 0, -1)),
  spotCfg: uniform(new THREE.Vector4(0, 0.93, 0.80, 16)),
  spotCfg2: uniform(new THREE.Vector4(4, 0.35, 0, 0)),
  spotColor: uniform(new THREE.Color(0.94, 0.96, 1.0)),
  /** (detailAmp, bumpAmp, bloodAmp, noiseScale) for the PROCEDURAL DETAIL
   *  layer — zero by default, which is what keeps every existing user of this
   *  material bit-identical. See `CHUNK_GORE_WGSL`. */
  goreCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
  /** (burnAmp, wetGain, bloodDark, stainScale) — the STAIN half of the same
   *  layer, split into its own uniform because the owner's verdict on the first
   *  pass was that the blood was too pale and too dry to read as blood:
   *
   *    "its okay it still look like rocks - there no dark blood or burn stains.
   *     it would be nice if there was a contrast of sorts the blood is more
   *     specular and wet looking"
   *
   *  So the stains needed their own amplitude, their own DOMAIN (`stainScale`,
   *  deliberately much lower than `goreCfg.w` so a stain is a PATCH while the
   *  bump stays fine relief — one shared domain cannot be both), and their own
   *  controls: `bloodDark` pushes the blood colour toward near-black,
   *  `wetGain` drives how hard blood tightens the highlight, and `burnAmp`
   *  enables the charred field that did not exist before.
   *
   *  Zero by default for the same reason as `goreCfg`: every existing user of
   *  this material is bit-identical until it opts in. */
  goreCfg2: uniform(new THREE.Vector4(0, 0, 0, 0)),
  /** THE LIVE FLESH'S OWN MICRO-DETAIL, mirrored onto the settled piece:
   *  (amp, freq, albedoAmp, spare).
   *
   *  `freq` is NOT the march's 22. `fbm` is `noise3(p*4)*0.6 + noise3(p*9)*0.3`,
   *  so a domain scale of 22 puts its octaves at 1.1 cm and 5 mm features. The
   *  march samples those per PIXEL against a smooth analytic normal from the SDF
   *  gradient and they read as skin; a baked chunk is a 1 cm mesh with an
   *  interpolated vertex normal, so the 5 mm octave is sub-facet and aliases —
   *  the owner's read was "much finer like little dots ... looks kinda like
   *  glitter". Lower it until the finest octave is a couple of cells across.
   *
   *  `albedoAmp` exists because normal perturbation alone is LOW CONTRAST on a
   *  mesh ("the contrast on the detail is also very low compared to the skin of
   *  the actual character"). Most of the living skin's read is COLOUR — the
   *  march's mottle and gore mask — and a baked chunk carries those per-VERTEX
   *  only, which at 1 cm spacing is a broad blotch and not texture. This darkens
   *  and lightens the albedo per PIXEL off the same field, so the detail
   *  survives at the distance a normal perturbation washes out at.
   *
   *  A settled chunk stops being marched and becomes a static mesh, and the
   *  bake deliberately drops the march's per-PIXEL terms: chunk-bake-field.ts
   *  says "the baked surface is the clean field", and this shader's own header
   *  used to say "NO noise here ... the march's per-pixel fbm has no mesh-side
   *  equivalent and does not need one". It does need one. The owner's read of
   *  the result: the pieces "turn into this baked smooth albedo", against a
   *  living zombie that "is pink and has a noisy normal texture".
   *
   *  Zero by default, so every existing user of this material is unchanged
   *  until the page pushes the view's real value. */
  fleshDetail: uniform(new THREE.Vector4(0, 0, 0, 0)),
});
export type BakedChunkUniforms = ReturnType<typeof bakedChunkUniforms>;

/**
 * The march's own key-light + flashlight cone + wrapped diffuse + wet
 * specular/fresnel (boneShade verbatim minus the wound-texture exposure
 * loop), fed a BAKED albedo whose ALPHA is the wound mask. wm drives the
 * blood-slick terms: near a torn end the highlight tints toward deep blood
 * and the fresnel gains, exactly the "wet" read the march gives crater
 * rims. NO noise here — the mottle is baked into the albedo; the march's
 * per-pixel fbm has no mesh-side equivalent and does not need one.
 *
 * wgslFn hygiene (the three r185 traps, all pinned in memory/tests): one fn
 * per source string; NO parens or colons in the signature comment; no
 * reserved words ('ref' was the last one). A FOURTH, learned here: no BACKTICKS
 * anywhere in the source string — it is a template literal, so one ends it.
 * That is why every word of explanation below lives out here and the WGSL is
 * bare.
 *
 * TWO RULES TRANSCRIBED FROM THE MARCH (2026-09-11), because "the gibs do not
 * look like the zombie flesh" turned out to be two places where this shader is
 * the march's opposite rather than its mirror:
 *
 *   1. FRESNEL FADES OUT INSIDE A WOUND. This read look.w * (1.0 + wm * 1.5);
 *      it now reads look.w * (1.0 - wm), which is what march.wgsl.ts does
 *      (surfCfg.z * (1.0 - wmRim)) and why, in its own words: fresnel is
 *      environment rim light, and inside a cavity the environment IS the wound —
 *      "At full strength it maxes out on the grazing-heavy rim geometry, the
 *      1.6x wound wetness lands on top, and whole patches clip to white and
 *      sweep across the cavity as the camera moves" (X1.17). Survivable while wm
 *      was a small halo round a torn end on a settled chunk; a CARVED piece is a
 *      third cut face all at wm = 1, so it drove the exact term the march had
 *      already learned to kill to maximum over a third of the surface. The wet
 *      glisten a torn end SHOULD have is the tight specular, and that keeps its
 *      boost — gloss2 and wetTint are untouched.
 *
 *   2. A SOFT SHOULDER ON THE LIT RESULT. The march tone-maps flesh through
 *      SOFT_SHOULDER whenever the beam is on; this returned diffuse + specular
 *      RAW. Its specular is additive and never multiplied by albedo, so under
 *      the 4x beam any normal facing the lamp goes straight past 1.0. Measured:
 *      8-17% of carved-piece pixels blown to white against 0.0% on the marched
 *      body they are meant to match. The knee is the march's: below it the
 *      identity, above it [knee, inf) compressed into [knee, 1) monotonically,
 *      so two surfaces that differed in brightness still differ — which is what
 *      keeps a crater darker than the skin instead of "both clipping to white
 *      and the damage vanishing at exactly the range you aim from".
 *
 * SCOPE, stated honestly. Both are gated as the march gates them (spotCfg.x is
 * the beam, spotCfg2.y the shoulder amount), so a material whose beam is off
 * shades bit-for-bit as before. But the settled-chunk bake DOES track the
 * flashlight (that is what litChunkMaterials is for), so the shoulder now
 * applies to settled chunks too, not only to the carve. That is deliberate —
 * matching the marched body is the whole point and a settled chunk sits right
 * next to one — but it is a visible change beyond the path that motivated it,
 * and it has not been through an owner view-test.
 */
// The same face layer as the march, with mesh-local variable names. The
// source texture remains a texture: baking it into 1 cm vertex colours loses
// eyes/teeth. Settled heads have no melt animation.
const MESH_FACE_LAYER = FACE_LAYER_WGSL
  .replace(/\balbedo\b/g, 'faceAlbedo').replace(/\bn\b/g, 'nrm')
  .replaceAll('gInstHeadCentre', 'headCentre').replaceAll('gInstHeadQuat', 'headQuat')
  .replaceAll('gInstMelt.x', '0.0');
const FACE_ARGS = `faceTex: texture_2d<f32>, headCentre: vec3<f32>, headAxes: vec3<f32>, headQuat: vec4<f32>, faceCfg: vec4<f32>, faceCfg2: vec4<f32>, faceCfg3: vec4<f32>, faceProj: vec4<f32>, faceAtlas: vec4<f32>, faceGlowRedOnly: f32, faceGlowColor: vec3<f32>`;
function chunkShadeWgsl(face: boolean): string { return /* wgsl */ `fn chunkShade(p: vec3<f32>, n: vec3<f32>, camPos: vec3<f32>, albedo: vec4<f32>, ao: f32, deepColor: vec3<f32>, ambient: vec3<f32>, look: vec4<f32>, lightDir: vec3<f32>, keyColor: vec3<f32>, lightCfg: vec2<f32>, spotPos: vec3<f32>, spotAxis: vec3<f32>, spotCfg: vec4<f32>, spotCfg2: vec4<f32>, spotColor: vec3<f32>, gloss: f32, pl: vec3<f32>, kind: f32, goreCfg: vec4<f32>, goreCfg2: vec4<f32>, anchor: vec4<f32>, fleshDetail: vec4<f32>, response: vec4<f32>, fresnelGain: f32${face ? ', ' + FACE_ARGS : ''}) -> vec3<f32> {
  var a = albedo;
  var nrm = n;
  var gloss2 = select(gloss, response.z, response.x > 0.5);
  if (goreCfg.x > 0.0) {
    let lp = pl * max(goreCfg.w, 1.0);
    let w1 = vec3<f32>(6.0, 9.0, 11.0);
    let w2 = vec3<f32>(19.0, 23.0, 17.0);
    let w3 = vec3<f32>(37.0, 31.0, 43.0);
    let q1 = dot(lp, w1);
    let q2 = dot(lp, w2);
    let q3 = dot(lp, w3);
    let h = sin(q1) * 0.5 + sin(q2) * 0.32 + sin(q3) * 0.2;
    let g = cos(q1) * 0.5 * w1 + cos(q2) * 0.32 * w2 + cos(q3) * 0.2 * w3;
    let surf = g - n * dot(g, n);
    nrm = normalize(n - surf * goreCfg.y * 0.02);
    let s1 = sin(dot(lp, vec3<f32>(9.0, 4.0, 7.0)) + 1.7) * 0.5 + 0.5;
    let s2 = sin(dot(pl, vec3<f32>(3.0, 60.0, 5.0))) * 0.5 + 0.5;
    let s3 = sin(dot(lp, vec3<f32>(41.0, 6.0, 37.0)) + 4.1) * 0.5 + 0.5;
    let splat = smoothstep(0.54, 0.92, s1 * 0.62 + s2 * 0.24 + s3 * 0.14);
    let blood = splat * goreCfg.z;
    let bloodCol = mix(deepColor * 0.5 + vec3<f32>(0.17, 0.11, 0.11),
                       vec3<f32>(0.055, 0.012, 0.010), clamp(goreCfg2.z, 0.0, 1.0));
    a = vec4<f32>(mix(a.rgb, bloodCol, blood * 0.92), clamp(a.a + blood * 0.9 * (0.4 + goreCfg2.y), 0.0, 1.0));
    gloss2 = mix(gloss2, 260.0, blood * clamp(goreCfg2.y, 0.0, 1.0));
    let bp = pl * max(goreCfg2.w, 0.25);
    let b1 = sin(dot(bp, vec3<f32>(2.3, 1.7, 2.9)) + 0.6) * 0.5 + 0.5;
    let b2 = sin(dot(bp, vec3<f32>(5.1, 7.3, 4.4)) + 2.2) * 0.5 + 0.5;
    let b3 = sin(dot(bp, vec3<f32>(11.0, 3.0, 13.0))) * 0.5 + 0.5;
    let burn = smoothstep(0.58, 0.95, b1 * 0.66 + b2 * 0.22 + b3 * 0.12) * clamp(goreCfg2.x, 0.0, 1.0);
    let charCol = vec3<f32>(0.030, 0.024, 0.022);
    a = vec4<f32>(mix(a.rgb, charCol, burn * 0.9), a.a * (1.0 - burn * 0.85));
    gloss2 = mix(gloss2, 9.0, burn);

    if (kind > 1.5) {
      let org = vec3<f32>(min(a.r * 1.12 + 0.07, 1.0), a.g * 0.62, a.b * 0.66);
      a = vec4<f32>(mix(a.rgb, org, 0.62), max(a.a, 0.86));
      gloss2 = 220.0;
    } else {
      if (kind > 0.5) {
        a = vec4<f32>(a.rgb * (0.9 + 0.2 * h), a.a * 0.55);
        gloss2 = 90.0;
      }
    }
  }
  // mapBody displaces the surface by fbm(restPoint * 3) * marchCfg.z.
  // Its DERIVATIVE supplies the visible skin relief. Adding the tiny fine
  // normal noise alone (surfCfg2.y) cannot reproduce that texture.
  if (anchor.w > 0.0) {
    let e = 0.0015;
    let k1 = vec3<f32>(1.0, -1.0, -1.0);
    let k2 = vec3<f32>(-1.0, -1.0, 1.0);
    let k3 = vec3<f32>(-1.0, 1.0, -1.0);
    let k4 = vec3<f32>(1.0, 1.0, 1.0);
    let grad = (k1 * fbm((anchor.xyz + k1 * e) * 3.0)
              + k2 * fbm((anchor.xyz + k2 * e) * 3.0)
              + k3 * fbm((anchor.xyz + k3 * e) * 3.0)
              + k4 * fbm((anchor.xyz + k4 * e) * 3.0)) * (anchor.w / (4.0 * e));
    let px = dpdx(p); let py = dpdy(p);
    let r1 = cross(py, nrm); let r2 = cross(nrm, px);
    let det = dot(px, r1);
    let surfaceGrad = (dot(grad, dpdx(anchor.xyz)) * r1 + dot(grad, dpdy(anchor.xyz)) * r2)
                    * (sign(det) / max(abs(det), 1e-10));
    nrm = normalize(nrm + surfaceGrad);
  }
  if (fleshDetail.x > 0.0) {
    let df = max(fleshDetail.y, 0.5);
    let dp = anchor.xyz * df;
    let detailNoise = vec3<f32>(fbm(dp), fbm(dp + 5.0), fbm(dp + 11.0));
    nrm = normalize(nrm + detailNoise * fleshDetail.x);
    if (fleshDetail.z > 0.0) {
      let shade = (detailNoise.x + detailNoise.y + detailNoise.z) * 0.3333;
      a = vec4<f32>(a.rgb * clamp(1.0 + shade * fleshDetail.z, 0.35, 1.65), a.a);
    }
  }
  var L = normalize(lightDir);
  var keyC = keyColor;
  var keyI = lightCfg.x;
  if (spotCfg.x > 0.0) {
    let toLamp = spotPos - p;
    let dist = length(toLamp);
    let Ls = toLamp / max(dist, 1e-4);
    let cone = dot(-Ls, normalize(spotAxis));
    let coneFall = clamp((cone - spotCfg.z) / max(spotCfg.y - spotCfg.z, 1e-4), 0.0, 1.0);
    let distFall = clamp(1.0 - dist / max(spotCfg.w, 1e-4), 0.0, 1.0);
    let beam = coneFall * coneFall * distFall * distFall * spotCfg.x;
    L = normalize(mix(L, Ls, clamp(beam, 0.0, 1.0)));
    keyC = mix(keyColor, spotColor, clamp(beam, 0.0, 1.0));
    keyI = lightCfg.x * spotCfg2.z + beam * spotCfg2.x;
  }
  ${face ? `let wm = clamp(a.a, 0.0, 1.0);
  var faceAlbedo = a.rgb;
  ${MESH_FACE_LAYER}
  a = vec4<f32>(faceAlbedo, a.a);` : ''}
  let V = normalize(camPos - p);
  let ndl = max(dot(nrm, L), 0.0);
  let H = normalize(L + V);
  ${face ? '' : 'let wm = clamp(a.a, 0.0, 1.0);'}
  let shine = pow(max(dot(nrm, H), 0.0), max(gloss2, 2.0));
  let fres = pow(1.0 - max(dot(nrm, V), 0.0), 4.0) * select(look.w, fresnelGain, response.x > 0.5) * (1.0 - wm);
  let wetTint = mix(vec3<f32>(1.0), deepColor, look.y * wm);
  let floorK = select(clamp(look.x, 0.0, 1.0), 0.0, response.x > 0.5);
  let diffuse = a.rgb * (ambient + keyI * keyC * (floorK + (1.0 - floorK) * ndl)) * ao;
  // The SDF's highlight is weighted by wetness, NOT the diffuse key gain.
  // Multiplying it by the flashlight gain turns a broad highlight white.
  let meshSpec = keyC * wetTint * (shine * look.z * keyI + fres * (0.5 + 0.5 * keyI));
  let fleshSpec = keyC * (shine * response.w + fres) * response.y;
  let specular = select(meshSpec, fleshSpec, response.x > 0.5);
  var out = diffuse + specular;
  ${face ? 'out = mix(out, a.rgb * (ambient + 0.30 * lightCfg.x * keyColor), faceFlat * 0.85);' : ''}
  if (spotCfg.x > 0.0 && spotCfg2.y > 0.0) {
    let knee = clamp(1.0 - spotCfg2.y, 0.05, 0.99);
    let head = max(1.0 - knee, 1e-4);
    let over = max(out - vec3<f32>(knee), vec3<f32>(0.0));
    let rolled = vec3<f32>(knee) + head * (vec3<f32>(1.0) - exp(-over / head));
    out = select(rolled, out, out <= vec3<f32>(knee));
  }
  ${face ? 'out = out * (1.0 - faceGlow) + faceGlowColor * faceGlow * faceCfg2.w * flicker(faceCfg3.y, faceCfg3.x);' : ''}
  // Same legacy display transform as MARCH_BODY: presets were authored
  // against raw linear display. Omitting this lifts the low colour channels
  // when Three encodes to sRGB, washing pink flesh into pale cream.
  if (response.x > 1.5) {
    let c = max(out, vec3<f32>(0.0));
    out = select(pow((c + 0.055) / 1.055, vec3<f32>(2.4)), c / 12.92,
                 c <= vec3<f32>(0.04045));
  }
  return out;
}`; }
export const CHUNK_SHADE_WGSL = chunkShadeWgsl(false);
export const CHUNK_FACE_SHADE_WGSL = chunkShadeWgsl(true);

const CHUNK_FACE_SURFACE_WGSL = /* wgsl */ `fn chunkFaceSurface(p: vec3<f32>, n: vec3<f32>, albedo: vec4<f32>, ${FACE_ARGS}) -> mat4x4<f32> {
  var nrm = n;
  var faceAlbedo = albedo.rgb;
  let wm = clamp(albedo.a, 0.0, 1.0);
  ${MESH_FACE_LAYER}
  return mat4x4<f32>(vec4<f32>(faceAlbedo, mix(0.82, 0.34, wm)), vec4<f32>(nrm, 0.0),
    vec4<f32>(faceGlowColor * faceGlow * faceCfg2.w * flicker(faceCfg3.y, faceCfg3.x), 0.0), vec4<f32>(0.0));
}`;

/**
 * THE PROCEDURAL DETAIL LAYER — per-pixel noise on mesh gore, which this file
 * previously and deliberately did not have.
 *
 * The old note read "NO noise here — the mottle is baked into the albedo; the
 * march's per-pixel fbm has no mesh-side equivalent and does not need one". On a
 * SURFACE-NETTED chunk with thousands of vertices that holds. On a procedural
 * gore part with ~42 it does not: a per-vertex mottle across 42 vertices IS flat
 * colour per facet, and the owner's verdict on exactly that was "the material
 * for the gibs atm are like really boring like rather flat no bumps or normal
 * maps no stains no blood decals they look like random pale shapes".
 *
 * So: a value-noise fbm over the part's LOCAL position (local, not world — a
 * world-space field would swim across a tumbling piece), used for three things,
 * all of them per-pixel:
 *
 *   1. BUMP. The surface gradient of the noise field (Mikkelsen): the gradient's
 *      component along the normal is removed and the rest is subtracted from the
 *      normal. No tangents and no UVs are needed, which is the whole reason this
 *      works on generated geometry that has neither.
 *   2. BLOOD DECALS. Two noise fields — a broad splatter and a vertically
 *      STRETCHED one, so it reads as drips — thresholded and mixed toward a dark
 *      blood colour, raising the wetness mask the lighting already turns into
 *      gloss.
 *   3. ORGAN GLOSS. Kind 2 is pushed toward red/pink and given a much tighter
 *      highlight (gloss 48 -> 220), because the owner's note was that the
 *      organ-ish parts are the ones that work but "need to be like specular and
 *      red/pink like organs".
 *
 * `goreCfg.x == 0` skips all of it, which is what every other user of this
 * material gets: the layer is opt-in per material instance, so no accepted
 * behaviour moved.
 */
/**
 * MATERIAL TERMS of the baked chunk (M2 task 2): the baked vertex albedo
 * with its wound-mask wetness, mapped to G-buffer form — rgb albedo,
 * roughness from the mask. Dry torn meat is matte; the wet (blood-slick)
 * mask tightens to the lit model's fixed 48-exponent gloss through the
 * shared light pass's shin = exp2((1-rough)*8) + 2 (48 -> 0.31, the same
 * inversion deferred-sdf.ts documents). NO light input — light-invariance
 * is structural, and the lit albedo color is never encoded (the albedo IS
 * the baked attribute the shade composes from).
 */
export const CHUNK_SURFACE_WGSL = /* wgsl */ `fn chunkSurface(albedo: vec4<f32>) -> vec4<f32> {
  let wm = clamp(albedo.a, 0.0, 1.0);
  let rough = clamp(mix(0.9, 0.31, wm), 0.04, 1.0);
  return vec4<f32>(albedo.rgb, rough);
}`;

export interface BakedChunkMaterial {
  material: THREE.Material;
  uniforms: BakedChunkUniforms;
  /** Packed emissionClass value when built with output:'surface' (M2 task
   *  2); undefined in the default lit mode. */
  readonly surfaceKind: number | undefined;
  dispose(): void;
}

/** ONE material for every baked chunk (the shared-chunk-material rule: one
 *  pipeline, N meshes). Lighting uniforms are LIVE and shared; albedo is
 *  per-vertex so sharing costs nothing.
 *
 *  M2 task 2: trailing `options` selects the output mode. Surface mode
 *  builds the five named G-buffer attachments from the baked vertex terms
 *  (albedo/roughness via chunkSurface, world normal, mesh class + shadow
 *  receiver, projected clip depth) and never touches the light compose —
 *  the SAME material split as the bone instancer, and the lit path below
 *  is untouched. */
export interface GoreMaterialOptions extends SurfaceOutputOptions {
  /** Add the procedural per-pixel detail layer (bump, blood decals, organ
   *  gloss) — see CHUNK_GORE_WGSL. Opt-in, and it needs a `goreKind` vertex
   *  attribute (0 meat, 1 bone, 2 organ); geometry without it must NOT use this
   *  mode. */
  goreDetail?: boolean;
  /** Multiply the lit term by a baked per-vertex AO (`bakeAo` attribute). Opt-in
   *  for the same reason `goreDetail` is: a material that reads an attribute the
   *  geometry does not carry is a BIND ERROR, not a zero — that is exactly the
   *  bug `goreKind` shipped with. Geometry without `bakeAo` must NOT set this. */
  bakedAo?: boolean;
  /** Source flesh response carried through the worker in bakeResponse. */
  fleshResponse?: boolean;
  /** Snapshot these uniforms at the swap; borrowed atlas remains owned by the actor. */
  face?: Pick<MarchUniforms, 'faceTex' | 'headCentre' | 'headAxes' | 'headQuat' | 'faceCfg' | 'faceCfg2' | 'faceCfg3' | 'faceProj' | 'faceAtlas' | 'faceGlowRedOnly' | 'faceGlowColor'>;
}

export function createBakedChunkMaterial(options?: GoreMaterialOptions): BakedChunkMaterial {
  const u = bakedChunkUniforms();
  const material = new THREE.MeshBasicNodeMaterial();
  // Own immutable projection uniforms: the retained view can be recycled.
  const face = options?.face;
  const faceBindings = face ? {
    faceTex: texture(face.faceTex.value),
    headCentre: uniform(face.headCentre.value.clone()), headAxes: uniform(face.headAxes.value.clone()),
    headQuat: uniform(face.headQuat.value.clone()), faceCfg: uniform(face.faceCfg.value.clone()),
    faceCfg2: uniform(face.faceCfg2.value.clone()), faceCfg3: uniform(face.faceCfg3.value.clone()), faceProj: uniform(face.faceProj.value.clone()),
    faceAtlas: uniform(face.faceAtlas.value.clone()), faceGlowRedOnly: uniform(face.faceGlowRedOnly.value),
    faceGlowColor: uniform(face.faceGlowColor.value.clone()),
  } : {};
  let surfaceKind: number | undefined;
  if (options?.output === 'surface') {
    const surf = wgslFn(CHUNK_SURFACE_WGSL)({
      albedo: attribute('bakeColor', 'vec4'),
    }) as unknown as { xyz: unknown; w: unknown };
    const faceSurface = face ? wgslFn(CHUNK_FACE_SURFACE_WGSL, [wgslFn(TEXEL), wgslFn(FLICKER)] as never)({
      p: positionWorld, n: normalWorld, albedo: attribute('bakeColor', 'vec4'), ...faceBindings,
    } as never) as unknown as { element(i: number): ReturnType<typeof vec4> } : null;
    const kind = encodeSurfaceClass(SURFACE_CLASS_MESH, options.shadowReceiver ?? 'full');
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionWorld, 1.0));
    material.mrtNode = mrt({
      albedoRoughness: faceSurface ? faceSurface.element(0) : vec4(surf.xyz as never, surf.w as never),
      normalMetalness: faceSurface ? faceSurface.element(1) : vec4(normalWorld, float(0)),
      emissionClass: faceSurface ? vec4(faceSurface.element(2).xyz, float(kind)) : vec4(float(0), float(0), float(0), float(kind)),
      surfaceDepth: vec4(clip.z.div(clip.w) as never, float(0), float(0), float(1)),
      // Mesh response has no authored flesh parameters; still write every MRT lane.
      surfaceParams: vec4(float(0), float(0), float(0), float(1)),
    }) as never;
    material.blending = THREE.NoBlending; // MRT producer — the M1 mesh rule
    // Route-diagnostic marker ON THE MATERIAL — see the same stamp in
    // bone-instancer.ts: the task-3 router reads material.surfaceKind, and
    // without it a surface-mode baked chunk is unsupported/hidden (task-5
    // boot check, 2026-09-07).
    (material as unknown as { surfaceKind: number }).surfaceKind = kind;
    surfaceKind = kind;
  } else {
    // Dependency-ordered includes, the repo's reduce idiom (bone-instancer.ts,
    // zombie-gpu.ts buildMarchFn): hash13 -> noise3 -> fbm -> chunkShade, as
    // WGSL requires a callee to be declared before its caller. These are the
    // MARCH'S OWN source strings, so a settled piece samples the identical
    // field the living body does — the previous attempt at this passed TSL
    // noise NODES as wgslFn arguments and measurably delivered nothing.
    const [, , , , , shade] = [HASH13, NOISE3, FBM, TEXEL, FLICKER, face ? CHUNK_FACE_SHADE_WGSL : CHUNK_SHADE_WGSL]
      .reduce<ReturnType<typeof wgslFn>[]>(
        (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
      );
    // ONE shader, two call sites. With `goreDetail` the procedural layer runs
    // from `goreCfg` and the part's own `goreKind`; without it `goreCfg.x` is 0
    // (its uniform default) so the layer is skipped and a baked chunk shades
    // exactly as it did before this existed. `goreKind` is a CONSTANT here
    // rather than an attribute, because baked-chunk geometry does not carry one
    // and an attribute that is not there is not 0 — it is a bind error.
    material.colorNode = vec4(shade({
      ...faceBindings,
      p: positionWorld, n: normalWorld, camPos: cameraPosition,
      albedo: attribute('bakeColor', 'vec4'),
      ao: options?.bakedAo ? attribute('bakeAo', 'float') : float(1.0),
      deepColor: u.deepColor, ambient: u.ambient, look: u.look,
      lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
      spotPos: u.spotPos, spotAxis: u.spotAxis, spotCfg: u.spotCfg,
      spotCfg2: u.spotCfg2, spotColor: u.spotColor,
      gloss: float(48.0),
      pl: options?.goreDetail ? positionLocal : positionWorld,
      kind: options?.goreDetail ? attribute('goreKind', 'float') : float(0.0),
      goreCfg: u.goreCfg,
      goreCfg2: u.goreCfg2,
      // ALWAYS the piece-local point, whatever `pl` is: the micro-detail has to
      // ride the piece through its tumble. Sampled in world space it would swim
      // across the surface as the chunk spins, which is the same reason the
      // march anchors its own detail in the body's rest frame.
      anchor: options?.fleshResponse ? attribute('bakeAnchor', 'vec4') : vec4(positionLocal, 0),
      fleshDetail: u.fleshDetail,
      response: options?.fleshResponse ? attribute('bakeResponse', 'vec4') : vec4(0),
      fresnelGain: options?.fleshResponse ? attribute('bakeFresnel', 'float') : u.look.w,
    }) as never, float(1.0));
  }
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  return {
    material,
    uniforms: u,
    get surfaceKind() { return surfaceKind; },
    dispose() { material.dispose(); },
  };
}

// Preserve the existing CPU diagnostic API; live gameplay uses the worker.
export { bakeChunkGeometry, BAKE_CELL } from './chunk-bake-geometry';
export type { ChunkBakeData, BakedChunkResult } from './chunk-bake-geometry';

/** Distance from a point to the chunk bake's bounding sphere surface
 *  (negative inside) — the projectile test's reject/accept primitive. */
export function sphereSign(p: Vec3, centre: Vec3, radius: number): number {
  return len([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]) - radius;
}
