# The axe, part A: capture gate and look notes (2026-10-04)

Plan: `docs/superpowers/plans/2026-10-04-axe-part-a.md`, Task 7. Spec:
`docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md`.

The gate is `scripts/axe-gate.mjs`. It runs on the bare ring page (`/sdf-game.html?seed=1&vhs=off&loader=0`) with
frozen zombies in headless WebGPU, and uses seams in place of pointer lock. Its photos are in `gate/`, and the look
loop's before and after photos are in `look/`.

```bash
bash -c 'export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/axe-gate.mjs 5241 9241'
# the swing as film strips (opt-in, not part of the gate):
#   ... ONLY=F OUT=<dir> node scripts/axe-gate.mjs 5241 9241
```

**What it does not exercise.** The real pointer-lock mousedown is not exercised: headless Chrome cannot take pointer
lock. S uses the `axeSwing` seam, which sets the harness's click on the next tick, as a mousedown would. That path still
goes through the armed gate: live slot, `slotReady`, `!loopBlocksInput`.

## Check list (final run, after the light fix)

```
24 checks, 0 failed
PASS: A: an overhead chop stamps one cut (1 hits, 1 cuts)
PASS: A: the overhead's cut runs vertically (|dir.y| 0.99 > 0.8)
PASS: A: the luma profile dips across the slot between two brighter shoulders: darkest interior 22 vs shoulders 51.3 / 159.3 (dip 29.3 >= 8)
PASS: A: the slot's walls are darker than the skin they replaced (59.3 -> darker half 43.2; full mean 80.3)
PASS: D: the diagonal chop's cut is diagonal (|dir.y| 0.67 in 0.4..0.9)
PASS: K: the fresh zombie is standing (standing)
PASS: K: head chop 1 (H) lands as a head chop and is counted (1 hits, heads [15], count 1)
PASS: K: alive after head chop 1 (thawed 3 frames: phase standing)
PASS: K: head chop 2 (R) lands as a head chop and is counted (1 hits, heads [15], count 2)
PASS: K: alive after head chop 2 (thawed 3 frames: phase standing)
PASS: K: head chop 3 (L) lands as a head chop and is counted (1 hits, heads [15], count 3)
PASS: K: head chop 3 kills (thawed 3 frames: phase standing -> falling)
PASS: K: the corpse keeps its head cuts ([{"region":"axe-1","limb":"head","half":0.09},{"region":"axe-2","limb":"head","half":0.09},{"region":"axe-3","limb":"head","half":0.09}])
PASS: K: 45 frames on (phase falling) the corpse still has 3 head cuts
PASS: S: slot 7 selectable ({"ok":true,"live":"shotgun","target":"axe","phase":"lowering"})
PASS: S: the axe is drawn and on screen at rest ({"visible":true,"haftPx":[[1010,880],[860,260]]})
PASS: S: a click swings and the strike lands on the zombie in front ({"side":"H","hits":[16],"heads":[],"points":[[29.63,1.21,-9.48]]})
PASS: S: the swing's chop cuts the zombie (1 cuts)
PASS: C: 3 chops stamped (3)
PASS: T: the body is turned (yaw -81.2 deg, |sin| 0.99 >= 0.97)
PASS: T: one cut on the turned body (1 hits, 1 cuts)
PASS: T: the cut lands on the struck point (midpoint 0.00 cm from the hit <= 5 cm)
PASS: T: the overhead's cut runs vertically on the turned body too (|dir.y| 0.99 > 0.8)
PASS: zero console errors or exceptions (0)
```

The gate ran three times: before the light fix, after it, and the final run. All three gave 24/24, with identical
numbers apart from the axe's own lighting.

### How the checks were built

- **Seams added.**
  - `actorWounds` (`game-seams-world.ts`) now returns each cut's world direction `dirWorld`, computed with
    `woundDirToWorld` at the live yaw, and its `headRegion`.
  - `__sdfGame.axe()` now returns `last.points` (each hit's world point) and `rig` (the drawn axe's world grip, haft top,
    head and hand, plus `visible`). The rig points are read only by the gate, never per frame.
- **A** is cut-wound-gate's K, adapted:
  - The across direction is `dirWorld × view`, rather than the view's right vector.
  - The dip is measured against the DARKER shoulder.
  - "Walls darker than the skin" uses the slot's darker half, because the centre of an axe slot shows pale sternum.
