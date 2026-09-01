# Dungeon relighting — wet gray stone, an offset flashlight, and Doom 3 specular

Owner's ask (2026-09-01): *"lets begin the dungeon relighting task. see attached
for the general idea though i would like to have more specular. kinda like
doom3 meets dungeon in a way."* — attached, a 10 s capture of a Build-engine
dungeon corridor.

This supersedes the *world* half of
[`2026-08-24-environment-lighting-design.md`](2026-08-24-environment-lighting-design.md).
That spec's `L1` P1 shipped and merged (`4e4939c`) and its `ambientAt` seam is
**kept unchanged** — see §4. What changes is the room it lights: a white gallery
tuned to show bounce off becomes a dungeon lit by one moving lamp.

## The reference, read honestly

| Reference frames show | Blud today (`sdf-game.html`) |
|---|---|
| Near-black past ~5 m | `AmbientLight` 0.95 + `HemisphereLight` 0.8 + `DirectionalLight` 0.9 |
| Chunky brick doing most of the work | `MeshStandardMaterial`, `roughness: 1`, **no maps at all** |
| All light rides with the player | 5 static coloured accent PointLights, gallery art-wash |
| Warm sepia sandstone | `GALLERY_WALL` `[0.88, 0.87, 0.85]` — near-white |
| **No specular whatsoever** | none either |

Two things follow immediately, and they set the whole scope.

**The reference look is mostly texture, not lighting.** Grey boxes lit by a
flashlight read as grey boxes. And the owner's actual ask — *more* specular,
Doom 3 — is not a knob on the current materials: a specular highlight needs
surface relief to slide across, so **a normal map is the feature**, and the
lighting is what reveals it.

**The reference is not Doom 3.** The frames have no specular at all; they are
flat-lit sector shading. So this is deliberately a hybrid: the reference's
darkness, falloff and stone, with per-pixel bumped specular the reference never
had. Where the two disagree, the owner's stated preference wins.

## Decisions

| Decision | Value | Rationale |
|---|---|---|
| Scope | Lighting **+ procedurally generated stone maps** | Specular needs relief; procedural sidesteps the never-ship asset guardrail entirely |
| Light rig | Flashlight **+ fire practicals** | Reuses the 5 existing `AccentLight` entries — the only channel by which SDF characters see world light |
| Palette | **Cold wet gray stone, warm fire** | Owner's ask on record was "dark, dank, wet gray"; cold stone makes fire pools read warm, and a neutral beam keeps highlights white — warm-on-warm muddies exactly the specular being asked for. **Confirmed by owner 2026-09-01** against the reference video: "we dont need the warm sepia from the reference" |
| Flashlight mount | **Weapon-mounted, offset** ~0.25 m right / 0.15 m down | An eye-mounted light casts no *visible* shadow — every shadow hides behind its caster. The offset **is** the Doom 3 read |
| Character self-shadow | **Cut** (owner call) | The only mechanism that cost `mapBody` evals. Without it the whole design holds the zero-extra-eval line |
| `ambientAt` | **Unmodified** | Fed dungeon albedos instead of gallery white. The seam stays a data swap, per the P1 spec |
| Blood retune | **In scope** | Goo was tuned against white walls we are deleting |

### Why cold stone and warm fire

The owner asked for more specular. Specular contrast is what makes wet stone
read as wet, and it comes from a **tight bright highlight against a dark
diffuse**. A warm beam on warm sandstone — the literal reference palette —
gives soft golden highlights that blend into the albedo: the palette actively
fights the ask. Gray stone under a near-white beam gives the highlight nowhere
to hide, and leaves the entire warm half of the wheel to the braziers, so fire
reads as fire without being bright.

Wetness is **roughness variation, not a global gloss.** A uniform low roughness
reads as polished plastic. Damp streaks and darker, glossier stone low on the
walls and in floor pools read as *damp*.

## The spike — and what it found

Run before this spec was written, on the game page, then isolated. The project
has a recorded scar here: *"the toolchain does not compile shaders anywhere —
three render bugs survived eight green dispatch tasks."* Shadow support was the
largest unknown, so it was tested before being designed around.

