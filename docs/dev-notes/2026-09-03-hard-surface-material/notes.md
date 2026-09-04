# Hard surface material — the honest verdict (X2, task 4)

**Date:** 2026-09-03. Branch `dispatch/hardsurf-task-4` (HEAD `ea96278` + the
comment fix below). Tasks 1–3 already committed on this branch: `f2368cb`
(gloss noise kill), `9a39bc2`+`d0b584a` (metal), `b85e792` (glow=),
`25f5577`/`ea96278` (minotaur eyes + docs).

**The narrow question:** *do the plates read as metal, and did anything else
get worse?*

**Method.** Every verdict shot is an A/B against the chain base
`121ef37` (`claude/blob-side-grammar`), rendered from that actual commit.
Turntable frames via `BLOB_DIST=3.0 npm run blob:shot -- <char> 8` (the plan's
pinned framing) for **minotaur, cyclops, mouse, schoolgirl-alt**, both states —
64 frames, every one read. Plus a supplementary minotaur pair at
`BLOB_DIST=2.0` (4 yaws each, 8 frames) because the plates are ~100 px at 3.0
and the metal question is about their surface. The "before" runs print the
base-only `meltCfg` TSL boot error (see caveats) — that error is the proof the
before-frames really are base code.

## The verdict

### 1. Plate pitting: GONE (task 1). Unambiguous improvement.

Close front (2.0, yaw 0): before shows the thigh plate as a grey slab whose
flat face is rippled with bull-hide pores and a smeared broad specular; after,
the same plate is a smooth face with crisp plate-seam lines. The spec's
prediction ("milled steel gets bull-hide pores") was correct and the kill
`(1 - max(gloss, metal))` at both noise sites fixes it. Flesh keeps its
pitting — gloss-0 prims are untouched, which is the design.

### 2. Chrome-plastic blowout: GONE (task 2).

Before, the plate-bearing yaws (far frame-07, close front) blow out into a
broad white specular sheet — the classic polished-plastic tell the spec
named. After, the response is subdued and picks up faint warm glints from the
key (albedo-tinted spec, iron F0 0.56 renormalisation — constants and their
rendered curve are documented at `march.wgsl.ts:2512-2536`).

### 3. Do the plates read as METAL? **Half — and the fix is authoring, not shader.**

They now read as **dark, oil-blackened metal**, not milled steel. What works:
smooth faces, tight highlights that hold at grazing angles, tinted response,
visible plate segmentation. What doesn't: under the lab's one dim key the
plates sit near-silhouette at back-lit yaws (far frame-06 is close to a
flat black column; the close back views read black with red edge glints).

Root cause is measured, not guessed: the shader ships a **0.45 diffuse floor**
(its own rendered curve: 0.25 went black, 0.35 near-black at the front yaw,
`march.wgsl.ts:2518-2524`) — the floor is as low as it can be while keeping
the front readable. The darkness comes from the **authored albedo**: round 4
(`1c8b75e`) darkened the plate paint ~35% to fight the old blowout, and metal
shading multiplies a dark albedo into a dark result. Now that the shader stops
blowing out, the plate `color=` can come back up. **Owner call: accept
"blackened iron" as the look, or raise the five plate colours and re-shoot.**
The shader needs no further pass for either answer.

### 4. Glow eyes: working.

Two `color=ff2200 glow=0.9` eye prims glow unmistakable red at every
front-bearing yaw and in both close front shots, in a scene dark enough that
the flesh nearly disappears. This was the acceptance case for task 3 and it
unblocks the cybernetic head work (Terminator eyes were the blocked ask).

### 5. Did anything else get worse? **No — checked, not assumed.**

- **cyclops** (lens gloss 0.9, pupil 0.9): 16/16 frames read. Body identical;
  the lens dome is marginally *cleaner* at the front yaws (the faint speckle
  in before-frame-00 is gone in after). No regression.