- **K: the kill on frozen zombies (amendment 1).** The gate's zombies are frozen (`__sdfGame.freeze(true)`, i.e.
  `ctx.demo.wanderFrozen`), and `forceCollapseNext` is consumed only in the actor's `step()`. So a frozen actor's phase
  can never change, and both "alive" and "killed" would be vacuous.
  - K does what head-burst-gate's A does: after every chop it calls `freeze(false)`, steps 3 frames, reads the phase,
    then calls `freeze(true)`. `freeze` is ring-wide, so all the frozen zombies move for those 3 frames. This happens
    after A's and D's photos, and every later scenario re-reads its zombie's position.
  - Both checks are real: chops 1 and 2 thaw and stay `standing`; chop 3 thaws to `falling`. The phase names are
    collapse.ts `CollapsePhase` (`standing` → `falling` → `settled`), read through `actorList().phase`.
  - 45 thawed frames later the corpse is still `falling` and still has its 3 head cuts.
  - Every head chop is re-framed first, because the thaw lets the body sway.
- **T** is cut-wound-gate's T staging. It boots again, walks the ring until an unused standing zombie has
  |sin yaw| ≥ 0.97, then freezes. It runs LAST, so the other scenarios keep the first boot's unwalked ring.
  - **What T can and cannot see.** The cut's midpoint, read back through `woundWorldPos` at the live yaw, coincides
    with the strike's hit point (0.00 cm). The cut is centred on the hit, so this proves the stamp and the read-back
    agree on a turned body. It does not prove the hit is on the crosshair; the photo shows that (the gash is at the
    screen centre).
- **S** also measures the drawn axe's lighting at rest and at the strike frame: frame 20 after the click, where H's
  strikeT is 0.32 s.
- **F** (opt-in) photographs every 3rd frame of the H → R → L combo into film strips. A red bar marks the strike frame.

## What each image shows (final run)

- `gate/A-before.png`, `A-after.png` (+ `-crop`): the chest at 0.9 m, with the shotgun in view (the axe is not the
  live slot in A).
  - After: an 18 cm vertical gash down the sternum, centred on the crosshair (the midpoint is 7 px off). It has dark
    walls, an orange-lit left lip and a pale strip of sternum bone along its middle.
  - It reads as a deep chop, not a slit. The right lip is on the torch-lit side of the chest, so it is the bright
    shoulder.
- `gate/D-after.png` (+ `-crop`): a diagonal gash across the chest from upper right to lower left, through the
  crosshair, with a pale patch of bone at its centre. It is dimmer than A: the chest's left side is in shadow.
- `gate/K-0.png` … `K-3.png`: a head at 0.7 m. The face is mostly in shadow, which hurts these photos.
  - K-1: the overhead chop shows as a pale strip from the brow down the nose bridge, plus pale spots at the mouth
    (teeth or jaw). It is subtle, because it falls on the dark face.
  - K-2: a second, diagonal gash across the forehead, pale and fleshy, joins the first.
  - K-3: the zombie is falling and twisting away, its face torn with red.
  - None of these is the head split (part B). These are cuts only, as part A specifies.
- `gate/S-rest.png`: the axe is live (HUD `[7 AXE (click to chop)]`) and at rest.
  - A brown wooden haft rises from the bottom-right edge to about shoulder height. The steel head is a grey slab to the
    left of the haft's top, its long side along the haft, seen from slightly behind.
  - It reads as a long axe held upright, though the head is a plain rectangle and looks a little like a cleaver.
  - **The fist is below the frame** (the grip projects to y 880 of 800), so no hand is visible at rest.
- `gate/S-strike.png` (the strike frame):
  - The green goblin fist and the leather spiked bracer sit low centre-right. The haft runs from the top of the fist
    up toward the fresh gash. The axe head is seen end-on, as a thin dark stub just under the gash.
  - **At this frame it does not read as an axe:** it reads as a fist holding a stick.
  - The fist's grip tunnel (the dark hole) faces the camera, empty: the haft enters the fist from its top, not through
    the tunnel. See look idea 1.
  - The gash is 4.6 px from the crosshair.
- `gate/S-after.png`: back at rest, with the vertical gash on the chest.
- `gate/T-before.png`, `T-after.png` (+ crop): the turned zombie (yaw −81°) seen from its front. After: a vertical
  gash at the crosshair, with orange-lit walls and bone inside, just like A.
- `gate/C-3chops.png`: three chops (H, R, L) at the same aim point form a six-armed star with a pale crater at its
  centre, where the three slots cross. It reads more like a burst than three chops. See look idea 5.
