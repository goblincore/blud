# Goblin Body (Refinement Phase 1) Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Re-author `goblin.blob`'s body as the owner's pick, variant A "sinew": a continuous tapered torso with the
gut in front and a flat back, tapered limbs with no joint orbs (the hands, the shoulder round, the ankle and toe stay),
spine beads and neck cords. The head, palette, skeleton and first-person arms stay unchanged.

**Spec:** `docs/superpowers/specs/2026-10-01-goblin-refinement-design.md` (phase 1). Read it first.
**Look-dev:** `docs/dev-notes/2026-10-01-goblin-body-lookdev/` (the variant sheet; `goblin-a-sinew.blob`).

**Architecture:** data-only. The change is `.blob` text in `src/lab/sdf-zombie/characters/goblin.blob`, which compiles
to `BodyDef` through the existing Blobforge pipeline. There is no grammar change and no renderer change. Three new pins in
`characters/goblin-blob.test.ts` (TDD: written first, failing on the old body) state what "smoother" means in numbers.
Every existing pin was measured against the target body on 2026-10-01 and passes unchanged.

**Tech Stack:** `.blob` (Blobforge), TypeScript, Vitest, the lab turntable (`npm run blob:shot`, headless WebGPU Chrome),
`npm run blob:render-check`.

## Rules for every task

- Work only in this worktree. Never `git stash`. `node_modules` is symlinked; do not reinstall.
- **Targeted tests only** (`npx vitest run <files>`) plus `npx tsc --noEmit`. Never the bare full suite: it has OOMed
  this 24 GB machine while dispatch tasks were running.
- **Headless capture only.** The in-app browser pane loses the WebGPU device. Use `npm run blob:shot` /
  `blob:render-check`, which start and stop their own servers. Set `LAB_TMP=.lab-tmp` (gitignored) or you get no frames.
- **Prove visual claims with the frames:** `Read` them yourself before saying anything about how the body looks.
- **Every number in the `.blob` has a source in its comment**: measured, from the owner-picked look-dev variant, or
  eyeballed in a named frame. Rewrite stale comments; do not leave the old body's reasoning above new numbers.
- **Within one limb, primitive order is fold order.** Keep each limb's lines contiguous, in the order given here.
- **A pin that catches a real defect is never re-baselined to pass.** That means a detached arm, an arm through the
  torso, or a broken stance. Change the body instead. A pin that moved because the body moved on purpose gets its new
  measured number and a comment saying why.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders. Never commit them.

## Facts measured on 2026-10-01 (so you know what "expected" means)

The target body below, compared with today's `goblin.blob`:

| Property (test) | Old body | Target | Pin |
| --- | --- | --- | --- |
| Arm daylight below the elbow, L/R (`:79`) | 43.6 mm | 48.5 mm | > 30 mm |
| Upper-arm daylight at 0.11 m (`:89`) | 29.0 mm | 19.2 mm | > 15 mm |
| `fusedOf(arm, torso)` (`:98`) | −2.0 mm | −2.7 mm (shoulder marked `core`) | < 0 |
| Arm-to-leg `clearOf` (`:105`) | 22.7 mm | 22.4 mm | > 10 mm |
| Hip / height (`:118`) | 0.542 | 0.542 | > 0.50 |
| **New:** deepest dip in the torso-only half-width profile (arms and legs off) | 20.5 mm | 5.0 mm | < 10 mm |
| **New:** gut (front − back reach) at pelvis 0.8 / spine1 0.3 | 0.0 / −9.5 mm | 27.0 / 15.0 mm | > 15 / > 8 mm |
| **New:** point-blobs on arms and legs outside the allowed set | 4 | 0 | 0 |

Three traps were found on the way, so you do not rediscover them:

