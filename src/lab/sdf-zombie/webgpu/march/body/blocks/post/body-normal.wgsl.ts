// src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-normal.wgsl.ts
//
// BODY NORMAL MAP (spec docs/superpowers/specs/2026-10-21-body-normal-map-design.md): a per-character
// tangent-space normal texture projected CYLINDRICALLY round the torso in the body's REST pose, post-hit.
// Spliced into MARCH_TRACE_POST right after the body grain, so marchBody, refineBody and the deferred
// marchSurface all run it.
//
// WHY THE REST POSE. A raymarched body has no UVs. It does have `anchor` (shading-normal.wgsl.ts): the hit
// mapped into the dominant prim's REST frame, which is the .blob's own unposed coordinates
// (pack.ts restA/restB are the rest BuiltBody). A projection defined there sticks to the flesh as the body
// moves, and because every torso prim maps into the SAME rest body, the texture does not seam where the
// dominant prim changes between neighbours (it can only drift by how far the pose bends the flesh between
// two prims, which the rigid per-segment torso frames keep small). scripts/bake-body-normal.ts authors the
// texture in exactly this frame.
//
// REGIONS (2026-10-21, limb maps). The texture is an atlas of cylindrical projections, each round a REST-space
// segment head -> tail and baked into its own band of rows; row 0 is the region table (scripts/bake-body-normal.ts
// THE HEADER: texel 0 = 'B', 'N', version, count; five texels per region of 16-bit pairs). Region 0 is the torso,
// a vertical segment, taken only by hits on torso prims (bodyNormAxis z, w): an arm swinging through the torso's
// height band must not be painted with chest. Limb regions are taken by the other hits whose rest point lies
// along their segment within rMax of it, the nearest axis winning. EXTRA torso regions (kind 0 with an rMax,
// scripts/bake-body-normal.ts --torso-seg) do the same for torso hits: a prop of torso flesh standing clear of
// the torso (the gamer's joystick) or arms lying across it, which the one cylinder round the torso cannot see. Because the test is on the REST point, a limb
// in any pose finds its own region.
//
// THE FRAME, per region, which the bake writes in: A = the axis, f = rest +z made perpendicular to A, s = f x A.
// u = atan2(r.s, r.f) / 2pi + 0.5 for the radial r, the band row = row0 + t * rows (t along head -> tail).
// Tangent = s cos th - f sin th (round the axis), bitangent = n x tangent (toward the head), normal = the shading
// normal; the texel is a tangent-space normal (rgb = t, b, n from -1..1). For the torso (A = -y) this is the
// original projection. The tangent frame is rotated from rest to world by the INVERSE of restPoint's rotation
// (restPoint maps world -> rest with q; rest -> world is conj(q)), then made orthonormal against the current
// shading normal, so the bake's relief lands on whatever the march computed rather than replacing it.
//
// Masked like the grain: off the face sheet, gloss and metal, painted prims, wounds and cut faces.
//
// COST: once per lit pixel, never in the walk or the field: the region table (five taps a region, a handful of
// regions), four textureLoad taps for a manual bilinear (the march has no sampler, see shade-helpers.wgsl.ts
// texel) and the rows restPoint reads. bodyNormCfg.x = 0 - every character that does not declare a body map -
// skips the block entirely, so those bodies shade exactly as before. Locals carry an `nmap` prefix (the
// REFINE_LOOP name-collision rule the grain test pins).
import { ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_QUAT, ROW_REST_A, ROW_REST_B } from '../../../layout';

/** A 16-bit value from a header texel's byte pair (textureLoad gives bytes / 255). */
const u16 = (pair: string) => `(round(${pair}.x * 255.0) * 256.0 + round(${pair}.y * 255.0))`;
/** A header position: the 16-bit value mapped back from -2.5..2.5 m. */
const pos16 = (pair: string) => `(${u16(pair)} / 65535.0 * 5.0 - 2.5)`;

