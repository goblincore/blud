# R1 — the gather runs one thread per (probe, ray): IMPLEMENTED AND MEASURED

**Status: DONE, verified on GPU, benched.** Supersedes the "DESIGNED, NOT
IMPLEMENTED" status of
[2026-09-10-r1-gather-dispatch-design.md](2026-09-10-r1-gather-dispatch-design.md);
that file's evidence and reasoning are still the reason this shape was chosen.

**The headline: `compute:probe-gather` 4.00 ms → 0.18 ms (room 4) and 4.87 ms →
0.15 ms (room 3)**, i.e. 10-32x, against the design's 4.00 → 1-2 ms target. The
labelled GPU total for the frame drops **2.1-2.5 ms**. The dynamic probe layer's
VALUES are unchanged to within one ulp — proven against the pre-R1 build, not
asserted (§3).

---

## 1. What changed

| file | change |
| --- | --- |
| `probe-dynamic.wgsl.ts` | `kProbeGather` restructured: one thread per (probe, ray), workgroup-scratch handoff, ONE unconditional barrier, serial fold by each probe's lane 0. Module-scope `var<workgroup>` declarations, exactly as `surface-nets.wgsl.ts` does it. |
| `probe-dynamic.ts` | `PROBE_GATHER_WORKGROUP`, `gatherThreadsPerProbe`, `gatherWorkgroupCount` — the one place the dispatch shape is decided (the kernel takes `tpp` as a uniform rather than re-deriving it). |
| `probe-gather-compute.ts` | Dispatch by WORKGROUP COUNT ARRAY, overridden per frame with this frame's count; new `gather` uniform. |
| `game-main.ts`, `boot-params.ts` | `?dynblend` / `?dynfall` + `setProbeBlend` / `setProbeFall`, and `parseFloatParam`. Verification seams — see §2. |
| `sdf-game-bench.mjs` | The two new seams pinned in the ship-defaults reset block (the rule the 2026-09-10 corruption taught). |
| `scripts/sdf-gather-dispatch-check.mjs` / `.sh` | The evidence tool. In-page FNV digest of the f32 bit patterns, the raw buffer dumped for a numeric diff, `--diff A B` compares two runs offline. |

### The two things that had to be right, and why they were not obvious

1. **NO COUNT GUARD, ANYWHERE.** `workgroupBarrier` may not sit in non-uniform
   control flow. The old kernel opened with `if (gi >= u32(cfg.x)) { return; }`,
   which had to go — the probe-count test is now a FLAG (`valid`), so threads
   past the last probe do no ray work, contribute zeros, and still reach the
   barrier. And the host must dispatch with an explicit **workgroup-count array**
   (`renderer.compute(node, [groups, 1, 1])`): a numeric count makes three emit
   its own `if (instanceIndex >= count) return;` ahead of the kernel call
   (`ComputeNode.js` `generate()`), which is the same illegal guard one level up.
   `surface-nets-compute.ts` had already paid for this lesson; the comment there
   is why this took one attempt instead of an afternoon.
2. **`tpp` MUST DIVIDE THE WORKGROUP.** The reduction is workgroup-local — WebGPU
   has no barrier between workgroups in a dispatch — so a probe's ray group must
   not straddle two workgroups. `threadsPerProbe` is therefore the next power of
   two at least the ray count (1, 2, 4, 8, 16, 32, 64), never a bare ray count.
   It is also at least 1 at zero rays, which is what keeps `?dynrays=0` meaning
   what it meant.

The fold is SERIAL in ascending lane order rather than a tree. It is exact at any
`tpp`, and it reproduces the old per-probe accumulation ORDER — which is why the
result is equivalent rather than merely close.

## 2. The instrument this needed: a HISTORY-FREE gather

Every cross-boot A/B of the gather was unreadable before this, and the reason is
not the two-state branch — it is the afterglow. Each record is
`mix(previous record, this frame's estimate, rate)`, so the buffer depends on HOW
MANY FRAMES the run dispatched before the read, which is boot timing. Measured:
two boots of ONE build disagreed at every ray count (runs `g1` vs `g2`, blend
0.6).

`?dynblend=1&dynfall=1` (both! blend alone still carries history, because the
rate is `lumNew > lumPrev ? blend : fall`) makes the record EXACTLY this frame's
estimate. The layer stops depending on history, and:

- two dispatches from one locked state are bit-identical at every ray count;
- two BOOTS of one build are bit-identical at every ray count (both builds);
- therefore a cross-build comparison is finally a measurement.

Both seams default to the shipped 0.6 / 0.12 and are pinned in the bench reset
block, so an unparameterised page is bit-identical to before.

## 3. EQUIVALENCE — proven against the pre-R1 kernel, in the same conditions

Method: the pre-R1 build (`49fb77ee`, in a worktree) and the R1 build, each with
the SAME verification seam ported in, each booted twice, `?frozen=1`, ship
defaults, `setDemoHold(true)`, `setLightClockFrozen(true)`, `performance.now`
pinned, 90 frames to settle, then `freeze(true) + setRenderLock(true)`, then the
ray sweep 0,1,2,3,5,8,16,31,32,47,64 with the whole 6400-float dynamic layer read
back at each point. Evidence: `old-vs-new.txt`, `repeat-old-build.txt`,
`repeat-new-build.txt`, `old-vs-new-second-sample.txt` in this directory.

