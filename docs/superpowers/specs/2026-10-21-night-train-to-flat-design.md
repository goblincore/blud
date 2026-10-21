# The Night Train hands over to the Flat (and the Flat's early clutter): design

**Date:** 2026-10-21 · **Status:** approved by the owner 2026-10-21 (section by section in chat), not built · **Branch:** `claude/night-train-to-flat` (stacked on `claude/flat-polish`, PR goblincore/blud#51) ·
**Parents:** [the egg emerges in the Flat](2026-10-16-emergence-in-the-flat-design.md) (built, on `main`: `?level=flat-early&emergence=1`) · [the Night Train egg ending](2026-09-30-night-train-egg-ending-design.md) (control room, egg, the `ending` sequence; the montage is plan 4, not built) · [the screen emergence draft](2026-10-01-flat-screen-emergence-design.md) §3.1 (two scenes in one page: **not** taken, see §1) · [the Flat's room in the engine](2026-10-11-flat-room-design.md).
**Owner (2026-10-21):** the seam is a **page hop behind a black card**, and the black card is a placeholder: it will later be replaced by a short rendered "movie" or a title card, so the bridge must be a replaceable slot. Hook the **current** ending (the two-shot stub), not the montage. The CRT shows the **player's real last frame**. The Flat's early stage grows by **clutter only** (no change to the Giger layer, no new rooms or doors).

## 1. Why

The emergence plays in the Flat on a debug flag. The game's own path into it is the Night Train: the player touches the egg in the control room, the pull plays, and today the level ends on a "LEVEL COMPLETE" overlay. This connects the two, so the scene the owner has been looking at is reached by playing, and gives the early Flat the lived-in look the moment needs.

Why a page hop and not one page holding two worlds (the 2026-10-01 draft's decision 9): the engine's level loader is boot-time only, and the SDF layer, light lists, collision and the shell all assume one level. A hop reuses everything built with no engine risk. Its costs are a visible pause (about 10 to 20 s with a warm shader cache; minutes on a cold one, which the bridge card covers) and that Night Train state is not carried across. Both are accepted for an ending. The bridge is a slot so the pause can become the owner's intended "movie" later without touching the rest.

## 2. What the owner will do

Play Night Train to the control room and touch the egg. The pull plays as now, then black with the title. After a held beat the page goes to the Flat; behind the black card it loads. The picture on the Flat's CRT is the frame the player was looking at when the pull ended. The view fades up from black into the emergence (the glass gives, the push, the egg out), then control returns at the cushion. The Flat's room now reads lived in: posters, plushies, manga, noodle cups, socks.

## 3. The design

### 3.1 The hand-over: `onComplete` and the bridge

| Unit | Does | Notes |
| --- | --- | --- |
| **Level JSON `onComplete`** (optional) | `{ goto: "<level id>", params?: "<query string, no leading ?>", bridge?: BridgeSpec }` beside `completeOn`. When the level's `completeOn` event fires and `onComplete` is present, the loop runs the bridge and then navigates, **instead of** showing the LEVEL COMPLETE overlay | Parsed and validated in `level-json.ts` (`top` keys, defaults: absent means today's behaviour); typed in `level-def.ts`. Night Train gets `{ goto: "flat-early", params: "emergence=1&from=night-train", bridge: { kind: "card", rgb: [0,0,0], text: "NIGHT TRAIN", holdS: 2.5 } }` from `build_night_train.py` |
| **`level-bridge.ts`** (pure) | `BridgeSpec` (a discriminated union; `card` now, `movie` later), `bridgeHoldS(spec)`, `targetUrl(goto, params, currentSearch)`: the Flat's URL, keeping the player's other query params (`res`, `graphics`, `upscale`...) and dropping the Night Train's own (`level`, `emergence`, `from`) before the owner's `params` are applied | Unit-tested: params carried over, level and emergence replaced, no duplicates, `from=night-train` present, a goto that is not a safe level id (`[a-z0-9-]+`) is refused |
| **Bridge runtime** (in `game-loop.ts`'s command runner) | On `complete` with an `onComplete`: release pointer lock, show the bridge card (full-screen element, black, the text), hold `holdS`, then `location.assign(targetUrl(...))`. No `onComplete`: unchanged | The card is the existing `ending` sequence's last overlay carried to a DOM element, so there is no flash between them. A `movie` kind is out of scope: the union is where it goes |

The `ending` sequence stub is unchanged (a 4 s pull, a 2 s black card). The bridge's card holds the same black and text, so the sequence's end and the bridge's start are one continuous black.

### 3.2 The CRT shows the player's real last frame

| Unit | Does | Notes |
| --- | --- | --- |
| **`crt-handoff.ts`** (pure, storage injected) | `saveCrtPicture(storage, dataUrl)` and `loadCrtPicture(storage)`: key `blud.crtPicture`, a PNG data URL, size-capped (refuse over about 1.5 MB), every access in `try/catch`; returns null when absent, malformed (not `data:image/png;base64,`) or the storage throws | Unit-tested with a fake storage (round trip, cap, throwing storage, malformed value) |
| **Capture** | At the end of the `ending` sequence's `pull` shot (its last frame, the egg filling the view) the game captures the canvas (the `presentedShot` path), downscales it to about 512 x 384 (4:3, the CRT's picture) on a 2D canvas, and saves it. Failure (blank, quota) is swallowed: the Flat falls back | The capture is a hook on the sequence runtime at a named shot end (`pull`), not a level command |
| **Use** | `game-emergence.ts` takes the picture from `loadCrtPicture(sessionStorage)` when `from=night-train` and one is stored; the committed still (`/assets/lab/screen-source.png`) otherwise. The stored picture is then removed | The picture reaches the pass as a texture from a data URL, as the still does from its URL |

Risk, resolved by the plan's first boot: `toDataURL` on a WebGPU canvas can return a blank image outside the frame it was presented in. If so the capture reads the output render target back (`readRenderTargetPixelsAsync`, the path `game-deferred-renderer.ts` and the seams already use) and encodes that.

### 3.3 The Flat side of the arrival

`from=night-train` implies the emergence (as `emergence=1`) and starts it at once when the level is ready (the autostart delay, `AUTOSTART_S` 2 s, becomes 0.5 s for this entry: the player just waited through the bridge). The `emergence` sequence's first shot opens with a black overlay fading out over 0.8 s, so the black card hands over to the room. A direct `?level=flat-early&emergence=1` load behaves as it does today.

### 3.4 The early Flat's clutter

Clutter only, the early stage only (`FLAT_STAGE=early`; the late `flat` is untouched). A new Blender module, `scripts/levels/flat/clutter.py`, adds, from `flat_layout.py` placements:

| Group | Content |
| --- | --- |
| Walls | Posters (flat quads with simple procedural prints: a band, a cartoon, a map), a manga wall (a shelf grid of spines, cheap procedural colours) |
| Floor and low furniture | Plushies (a few smooth-blobbed animals), manga stacks, noodle cups and cans, socks, gashapon capsules, a tangle of cables (the cute stuff, beside the room's stone bones and Giger services) |
| Desk and kotatsu | Cans and a cup beside the keyboard, away from the egg's landing and the goo's footprint (`emergence-field.ts` keyboard and slick) |

Rules: merged into a few meshes per material (the draw count stays near today's); **small floor clutter has no collider**; nothing stands inside the five shot cameras' view corridors or on the hand-off spot (the clearance is a **test**, below); no clutter on the kotatsu's top inside the CRT, keyboard and lamp footprint. The art for `flat-early` is rebuilt (`FLAT_STAGE=early blender --background --factory-startup --python scripts/levels/build_the_flat.py`, then the export); the file size is no concern (owner). After it, one frame-cost read on the Flat with `scripts/flat-frame-cost.mjs`, recorded in the notes, not gated.

## 4. Verification (light: one headless Chrome at a time, 320 x 240)

- **Pure units:** `level-bridge.ts` (URL building, safe ids, the spec union); `crt-handoff.ts` (fake storage); the level JSON parse of `onComplete` (valid, absent = today, a bad `goto` refused) and `level-json.night-train.test.ts` (the Night Train's `onComplete` and bridge); `level-json.flat-early.test.ts` (still parses, lights within the cap) and the cameras' clearance (`emergence-camera.test.ts`): the five eyes and the hand-off spot stay clear of the clutter's footprints (the layout data, not the art).
- **One headless boot, the Train side** (`scripts/night-train-to-flat-check.mjs`, own ports): boot `?level=night-train`, teleport to the egg's trigger ring through the seams, let the `ending` run, with `location.assign` replaced by a recorder; assert the stored picture is a PNG data URL of the right size and not blank (pixel variance), the bridge card showed, and the recorded URL is the Flat's with `emergence=1&from=night-train` and the carried params. No Flat boot in this script.
- **One headless boot, the Flat side:** `npm run flat-emergence:check` extended with a second leg that seeds `sessionStorage` with a known picture and boots `?level=flat-early&from=night-train&res=320`: assert the emergence autostarts, the CRT's picture is the seeded one (a sampled pixel of the pass's picture texture), the opening fade runs, and the existing assertions hold. The sheet gets one frame of the clutter (a settle shot).
- **The owner is the judge of the look and the pause.**

## 5. Out of scope

The bridge's real content (the rendered movie or the title card; the slot and the card kind are built), the montage (plan 4) and the exterior train, an in-page level swap or two scenes in one page, carrying player state (inventory, health) across, the Giger layer's early-stage variant, usable rooms (an openable front door, the bathroom), the later stages of the Flat, live render-to-texture for the CRT, sound.

## 6. Risks

- **The capture is blank.** WebGPU canvas capture timing; the readback fallback is specified (§3.2) and the check asserts non-blank.
- **The pause on a cold shader cache.** Minutes, behind a card with only a title. Acceptable for now; the movie is the intended fix. The Flat's pipelines are mostly shared with the Night Train's, so a player who got through the Night Train has most of them cached.
- **Clutter blocks a camera or the goo.** The clearance test pins the cameras and the hand-off; the keyboard and slick footprints are excluded from the desk placement by data.
- **`location.assign` is not testable headless without a stub.** The Train-side check replaces it with a recorder; the real navigation is the owner's look.
- **Stacked on #51.** `game-emergence.ts` is edited by both; merge #51 first, or rebase this onto `main` after.
