# Environment Lighting P1 — Bounce-Light Spike: findings

**Date:** 2026-08-25
**Branch:** `dispatch/lighting-p1-bounce`
**Status:** code complete and green (tasks 1–7); the four *visual* acceptance
criteria and the frame-cost measurement are **NOT yet judged here** — the DSH
dispatch sandbox in this session could not boot Chrome, so nothing was rendered
for the eye. Details and the exact blocker are below. The verdict is left for
the owner, as planned.

---

## What landed (tasks 1–7)

The full spike is implemented, following
`docs/superpowers/plans/2026-08-25-environment-lighting-p1-bounce-spike.md`:

- **Task 1** — `LightPreset` gains `probeWeight` (0 default) and `ambientGain`
  (1 default). Both presets ship off, so nothing moves until a slider does.
- **Task 2** — `src/lab/sdf-zombie/ambient.ts`, the CPU mirror of the six-wall
  analytic bounce. 9 property tests.
- **Task 3** — `src/lab/sdf-zombie/webgpu/ambient.wgsl.ts`, the `AMBIENT_AT` /
  `WALL_CONTRIBUTION` WGSL twin, plus the **zero-`mapBody` gate** test. 8 tests.
- **Task 4** — `src/lab/sdf-zombie/webgpu/enclosure.ts`, the toggleable
  Cornell-box enclosure (red left / green right / otherwise white). 7 tests.
- **Task 5** — the nine bounce uniforms plumbed through `zombie-gpu.ts`
  (declaration, binding, `applyMaterial`, chunk template copy) and `fpv-view.ts`
  (hands copy the same nine). 
- **Task 6** — `ambientAt` wired into `march.wgsl.ts`: computed once, consumed
  at both diffuse sites; the pinned shading strings re-pinned to
  `albedo * (amb + diff * wShadow * lightCfg.x * keyColor) * ao`.
- **Task 7** — the lab panel section in `lab-main.ts`: enclosure toggle, six
  per-wall colour pickers (writes mesh + uniform together), `probeWeight`,
  `ambientGain`, `ceiling`, and a one-click A/B that parks `probeWeight` at 0/1.

### Verification (all automated)

- `npx tsc --noEmit` → **exit 0**.
- `npx vitest run src/lab` → **81 files, 1545 tests, all green.** (The
  pre-existing lab suite was unbroken; the spike added the three new test files
  and one new `material.test.ts` case.)

### The zero-`mapBody` invariant

The Task-3 gate (`ambient.wgsl.test.ts` "evaluates the SDF field ZERO times")
asserts `AMBIENT_AT` contains no `mapBody`, `sdBody`, `applyWounds`,
`textureSample`, `textureLoad`, and no `loop {` / `while `. **It passes.**
Bounce is six unrolled dot-product/distance terms, no field sampling, so the
post-hit eval budget is unchanged. This is asserted by test, not by discipline.

---

## The parity invariant (task 6 gate 1) — established by test, NOT by capture

The whole safety story is: at `probeWeight = 0`, `ambientAt` returns exactly
`fillIntensity * keyColor`, making the new shading algebra identical to the old.

That holds **exactly** at the `ambientAt` level. `ambient.test.ts` "returns
exactly fillIntensity * keyColor when probeWeight is 0" asserts equality to **12
decimal places**, and the WGSL twin early-outs with
`if (bounceCfg.x <= 0.0) { return flat; }` so the shader takes the same exact
path.

One caveat I could **not** resolve by capture: the *march-body* expression is
algebraically identical but not guaranteed IEEE **bit**-identical. The old
expression was

```
albedo * (lightCfg.y + diff * wShadow * lightCfg.x) * keyColor * ao
```

and the new one is

```
albedo * (amb + diff * wShadow * lightCfg.x * keyColor) * ao
```

