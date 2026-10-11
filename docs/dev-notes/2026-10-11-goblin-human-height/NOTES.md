# The goblin at human height — notes (2026-10-11)

**Spec:** [`2026-10-11-goblin-human-height-design.md`](../../superpowers/specs/2026-10-11-goblin-human-height-design.md) · **Plan:** [`2026-10-11-goblin-human-height.md`](../../superpowers/plans/2026-10-11-goblin-human-height.md) ·
**Sheet:** [`before-after.jpg`](before-after.jpg) (left 1.30 m before, right 1.70 m after).

## What changed

- **A `scale <k>` line in a `.blob`'s `model` block.** `compileBlob` ends with `scaleBodyDef(def, doc.scale ?? 1)` (`body-scale.ts`): every length is multiplied (root, bone `length`/`lengthR`/`side`, prim `radius`, `radiusB`, `blendK`,
  `offset`, `tip`, `bend`, groove and shell lengths), the shell's wrinkle frequency (radians per metre) is divided, fractions, directions, colours and flags are left alone. The unit tables are typed
  `satisfies Record<keyof T, Unit>`, so adding a field to `PrimDef`, `BoneDef` or `ShellParams` fails the typecheck until it is classified; an unknown key at runtime throws. To resize any other character, add `scale k` to its `model` block.
- **`goblin.blob`:** `scale 1.3077`, `height 1.70` (the height is still only a label). The numbers in the file, and the metre figures in its comments, stay the authored 1.30 m values.
  Body grain, mottle and the face sheet are texture-space and do not scale, so the grain stays small.
- **`goblin-kit.wam`:** `height 1.70`, kit rebuilt (`scripts/build-wam-kit.sh goblin`). Every kit dimension was a height fraction, so nothing else moved; the kit's clearance pins pass at exactly K times the old measured standoffs (brass 11.3-47.9 mm, was 8.7-36.6 mm).
- **Cadence, speeds and grip** (all eyeballed starting values, spec section 4): `GOBLIN_WALK.strideFreq` 1.5 to 1.31 Hz, `GOBLIN_RUN.strideFreq` 2.1 to 1.84 Hz (x0.874, a pendulum's period goes with the root of its length),
  `cruise` 1.19 to 1.36 m/s, `runBand` 1.30..2.77 to 1.48..3.18, `gripReach` 0.0396 to 0.0518 m, and the two metre-valued sway fields `swayAmp` 0.025 to 0.033 and `armSwing` 0.03 to 0.039 (the plan had them as angles and ratios; they are metres). Leg length measured on the compiled body: 0.7323 m (thigh 0.3792 + shin 0.3531), arms 0.3073 m each, hand bone 0.0942 m.
- **Not changed:** the first-person arms, the pose library (angles only), the shotgun model (a human-sized goblin holds the player's gun at its modelled size), the carry angles (relative to the authored hang, so a uniform scale carries them),
  the `GUN_GRIP` locators in `carry.ts` (the gun's own metres).

## One side effect to know about

`facePrims()` tags its prims (`tag: 'head' | 'jaw' | 'brow' | 'nose'`) for its own tests, and `scaleBodyDef` rejects a field it has no unit for. `compileBlob` therefore drops the tag from the face prims, for every character
(a pinned test says so). Nothing reads the tag off a compiled body (checked by grep and by the pack, build-body, validate, panel, rig-bind and silhouette tests).

## Test pins that moved (the rule: a length is its authored value times K, nothing loosened)

| File | What |
| --- | --- |
| `characters/goblin-blob.test.ts` | the `reach` cap, the arm daylight probes (0.235 m, 0.11 m) and thresholds (30 mm, 15 mm), hand clearance, torso dip, the gut's two offsets (15 mm, 8 mm). Most still passed unscaled, since a bigger body clears them more easily; they now track the scale |
| `characters/goblin-poses.test.ts`, `pose.test.ts` | the limb segment lengths, the swing arm length, the knee-forward threshold |
| `characters/goblin-kit.test.ts` | the tuck, the boot shaft, the belt window and drop, the buckle, the cuff, the plate fit |
| `silhouette.test.ts` | the kit's top height bound (1.35 m to 1.35 K) |
| `goblin-gait.test.ts`, `goblin-held-gun.test.ts` | the leg length the speeds are derived from, the grip pin |
| `__snapshots__/pack-golden.test.ts.snap` | the goblin's packed-bytes pin, re-pinned (`npx vitest run -u src/lab/sdf-zombie/pack-golden.test.ts`, darwin/arm64 only, not run in CI); the other 27 characters' hashes are unchanged |

The no-assertion "PROBE belt" test in `goblin-kit.test.ts` (a leftover from 2026-10-02 that only logged) is deleted.

## What to look at (the owner's gate)

1. **The armour fit at the new size.** Front and side frames show pauldrons, belt, bracers, greaves and boots seated with no gaps or clipping at turntable resolution; a close look is the owner's.
2. **The gait in motion.** Cadence 1.31 and 1.84 Hz are dynamic-similarity starting values, not tuned by eye. Walk 1.36 m/s, run 3.18 m/s.
3. **The proportions.** It is the same goblin scaled uniformly, so the head and ears read bigger in absolute terms; the owner chose this over re-proportioning to a human adult.

## Authoring tools now print scaled metres

With a `scale k` line, `scripts/blob-rings.ts`, `scripts/blob-measure.ts` and the other fit tools build from `compileBlob`, so the metres they print and suggest are the COMPILED (k times) values. Divide by k before pasting a
number into the file, whose numbers are the authored ones (the authoring skill says the same).

## Verification tooling gotchas

- The turntable's **rest-pose shots freeze the body but not the held gun** (`setMotionEnabled(false)` snaps the body to its rest hang while `character-view.ts` re-poses the prop only when a motion frame exists), so the side-view gun floats about 0.4 m in front in both the
  before and after frames. That is a stale-prop artifact, not a grip error. Judge the held gun with `BLOB_POSE=walk` or `BLOB_POSE=run`; the walk frames (third row of the sheet) show the gun in the hands, before and after.
- The walk turntable frames the figure to fit, so a size comparison needs the rest frames (rows one and two).
- `npm run blob:measure -- goblin` needs a reference mesh or plate under `docs/dev-notes/refs/` and does not run here.
- The lab's own ports: `LAB_VITE_PORT=5244 LAB_CDP_PORT=9244 LAB_TMP=.lab-tmp npm run blob:shot -- goblin <dir> 8` (the owner's dev server on 5173 is left alone).

## Follow-ups

The goblin standing in the Flat beside the kotatsu and the iMac (a look, when the emergence cutscene or the playable Flat places it); a gait tuning pass in the lab in motion; `docs/game/flat/design.md`'s "goblin-sized furniture"
wording (the Flat was built at human scale).