| Question | Verdict |
|---|---|
| Does `WebGPURenderer` r185 do `SpotLight` shadows at all? | **Yes.** Isolated page, clean hard shadow |
| …through a render target? | **Yes.** Shadow survives an RT + blit |
| …on the real game scene, rendered plainly? | **Yes.** A/B on `castShadow` gave a hard floor shadow |
| …through Blud's `postAa` → `sdfLayer` chain? | **NO. Shadows vanish entirely** |

In the live game the spotlight cone rendered correctly, `castShadow` was true on
all 98 level meshes, `receiveShadow` on all 98, and `spot.shadow.map` was
allocated at 1024² — and a box hung **directly in the beam** cast nothing. With
the post chain bypassed and the same scene rendered plainly, the same box threw
a hard black shadow.

**Leading hypothesis.** `sdfLayer.render` mutates `camera.layers` for its cone
and occluder passes ([`sdf-layer.ts:541,561`](../../../src/lab/sdf-zombie/webgpu/sdf-layer.ts))
and issues several `renderer.render()` calls per frame. If three's WebGPU shadow
pass builds its caster list from the **camera-filtered** render list rather than
walking the scene graph, the level meshes fall out of the shadow map whenever
the camera is pinned to `CONE_LAYER` or `OCCLUDER_LAYER`. This is a hypothesis,
not a finding — confirming it is task 1.

**This is the single most valuable output of the spike.** Every other item here
is ordinary work; this one would have silently consumed a dispatch task and
come back green.

## Architecture

### 1. Procedural stone — `src/game/level/stone-textures.ts` (new)

Bakes albedo + normal + roughness to canvas at load, from seeded noise:
`wallBrick`, `floorCobble`, `ceilingVault`. Deterministic, so it is testable
without compiling a shader — assert on sampled pixels, not on appearance.

- Normal-map strength is the **primary Doom 3 knob** and is exposed for tuning.
- A wetness mask drives roughness ~0.8 (dry) → ~0.2 (wet) and darkens albedo in
  the same places: streaks, wall bases, floor pools.
- Resolves through the **existing** `theme-material-set.ts` role seam
  (`floor`/`wall`/`coverLow`/…), whose own comment calls the current set
  "untextured default — used until tile sets are wired in". This is that wiring,
  not a parallel concept.
- `tex.colorSpace = THREE.SRGBColorSpace` on the **albedo only** — normal and
  roughness are data, not colour. This is a recorded past bug in this codebase.

### 2. Light rig — `game-main.ts`

Delete the gallery rig (`game-main.ts:186–207`): `HemisphereLight` 0.8,
`AmbientLight` 0.95, `DirectionalLight` 0.9.

- **Flashlight** — `SpotLight`, near-white `0xf0f4ff`, `castShadow`, ~12 m
  range, soft penumbra, parented to the FPV weapon rig at ~+0.25 m right /
  −0.15 m down from the eye.
- **Braziers** — the 5 existing per-room `AccentLight` entries recoloured from
  art-wash (red/teal/amber/violet/magenta) to fire, with flicker and small
  emissive source geometry. Their bounce follows for free: `litWallAlbedo`
  already folds accents into wall albedo.
- **Fog** — `scene.fog` already exists at `(0x1a1116, 10, 60)`
  ([`lab-renderer.ts:185`](../../../src/lab/sdf-zombie/webgpu/lab-renderer.ts)).
  Retuned near-black and short. This is what actually swallows the corridor.

### 3. Shadows — three mechanisms

| # | What | Mechanism | Cost |
|---|---|---|---|
| 1 | walls → walls | `SpotLight` shadow map | native, **once task 1 lands** |
| 2 | characters → walls | existing occluder hull, `castShadow = true` | ≈free |
| 3 | walls → characters | analytic AABB ray in the march vs `levelColliders()` | **zero** `mapBody` |

**#2 is nearly free and was the design's happiest find.** `createOccluderHull()`
is *already* an `InstancedMesh` in the game scene (`game-main.ts:346`), already
re-posed every frame from live bodies. Two caveats, both real:

- It is on `OCCLUDER_LAYER`, so the shadow camera will not see it until the
  light's layer mask includes that layer.
- Its material is a custom `MeshBasicNodeMaterial` writing camera distance;
  the shadow depth pass may need a `customDepthMaterial`.
- The silhouette is hull-approximate (shrunk spheres, `HULL_SHRINK 0.8`), so
  shadows are **chunky, not exact**. **Owner has accepted this** (2026-09-01):
  "character shadows dont need to be exact silhouettes atm, we can further blur
  them maybe too."

