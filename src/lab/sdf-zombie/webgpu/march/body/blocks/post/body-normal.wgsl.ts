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
// THE FRAME. u = the angle round the vertical axis through (axisX, axisZ) in rest space (0.5 = facing
// +z), v = rest height between yMin and yMax (v = 1 at yMax, the image's top row). Tangent = d/du (round
// the axis), bitangent = rest +y, normal = the shading normal. The texel is a tangent-space normal
// (rgb = t, b, n mapped from -1..1). The tangent frame is rotated from rest to world by the INVERSE of
// restPoint's rotation (restPoint maps world -> rest with q; rest -> world is conj(q)), then made
// orthonormal against the current shading normal, so the bake's relief lands on whatever the march
// computed rather than replacing it.
//
// SCOPE: only hits whose dominant prim is in [primStart, primEnd) - the torso cluster - take the map, so
// an arm swinging through the torso's height band is not painted with chest. Masked like the grain:
// off the face sheet, gloss and metal, painted prims, wounds and cut faces.
//
// COST: once per lit pixel, never in the walk or the field. Four textureLoad taps (a manual bilinear: the
// march has no sampler, see shade-helpers.wgsl.ts texel) and the same rows restPoint reads. bodyNormCfg.x
// = 0 - every character that does not declare a body map - skips the block entirely, so those bodies
// shade exactly as before. Locals carry an `nmap` prefix (the REFINE_LOOP name-collision rule the grain
// test pins).
import { ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_QUAT, ROW_REST_A, ROW_REST_B } from '../../../layout';

export const BODY_NORMAL_BLOCK = /* wgsl */ `  // BODY NORMAL MAP (body-normal.wgsl.ts): the character's baked torso
  // relief, projected round the torso in rest space. bodyNormCfg x strength,
  // y rest yMin, z rest yMax; bodyNormAxis x,y the rest axis x and z, z,w the
  // torso prim range. Strength 0 skips the block.
  let nmapStr = bodyNormCfg.x;
  if (nmapStr > 0.0 && hitBest >= i32(bodyNormAxis.z) && hitBest < i32(bodyNormAxis.w)) {
    let nmapMask = (1.0 - faceSheetCover) * (1.0 - max(gloss, metal)) * (1.0 - painted)
      * clamp(1.0 - wm, 0.0, 1.0) * (1.0 - cutFace);
    let nmapRad = vec2<f32>(anchor.x - bodyNormAxis.x, anchor.z - bodyNormAxis.y);
    let nmapV = (anchor.y - bodyNormCfg.y) / max(bodyNormCfg.z - bodyNormCfg.y, 1e-4);
    let nmapRa = textureLoad(data, vec2<i32>(hitBest, ${ROW_REST_A} + gBand), 0);
    if (nmapMask > 0.0 && nmapV > 0.0 && nmapV < 1.0 && dot(nmapRad, nmapRad) > 1e-8 && nmapRa.w > 0.0) {
      // Bilinear over textureLoad: u wraps (it is an angle), v clamps.
      let nmapDim = vec2<f32>(textureDimensions(bodyNormTex, 0));
      let nmapU = atan2(nmapRad.x, nmapRad.y) * 0.15915494 + 0.5;
      let nmapP = vec2<f32>(nmapU * nmapDim.x - 0.5, (1.0 - nmapV) * nmapDim.y - 0.5);
      let nmapI = floor(nmapP);
      let nmapF = nmapP - nmapI;
      let nmapW = i32(nmapDim.x);
      let nmapH = i32(nmapDim.y);
      let nmapX0 = ((i32(nmapI.x) % nmapW) + nmapW) % nmapW;
      let nmapX1 = (nmapX0 + 1) % nmapW;
      let nmapY0 = clamp(i32(nmapI.y), 0, nmapH - 1);
      let nmapY1 = clamp(i32(nmapI.y) + 1, 0, nmapH - 1);
      let nmapTex = mix(
        mix(textureLoad(bodyNormTex, vec2<i32>(nmapX0, nmapY0), 0), textureLoad(bodyNormTex, vec2<i32>(nmapX1, nmapY0), 0), nmapF.x),
        mix(textureLoad(bodyNormTex, vec2<i32>(nmapX0, nmapY1), 0), textureLoad(bodyNormTex, vec2<i32>(nmapX1, nmapY1), 0), nmapF.x),
        nmapF.y).xyz * 2.0 - 1.0;
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
      let nmapRn = normalize(nmapRad);
      let nmapT = qRot(nmapQi, vec3<f32>(nmapRn.y, 0.0, -nmapRn.x));
      let nmapTo = normalize(nmapT - n * dot(nmapT, n));
      let nmapBo = cross(n, nmapTo);
      // The texel's tangent components, scaled by strength and the mask,
      // over its normal component: a tangent-space normal applied to n.
      let nmapAmt = nmapStr * nmapMask / max(nmapTex.z, 0.2);
      n = normalize(n + (nmapTo * nmapTex.x + nmapBo * nmapTex.y) * nmapAmt);
    }
  }`;
