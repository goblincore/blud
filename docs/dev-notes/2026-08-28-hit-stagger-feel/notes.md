# Hit-stagger feel — the heavy-hit choreography (Pass C)

Owner ask (2026-08-28): *"it doesnt seem the zombies have the stun kinda
animation that the lab has … we need more readable stun and hit states that
make it feel like the zombie is really staggered and hit by something of
substantial force."*

Branch `dispatch/hit-stagger-feel`, resumed after the 2026-08-27 run died
mid-edit (its Passes A/B survive: per-kind `IMPULSE` routing `aa46663`, the
stagger `gain` knob `63454c8`).

## The defect, precisely

The lab's click path shoves by wound kind (blast **0.16**, pellet 0.06,
burn 0.04 — `lab-main.ts` ~1371, already raised once for the farther god-cam).
The game shipped with `PELLET_IMPULSE = 0.05` for **everything**, and stamped
`type: 'pellet'` into the motion signal no matter what the wound was — so the
slug (a blast-calibre wound) both shoved and *staggered* like a single pellet.
The only stagger kind the game could ever produce was the weakest one (flinch).
Baseline reel (`before/`): a torso slug produces a mild arm twitch at f002 and
a standing, still-shambling body by f022 with the crater in place.

## What landed (all in `game-actor.ts`; lab untouched)

- **Pass A — impulse by kind**: `IMPULSE = { pellet: 0.07, blast: 0.18, burn: 0.04 }`;
  both the shove and `pendingShot.type` route by `wound.type`. 0.18 > the
  lab's 0.16 deliberately: the lab's own note says its numbers were raised for
  a camera further out than first person.
- **Pass B — gain knob** (in `stagger.ts`/`motion.ts`, default 1 = lab
  bit-identical; the lab never sets it).
- **Pass C — the choreography** (this session), actor-owned so the shared
  modules and the lab stay bit-identical:
  - `SLUG_GAIN = 1.3` — blast-profile hits send `shot.gain 1.3`: the lurch
    (`lurchAmp` 0.26 → 0.34 target) and the localized recoil (0.20 → 0.26)
    play 1.3x the lab's blast amplitudes. Pellets send no gain (a volley
    re-flinches at 1; eight doubled flinches would look like a seizure).
  - `BLAST_HOLD_SEC = 0.55` — after a blast hit the wander is gated off
    (`MotionConfig.wander=false`): the stride fades out UNDER the lurch
    (blend 2.5/s → 0 in 0.4 s) instead of walking through it, then resumes
    toward the same target. **A stagger that never interrupts locomotion
    reads weightless** — this is the single biggest readability win.
  - `BLAST_KNOCK_MPS = 1.2`, `BLAST_KNOCK_DECAY = 7` — the body's ROOT is
    knocked back along the shot's ground-plane direction (bounds-clamped),
    exponentially decaying: ≈ v0/k ≈ **0.17 m of real stumble**, not just
    joint offsets.
  - `debug()` seam on the actor (hold/knock/phase/meter/blend/speed/
    staggerKind) — the capture driver's oracle.

## Which stagger kinds fire now

| wound | kind (before) | kind (now) |
|---|---|---|
| pellet | flinch only | flinch (unchanged — lab reference) |
| slug (blast calibre) | **flinch only** (type was hardcoded) | lurch + torso wound-clutch + recovery step + gait phase-knock, at gain 1.3 |
| burn | never occurred | shudder (dormant — no burn source wired to actors yet) |

## Evidence

- `after/slug-torso-*` (f000→f038): f004 shamble intact → f006 body arched
  back, leg lifting → f008 knocked back ~0.3 m, torso twisted, arms off the
  reach pose → f016 hunched recovery with the clutch reaching for the wound
  → f028 turned, resuming → f038 wandering again. One slug does NOT collapse
  (meter 0.13 < 0.8).
- `after/slug-limb-*`: same throw on an arm/hip hit, no clutch (torso gate).
- `after/buckshot-2barrels-*`: 16 pocks, whole-body re-flinch, then the
  meter (16 × 0.055 = 0.88) drops the body by f030 — sustained fire kills,
  as designed.
- `lab/*`: the lab's Shift-click blast reaction (wound + shot + 0.16
  impulse) at fighting range — comparable upper-body throw, but the lab body
  stays PLANTED (it has no walk stop and no root knockback). The game now
  exceeds the lab on exactly those two axes.

## Cost

- Per-actor `step(1/60)`, 20k-step offline bench: steady-state **15.5 µs/step
  after vs 15.8 µs/step before** (the choreography's idle path is two scalar
  compares — noise-level). Active-reaction window ~19–27 µs/step (within the
  existing stagger machinery's variance; the before-number's tail included a
  collapse in one run, which is the expensive path, not mine).
- Whole-pipeline CPU at 15 bodies ≈ 15 × 16 µs ≈ **0.24 ms/frame** — the
  frame is still bound by the GPU march, unchanged (room-4 EMA after
  29.0–31.5 ms vs before 29.4–32.0 ms on this machine, same build flags).

## Test-gate gotcha (cost half a day of confusion)

A test that "hits the torso" with the torso **cluster centre** aims INSIDE the
field: `worldHitToWound` anchors the crater pathologically and the slug's
severRadius (0.13) then cuts BOTH hip necks → instant both-legs collapse.
Every choreography test (and capture) must raycast a real SURFACE point —
chest height (y≈1.3) clears the hip necks. The page's own predictor always
produced surface points, so this was never a player-visible bug.

## Reproduce

```
scripts/lab-servers.sh            # or: vite --port 5397 + headless chrome :9395
node scripts/sdf-game-stagger-seq.mjs 5397 9395 /tmp/stagger-after after
node scripts/sdf-lab-stagger-seq.mjs   5397 9395 /tmp/stagger-lab  lab
```
