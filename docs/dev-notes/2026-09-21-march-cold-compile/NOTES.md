# March cold compile: it is the `mapBody` call-site count — NOTES

> **Status (2026-09-21, final):** both steps landed on main. The loader's cold
> wait for the body march went from **180 s to ~17 s** (8× less than the
> 12-copy baseline; 5 `mapBody` copies remain). Step 2 (`calcNormal` through
> one site) moved the canonical hashes by fast-math noise, and the owner
> approved the re-pin. On merging with main the pins moved once more, because
> main's `1ba2db30` (FOV 58/46) had already moved them and main was never
> re-pinned (bisected: it alone gives `57444064…`). Merged canonicals, each
> reproduced twice: default `409be6c9…`, crowd quad `ed8c062f…`, per-body
> `d8ba49e1…` (evidence in `scripts/march-hash.mjs`). `march-parity` PASS after
> each step and after the merge.

Branch `claude/march-compile-cold` off main `f6aaa115`. Evidence base:
[2026-09-19 census](../2026-09-19-shader-compile/NOTES.md) (cold = one ~48–200 s
Metal compile per distinct march program) and
[2026-09-19 defer-compile](../2026-09-19-defer-compile/NOTES.md) (gib + crowd
moved off the loader, so the loader now waits on **one** program: the body march).

## Finding

The per-program cold cost is driven by **how many call sites of `mapBody` the
entry has**. Apple's Metal compiler inlines every call to the field function, so
each textual `mapBody(` in `marchBody` is a whole copy of the field
(`foldGroup`, wounds, carves, bones, volume…) that it optimises separately. On
main the body entry had **12** copies:

| site | copies (main) | after (exact) | after (+normal loop) |
| --- | ---: | ---: | ---: |
| trace loop step | 1 | 1 | 1 |
| temporal start probe + recovery rewinds (`setup/start-bounds`) | 2 | 1 | 1 |
| `calcNormal` fallback + debug-12 compare, 4 taps each | 8 | 4 | 1 |
| backlit scatter + AO (`light/occlusion`) | 2 | 1 | 1 |
| `woundShadow` loop (a separate fn, 1 site) | 1 | 1 | 1 |

(Before the fix, `calcNormal` was called from two sites, so its four taps were inlined twice.)

WGSL size and function count are not the lever (the 2026-09-19 census already
showed size does not predict cold cost). The earlier "which variant?" question is
settled: the loader waits on one body program, and in these runs the whole cold
wait was that program.

## Measurements (cold, nonce'd, `node scripts/compile-census.mjs 1`)

Every run changes `hash13`'s constant to a fresh random value (it changes the
compiled program, so neither the Metal cache nor the macOS system cache can hit),
then restores it (`git diff` of `math.wgsl.ts` checked empty after each run). Runs
were serial, only after `pgrep -f "compile-census|melee-bench"` came back empty, and only
with the 1-min load < 4 (the harness waited up to ~10 min for this).

| file | change | asyncFirst | warmMs |
| --- | --- | ---: | ---: |
| `baseline-main.json` | main `f6aaa115` | **180 139 ms** | 184 539 |
| `A-calcnormal-loop.json` | `calcNormal` taps in a loop (1 site) only | 71 214 | 73 956 |
| `B-5-sites.json` | A + the three merges below | 16 714 | 18 095 |
| `C-exact-3-merges.json` | three merges, `calcNormal` taps kept | **27 806** | 29 201 |
| `C-exact-3-merges-run2.json` | repeat | **29 449** | 30 963 |

Caveat: one run per configuration except C (27.8 / 29.4 s). The A run started with the 1-min
load at 31 (left over from the previous compile), before the harness waited on load.
The spread is large, but a 6–10× cut is far outside the historical 100–200 s
cold range.

Note: the census's per-pipeline `ms` for the march family now reads ~0.2 ms (it
times the call, not the compile, under three r186's path), so `asyncFirst` is
the metric. That report column needs fixing before it is trusted again.

## What landed (bit-exact)

Three merges, each routing several call sites through one call inside a loop:

1. `body/blocks/setup/start-bounds.wgsl.ts` — the first temporal-start probe and
   the ≤3 recovery rewinds share one site (`for probe < 4`, same probes, same
   order, same exits).
2. `body/blocks/light/occlusion.wgsl.ts` — scatter (`k = 0`) and AO (`k = 1`)
   share one site; same gates (`surfCfg.w > 0`, `lodCfg.x > 0.5`), same points.
3. `body/blocks/post/shading-normal.wgsl.ts` — the finite-difference fallback
   and the debug-12 comparison share one `calcNormal` call.

Gates:

- `scripts/march-hash.mjs` room 1 = canonical `8f2b74e7…` (repeat identical,
  wounded `1381a866…`); room 2 = `35b6d561…`, same as main. The raw float
  readbacks of both rooms are **byte-identical** to main (`cmp`). Each merge was
  also bisected alone and each gave `8f2b74e7…`. (Existing script bug:
  `MARCH_HASH_ROOM=2` prints `FAIL … expected 8f2b…` on main too, because it
  compares room 2 against room 1's canonical hash.)
- `scripts/march-parity.mjs` (crowd vs per-body, rooms 1+2): **PASS**.
- `march-golden` snapshot re-recorded **deliberately** (6 string exports changed).
- String pins updated in `zombie-gpu`, `deferred-sdf`, `shade-helpers.wgsl`,
  `body/trace.wgsl` tests. `vitest src/lab/sdf-zombie`: no failures beyond the 14
  that fail identically on main (soldier mesh, hull soup, torso slug, …).
  `tsc --noEmit` clean.

## Step 2, landed after owner approval: `calcNormal` taps through one site (the other ~11 s)

Looping the four tetrahedron taps (A/B) is the biggest single cut (180 → 71 s
alone), but it is **not bit-exact**, including a version where the loop only
gathers the four distances and the final weighted sum is the original expression
verbatim. The difference sits inside the field: with constant tap offsets
inlined, Metal's fast-math optimises each copy differently. Measured with the
new `MARCH_HASH_RAW=<path>` dump + `scripts/march-raw-diff.mjs`:

| room | hit flips | depth Δ | differing hit px | max RGB Δ |
| --- | ---: | ---: | ---: | ---: |
| 1 | 0 | 0 | 12 032 / 33 040 | 5.96e-6 |
| 2 | 0 | 0 | 1 035 / 29 452 | 5.54e-6 |

That is ~650× below one 8-bit display step. It is invisible, but it moves the
canonical sha1. **The owner approved the re-record and it landed.** Kept for reference:
`8f2b74e7…` (and the wounded hash). The ready-to-apply version is
[`calcnormal-one-site.patch`](calcnormal-one-site.patch) (the select-gather loop as it was applied).
The applying commit also re-recorded `march-golden` and updated the `volume.wgsl`
test pins (4 taps → 1 site).

## Not tried / next

- Crowd and chunk/gib programs share the same march body, so their background cold
  compiles should shrink by the same factor. Not measured: the census does not wait
  for `warmBackground()`.
- The remaining copies (trace step, woundShadow, the start probe, scatter/AO,
  calcNormal×4) could go down to one or two with a "probe list" restructure. After
  the calcNormal loop the remainder is ~17 s, so the returns shrink.
- Rule for future march edits: **do not add a `mapBody(` call site**; route a new
  probe through an existing loop site. Each site costs roughly 10–15 s of cold
  compile on this machine.
