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

---

# THE ANSWER (2026-09-05, run in-session — dispatch UI was full)

**Use warped shells for soft cloth. Use WAM for anything tailored. The
owner's own doctrine — "all clothes and accessories are mesh, only the naked
raw body is SDF" — survives this spike, with one carve-out.**

Commits: `85ef0c5` (the primitive), `a4dddc4` (the rejections), `6ea22fa`
(per-axis frequency), `1515b71` (the schoolgirl, and what it cannot do).

## Does it read as cloth, or as a lumpy shell?

As cloth, inside a narrow band, and as a slept-in mess outside it.

At `warp=0.016 warpFreq=(20,0,20)` the schoolgirl's skirt gains a scalloped
hem and soft vertical fold shading — it stops reading as a cut cone and
starts reading as fabric with weight. That is a real improvement over what
she wore, and it cost two numbers on a line that already existed.

At `warp=0.026` the same skirt goes lopsided and reads as slept-in. The
reason is structural, not a tuning failure: **the warp is a product of
Cartesian sines, so it is periodic on a GRID, not around the body.** It
vanishes near centre-front and centre-back, where `sin(Fx*x)` crosses zero,
and peaks on the diagonals. Real pleats are periodic in the ANGLE around the
waist, which this function cannot express — that would need
`sin(N*atan2(z,x))`, whose Lipschitz bound blows up on the axis.

The per-axis frequency was necessary to get even this far. A scalar frequency
makes an isotropic egg-carton and nothing else; zeroing an axis freezes that
sine to a constant so the folds run along it. Without that the spike would
have concluded "use WAM" for the wrong reason.

## Edge quality against the soldier's polygon plate?

They are not competing at the same job, and that is the finding.

A shell's edge is its `rim=` clip: a rounded fold where the sheet meets a
half-space. For a hem that is exactly right — a hem IS a folded edge. What it
cannot be is a *designed* edge. The soldier's pauldrons have flutes, his
cuirass has a defined lower boundary, his belt has rectangular pouches. Every
one of those is a boundary someone chose. A shell gets one plane cut per
primitive, and no amount of warping adds a second.

## Cost

| | warped shell | WAM kit |
|---|---|---|
| author | 2 numbers on an existing line | a `.wam` file, measured rings, a build step, a committed `.gltf` |
| data | one texture row, 2 KiB/body | a mesh |
| march | steps 45% shorter where the cloth is on screen (`lip` = 1 + \|A\|·\|F\| = 1.45) | free — it is not in the field |
| iteration | edit, reshoot | edit, recompile, reshoot |

The authoring cost is genuinely much lower. The runtime cost is not free and
grows with the amplitude, which is the opposite of what you want: the more
cloth-like you make it, the more it costs.

## Two things that would bite, one of them badly

**The wrinkles are WORLD-anchored.** The warp is evaluated at the world-space
sample point, so the lattice is fixed in the world and the character turns
underneath it. At a 45-degree yaw the pattern shifts 21 mm on cloth 6 mm
thick — the folds are not shifted, they are *replaced*. On a turntable this
is invisible (the camera orbits, the body does not). On a character who walks
and turns, the folds swim across the garment.

This is exactly why `noiseLocal` exists for the body's surface noise; its own
comment says it undoes the body's yaw so the field "wraps the character and
turns with it instead of the body rotating under a world-fixed texture". A
warped garment needs the same rest-space anchor (`ROW_REST_A`/`B` and the
quaternion triple are already there for the noise). Until that lands, warped
cloth belongs on things that do not turn much. Pinned as a test, so it is not
rediscovered.

**`blob:render-check` cannot gate this class of bug.** It compares the
rendered SILHOUETTE against the CPU mask, and a ray that tunnels through a
6 mm skirt goes on to hit the hips behind it. Verified rather than assumed:
with the GPU Lipschitz divisor deliberately removed, `BLOB_RELAX=1.4
blob:render-check -- schoolgirl-described` still reported "0 hole clusters".
A garment over a body is invisible to a hole detector.

So the relax-1.4 gate is modelled in the suite instead — an over-relaxed
tracer (iq's step-and-backtrack) run over the warped field. It bites: 175 of
400 rays tunnel without the divisor, 0 with it. The `BLOB_RELAX` hook was
added to the check anyway, because it did not exist and the next non-exact
primitive will want it, but it is not evidence for this one.

## Would I use it on the next character, or reach for WAM?

**Warped shell** when the garment is soft, loose, and has no designed
boundary — a cloak, a rag, a tarp, an apron, a hanging drape. Irregularity IS
the look there, the one plane cut is enough, and two numbers beats a whole
second language and a build step.

**WAM** for anything with a pattern in it: pleats, seams, cuffs, lapels,
pockets, a belt with rectangular pouches — and anything hard. The soldier's
kit is the proof and it remains the bar.

The schoolgirl's skirt is, unhappily for this spike, the *tailored* case. On
the merits she should get a WAM skirt. The warp she now wears is a real but
partial improvement, and it is worth keeping until that exists.

**And fix the world-anchoring before shipping warped cloth on anything that
walks.** That is the one finding here that is a blocker rather than a
trade-off.
