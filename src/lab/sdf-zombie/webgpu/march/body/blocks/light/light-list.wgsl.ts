// src/lab/sdf-zombie/webgpu/march/body/blocks/light/light-list.wgsl.ts
//
// Shared light list plan 1, Task 9: the march reads the list. Spliced into MARCH_BODY_LIGHT
// (../../light.wgsl.ts) right after FLASHLIGHT_BLOCK, so the dominant pick can REPLACE the key
// (L, keyC, keyI) before anything downstream reads it: the dominant's wrap in light.wgsl.ts, the
// scatter and wound shadow in occlusion, the shoulder in compose. The other three lights and
// every light's back rim are added in compose.wgsl.ts (listDiff * albedo + listSpec) * ao + listRim,
// where albedo and ao are in scope.
//
// TASK 9 REVIEW. In list mode: keyC is only replaced when a dominant exists (else the fresnel
// rim, which rides keyC, would die); the flashlight's level shadow (lvl, occlusion) is 1.0, since
// plan 1 has no level-to-body shadows; the highlight shoulder runs; FLASHLIGHT_BLOCK's per-pixel
// beam is skipped (its L / keyC / keyI would be overwritten here anyway); and the dominant's wrap
// and H use Lk (its view-biased Lb) while scatter and the wound shadow keep the raw L.
//
// GIBS (owner, 2026-09-27: "remove the fresnel effect that creates the pale outline around them as it
// shimmers"). lightListCfg.y above 0.5 marks a marched gib chunk view (createChunkGpuView sets it; every
// body, crowd and lab view leaves it 0): its list back rims are dropped. Its fresnel is off through
// surfCfg.z = 0 (copyTemplateLook), which works on both paths.
//
// OFF BY DEFAULT. lightListCfg.x is 0 on every view until Task 10 turns it on in the game; at 0
// the if is skipped, the list* vars stay zero, the compose add is + 0 and the dominant's wrap
// keeps the old max(dot(n, L), 0) expression, so the lit output is unchanged.
//
// Names used from the enclosing entry, all in scope at the splice point: p (the hit, used by
// FLASHLIGHT_BLOCK), n (the shading normal) and rd (the ray; light.wgsl.ts's V = -rd follows the
// block), L / keyC / keyI (FLASHLIGHT_BLOCK's vars), gInstLights (the REC_LIGHTS private, loaded
// by loadInstance), lightList (the entry's storage param, MARCH_BODY_PARAMS).

export const LIGHT_LIST_BLOCK = /* wgsl */ `  // ---- SHARED LIGHT LIST (spec §4-§5) ------------------------------------
  // lightListCfg.x > 0: this body is lit by its 4 picked lights (gInstLights, REC_LIGHTS).
  // Slot 0, the dominant, REPLACES the key (L, keyC, keyI), so scatter, the wound shadow and
  // the shoulder follow it; slots 1-3 and every rim are added in compose.
  // At x = 0 nothing here runs and the old key path is untouched.
  var listDiff = vec3<f32>(0.0);
  var listSpec = vec3<f32>(0.0);
  var listRim = vec3<f32>(0.0);
  var listDomFloor = 0.0;
  // Lk: the dominant's VIEW-BIASED direction (its Lb), for its wrap and highlight; L stays the raw
  // direction for scatter and the wound shadow. Off, Lk == L exactly.
  var Lk = L;
  if (lightListCfg.x > 0.0) {
    let bl = bodyLights(p, n, -rd, gInstLights, lightList, true);
    let peak = max(bl.domC.x, max(bl.domC.y, bl.domC.z));
    L = bl.domL;
    Lk = bl.domLb;
    // No dominant (slot 0 empty): keep keyC, so the fresnel rim (keyC x fres in compose) stays
    // on; keyI = 0 still gives no key diffuse.
    keyC = select(keyC, bl.domC / max(peak, 1e-4), peak > 1e-4);
    keyI = peak;
    listDiff = bl.diffuse;
    listSpec = bl.spec;
    // lightListCfg.y above 0.5 - a gib chunk view - drops every back rim: owner 2026-09-27, no edge rim on gibs.
    listRim = select(bl.rim, vec3<f32>(0.0), lightListCfg.y > 0.5);
    listDomFloor = bl.domFloor;
  }
  // ---- END SHARED LIGHT LIST ----------------------------------------------`;
