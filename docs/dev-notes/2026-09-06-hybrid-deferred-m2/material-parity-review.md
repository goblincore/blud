# Flesh material regression — owner observation

The owner observed flat zombies in WIP screenshots. Read-only shader review confirms missing material/display response, rather than a missing normal-map load.

- Procedural normals and FBM detail are shared in `march.wgsl.ts` around2696–2723 and packed by `deferred-sdf.ts` around108.
- Legacy authored specular intensity, Fresnel and wetness intensity are not preserved by the surface output. `deferred-layer.ts` uses dielectric0.04 and caps flesh spec at0.35, producing a maximum coefficient0.014 before diffuse-angle/lighting attenuation. Compare legacy material response around `march.wgsl.ts:3310`.
- Legacy flesh applies display compensation under `lodCfg.y`, enabled by default. Deferred omits it, brightening/desaturating authored presets through the final sRGB encode. Compare `march.wgsl.ts:3345` with `deferred-layer.ts:498`.
- Field AO/crease shading and backlit scatter are omitted, replaced by constant ambient and wrapped diffuse. These further reduce shape contrast.

These were documented M1 approximations, but their combined appearance is a material regression to resolve for the playable M2 visual gate. Functional depth/visibility checks cannot approve it. A global light-gain adjustment cannot recover the missing specular/Fresnel response. Preserve the shared surface contract and compare actual zombie/soldier/goblin materials in matched legacy/deferred captures before accepting appearance.


Visual confirmation: `material-legacy.png` shows strong wet highlights and local surface contrast; `material-deferred.png` is visibly smoother and flatter. Both captures use the same room-2 zombie selection and 1.8m camera offset on fresh boots at800x600, but the live initial poses differ, so these are a qualitative comparison rather than pixel-matched numerical evidence. The held weapon also appears substantially darker in deferred. Capture setup/poses are in `material-capture-evidence.json` (diagnostic only, not acceptance).
