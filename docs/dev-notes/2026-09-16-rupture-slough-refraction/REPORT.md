# Rupture slough + optical blast wave — Task 2 native-vision review

2026-09-16 rupture/slough/refraction, **Task 2** (visual acceptance and tuning).
Inherits Task 1 (`f41644ff`, branch `codex/rupture-slough-refraction-task-2`),
which itself sits on the owner-rejected `f3526b2c`. Node **v22.22.1**, Chrome
**152.0.7977.84** (headless, WebGPU; no `--no-sandbox`, no watchdog disablement,
no `--enable-unsafe-webgpu` needed — `navigator.gpu` reported an adapter on a
plain headless boot). One GPU run owned at a time; the user's browsers and the
servers on 5391/5392/5415 were never touched.

This note records **what was directly observed in images and normal-speed
clips**, what was measured, and what remains subjective. **No owner acceptance
is claimed.** The two owner complaints Task 1 answered are re-checked by eye
here, not by telemetry alone.

## 0. Native-vision probe (done first)

Before any image was trusted, the `read_image` path was proven with an
unguessable token rendered into a throwaway PNG
(`.lab-tmp/vision-probe/probe.png`, token generated with `openssl rand -hex 6`
and not printed before the read). The token read back (`e9a4cad33d77`) matched
the file byte-for-byte. All image observations below are native-vision reads of
the committed/attached PNGs, not numeric-diff inferences.

## 1. The rig and why the A/B is trustworthy

`scripts/sdf-rupture-look.mjs` (new, committed) drives the game page over CDP:

- boots `/sdf-game.html?room=arena&frozen=1&seed=7&vhs=off`, waits for
  `gunReady`, the room probes and `__warmDone`;
- picks the nearest arena zombie, places the camera on a body-relative bearing
  at a requested 3–6 m standoff, aims at the chest;
- hides the held view model (`setViewModelVisible(false)`, new capture seam —
  the player's arm otherwise covers the body's whole right half);
- detonates the **real** blast (`__sdfGame.detonate`) and steps **one 1/60 s
  frame at a time** with the render loop stopped, reading
  `presentedShot()` (the canvas) each frame — not `Page.captureScreenshot`,
  which is stale between hand-stepped frames;
- writes one PNG per frame plus per-frame telemetry (tear age, rupture
  displacement, live/baked pieces, the resolved refraction slot, camera);
- optional `RUPTURE_SETTLE=N` fast-steps the world and shoots the rest from
  floor height.

Every A/B leg is a **separate boot with the same seed and the same step
sequence**. That is only a comparison if two identical boots are identical, so
two 6 m no-effect boots were captured and diffed frame by frame: **mean absolute
difference ≤ 0.08 / 255, and 0.00 % of pixels differ by more than 12 levels on
every sampled frame** (see `captures/capture-metrics.json`,
`determinism_6m_off_vs_off2`). The A/B numbers below are therefore the effect,
not run-to-run noise.

Frames are assembled into normal-speed (60 fps) H.264 clips and labelled contact
sheets by `scripts/rupture-sheet.py` (new, committed).

## 2. SLOUGH — does the flesh stretch/slough off instead of the chest rising into the head?

**Directly observed** (`captures/slough-rigid-ab-3m-front.jpg`, tight head/torso
crop, `slough` row vs `?tearslough=0` row, same seed/camera/frame):

- **Slough (default).** From ~67 ms the torso flesh is drawn **outward from the
  blast and downward** into stretched strands; the pale **ribcage is exposed
  through the opened flesh** by f004–f006 and stays visible through release
  (f012). The arms and legs split at their own seams. The **head remains a
  distinct piece above the opened chest with a visible neck gap** across the
  whole window — it is not enveloped. At release the pieces keep the stretched
  shapes they were just drawn with (see §4).
- **Rigid control (`?tearslough=0`).** The body stays a closed, bloodied mass
  through f012: no ribcage exposure, no strand/stretch read, arms stay attached.
  This is the honest "before" arm and it is visibly the old exploded-assembly
  read.

These are two different silhouettes, not an amplified label. Over the tear
window (3 m, front) **up to ~10 % of body-crop pixels change by > 12 levels**
between the two arms (mean |Δ| ≈ 6.6), and the whole-frame difference is 3.5–4.4 %
of pixels > 12 at f013. The same read holds from **three-quarter**
(`slough-threequarter-3m-normal.mp4`), from the **side with the blast pushed
0.35 m off the body's centreline** (`slough-offcenter-3m-normal.mp4` — the bend
is visibly asymmetric, piece launch is one-sided), and with an **elevated blast**
0.9 m above the chest (`blast-elevated-3q-4m.jpg`, weaker but coherent: peak
region displacement 0.088 m vs 0.171 m for the chest blast).

