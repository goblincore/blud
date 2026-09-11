# ✅ RESOLVED — this brief is now historical

**The bug was found and fixed in `43779459`.** The flesh was missing on EVERY page,
including the default, because a `//` comment inside `COMPOSITE_WGSL`'s parameter
list became a phantom WGSL input: three's `wgslNodeFunction` sweeps the parameter
text with `/name\s*:\s*type/`, comments included, so `"deliberately: these"` parsed
as an input named `deliberately`. The call site bound `float(0)` to it, the call had
13 arguments for 12 parameters, and the composite pipeline never compiled. The
console said so at load: `THREE.TSL: Input 'deliberately' not found in 'Fn()'`.

Everything below — the checkout bisect, the broken output readback, the field-maths
suspicions — was chasing that one comment. **Read the sections below as a record of
a wrong investigation, not as instructions.** The three things worth keeping from it:

1. **Read the console at load.** The error was printed on every page and never seen.
   An entire afternoon of measurement went into a bug whose cause was in the log.
2. **It is the SECOND instance of this class.** The 2026-09-02 `MARCH_BODY` phantom
   is pinned in `march.wgsl.test.ts`; this file had no pin, so it happened again.
   Now pinned in `sdf-layer.test.ts` by running the real parser and requiring the
   parsed inputs to equal the declared parameters.
3. **"Inputs bind positionally" was FALSE**, and that wrong belief is in the comment
   that caused the bug. They bind BY NAME from the call-site object.

The `?fieldsdemo=1` gate stays until the owner's look pass at h/3 and h/4 — which is
now the actual next step, and it is a look decision, not a bug hunt.

---

# START HERE — deeper interlace (h/3, h/4) investigation handoff — HISTORICAL

> **✅ RESOLVED 2026-09-10 — the missing flesh was a shader-parse bug, not the
> fields.** `b1da21d1` added a `//` comment *inside* `COMPOSITE_WGSL`'s parameter
> list. The comment contained `deliberately: these`, and three's
> `WGSLNodeFunction` reads that as an input named `deliberately`. The
> `sdfComposite` call then got 13 arguments for 12 parameters, so the composite
> pipeline never compiled. That broke **every** divisor, including the default h/2.
> The console said so at load: ``THREE.TSL: Input 'deliberately' not found in
> 'Fn()'``. Fix: the comment moved out of the signature. It is pinned by
> `sdf-layer.test.ts` ("no comment phantoms"), which runs the real parser on
> both weave shaders. Verified on screen: the flesh renders at h/2, h/3 and h/4.
> The `?fieldsdemo=1` gate in `game-main.ts` is still in place, pending the
> owner's look pass. The rest of this brief is the investigation history.

**Working copy:** `/Users/donny/Projects/blud` on **`main`**, tree clean, HEAD
`1c21ac9c`. Nothing is pushed (50 commits ahead of `origin`). You are looking at
this same working copy — no branch to fetch.

**Full context:** `docs/dev-notes/2026-09-10-perf-session-handoff.md`, sections
"Deeper interlace fields", "The h/3 and h/4 defect the owner found", and
"⚠ CORRECTION: MY OUTPUT READBACK IS GARBAGE". This brief is the entry point; that
file is the evidence.

---

## 1. THE ACTUAL BUG IS NOT THE FIELDS

The owner reports: **on a completely default page — no `?fields`, standing still —
the SDF flesh does not render. Only the skeleton (mesh) shows.** That is a
REGRESSION in the shipped configuration, not a deeper-field defect.

**Therefore: the divisor work is a red herring until that is fixed.** Three
field-maths fixes landed during this session and none of them could have addressed a
default-page regression. The deeper fields are GATED off (`?fields=3|4` also needs
`?fieldsdemo=1`) precisely so they are not the thing under test.

## 2. FIRST ACTION (five minutes, and it answers the real question)

Establish whether the default page was ALREADY broken before this session's
commits, or whether this session broke it:

```bash
git stash list                      # must be empty; tree is clean
git log --oneline b1da21d1~1 -1     # the last commit before the shader edits
git checkout b1da21d1~1
npm run dev                         # LOOK at the flesh. Default page, no params.
git checkout main
```