- `look/swing-H-strip.png`, `swing-R-strip.png`, `swing-L-strip.png` (after the light fix):
  - **H:** the haft rises out of the top-right of the frame, then the fist comes in from the upper right with the
    haft pointing up. At the strike the fist is low centre with the head end-on. The follow-through takes the whole
    axe below the frame for several frames (about 0.15–0.2 s), then it returns from the bottom.
  - **R:** the wind-up leaves the frame to the right. Just before and at the strike, the axe crosses the chest
    diagonally with the head **in profile**: this is the best "axe" read in the combo. The follow-through exits lower
    left.
  - **L:** the wind-up passes the fist and bracer very close to the camera across the top centre, covering about a
    quarter of the frame, the zombie's head included, for a few frames. Earlier in that wind-up, the steel head
    flashes white for a frame (a specular highlight, probably the env map's; not measured). At the strike, the head is small and up-right of the fist.

## A profile numbers

Across the overhead cut at its midpoint, px (641, 393). The kerf is 19 px, and each sample is averaged ±23 px along the
cut:

```
{"kerfPx":19,"interiorMin":22,"interiorMean":80.3,"interiorWalls":43.2,"lipLMax":51.3,"lipRMax":159.3,
 "beforeCentre":59.3,"dip":29.3,"halfLen":0.09,"kerf":0.015,"dirWorld":[0,-0.991,0.131],"offHit":0,"offCrosshairPx":7}
```

- The dip is 29.3 below the darker shoulder; the threshold is 8, which was cut-wound-gate K's minimum.
- The slot's centre is bright (luma ~120–129 at |t| ≤ 6 px): that is exposed sternum. Its walls are dark (22–41).
- Before the chop, the same line read 47–69 in the middle. The profile rises steadily to the right in both photos,
  because the torch's pool lies on the chest's right side.

## C: cost numbers (ungated)

These are `timeDraws(120)` at 0.9 m, with the axe live, before and after 3 chops on one torso:

| run | before (two reads) | after 3 chops (two reads) |
| --- | --- | --- |
| 1 | 14.5 / 19.5 | 24.5 / 24.2 |
| 2 | 14.3 / 20.1 | 24.4 / 24.2 |
| 3 (final) | 14.7 / 19.9 | 24.6 / 24.2 |

- **The first baseline read is low.** It is about 5 ms below the second in every run. That is systematic, not noise,
  and its cause was not investigated.
- Against the second read, three chops add about **+4.3 ms**; against the first, +9.9 ms.
- For comparison, cut-wound-gate's C (3 rod cuts at 0.6 m) measured +1 to +5 ms.
- The axe's cuts are deeper (depth 0.10 vs 0.06), and the three cross at one point (the star).

## The look loop: one change, the lighting (amendment 2)

### Before: measured first

Forward mode (`renderMode` `legacy`), the torch on. The method is the flail gate's:

- **Haft:** the brightest pixel within ±4 px across the grip → top line at 56 steps.
- **Head and fist:** discs of 0.04 m projected around the head's centre and the grip.
- **Clipped** means any channel ≥ 250.

| | haft clipped | haft mean luma | head disc clipped / luma | fist disc clipped / luma |
| --- | --- | --- | --- | --- |
| rest, before | **92%** | **250.1** | 19.4% / 122.7 | (fist off-screen) |
| strike, before | 8.9% | 150.6 | 29% / 152.6 | **31%** / 163.1 |
| rest, after | 0% | 60.6 | 0% / 85.2 | (fist off-screen) |
| strike, after | 0% | 82.5 | 26.4% / 128.3 | 0% / 110.7 |

- At rest the brown haft rendered pure white, as the flail's had (84% there). That is a clear defect.
- **The strike frame's head disc** is still 26% clipped after the fix. That is the torch-lit chest skin around the
  end-on head: the 36 px disc is mostly zombie. The head itself is the dark stub. The fist's spiked bracer was the
  blown-out part of the hand (white before, leather brown after).

### Photos

- `look/1-light-before-rest.png` → `look/1-light-after-rest.png`, and the crop pair
  `look/1-light-rest-crop-before-after.png`.
- `look/1-light-before-strike.png` → `look/1-light-after-strike.png`, and the 2× crop pair
  `look/1-light-strike-crop-before-after.png`.

### The change: the flail's own light list, extracted

The flail's OWN LIGHT LIST moved out of `game-flail.ts` into **`src/lab/sdf-zombie/webgpu/viewmodel-lights.ts`**:

- `createViewmodelLights(ctx, { name, fillScale })` → `{ list, track, ownLights, relist, syncFill }`.
- **The flail** uses it unchanged: `flail-flash-fill`, `FLAIL_LOOK.flashFill` 0.018. Its blood clones call `track()`,
  and its `syncFill` still sets the wet-glint uniform from the returned "torch lit" flag.
- **The axe** creates its own (`axe-flash-fill`, `AXE_LOOK.flashFill` 0.018). It calls `ownLights` on the rig, and on
  the goblin hand when the hand loads.
- **game-main** now also calls `ctx.weapon.axe?.syncFill()` right after the flail's, after `flashlight.update(camera)`,
  and `ctx.weapon.axe?.refreshLights()` right after the flail's, when the muzzle flash is added.
- Both fills sit on layer 30 (`FLAIL_FILL_LAYER`, whose comment now names both weapons) with `onlyRooms` empty. Each
  weapon's list skips the other weapon's fill: the layer test excludes it. The level's lists skip both, via
  `onlyRooms` (game-lighting-leaves `levelSceneLights`).

### Verification

- `npx vitest run flail game-axe`: 312/312 before and after.
- `npx vitest run game-context-coverage` passes; `npx tsc --noEmit` reports only the `node:crypto` error.
- **The flail is unchanged.** The flail gate's rest measure, on warm boots, read ball 67.3 / haft 57.2 mean luma (0%
  clipped) both on the pre-extraction `game-flail.ts` (temporarily restored, then put back) and after the extraction.
  The two `rest.png` differ by at most 1 level on 6157 px.
  - A full flail-gate run after the extraction printed `GATE PASSED` (47 PASS).
  - **Caveat:** that gate does not wait for the warm gate. On the first boot after a source change it twice shot a
    black, unlit room (luma 23.8 everywhere), so only warm boots compare.
  - It also writes `docs/dev-notes/2026-09-28-head-damage/flesh/*.png` whatever `OUT` says. Those were restored.
