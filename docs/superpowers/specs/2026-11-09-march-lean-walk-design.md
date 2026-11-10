# The clean-body fast path for the march's walk (`?leanwalk`)

2026-11-09. Follows the cost ladder
([LADDER.md](../../dev-notes/2026-11-09-sdf-perf-research/LADDER.md)): on a clean close-up a field
call in the walk costs 11 ns through `mapBody` and 3.6 ns through a function that only folds the
tile list and applies the carves, with the same picture to the bit.

## What ships

Behind a compile-time flag, `?leanwalk`, default off (shader text byte-identical without it):

1. **`mapLean`**, a second field function beside `mapBody`, for pixels on the tile-list path.
2. **A per-pixel test, `leanOk`**, computed once in the setup: true only when `mapLean` is exact for
   every slot in the pixel's table.
3. **The walk and the temporal start's probe** call `mapLean` when `leanOk`, `mapBody` otherwise.
   Each keeps its single `mapBody(` call site. Normal taps, AO and scatter probes, the wound shadow,
   the cone pre-pass and the refine entry are untouched.
4. **A runtime switch**, `__sdfGame.setLeanWalk(on)`: off writes `debugCfg.x = -1`, which the
   per-pixel test reads as "stay on `mapBody`", for an A/B inside one compiled program. (`debugCfg`
   is a `vec2` and `.y` is the flat-albedo seam; every other reader of `.x` tests `> 0.5` or a
   mode's own band, so -1 is 0 to all of them.)
5. **A census**, debug mode 23 (compiled only with the flag): per pixel `leanOk`, the slot count,
   the walk's steps.

`?leanwalk=walk` (added after the cold compile was measured) is item 3 for the walk only: the
temporal start's probe stays on `mapBody`, which is one inlined copy of the fold fewer in every
march program. The identity argument does not change: a probe through `mapBody` leaves the state
`mapLean` would.

The claim is bit identity: with the flag on, every march target is the one the flag-off program
draws.

## Where the text lives

The golden snapshot hashes every string export of the barrel (`march.wgsl.ts`), the joined
`HELPERS` list, its length, and the set of export names. So nothing new may be exported from a
barrel module and no helper may be added to the list.

- `march/lean-walk-flag.ts`: `LEAN_WALK`, in the style of `shade-bound-flag.ts`.
- `march/lean-walk.wgsl.ts` (not in the barrel): `MAP_LEAN` (the function), `LEAN_TEST_BLOCK` (the
  setup's test), the census block, and `leanSlotExact`, the test's CPU mirror.
- `map-body.wgsl.ts`: `MAP_LEAN` is appended to `MAP_BODY`'s tail when the flag is on, the way
  `FOLD_GROUP`'s tail carries `limbLoad` under `?limbs`. WGSL module scope is order-free, and the
  tail already declares globals `mapBody` uses above them.
- `body/trace.wgsl.ts`, `blocks/setup/start-bounds.wgsl.ts`, `blocks/loop/debug-counters.wgsl.ts`:
  the splices, each `${LEAN ? ... : ''}` around the unchanged text.

## Why `mapLean` is exact: `mapBody` on a walk call, branch by branch

A walk call passes noise amplitude 0, runs with `gPinSlot == -1`, `gNormalHint` and `gProbePass` at
their defaults, and (before the hit) `gShadeFold == 1e9`. On the tile-list path `mapBody` does this
for each slot `s` of the pixel's table, in table order:

| `mapBody` | On a slot that passes the test | `mapLean` |
| --- | --- | --- |
| `loadInstance(base + s)`: 19 to 22 record reads | reads `counts`, `band`, wind, anchor, alive from it | reads those three records only (`REC_COUNTS`, `REC_ANCHOR_BAND`, `REC_WIND_ALIVE`), sets `gWindDrift` and `gBodyAnchor` |
| dead slot: `continue` | same | same test on the same value |
| head split: pieces, caps, shell | closed (`REC_SPLIT_N` is zero): one piece `(-1e9, 0, 0)` at `pIn`, skipped only if the running union is already at or under -1e9; the second piece's cap is 1e9, so the loop breaks | the same skip (`-1e9 >= dUnion`), then folds once at `pIn` |
| per-piece resets | `gFoldBest*` reset; the wound scratch (`gWoundCluster`, `gWoundOwners`, `gWoundRaisers`, `gWoundThreat`, `gWoundAmp`) set to 0; `gWoundExact` set | resets `gFoldBest*`. The wound scratch is 0 on such a pixel whoever runs (initial value, and every `mapBody` call leaves it 0). `gWoundExact` is left alone: its only reader is `applyWounds`, which `mapBody` always precedes with its own write |
| `?limbs`: `limbMode` | needs a wound count over 0.5: false, `gLimbOn = gLimbSlack = 0` | nothing. `foldGroup` reads both, and both are 0 on such a pixel: 0 at the start, and every `mapBody` call before the hit folds the pixel's own (unwounded) slots. This would break if a tiles-off `mapBody` call ever ran in the invocation before the walk; none does |
| volume branch | `REC_VOL_POSE0.w` off: not taken | not present |
| `gCullRef` | `select(1e9, gCullUB, base + s == gCullSlot && piece == gCullPiece && !limbMode)`, piece 0; with `?shadebound` the same value before the hit | the same expression with piece 0 |
| tile fold | `foldGroup` over `gPixFirst[k] .. gPixEnd[k]` | the same call, the same order |
| `applyCarves` | called | called |
| `applyWounds` | returns `(carved, 0)` and writes nothing: either the wound-bound early return, or a row loop of zero iterations (see below) | not called |
| owner re-fold | needs `nearWound > 0.5` or `dmg != carved`, and `gWoundOwners != 0`: not taken, so `gWalkAttempted` stays 0 and `gWalkGapNew` 1e9 | sets `gRefoldWin = 0`, `gWalkAttempted = 0`, `gWalkGapNew = 1e9` at entry, as `mapBody` does |
| bone fold | `nearWound` is 0, so it needs `counts2.y > 0.5 && counts2.x > 0`: excluded by the test | not present |
| noise | amplitude 0: not taken | not present |
| piece cap, shell | closed: none | none |
| union min | on `carved < dUnion`: slot, fold, argmin, piece 0, `splitF = carved`, `nearWound 0` | the same |

After the slot loop both write `gLastFold`, `gLastFoldSlot`, `gLastFoldPiece = 0`, `gFoldBest*`,
`gHitSlot`, `gHitPiece = 0`, `gHitSplitF`, and return `(dUnion, bestIdx, 0, carved)`. With no
winning slot both return `(1e9, -1, 0, 0)` and keep the entry slot.

**The row loop of `applyWounds`.** With the per-ray wound list off the loop runs
`i32(gInstWoundCount)` times: zero when the count is under 0.5. With the list ON it runs `gWoundN`
times whatever the body's own count is, and `gWoundN` was built from the setup's slot
(`instCfg.z`), not from the slot being folded. So "this body has no wounds" is not enough: the test
also requires the list to be off or empty.

**The loaded instance.** `mapBody` leaves the instance globals (`gSlot`, `gBand`, every `gInst*`,
`gWindDrift`, `gBodyAnchor`) on the winning slot: the last slot it loaded, or a reload. `gSlot` and
the `gInst*` set are written by `loadInstance` only, so `gSlot` always names a fully loaded
instance. `mapLean` never calls `loadInstance` in its slot loop; it ends with `mapBody`'s own tail,
`if (gSlot != wantSlot) { loadInstance(inst, wantSlot); }`, then puts `gWindDrift` and
`gBodyAnchor` back on the loaded instance. The state is the same by induction over the calls, and
the reload costs 22 reads only when the winning slot changes: once for a one-body pixel whose slot
is not the setup's, never again. The stale split lanes (`gInstSplitH/A/R`, loaded for open slots
only) agree where it can be seen: no live slot of such a pixel is open, so neither function writes
them except through a reload of the same slot. One case differs and cannot be seen: `mapBody` loads
a DEAD slot's record before it tests the alive flag, so a dead slot that still held an open split
would leave its lanes behind where `mapLean` does not. Every reader of those lanes is behind
`gInstSplitOpen`, which agrees, and freeing a slot zeroes its split record.

What the walk reads between calls (`gBand` in the cloth accept and the shell noise,
`gInstSplitOpen`, `gInstMelt.y`, `gFoldBestDistort`, `gRefoldWin`, `gHitPiece`, `gHitSplitF`,
`gLastFold*`, `gWalkAttempted`) and what the post reads on a miss (`gInstMelt.y`) are all covered.

## The per-pixel test

`leanOk` is true when all of these hold:

- the pixel is on the tile-list path (`gTileActive > 0.5`);
- the runtime switch is not set (`debugCfg.x > -0.5`);
- the per-ray wound list is off or empty (`!(gWoundListOn > 0.5 && gWoundN > 0)`);
- for every slot of the pixel's table that is alive (`REC_WIND_ALIVE.w >= 0.5`; a dead slot folds
  in neither function):
  - no wounds: `REC_HEAD_WCOUNT.w < 0.5`;
  - a closed head: not `dot(REC_SPLIT_N.xyz, REC_SPLIT_N.xyz) > 0.5` (`loadInstance`'s own test);
  - no baked volume: not `REC_VOL_POSE0.w > 0.5`;
  - no bare-bones fold: not `(REC_COUNTS2.y > 0.5 && REC_COUNTS2.x > 0)`.

Five record reads a live slot, once a pixel, stopping at the first slot that fails. A NaN wound
count fails the test; the other lanes use `mapBody`'s and `loadInstance`'s own comparisons, so a
NaN there takes the same side in both functions. The melt does not enter the field except through
the bare-bones flag (`foldGroup`, `applyCarves` and the primitives read no instance global but
`gWindDrift` and `gBodyAnchor`).

`leanSlotExact(floats, slot)` mirrors the per-slot part on the CPU, and a unit test pins both
against records written by `createCrowdRecords` and against the `REC_*` indices.

## Left open, not built

Choosing per sample on wounded bodies: outside a body's wound bound `applyWounds` returns its input
and the re-fold and bones are gated on a near-wound flag, so such a sample is `mapLean`'s. The
slot loop of `mapLean` is shaped to take a per-slot "wounded but outside its bound" case later.
Also not built: the missed rays, reading tile entries from the buffer, any default flip.

## Proof

- Text: the golden snapshot unchanged; unit tests for the flag-off text, the flag-on splices
  (one `mapBody(` call site each), `mapLean`'s reads and the test's conditions.
- Bits: `scripts/march-hash.mjs` in its three modes, clean and wounded, flag off and flag on,
  against the pins. A multi-body frame (bodies overlapping in a tile, one wounded) compared
  flag-on against flag-off, and lean against the runtime switch inside the flag-on program.
- Time: flag on against off by alternation with per-repeat paired differences and an A/A control,
  on the ladder's clean close-up, a crowd frame and a wounded frame; the census says what share of
  each frame's pixels took the fast path.
- Cold compile: the flag-on program against flag-off, fresh profiles, alternated in one session.