- **mouse** (eye gloss 0.95): 16/16 indistinguishable — correct, its preset
  carries both noise amps at 0 (task 1's own finding), so there is nothing to
  suppress and no metal/glow prims exist on it.
- **schoolgirl-alt** (control — no gloss/metal/glow prims at all): 16/16
  indistinguishable, cape shell still a thin sheet. She is the canary for
  "the shader changed under everyone" and she did not move.
- **minotaur flesh**: unchanged; `metal 0 / gloss 0` is bit-identical shading
  (multiplication by exact 1.0, `march.wgsl.ts:2534-2536`).
- **blob:render-check -- minotaur**: `0 hole cluster(s), worst 0 px` — OK.
- **prof snapshot** (pack.test.ts:316): every shipped character packs
  byte-identical prof except the minotaur's five authored plates — green.

## Gates and budgets

| Gate | Value |
| --- | --- |
| Full suite | **2301 passed / 118 files** (baseline 2267; tasks 1–3 added 34, none lost) |
| tsc --noEmit | clean |
| `march.glsl.ts` | untouched (empty diff vs `121ef37`) — frozen rule held |
| render-check minotaur | **0 hole clusters** |
| Prims | **61 / 128** (probe: `scripts/tmp/minotaur-budget.ts`) |
| Clusters | **6 / 6 — at the hard ceiling; NO seventh cluster was added**; new prims rode existing groups (eyes in cluster 0 head, plates in cluster 5 legR) |
| Metal prims | 5 × prof=24 (box 8 + metal 16) — the five plate lines |
| Glow prims | 2 × primClip.w=0.9 — the eyes |

Note: the plan's "48/128" was stale on this branch — the muscle/plate/eye
prims authored since brought it to 61/128 (commit `25f5577` already said
61). The 6/6 cluster ceiling claim holds exactly.

## Instrument verification (the mutation matrix)

Task 4 writes no product tests, so the instruments themselves are what needed
mutation-checking:

| Instrument | How it was verified it can fail |
| --- | --- |
| Budget probe | Self-distinguishing: read **59 / 0 metal / 0 glow** at base vs **61 / 5 / 2** at HEAD, matching the authored `.blob` and the +2-prim commit. It also *did* fail me once — see below. |
| Before/after renders | Before-frames rendered from the real base commit, proven by the base-only `meltCfg` boot error in their console output; after-frames shot on the branch with no such error. |
| render-check gate | Ran for real, exit 0, prints the hole count it computed (70725 rays). |
| Suite/tsc | Full 2301 green at HEAD before the comment edit; the three touched suites (281 tests) re-run green at HEAD after it. |

**The checkout slip, recorded because the instrument caught it:** while
shooting base frames I left the worktree on detached HEAD at `121ef37` and
then ran the budget probe — it returned the BASE numbers (59/0/0). That
mismatch against the known 61/5/2 is what exposed the wrong-tree state. A
probe that had returned the same numbers on both states would have let the
error into this note. Both the probe and the note are products of HEAD after
`git rev-parse` verification.

## Spec/plan corrections found this task

1. **Plan said "48/128"** — stale; 61/128 at HEAD (see budgets).
2. **`pack.ts` `PackedBody.primClip` comment still said "(w spare)"** after
   task 3 fixed the row-table docstring — the same lie one file over, fixed
   here (`211e454`).
3. **The base branch cannot boot the lab clean**: `meltCfg` was declared as a
   march input at `121ef37` but only bound to the literal later (`ea96278`
   fixed it). Consequence for anyone re-running this A/B: base shots always
   print 2 console errors and FAIL the shot script's gate while still
   rendering correctly (melt inert). Not a defect of this plan; recorded so
   the next A/B doesn't misread the FAIL.

## Frames read (inventory)

`/tmp/blob-shot-task4/`: `minotaur-{before,after}` 8 each at dist 3.0;
`cyclops-{before,after}` 8 each; `mouse-{before,after}` 8 each;
`schoolgirl-alt-{before,after}` 8 each; `minotaur-{before,after}-close` 4 each
at dist 2.0. 72 frames total, every one opened and read.

Caveat carried over from memory: turntable frames are not deterministic
frame-to-frame (± noise on counters), so only differences clearly beyond that
noise are claimed above (plate pitting, blowout, glow eyes, darkness). The
mouse/schoolgirl "identical" calls mean no such difference, not byte equality.