- **Variant A's look-dev shoulder round (r 0.038) seems to detach the arm, but does not.** `fusedOf` reads +3.4 mm because
  its probe starts from the cluster's fattest prim, and the hand (0.046 × deep 0.90 = 0.0414) out-ranks a slim shoulder;
  the probe then runs hand-to-torso through air. Daylight and `validateBody` are unchanged. The fix is to mark the
  shoulder round `core` (the skill's triage table), which fuses at −2.7 mm with r 0.038. (A first draft of this plan
  grew it to r 0.042 instead, which passes only by out-ranking the hand by 0.6 mm; Task 3's review caught it.)
- **At the look-dev chest width (`wide=1.06`) the upper-arm daylight is 15.0 mm**, on the pin's line. `wide=1.00` gives
  19.2 mm. Width in x is the budget the arms compete for (see the skeleton block's shoulder note).
- **All 16 test files that read the goblin pass against the target**: 498 tests, including `goblin-kit.test.ts`. The
  spec allowed for quarantining the kit test; it is not needed.

---

### Task 1: Pin "smoother" with three failing tests

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin-blob.test.ts` (imports at the top; new tests before the final `});`)

- [ ] **Step 1: Add the imports and helpers**

  At the top of `goblin-blob.test.ts`, add `sdBody`, `lerp` and the `Vec3` type to the imports, so the import block
  reads:

```ts
import { describe, it, expect } from 'vitest';
import src from './goblin.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf } from '../blob-checks';
import { sdBody } from '../validate';
import { lerp } from '../vec';
import type { Vec3 } from '../types';
```

  After the existing `const limb = ...` line, add:

```ts
// Distance from p along the unit direction d to the body's surface (where the field turns positive), in 0.5 mm steps.
// Throws if p starts outside the body or the ray never leaves it: either would read as a plausible width.
const reach = (b: ReturnType<typeof built>, p: Vec3, d: Vec3, max = 0.3): number => {
  if (sdBody(p, b) > 0) throw new Error(`reach: start (${p.join(', ')}) is outside the body`);
  for (let t = 0; t < max; t += 0.0005)
    if (sdBody([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t], b) > 0) return t;
  throw new Error(`reach: no surface within ${max} m of (${p.join(', ')})`);
};
// The point t (0..1) of the way along a resolved bone, head to tail.
const boneAt = (b: ReturnType<typeof built>, name: string, t: number): Vec3 => {
  const bone = b.bones.get(name)!;
  return lerp(bone.head, bone.tail, t);
};
```

- [ ] **Step 2: Add the three tests** before the file's final `});`:

```ts
  // 2026-10-01 refinement (docs/superpowers/specs/2026-10-01-goblin-refinement-design.md). The owner's read of the
  // old body was "a series of orbs": five ellipsoids stacked up the spine at tight blends, and a nub at every joint.
  // These three pin the rebuild (variant A, "sinew"). Unlike the pins above, their thresholds are not owner
  // rejections: each sits between the old body's measured value and the rebuilt one's (2026-10-01).

  // A stacked torso pinches between its rings. Switch the arms and legs off first: with them on, the thighs and the
  // old hip orbs own the bottom of every slice and the profile measures legs. Then slice the torso every 5 mm from
  // the pelvis to high on the chest and read its half-width. The deepest dip, how far a slice falls below the lower
  // of the highs on either side of it, is a pinch between rings. Old body: 20.5 mm, between its two chest
  // ellipsoids. Rebuilt: 5.0 mm, which is the waist.
  it('has one continuous torso, not stacked rings', () => {
    const b = built();
    for (const c of b.clusters) if (c.limb.startsWith('arm') || c.limb.startsWith('leg')) c.alive = false;
    const p0 = b.bones.get('pelvis')!.head;
    const p1 = boneAt(b, 'chest', 0.85);
    const width: number[] = [];
    for (let y = p0[1]; y <= p1[1]; y += 0.005) {
      const t = (y - p0[1]) / (p1[1] - p0[1]);
      width.push(reach(b, [0, y, p0[2] + (p1[2] - p0[2]) * t], [1, 0, 0]));
    }
    let deepest = 0;
    width.forEach((w, i) => {
      const dip = Math.min(Math.max(...width.slice(0, i + 1)), Math.max(...width.slice(i))) - w;
      deepest = Math.max(deepest, dip);
    });
    expect(deepest).toBeLessThan(0.010);
  });

  // deep= scales a prim front and back alike, so a deep torso on the spine's own axis bulges at the back of the
  // waist as much as at the belly (the look-dev's flaw). The gut hangs in front and the back stays flat enough for
  // the spine to read. Rebuilt: belly +27.0 mm, waist +15.0 mm. Old body: 0.0 and -9.5 mm.
  it('carries its gut in front, not bulging at the back', () => {
    const b = built();
    const gut = (p: Vec3) => reach(b, p, [0, 0, 1]) - reach(b, p, [0, 0, -1]);
    const belly = boneAt(b, 'pelvis', 0.8), waist = boneAt(b, 'spine1', 0.3);
    expect(gut(belly)).toBeGreaterThan(0.015);
    expect(gut(waist)).toBeGreaterThan(0.008);
  });

  // No ball joints on the limbs. The orbs that stay are a style the owner kept (early 3D): the hands, the shoulder
  // round (which also attaches the arm), the ankle knob and the toe pad. Any other point-blob on an arm or a leg is a
  // joint orb coming back.
  it('keeps orbs only at the shoulders, hands, ankles and toes', () => {
    const allowed = (p: { bone: string; at: number }) =>
      p.bone === 'hand' || (p.bone === 'foot' && p.at > 0.5) ||
      (p.bone === 'clavicle' && p.at === 1) || (p.bone === 'shin' && p.at === 1);
    const orbs = doc.parts.filter(p => p.kind === 'blob' && (p.limb === 'arm' || p.limb === 'leg'));
    expect(orbs.filter(p => !allowed(p)).map(p => `${p.bone} at=${p.at}`)).toEqual([]);
  });
