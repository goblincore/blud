# Per-ray wound list — implementation plan

> **For agentic workers:** one task, one branch. Every step has a verification
> command. Do not skip the parity gate: a wound list that drops a wound the ray
> could reach renders a hole, and the bench number is worthless if the frame
> is wrong.

**Goal:** Cut the per-step cost of the wound loop in the SDF march by building,
ONCE per pixel at the march entry, the list of wounds whose reach sphere the
pixel's ray can enter — so every march step (and every post-hit probe) folds
only those wounds instead of all sixteen. Ship it behind a seam, prove it
pixel-identical to the shipped path, and measure it with the pass-attribution
bench.

**Architecture:** `src/lab/sdf-zombie/webgpu/march.wgsl.ts` is a set of WGSL
strings assembled into one fragment shader by `zombie-gpu.ts` (three TSL
`wgslFn`). `applyWounds` (search `export const APPLY_WOUNDS`) loops the wound
rows `0..woundCfg.x` on EVERY field evaluation, loading `ROW_WOUND` per wound
and skipping by a reach test (`perfCfg.y`). The march entry `marchBody`
(search `export const MARCH_BODY`) already builds a per-pixel TILE LIST of
primitive groups into `var<private>` arrays before stepping (search
`TILE-LIST PRELOAD`) — this task adds the same shape of thing for wounds,
gated by a spare settings channel so OFF is bit-identical.

**Tech stack:** TypeScript, three r185 `three/webgpu` + TSL, WGSL, vitest.
Bench: `scripts/sdf-game-bench.sh` (`BENCH_PASSES=1`), headless Chrome via CDP.

**Prediction, stated up front so the result is read honestly:** the
`wound-earlyout-off` leg (run 5 in
`docs/dev-notes/2026-09-07-gpu-pass-attribution/notes.md`) measured that
running the wound loop with NO per-wound skip costs nothing measurable, which
suggests the loop's per-step texel loads are not the dominant term inside the
near-wound zone (the inside-flesh bone/organ rows the `nearWound` gate opens
are the other suspect, being measured separately). The list may therefore
measure ~0. **A clean ~0 with a parity-proven implementation is a valid
deliverable** — it retires the idea with a number. Do not tune to force a win.

---

### Task 1: Per-ray wound list behind `counts2.w`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `scripts/sdf-game-bench.mjs`
- Test: `src/lab/sdf-zombie/webgpu/march-wound-list.test.ts` (new)
- Create: `docs/dev-notes/2026-09-07-per-ray-wound-list/notes.md` (+ captures, bench output)

#### Step 0 — orient (read, do not edit)

- [ ] Read `docs/dev-notes/2026-09-07-gpu-pass-attribution/notes.md` end to end. It is the reason this task exists and defines how the bench is read (repeatability first; per-leg spread; `sdf:march` exclusive ms is the number).
- [ ] In `march.wgsl.ts` read: the file-header comment about WGSL comment traps (NO parens and NO colons inside any comment in a `fn` PARAMETER LIST — a paren truncates the parsed inputs and every body renders unlit-black); `APPLY_WOUNDS`; the `TILE-LIST PRELOAD` block inside `MARCH_BODY`; the `var<private> gTile*` declarations just above `APPLY_BONES`; `RAY_CULL_SLACK` at the top of the file.
- [ ] In `zombie-gpu.ts` find both `u.counts2.value.set(` calls. `counts2.z` is preserved across uploads as a settings channel (the owner re-fold gate). `counts2.w` is spare and is what this task uses.
- [ ] In `game-main.ts` find `setOwnerRefold` — the seam this task mirrors — and `ALL_LEGS` / the ship-defaults reset block in `scripts/sdf-game-bench.mjs`.

#### Step 1 — failing test for the shader text

- [ ] Create `src/lab/sdf-zombie/webgpu/march-wound-list.test.ts` that imports `APPLY_WOUNDS`, `MARCH_BODY` and `MAX_WOUNDS`-equivalent constants from `./march.wgsl` and asserts:
  1. `APPLY_WOUNDS` contains `gWoundListOn` and `gWoundList[` (the list branch exists).
  2. `APPLY_WOUNDS` still contains the union-bound early return `if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }` BEFORE the loop (the existing cull must stay first).
  3. `MARCH_BODY` contains `gWoundListOn = select(0.0, 1.0, counts2.w > 0.5);` and the reach formula text `w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25` appears in BOTH `APPLY_WOUNDS` and `MARCH_BODY` (the preload must use the SAME reach the loop uses — pin it by text so they cannot drift).
  4. The `MARCH_BODY` parameter list (text between `fn marchBody(` and the first `) -> vec4<f32>`) contains no `(` and no `:` inside `//` comments — reuse whatever the existing tests do to check this (search the test files for `paren` or `marchBody(`), or write a small regex over comment lines in that span.
