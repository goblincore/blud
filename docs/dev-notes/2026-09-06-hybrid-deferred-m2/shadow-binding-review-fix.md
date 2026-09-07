# Shadow binding review fix — two shadow slots must be independently bindable

Date: 2026-09-06 · Branch: `codex/dispatch/2026-09-06-hybrid-deferred-m2-shadow-binding-review-fix`
Fix commit: `fd690450` (+ this evidence commit) · Scope: owner-authorized review correction of M2 task 4. No design changes, no default flips, task 5 untouched.

## The reviewed finding (confirmed)

At task 4 final `8e57be87`, `deferred-layer.ts` (lines 530–540) built **both** shadow
TextureNodes from the **same** fallback texture:

```ts
const shadowFallbackTexture = (() => { ... one 1x1 R32F far DataTexture ... })();
const uShadowFullDepth = texture(shadowFallbackTexture);
const uShadowLevelDepth = texture(shadowFallbackTexture);
```

The installed three.js dedupes uniforms by the texture's uuid:

- `node_modules/three/src/nodes/accessors/TextureNode.js:217` — `getUniformHash()` returns `this.value.uuid`;
- `node_modules/three/src/nodes/core/UniformNode.js:162–176` — `generate()` looks the hash up in the
  builder (`getNodeFromHash`) and reuses the first node's uniform when it collides.

Consequence: a layer whose light pass **first compiled with the null binding** (the M1 boot path —
the page renders unbound before any binding is stored) produced ONE uniform binding shared by the
`fullDepth` and `levelDepth` WGSL params. A later `setFlashlightShadow(...)` only writes the nodes'
`.value` (data-only rebind, by design — no rebuild), and both nodes feed the same compiled
nodeUniform, so the slots could never be bound independently again. The existing task-4 fixture did
render null-first, but its clear-flesh no-self-shadow check can pass with the wrong map because the
clip-depth bias (0.0025) conceals shallow hull separation — it was not a decisive binding test.

## The decisive regression (written and recorded BEFORE the fix)

`deferred-shadows-main.ts` gained `__deferredShadows.bindingIdentityCheck()`; the driver
(`scripts/deferred-shadow-check.mjs`) asserts on its evidence. Design:

- **Constant-depth R32F maps make every in-frustum receiver a discriminator with no threshold
  ambiguity.** Two 8×8 `RedFormat`/`FloatType` nearest DataTextures per phase: phase A binds
  full = 0.0 / level-only = 1.0; phase B swaps them (full = 1.0 / level-only = 0.0). `mapSize` is
  (8, 8), consistent with the textures; the comparison bias is the real `FLASHLIGHT_SHADOW_BIAS`.
- **An in-frustum matrix with no boundary cases**: world → clip with w = 1, xy compressed ×0.1
  (whole room in-frustum), z affine onto [0.25, 0.75] across the room depth — receiver clip depths
  sit orders of magnitude from the 0.0025 bias, so "occluded" and "lit" are unambiguous.
- **Real rendered contributions, raw linear readback**: the lit target (RGBA16F) is read back per
  pixel; per-pixel deltas between the sampling-off baseline and each phase cancel ambient, emission
  and the three practicals by construction; `maxOff` 6.84 confirms nothing near saturation.
- **Receiver classification from the G-buffer**: the resolved `emissionClass.a` packed bit 4
  (≥ 15.5 = level-only receiver, i.e. zombie flesh) vs the full receivers (stone room/slab/cutout);
  positions outside the shadow frustum are excluded, matching the WGSL.
- **Toggles and restoration**: custom-bound sampling-off (must equal the M1 baseline hash) → on
  (phase A) → swapped (phase B) → `clearBinding()` null restore (slots must return to their OWN
  owned fallbacks; output hash must reproduce the M1 baseline at the same pose).

### Pre-fix failure (recorded, not asserted retroactively)

Command: `LAB_VITE_PORT=5338 LAB_CDP_PORT=9338 SHADOW_CHECK_OUT=shadow-binding-prefix-check.json scripts/deferred-shadow-check.sh`
→ exit 1. All 10 existing checks PASS; the new decisive check fails exactly on the collapse
(`shadow-binding-prefix-check.json`):

- Phase A (full = 0, level = 1): full receivers darken (40 785 flashlight-reached px, 74.6%
  darkened, mean 0.125 lost) — **and level-only receivers darken too: `maxRelDiffA` = 0.970**
  (up to 97% of their light lost). The flesh read the FULL map. Both slots sampled one binding.
- Phase B (swapped): **nobody responds** — full receivers bit-identical to baseline
  (`maxRelDiffSwapped` = 0), flesh `darkenedFractionSwapped` = 0. Both slots still followed the
  full slot's texture (const 1).