```

- [ ] **Step 3: Run the file and confirm exactly the three new tests fail**

  Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts`

  Expected: 3 failed, the rest passing.
  - `has one continuous torso`: received about 0.0205.
  - `carries its gut in front`: received about 0.
  - `keeps orbs only at…`: received `["forearm at=0", "forearm at=1", "thigh at=0", "shin at=0"]`.

  If anything else fails, stop: the tree is not where this plan assumes.

- [ ] **Step 4: Type-check**

  Run: `npx tsc --noEmit`
  Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin-blob.test.ts
git commit -m "test(goblin): pin the refinement body (continuous torso, gut in front, orbs only at shoulders/hands/ankles/toes)"
```

### Task 2: Re-author the torso and the neck

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin.blob`, the body block. Replace from the line
  `  # Torso: long and narrow with the gut low, rather than one wide ovoid.` (line 124) through the line
  `  bar head on neck from=0.00 to=1.00 r=0.046 deep=0.94 blend=0.0016` (line 141) inclusive.

> **Review note (2026-10-01, Task 3):** the shoulder round is now r 0.038 marked `core` (see the traps above); the comment
> about the upper arm's daylight no longer ties it to the shoulder's size.
>
> **Review note (2026-10-01):** after this task landed, review revised this block's comments (the daylight claim, the
> blend-width wording, the cords' path, a source line for the retuned values), dropped the gut's no-op `wide=1.00`, and
> re-seated the lowest and third vertebrae at `offset=(0,0,-0.072)` (they were nearly flush). The file is now the
> reference for this text, not the block below.

- [ ] **Step 1: Replace that span with exactly this text**

