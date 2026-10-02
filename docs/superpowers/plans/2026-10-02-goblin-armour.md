# Goblin armour Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the goblin's clipping metal kit with football-pad pauldrons, crossed bandoliers, a utility belt, mesh boots and cuffs, and painted dark-grey pants and shirt, all fitted to the phase-1 body and rusted.

**Spec:** `docs/superpowers/specs/2026-10-02-goblin-armour-design.md` — read it first.

**Architecture:** Flesh-side clothing (pants, undershirt) is `color=` paint in `goblin.blob`, so it cannot clip. Every hard piece is a WAM loft or attach in `goblin-kit.wam`, compiled to the committed `goblin-kit.gltf` by `scripts/build-wam-kit.sh`, with every ring sized from a measurement script that marches the new `sdBody`. Finish (shine, rust) lives in `webgpu/kit-overlay.ts`'s LOOK table and in WAM textures.

**Tech Stack:** `.blob`, WAM (`~/Projects/2026/wam`), TypeScript, three.js WebGPU, Vitest, headless-Chrome turntable (`npm run blob:shot`).

## Rules for every task

- Work ONLY in this worktree. Never `git stash`. `node_modules` is in place — do not reinstall.
- **Targeted tests only:** `npx vitest run src/lab/sdf-zombie/characters/goblin-kit.test.ts src/lab/sdf-zombie/characters/goblin-blob.test.ts` plus `npx tsc --noEmit`. The full `src/lab/sdf-zombie/` suite runs once, in Task 8.
- **Headless capture only.** Frames: `LAB_TMP=<scratch> BLOB_DIST=1.3 npm run blob:shot -- goblin`; posed: add `BLOB_POSE=walk`. Look at the frames yourself and say what is wrong, not "looks fine".
- **Every number has a source** in the comment beside it: a measurement (say from what) or "eyeballed, frame N". The kit numbers come from the measure table (Task 1), never from the old kit.
- **WAM facts that bite:** palette entries are `<name> #rrggbb` only (no `metal=`/`rough=`). `kind=box` attach emits exactly 8 vertices. Every limb-wrapping piece is an open shell (`cap none`) — a `cap flat` puts a disc through the limb. `style chunky` is 8-sided: a facet midpoint sits at 92.4% of the ring radius, so rings take +6–10% margin over measured flesh. `WAM` pitch on `down` bones is the negation of `.blob`'s.
- **One piece per task, one render per task.** The owner reviews visual changes one step at a time; do not batch tasks.
- Rebuilding the kit: `scripts/build-wam-kit.sh goblin` (verified byte-identical on the unmodified kit, 2026-10-02).
- Extracted Blood assets are never committed.

## File structure

| File | Responsibility |
| --- | --- |
| `scripts/tmp/measure-goblin.ts` (create) | Marches the goblin's limb-isolated clusters; prints the ring table. Disposable, like `measure-soldier.ts`. |
| `src/lab/sdf-zombie/characters/goblin.blob` (modify) | Paint: pants, undershirt. Comments only otherwise. |
| `src/lab/sdf-zombie/characters/goblin-kit.wam` (modify) | All mesh armour. |
| `src/lab/sdf-zombie/characters/goblin-kit.test.ts` (modify) | Material list, fit (no vertex inside flesh) and a new standoff bound (no piece floats). |
| `src/lab/sdf-zombie/characters/goblin-blob.test.ts` (modify) | Pins that the pants/shirt prims carry paint. |
| `src/lab/sdf-zombie/webgpu/kit-overlay.ts` (modify) | LOOK entries for the new materials. |
| `public/assets/lab/goblin-kit.gltf` (rebuilt) | Compiled kit, committed. |
| `docs/dev-notes/2026-10-02-goblin-armour/` (create) | Measure table, frames, notes. |
| `docs/tasks/characters.md`, `TASKS.md` (modify) | Status. |

---

## Task 1: Measure the new body

**Files:** create `scripts/tmp/measure-goblin.ts`, `docs/dev-notes/2026-10-02-goblin-armour/measure.md`.

