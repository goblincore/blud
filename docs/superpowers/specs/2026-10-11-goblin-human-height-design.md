# The goblin at human height — design

**Date:** 2026-10-11 · **Status:** built 2026-10-11, owner look pending ([notes](../../dev-notes/2026-10-11-goblin-human-height/NOTES.md)) · **Branch:** `claude/goblin-human-height` ·
**Parents:** [goblin refinement](2026-10-01-goblin-refinement-design.md) (body, kit, gait, poses) · [the Flat's room](2026-10-11-flat-room-design.md) (follow-up: "the goblin to human height") ·
**Task:** [`docs/tasks/characters.md`](../../tasks/characters.md) "Goblin to human height".
**Owner decisions (2026-10-11):** the player is human-sized and the levels are scaled to them, so the goblin should be near human height, not 1.30 m; it is a **uniform scale-up** of the
existing goblin (not a re-proportioned human); the standing height is **1.70 m** (scale 1.3077; the stoop makes it read a little shorter than the player's 1.75 m capsule).

## 1. Why

`height 1.30` in `goblin.blob` is only a label: every length in the file is absolute metres. The owner's approved body, armour, gait and poses were all tuned at 1.30 m, and the goblin is
the protagonist of the Flat (the kotatsu, the iMac, the emergence cutscene), which is built at human scale. The goblin's own numbers have to move, once, with nothing about its look changed.

## 2. What depends on 1.30 m

| Where | Form | Moves how |
| --- | --- | --- |
| `characters/goblin.blob` | every bone length, prim radius, offset, tip, bend, blend and groove, the `face` block's metres, the `bones` block | the new `scale` directive (section 3) |
| `characters/goblin-kit.wam` | lengths are **fractions of `height`** | `height 1.30` becomes `1.70` and the kit is rebuilt with `scripts/build-wam-kit.sh goblin`; its skeleton is a hand transcription of the `.blob`'s, in height fractions, and stays valid because both scale together |
| `motion-profile.ts` `GOBLIN_PROFILE` | `cruise`, `runBand`, `prop.gripReach` are metres and metres per second | retuned (section 4) |
| `gait.ts` `GOBLIN_WALK`, `GOBLIN_RUN` | curve mode is normalised by leg length (0.56 m now, 0.73 m after), so the stride scales by itself; the cadence does not | `strideFreq` retimed (section 4) |
| `characters/goblin-poses.ts` | bone **angles** only | unchanged |
| `goblin-blob.test.ts`, `goblin-kit.test.ts`, `goblin-gait.test.ts`, `goblin-held-gun.test.ts`, `goblin-poses.test.ts` | metre pins (arm daylight, belly offsets, grip, speeds) | each pin that is a length is re-derived from the scale, never loosened |
| `public/assets/lab/goblin-arm.glb`, `game-arms.ts` | the first-person arms | **untouched**: they are sized for the player's view, not the goblin's third-person body |
| the palette's `grain`, `mottleScale`, `surfaceNoiseAmp`; the face sheet | texture-space units | **untouched**: the owner asked that the body grain stay small (2026-10-02), so fine surface detail keeps its absolute size and the body is simply bigger under it |

## 3. The `scale` directive (engine change)

**Shape.** A line in the `model` block, next to `height`:

```
model goblin
  height 1.70
  scale 1.3077
```

`scale` is a positive finite number. `height` stays a label (it is now 1.70, the authored height times the scale). Absent `scale` means 1, so no other character changes.

**Where it applies.** `compileBlob` scales the `BodyDef` it returns, through one new pure function `scaleBodyDef(def, k)` in `body-scale.ts`. Everything downstream
(`buildBody`, rig binding, motion, packing, the checks, the turntable, the game) sees metres at the new size, with no other change.

**What it scales** (and the reason it is one function in one file): `BodyDef.root`, every `BoneDef.length`, `lengthR` and `side`, and for every `PrimDef` (and every `bonePrims` entry) the lengths `radius`,
`radiusB`, `blendK`, `grooveDepth`, `grooveWidth`, `offset`, `tip`, `bend` and the shell's `thickness`, `clipOffset`, `rim`, `warpAmp`; the shell's `warpFreq` is radians per metre and is **divided**.
Fractions (`at`, `capTo`, `scale`, `box.round`, strand `count`, `wave`, `cycles`, `fat`), directions, colours and flags are left alone. The face prims are built from the `face` block's metres
and appended inside `compileBlob`, so they are scaled with the rest.

**The guard.** The field table is typed `satisfies Record<keyof PrimDef, Unit>` (and the same for `BoneDef` and `ShellParams`), so adding a field to any of those types fails the typecheck until someone
decides whether it is a length. A unit test also builds a body with every field populated and checks each class.

**Why not the alternatives.** A one-off script that rewrites the numbers in `goblin.blob` would make a 560-line diff against a file whose comments quote the old metres in dozens of places, and
the next character that needs resizing would need the script again. A runtime body scale in the renderer touches the march, the wound system, the shadows and the gib pipeline, for a change that is
fully expressible before any of them run.

## 4. Gait, grip and speeds

A pendulum's period goes with the square root of its length, so a leg that grows by 1.3077 should step at 1/√1.3077 = 0.874 of the cadence. Starting values (eyeballed, tuned in the turntable):

| Constant | Now | After | Derivation |
| --- | --- | --- | --- |
| `GOBLIN_WALK.strideFreq` | 1.5 Hz | 1.31 Hz | × 0.874 |
| `GOBLIN_RUN.strideFreq` | 2.1 Hz | 1.84 Hz | × 0.874 |
| leg length | 0.56 m | 0.7323 m | × 1.3077 |
| `cruise` (walk speed) | 1.19 m/s | 1.36 m/s | 0.888 × 0.7323 × 1.31 / 0.625 |
| run speed (`runBand.to`) | 2.77 m/s | 3.18 m/s | 0.663 × 0.7323 × 1.84 / 0.281 |
| `runBand.from` | 1.30 | 1.48 | cruise × 1.09, the same margin as now |
| `prop.gripReach` | 0.0396 m | 0.0518 m | × 1.3077 (the fist orb scales with the hand) |

The torso lean and sway amplitudes are angles and ratios and stay. The held shotgun is the player's model and is not scaled: a human-sized goblin holds it like a human.

## 5. Verification

- **Unit:** `scaleBodyDef` (every class of field, k = 1 is the identity, the typed table), the parser (`scale` accepted, rejected when zero, negative or not a number), the compile and emit round trip.
- **The goblin's pins:** `goblin-blob.test.ts` and `goblin-kit.test.ts` still pass with their thresholds multiplied by the scale where they are lengths; a clearance that must be at least 30 mm becomes at least 30 mm times the scale, never a looser number.
- **Look:** the lab turntable (`npm run blob:shot`) before and after: front, side and back at the rest pose, the armour fit close-ups, a held-shotgun walk and run, and the sit and type poses; laid out as a before-and-after sheet.
  The owner is the judge of the look and the gait.
- **Scale in the world:** the goblin standing in the Flat beside the kotatsu and the iMac, against the zombie (1.8 m) in the lab.
- `npm run typecheck`, `npm run test:changed`, and the goblin test files by path.

## 6. Out of scope

The goblin is not placed in the Flat in this task (that is the emergence cutscene and the playable Flat); the first-person arms; any new goblin art; the gait's final feel (an owner look in motion);
resizing any other character (the directive makes it a one-line change when wanted).