```
  # Torso: three continuous tapered bars (pelvis, spine, chest), rebuilt 2026-10-01.
  #
  # It used to be five ellipsoids stacked up the spine at blends of 0.004-0.005,
  # and the owner's read was "a series of orbs" (2026-10-01): with fillets that
  # tight every ring stays a ring, and the outline pinched between them (a 20 mm
  # dip in half-width between the chest rings; goblin-blob.test.ts now pins
  # under 10, and the rebuilt torso's deepest is its 5 mm waist). One bar per bone,
  # tapered with r2 and filleted at 0.014-0.016 (about 3 cm once
  # roundBlendScale halves it), is one mass. The body is the owner's pick of
  # three rendered variants, "A, sinew": docs/dev-notes/2026-10-01-goblin-body-lookdev/.
  #
  # Still narrow in x and deep in z, for the reason the skeleton block gives:
  # width in x is the budget the arms compete for. The chest's wide=1.00 is the
  # number that bought the upper arm its daylight back (19.2 mm at 0.11 m; at
  # the look-dev's wide=1.06 it was 15.0, exactly on the test's line).
  #
  # THE GUT HANGS IN FRONT. `deep=` scales a prim front and back alike, so a deep
  # torso on the spine's own axis bulged at the back of the waist as much as at
  # the belly (the look-dev's flaw). The pelvis and spine bars are pushed
  # forward (+z; offsets are world axes) and the gut is its own blob further
  # forward still, so the back stays flat enough for the spine to show: the
  # front reaches 27 mm further than the back at the belly and 15 mm at the
  # waist (measured 2026-10-01; goblin-blob.test.ts pins both).
  bar  torso on pelvis from=0.00 to=1.00 r=0.068 r2=0.074 deep=1.10 offset=(0,0,0.012) blend=0.014
  blob torso on pelvis at=0.80 r=0.060 wide=1.00 tall=1.05 offset=(0,0,0.030) blend=0.016
  bar  torso on spine1 from=0.00 to=1.00 r=0.072 r2=0.068 deep=1.08 offset=(0,0,0.010) blend=0.016
  bar  torso on chest  from=0.00 to=0.95 r=0.068 r2=0.056 wide=1.00 deep=1.12 blend=0.016

  # Spine: vertebrae knuckling through the flat back. Each bead sits just proud
  # of the back surface at its height (offsets are world axes; -z is the back),
  # small and tightly blended so it reads as a bump under skin, not as an orb.
  # Offsets from the look-dev, re-seated on the pushed-forward bars above.
  blob torso on spine1 at=0.15 r=0.012 offset=(0,0,-0.064) blend=0.005
  blob torso on spine1 at=0.55 r=0.012 offset=(0,0,-0.066) blend=0.005
  blob torso on spine1 at=0.95 r=0.012 offset=(0,0,-0.066) blend=0.005
  blob torso on chest  at=0.30 r=0.012 offset=(0,0,-0.068) blend=0.005
  blob torso on chest  at=0.65 r=0.012 offset=(0,0,-0.062) blend=0.005
  blob torso on chest  at=0.98 r=0.012 offset=(0,0,-0.056) blend=0.005

  # Neck: one tapered column (0.040 at the collar to 0.033 under the skull), a
  # pair of cords from the collarbone notch up to behind the ears (the sinew
  # that makes a thin neck read as a neck rather than a pipe), and one more
  # vertebra. Values from the look-dev variant A, owner-picked.
  bar  head on neck from=0.00 to=1.00 r=0.040 r2=0.033 blend=0.010
  blob head on neck at=0.05 r=0.009 r2=0.007 offset=(0.026,0.000,0.018) tip=(-0.012,0.120,-0.030) blend=0.006 both
  blob head on neck at=0.30 r=0.010 offset=(0,0,-0.036) blend=0.005
```

- [ ] **Step 2: Run the goblin's tests**

  Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts`

  Expected: `has one continuous torso` and `carries its gut in front, not bulging at the back` now pass. `keeps orbs only at…` still fails (the
  limbs are Task 3). Everything else passes.
  - If `compiles and validates clean` fails with a breach, the wound-pass ribcage
    (`bar torso on chest from=0.20 to=0.92 r=0.025 wide=1.45 deep=0.55` in the `bones` block) is poking out of the new
    chest. It did not on 2026-10-01; report it rather than guess.

- [ ] **Step 3: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin.blob
git commit -m "feat(goblin): continuous tapered torso with the gut in front and a flat back; neck cords and spine beads (refinement phase 1)"
```

### Task 3: Re-author the arms and legs

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin.blob`, the body block. Replace from the line
  `  # ARMS AND LEGS — ball joints, deliberately.` (about line 252 before Task 2; find it by text) through the line
  `  blob leg on foot at=0.92 r=0.038 wide=1.15 tall=0.70 deep=0.95 blend=0.0030 mirror` inclusive.

- [ ] **Step 1: Replace that span with exactly this text**