- `node scripts/compile-census.mjs 2` (output in a scratch dir, not the tracked census.json): both boots reached
  `phase=ready`, `uncapturedCount 0`, no device loss.
  - warmMs 5092 / 2485, drawOnce 1726 / 1698.
  - March family: 25 entries, 12 modules, unchanged in shape.
  - The census page never selects slot 7, and the axe rig is hidden until it is live, so the axe's materials compile
    on the first switch to the axe, as they did before.
- **No WGSL changed.** The node materials are three's: no golden, march-hash or boot pair.

No other pose or `AXE_LOOK` change was made: see the ideas below.

## Kerf and reach (amendments 3 and 4)

- **Reach.** `resolveStrike` has no reach parameter, so the axe uses `FLAIL_STRIKE.reach`: 1.8 m, horizontal, eye to
  torso centre. That is accepted for part A, and recorded in the spec's "As built" section.
- **Kerf.** `AXE_CALIBRE.kerf` is 0.015, not the spec's 0.022 (Task 2 follow-up `f932a4b6`).
  - At 0.022 the measured Lipschitz bound in `cut-wound.test.ts` was 2.63, over its 2.2 limit, and a slash across a
    thin arm opened the arm's back. 0.02 and 0.018 failed too.
  - A wider axe gash needs the carve's shape changed (cut-wound.ts), not just a bigger number.

## Look ideas for the owner (not applied)

1. **The fist's grip at the strike.** The goblin arm's IK (`aimArm`) aims the forearm at the shoulder. The fist's tunnel
   runs across the forearm, so it lines up with the haft only when the haft is roughly perpendicular to the forearm,
   as in a real hammer grip.
   - At the strike keys the haft points forward along the view, nearly back along the forearm line. Haft vs
     fist → shoulder angle (pure math on the keys):

     | key | rest | H wind | H strike | H follow | R wind | R strike | L wind | L strike |
     | --- | --- | --- | --- | --- | --- | --- | --- | --- |
     | angle | 119° | 95° | **157°** | 145° | 110° | **171°** | 131° | 126° |

   - So at H's and R's strike the empty tunnel faces the camera.
   - The flail's strike keys have the same shape (rot.x −1.2 to −1.4), and its fist sits in a lower corner.
   - **The fix is a pose redesign**, not a constant: for example the fist higher at the strike and the haft angled
     down onto the target, or a wrist roll in the hand.
2. **H's strike frame does not read as an axe.** The head is end-on. R's strike shows the head in profile and reads
   best. A small z-roll on H's strike key (rot.z) would turn the head's side toward the camera.
3. **No fist at rest.** The grip is below the frame, so the haft floats in from the bottom edge. Moving `AXE_REST.grip`
   up and in would show the hand (the flail note made the same point about its rest sliver).
4. **L's wind-up** passes the fist and bracer close to the camera across the top centre for several frames, covering
   the target's head. Its wind key (grip −0.14, 0.08, −0.3) could sit farther out or lower.
5. **Three chops at one point make a star with a crater** (`C-3chops`). In play, aim moves between chops, so this may
   be rare; a small along-blade offset per chop would avoid it.
6. **The head is a plain box.** A tapered wedge or a bearded profile would read as an axe rather than a cleaver; the
   spec plans a modelled axe later anyway.
7. **Head cuts on a dark face** (K-1) are hard to see in this light. Part B's split will change this.