The anatomy-only leg (all fire/smoke/ring layers killed via
`setExplosionFxTuning({gain:0, smokeOpacity:0, ringOpacity:0})`) is
`captures/slough-anatomy-3m.jpg`: with no fireball the stretched strands, the
exposed ribcage and the hanging flesh are unmistakable, and the head is clearly
a separate piece. This is the "what does the flesh itself do" frame the owner
could not get through the fireball.

## 3. REFRACTION — is `?blastdistort=1` visibly different from off at normal speed?

**Directly observed** (`captures/refraction-off-on-3m.jpg` and
`refraction-off-on-6m.jpg`: matched OFF/ON frames at 3 m and 6 m):

- At **3 m**, ON visibly lenses the scene around the blast: the wall/floor seam
  behind the body bows, the tiled floor pattern is pulled around the band, and
  the body itself sits inside a readable bulge. OFF shows a straight background
  with only the explosion's own drawn ring. The columns are the same frame index,
  so this is the effect and not a timing shift.
- At **6 m**, the band is smaller on screen but still clearly readable: the
  floor tiles and the right-hand wall are displaced in ON relative to OFF at
  f013–f029, exactly where the growing shell crosses them.

**Measured, matched boots** (`captures/capture-metrics.json`):

| pair | peak frame | meanAbs | % pixels > 12 | maxAbs |
| --- | --- | --- | --- | --- |
| on vs off, 3 m front | f009 | 10.30 | **20.8 %** | 203 |
| on vs off, 6 m front | f013 | 3.53 | **6.6 %** | 229 |
| off vs off (noise floor) | any | ≤ 0.08 | **0.0 %** | ≤ 9 |

**Where the change is** (`captures/refraction-band-diff-6m.jpg`, |ON−OFF|×8):
the difference is a **ring centred on the blast that expands outward** and
vanishes exactly at f033 — the band's `lifeSec` 0.55 s — while the fireball
(`fxlife` 1.15 s) is still active and the frames are otherwise identical. That
is the signature of the post-pass shell, not of the fireball and not of noise.

**Outside the opaque fireball.** The fireball's rendered half-height is
0.827 m; the band is born at 1.25× that (1.03 m) and grows ~3×, and the waveform
peaks at half the band radius. From ~f004 (≈50 ms) the displacement peak sits at
or beyond the fireball's rendered radius and keeps moving outward while the
band is still at 0.016–0.026 UV (≈10–16 px at 800×600). The clip
`refraction-on-6m-normal.mp4` against `refraction-off-6m-normal.mp4` shows the
bend on background, not just on fireball pixels.

**Camera motion / reprojection.** A rig-side seam (`__sdfGame.blastDistortInfo`,
see §5) reads the actual `u,v,radiusUv,strength` resolved for the last blit each
frame. Against `screenPosOf(blast)`:

- 6 m **fixed-yaw lateral drift** (`refraction-drift-6m-normal.mp4`): the camera
  translates 0.62 m during the wave, the blast's projected `u` moves 0.5017 →
  0.5548, and the slot tracks it **exactly** (max |Δu| = 0.000000).
- **Elevated camera** (`refraction-elevated-anatomy-4m.jpg`): the camera holds
  3.40 m (the first version fell under gravity; the rig now re-places it every
  frame) and the slot tracks the projection to 1e-6.

So the band stays on the blast while the camera moves; it is not pinned to
screen centre.

**Anatomy-only refraction** (`refraction-anatomy-6m.jpg`,
`refraction-anatomy-6m-normal.mp4`): with the fireball hidden the band is the
only moving effect and reads as a broad bulge over the floor and walls, not a
drawn circle.

## 4. Head, split limbs, release hand-off and floor contact

- **Textured head in flight** (`head-flight-textured.png`,
  `head-baked-textured.png`): the head piece is followed with the face view from
  `scripts/sdf-gib-head-look.mjs`. It releases among 14 named pieces
  (`head`, `bone.cage`, `torso.chest/abdomen/pelvis`, `organ.gut`, split
  `armL/armR/legL/legR .upper/.lower`), flies up from y 1.85 → 3.01 m, and
  `chunkStats().faceBaked` is 1 with the baked head piece carrying `face: true`
  — the painted-face material is on the released head, not a bare skull. The
  face itself is faint because the head texture is bloodied (a pre-existing
  limitation, §7).
- **Release hand-off** (`release-handoff-3m.jpg`, slough/rigid/anatomy rows
  f012→f013→f014): the region geometry drawn on the last tear frame is what
  spawns — the slough chest piece keeps its stretched, rib-exposing shape rather
  than snapping back to the clean pose. No visible pop.
- **Floor contact** (`pieces-rest-on-floor.png`): after `step(360)` the piece
  census reports **14/14 settled** and the close floor view shows the pieces
  lying on the slab with their blood decals. (The Task-3 grounded-rest fix is
  preserved.)

## 5. Source changes in Task 2

No rupture or refraction **tuning values** were changed. The diagnosis above
shows both effects already meet the visual bar, so changing parameters would
have been churn without a defect to fix. The only source changes are two
read-only capture seams:

