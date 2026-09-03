# `blob:draft`: band in the bone's frame, and place the face honestly

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the two contained defects the chain-drift fix exposed, both of which actively corrupt a draft's output today.

**Architecture:** One principle, applied where it was missed. The chain-drift spec established *the rig supplies placement, the cloud supplies the surface.* Banding never got the memo: bands are still measured in the **cloud's** frame and then projected onto the **rig** line, which collapses on an oblique cloud. Band in the rig's frame instead and the transfer disappears.

**Tech Stack:** TypeScript, vitest, tsx.

**Follows:** [`2026-09-02-blob-draft-chain-drift-design.md`](../specs/2026-09-02-blob-draft-chain-drift-design.md), whose Task 4 found both of these.

---

## Read before starting

**Baseline: `npx vitest run src/lab/sdf-zombie/` green at 2182 tests / 112 files.**

Both defects come from Task 4's honest verdict — read its section in
`docs/dev-notes/2026-09-02-blobforge-depth/notes.md` (from "Verdict: **no**").
Neither is a regression: the chain-drift fix worked on every property it
promised (soles −0.0001 m, extent +0.02%, `len=` deviation 0.00004 m). These
are things that fix **revealed**.

---

### Task 1: Band in the bone's frame

**Files:**
- Modify: `scripts/blob-draft.ts` and/or `src/lab/sdf-zombie/draft-skeleton.ts` (wherever `bandCloud` is called)
- Modify: `src/lab/sdf-zombie/draft-emit.ts` (`bandRange`)
- Test: `src/lab/sdf-zombie/draft-emit.test.ts`, `src/lab/sdf-zombie/draft-fit.test.ts`

**The defect, verified in the code.** `bandRange` (`draft-emit.ts:297`) takes a
band's **cloud-frame** `t`, rebuilds a world point along the cloud axis
(`f.line.origin + f.line.dir · t`), then projects it onto the **rig** line. When
the two axes are oblique the projection shortens by `cos θ`. The minotaur's
prosthetic `shin.r` cloud sits **76° off the rig chain**, and `cos 76° ≈ 0.24` —
which is exactly the measured "bands project into a 0.19–0.23 sliver of the
bone", several with `from > to`, and a trim that then leaves a mid-shin gap.
On screen the prosthetic is a grey ball at one knee.

**The fix: band against the RIG line, not the cloud line.** `bandCloud(points,
line)` already takes the line to band against — pass the bone's rig line. Then
band edges are already in the statement's frame and no transfer exists.

This is the chain-drift principle finished rather than a new idea: **the rig
supplies the frame, the cloud supplies the points.** It applies to the radius
too — a prim rides its BONE, so its radial distance must be measured from the
bone's axis. A radius measured from an axis 76° away is a number no primitive
can express.

- [ ] **Step 1: Write the failing tests**

```ts
describe('banding is in the bone frame', () => {
  it('spans the bone for an OBLIQUE cloud', () => {
    // A cloud whose principal axis sits ~75 degrees off the rig segment.
    // Assert the emitted bands span substantially the whole bone — today they
    // collapse to a ~0.2 sliver. State the threshold and why.
  });

  it('never emits from > to', () => {
    // The oblique case produced inverted ranges. `resolve` lerps so it is
    // harmless numerically, but the PLACEMENT is wrong. Assert ordering over
    // every band of every bone in a drafted body.
  });

  it('leaves an ALIGNED cloud unchanged', () => {
    // The regression guard: where cloud and rig axes agree, banding must be
    // bit-identical to today. Most bones are this case.
  });
});
```

The third test matters as much as the first — most bones are near-aligned and
must not move.

- [ ] **Step 2: Run and verify they fail** — the third should PASS already; the
first two must fail. If the first two pass, they are not reproducing the
obliquity. Report that rather than proceeding.

