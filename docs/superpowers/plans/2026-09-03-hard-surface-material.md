# Hard surface, part two: the material pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a `box` plate shade like metal instead of like polished skin,
and give the grammar its first emissive.

**Architecture:** Three independent shading changes on one lever family.
`gloss` gains a fifth term (noise suppression); `metal` becomes a separate
`prof` bit that tints specular and suppresses diffuse; `glow` becomes a
per-prim float in a documented-spare lane. Nothing here touches the SDF.

**Tech Stack:** TypeScript, WGSL, vitest, tsx.

**Follows:** [`2026-09-03-hard-surface-material-design.md`](../specs/2026-09-03-hard-surface-material-design.md) — read it first; it carries the verified scope facts.

---

## Read before starting

**Baseline: `npx vitest run src/lab/sdf-zombie/` green at 2267 tests / 118 files.**

Three facts the spec verified, repeated because each one saves a wrong turn:

- **`march.glsl.ts` is FROZEN** (`march.wgsl.ts:59`). WGSL only.
- **No CPU field parity is owed** — `validate.ts:681` says the noise is
  silhouette-shell only. CONFIRM it; do not assume it.
- **`prof` bit 4 (16) is safe** — every `prof` read is a bit mask now.

**The recurring failure mode this session has been tests that pass whether or
not the feature exists.** Mutation-verify every new test — break the
implementation deliberately, confirm the test goes red, report the matrix.
Three separate suites were caught passing vacuously.

---

### Task 1: `gloss` suppresses the flesh's own noise

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Test: a new or existing wgsl-level test; `src/lab/sdf-zombie/webgpu/` has the pattern

**The defect.** `surfaceNoiseAmp` (`surfCfg2.y`) perturbs the normal at
`march.wgsl.ts:1966`, and `silhouetteNoiseAmp` (`marchCfg.z`) displaces the
real field — both body-wide, both applied long before the shader knows the
prim is painted. Milled steel gets bull-hide pores and a rippled flat face.

**The fix.** Scale both by `(1 - gloss)` at the point of application. `hitBest`
is already resolved at line 1804, so the `ROW_PRIM_COLOR` read that line 2226
performs can be hoisted or repeated.

- [ ] **Step 1: Write the failing test** — a high-gloss prim's shaded normal
must be materially closer to the analytic normal than a gloss-0 prim's under
the same `surfaceNoiseAmp`. State the threshold and where it came from.

- [ ] **Step 2: Run and verify it fails.**

- [ ] **Step 3: Implement.** Keep the existing amplitude guard
(`if (surfCfg2.y > 0.0)`) — it skips six noise lookups and must not become
unconditional.

- [ ] **Step 4: Verify** — full suite green against 2267, tsc clean.

- [ ] **Step 5: THE ACCEPTANCE IS A RENDER, NOT AN ARGUMENT.** Four prims
outside the minotaur set `gloss` above 0.85, all of them eyes or lenses:
`cyclops.blob:181`, `cyclops.blob:185`, `mouse.blob:359`, `mouse.blob:364`.
Run `BLOB_DIST=3.0 npm run blob:shot` on **minotaur, cyclops and mouse** before
and after, `Read` the frames, and say what you SEE. The claim that losing
pitting improves a lens is a prediction; frames are evidence. **If cyclops or
mouse looks worse, say so and stop** — that is a good outcome and it changes
the design.

- [ ] **Step 6: Mutation-verify, then commit**

```bash
git commit -m "shader: gloss suppresses the flesh's micro-detail and silhouette noise"
```

---

### Task 2: the `metal` modifier

**Files:**
- Modify: `blob-parse.ts` (bare word), `types.ts` (`PrimDef`), `pack.ts`
  (`prof` bit 4 **and the `shaped` flags**), `webgpu/march.wgsl.ts`
- Modify: `characters/blob.d.ts` and the grammar docs
- Test: `blob-parse.test.ts`, `pack.test.ts`, a wgsl test

**THE TRAP — read this before writing any code.** `pack.ts` computes a
`shaped` flag at cluster level (`pack.ts:225`) and group level (`pack.ts:248`),
and the shader **skips `ROW_PRIM_SHAPE` entirely** for a group whose flag is
clear (`march.wgsl.ts:1144`). A prim that is ONLY `metal` — no taper, chamfer,
bend, shell or box — would therefore have its bit silently dropped and shade
as ordinary paint, with no error anywhere.

