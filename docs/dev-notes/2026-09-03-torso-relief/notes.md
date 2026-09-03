# The reference had a hole where the chest is

**2026-09-03.** Setting out to give the minotaur muscle definition, and finding
first that the thing I was about to measure against was missing.

## The finding

`readRefSkin` drops every vertex whose largest single-bone weight is at or
below `MIN_DOMINANT_WEIGHT` (0.5). That filter is correct for its purpose —
attributing a vertex to ONE bone, which is what `groupByBone` and `blob:rings`
need. But the vertices it discards are not scattered. They are exactly the ones
where several bones share influence: the joints, and the broad blended areas
between them.

Measured on `minotaur.glb`: **21,657 of 135,942 vertices dropped — 16%** — and
concentrated. Kept vertices per 0.047 m height band across the trunk:

| authored y | kept (filtered) | kept (unfiltered) |
| --- | --- | --- |
| 1.452 | 7,524 | — |
| 1.405 | 6,769 | — |
| 1.358 | 1,040 | — |
| **1.311** | **0** | populated |
| 1.265 | 29 | populated |
| 1.218 | 1,298 | — |
| 1.171 | 2,303 | — |

**A 0.047 m band at chest height kept ZERO vertices**, with 29 in the band
below it, sitting between bands holding thousands. That is where `Spine01` and
both `Shoulder`s share weight and no single joint clears 0.5.

So every measurement this character's chest has ever been given — `blob:rings`,
`blob:depth`, the parked `blob:draft`, and the Blender dumps the `.blob`
header's own chest numbers came from (same `>= 0.35` dominant-weight rule) —
was taken against a hole.

**Blast radius across every reference we have:**

| reference | dropped |
| --- | --- |
| dragon | **34.9%** |
| minotaur | 15.9% |
| bonewalker | 9.3% |
| schoolgirl / -alt | 4.6% |
| mouse | 4.7% |
| cyclops | (no skin — unsupported) |

The dragon loses over a third of its mesh. Nobody has checked where.

## The fix

`readRefSkin(bytes, { minDominantWeight })`. Default unchanged, so every
existing caller takes the identical path. A caller that wants the SURFACE —
a relief map, a silhouette, a depth image — passes 0 and gets the whole mesh.
A caller that needs bone attribution must not, and the docstring says why.

Mutation-verified: reverting the one comparison turns the new test red.

## What the complete map then showed

Front-wall relief, reference vs compiled body, per (x, y) cell — the
measurement `blob:rings` (a radial average) and `blob:measure` (a silhouette)
are blind to by construction, and that `blob:depth` averages away by reporting
a band median across x. Muscle relief lives in the x-profile at a fixed height.

Body minus mesh, mm, positive = body sticks out further:

```
   y_auth |  -0.23  -0.19  -0.14  -0.09  -0.05   0.00   0.05   0.09   0.14   0.19   0.23
  1.499 |    -11      3     16     28     46     73     44     29     15      0     -3
  1.452 |    -17     -4      6     19     32     57     32     17      5     -8    -14
  1.405 |    -24    -17     -4     10     23     46     21      7     -8    -23    -26
  1.358 |    -33    -27    -14      2     16     40     18      2    -15    -31    -36
  1.311 |    -47    -36    -20     -2     -1      5     -0     -1    -21    -39    -50
  1.265 |    -37    -31    -27    -21    -11     -1    -10    -21    -27    -32    -38
  1.218 |     -5    -32    -26     -5     10     20     11     -4    -27    -49    -41
  1.171 |      8     -3      4      4     12     21     12      3      4    -27    -88
  1.124 |     59     19     16     10     21     31     22     14     13     18    -54
  1.077 |     57     29     25     11     18     25     19      9     34     10    -12
  1.030 |     64     28     10     13     18     24     19     12      6      8      4
  0.984 |     51     34     18     16     17     21     15     11     -3    -16    -19
  0.937 |     54     41     32     14     15     16      6     -8    -16    -29    -36
```

**Every row is the same arch: most positive at the centreline, falling to
negative at the flanks.** That is the drum signature. The body is a smooth
ellipse; the mesh is a broad, flat-fronted slab that carries its mass wider.

Read in detail:

- **y 1.265-1.311, the pec band:** the body is BEHIND the mesh almost
  everywhere (-50 to +5). Too shallow AND too narrow.
- **y 1.358-1.499, upper chest:** proud at the centre (+40 to +73), behind at
  the flanks (-36 to -11). A fat centre ridge instead of a shoulder-width chest.
- **y 0.937-1.124, belly:** proud everywhere, worst on the left flank
  (+51 to +64 at x -0.23). Too fat and too wide low down.
- Worst single cell: **-88 mm** at (x +0.23, y 1.171).

The reference's own relief, from the same map read absolutely: an **18 mm
sternum dip** between the pecs at y 1.405 (z 0.235 at centre vs 0.251/0.255 at
x ±0.05), narrowing to a **5 mm linea alba** at y 1.171. The body has neither —
it is most proud exactly where the mesh dips.

## The consequence for the muscle work

**The cross-section is wrong before any muscle is missing.** Adding pecs and
abs to this torso would produce a lumpier wrong drum. Order:

1. Fix the gross cross-section — widen the chest at the flanks, flatten the
   front wall, slim the lower belly. The map above is the target.
2. Then add relief: pec masses at x ±0.07 standing proud with the sternum
   relieved, ab masses, lats carrying the V-taper's edge.
3. `groove` for the separations, low `blend` so masses keep their own shelf,
   `chamfer` where a crease is wanted rather than a fillet.

Re-measure with the relief map at each step; it is the only instrument that
sees any of this.

## The tool

Promoted out of a scratch probe, because the numbers above are quoted in
`minotaur.blob`'s comments and a number nobody can reproduce is not a source:

```bash
npm run blob:relief -- minotaur --y 0.92:1.51 --x 0.24
```

`--abs` prints ref/body absolute z instead of the diff. It derives its scale
from `globalScale` over the mapped bones — 1.56191 on the minotaur, which
independently confirms that file's hand-computed 1.56122 to 0.04%.

**It compares ABSOLUTE positions**, unlike `blob:depth`, which re-zeroes each
subject to its own bounding box. That is the point — "the wall is 40 mm too
far forward" is actionable and a normalised number is not — but it means the
tool is only meaningful where the two subjects agree in pose. Every reference
is T-posed and every `.blob` stands in some rest of its own, so in practice
that is the TRUNK. Without a `--y` window it says so out loud rather than
letting a −170 mm shin read as a sculpting error.

## Round 5, and what it cost to learn

| | mean \|diff\| over 143 torso cells |
| --- | --- |
| before | 21.6 mm |
| **shipped** | **15.3 mm** |
| unbounded optimum (rejected) | 14.2 mm |

The unbounded fit wanted chest `wide` 2.08 (halfwidth 0.312) and traps at
x ±0.322. It scored better and rendered as a **mushroom** — a flat cap with
the arms hanging beneath it. The front wall is one view and cannot see that,
so the search now runs inside bounds set by judgement; `wide` and trap `x`
both sit pinned at their ceilings and the score still wants more.

**A `box` does not help here.** I reached for one by hand assuming a rounded
box would make a plateau an ellipse cannot. It scored worse, and the search
then drove the knob to 0 from every start. A box's corners add ~27% more area
than the ellipse of the same half-extents (4ab vs πab), which lands as volume
where the mesh has none. Knob removed.

Three lines moved: chest `wide` 1.40 → 1.700 and `deep` 1.70 → 1.620; waist
`deep` 1.35 → 1.210 and `wide` 1.45 → 1.490; traps `offset` x 0.052 → 0.162.
The traps mattered most — at 0.052 the two halves (halfwidth 0.361 each)
overlapped into one mass filling the **throat**, where the mesh has a hollow.

## Round 6: the muscle pass, and why it does not read

Owner, on the result: *"i dont see any muscles just the mass and the normal
bumpy texture."* Correct. The measurement improved (15.3 → 12.8 mm) and the
render did not. **Third time this session that a score moved and the picture
did not**, and this time the pattern is the finding rather than the bug.

Diagnosed instead of re-tuned, by subtraction — each step is one render:

| test | result |
| --- | --- |
| `mottleAmp` 0 **and** `surfaceNoiseAmp` 0 | blotches **survive** |
| also `silhouetteNoiseAmp` 0 | body goes completely smooth |
| smooth body, six yaws | **no muscle visible at any angle** |
| creases re-cut narrow and deep | faint pec boundary, still weak |
| spike: second AO tap at 0.015 m | **visibly better**, still modest |

Three conclusions, in order of usefulness.

**1. The "bumpy texture" is `silhouetteNoiseAmp`, and it is GEOMETRY.** It
displaces the real field, which is why it survives turning off both the mottle
and the surface-normal noise. At 0.014 it is the loudest thing on the body —
louder in amplitude than every muscle feature authored here. No material knob
can quiet it; only the number itself.

**2. Geometry cannot carry muscle in this renderer today.** The AO term is a
single field tap at **0.06 m** clamped to [0.35, 1.0] (`march.wgsl.ts:2334`),
so nothing shallower than ~60 mm produces any darkening at all. Self-shadowing
was deliberately cut. That leaves `dot(n, L)` under a broad key as the only
cue, and there the geometry is caught between two failures: a crease crisp
enough to be sharp is a few pixels wide at gameplay distance, and one wide
enough to see is a gentle dish with no contrast.

**A second AO tap at a muscle-sized radius made these exact grooves visible.**
That spike is where the fix lives — it belongs with the queued hard-surface
shader work, not in more authoring.

**3. `blob:relief` has the same blindness one level down.** It compares a
per-cell depth, and its cells are 47 mm — wider than a muscle line. A smooth
ramp and a crisp crease through the same cell depths score identically. I
built the instrument that sees inside the outline, optimised against it, and
it still cannot see whether the surface has *structure*. Every tool in this
chain has now been caught measuring something adjacent to what a character
needs, including the one built this session to fix that.

The masses were kept (they are a real improvement to the form) and the grooves
were kept narrow rather than wide: 12.3 mm was available with 200 mm-wide
"lines", and that score comes from shaving proud material — a depth edit
wearing a crease's name. 12.8 mm with honest creases is the better file.

## Round 7: the owner's answer — structure the noise, don't fight it

Owner, on the diagnosis: *"silhouetteNoiseAmp is important as it adds texture
and detail otherwise it just looks like a smooth blob... maybe instead its to
tweak noise amp or use the same technique to create details like muscles."*

That is the right read, and the code backs it exactly. `march.wgsl.ts:1190`:

```wgsl
let detail = fbm(anchor * 3.0) * noiseAmp;
```

- `anchor` is already the dominant prim's **REST-frame** point, so the
  displacement rides the limb through gait and jiggle.
- scale `3.0` puts one noise cell at ~33 cm — **pec-sized**.
- `noiseAmp` 0.014 is **±14 mm of real geometry**.

So the mechanism already produces muscle-scale, muscle-amplitude, limb-riding
geometry. It is the one thing on the body that reads clearly. It is simply
**isotropic random instead of structured.**

### Two spikes, two renders

**Spike 1 — anisotropy.** `fbm(anchor * vec3(7.0, 2.2, 7.0))`: clear
directional striation, and the idea is proven. But it reads as **fur**, not
muscle, and carries black streaking artefacts.

Those artefacts are a Lipschitz overshoot, and they expose a real gap:

> **`validateBody`'s noise guard is amplitude-only and cannot see frequency.**
> `silhouetteNoiseAmp > (1 - stepMultiplier) * 0.5` — at the default
> `stepMultiplier` 0.6 that permits up to **0.20**. But the Lipschitz constant
> of `fbm(anchor·k)·amp` scales with **k·amp**, and `k` is not in the check.
> The 7.0 spike ran at amp 0.014, a fourteenth of the permitted bound, and
> visibly tore the march. Latent today because `k` is a hardcoded 3.0. A live
> footgun the moment `k` becomes authorable — which is exactly what this
> proposal does.

**Spike 2 — stretch, don't sharpen.** `fbm(anchor * vec3(3.0, 0.9, 3.0))`:
the **maximum** frequency stays 3.0, so the gradient is unchanged from
baseline and the artefacts vanish. The forms elongate along the body into
longitudinal bellies. Reads as muscle and sinew rather than blobs.