#### Shadow softness — spiked, and narrower than expected

The owner's blur suggestion was tested against a **sphere cluster shaped like
the occluder hull**, so the blur was judged on the thing it would actually be
softening. Three findings, all on `WebGPURenderer` r185:

| Lever | Verdict |
|---|---|
| `PCFSoftShadowMap` | **Works.** The hull cluster reads as a soft blobby figure shadow — already close to what the owner is asking for |
| `spot.shadow.radius` | **No-op.** `radius: 1` and `radius: 12` are pixel-identical, and `PCFShadowMap` matches both |
| `VSMShadowMap` + `blurSamples` | **Unusable.** Severe banding striped across the whole floor |

So *"blur them further"* is **not** available through the obvious three.js
knobs. The remaining levers are shadow-map **resolution** (a smaller map is
softer but blockier) and the hull's own inflation. The good news is that
`PCFSoftShadowMap`'s built-in softness already produces the blobby,
non-silhouette look the owner signed off on — so this is likely a
non-problem, but it must not be planned around as if `shadow.radius` worked.

**Softness is global, not per-caster.** One shadow-casting light means one
shadow map, so anything softening character shadows softens wall shadows too.
That is arguably correct anyway — a torch is an area source — but it is a
constraint, not a choice.

**#3** loops ~56 AABBs from `levelColliders()`, slab tests only, only on
character pixels. Room-local culling via the existing `enclosureOf()` is the
fallback if it measures badly.

### 4. Flashlight on SDF characters

Per-pixel inside the march: spotlight position/axis/cone/colour as uniforms,
driving the existing key term (`L`, `keyColor`, `lightCfg.x`). Dot products and
falloff — **no field evals**.

Two constraints from recorded project history, both binding:

- **`ambientAt` is fed, never modified.** It stays bit-exact at `probeWeight 0`.
  It receives dungeon stone albedos in place of gallery white, so a character's
  shadow side picks up wet gray.
- **Brightness rides `keyColor`, not albedo.** `ambientAt` renormalises bounce
  to unit luminance, so albedo boosts change *hue only*. A flashlight is a
  brightness change; it must go through the key. (Precedent: `game-flash.ts`.)

Per-pixel rather than per-body is deliberate: the cone edge must cut *across* a
body instead of the whole zombie popping on at once.

### 5. Blood retune

Owner-tuned goo defaults (`absorb 1.6`, `spec 2.85`, `gloss 220`,
`shadowRed 0.12`) were found against white gallery walls. `shadowRed` exists
specifically so blood never reads black — calibrated against a background this
spec deletes. `goo-panel.ts` already ships 12 sliders and a COPY button emitting
exact console calls, so this is a panel session, not code.

## How we know it worked

1. **Owner's eye** on `sdf-game.html`, A/B against the reference capture.
2. **Bench, shadows on/off**, via existing `game-bench` scenes. The measurement
   never taken for goo, taken here. Note the compounding debt: goo already ships
   ON and unbenched.
3. **Off-state parity** — dungeon preset off ⇒ the gallery renders identically.
   Same discipline as `ambientAt`'s `probeWeight 0` early-out.
4. **`mapBody` eval count asserted unchanged**, by test, not by eye.
5. **A shadow regression test.** Task 1's bug was invisible to 2378 passing
   tests. Whatever the fix is, it gets a test that fails without it.

## Not in scope

No level geometry changes — the ring stays 4 square rooms and straight tunnels;
vaulted ceilings are texture and lighting here, not mesh. No room editor, no
room format, no baked irradiance volumes (P3), no character self-shadowing.

## Open questions

1. ~~Does hull-approximate character shadow read acceptably?~~ **CLOSED
   (2026-09-01, owner):** exact silhouettes are not required. Softness levers
   are spiked and constrained — see §3.
2. **Do 5 braziers read as fire or as coloured point lights?** Same question P1
   left open about bounce lights, now with flicker and visible sources.
3. **Is one shadow-casting spotlight affordable** at 1024² over ~98 meshes on a
   page already ~10 ms? Task 2 answers this with a number.
4. **If `PCFSoftShadowMap`'s fixed softness is not soft enough**, is a lower
   shadow-map resolution an acceptable trade, or does the blockiness cost more
   than the hard edge did? Only judgeable on screen, after task 1.
