# 2026-09-18 — flare in-game burning test

A deliberately minimal test harness shaped like a weapon: **slot 3 (flare)**
ignites the actor your shot hits, and a burning actor looks the same as it does
in the flame lab. No projectile, no damage, no stagger, no AI change — the
enemy keeps doing whatever it was doing, on fire. The real flare gun (projectile
that sticks, real burn damage, first-person animation) is a separate later pass.

## How to use it

```
npm run dev            # opens /sdf-game.html
```

- **`3`** raises the flare (same lower/raise machine as `1`/`2`). **Left click**
  traces the grapeshot slug's ballistic hit test *from the eye* and ignites the
  actor it names.
- **`__sdfGame.igniteAll()`** — set every live actor alight.
- **`__sdfGame.extinguishAll()`** — put them all out; the char stays.
- Read back state with **`__sdfGame.burning()`** (per-actor `burn`/`char`/
  `alight`/`dying`) and **`__sdfGame.flameCards()`** (`created`, `active`,
  `live` quads, `atlas`).
- The placeholder model is `public/assets/lab/flaregun-placeholder.glb`
  (gitignored; copied from `docs/dev-notes/refs/flaregun/flare_gun.glb`). If it
  is absent (a fresh clone) the game logs one warning and uses an orange
  cylinder + grip box instead — boot never depends on it.

## What the captures show

Run: `node scripts/flare-ingame-capture.mjs` → frames + `captures.json` in this
folder. All four are `?crowd=1` (the shipped crowd path) with a fixed seed and
the blood blur off.

| frame | what |
| --- | --- |
| `flare-00-cold.png` | boot + three debug bodies spawned; **no fire, no cards, no burn state** |
| `flare-10-one-burning.png` | one zombie ignited by `fireFlare()` at ~3.5 m |
| `flare-20-crowd-burning.png` | `igniteAll()` → 26 actors tracked/burning |
| `flare-30-extinguished.png` | `extinguishAll()` → 0 active, char still on the bodies |

The fire reads correctly in the real game: surface fire on the flesh, flame
cards wrapping the silhouette, charred skin and bone showing through, and the
body's own light picking up neighbours through the `bodyFlash` slot. At ~3–4 m a
standing body is engulfed; at point blank one body's cards fill the frame and
blow to white (expected — the cards have no screen-size cap).

### Compared with the lab

- **Same numbers.** The march shader, `BURN_TUNING`, the cards module and the
  light functions are the lab's, unchanged (`resolveBurnTuning(BURN_TUNING)`,
  `resolveTongueTuning()`, `burnLightIntensity`, `limbAnchors`).
- **The game reads hotter and darker.** The dungeon is near-black with a
  flashlight key, so the additive cards and the body fire light dominate more
  than on the lab's lit floor. With VHS on (the default) the bloom smears
  further. This is a lighting difference, not a different fire.
- **The cards are the PROCEDURAL fallback, not the FIRE01 atlas.**
  `public/assets/flame-placeholder/` (gitignored) is not linked into this
  worktree, so `setAtlas` never runs and the cards use their built-in
  domain-warped flame shader. The atlas path is wired (the same best-effort
  fetch/swap the lab does) and will light up wherever the atlas exists. The
  visible flat rectangular card edges are the known card-seam look the atlas is
  meant to soften; at 3–4 m they read as soft flame rectangles.
- **No burn-down on death.** The shipped game has no health, so an actor only
  leaves the world when it is gibbed — and a gibbed body has no body left to
  char down. `killBurning` is wired at `retireActor`, and `settle` is fed to the
  cards, but today the only reachable exit is release. The burn-down will
  matter for the real flare gun's damage pass.

## No-op contract (verified)

With slot 3 never selected and no `igniteAll`, the page behaves as before:

- `__sdfGame.flameCards()` at boot is `{created:false, active:0, live:0,
  atlas:false}` and `__sdfGame.burning()` is `[]` — read from the live page
  before anything is spawned or ignited (`flare-00-cold`).
- `stepBurning` returns on `burning.size === 0` before stepping or writing any
  uniform; the `directFlashes` fire-light block and `updateFlameCards` are both
  guarded by `burning.size > 0` / `flameCards !== null`; the cards object is
  created only inside `igniteActor`.
- The only always-on additions are the flare rig's three transform values in
  `stepWeaponSlots` (the rig is hidden whenever slot 3 is not live) and the
  placeholder GLB probe.

## Rough frame cost

Measured on a **frozen sim** (`__sdfGame.step(1, 0)`) at one fixed camera, 90
frames + `resolveGpu`, headless:

| run | cold | 1 burning | 26 burning |
| --- | --- | --- | --- |
| A | 25.3 ms | 26.7 ms | 26.6 ms |
| B | 28.2 ms | 31.5 ms | 31.3 ms |
| C | 45.8 ms | 43.1 ms | 45.9 ms |

Read this as **rough**: the machine had two other dispatch tasks running, and
the cold baseline alone drifted 25 → 46 ms between runs. Across the sane runs a
framed burning body costs roughly **+1.5 to +3.5 ms/frame**. Lighting all 26
bodies did **not** cost more than lighting the one in frame — 25 of them were
off-screen — so the cost tracks *visible fire pixels*, not burning-body count.
`captures.json` holds the last run (C), whose baseline is the noisy one.

## Files

- `src/lab/sdf-zombie/webgpu/game-weapon-slots.ts` (+ test) — `'flare'` slot,
  `Digit3`.
- `src/lab/sdf-zombie/webgpu/burn-registry.ts` (+ test) — lazy keyed
  `BurnState` bag: nothing allocated until an ignite, char kept until release.
- `src/lab/sdf-zombie/webgpu/flame-anchors.ts` — `headShape` / `limbAnchors`
  extracted from `flame-lab-main.ts` so the lab and the game share one rule.
- `src/lab/sdf-zombie/webgpu/game-main.ts` — the flare rig, `fireFlare`, the
  per-actor burn tick + uniform write, the `bodyFlash` fire light, the flame
  cards in `characterEffects.scene`, and the console seams.
- `scripts/flare-ingame-capture.mjs` — this capture, with the
  renderer-pipeline-error guard and a luma-flat frame guard.

## Notes / things to watch

- Card seeds are per-position in the `update()` bodies array, so releasing a
  burning actor can reshuffle another actor's cards. Harmless for a test
  harness; the real weapon should give each actor a stable card seed.
- The flare ray has no wall test (it reuses the slug march, which only tests
  actors), so it can ignite through a wall. The real weapon's projectile will
  collide properly.
- The flame-card pool is capped at 32 bodies; an `igniteAll()` over more bodies
  than that draws cards for the first 32 only.
