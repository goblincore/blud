# Decomposition baseline — gate results

Plan: [`2026-09-17-game-main-decomposition.md`](../../superpowers/plans/2026-09-17-game-main-decomposition.md)

- **Base commit:** `8f70d26f` (`docs(plan): game-main.ts decomposition implementation plan`)
- **Date:** 2026-09-17
- **Machine:** darwin 25.3.0, node v22.22.1

## Type gate

`npx tsc --noEmit -p .` — **clean**, exit 0.

## Unit gate

Measured at the base commit **and** after all 16 slices merged, to separate
pre-existing failures from anything the decomposition introduces.

| | Test files | Tests |
| --- | --- | --- |
| Base `8f70d26f` | 12 failed \| 343 passed (355) | **15 failed** \| 5,516 passed (5,531) |
| 16 slices merged | 12 failed \| 363 passed (375) | **15 failed** \| 5,631 passed (5,646) |

**The 15 failures are PRE-EXISTING and unrelated to this work.** They are
character-authoring and SDF-geometry tests — `blob-compile`, `gib-rupture`,
`zombie-blob`, `soldier-blob`, `gnasher-blob`, `blob-measure`, hull/skeleton
census, torso-slug reaction. The decomposition added only new files; `git diff
--diff-filter=M 8f70d26f..HEAD` reports one modified file, the plan markdown.

**Gate rule for later tasks:** the pass condition is **15 failed / 12 files, not
zero**. A 16th failure is a regression. Do not "fix" these as part of the
decomposition — they predate it and belong to separate work.

## Pixel and frame gates

**NOT YET RUN.** `node scripts/march-hash.mjs` (expected `room1` =
`0b84c119e04fc8b2f7a3fe2f69b85737448ec86c`) and `scripts/sdf-demo-hash.sh ab`
must be captured before task 8 applies the codemod to `game-main.ts`. No GPU
pass is claimed until observed.

## Codemod dry run (all 395 bindings)

```
bindings mapped   : 395
lines 14764 -> 14731   (delta -33)
reported linesLost: 33      <- delta accounted EXACTLY
  collapsed texProbe    @1159 (-11)
  collapsed upscaleAb   @2758  (-6)
  collapsed liveChunks  @5423 (-10)
  collapsed pendingGibs @6509  (-6)
ctx. references   : 3987
```

Remaining old names in the output: 15 — 11 in comments, 4 shorthand property
keys correctly expanded (`sdfScale: ctx.render.sdfScale`). Zero genuine misses.

## Binding coverage

```
state bindings in game-main : 395
names across the 16 maps    : 395
collisions                  : 0
missing (state, unmapped)   : 0
extra (mapped, not state)   : 0
```

Permanently gated by `scripts/game-context-coverage.test.ts`.