| File | Change | Why |
| --- | --- | --- |
| `webgpu/post-aa.ts`, `webgpu/game-main.ts` | `blastDistortSlots` getter + `__sdfGame.blastDistortInfo()` | the resolved per-frame `u,v,radius,strength` (and a `reason` when dropped) actually pushed to the shader; this is the only way to prove centring/reprojection rather than infer it. Read-only; no uniform, node or pipeline change. Pinned by three new `post-aa.test.ts` cases. |
| `webgpu/game-main.ts` | `setViewModelVisible(on)` | the held arm covers the body being reviewed; the rig lives under the camera, so `setRegisteredObjectsVisible` cannot reach it. Capture-only, default unchanged. |

New tooling: `scripts/sdf-rupture-look.mjs`, `scripts/rupture-sheet.py`.

## 6. Verification run

```
node --version                                        -> v22.22.1
npx tsc --noEmit                                      -> exit 0
npx vitest run blast-refraction gib-tear gib-parts gib-rupture post-aa
                                                      -> 5 files, 127 tests passed
npm run build                                         -> tsc clean + vite built in 3.92 s
```

Focused command:
`npx vitest run src/lab/sdf-zombie/blast-refraction.test.ts
src/lab/sdf-zombie/gib-tear.test.ts src/lab/sdf-zombie/gib-parts.test.ts
src/lab/sdf-zombie/gib-rupture.test.ts src/lab/sdf-zombie/webgpu/post-aa.test.ts`.

The full sdf-zombie suite was **not** run this task: the repo's own warning is
that the full suite on this 24 GB machine can OOM while another dispatch task is
live, and panel/bench code was untouched. The focused set covers every module
Task 1 changed plus the two files touched here.

## 7. Honest limits / what remains subjective

- **A model looking at PNGs is not a playtest.** Everything here is
  frame-inspection and 60 fps clips; the owner's eye at the keyboard is the only
  acceptance that counts.
- **The head face is still bloodied** at the crown/back; the face material is
  present and `faceBaked` is 1, but the painted features are faint on the
  released head. Unchanged from Task 1.
- **The refraction is still not depth-gated**: a wall between camera and blast
  would still be warped. Documented in `post-aa.ts`; a depth-gated version is a
  renderer change, not this bounded experiment.
- **The refraction experiment remains DEFAULT OFF.** It is left togglable so the
  owner can A/B in one boot without a build; this task does not flip the default.
- **The explosion's own drawn shock ring is large and bright** and visually
  competes with the post-pass band at close range. The ring is a separate VFX
  layer and was not touched; if the owner wants the post-pass band to be the
  only shock read, the ring opacity is the knob, and that is a taste call.
- **One seed, one target geometry, one room, 800×600.** The A/B and the head
  flight are deterministic under `?seed=7`; other seeds/body builds were not
  swept.
- **Wounds still ride their region rigidly** rather than the local slough
  (Task-1 note); not re-checked here beyond the frames.
- **VHS-on combos** are not in the committed A/B (the review legs run `?vhs=off`
  so the warp is not mixed with chroma smear). The default game has VHS on; the
  refraction's interaction with VHS is unverified.

## 8. Playtest flags for the owner

Default boot (`npm run dev` / `/sdf-game.html`) = slough ON, refraction OFF:

| To see | Flags |
| --- | --- |
| Shipped candidate | *(none)* |
| Optical blast wave | `?blastdistort=1` (`&bdstrength=0.5..4` scales it) |
| Slough A/B (rigid control) | `?tearslough=0` |
| Both | `?blastdistort=1` with/without `?tearslough=0` |
| Hidden fireball (anatomy only) | `?fxgain=0&fxsmoke=0` + `?blastdistort=1` |

## 9. Evidence index (`captures/`)

Clips (60 fps, normal speed, real detonation, default mesh skeleton):
`slough-front-3m-normal.mp4`, `rigid-front-3m-normal.mp4`,
`slough-anatomy-3m-normal.mp4`, `slough-threequarter-3m-normal.mp4`,
`slough-offcenter-3m-normal.mp4`, `refraction-off-6m-normal.mp4`,
`refraction-on-6m-normal.mp4`, `refraction-anatomy-6m-normal.mp4`,
`refraction-drift-6m-normal.mp4`, `refraction-elevated-anatomy-4m-normal.mp4`.

Stills / sheets: `slough-rigid-ab-3m-front.jpg`, `slough-anatomy-3m.jpg`,
`slough-threequarter-3m.jpg`, `slough-offcenter-3m.jpg`,
`blast-elevated-3q-4m.jpg`, `release-handoff-3m.jpg`,
`refraction-off-on-3m.jpg`, `refraction-off-on-6m.jpg`,
`refraction-band-diff-6m.jpg`, `refraction-anatomy-6m.jpg`,
`refraction-elevated-anatomy-4m.jpg`, `head-flight-textured.png`,
`head-baked-textured.png`, `pieces-rest-on-floor.png`,
`head-telemetry.json`, `capture-metrics.json`.
