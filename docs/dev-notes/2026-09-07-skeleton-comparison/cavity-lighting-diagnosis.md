# Mesh cavity brightness: source diagnosis (2026-09-08)

Scope: source review against f7a2b2e2. No shader/material changes, GPU jobs, or visual acceptance claimed in this investigation.

## Confirmed differences

- `game-main.ts` switches mesh actors to `view.setPackBones(false)`. `zombie-gpu.ts` forwards that layout to `packBody`; `pack.ts` omits `op: bone` rows while retaining organs. This removes bones from the complete flesh distance field, not only primary visibility.
- `march.wgsl.ts` flesh AO samples `mapBody(p + n * 0.06)` and clamps distance / 0.06 to 0.35–1. In wound zones `mapBody` includes packed bones through `applyBones`. Mesh mode therefore loses nearby bone occlusion on the *flesh* surface. Changing mesh albedo cannot restore it. Scatter and enabled wound-shadow samples also query this field.
- The control can terminate on a packed bone and shade it as plain meat: the ordinary bone-albedo branch was previously removed; `isBone` is consulted by the melt ramp. Thus a red control surface that appears to be the cavity backwall may actually be a different geometric surface from the mesh backwall.
- Mesh forward `BONE_SHADE_WGSL` applies an exposure-based `mix(0.45, 1.0, expo)` AO to mesh diffuse only. It neither samples nearby bones nor affects flesh pixels.

These are established code differences, not proof that missing AO explains the owner's specific screenshot. That requires matched captures below. The prior wound-keyed AO/key/spec darkening was explicitly rejected in the shader's recorded owner A/B; do not mask this with another radial darkening patch.

## Matched AO diagnostic

In each existing frozen mesh/control fixture, retain identical camera, pose, wounds, lights, and renderer. Collect the ordinary image first. Use this console code to disable **flesh field AO** on all current bodies/chunks:

```js
const G = window.__sdfGame;
window.__cavityAoSaved = G.normalGradientPieces().map(({key}) => {
  const u = G.normalGradientPiece(key).uniforms.lodCfg.value;
  const old = u.x;
  u.x = 0;
  return {key, old};
});
G.normalGradientPieces().map(({key}) => ({key, ao: G.normalGradientPiece(key).uniforms.lodCfg.value.x}));
```

Capture again after a rendered frame. Restore before other tests:

```js
for (const {key, old} of window.__cavityAoSaved) {
  const view = window.__sdfGame.normalGradientPiece(key);
  if (view) view.uniforms.lodCfg.value.x = old;
}
delete window.__cavityAoSaved;
```

Compare the *within-mode* AO-on/off difference at flesh pixels visible in both mesh and control, not the whole wound mean (which mixes different geometry). A larger control backwall increase supports missing bone AO as a contributor. If the large mesh/control gap survives AO-off, AO is not its full cause: inspect surface identity/depth and tissue shading next. Mesh diffuse's exposure AO is intentionally unchanged by this diagnostic.

For surface provenance, `G.setFlatAlbedo(true)` makes flesh hits return constant base color before all wound/tissue/lighting shading while leaving mesh shading intact; restore with `G.setFlatAlbedo(false)`. This identifies raster mesh pixels versus the body's field in a screenshot. It does **not** distinguish control bone hits from flesh hits: both belong to the same field. Existing debug mode 5 counts bone work and mode 8 counts volume samples/fallbacks; neither reports the final hit's material identity. No existing per-pixel bone-vs-flesh identity metric was found.

## Structural follow-up if the diagnostic supports it

Retain a bone representation for secondary flesh AO/shadow queries while keeping bones excluded from the mesh mode's primary march and normal field. Gate explicitly on mesh mode and preserve default behavior, organ folds, severed chunks, and source lifecycles. Do not simply reenable packed bones in the primary field: that restores competing procedural geometry. Current `counts2.z` and `.w` are already attribution/wound-list gates, not spare channels. This requires a deliberate field/packing interface extension and performance validation; it is outside this bounded appearance pass.
