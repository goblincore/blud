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
