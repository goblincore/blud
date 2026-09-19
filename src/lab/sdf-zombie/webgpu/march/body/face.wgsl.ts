// src/lab/sdf-zombie/webgpu/march/body/face.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): face-sheet layer.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { FACE_MELT_FADE_LO, FACE_MELT_SAG, FACE_MELT_STRETCH, HEAD_EXTERIOR_GORE_KEEP } from '../melt';

/** Shared projection/colour/relief layer for live flesh and settled head meshes. */
export const FACE_LAYER_WGSL = /* wgsl */ `  // Emissive mask from the face sheet; added into the lit colour further down.
  var faceGlow = 0.0;
  // Decal coverage at this pixel (facing * alpha, decal mode only): drives
  // the FLAT-LIGHTING blend at fleshLit. A painted PSX face is authored
  // pre-lit; shading it again buries the nose and lips under the fringe
  // shadow and the jaw's diffuse falloff.
  var faceFlat = 0.0;
  // Face coverage REGARDLESS of mode (facing * alpha). The torn-meat gore pass
  // runs after this layer and attenuates by (1 - faceCover), so a detached
  // head keeps its authored face instead of being mottled into a meat blob —
  // the torn treatment belongs on the cut and the rest of the piece, not over
  // the exterior skin (2026-09-16 playtest follow-ups task 2).
  var faceCover = 0.0;

  // Face texture, before wounds and char so damage still paints over it.
  if (faceCfg.x > 0.5) {
    let forward = faceCfg.z;
    // Head-space position, normalised PER AXIS by the skull's own semi-axes —
    // re-uploaded every frame from the posed primitives, so the projection
    // rides the head as it jiggles without a full rest-space transform. One
    // scalar radius put whichever axis was largest exactly on the head-mask
    // cutoff, and raising headDepth then erased the entire face.
    // Un-rotate into the head's REST frame before projecting (motion-polish):
    // the rigid head pass rotates the skull masses, and a projection that
    // stays axis-aligned paints the face onto whichever side happens to face
    // front — nose mass out the ear, eyes off the brow. Rotation by the
    // CONJUGATE of the head quaternion (v' = v + 2*cross(-q.xyz, cross(-q.xyz, v) + q.w*v)).
    let hql = -gInstHeadQuat.xyz;
    let hpv = p - gInstHeadCentre;
    let hrot = hpv + 2.0 * cross(hql, cross(hql, hpv) + gInstHeadQuat.w * hpv);
    let hs = hrot / max(headAxes, vec3<f32>(1e-4, 1e-4, 1e-4));
    var raw = vec2<f32>(hs.x * forward, hs.y);
    if (faceCfg2.x > 0.5) {
      let dir = normalize(hs);
      // Longitude measured from the front, latitude from the equator. Both
      // normalised to -1..1 so faceProj means the same thing in either mode.
      // NOTE atan2 — GLSL's two-argument atan() renames on this path.
      raw = vec2<f32>(
        atan2(dir.x * forward, dir.z * forward) / 3.14159265,
        asin(clamp(dir.y, -1.0, 1.0)) / 1.57079633);
    }
    let uv0 = raw * faceProj.xy + faceProj.zw;
    // Melt drips the face off the skull (task 8): sag drags features DOWN
    // (see the FACE_MELT_SAG comment at the constants for why positive is
    // down), the stretch elongates them as they go. The offset alone would
    // slide a rigid face downward like a sticker.
    let meltSag = gInstMelt.x;
    var uv = uv0;
    uv.y = uv0.y + meltSag * ${FACE_MELT_SAG} - (uv0.y - faceProj.w) * meltSag * ${FACE_MELT_STRETCH};
    // Fade by how squarely this surface faces the front, so the projection does
    // not smear a second face down the sides and back of the skull. A planar
    // projection derives uv from x/y alone, so as the surface turns away it
    // repeats the same uv column and STREAKS; fading out well before edge-on
    // hides that.
    // The facing axis is the head's rotated forward, not world +z.
    // The lower bound widens toward FACE_MELT_FADE_LO as the melt flattens
    // the head: a squashed skull's surface turns away from the forward axis
    // far sooner than a round one's, and the un-widened cutoff faded the
    // face out before it had finished dripping.
    let hfw = vec3<f32>(0.0, 0.0, forward);
    let hfr = hfw + 2.0 * cross(gInstHeadQuat.xyz, cross(gInstHeadQuat.xyz, hfw) + gInstHeadQuat.w * hfw);
    var facing = smoothstep(mix(0.28, ${FACE_MELT_FADE_LO}, gInstMelt.x), 0.66, dot(n, hfr));
    // Confine it to the HEAD. Generous, because the surface now sits at
    // |hs| ~= 1 everywhere and the jaw hangs past that: this is only a backstop
    // against wrapping onto the neck.
    // A DECAL (faceCfg.x == 2) gets half again the reach: hs is normalised by
    // the FATTEST head prim, which on a character with hair is the crown
    // shell, centred well above the face -- the schoolgirl's mouth sat at
    // |hs| 1.55 and faded out at every projection setting. The decal's own
    // alpha and the facing fade bound it instead.
    // FACE MODE, faceCfg.x: 1 = sheet (MULTIPLY the rgb), 2 = decal (REPLACE
    // the albedo), 3 = LUMA multiply. Mode 3 exists because multiplying two
    // COLOURED values compounds their hue -- a skin-toned bake times skin-toned
    // flesh reads more saturated than either, which the owner spotted as the
    // face looking "more saturated from the surrounding skin". Using the
    // decal's LUMINANCE as a scalar modulates brightness and leaves hue alone.
    // Modes 1 and 2 are untouched and bit-identical.
    let decal = select(0.0, 1.0, abs(faceCfg.x - 2.0) < 0.5);
    let lumaOnly = abs(faceCfg.x - 3.0) < 0.5;
    let reach = 1.0 + 0.5 * decal;
    // HEAD-REGION MASK, independent of which way the surface faces: ~1 anywhere
    // on the head's own extent, 0 down the neck. The gore pass uses it so a
    // detached head keeps its OWN SKIN all around (the torn treatment belongs
    // on the neck cut, not over the exterior), not merely the frontal face.
    let faceRegion = 1.0 - smoothstep(1.30 * reach, 1.70 * reach, length(hs));
    facing = facing * faceRegion;
    // Full protection on the frontal face; the rest of the head keeps only the
    // HEAD_EXTERIOR_GORE_KEEP fraction of the piece's gore.
    faceCover = clamp(facing + faceRegion * ${HEAD_EXTERIOR_GORE_KEEP}, 0.0, 1.0);
    if (facing > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      let base = uv * faceAtlas.xy + faceAtlas.zw;
      // Not linearised, deliberately: the sheet is sRGB-encoded and so are the
      // hand-tuned flesh colours it blends against, which were authored to
      // compensate for the missing output encode. Revisit both together at the
      // preset retune, not before.
      let tex = texel(faceTex, base);
      faceFlat = facing * tex.a * decal;
      // Refine the region-level protection with the sheet's own alpha where it
      // is actually sampled (a decal's transparent background must not shield
      // the gore). A sheet with no alpha channel reads 1 and is unchanged.
      faceCover = faceCover * tex.a;
      let W = vec3<f32>(0.2126, 0.7152, 0.0722);
      // DECAL mode (faceCfg.x == 2): the sheet is a colour image baked off a
      // reference mesh and pasted on as albedo where its alpha is set, the way
      // a PSX face was painted onto a head. No luma glow -- a photo is bright in
      // many places that are not eyes -- and no relief, because its luminance
      // edges (hairline, lips) are colour changes, not height.
      faceGlow = smoothstep(faceCfg2.z, 1.0, dot(tex.rgb, W)) * facing * tex.a * (1.0 - decal);
      // Opt-in painted red eyes: brightness alone would select skin/teeth.
      // Red dominance rejects those, and the brightness gate rejects dark
      // reddish hair/mouth pixels. This mask works with Replace albedo too.
      if (faceGlowRedOnly > 0.5) {
        let redDominance = (tex.r - max(tex.g, tex.b)) / max(tex.r, 0.001);
        let redMask = smoothstep(min(faceCfg2.z, 0.999), 1.0, redDominance)
                    * smoothstep(0.35, 0.70, tex.r);
        faceGlow = redMask * facing * tex.a * clamp(faceCfg.y, 0.0, 1.0)
                 * clamp(faceCfg2.w, 0.0, 1.0);
      }

      // Otherwise a MULTIPLIER, not a replacement: the generated sheet carries
      // baked lighting, so pasting it in as albedo and lighting it again
      // double-shades. Dividing by its measured mean keeps the pattern and
      // throws away level.
      // Luma mode divides by the same mean, so an average texel still
      // multiplies by ~1 and the level is unchanged -- only the hue shift goes.
      let detailSrc = select(tex.rgb, vec3<f32>(dot(tex.rgb, W)), lumaOnly);
      let detail = detailSrc / max(faceCfg2.y, 1e-3);
      // Skip the multiply where it glows: an eye is not tinted flesh, and the
      // emissive term below supplies its colour outright.
      // Soldier uses the otherwise unique red-only face flag. Its Replace
      // decal must yield to the wound mask or it paints pale forehead pixels
      // back over the tissue ramp after the crater was shaded.
      let woundDecalFade = 1.0 - faceGlowRedOnly * smoothstep(0.02, 0.25, wm);
      albedo = mix(albedo, mix(albedo * detail, tex.rgb, decal),
                   facing * tex.a * faceCfg.y * (1.0 - faceGlow) * woundDecalFade);
      // Keep only the decal's dark facial structure over damaged Soldier
      // tissue. This restores sockets/nose/mouth contrast without pasting its
      // intact skin colour back onto the red wound.
      let damagedFace = faceGlowRedOnly * smoothstep(0.02, 0.62, wm) * facing * tex.a;
      let faceShadow = clamp(1.0 - dot(tex.rgb, W) / max(faceCfg2.y, 1e-3), 0.0, 1.0);
      albedo = albedo * (1.0 - faceShadow * damagedFace * 0.78);

      // Relief. Central differences on luminance give the height gradient; the
      // projection is planar along z, so its tangent basis is just x and y and
      // the bump drops straight into world space with no TBN to build.
      if (faceCfg.w > 0.0 && decal < 0.5) {
        let e = faceAtlas.xy * 0.012;
        let hL = dot(texel(faceTex, base - vec2<f32>(e.x, 0.0)).rgb, W);
        let hR = dot(texel(faceTex, base + vec2<f32>(e.x, 0.0)).rgb, W);
        let hD = dot(texel(faceTex, base - vec2<f32>(0.0, e.y)).rgb, W);
        let hU = dot(texel(faceTex, base + vec2<f32>(0.0, e.y)).rgb, W);
        // Negated: the gradient points UPHILL, and a normal tilts away from
        // rising ground. Without this the sockets would bulge instead of sink.
        let bumpL = vec3<f32>(-(hR - hL) * forward, -(hU - hD), 0.0);
        // The bump lives in the PROJECTION frame (the un-rotated head/hand
        // space the uv was derived in) — rotate it by headQuat into world,
        // the same rotation hfr gets above. Identity for an unrotated head;
        // load-bearing for the hands view, whose frame is a large rotation
        // (Opus hands round 3 — grooves shaded from a skewed direction).
        let bump = bumpL
          + 2.0 * cross(gInstHeadQuat.xyz, cross(gInstHeadQuat.xyz, bumpL) + gInstHeadQuat.w * bumpL);
        // Suppressed where it glows: bright means RAISED to a height map, so
        // without this the eyes bulge out of their sockets.
        n = normalize(n + bump * faceCfg.w * facing * tex.a * (1.0 - faceGlow));
      }
    }
  }`;