```
  # ARMS AND LEGS: tapered bars, no ball joints (rebuilt 2026-10-01).
  #
  # Every joint used to be a nub 1.3-1.8x the shaft it joined, at blends of
  # 0.0014-0.004, on purpose: "shoulder, elbow, wrist, hip, knee, ankle" as
  # orbs. The owner's 2026-10-01 read was "a series of orbs", and the pick was
  # variant A: each segment one bar tapering toward the hand or foot (r2),
  # filleted into the next at 0.010-0.014 so a joint is a soft crease. The orbs
  # that stay are a STYLE, kept on purpose (owner: a throwback to early 3D
  # games): the hands, a small ankle knob, the toe pad, and the shoulder round,
  # which is structural as much as stylistic (below). goblin-blob.test.ts pins
  # that no other point-blob comes back on a limb.
  #
  # The shoulder round is what ATTACHES the arm. At the look-dev's r 0.038,
  # fusedOf read +2.8 mm: the core-to-core path left the flesh and the arm hung
  # on by its fillet. 0.042 is the smallest that fuses (-2.9 mm with the chest
  # at wide=1.00); anything bigger only regrows the orb.
  blob arm on clavicle at=1.00 r=0.042 blend=0.010 mirror
  bar  arm on upperarm from=0.00 to=1.00 r=0.031 r2=0.024 blend=0.010 mirror
  bar  arm on forearm  from=0.00 to=1.00 r=0.027 r2=0.018 blend=0.010 mirror

  # Big grabby hands: still orbs, still r 0.046. goblin-skin.ts hard-codes this
  # radius (GOBLIN_SKIN.handRadius) for the player's first-person hands, and
  # loadHold depends on it. Nothing links the two: change them together. Only
  # the blend widened, 0.0034 -> 0.008, so the wrist runs into the hand
  # instead of meeting it at a seam.
  blob arm on hand at=0.55 r=0.046 deep=0.90 blend=0.008 mirror

  bar  leg on thigh from=0.00 to=1.00 r=0.046 r2=0.031 blend=0.014 mirror
  bar  leg on shin  from=0.00 to=1.00 r=0.034 r2=0.021 blend=0.012 mirror
  # The ankle knob: small, kept as the early-3D accent where shin meets foot.
  blob leg on shin  at=1.00 r=0.026 blend=0.008 mirror

  # Feet: a shaft forward along the foot bone and a toe pad, slimmed to the new
  # shin (they were sized for the old 0.035 shin and 0.038 ankle nub). Splayed
  # and a little oversized for the leg, which is what stops a long-legged
  # creature reading as stilts. Values from the look-dev variant A.
  bar  leg on foot  from=0.05 to=0.80 r=0.028 r2=0.024 tall=0.80 blend=0.010 mirror
  blob leg on foot  at=0.92 r=0.034 wide=1.15 tall=0.70 deep=0.95 blend=0.008 mirror
```

- [ ] **Step 1b: Two wording fixes in the torso comments, from Task 2's review**
  - In the paragraph that lists the retuned bar and gut values, change `keeping the look-dev's silhouette` to
    `keeping the look-dev's front silhouette` (the back was flattened on purpose, by up to 26 mm).
  - In the spine comment, after `Seated by measurement (2026-10-01):`, make the provenance explicit: the chest and neck
    beads keep the look-dev's offsets; the three on `spine1` were moved onto the pushed-forward bars (the look-dev had
    -0.086, -0.084, -0.080). Keep the 5-6 mm / 8.6 mm sentence.

- [ ] **Step 2: Run the goblin's tests**

  Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts`
  Expected: every test passes, including the three new ones.

- [ ] **Step 3: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin.blob
git commit -m "feat(goblin): tapered limbs, orbs only at shoulders/hands/ankles/toes (refinement phase 1)"
```

### Task 4: Update the measured numbers quoted in the test comments

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin-blob.test.ts`, the comments of the two daylight tests (about lines 74–90)

- [ ] **Step 1: Edit the comments** (thresholds unchanged)

  In the "hangs free below the elbow" comment, replace:

```
    // exact stretch the owner rejected: the forearm ran into the gut. Measured
    // at 43.6 mm; 30 mm is roughly where separation became visible from every
```

  with:

```
    // exact stretch the owner rejected: the forearm ran into the gut. Measured
    // at 43.6 mm on the ball-jointed body, 48.5 mm on the 2026-10-01 rebuild;
    // 30 mm is roughly where separation became visible from every
```

  In the "upper arm emerges from the chest" comment, replace:

```
    // 0.11 m clears the shoulder ball (r 0.054) and the deltoid merge above.
    // Measured at 27.8 mm. The failure this catches is the whole upper arm
```

  with:

```
    // 0.11 m clears the shoulder round (r 0.042 since the 2026-10-01 rebuild;
    // it was a 0.054 ball) and the deltoid merge above. Measured at 19.2 mm
    // (29.0 on the old body; the slimmer chest at wide=1.00 is what keeps it
    // above 15: at 1.06 it read 14.99). The failure this catches is the whole upper arm