export const BODY_NORMAL_BLOCK = /* wgsl */ `  // BODY NORMAL MAP (body-normal.wgsl.ts): the character's baked relief, an
  // atlas of cylindrical projections round rest-space segments, the region
  // table in the texture's header row. bodyNormCfg x strength, yzw the body's
  // placement origin; bodyNormAxis
  // z,w the torso prim range (region 0's hits). Strength 0 skips the block.
  let nmapStr = bodyNormCfg.x;
  if (nmapStr > 0.0) {
    let nmapMask = (1.0 - faceSheetCover) * (1.0 - max(gloss, metal)) * (1.0 - painted)
      * clamp(1.0 - wm, 0.0, 1.0) * (1.0 - cutFace);
    let nmapRa = textureLoad(data, vec2<i32>(hitBest, ${ROW_REST_A} + gBand), 0);
    let nmapHdr = textureLoad(bodyNormTex, vec2<i32>(0, 0), 0) * 255.0;
    if (nmapMask > 0.0 && nmapRa.w > 0.0 && round(nmapHdr.x) == 66.0 && round(nmapHdr.y) == 78.0) {
      // The rest point in the map's frame: a PLACED body (the game's spawn point) carries its rest points moved by
      // the placement, bodyNormCfg.yzw (zombie-gpu.ts setBodyNormal); the regions are baked round the origin.
      let nmapAnc = anchor - bodyNormCfg.yzw;
      let nmapTorso = hitBest >= i32(bodyNormAxis.z) && hitBest < i32(bodyNormAxis.w);
      let nmapCount = min(i32(round(nmapHdr.w)), 16);
      var nmapBestD = 1e9;
      var nmapBA = vec3<f32>(0.0, -1.0, 0.0);
      var nmapBRad = vec3<f32>(0.0);
      var nmapBT = 0.0;
      var nmapBRow0 = 0.0;
      var nmapBRows = 0.0;
      for (var nmapI = 0; nmapI < nmapCount; nmapI++) {
        let nmapX = 1 + 5 * nmapI;
        let nmapE0 = textureLoad(bodyNormTex, vec2<i32>(nmapX, 0), 0);
        let nmapE1 = textureLoad(bodyNormTex, vec2<i32>(nmapX + 1, 0), 0);
        let nmapE2 = textureLoad(bodyNormTex, vec2<i32>(nmapX + 2, 0), 0);
        let nmapE3 = textureLoad(bodyNormTex, vec2<i32>(nmapX + 3, 0), 0);
        let nmapE4 = textureLoad(bodyNormTex, vec2<i32>(nmapX + 4, 0), 0);
        let nmapKind = ${u16('nmapE4.zw')};
        if ((nmapKind < 0.5) != nmapTorso) { continue; }
        let nmapHd = vec3<f32>(${pos16('nmapE0.xy')}, ${pos16('nmapE0.zw')}, ${pos16('nmapE1.xy')});
        let nmapTl = vec3<f32>(${pos16('nmapE1.zw')}, ${pos16('nmapE2.xy')}, ${pos16('nmapE2.zw')});
        let nmapAx = nmapTl - nmapHd;
        let nmapT = dot(nmapAnc - nmapHd, nmapAx) / max(dot(nmapAx, nmapAx), 1e-8);
        if (nmapT <= 0.0 || nmapT >= 1.0) { continue; }
        let nmapRadV = nmapAnc - (nmapHd + nmapAx * nmapT);
        let nmapD = length(nmapRadV);
        // rMax bounds a limb region, and an EXTRA torso region (a torso-prim
        // segment beside region 0, e.g. the gamer's joystick and forearms,
        // baked with --torso-seg) when it is set; region 0 has none (0), so
        // it takes every torso hit no nearer axis claims.
        let nmapRMax = ${pos16('nmapE3.xy')};
        if ((nmapKind > 0.5 || nmapRMax > 1e-3) && nmapD > nmapRMax) { continue; }
        if (nmapD < nmapBestD) {
          nmapBestD = nmapD;
          nmapBA = nmapAx;
          nmapBRad = nmapRadV;
          nmapBT = nmapT;
          nmapBRow0 = ${u16('nmapE3.zw')};
          nmapBRows = ${u16('nmapE4.xy')};
        }
      }
      if (nmapBestD < 1e8 && nmapBestD > 1e-4 && nmapBRows > 0.0) {
        let nmapA = normalize(nmapBA);
        let nmapF = normalize(vec3<f32>(0.0, 0.0, 1.0) - nmapA * nmapA.z);
        let nmapS = cross(nmapF, nmapA);
        let nmapRn = nmapBRad / nmapBestD;
        let nmapCo = dot(nmapRn, nmapF);
        let nmapSi = dot(nmapRn, nmapS);
        // Bilinear over textureLoad: u wraps (it is an angle), the row clamps
        // inside the region's own band.
        let nmapDim = vec2<f32>(textureDimensions(bodyNormTex, 0));
        let nmapU = atan2(nmapSi, nmapCo) * 0.15915494 + 0.5;
        let nmapP = vec2<f32>(nmapU * nmapDim.x - 0.5, nmapBRow0 + nmapBT * nmapBRows - 0.5);
        let nmapIp = floor(nmapP);
        let nmapFr = nmapP - nmapIp;
        let nmapW = i32(nmapDim.x);
        let nmapLo = i32(nmapBRow0);
        let nmapHi = i32(nmapBRow0 + nmapBRows) - 1;
        let nmapX0 = ((i32(nmapIp.x) % nmapW) + nmapW) % nmapW;
        let nmapX1 = (nmapX0 + 1) % nmapW;
        let nmapY0 = clamp(i32(nmapIp.y), nmapLo, nmapHi);
        let nmapY1 = clamp(i32(nmapIp.y) + 1, nmapLo, nmapHi);
        let nmapTex = mix(
          mix(textureLoad(bodyNormTex, vec2<i32>(nmapX0, nmapY0), 0), textureLoad(bodyNormTex, vec2<i32>(nmapX1, nmapY0), 0), nmapFr.x),
          mix(textureLoad(bodyNormTex, vec2<i32>(nmapX0, nmapY1), 0), textureLoad(bodyNormTex, vec2<i32>(nmapX1, nmapY1), 0), nmapFr.x),
          nmapFr.y).xyz * 2.0 - 1.0;
        // restPoint's world -> rest rotation, rebuilt from the same rows; its
        // conjugate carries the rest-space tangent frame to world.
        let nmapRb = textureLoad(data, vec2<i32>(hitBest, ${ROW_REST_B} + gBand), 0).xyz;
        let nmapPa = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_A} + gBand), 0).xyz;
        let nmapPb = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_B} + gBand), 0).xyz;
        var nmapQ = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        let nmapO = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_QUAT} + gBand), 0);
        if (abs(1.0 - nmapO.w) > 1e-6) { nmapQ = vec4<f32>(-nmapO.xyz, nmapO.w); }
        let nmapAxP = nmapPb - nmapPa;
        let nmapAxR = nmapRb - nmapRa.xyz;
        if (length(nmapAxP) > 1e-6 && length(nmapAxR) > 1e-6) {
          nmapQ = qMulQ(qFromToV(qRot(nmapQ, normalize(nmapAxP)), normalize(nmapAxR)), nmapQ);
        }
        let nmapQi = vec4<f32>(-nmapQ.xyz, nmapQ.w);
        let nmapTg = qRot(nmapQi, nmapS * nmapCo - nmapF * nmapSi);
        let nmapTo = normalize(nmapTg - n * dot(nmapTg, n));
        let nmapBo = cross(n, nmapTo);
        // The texel's tangent components, scaled by strength and the mask,
        // over its normal component: a tangent-space normal applied to n.
        let nmapAmt = nmapStr * nmapMask / max(nmapTex.z, 0.2);
        n = normalize(n + (nmapTo * nmapTex.x + nmapBo * nmapTex.y) * nmapAmt);
      }
    }
  }`;