with `amb = lightCfg.y * keyColor`. Component-wise the new inner term is
`fill*K[i] + S*K[i]`; the old is `(fill + S)*K[i]`. Those are mathematically
equal but can differ by one ULP in float. The plan claims "bit-identical"; the
CPU mirror's 12-decimal parity test is exact, but the march expression's
reordering is only *approximately* identical. In practice the difference is
sub-8-bit after the sRGB encode (keyColor ≈ [1.0, 0.96, 0.92], so the products
stay close), and the plan's own wording ("algebraically identical") is the
accurate claim. **I could not run the capture comparison to prove pixel
identity**, because of the browser blocker below. If the owner wants a hard
pixel-identical guarantee, this is the one place to eyeball.

---

## The blocker: no browser could be launched in this session

The four visual gates and all capture/measurement work (eval-count heatmap, the
`sdf-bench` frame cost, the clay check, the A/B PNGs) require rendering
`sdf-lab-webgpu.html` in a WebGPU browser. **That could not be done here**, for
a concrete, reproducible reason:

- The DSH file sandbox is in `workspace-write` mode.
- Chrome on macOS **must** write to `~/Library/Application Support/Google/Chrome`
  (crashpad database + the process-singleton `SingletonSocket`/`SingletonLock`
  symlinks) and to `/var/folders/<uuid>/T` (`NSTemporaryDirectory`). Both are
  outside the session workspace.
- The sandbox denies file writes there (`open ...: Operation not permitted`),
  so Chrome aborts at startup: `Failed to create a ProcessSingleton`. I confirmed
  by hand that `mkdir` under `~/Library/.../Chrome` is allowed but creating a
  *file* there is denied, and that `mkdir` under `/var/folders` is denied outright.
- Escalating Chrome to `danger-full-access` was **not available** — the approval
  channel is disabled in this session ("no approval channel is available"), so
  the escalation fails closed.

Workarounds tried, all of which failed for the same root reason:
`--user-data-dir` in the workspace, `--user-data-dir` in `/tmp`, `HOME`/`TMPDIR`
redirects into the workspace, pre-creating the crashpad directory, and
`--disable-crash-reporter`/`--disable-breakpad`. None change the fact that
macOS Chrome resolves its config and singleton via `NSHomeDirectory` /
`NSTemporaryDirectory`, which are sandboxed away.

**Consequence:** the `sdf-bench` frame cost, the prims/pixel heatmap, the clay
check, and all four A/B captures are **not produced**, and `docs/dev-notes/
2026-08-25-bounce-spike/` is empty except for this note's companion README. I
did not fabricate measurement numbers or screenshots.

---

## The four acceptance criteria

Per the spec `2026-08-24-environment-lighting-design.md`:

| # | Criterion | Status here |
|---|---|---|
| 1 | **Owner's eye, in the lab** — a latex zombie in a red-walled box, toggling flat vs chromatic, does the shadow side taking the wall's colour make it feel *in* the room without softening the hard-key look? | **Not judged — blocked.** Requires the browser. |
| 2 | **Eval count unchanged** — `mapBody` calls per pixel identical with bounce on/off. | **Static gate passes** (test asserts zero `mapBody` in `ambientAt`). The *runtime* prims/pixel heatmap comparison could not be captured (browser blocked). |
| 3 | **Frame cost** — measured on `sdf-bench`, scenes A/B, bounce on/off, vs the quiet-host baselines (A 42.8/111.7, B 18.4/47.0). | **Not measured — blocked.** The bench is also Chrome/CDP-driven. |
| 4 | **`clay` still reads as clay** — no sheen. | **Not judged — blocked.** By construction `amb` feeds only the two diffuse terms, not the specular path, so a sheen is structurally impossible; but I could not confirm by eye. |

On criterion 3, the baseline note in
`docs/dev-notes/2026-08-24-sdf-bench/baselines.json` is a `min-p95 of 5 runs
over 60s`, and it warns the originals were 32–40 % pessimistic on a contended
host. I could not re-take them here (no browser), so no comparison was possible.
`uptime` was not meaningfully checked for the same reason.