- [ ] Run: `npx vitest run src/lab/sdf-zombie/webgpu/march-wound-list.test.ts` — expect FAIL on 1 and 3.

#### Step 2 — shader: private list + preload + loop

- [ ] In `march.wgsl.ts`, next to the `gTile*` `var<private>` declarations (they live at the tail of `SAMPLE_VOLUME`'s source — see the NOTE there about why; add yours in the same place, same style), add:
  ```wgsl
  var<private> gWoundListOn: f32 = 0.0;
  var<private> gWoundN: i32 = 0;
  var<private> gWoundList: array<i32, 16>;
  ```
  Private vars are per-invocation and start at their initialisers, so the cone/depth pre-pass chains (separate invocations that never run the preload) keep `gWoundListOn` 0 and fold the full loop — conservative by construction. State this in a comment.
- [ ] In `MARCH_BODY`, immediately AFTER the `TILE-LIST PRELOAD` block (so `rd` and `camPos` exist), add the wound preload:
  ```wgsl
  // PER-RAY WOUND LIST (counts2.w gate, 2026-09-07). Built ONCE per pixel:
  // a wound whose REACH sphere the ray never enters cannot change this
  // ray's field on any step, nor the post-hit probes within RAY_CULL_SLACK
  // of the ray. Same reach formula as applyWounds (pinned by test).
  gWoundListOn = select(0.0, 1.0, counts2.w > 0.5);
  if (gWoundListOn > 0.5) {
    gWoundN = 0;
    let nW = min(i32(woundCfg.x), 16);
    for (var i = 0; i < 16; i = i + 1) {
      if (i >= nW) { break; }
      let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
      let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25 + ${RAY_CULL_SLACK};
      let oc = w.xyz - camPos;
      let tc = max(dot(oc, rd), 0.0);
      if (dot(oc, oc) - tc * tc > reach * reach) { continue; }
      gWoundList[gWoundN] = i;
      gWoundN = gWoundN + 1;
    }
  }
  ```
  `counts2`, `woundCfg`, `woundCfg2`, `data` are already `marchBody` parameters — verify by reading the signature; do NOT add parameters.
- [ ] In `APPLY_WOUNDS`, change the loop head so the body is untouched:
  ```wgsl
  let n = i32(woundCfg.x);
  for (var k = 0; k < 16; k = k + 1) {
    var i = k;
    if (gWoundListOn > 0.5) {
      if (k >= gWoundN) { break; }
      i = gWoundList[k];
    } else {
      if (k >= n) { break; }
    }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    ... (every line below unchanged, still indexed by i)
  ```
  With the gate off this is the same sequence of iterations as before (k == i, same break), so OFF must be bit-identical.
- [ ] Run the test from Step 1 — expect PASS. Run `npx tsc --noEmit -p .` — expect no errors.

#### Step 3 — settings channel + seam + bench leg

- [ ] `zombie-gpu.ts`: in BOTH `u.counts2.value.set(...)` calls, preserve `.w` the way `.z` is preserved (fourth argument `u.counts2.value.w`). Add a one-line comment: w is the per-ray wound list gate.
- [ ] `game-main.ts`, next to `setOwnerRefold`:
  ```ts
  /** Per-ray wound list (march.wgsl.ts, counts2.w): build the reachable
   *  wound set once per pixel and fold only those. OFF is bit-identical. */
  setWoundList(on: boolean) {
    for (const a of actors) a.view.uniforms.counts2.value.w = on ? 1 : 0;
  },
  get woundList() { return (actors[0]?.view.uniforms.counts2.value.w ?? 0) > 0.5; },
  ```
- [ ] `scripts/sdf-game-bench.mjs`: add leg `'wound-list-on': { setWoundList: true },` beside `'owner-refold-off'`, and `__sdfGame.setWoundList(false);` in the ship-defaults reset block right after `setOwnerRefold(true)`. `node --check scripts/sdf-game-bench.mjs`.
- [ ] `npx tsc --noEmit -p .` and `npx vitest run src/lab/sdf-zombie/webgpu/` — all green (the suite prints a pre-existing soldier `sheet` warning; that is not a failure).

#### Step 4 — parity gate (the frame must not change)

Write `docs/dev-notes/2026-09-07-per-ray-wound-list/parity.mjs` modelled on the CDP plumbing in `scripts/sdf-game-bench.mjs` (`connect`, `evaluate`, `Page.captureScreenshot`). Start servers with the shared lifecycle: `. scripts/lab-servers.sh; lab_servers_up` on `LAB_VITE_PORT=5277 LAB_CDP_PORT=9277` (see `scripts/sdf-game-bench.sh` for the exact incantation).

- [ ] Boot `sdf-game.html`, wait for `__sdfGame.backend === 'webgpu'`, settle 3 s.
- [ ] Carve wounds deterministically: `await __sdfGame.bench({ room: 3, mode: 'throughput', warmup: 20, walkFrames: 10, fireFrames: 90, gibFrames: 10, chunkFrames: 10 })` — this fires the scripted shots and leaves the page with ~16 wounds (read `__sdfGame.bench`'s census in the result to confirm `wounds >= 8`). Then `__sdfGame.freeze(true)`.
- [ ] Capture FOUR frames with `__sdfGame.setLoopRunning(false)` and `__sdfGame.step(1/60)` ×3 before each `Page.captureScreenshot`: `off-a`, `off-b`, `on`, `off-c` (set `__sdfGame.setWoundList(true/false)` between). Save PNGs beside the script.
- [ ] Diff with Python PIL (available: `python3 -c "from PIL import Image"`): count pixels with channel delta > 8 for `off-a` vs `off-b` (the same-state noise floor) and `off-a` vs `on`. **Gate: on-vs-off differing pixels must be ≤ 1.5× the off-vs-off floor, and the diff mask must show no silhouette edges or filled regions** — LOOK at the mask image (you have vision); scattered single pixels are frame noise, a crater-shaped blob is a dropped wound. Record both counts in the notes.
- [ ] If the gate fails: the reach in the preload is too small for the probes. Widen `RAY_CULL_SLACK` usage in the preload only (never shrink the loop's reach) and re-run. If it still fails, STOP and write up what differs — do not ship a lossy list.

#### Step 5 — bench

- [ ] Machine must be quiet: `sysctl -n vm.loadavg` first number < 4.5, and no other Chrome/vite you started. If it is not quiet, wait; do not bench on a loaded machine.
- [ ] Run:
  ```sh
  BENCH_OUT=/tmp/wound-list-bench BENCH_PASSES=1 BENCH_LEGS=baseline,wound-list-on BENCH_ROOMS=3,4 BENCH_REPEATS=3 LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 scripts/sdf-game-bench.sh
  ```
- [ ] Copy `/tmp/wound-list-bench/passes.md` and `passes.json` into the notes folder. Read `## Repeatability` FIRST. Then compare `sdf:march` per segment (walk / fire / gib) for the two legs in each room. A delta smaller than either leg's spread is UNRESOLVED, not a win and not a loss — say so.

#### Step 6 — notes + commit

- [ ] Write `docs/dev-notes/2026-09-07-per-ray-wound-list/notes.md`: what was built (three code sites), the parity numbers with the mask verdict, the bench table (fire and gib rows, both rooms, per-rep values), the repeatability table, and a one-paragraph verdict: ship candidate / park / unresolved. If ~0, say plainly that the wound loop's per-step loads are not the near-wound cost and point at the inside-flesh rows as the remaining suspect.
- [ ] Commit everything on the task branch with a message that states the verdict in its first line.

## Acceptance criteria

- `npx tsc --noEmit -p .` clean; `npx vitest run src/lab/sdf-zombie/webgpu/` green; new test pins the reach formula in both places.
- Gate OFF is the shipped shader (loop iterates identically); parity captures prove ON differs from OFF by no more than the same-state noise floor with a noise-shaped mask.
- Bench run on a quiet machine, both rooms, three repeats, spread reported next to every delta.
- Notes file with a verdict; committed.