| rays (→ tpp) | floats moved | max ABS | max REL | nonzero (old=new) |
| --- | ---: | ---: | ---: | --- |
| 0 (1) | 0 | 0 | 0 | 0 (bit-identical) |
| 1 (1) | 0 | 0 | 0 | 1484 (bit-identical) |
| 2 (2) | 89 | 5.96e-8 | 1.2e-5 | 2805 |
| 3 (4) | 156 | 5.96e-8 | 1.7e-6 | 2953 |
| 5 (8) | 344 | 5.96e-8 | 1.7e-5 | 3411 |
| 8 (8) | 437 | 5.96e-8 | 4.0e-6 | 4151 |
| 16 (16) | 648 | 5.96e-8 | 2.7e-5 | 5041 |
| 31 (32) | 844 | 5.96e-8 | 5.3e-6 | 5800 |
| 32 (32) | 816 | 5.96e-8 | 3.9e-6 | 5896 |
| 47 (64) | 1112 | 5.96e-8 | 8.8e-5 | 6088 |
| 64 (64) | 1156 | 5.96e-8 | 2.0e-5 | 6256 |

**The two independent sample pairs produce IDENTICAL tables**, down to the worst
probe index and channel — the whole comparison reproduces.

How to read it:

- **`maxAbs` is 5.96e-8 = 2^-24 at EVERY ray count.** One ulp, uniformly. This is
  the signature of a single rounding difference per term — the compiler's freedom
  to contract `r00 + radiance * SH_Y00` into an FMA in the old shape, which the
  new shape (product stored, then folded) does not offer. It is not a structural
  error: a mis-mapped lane, a doubled group or a wrong divisor would be orders of
  magnitude larger, and would move the hit structure.
- **`maxRel` up to 8.8e-5 looks alarming and is not**: it is the same 6e-8
  absolute error against a value near 1e-3. Read the ABSOLUTE column.
- **`nonzero` is IDENTICAL at every ray count**, which is the structural
  invariant: the same probes got the same hits. Only 13-45 of 6400 floats exceed
  1e-6 relative, i.e. under 0.7%.
- **`rays=1` is BIT-IDENTICAL and is the strongest single result in the table.**
  At one ray there is no accumulation to reorder, so the new path degenerates to
  the old one — and because that output depends on the full capsule set, the box
  list, the light list, the grid and the seed, its bit-identity is also a
  CERTIFICATE THAT THE TWO BOOTS FED THE GATHER BYTE-IDENTICAL INPUTS. Without
  it, "the outputs differ by one ulp" could have meant "the scene differed".
- `rays=0` is bit-identical too (both write zeros), but that one is trivial and
  proves nothing about the inputs.

**Verdict: the R1 rewrite is equivalent to the old kernel to within one ulp,
with identical hit structure and byte-identical inputs.** A visual difference is
not physically available at 6e-8.

## 4. PERF — the pass row, and the honest frame-level story

Full tables: `bench-pass-tables.md`. 1280x800, `BENCH_LEGS=baseline
BENCH_PASSES=1`, harness ship-truth pins on both builds, no prelude.

| pass (median of repeats, p50) | r0 room 3 | r1 room 3 | r0 room 4 | r1 room 4 |
| --- | ---: | ---: | ---: | ---: |
| `compute:probe-gather` | 4.87 | **0.15** | 4.00 | **0.18** |
| `sdf:march` | 5.05 | 6.23 | 6.11 | 7.31 |
| labelled total | 13.20 | 9.13 | 11.91 | 9.26 |
| fenced frame p50 | 16.77 | 14.15 | 18.64 | 14.33 |

Second sample, room 4 only: gather **3.99 → 0.39**, march 5.93 → 7.49, labelled
total 11.76 → 9.65, frame 13.96 → 14.96.

- **The gather row is unambiguous: 4.0 ms → 0.15-0.39 ms.** This is a within-leg
  pass row, which is the one measurement that survives this machine's drift (the
  documented reason), and the effect is 10-32x — no noise floor reaches it. The
  design's inferred full-occupancy floor of 0.2-0.7 ms was, if anything,
  conservative, and it is now measured rather than inferred.
- **End-to-end: the labelled GPU total drops 2.1-2.5 ms.** Read THAT, not the
  pass row, as the frame's gain — see the next point.
- **`sdf:march` reads 1.2-1.5 ms HIGHER in the R1 runs, reproducibly (four runs,
  two rooms).** It is not noise. About 0.8-1.3 ms of it is a pass-boundary move,
  not lost time: the frame's unlabelled gap (`fenced frame − labelled total`)
  shrinks by almost exactly the same amount (room 4: 3.65 → 2.38 ms; room 3: 2.54
  → 1.73), so the march's window absorbed work that used to sit in the bubbles
  between passes. **The residual is UNEXPLAINED and is the one open item here** —
  the honest next instrument is a gather-off gate at the SOURCE (skip binding the
  node), because routing the control through `setProbeRays(0)` does not work: with
  zero rays the march row collapses to ~0 ms and the frame's gap balloons to
  11-12 ms, so that seam cannot serve as a control. Recorded in
  `bench-pass-tables.md` so nobody re-runs it expecting an answer.