---

## Spec open questions

1. **Is ~6 walls enough to read as GI, or do they look like obvious point
   lights?** Not answered — needs rendering. Analytically: six closest-point
   terms with inverse-square falloff is closer to a crude ambient than to six
   hard point lights (each `ndl` term is a broad area-lit term, not a specular
   highlight), but whether that *reads* as GI is exactly the owner's-eye
   question. If it needs more, the plan notes that is evidence for P3 sooner.
2. **Does the enclosure need a ceiling?** Mechanically answered at the code
   level: `bounceCfg.z` is a runtime toggle (`ceiling` button + `setCeiling`),
   the `posY` contribution is gated by `step(0.5, bounceCfg.z)`, and the CPU
   mirror has a test ("drops the ceiling contribution when the ceiling is off").
   Whether the bounce character actually wants a ceiling is the owner's call on
   the toggle.
3. **Should `clay` get its own `probeWeight`?** **Not answered** — this is the
   one you can decide without a render: a matte preset has no specular to carry
   form, so it plausibly wants a *higher* `probeWeight`. That is a one-line
   preset value in `material.ts` (add a non-default `probeWeight` to the
   `clay` preset) — no code change needed, purely a tuning decision.

---

## Plan-consistency fixes applied (deviations from the plan text)

The plan was internally inconsistent in three places, and I resolved each in the
direction the spec states. These are the only deviations from a literal reading
of the plan:

1. **Level preservation (spec-corrected).** The plan's `ambientAt` used
   `g = fill * ambientGain`, which lifts the shadow side by `1/luminance(keyColor)`
   (≈3.4 % for the practical key) relative to today. The spec says the shadow
   side "stays as dark as it is today", and the plan's own test
   "keeps the fill LEVEL when bounce is fully on at gain 1" asserts equal
   luminance to 6 decimals. The plan's code **could not** pass that test.
   Fixed in both mirrors to `g = fill * luminance(keyColor) * ambientGain`, so
   `probeWeight` changes hue only and luminance is exactly invariant. Test A now
   passes for the right reason.
2. **Position-dependent hue test — degenerate fixture.** The plan's
   "gets redder as a character walks toward the red wall" test used `RED_LEFT`
   (a single coloured wall) with a normal of exactly `[-1,0,0]`, so only that
   red wall is ever visible and unit-luminance renormalisation makes the hue
   ratio constant regardless of position — the assertion `near > far` was
   structurally impossible. Rewrote that one test to use a red wall over a
   neutral-grey floor and an angled normal, so two visible coloured walls
   genuinely compete by distance. The assertion itself is unchanged.
3. **Two literal nits.** The plan's test helpers typed `number[]` but
   `ambientAt` returns a readonly `Vec3` (would not typecheck) → changed to
   `readonly number[]`. The plan's `AMBIENT_REF_DIST` pin asserted the literal
   appears in `AMBIENT_AT`; it actually lives in `WALL_CONTRIBUTION` (the helper
   `ambientAt` calls) → the test now checks `WALL_CONTRIBUTION`.

---

## What I could not do (honest list)

- Render the lab in a browser, so **no** screenshots exist.
- Capture the eval-count (prims/pixel) heatmap with bounce off vs on.
- Run `npm run bench:sdf` on this branch with `probeWeight` at 1 (and on
  `main`) to measure frame cost against the baselines.
- The four A/B captures (flat vs bounce, red room and blue room,
  `henenlotter-latex` + `practical-hard-key`).
- Confirm `clay` reads as clay by eye.

## To finish this spike

Run the lab (`npm run dev` → `/sdf-lab-webgpu.html`) in a normal (non-sandboxed)
session. Toggle `enclosure: on`, set `probeWeight` to 1, and judge the four
gates. For the captures and the bench, use the existing
`scripts/blob-turntable.mjs` / `scripts/sdf-bench.sh` drivers; the captures
belong in `docs/dev-notes/2026-08-25-bounce-spike/`.

