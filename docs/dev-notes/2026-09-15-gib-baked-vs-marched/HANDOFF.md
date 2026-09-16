# HANDOFF — settled gib appearance accepted

> **Next session:** [Current issues, loading/first-gib freeze and tearing transition](../2026-09-16-gib-follow-up/HANDOFF.md).

## Current status — 2026-09-16

The owner manually accepted the repaired flesh shading and preserved head face.
Keep baking enabled; stop appearance polish unless requested. The implementation,
comparison images, measured limits and test results are in
[RESULTS.md](parity-fix/RESULTS.md).

The repair preserves source display/specular response, skin relief, subtractive
blast caps and the per-fragment face atlas. Live chunks track the flashlight;
head projection follows their rotation; recycled views receive the new actor's
appearance. Both live and baked flesh carry the new dark stains.

Next main topic: a visible body-rupture/tearing transition before the flying gibs,
using the active melting effect and retired NotBlood tearing sprites as references.
Design is not settled; the suggested 150–250 ms is an experiment, not an accepted
requirement. Damage/explosion timing should remain immediate in that proposal.

Deferred by the owner: investigate floating/resting-upright pieces, and split each
arm and leg into two shorter pieces. Neither follow-up is implemented here.

Validation: build/typecheck and 292 focused tests pass; forward WebGPU same-pose
captures and head-material recycling pass. Full-suite Node 25 storage failures
and the optional deferred renderer's existing `gMarchAnchor` compile issue are
recorded in RESULTS.md. No pixel-identity or performance claim.

## Historical handoff — superseded investigation, 2026-09-15

The text below records the earlier agent's state and hypotheses, not current
work instructions. In particular, the empty `tornAt` list is intentional for
capped blast pieces: do not add tear spheres to fix it. The unresolved-appearance
verdict and full-suite counts below belong to that earlier snapshot.