**Spike 3 — plus the cavity tap.** Stretched noise, `silhouetteNoiseAmp`
0.014 → 0.020, and the second AO tap at 0.015 m from the round-6 diagnosis.
The tap darkens the valleys *between* the striations, and the two multiply:
pecs read as separate masses with shadow between them, arms and thighs carry
visible longitudinal muscle. This is the first render in three rounds where
the character reads as muscled.

`blob:render-check`: 0 hole clusters at amp 0.020 with the anisotropy.

### The proposal, and why it is not committed

Three changes, all reverted pending an owner call, because each one changes
**every character**, not just this one:

| change | scope |
| --- | --- |
| anisotropic noise scale | one line, body-wide look change |
| second AO tap at 0.015 m | three lines, plus a whole `mapBody` per hit pixel |
| `silhouetteNoiseAmp` 0.014 → 0.020 | per-character, safe (bound is 0.20) |

The noise scale wants to become a **per-palette vec3** rather than a
hardcoded constant — the mouse should not grow bull striation — and the AO
tap needs a perf measurement it has not had. Both belong with the queued
hard-surface shader work: same file, same kind of change, and the noise
guard needs its frequency term before `k` is exposed to authors.

## Round 8: where procedural structure runs out

Owner's refinement: don't replace `silhouetteNoiseAmp`, **add a second pass on
top of it** — additive and opt-in, so every existing character stays
bit-identical. Right shape, and it frees the new term to be something other
than noise. Three more spikes:

| spike | result |
| --- | --- |
| additive anisotropic `fbm` | elongated forms, but muddied by the isotropic term still underneath |
| **ridged** — `(c - abs(fbm·gain))`, creases instead of lumps, gain 2.6 | shredded, and tore the march again |
| ridged at a **gradient budget** (gain 1.05 × maxFreq 3.0 × amp 0.011 ≈ baseline's 1.0 × 3.0 × 0.014) + cavity tap | clean, more definition than baseline, but reads as **knobbly hide** |

The gradient budget is the reusable part: **gain × maxFreq × amp** is what the
march actually pays for, and holding that product at the baseline's value kept
every artefact away while changing the character of the noise freely.

But the third render is the honest verdict on the whole procedural route:

> **Procedural creases land in random places.** A pec split has to be where
> the pec split is. No amount of tuning random noise produces anatomy — it
> produces texture, which is what `silhouetteNoiseAmp` already gives us.

## Round 9: the structure has to be authored — and the machinery exists

Owner: *"structured could be like how a normal map works, just project a 2D
black and white texture of sorts, like painting the muscles."*

That is the answer, and almost all of it is already built for the FACE:

- **`sheet`** projects a 2D image onto the head with `projScaleX/Y` and
  `projCentreX/Y` (`blob-face-sheet.ts`), and drives a **bump** from it —
  `n = normalize(n + bump * faceCfg.w * ...)` at `march.wgsl.ts:2212`. That is
  already "project a 2D texture, paint detail onto the surface".
- **`blob:face-bake`** already bakes such an image from the reference mesh.
- **`anchor`**, the dominant prim's rest-frame point, already exists and is
  already what every fbm samples — so a projection built on it is stable
  through gait and jiggle for free.

Two things it must do differently from a normal map, both learned above:

1. **Sample it inside `mapBody` and add to `detail`, displacing the REAL
   field** — not just perturbing `n`. That is the whole lesson of round 6: a
   normal-only feature runs into the same weak-contrast wall the grooves did,
   because AO cannot see it and there is no self-shadowing. Displacement
   breaks the silhouette AND feeds the cavity tap.
2. **Respect the gradient budget.** A painted map's Lipschitz constant is
   `amp / pixel_size`, so a sharp black line in the image is a cliff in the
   field. It needs blurring or clamping, and `validateBody`'s noise guard
   cannot see it — the guard is amplitude-only (see round 7).

### And the map may not need painting at all

`blob:relief` already computes reference-minus-body front-wall depth per cell.
**That difference IS a displacement map.** Emitting it as a PNG gives an
anatomically correct muscle plate derived from the reference we are already
measuring against, rather than one painted by hand — and it closes the loop
the whole session has been circling: the tool that MEASURES the missing relief
would also SUPPLY it.