## Verdict (left for the owner)

Not stated. The evidence I can offer before the eye weighs in:

- The **parity invariant** is established by exact tests; the only open bit is
  the (sub-8-bit) float reordering in the march expression, noted above.
- **Zero `mapBody` evals** is enforced by test.
- The **chromatic behaviour itself** — left wall red → left shadow side red,
  hue-only, no brightness lift — is property-tested in the CPU mirror
  (`ambientAt` reddening toward the wall it faces, luminance-in == luminance-out,
  neutral-grey room stays neutral, `ambientGain` scales level only). So if the
  answer to "does it sell the look?" is a **negative** one, it will not be
  because the code is wrong — it will be because six analytic walls are not
  enough to read as GI, which is precisely the "needs real radiosity lift" /
  P3-sooner outcome the spec names as a real result.

---

## Verdict — measured on the owner's machine, 2026-08-25

The dispatch could not render (its sandbox cannot boot Chrome — see
`claude:infra` memory). These numbers come from a WebGPU headless Chrome on the
host, driving the real lab at `dispatch/lighting-p1-bounce`. Captures are in
`docs/dev-notes/2026-08-25-bounce-spike/`.

Method: capture the framebuffer with bounce off, then on, nothing else moved
(motion and wander frozen, camera pinned inside the box), and diff per pixel. No
colour heuristics — the pixels that change *are* the affected ones. A first
attempt that segmented flesh by hue was measuring the red **wall**, not the
character, and is discarded.

### The headline: at the shipping preset, it does nothing

`practical-hard-key`, default Cornell box, `probeWeight` 0 → 1 at `ambientGain 1`:

| metric | value |
|---|---|
| pixels changed at all | 4.21% |
| mean absolute change over those | **2.05 / 255** |
| mean RGB shift where it moved >2 | (−1.1, −0.1, **+2.6**) |

Under 1% brightness, and the shift is faintly **blue in a red room**. The owner's
read on seeing it live — *"I don't see anything in terms of lighting, flat vs
bounce"* — is correct and is now quantified.

### Why — two compounding causes, both structural

**1. The ambient term is ~2% of the picture.** `practical-hard-key` is
`keyIntensity 2.4` against `fillIntensity 0.06`. "Colour, not brightness"
preserves that term's *level* and changes only its hue, so it is changing the hue
of something that contributes almost nothing. The effect scales exactly linearly
with fill, which confirms it:

| fillIntensity | mean |delta| / 255 |
|---|---|
| 0.06 *(ships)* | 1.89 |
| 0.15 | 3.63 |
| 0.34 *(`game-ambient`)* | 8.01 |
| 0.60 | 13.05 |
| 1.00 | 19.91 |

**2. A Cornell box averages to grey.** Five of six walls are white or neutral, so
the accumulation is near-neutral *before* renormalisation and there is little hue
left to transfer. Isolating the wall proves the mechanism is fine — at fill 0.34,
bounce off → on:

| enclosure | mean RGB shift | reading |
|---|---|---|
| Cornell (1 red, 1 green, 4 white) | (+2.1, +0.6, −4.6) | barely red; mostly *loses the key's warmth* |
| one red wall, rest near-black | **(+35.0, −14.4, −13.8)** | strongly red — the mechanism works |
| all six walls red | (+27.1, −21.5, −21.2) | strongly red |

See `C1-redwall-only-fill0.34-FLAT.png` vs `C2-...-BOUNCE.png`: pale neutral pink
becomes saturated red. **The implementation is correct.** What fails is the
premise that a physically-plausible room carries enough hue to matter at 2% level.

The blue-shift direction also falls out of this: flat ambient is tinted by
`keyColor` (1.0, 0.96, 0.92 — warm), and a mostly-white room renormalises to
something *more neutral than that*. So switching to bounce removes warmth rather
than adding colour. It is doing exactly what it was specified to do.

