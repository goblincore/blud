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
  attribute, cameraPosition, float, normalWorld, positionLocal, positionWorld, uniform, vec4, wgslFn,
  mrt, cameraProjectionMatrix, cameraViewMatrix,
} from 'three/tsl';
import { len } from '../vec';
import type { Vec3 } from '../types';
import { encodeSurfaceClass, SURFACE_CLASS_MESH, type SurfaceOutputOptions } from './deferred-surface';

/**
 * Live lighting for every baked chunk. Same uniform names and semantics as
 * the bone instancer's set (the page updates both from the same flashlight
 * block), minus woundTex: the wound proximity is baked per-vertex instead.
 * look = (stain [unused, albedo carries it], wetTint, specGain, fresGain).
 */
const bakedChunkUniforms = () => ({
  deepColor: uniform(new THREE.Color(0.45, 0.06, 0.05)),
  ambient: uniform(new THREE.Color(0.06, 0.06, 0.06)),
  look: uniform(new THREE.Vector4(0.65, 0.5, 1.2, 0.6)),
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
export const CHUNK_SHADE_WGSL = /* wgsl */ `fn chunkShade(p: vec3<f32>, n: vec3<f32>, camPos: vec3<f32>, albedo: vec4<f32>, ao: f32, deepColor: vec3<f32>, ambient: vec3<f32>, look: vec4<f32>, lightDir: vec3<f32>, keyColor: vec3<f32>, lightCfg: vec2<f32>, spotPos: vec3<f32>, spotAxis: vec3<f32>, spotCfg: vec4<f32>, spotCfg2: vec4<f32>, spotColor: vec3<f32>, gloss: f32, pl: vec3<f32>, kind: f32, goreCfg: vec4<f32>, goreCfg2: vec4<f32>) -> vec3<f32> {
  var a = albedo;
  var nrm = n;
  var gloss2 = gloss;
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
  let V = normalize(camPos - p);
  let ndl = max(dot(nrm, L), 0.0);
  let H = normalize(L + V);
  let wm = clamp(a.a, 0.0, 1.0);
  let shine = pow(max(dot(nrm, H), 0.0), max(gloss2, 2.0));
  let fres = pow(1.0 - max(dot(nrm, V), 0.0), 4.0) * look.w * (1.0 - wm);
  let wetTint = mix(vec3<f32>(1.0), deepColor, look.y * wm);
  let diffuse = a.rgb * (ambient + keyI * keyC * (0.15 + 0.85 * ndl)) * ao;
  let specular = keyC * wetTint * (shine * look.z * keyI + fres * (0.5 + 0.5 * keyI));
  var out = diffuse + specular;
  if (spotCfg.x > 0.0 && spotCfg2.y > 0.0) {
    let knee = clamp(1.0 - spotCfg2.y, 0.05, 0.99);
    let head = max(1.0 - knee, 1e-4);
    let over = max(out - vec3<f32>(knee), vec3<f32>(0.0));
    let rolled = vec3<f32>(knee) + head * (vec3<f32>(1.0) - exp(-over / head));
    out = select(rolled, out, out <= vec3<f32>(knee));
  }
  return out;
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
}

export function createBakedChunkMaterial(options?: GoreMaterialOptions): BakedChunkMaterial {
  const u = bakedChunkUniforms();
  const material = new THREE.MeshBasicNodeMaterial();
  let surfaceKind: number | undefined;
  if (options?.output === 'surface') {
    const surf = wgslFn(CHUNK_SURFACE_WGSL)({
      albedo: attribute('bakeColor', 'vec4'),
    }) as unknown as { xyz: unknown; w: unknown };
    const kind = encodeSurfaceClass(SURFACE_CLASS_MESH, options.shadowReceiver ?? 'full');
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionWorld, 1.0));
    material.mrtNode = mrt({
      albedoRoughness: vec4(surf.xyz as never, surf.w as never),
      normalMetalness: vec4(normalWorld, float(0)),
      emissionClass: vec4(float(0), float(0), float(0), float(kind)),
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
    const shade = wgslFn(CHUNK_SHADE_WGSL);
    // ONE shader, two call sites. With `goreDetail` the procedural layer runs
    // from `goreCfg` and the part's own `goreKind`; without it `goreCfg.x` is 0
    // (its uniform default) so the layer is skipped and a baked chunk shades
    // exactly as it did before this existed. `goreKind` is a CONSTANT here
    // rather than an attribute, because baked-chunk geometry does not carry one
    // and an attribute that is not there is not 0 — it is a bind error.
    material.colorNode = vec4(shade({
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