**Branch:** `claude/dynamite-weapon-slot` · **PR:** [#8](https://github.com/goblincore/blud/pull/8) (draft)
**Earlier snapshot:** `.claude/worktrees/dynamite-weapon-slot` · clean, pushed, `tsc` clean,
vitest **328/328 files, 5169/5169**.

---

## ⚠️ START HERE — THE OWNER'S POSITION, AND WHAT IT RULES OUT

The goal, in his words: *"the idea was to optimize it so htey arent marched but
keep the same look"* and *"i just want the gibs once they land to look just as
they do when they are in the air"*.

So: KEEP THE BAKE (it is the optimisation), MAKE IT MATCH.

**A reference exists and it is one flag.** `?chunkbake=0`, or the DYNAMITE / GIB
panel's `settle bake` row, or `__sdfGame.setChunkBake(false)` leaves a landed
piece MARCHED — identical to the airborne one by construction, because it is the
same renderer. The owner confirmed that reference is right: *"yeah thats much
better, thats wahat i want"*. **Diff against it. Do not ship it.**

**AND THE LAST VERDICT, WHICH IS THE IMPORTANT ONE:** after the whole lighting
pass below, *"hmm still looks the same starngely"*. Not "a bit better" — the
same. That is a strong signal that the remaining difference is NOT in the terms
this session moved, and the next person should not spend their time adding more
lighting terms before reading the next section.

## THE PRIME SUSPECT: THE ALBEDO IS ONE FLAT TONE, AND IT IS A KNOWN BUG CLASS

Measured with `__sdfGame.bakedAlbedoStats()`, every baked piece, repeatedly:

```
mean rgb (0.487, 0.334, 0.265)   min→max range 0.09   meanWoundMask 0
```

`meanWoundMask: 0`. **The wound mask is dead on every settled piece**, so
`albedo = mix(baseColor, tissue, wm)` throws the ENTIRE tissue ramp away — no
fat, no muscle, no clot, no viscera, no wet alpha. The piece is one colour, and
one colour is what "smooth albedo" actually is.

The cause is upstream of the baker: the pieces arrive with **`torn: []`**
(`chunkStats().lastBakeInfo.torn` reads `0`). Follow it back through
`ChunkGpuView.bakeData()` → `tornLocals` → the `tornAt` passed to
`createChunkGpuView` / `reset` in `spawnChunkPiece` → `piece.tornAt` from the gib
piece set. Somewhere there the torn ends are empty.

**This is the SAME bug already diagnosed and fixed once in `gib-carve.ts`** (see
`cutAwareField`, and the 2026-09-11 notes): that path also built its field with
`torn: []`, also measured `wm ≡ 0` over every vertex, and also produced a flat
piece. The fix there was to derive the mask from depth beneath the original skin.
The settled-chunk path has REAL torn ends available — they just are not arriving.

Do this before touching the shader again.

## WHAT THIS SESSION ACTUALLY FIXED (all measured, all in)

- **A 12-slot record pool threw inside the tick.** Main's crowd march sizes one
  shared chunk record buffer from what the page passes, and the page passed the
  pre-dynamite `MAX_CHUNKS` of 12 while the recycler allowed 64. The throw landed
  after the body left `pendingGibs` and before `retireActor`, so a gib vanished
  silently — `gibbed: 1, gibPieces: 0`, nothing logged. Now `MAX_CHUNK_BUDGET = 96`.
- **The settled-chunk material was never registered with `litChunkMaterials`.**
  `createBakedChunkMaterial` is built in two places; only the corpse path
  registered it, and the chunk-bake path is the one that wins in play. So a
  settled piece had NO flashlight and NO room light — `spotCfg.x = 0` against a
  fixed 2.4 directional key, a body lit by a lamp that is not there. **The bake
  was approved by the owner on 2026-09-05 ("nothing off from non baked"); this
  regression landed afterwards, when the registry did.**
- **Per-pixel micro-detail**, using the march's OWN `HASH13`/`NOISE3`/`FBM`
  source strings as `wgslFn` INCLUDES. (Passing TSL noise NODES as wgslFn
  ARGUMENTS measurably delivers nothing — that dead end is now recorded twice.)
- **Two calibration traps found:** the march's `surfaceNoiseAmp` 0.06 is
  invisible on a mesh (per-pixel analytic normal vs interpolated vertex normal) →
  6x gain; and the march's noise domain 22 ALIASES on a 1 cm mesh, because `fbm`
  sums octaves at 4x/9x putting features at 1.1 cm and 5 mm → "little dots …
  like glitter". Domain is 7.
- **Baked per-vertex AO** through the worker (`bakeAo` channel). Before this,
  `bakedAo` was passed only by the carve, so every settled chunk shaded at
  `ao = 1.0` and nothing on it could be in shadow. Measured mean 0.84-0.99, min
  0.51 on a creased piece.
- **The key floor.** `0.15 + 0.85 * ndl` meant a surface facing directly away
  from the light still took 15% of it. Now `look.x`, default 0.04.
- **A gib's own fresnel.** Grazing angles dominate a small convex lump, so the
  body's value reads as an outline on a gib. fresGain 0.6 → 0.18, spec 1.2 → 0.9.
- **Gib bones are MESH tubes** (`gibBoneMesh`, `?gibbonemesh=0` opts out), and
  **`gibbones=core` is the default** — bones never bake, so each one held a
  marched view slot for life.

## STILL ABSENT FROM `chunkShade`, if you do go back to lighting

Backlit scatter (flesh is authored `translucency 0.45`) and wound shadow. Both
exist in the march. Neither is in the mesh path.

## INSTRUMENTS — use these, a screenshot cannot answer any of it

| call | answers |
| --- | --- |
| `__sdfGame.bakedAlbedoStats()` | the baked vertex colour AND its AO — mean/min/max/woundMask |
| `__sdfGame.chunkDetailApplied()` | what the MATERIALS hold, vs `chunkDetail` which is what was requested. Reading `[]` here is how the unregistered-material bug was caught |
| `__sdfGame.boneTubes()` | instance count + which paths feed them. From the chunk census, "drawn as tubes" and "silently vanished" are identical |
| `__sdfGame.chunkStates()` | per piece: `kind`, `render`, `settled` |
| `__sdfGame.freeze(true)` | **the one that made A/B possible.** A floor of recycling gore will not hold still; freeze it and the camera and pile stop moving between arms |

## TRAPS PAID FOR IN THIS SESSION

- **The dynamite panel's key table is not typechecked against the setter.** New
  rows compile clean and do nothing. `dynamite-panel.test.ts` is the real guard,
  and it checks two things — the setter case AND the `dynamiteTuning()`
  read-back. Adding three rows failed both, in turn.
- **No BACKTICKS inside a `wgslFn` source string** — it is a template literal.
  `tsc` catches it instantly (TS1005). Joins the known three wgslFn traps.
- **Toggling `setChunkBake` affects FUTURE settles only.** Pieces already baked
  stay baked until shot or recycled. Blow up a fresh body.
- **The in-app browser pane throttles `requestAnimationFrame` when hidden** — it
  reported 1030 ms/frame with zero gibs. No frame-time number from it is
  trustworthy, and the game tick stops during a long `javascript_tool` call.

## OTHER KNOWN, UNFIXED

- The carve library build is **~19.7 s at boot** (`?gibrender=carve` only; was
  3-5 s before the anatomical partition). Default `march` is unaffected.
- `CarvedPiece.offset` is always ~(0,0,0) — `computeBoundingSphere()` mutates the
  captured `Sphere` in place. No consumers, so it changes nothing today.
