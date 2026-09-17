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

## Pixel gate — RUN, and the refactor is pixel-identical

`node scripts/march-hash.mjs`, inside `scripts/lab-servers.sh`.

| When | `room1` |
| --- | --- |
| Before apply, run 1 (ports 5323/9323) | `8f2b74e71ff18dd04a99c05fe19392b96dd80c9d` |
| Before apply, run 2 (ports 5324/9324, fresh Chrome) | `8f2b74e71ff18dd04a99c05fe19392b96dd80c9d` |
| **After apply** (ports 5325/9325) | **`8f2b74e71ff18dd04a99c05fe19392b96dd80c9d`** |

**Before == after, byte for byte.** That is the proof the migration is
behaviour-preserving.

### The pinned canonical is STALE — pre-existing, not ours

The script exits FAIL because it compares against `DEFAULT_HASH =
0b84c119e04fc8b2f7a3fe2f69b85737448ec86c`, which no longer matches HEAD. This
drift predates this work: our tree adds only new files (`git diff
--diff-filter=M` reports one modified file, a markdown plan), and the
pre-apply runs already produced `8f2b74e7…`.

Cause: the canonical was pinned **2026-09-15** in `2b396068` (crowd march with
boxes dispatch becomes default). Since then at least 11 commits have touched
`march.wgsl.ts` / `sdf-layer.ts` / `post-aa.ts` — `acb2329c` upscale empty-tile
skipping, the shutter-blur integration, `30e66c84` blast refraction, the rupture
and slough work.

**Deliberately NOT re-pinned here.** Re-pinning is a change to a gate other
work depends on, it needs someone to confirm which commit legitimately moved the
value, and doing it inside a refactor is indistinguishable from loosening a gate
to make it pass. It is filed as separate work. The refactor does not need it:
before-vs-after is the correct comparison for a behaviour-preserving change, and
that comparison passes exactly.

## Frame gate — could not produce a comparison (pre-existing)

`scripts/sdf-demo-hash.sh ab` fails during recording, before any hash is
compared:

```
FAIL: run A: the recording sampled BOTH field parities
  (1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0).
```

**Verified identical at base `8f70d26f`** — same message, same parity sequence.
Pre-existing and unrelated to this work. The gate yields no evidence either way
here; the pixel gate above carries the proof. Fixing the recorder's parity
sampling is separate work.

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
