# The clean-body fast path for the march's walk (the lean walk), 2026-11-09

**On by default since the evening of 2026-11-09, in the walk-only form (owner's call: "i think we can
turn it on").** `?leanwalk=0` is the march without it; `?leanwalk` moves the temporal probe too. The
sections from "What was built" to "Cold compile" were written while it was still an opt-in flag and
read `?leanwalk` as "on (walk and probe)" and `?leanwalk=walk` as what is now the default.
[The default, re-verified](#the-default-re-verified) is the state as shipped on the branch.

Spec:
[`2026-11-09-march-lean-walk-design.md`](../../superpowers/specs/2026-11-09-march-lean-walk-design.md);
plan: [`2026-11-09-march-lean-walk.md`](../../superpowers/plans/2026-11-09-march-lean-walk.md); the
measurement it follows: [LADDER.md](../2026-11-09-sdf-perf-research/LADDER.md).

**Answer.** With `?leanwalk` the march target is the same to the bit on every frame tried, and the
`sdf:march` pass is 15 % faster on clean frames at the shipped settings (a close-up and a 12-body
crowd, both about −2.3 to −2.5 ms). It costs: about 2 % more on a wounded close-up (+0.3 to
+0.4 ms), and 3 to 5 s more cold compile on the program the loader waits for (42 s today).
`?leanwalk=walk` (the walk only, the temporal probe left on `mapBody`) keeps nearly all of the gain
for the smaller compile cost. No pin was changed.

**Everything here ran on three r186.** `package.json` asks for `^0.187.0`; the primary checkout's
`node_modules`, which this worktree links, holds 0.186.0. Base and branch were compared on the same
install, so the differences stand; the absolute cold-compile times may not carry to r187, and it is a
second reason (with Chrome 154 → 157) the `march-hash` pins may not reproduce.

## The default, re-verified

After the flip (`0f6f0db1`): no parameter is the walk-only form.

- **The golden snapshot was re-recorded on purpose.** `MAP_BODY`, `MARCH_TRACE_SETUP`,
  `MARCH_TRACE_LOOP`, `MARCH_BODY`, `MARCH_BODY_TRACE`, `REFINE_BODY` and the joined helpers moved;
  the other 100 entries did not. A second snapshot holds the `?leanwalk=0` text to the 107 values
  the first one had before.
- **`march-hash`, three modes, clean and wounded:** the default page and `?leanwalk=0` give the base
  commit's six hashes ([`default-march-hash.txt`](default-march-hash.txt)). Pins untouched.
- **The 12-body frame**, `?leanwalk=0` against the default page, exit bound on and off: 0 texels
  differ in every pair; 62 % of its pixels lean; 0 lean pixels with the switch held
  ([`default-parity.txt`](default-parity.txt)).
- **One timing rotation on the default boot** (exit bound on, 6 repeats, paired differences against
  the march without the lean walk on the same frame; `ab-default-*.json`):

| Frame | `?leanwalk=0` | The default (walk only) | `?leanwalk` (walk and probe) | Default, switch held | A/A |
| --- | --- | --- | --- | --- | --- |
| Clean close-up (377,202 steps, 100 % lean) | 16.87 ms | −2.44 (−2.54 to −2.31), −14.5 % | −2.72 (−2.78 to −2.66), −16.1 % | +0.39 (+0.34 to +0.55) | +0.01 (−0.03 to +0.08) |
| Crowd, 12 zombies (64,489 steps, 100 % lean) | 16.76 ms | −2.55 (−2.98 to −2.27), −15.2 % | −2.30 (−2.79 to −2.09), −13.7 % | +0.11 (+0.03 to +1.10) | +0.02 (−3.45 to +1.06) |
| **Wounded close-up** (400,045 steps, 0 % lean) | 21.92 ms | **+0.43 (+0.39 to +0.60), +1.9 %** | +0.50 (+0.03 to +0.81), +2.3 % | +0.50 (+0.32 to +0.99) | −0.09 (−0.40 to +0.07) |

- **The wounded close-up still pays about 2 % with the walk-only default**: +0.4 ms or more in every
  repeat, where the A/A control stays within −0.4 to +0.1. Leaving the probe on `mapBody` did not
  remove it. It is the cost of the walk's call sitting in a branch, and it is on every frame whose
  pixels cannot take the fast path.
- The crowd's first three repeats were disturbed (its A/A read −3.45 in one of them); the last
  three read 15.5 ms against 13.1 to 13.2 ms. A first close-up rotation staged a different frame
  (38 % cover) on a busy machine and was retaken; the table has the retake.

## What was built

- `march/lean-walk.wgsl.ts`: `mapLean` (per slot of the pixel's table: three record reads, the tile
  run through `foldGroup`, `applyCarves`, the upper-bound cull, the union min, then `mapBody`'s own
  exit bookkeeping and its conditional instance reload), the per-pixel test `leanOk`, the census
  (debug mode 23) and `leanSlotExact`, the test's CPU mirror.
- The splices, each a pure insertion under the flag: `mapLean` on `MAP_BODY`'s tail, `leanOk` in the
  setup after the wound list, the walk's call and the temporal probe's call each choosing per pixel
  at their one `mapBody(` site, the census with the other raw-counter modes.
- `march/lean-walk-flag.ts`: `?leanwalk` (walk and probe), `?leanwalk=walk` (walk only).
- `__sdfGame.setLeanWalk(on)` and `leanWalkState()`: a runtime A/B inside a flag-on page. Off writes
  `debugCfg.x = -1`. It shares the debug mode's lane, so `setMarchDebugMode(-23)` is the census with
  the switch held.
- `crowd-records.ts` imports `DATA_ROWS` from the layout leaf, not the barrel. The barrel import
  made the `REC_*` constants depend on import order once `map-body.wgsl.ts` imported the new module.

`leanOk` is true when the pixel is on the tile-list path, the per-ray wound list is off or empty, and
every live slot in the pixel's table has no wounds, a closed head, no baked volume and no bare-bones
bone fold. The spec has the argument branch by branch. One thing it turned up: with the per-ray
wound list on, `applyWounds` walks `gWoundN` rows for EVERY slot it folds, and that list was built
from the setup's slot, not the slot being folded. So "this body has no wounds" is not enough, and the
test refuses any pixel with a non-empty list.

## Bit identity

All on this machine (M3 Air, Chrome 157.0.8103.38), headless.

| Check | Result |
| --- | --- |
| Golden snapshot (shader text, flag off) | unchanged |
| `march-hash`, three modes, clean and wounded: base `3f0c65eb`, HEAD flag off, HEAD `?leanwalk` | the same six hashes on all three ([`march-hash.txt`](march-hash.txt)) |
| `march-hash`, default and boxes, `?leanwalk=walk` | the same ([`walk-identity.txt`](walk-identity.txt)) |
| 12-body frame, one body wounded (`lean-walk-parity.mjs`), exit bound off and on: flag off against on; on against the switch held; on against on again; the clean frame | 0 texels differ in every pair ([`parity.txt`](parity.txt)) |
| The same with `?leanwalk=walk`, exit bound on | 0 texels differ |
| Two flag-off boots of that frame (the script's determinism check) | 0 texels differ |
| Every timed replay against the game's own readback of its frame | 0 texels differ |

- The 12-body frame: 15,348 pixels marched, 62 % of them on the fast path. About 5,900 lean pixels
  have two or more bodies in their tile (the case the ladder never ran), and 4,941 hit pixels with
  two or more bodies stayed on `mapBody` because one of them is the wounded body.
- With the switch held the census shows 0 lean pixels of the same 15,348, so the switch reaches the
  shader.
- **The pins in `march-hash.mjs` do not reproduce, on the base commit either.** They expect
  `0c71e712…` / `d7392d52…` / `470ff0b3…`; base and HEAD give `07f628a3…` / `e0a128e7…` /
  `565aaad4…`. The pins were taken on 2026-09-29 under Chrome 154. Whether the browser or merged
  look changes moved them was not bisected. Not re-pinned. `MARCH_HASH_NOPIN=1` (new) reports a
  moved pin and carries on to the wounded capture, which is how the lines above were taken.

## Time

One `sdf:march` pass, captured off the game and replayed in the lab Chrome
(`scripts/native-spike/lean-ab.mjs`): 10 copies a submit, 15 rounds, the median; legs in rotation,
6 repeats; each difference is a leg minus the base IN THE SAME repeat. The base is the flag-off
program replayed on the flag-on boot's frame, so every leg of a row draws one staged frame (two
boots do not stage the same frame: the flag-off boot's own frame read up to 1.5 ms away). `A/A` is
the base against itself. Target 400 × 300. Raw data: `ab-*.json`.

Run 2 (quiet machine), hull exit bound ON, the shipped setting:

| Frame | Steps, lean share | Flag off | `?leanwalk` | `?leanwalk=walk` | Flag on, switch held | A/A |
| --- | --- | --- | --- | --- | --- | --- |
| Clean close-up, 0.6 m | 370,519, 100 % | 16.17 ms | −2.50 (−2.61 to −2.41), −15.5 % | −2.26 (−2.44 to −2.11), −14.0 % | +0.32 (+0.23 to +0.38) | +0.04 (−0.04 to +0.13) |
| Crowd, 12 zombies | 64,420, 100 % | 15.31 ms | −2.32 (−2.44 to −2.19), −15.2 % | −2.32 (−2.45 to −2.25), −15.2 % | +0.08 (−0.02 to +0.22) | +0.06 (−0.14 to +0.88) |
| Wounded close-up | 380,850, 0 % | 20.59 ms | +0.33 (+0.24 to +0.50), +1.6 % | +0.39 (+0.34 to +0.51), +1.9 % | +0.40 (+0.14 to +0.42) | +0.05 (−0.16 to +0.14) |

Run 1, 45 minutes earlier, a warmer machine (no walk-only leg):

| Frame | Flag off | `?leanwalk` | Flag on, switch held | A/A |
| --- | --- | --- | --- | --- |
| Clean close-up, exit bound on | 18.37 ms | −2.14 (−3.93 to +0.60), −11.6 % | +0.07 (−0.80 to +1.64) | +0.30 (−1.64 to +0.85) |
| Crowd, exit bound on | 15.55 ms | −2.26 (−2.52 to −1.74), −14.5 % | +0.09 (−0.06 to +0.26) | 0.00 (−0.11 to +0.07) |
| Wounded close-up, exit bound on | 21.66 ms | +0.38 (−0.27 to +0.90), +1.8 % | +0.43 (−1.46 to +2.03) | 0.00 (−0.58 to +0.23) |
| Clean close-up, exit bound OFF (the ladder's setting; 647,767 steps) | 21.77 ms | −4.13 (−4.91 to −3.24), −18.9 % | −0.16 (−0.71 to +1.50) | +0.18 (−0.16 to +1.32) |

- **Clean frames: −15 % of the pass at the shipped setting.** With the exit bound off the same
  close-up reads −19 %, inside the ladder's −16 to −22 % for a per-pixel choice. The shipped bound
  cuts that frame's steps to 57 %, and the gain with them.
- **The crowd gains as much from a sixth of the steps** (36 ns a step against 7 ns on the close-up).
  Most of its pixels hold two or more bodies, and `mapBody` loads a whole instance record (19 to 22
  reads) per body per call where `mapLean` reads three.
- **A wounded close-up pays about 2 %.** No pixel is lean there. The flag-on program is +0.3 to
  +0.4 ms slower than the flag-off program whether the switch is held or not, in 11 of 12 repeats
  over two runs. The clean close-up with the switch held shows the same +0.3 ms in run 2. So the
  cost is the flag-on program's shape on the `mapBody` path (the call sits in a branch, its result
  in a `var`), not the per-pixel test. Why is not established.
- **Walk only** is level with the full flag on the crowd and 0.24 ms behind it on the close-up.

## Cold compile

`scripts/compile-census.mjs 1`, a fresh Chrome profile and a fresh constant in `hash13` per boot
(the 2026-09-21 method), bare page, flag off and on alternated, 1-minute load under 4. Two sets, 35
minutes apart ([`cold.txt`](cold.txt), [`cold2.txt`](cold2.txt)).

| | Flag off (3 boots) | `?leanwalk` (3) | `?leanwalk=walk` (2) |
| --- | --- | --- | --- |
| The loader's march program (`asyncFirst`) | 42.1, 41.8, 42.1 s | 46.8, 46.8, 48.0 s (+4.8 to +5.9) | 45.0, 44.8 s (+2.8 to +3.0) |
| Crowd program ready, from navigation | 147.2, 146.3, 147.7 s | 164.4, 163.9, 168.5 s (+17 to +21) | 157.5, 157.9 s (+10) |

Each `mapLean` call site is one more inlined copy of the fold and the carves in every march
program. Two sites add 11 to 14 % to the loader's program; one adds 7 %. (The crowd-ready time is
new in the census: `CENSUS_BG_WAIT_S`.)

## Not verified

- **Bodies:** the zombie crowd and the bench close-up only. Not run: cloth (shell prims), a body on
  the bare-bones bypass or with a baked volume (both must stay on `mapBody`; the unit test covers
  the condition, no frame does), an open head split, kits.
- **The live game.** Every time above is a replayed `sdf:march` pass. No frame time, no Night Train,
  no heavy scene. A frame that mixes clean and wounded bodies was checked for parity (62 % lean)
  and not timed.
- **Other flag builds:** `?limbs`, `?shadebound`, `?splitablate`, `?raymask` with `?leanwalk` are
  argued in the spec and were not compiled or run.
- **The refine and deferred-surface programs** include the setup (and so the probe's splice). On the
  bare-page cold boots all 20 march-family pipelines (365 to 373 KB of WGSL) were created with no
  uncaptured GPU error (`gpuDiagnostics`); nothing looked at what the refine or the deferred
  surface draws with the flag on (`march-hash` and the parity gate run with the upscaler off).
- **The capture gates** (crowd, flail, axe, cut-wound, head-split) were not run with the flag on.
- **One machine, one browser.**
- **Why the flag-on program costs 2 % on the `mapBody` path.**
- The cold compile was measured on the bare page only.

## Seen on the way (not fixed)

- `ladder.mjs`'s rungs edit the march's text as it was without the lean walk. Its captures now need
  `SPIKE_QUERY=leanwalk=0` (its header and its error say so).

- `__sdfGame.setHullExitBound` writes the actors that exist. A body spawned later gets the shipped
  default (on), so `applyShipDefaults`' "off" does not hold for a crowd spawned after it: the crowd
  frames here had the bound on at both settings (steps differed by under 1 %).
- `march-hash.mjs`'s post-wound settle passes a sha1 as `distinctFrom` to a loop that compares FNV
  hashes, so that "distinct from room1" check can never fail. (Read in the code, not exercised.)
- The per-ray wound list and multi-body tiles (above): on a quad-dispatch pixel the list is one
  slot's wounds applied to every slot. Whether any shipped frame has the list on with several
  bodies in a tile was not checked.
- `march-hash.mjs`'s documented per-body equivalent (`MARCH_HASH_QUERY='crowd=0' MARCH_HASH_TILES=0`)
  waits 600 s for a crowd compile that never comes. `MARCH_HASH_PERBODY=1` works.
- The loader's march program compiles cold in 42 s here; the 2026-09-21 note left it at 28 s.

## Running it

```bash
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
export LAB_TMP=.lab-tmp LAB_VITE_PORT=5377 LAB_CDP_PORT=9377

# bit identity: a mode's hashes on the default page and without the lean walk (pins reported, not asserted)
scripts/native-spike/servers.sh env MARCH_HASH_NOPIN=1 node scripts/march-hash.mjs
scripts/native-spike/servers.sh env MARCH_HASH_NOPIN=1 MARCH_HASH_FLAGS=leanwalk=0 node scripts/march-hash.mjs
# the multi-body frame: ?leanwalk=0 against the default page (LEAN_PARITY_AA=1 first: two off boots must agree)
scripts/native-spike/servers.sh env LEAN_PARITY_EXITBOUND=1 node scripts/lean-walk-parity.mjs

# time: captures, then alternation (the commands for every scene are in lean-ab.mjs's header)
D=.scratch/lean/crowd-xb1
scripts/native-spike/servers.sh node scripts/native-spike/lean-ab.mjs 6 \
  off=$D-on@$D-off off2=$D-on@$D-off on=$D-on held=$D-held probe=$D-on@$D-probe-on
node scripts/native-spike/lean-census.mjs $D-census

rm -rf /tmp/blud-gpu-timing.lock
```

Do not edit anything under `src/` while a run is up: vite reloads the page under the script.
In the game: `__sdfGame.setLeanWalk(false)` / `(true)` on any page but `?leanwalk=0`, and
`__sdfGame.setMarchDebugMode(23)` for the census (`-23` with the switch held).