- [ ] **Step 3: Implement** — band against the rig line; simplify `bandRange`
to the pure `(t − t0)/e` fraction now that both frames are the same, and
**delete the projection with a comment saying why it existed and why it is
gone.** Keep the end-pinning behaviour its current comment describes (first and
last bands own the joints, which is where clusters fuse) — that is load-bearing
and unrelated.

Keep reporting the cloud-vs-rig angle in the `# fit:` comment. It is now a
pure diagnostic and still worth having: a cloud 76° off its bone is telling the
author something real about that limb.

- [ ] **Step 4: Verify** — targeted tests pass; full suite green, zero
regressions against 2182; tsc clean.

- [ ] **Step 5: Mutation-verify** each new test; report the matrix.

- [ ] **Step 6: Commit**

```bash
git commit -m "blob:draft: band in the bone's frame, not the cloud's"
```

---

### Task 2: The face block's placement

**Files:**
- Investigate first; likely `src/lab/sdf-zombie/draft-emit.ts` and the head-cloud fit
- Test: `src/lab/sdf-zombie/draft-emit.test.ts`

**The defect.** With the torso drum gone, `blob:depth` now reports the **face
block as the worst side-view band: −367 mm at y 0.188–0.250**, labelled *"no
.blob line — a TS-authored prim owns this height"*. The `face` block's prims
are appended by `compileBlob` and positioned by the face params the draft
emits, and they are landing badly against the drafted skull.

**INVESTIGATE BEFORE FIXING.** State what you measured. The prime suspect is a
documented trap: **head-space normalisation is driven by the FATTEST head prim,
which on a character with hair or horns is the hair/horn mass rather than the
cranium.** The minotaur has both. So a `headRadius` derived from the raw head
cloud would be inflated by horns and push the face block out of place.

If that is the cause, the fix is to derive the face params from the **cranium**
rather than the whole head cloud — e.g. the cloud's core mass excluding the
outlying horn/hair lobes. If it is something else, say so and fix that instead;
do not force the hair hypothesis onto a different cause.

- [ ] **Step 1: Measure and report** — where the face prims land vs where the
drafted skull's surface is, on the minotaur and on a hornless character
(schoolgirl) for contrast. A defect that only appears on the horned one is
strong evidence for the hair/horn trap.

- [ ] **Step 2: Write a failing test** pinning the property you found broken,
whatever it turns out to be.

- [ ] **Step 3: Fix, verify, mutation-verify.**

- [ ] **Step 4: Re-measure with `blob:depth`** — the face-block band must no
longer be the worst side-view band on the minotaur. Report the before and after
numbers.

- [ ] **Step 5: Commit**

---

### Task 3: Re-draft, re-measure, re-judge

- [ ] Re-draft the minotaur and schoolgirl. Confirm the chain-drift properties
still hold (soles, extent, `len=` deviation) — these fixes must not cost them.
- [ ] `npm run blob:depth -- minotaur` — report front and side means against
Task 4's 88.0 mm / 142.0 mm, and against round 1's 54.1 mm / 193.7 mm.
- [ ] `BLOB_DIST=3.0 npm run blob:shot -- minotaur`, then **`Read` the frames.**
Does the prosthetic now read as a LEG rather than a grey ball at one knee? That
is the single visual question this plan is answering.
- [ ] Append to `docs/dev-notes/2026-09-02-blobforge-depth/notes.md` with the
numbers and an honest verdict. **A third "no" on overall likeness is still a
fine outcome** — the sub-band identity and T-pose gaps are known and out of
scope here. What this plan owes is the prosthetic reading as a limb and the
face sitting on the head.

---

## Done when

- Full suite green, no regressions against 2182; tsc clean
- An oblique cloud's bands span its bone; no `from > to` anywhere
- Aligned clouds band bit-identically to before
- The face block is no longer the worst side-view band on the minotaur
- Chain-drift properties unchanged: soles, extent, `len=` deviation
- Frames looked at, verdict written down