- **The fenced frame is the noisiest column and should not carry the claim.** The
  pre-R1 build's own two room-4 runs span 13.96-18.64 ms (4.7 ms) while the R1
  build's span 14.33-14.96 (0.6 ms). The frame-level verdict is therefore
  "consistent with a 1.7-2.6 ms gain, in a column whose noise is larger than the
  effect on one side".

## 5. Gates added (all of them run in vitest, none needs a GPU)

- `probe-dynamic.wgsl.test.ts`: the ten-input signature through the REAL wgslFn
  parser (phantom-input trap); **no `{ return; }` anywhere in the body** (the
  barrier's precondition, expressed as a test); exactly ONE
  `workgroupBarrier();`, top-level, between the scratch write and the fold, with
  no `if (` between them; both `var<workgroup>` declarations present, sized from
  the shared constants; **and the same declarations present in
  `getCode()`'s GENERATED output**, because the mechanism the design depends on
  is that the wgslFn parser reproduces everything after the parameter list — if a
  future parser change dropped it, the failure would be a pipeline that does not
  compile, i.e. exactly the silent black-silhouette class.
- `probe-dynamic.test.ts`: for every ray count 0..64, `tpp` is a power of two, it
  divides the workgroup size, and it is minimal; the dispatch count covers every
  probe rounded up; zero rays still dispatches one thread per probe.
- `boot-params.test.ts`: `parseFloatParam` absent-is-not-zero, fractions
  preserved (the `Number(null) === 0` class the repo already made structural).

## 6. Traps this session hit, for the next one

1. **A backtick inside a WGSL template literal breaks the TypeScript parse.**
   Third occurrence in this repo (`march.wgsl.test.ts` had the first two). It bit
   a COMMENT, in a file whose own header warns about it.
2. **`ws` is not returned by `connectGame()`** (the JSDoc says it is; the return
   statement is `{ tab, send, evaluate }`). A page-side console hook installed
   before `bootCloseupPage` is thrown away by the navigation anyway — use
   `Page.addScriptToEvaluateOnNewDocument`, which runs before any page script on
   every navigation, and READ THE CONSOLE (the passoff's trap 1 still applies:
   `console errors/problems: 0` is a first-class result of the check tool).
3. **A digest is not a measurement.** The old and new buffers differ at EVERY ray
   count ≥ 2 as digests; only the dumped floats show that the difference is one
   ulp rather than a dropped probe. Hence `--diff A B` on raw floats.
4. **Two boots of one build were not comparable until the afterglow was pinned**
   (§2). Any future cross-run A/B of the gather must pin `?dynblend=1&dynfall=1`
   or it is measuring boot timing.

## 7. Still open after R1

- **R2 (sample the shadow map)**: its target was ~56% of 4 ms; the gather is now
  0.15-0.39 ms, so the target has SHRUNK to ~0.1-0.2 ms. The design doc's
  ordering rationale ("R1 first, because R2's target shrinks if R1 lands") was
  correct, and this is the receipt. R2 is now a poor trade.
- **Cadence 2 → 4** was worth -5.2% when the gather cost 4 ms. At 0.18 ms it is
  worth ~0.2% of the frame. Still the owner's look call, but the PERF argument
  for it is gone; it should be judged on the look alone.
- **The serial fold is a deliberate inefficiency** (lane 0 walks `tpp` slots while
  its group idles). It is exact at any `tpp` and order-preserving; a tree would
  be faster and would change the summation order. At 0.18 ms there is nothing
  left to win, so do not "optimise" it without a measurement that says so.
- `surface-nets.wgsl.test.ts` still fails (HULL_FIELD 17-vs-19 arity) — pre-existing,
  untouched here.

## 8. How to re-run all of it

```bash
# equivalence (needs a browser; ~2 min per build)
scripts/sdf-gather-dispatch-check.sh --out /tmp/g-new.json --label r1
git worktree add /tmp/blud-r0 49fb77ee && ln -sfn "$PWD/node_modules" /tmp/blud-r0/node_modules
cp scripts/sdf-gather-dispatch-check.* /tmp/blud-r0/scripts/
(cd /tmp/blud-r0 && scripts/sdf-gather-dispatch-check.sh --out /tmp/g-old.json --label r0)
node scripts/sdf-gather-dispatch-check.mjs --diff /tmp/g-old.json /tmp/g-new.json

# perf (both builds, ~8 min each)
BENCH_LEGS=baseline BENCH_ROOMS=3,4 BENCH_PASSES=1 BENCH_OUT=/tmp/bench-r1 scripts/sdf-game-bench.sh
```

The pre-R1 baseline is reachable at `49fb77ee` and needs no placeholders for
`/sdf-game.html` (its assets are tracked).