### So: is this the spec's negative result?

**Partly — and the distinction matters.** The spec anticipated "chromatic ambient
doesn't sell it → the direction needs genuine radiosity lift". That is not quite
what happened. Chromatic ambient sells it *fine* when there is hue to carry and
level to carry it on. What does not survive contact is the conjunction of:

- the house rule (bounce may not change level), **and**
- a preset whose ambient level is 0.06, **and**
- rooms that are mostly neutral-coloured.

Any one of those relaxed and the effect appears. That points at a **missing knob
rather than a failed direction**, and the cheapest candidate preserves the house
rule completely:

- **Chroma gain** — push the renormalised tint *away from neutral* before use.
  Luminance stays fixed, so "colour, not brightness" still holds exactly, but a
  mostly-white room can still deliver visible hue. This is the one to try first;
  it is a two-line change to `ambientAt` and its CPU mirror.
- **Sharper falloff** — `REF_DIST` 1.6 m over a 4 m box lets distant walls dilute
  the near one. A tighter falloff would let proximity dominate. Also cheap, also
  rule-preserving.
- **Raise fill for interiors** — works, but spends the hard-key blowout, which is
  the thing the rule exists to protect.
- **`ambientGain` > 1** — works (11.52/255 at 2.5) and is already built, but it
  is explicitly the rule-breaking control.

Recommendation: try chroma gain and a tighter `REF_DIST` before concluding
anything about P3. The spike has done its job — it converted "would fake GI feel
good?" into a specific, measured, and cheap next question.

### Two bugs found by eye and fixed on the branch

1. **Floor z-fighting.** The enclosure's `negY` plane sits at y=0, exactly
   coplanar with the lab's 20×20 ground plane — stair-stepped tearing across the
   floor and the contact shadow. Fixed: the lab floor hides while the enclosure
   is up. A room has one floor, and an epsilon offset would still tear at grazing
   angles.
2. **Walls read as flat cardboard.** They were `MeshBasicMaterial` — literally
   unlit — on the plan's reasoning that lit walls would put two lighting models in
   one frame. Wrong on contact with the eye: a Cornell box's whole character is
   the gradient down a shaded wall. Now `MeshStandardMaterial`, picking up the
   lab's existing `DirectionalLight`. This does not touch the bounce maths, which
   reads wall albedo from uniforms and never the rendered pixels.

### Parity path — VERIFIED 2026-08-25

Captured 8 fixed poses (810x540, motion frozen, 6 s verlet settle) from fresh
page loads, bounce off on both sides. Two independent loads of `main` give the
honest cross-run noise floor; the branch is then compared against both.

| comparison | pixels differing | \|d\|>2 | mean \|d\| | max |
|---|---|---|---|---|
| **noise floor** — main-A vs main-B | 0.372% | 0.0521% | 2.29/255 | 130 |
| main-A vs lighting | 0.530% | 0.0870% | 2.61/255 | 168 |
| **main-B vs lighting** | **0.369%** | 0.0601% | 2.59/255 | 176 |

`main-B vs lighting` is **below** the main-vs-main noise floor: the branch
differs from `main` by less than two runs of `main` differ from each other.
main-A is the first-load outlier (less-settled rig), which is exactly the drift
`blob-turntable.mjs` documents. Parity holds; the residual is verlet settle
jitter, not a shading change.

This was worth checking rather than assuming: the substitution is exact algebra,
but `keyColor` moved inside the parenthesis in the march expression, so IEEE
bit-identity was never guaranteed — only equality after the 8-bit sRGB encode,
which is what these numbers confirm.

### Still not verified

- **Frame cost** against the `sdf-bench` scenes A/B with bounce on.
- **`clay` still reads as clay** with bounce at full.
- **Frame cost** against `sdf-bench` scenes A/B.
- **`clay` still reads as clay** with bounce at full.