- [ ] **Step 1: Copy and adapt.** `cp scripts/tmp/measure-soldier.ts scripts/tmp/measure-goblin.ts`, change the `.blob` path to `goblin.blob`, and replace the section list at the bottom with the goblin's: pelvis (`boneAt('pelvis', t)` for t 0.2/0.5/0.8), `spine1` (0.2/0.5/0.8), `chest` (0.2/0.5/0.8/0.95), `upperarm`/`forearm` (0.1/0.5/0.9) using the `['arm']` cluster, `thigh`/`shin` (0.1/0.5/0.9) using `['leg']`, the shoulder orb at `clavicle` t=1.0, and the foot (heel, ankle, ball, toe — march along ±X and +Y from points on the `foot` bone). Torso sections use `sdClusters(p, ['torso'])`.
- [ ] **Step 2: Run.** `npx tsx scripts/tmp/measure-goblin.ts > docs/dev-notes/2026-10-02-goblin-armour/measure.md`. Expected: no `BUILD ERRORS`, a `w=`/`d=` row per section, every `w` between 0.04 and 0.30 m. A `--` means the start point was outside the flesh: fix the section's `t`, do not skip it.
- [ ] **Step 3: Convert to height fractions** (÷ 1.30) beside each row and add the old-vs-new comparison for the three sections the old header quotes (upperarm t0.18 w=0.055, hips t0.62 w=0.126 d=0.174, shin w=0.055), so the size of the phase-1 change is on record.
- [ ] **Step 4: Commit.** `git add scripts/tmp/measure-goblin.ts docs/dev-notes/2026-10-02-goblin-armour/measure.md && git commit -m "docs(goblin): measured ring table for the phase-1 body"`.

## Task 2: Painted pants and undershirt; retire the fauld, cleaver and buckler

**Files:** modify `goblin.blob` (torso bars 173–176, leg bars 344–354), `goblin-kit.wam`, `goblin-blob.test.ts`, `goblin-kit.test.ts`.

- [ ] **Step 1: Look at how paint behaves first.** `grep -n "color=" src/lab/sdf-zombie/characters/soldier.blob | head` and read the soldier's `palette` hex format (`color=5c5d41`, bare hex, no `#`). Paint one leg prim only, shoot it, and see whether the body grain (`grain 0.10`, palette-level) leaves a plausible cloth read or a flesh read. Record the answer in `notes.md`. If grain flattens the cloth, the fix is a colour/gloss choice here, not a renderer change.
- [ ] **Step 2: Failing pin.** In `goblin-blob.test.ts` add:

```ts
it('wears painted pants and a painted undershirt', () => {
  const painted = (limb: string, bone: string) =>
    body.prims.filter(p => p.limb === limb && p.bone === bone && p.color !== undefined);
  expect(painted('leg', 'thigh').length, 'thigh pants').toBeGreaterThan(0);
  expect(painted('leg', 'shin').length, 'shin pants').toBeGreaterThan(0);
  expect(painted('torso', 'pelvis').length, 'pelvis trousers').toBeGreaterThan(0);
  expect(painted('torso', 'spine1').length, 'undershirt').toBeGreaterThan(0);
});
```

Run `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts`. Expected: FAIL. If `p.bone`/`p.color` are not the real field names, read `types.ts`'s `Prim` and use those; do not guess.
- [ ] **Step 3: Paint.** Add `color=` to the pelvis bar and blob, both thigh bars, and the shin bar (dark fatigue grey: start at `4b4d4f` for pants and `3d3f41` for the shirt on the spine1/chest bars; tune in the render). Foot, shin ankle knob and hands stay unpainted. Comment each paint line with who asked for it (owner, 2026-10-02) and why the foot is unpainted (the boot covers it).
- [ ] **Step 4: Remove from `goblin-kit.wam`:** the `fauld` loft, the `cleaver` group and the `shield` group, with a short comment that the refinement spec retired both weapons and phase 3 re-arms the goblin. Update `goblin-kit.test.ts`'s material list (`brass` is still used by the buckle).
- [ ] **Step 5: Rebuild and test.** `scripts/build-wam-kit.sh goblin`, then the two goblin test files. Expected: PASS.
- [ ] **Step 6: Render and look.** `blob:shot`, frames 00/02/04. Check: pants read as cloth, no flesh showing at the crotch, no pelvic skirt, no cleaver or buckler.
- [ ] **Step 7: Commit** `feat(goblin): painted dark pants and undershirt; retire fauld, cleaver and buckler`.

## Task 3: Boots, cuffs and knee plates

**Files:** modify `goblin-kit.wam`, `goblin-kit.test.ts`.

- [ ] **Step 1: Failing standoff test.** Add to `goblin-kit.test.ts`:

```ts
// A piece must not float. sdBody(v) is the distance from a kit vertex to the
// flesh surface (positive = in air). The bound is per material and comes from
// the measured fit, with the reason beside it.
const maxStandoff = (name: string) =>
  Math.max(...groups.get(name)!.map(v => sdBody(body, v)));

it('boots and cuffs hug the leg (no floating)', () => {
  expect(maxStandoff('boot')).toBeLessThan(BOOT_STANDOFF_MAX);
});
```

with `const BOOT_STANDOFF_MAX = <number>` set in Step 5 from the measured fit (do not set it from a guess). Run: FAIL (no `boot` material yet).
- [ ] **Step 2: Boot design.** In the WAM: a `boot` material (`#2b2a28`) and `cuff` (`#3a3b3d`). Boot shaft = chain loft `bones=shin..shin` from shin t0.55 to the ankle, rings from the Task 1 table +8%. Foot shell = free-ray loft along the foot bone (as the existing boot does) sized from the measured heel/ball/toe, pointed toe, `cap end=point`. If the toe ring cannot clear the flesh foot without a leak, delete the flesh foot prims at `goblin.blob:353-354` as `soldier.blob:154-165` did and leave the removed lines in a comment as the restore. Cuff = a short wider loft at the boot top (shin t0.50–0.62), open shell. Knee plate = small `shape=squarish` loft on `bones=thigh..shin` at the knee, as `soldier-kit.wam:180` does.
- [ ] **Step 3: Rebuild, run tests, shoot rest and `BLOB_POSE=walk` frames.** Check heel, sides, instep and the knee in both. Fix by changing ring numbers, not by raising a bound.
- [ ] **Step 4: Set `BOOT_STANDOFF_MAX`** to the measured max rounded up to the next millimetre, with a comment of the value and the piece it comes from. Run tests: PASS.
- [ ] **Step 5: Commit** `feat(goblin): rebuilt boots, cuffs and knee plates fitted to the sinew body`.

## Task 4: Utility belt

**Files:** modify `goblin-kit.wam`, `goblin-kit.test.ts`.

- [ ] **Step 1:** Belt = `bones=hips..hips` loft, leather, rings from the pelvis section of the Task 1 table +8%, `cap none`. Buckle = existing brass `attach`, re-seated on the new surface. Pouches = box attaches at the *front corners* (x ≈ ±0.9 × belt half-width, z forward), plus one back pouch, all `on=belt`-free and hand-placed (the `on=` inset buried the buckle before) and checked by the fit test.
- [ ] **Step 2:** Add `belt`/`pouch` to the material list in the test if they are new materials; extend the standoff test to cover them.
- [ ] **Step 3:** Rebuild, test, shoot rest and walk frames. Check: no pouch swallowed by the forearm in the walk frames, belt rides the new waist.
- [ ] **Step 4: Commit** `feat(goblin): utility belt with front-corner and back pouches`.

## Task 5: Pauldrons and chest plate

**Files:** modify `goblin-kit.wam`, `goblin-kit.test.ts`.

- [ ] **Step 1: Pauldron.** Keep the existing technique (spherical shell sized as `sqrt(R² − s²)` around the shoulder orb, which is now **r 0.038**, no longer 0.054; recompute R, the start offset and the arm axis from the new `clavicle`/`upperarm` bones, not the old numbers). Make it bulbous: rings swell to about 1.5× the orb before the lip, then a second, wider overlapping lip loft below it, like the reference. Inner rim may tuck into the chest; bound it in the test as before, re-derived from the new anatomy.
- [ ] **Step 2: Chest plate.** Shallow plate/yoke on `chest`, rings from the chest table +10 mm margin (smooth-min bulges between samples), reaching from between the pauldrons to the sternum, ending well above the belt. Frame `fwd`.
- [ ] **Step 3:** Rebuild, test, shoot rest + `BLOB_POSE=walk` frames. Check against the reference: shoulders dominate the silhouette; plate does not float at the neck; arm swing does not drive the pauldron lip through the torso.
- [ ] **Step 4:** Update the tuck bound with its derivation comment, add `chest`/`pauldron` standoff pins if they are separate materials, commit `feat(goblin): football-pad pauldrons and shallow chest plate`.

## Task 6: Bandoliers

**Files:** modify `goblin-kit.wam`, `goblin-kit.test.ts`.

