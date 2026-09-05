# SDF shell clothes — a spike. Dispatch brief

In-repo copy of `~/.claude/dispatch/plans/2026-09-05-shell-cloth-spike.md`.

**This is a SPIKE, and the framing is the owner's:** *"the SDF shell clothes
would be cool, we just haven't tried it yet — mesh is a known quantity."*
WAM already produces good clothes; the soldier's kit proves it. The open
question is whether SDF cloth can be as good, because if it can, garments stop
needing a second language and a compiled artefact.

So the deliverable is an ANSWER as much as a garment. A spike that concludes
"no, use WAM" having proven it is a success.

Chained behind `hairlock` with `depends_on` — both touch `march.wgsl.ts` and
the bound sites, and running them together would collide.

---

```markdown
---
title: "Spike: SDF shell clothes with domain-warped wrinkles — re-clothe schoolgirl-described, and answer whether it beats WAM"
status: pending
project: /Users/donny/Projects/blud
model: kimi/k3:high
branch: dispatch/shell-cloth-spike
base_branch: claude/soldier-character-modeling-7f88ae
priority: 1
max_runtime: 150m
created: 2026-09-05
depends_on: ["2026-09-05-hairlock"]
allowed_tools: Edit,Write,Bash,Read,Glob,Grep
harness: pi
---

## THE ONE JOB

Answer a question with evidence: **can SDF cloth replace a polygon kit?**

Do it by re-clothing `characters/schoolgirl-described.blob` — sailor blouse,
navy pleated skirt, neckerchief — using `shell` primitives with domain-warped
wrinkles, and comparing the result against what she wears now (flat paint) and
against what the soldier's WAM kit achieves.

The owner's framing: WAM is a known quantity and already works. This is worth
doing only if SDF cloth is genuinely competitive, and a spike that concludes
"it is not, use WAM" — having actually tried — is a success, not a failure.

## THE SHELL ALREADY EXISTS. START THERE.

`.blob` has a `shell` primitive today and the schoolgirl wears one:

```
shell torso on spine1 at=0.94 r=0.095 r2=0.185 tip=(0,-0.250,0) wide=1.05
      tall=0.42 deep=0.80 thick=0.006 clip=(0,-1,0) clipd=-0.72 rim=0.007
```

That is her skirt — a thin onioned surface clipped to a hem, with a rounded
rim. Read `characters/schoolgirl.blob` around it, and her sailor collar, before
designing anything. **The drape half is solved; what is missing is WRINKLES.**

## WHAT TO ADD

Item 5 of `Claude Notes/Blud/2026-08-24-selfie-girl-techniques.md`, in our own
words: domain-warp the shell with low-frequency sines so the surface undulates
like cloth, plus optionally a much smaller high-frequency term for weave.

**LICENCE — NON-NEGOTIABLE.** That note's source shader forbids reuse of the
Work. Do NOT open, read, search for, or port the Selfie Girl shader. The
technique is described in the note in our own words; implement from iq's own
articles (`iquilezles.org/distfunctions`, `/articles/smin`).

The note also records a rim trick worth having if it falls out cheaply: where
the shell meets its clipping plane, the rounded edge is the distance to the two
surfaces' intersection curve, `length(vec2(dShell, dPlane)) - r`. The shell
already has `rim=`; check whether that is the same idea before rebuilding it.

## THE THREE THINGS THAT WILL BITE

Same class of work as `radiusRamp`, whose lessons are cheap to reuse.

1. **DOMAIN WARPING BREAKS THE DISTANCE METRIC.** Displacing the sample point
   means the field is no longer a bound, and a sphere tracer oversteps and
   punches holes. Either bound the error (a warp of amplitude A with gradient
   G costs you a Lipschitz factor you can divide out, as `radiusRamp` divides
   by `1 + |g|`) or flag the region so the relaxed march steps plain there —
   `nearWound` in `march.wgsl.ts` is the existing pattern, and the cyclops's
   craters banding at relax 1.4 is what it prevents.
2. **BOUNDS MUST GROW BY THE WARP AMPLITUDE.** There are EXACTLY EIGHT outer
   sites, already enumerated — every non-test call to `boxReach`/`rampReach`:
   `extent.ts`, `clusters.ts`, `validate.ts`, `pack.ts`, `rig-bind.ts`,
   `shell-hull-outer.ts`, and `fpv-view.ts` twice. Also check
   `occluder-hull.ts`: it is the INNER hull, and a warp that pushes the surface
   INWARD makes an inscribed sphere poke out — the one that produces
   see-through holes.
3. **NOTHING MOVES.** Warp amplitude defaults to 0, and a shell without it must
   render bit-identically. The schoolgirl's existing skirt and collar are the
   regression case; prove it with a test, do not eyeball it.

## YOUR LOOP

1. Add the warp, defaulted off. Unit-test the no-op FIRST.
2. Re-clothe `schoolgirl-described` with warped shells. **Do NOT touch
   `schoolgirl.blob` or `schoolgirl-alt.blob`** — they are controls for a
   separate comparison; `git diff` on them must stay empty.
3. `npm run blob:shot -- schoolgirl-described` and **`Read` the frames.**
4. `npm run blob:render-check -- schoolgirl-described` — exit 0, and ALSO at
   relax 1.4. That gate decides whether a plain-step flag is needed.
5. `npx vitest run src/lab/sdf-zombie/` green, `npx tsc --noEmit` clean.

**`kimi/k3` HAS vision.** `Read` your own frames directly; do not use
`scripts/vision-ask.py`.

## THE COMPARISON THAT IS THE POINT

Shoot the soldier too (`npm run blob:shot -- soldier`) — his armour is a WAM
kit and is the bar. Then answer, in your report:

- Does warped-shell cloth read as cloth, or as a lumpy shell?
- How does it compare to the soldier's polygon plate for edge quality?
- What did it cost — prims, step count, frame time?
- **Would you use it on the next character, or reach for WAM?** Say which and
  why. That is the deliverable.

## DONE WHEN

- the warp exists, defaults off, and is proven a bit-exact no-op
- every bound site accounts for it; the count is grep-verifiable
- render-check passes at relax 1.4, or a plain-step flag exists and it does
- `schoolgirl-described` wears warped-shell clothes and the frames are read
- the two control schoolgirls are untouched
- suite green, tsc clean
- **your report answers the WAM question with evidence**

## COMMIT AS YOU GO

Runs here have been cut off mid-flight and lost everything. Commit after every
step that compiles.
```