`b1da21d1` is where `COMPOSITE_WGSL` and `FIELD_INTERLEAVE_WGSL` gained the clamped
`nf`. If the flesh is missing there too, this session did not cause it and the hunt
starts much earlier. If it renders there, bisect `b1da21d1..HEAD` — that is only
four commits, and only two of them touch the default path.

**This was never checked on screen for THIS branch's default.** The bit-identity
probe's control failed and instead of stopping, the session moved on to build the
feature on an unverified baseline. Do not repeat that: verify the default FIRST.

## 3. THE INSTRUMENT IS BROKEN — DO NOT TRUST OUTPUT-TARGET NUMBERS

`__sdfGame.readOutputTarget()` wraps a `Float32Array` over
`readRenderTargetPixelsAsync` bytes **on a target whose format was never checked**.
Reading it at the brightest flesh texel returns `[8781, 8992, 9230, 15360]`, which
is impossible for an rgba32f target (every channel is 0–1).

Consequences, all of them already recorded as wrong:

- `scripts/sdf-field-count-diag.mjs`'s **output verdict line is meaningless**. It
  reported "OUTPUT: surfaces 0 (0.00%)" at h/2 as well, and h/2 is the working
  config — that was the red flag for a broken reader and it got explained away.
- Every "the output lost the surfaces" conclusion is void.

**Sound and still usable:** the MARCH-target numbers (via
`__sdfGameDebug.readMarchTarget()`, the seam the frame hash already used with proven
de-padding). The flesh IS marched: surface texels (alpha < 1) cover **3.90% at h/2,
3.91% at h/3, 3.91% at h/4**, zero non-finite, 100% RGB non-zero.

**To fix the instrument:** check the target's real `texture.format` (half-float and
integer formats both decode wrong as `Float32Array`), or sidestep it entirely with
`__sdfGame.presentedShot()` — proven, returns the actual 8-bit canvas, and the
canvas is the honest surface because it is what the owner sees.

## 4. WHAT IS ALREADY PROVEN (do not re-derive)

- The flesh is **marched** at every divisor, in the right proportion, with correct
  target heights and no non-finite values.
- `COMPOSITE_WGSL` and `FIELD_INTERLEAVE_WGSL` at `nf = 2` are **equivalent to the
  original**, verified by diffing the reachable logic (fresh test and bracketing
  both reduce exactly).
- Two real bugs WERE found and fixed, each now gated by property-based tests in
  `field-render.test.ts`:
  - the bone weave's hardcoded `outRow / 2` — this was the owner's "skeleton
    outside the armor";
  - `fieldParity(frameIndex)` defaulting to 2 fields — this made a third of the
    fresh rows unreachable and another third sample one field forever.
  - (also fixed: the jitter's two-field centering)

## 5. TRAPS THAT PRODUCED CONFIDENT, MEANINGLESS ANSWERS (each cost a round trip)

1. **Comparing hashes across boots.** Two boots disagree at h/2 as well — the
   two-state branch measured all session. A cross-boot comparison is never evidence.
2. **Comparing across field parities.** `demoScenario` steps a frame and
   `fieldParity(frameIndex, fields)` cycles, so a one-frame step lands on the other
   field. Step TWO frames between readings.
3. **Sampling a sparse grid.** It saw 5 surface texels at h/2 and 6 at h/3 and
   "proved" the flesh was present. Count EVERY texel.
4. **De-padding.** WebGPU pads readback rows to 256 bytes; stride is
   `ceil(w * 16 / 256) * 64` floats. A dense walk reads padding as pixels.
5. **Trusting a stat whose value is absurd.** `nonZero == width * height` (one
   channel per texel) and `rgbNonZero == 1.0` both looked like health and were
   signals something was wrong. Read the numbers, do not scan them.

## 6. DEPRIORITISE UNTIL THE DEFAULT RENDERS

The h/3 and h/4 **performance measurement** and the **owner's look pass**. Both are
wasted while the default page is wrong. The perf lever itself is real and untouched
by all of this: `sdf:march` is 51–63% of the labelled GPU frame, and the plan
(`docs/superpowers/plans/2026-09-10-deeper-interlace-fields.md`) records that
quartering the pixels bought −54%.