- [ ] **Step 1:** Two straps (leather, free-ray lofts on `chest`, one each diagonal, crossing at the sternum), each a flat shell 2.5 cm wide standing 5 mm proud of the plate and the shirt. Cartridges: `attach kind=box` brass, 10 per strap at even spacing along the strap, each 8 vertices; generate the 20 attach lines with a small shell loop and paste the output into the `.wam` (WAM has no loops), keeping the generator one-liner in a comment.
- [ ] **Step 2:** Test: every cartridge's centre has `sdBody` between 0 and the strap standoff (proud of flesh, not floating, not buried), and the vertex count is `20 × 8`.
- [ ] **Step 3:** Rebuild, test, shoot. Check the X reads from the front, and the back strap hides under the pauldron edge rather than slicing the arm.
- [ ] **Step 4: Commit** `feat(goblin): crossed bandoliers with brass cartridges`.

## Task 7: Rust and wear

**Files:** modify `goblin-kit.wam` (`textures`), `webgpu/kit-overlay.ts` (LOOK), possibly `public/assets/lab/` (baked rust PNG).

- [ ] **Step 1: Check what WAM's texture DSL can do.** Read `~/Projects/2026/wam/SPEC.md` for the `textures` section. Try the smallest case: a `rustplate` texture with `base=#5a5d60`, one `noise scale=0.07 amount=0.35` and look at whether any op takes a colour. Result goes in `notes.md`.
- [ ] **Step 2a (if WAM can colour patches):** author `rustplate` with a base steel, `noise` for patching, `ao` for crevices, and a rust-coloured layer. Step 2b (if it cannot): paint the rust map with a small script into a PNG under `docs/dev-notes/2026-10-02-goblin-armour/` and apply it through the kit's UV/material path; say in the notes which was needed.
- [ ] **Step 3: Material.** Pauldrons, chest plate and knee plates move to `rustplate`; the cleaver/shield are gone, so nothing else uses `iron`. Add `rustplate` to `LOOK` in `kit-overlay.ts` as a worn steel, **between** the owner's shiny iron (0.72 / 0.16 / 1.15) and the dull soldier plate (0.45 / 0.60 / 0.25): start at metalness 0.55, roughness 0.38, envIntensity 0.7 and tune from the render. Note the existing warning: stronger env makes shadow-side views read pale-blue plastic.
- [ ] **Step 4: Rivets.** Small brass-or-iron box attaches along pauldron lips and plate edges (8 vertices each), counted in the test the same way as the cartridges.
- [ ] **Step 5:** Rebuild, test, shoot rest and walk. Check: rust reads as wear and not as dirt on a toy; edges are the worst-worn.
- [ ] **Step 6: Commit** `feat(goblin): worn, rusted plate and rivets`.

## Task 8: Gates and board

- [ ] **Step 1:** `npm run blob:render-check -- goblin`. Expected: exit 0.
- [ ] **Step 2:** `LAB_TMP=<scratch> BLOB_DIST=1.3 npm run blob:shot -- goblin`, then again with `BLOB_POSE=walk` and `BLOB_POSE=run`. Copy the final frames into `docs/dev-notes/2026-10-02-goblin-armour/`.
- [ ] **Step 3:** `npx tsc --noEmit`, then `npx vitest run src/lab/sdf-zombie/`. Expected: all pass, or every failure listed in the notes with its cause. Do not claim a pass from the scoped run.
- [ ] **Step 4:** Update `docs/tasks/characters.md` (phase 2 status, what remains: held weapons, rig) and `TASKS.md`.
- [ ] **Step 5:** `~/go/bin/dualmem checkpoint --task "goblin armour phase 2" --status in_progress|completed ...`.
- [ ] **Step 6: Commit** `docs(goblin): armour phase 2 frames, notes and board`. The owner's look at the turntable is the gate; do not mark phase 2 done before it.

## Self-review (spec coverage)

- Painted pants + undershirt → Task 2. Boots, cuffs, knee plates → Task 3. Belt → Task 4. Pauldrons, chest plate → Task 5. Bandoliers → Task 6. Rust, wear, rivets → Task 7. Fauld/cleaver/buckler removal → Task 2. Re-measure → Task 1. Posed check → Tasks 3–5 and 8 (render-based, `BLOB_POSE=walk|run`). Gate → Task 8.
- **Known limit, stated openly:** the kit ring numbers cannot be written into this plan, because they are the output of Task 1. The plan fixes their derivation (flesh + margin) and where they go, not their values.
- **Known limit:** the posed check is visual (walk/run frames), not a vertex-level skinning test. A skinned posed unit test would need the kit's skinning evaluated in Vitest, which no test does today.