**This exact bug was found and fixed in these same two lines this session**:
the group-level flag omitted `p.shell`, and `schoolgirl-alt`'s cape had been
drawing as a solid blob for weeks as a result. Add `p.metal` to BOTH, and
**write a test whose prim is metal and nothing else** — a test on a
`box metal` prim would pass with the flag missing and prove nothing.

- [ ] **Step 1: Failing tests** — (a) `metal` sets `prof` bit 4; (b) a
metal-ONLY prim survives the `shaped` gate at both levels; (c) `metal` without
`color=` is a parse error with a message in the house voice (copy
`blob-parse.ts:168`); (d) every existing character's packed `prof` values are
byte-identical.

- [ ] **Step 2: Run and verify they fail** — (b) is the one that matters.
If (b) passes before you touch `pack.ts`, your fixture is not metal-only.

- [ ] **Step 3: Implement the shading** at the composite near
`march.wgsl.ts:2387`: tint the specular by the prim albedo, suppress the
diffuse to a floor. **Report the floor you chose and what it looks like at
zero** — a true zero goes black in a one-key lab with no environment map.

- [ ] **Step 4: `metal` implies Task 1's noise suppression** even with no
`gloss=`. Test it, and document it on the grammar line.

- [ ] **Step 5: Verify + mutation-verify + render.** Apply `metal` to the
minotaur's five plate lines and shoot it. Does it read as steel? Say plainly
if it does not.

- [ ] **Step 6: Commit**

---

### Task 3: per-prim `glow=0..1`

**Files:**
- Modify: `blob-parse.ts`, `types.ts`, `pack.ts`, `webgpu/march.wgsl.ts`
- Test: `blob-parse.test.ts`, `pack.test.ts`, a wgsl test

**Why it does not exist yet.** `faceGlow` is the only emissive path and it is
multiplied by `(1.0 - decal)` at `march.wgsl.ts:2179` — deliberately off in
decal mode so a photographic bake does not self-illuminate in a dark corridor.
The minotaur uses `decal 1`, so its baked red eyes cannot glow at all.

**The design.** `glow=` beside `color=`, gated on it exactly as `gloss=` is.
**The glow colour is the prim's own `color=`** — no new colour field. Packed
into `primClip.w`, which is documented spare at `march.wgsl.ts:126` and
written as literal `0` on both branches of `pack.ts:212`.

- [ ] **Step 1:** Write both branches. The shell branch writes
`[nx, ny, nz, 0]` today; a glowing shell must still glow.

- [ ] **Step 2: Rewrite `ROW_PRIM_CLIP`'s docstring.** It says "w spare".
Leaving that lie in the row table is how the next person packs over it.

- [ ] **Step 3: Resolve the face interaction and write down the reasoning.**
`march.wgsl.ts:2234` zeroes `faceGlow` on painted prims so painted eyes cannot
shine through sunglasses. Per-prim glow must not resurrect that. Decide the
precedence, test it, comment it.

- [ ] **Step 4: Verify, mutation-verify, and prove it visually** — add two
small `color=ff2200 glow=0.9` eye prims to the minotaur's skull, shoot it, and
`Read` the frames. Glowing red eyes in the dark, or say why not.

- [ ] **Step 5: Commit**

---

### Task 4: the honest verdict

- [ ] Shoot **minotaur, cyclops, mouse and schoolgirl-alt** at
`BLOB_DIST=3.0`, `Read` every frame, and write the verdict into
`docs/dev-notes/2026-09-03-hard-surface-material/notes.md`.
- [ ] Report prim and cluster budgets for the minotaur (it is at 48/128 and
**6 of 6 clusters**, which is a hard ceiling — flag it if anything added a
seventh).
- [ ] `npm run blob:render-check -- minotaur` must stay at 0 hole clusters.
- [ ] **A "no" is a fine outcome.** Every brief this session that asked for one
got a useful one. The question is narrow: *do the plates read as metal, and
did anything else get worse?*

---

## Done when

- Full suite green, no regressions against 2267; tsc clean
- `march.glsl.ts` untouched
- A metal-ONLY prim survives the `shaped` gate at both cluster and group level
- Every existing character's packed `prof` is byte-identical except where
  `metal` was authored
- `ROW_PRIM_CLIP`'s docstring no longer says "w spare"
- Frames looked at for four characters, verdict written down