```

  Also, from the reviews of Tasks 1 and 2:
  - Line 35: `const boneAt = (b:ReturnType<typeof built>` needs a space after `b:` (`(b: ReturnType<typeof built>`).
  - In the torso-continuity test's comment, replace `Old body: 20.5 mm, between its two chest
  // ellipsoids.` with `Old body: 20.5 mm, at the spine/chest joint, between its spine
  // and lower chest ellipsoids.` (keep the line wrapping tidy).
  - In the "upper arm emerges from the chest" test's comment, the old-body clearance profile ("0.6 mm of air 60 mm out,
    20 mm at 115 mm, 32 mm at 143 mm") and "the shoulder ball" describe the ball-jointed body: mark that sentence as
    the old body's ("On the ball-jointed body the clearance rose ..."), and keep the deltoid-merge reasoning.
  - In the gut test's comment, replace `Rebuilt: belly +27.0 mm, waist +15.0 mm.` with
    `Rebuilt: belly +27.0 mm, waist +14.7 mm (pelvis at=0.8, spine1 at=0.3, on the bone axis; reach's 0.5 mm steps
    read the waist as 14.5).` (the waist moved from 15.0 when review re-seated the lowest vertebra).

- [ ] **Step 2: Run and type-check**

  Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts && npx tsc --noEmit`
  Expected: all pass, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin-blob.test.ts
git commit -m "test(goblin): quote the rebuilt body's measured daylight in the pin comments"
```

### Task 5: Run everything that reads the goblin

**Files:** none changed unless a test fails (see below).

- [ ] **Step 1: Run the 16 test files that read the goblin**

```bash
npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts src/lab/sdf-zombie/characters/goblin-kit.test.ts \
  src/lab/sdf-zombie/silhouette.test.ts src/lab/sdf-zombie/pack.test.ts src/lab/sdf-zombie/gait.test.ts \
  src/lab/sdf-zombie/rig-bind.test.ts src/lab/sdf-zombie/taper.test.ts src/lab/sdf-zombie/bend.test.ts \
  src/lab/sdf-zombie/blob-checks.test.ts src/lab/sdf-zombie/blob-emit.test.ts src/lab/sdf-zombie/panel.test.ts \
  src/lab/sdf-zombie/strand-wiring.test.ts src/lab/sdf-zombie/character-registry.test.ts \
  src/lab/sdf-zombie/webgpu/occluder-hull.test.ts src/lab/sdf-zombie/webgpu/goblin-skin.test.ts \
  src/lab/sdf-zombie/webgpu/game-arms.test.ts
```

  Expected: 16 files pass. On 2026-10-01 the target body passed all 498 tests then; the new pins add 3.

  **If one fails:**
  - **`webgpu/goblin-skin.test.ts` or `webgpu/game-arms.test.ts`:** phase 1 changed something it promised not to (the
    hand radius or the palette). Fix the `.blob`, not the test.
  - **`goblin-kit.test.ts`:** the spec allows a quarantine. Change its outer `describe(` to `describe.skip(` with the
    comment `// Quarantined by the goblin refinement phase 1 (docs/superpowers/specs/2026-10-01-goblin-refinement-design.md):
    the kit is refitted in phase 2; do not tune it to the new body here.` Add a line under phase 2 in
    `docs/tasks/characters.md`.
  - **Any other file:** if it pins a property of the goblin that moved on purpose, update the number with a comment
    citing this plan. If it catches a real defect (detached, intersecting, or a breach), fix the `.blob`.

- [ ] **Step 2: Type-check**

  Run: `npx tsc --noEmit`
  Expected: no errors.

- [ ] **Step 3: The directory suite (the spec asks for it), only on a quiet machine**

  First check that no dispatch task is running: `pgrep -fl "claude.*dispatch|pi-harness" || echo quiet`. If it prints
  anything but `quiet`, skip this step and say so in the report. Then run:
  `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run src/lab/sdf-zombie/`
  Expected: passes. A failure outside the 16 files above means something else reads the goblin: apply the same rules
  as Step 1.

- [ ] **Step 4: Commit (only if Step 1 or 3 needed changes)**

```bash
git add -A src/lab/sdf-zombie docs/tasks/characters.md
git commit -m "test: re-baseline goblin-dependent pins for the refinement body"
```

### Task 6: Look at it in the real renderer

**Files:**
- Create: `docs/dev-notes/2026-10-01-goblin-body-lookdev/lab/` (four frames)
- Modify: `docs/dev-notes/2026-10-01-goblin-body-lookdev/notes.md`

- [ ] **Step 1: Render-check (does the GPU agree with the CPU field?)**

  Run: `LAB_TMP=.lab-tmp npm run blob:render-check -- goblin`
  Expected: exit 0.
  - Exit 1 names a hole's location and its owning line. Variant A is mostly tapered bars, and the skill's triage table
    says a perfectly round see-through hole where the CPU field is solid is the occluder hull sizing a tapered prim from
    its fat end (`webgpu/occluder-hull.ts`). That is a renderer bug: report it with the output, do not edit the `.blob`
    to dodge it.
  - Exit 2 means it did not run: read the server logs under `.lab-tmp`.

- [ ] **Step 2: Turntable frames**

  Run: `LAB_TMP=.lab-tmp BLOB_DIST=1.35 npm run blob:shot -- goblin`
  Expected: `.lab-tmp/blob-shot/goblin/frame-NN.png` and an `index.html`.

- [ ] **Step 3: Look at the frames** (`Read` each one) and check, writing down the frame for each:
  1. No stacked rings in the torso, from any yaw.
  2. No orbs at the elbows or knees; the hands, the shoulder rounds and the ankle knobs are the only round accents.
  3. In profile: the gut in front, a flat back, and the spine beads visible along it.
  4. The arms read as separate from the torso, from every yaw.
  5. The head is unchanged from before (ears, hooked nose, lips).

  If any check fails, say which frame and what is wrong, and stop for the owner. Do not tune by eye without a number
  behind the change.

- [ ] **Step 4: Keep four frames** (3/4 front, side, back, 3/4 back; pick the nearest yaws) in
  `docs/dev-notes/2026-10-01-goblin-body-lookdev/lab/`, named by yaw (e.g. `lab-yaw045.png`).

- [ ] **Step 5: Append to `notes.md`**

```markdown
## Built (phase 1)

The rebuilt body in the lab renderer (`npm run blob:shot -- goblin`, BLOB_DIST 1.35), from `lab/`. It is variant A plus
three fixes found while measuring:
- the gut is pushed forward and the back flattened (gut +27 mm at the belly);
- the shoulder round is r 0.042 (at 0.038 the arm detached);
- the chest is wide=1.00 (at 1.06 the upper-arm daylight sat on the 15 mm line).

`blob:render-check`: exit 0.
```

  Add the four frames as images under it, and fill in the render-check result as actually observed.

- [ ] **Step 6: Commit**

```bash
git add docs/dev-notes/2026-10-01-goblin-body-lookdev
git commit -m "docs(goblin): phase 1 body in the lab renderer (turntable frames, render-check)"
```

### Task 7: Hand the gate to the owner

**Files:**
- Modify: `docs/tasks/characters.md` (the "Goblin refinement pass" section)
- Modify: `TASKS.md` (the night-train line mentions the refinement)

- [ ] **Step 1: Mark phase 1 done pending the owner's look**

  In `docs/tasks/characters.md`, change `- [ ] **Phase 1, body:** re-author \`goblin.blob\` to variant A (plan next).` to:

```markdown
- [~] **Phase 1, body:** re-authored to variant A (plan `docs/superpowers/plans/2026-10-01-goblin-body-phase1.md`):
  continuous torso with the gut in front, tapered limbs, orbs only at the shoulders, hands, ankles and toes. All
  goblin-reading tests pass, plus three new pins. **Awaiting the owner's look at the lab turntable**
  ([frames](../dev-notes/2026-10-01-goblin-body-lookdev/lab/)).
```

  In `TASKS.md`, replace `**Goblin refinement pass** asked for (body, kit, weapons, rig, animation; [audit](docs/tasks/characters.md)).`
  with `**Goblin refinement pass**: phase 1 (body) built, awaiting the owner's look; then armour, held weapons, rig and
  animation ([spec](docs/superpowers/specs/2026-10-01-goblin-refinement-design.md), [tasks](docs/tasks/characters.md)).`

  Also add under phase 3 in `docs/tasks/characters.md`: `- [ ] webgpu/goblin-skin.ts keeps forearmRadius 0.028 and
  forearmElbowRadius 0.038 documented as the goblin's forearm bar and elbow blob, which phase 1 removed (both
  constants are unreferenced); handRadius 0.046 is hard-coded and must stay equal to goblin.blob's hand.`

- [ ] **Step 2: Commit**

```bash
git add docs/tasks/characters.md TASKS.md
git commit -m "docs(tasks): goblin refinement phase 1 built, awaiting the owner's look"
```

- [ ] **Step 3: Report to the owner** with the four lab frames, the render-check result, the test summary, and the three
  measured fixes. **Phase 1 is done when the owner agrees the turntable reads as variant A.** Their notes become the
  next edits (each with a number behind it), not a new phase.