- Populations: 263 579 in-frustum receiver px; 40 785 full-lit / 5 024 flesh-lit. Saturation guard
  maxOff 6.84. (Which slot wins the shared uniform is traversal-order luck — the point is that the
  two cannot disagree.)

## The fix (`fd690450`, `deferred-layer.ts`)

- **One owned 1×1 far-depth R32F fallback PER SLOT** (`makeShadowFallbackTexture()` called twice →
  different uuids → different uniform hashes → two independent compiled bindings for the life of
  the pipeline). Same far content (value 1) and filters as before; the M1 unshadowed default is
  unchanged.
- **Per-slot null restoration**: `refreshShadowUniforms()`'s null branch now puts each slot back to
  **its own** fallback (`uShadowFullDepth.value = shadowFallbackFull`, same for level) instead of
  leaving stale caller textures in the slots. Still data-only — no rebuild, no per-frame map
  disposal; caller-owned maps are never disposed.
- **Exactly-once disposal**: `dispose()` disposes `shadowFallbackFull` and `shadowFallbackLevel`
  once each.
- **Observability**: `diagnostics().shadowSlots` (current per-slot uuid + owned-fallback flags,
  CDP-safe primitives) and `debugShadowFallbacks()` (DIAGNOSTIC ONLY — the two owned textures, for
  identity/content/dispose-spies in tests).

No further binding issue surfaced: the collapse was the single root cause, and the same per-frame
binding path (`refreshShadowUniforms` at the top of `render`) carries the fix.

## Post-fix evidence

Same command with the default evidence name (`task4-shadow-check.json`) → **exit 0, ALL CHECKS
PASS, 13/13** (the original 10 preserved verbatim + 3 new):

- `binding-identity-const-depths` PASS — full receivers darken ONLY under the const-0 full map
  (74.6%, mean 0.125) and are **bit-identical under the swap** (`maxRelDiffSwapped` = 0);
  level-only receivers are **bit-identical in phase A** (`maxRelDiffA` = 0) and lose their whole
  flashlight share under the swapped const-0 level map (100% darkened, mean 4.44 of 4.69).
  Each slot now responds independently and only to its own map.
- `binding-identity-off-inert` PASS — a per-slot custom binding with sampling disabled is
  hash-identical to the M1 null output (`e6d53eaf` both).
- `binding-identity-slots-restore` PASS — null-first slots: two distinct uuids
  (`e4a3b7d8…` / `e7b24f32…`), both owned-fallback; custom binding moves both slots to the caller
  textures; null restore returns each slot to exactly its pre-bind owned fallback uuid; restored
  hash = baseline hash.

## Verification commands

```
npx tsc --noEmit                                                    # clean
NODE_OPTIONS=--no-experimental-webstorage npx vitest run \
  src/lab/sdf-zombie/webgpu/{deferred-layer,deferred-lighting,deferred-mesh,deferred-surface,\
deferred-sdf,deferred-shadows,game-deferred-scene,game-deferred-lights,lab-renderer,\
occluder-hull,zombie-gpu}.test.ts --maxWorkers=2 --minWorkers=1   # 237/237 (45 in deferred-layer)
LAB_VITE_PORT=5338 LAB_CDP_PORT=9338 scripts/deferred-shadow-check.sh   # 13/13, rc=0
# pre-fix reproduction used the same command + SHADOW_CHECK_OUT=shadow-binding-prefix-check.json (rc=1, as required)
```

Owned vite/CDP servers on 5338/9338 verified released after every run (`lsof` empty); the gate's
own `finally` closes its tab and socket on success and failure.

## Saved artifacts

- `shadow-binding-prefix-check.json` — pre-fix failure record (pass: false, binding evidence with
  the 0.97 relative level-only change).
- `task4-shadow-check.json` — post-fix record, pass: true, 13 checks including the binding trio.
- `task4-shadow-on.png` / `task4-shadow-on-moved.png` / `task4-shadow-off.png` — regenerated
  captures with capture-state assertions (unchanged labels).

## Unit coverage (deferred-layer.test.ts)

- distinct initial slot identity + per-slot far content/format/filters + ownership flags;
- per-slot rebinding through a render, then per-slot restoration of ITS OWN fallback on null;
- each owned fallback disposed exactly once, caller maps untouched.

## Remaining limits

- The const-depth discriminator proves BINDING identity and per-slot response on the real GPU; it
  does not prove the shadow maps' CONTENT correctness (that remains the factory checks:
  caster counters, mask geometry, coherence, same-frame motion).
- `debugShadowFallbacks()` is a diagnostic seam, not an API: the textures are layer-owned and must
  never be caller-disposed (pinned by test).
- The collapsed-binding failure mode would also be caught by any null-first consumer; the unit
  coverage pins the invariant (distinct uuids) so a regression cannot re-land silently.
