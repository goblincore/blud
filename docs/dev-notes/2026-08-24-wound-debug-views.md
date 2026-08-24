# Live shader diagnostic views (paste-in, never commit the paste)

Used three times on 2026-08-24 to root-cause the wound halo family. Paste
this block into `march.wgsl.ts`'s `MARCH_BODY`, immediately after
`var lit = fleshLit * (1.0 - faceGlow) + glow;`. It hijacks `mottleColor`
(inert while `surfCfg2.z`/mottleAmp is 0 — true for the zombie preset), so
views are switchable live from the console with **no reload**:

```js
__sdfLab.uniforms.mottleColor.value.setRGB(0,0,1)  // masks
__sdfLab.uniforms.mottleColor.value.setRGB(0,1,0)  // components
__sdfLab.uniforms.mottleColor.value.setRGB(1,0,0)  // normals
__sdfLab.uniforms.mottleColor.value.setRGB(0.62,0.24,0.30) // back to normal
```

```wgsl
  // DEBUG (LOCAL ONLY, never commit)
  if (mottleColor.b > 0.9 && mottleColor.r < 0.1) {
    // masks: R = wm (colouring), G = wmRim (fresnel fade), B = keyGate
    lit = vec3<f32>(wm, wmRim, keyGate);
  } else if (mottleColor.g > 0.9 && mottleColor.r < 0.1) {
    // components: which lighting term paints this pixel?
    // R = key path (albedo * (fill + gated key diffuse) * ao)
    // G = wet highlight path (spec + fresnel, wet-boosted)
    // B = scatter
    let t1 = albedo * (lightCfg.y + diff * keyGate * lightCfg.x) * keyColor * ao;
    let t2 = keyColor * (shineOcc * mix(surfCfg.x, 1.5, gloss) + fres * mix(1.0, 2.5, gloss)) * wet;
    lit = vec3<f32>(dot(t1, vec3<f32>(0.33, 0.34, 0.33)), dot(t2, vec3<f32>(0.33, 0.34, 0.33)), dot(scatter, vec3<f32>(1.0, 1.0, 1.0)));
  } else if (mottleColor.r > 0.9 && mottleColor.g < 0.1 && mottleColor.b < 0.1) {
    // world normals
    lit = vec3<f32>(n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, n.z * 0.5 + 0.5);
  }
```

Also useful with it:

- `__sdfLab.stampWounds(n)` — n deterministic blasts on the torso front.
- `__sdfLab.stampWoundAt([x,y,z], [dx,dy,dz])` — aimed blast; get the body's
  live position from `__sdfLab.body.position` first (it wanders).
- Kill-tests without reload: `surfCfg.x` specIntensity / `surfCfg.z`
  fresnelBoost / `surfCfg.w` translucency / `surfCfg2.x` wetness.
- Vite HMR on `march.wgsl.ts` FULL-RELOADS the page and wipes all wounds —
  re-stamp after every shader edit.
- A stale dev server serving the pre-edit shader is the classic false
  "my fix does nothing": `curl localhost:PORT/src/lab/sdf-zombie/webgpu/march.wgsl.ts | grep <your new line>`.

Why these three views: the halo family was diagnosed by (1) masks showing
the radial fade's sphere footprint (the crescent halo), (2) components
showing the residual white slab was the spec term, (3) the earlier hit-z
variant showing rays landing inside the body (the tracer overshoot).
