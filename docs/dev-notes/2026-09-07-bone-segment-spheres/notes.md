# Bone segment spheres — notes (2026-09-07)

**Question:** the cluster-level bone cull (../2026-09-07-bone-sphere-cull/) was
exact but recovered only ~5% of the wounded march — a chest crater's pixels
sit in the TORSO cluster, whose one sphere holds ribs + spine + pelvis. This
branch culls per RIGID SEGMENT instead: the units `applyRig` already poses
bones by (the skull rigid unit, one axial `BoneFrame` per spine/pelvis
segment, one limb bone per bind-point pair) plus one segment for the organs.
Same exactness contract: hard-min skip, bit-identical frame, both gates
required.

## How it works

`applyRig` tags every inside-flesh prim with `Primitive.boneSegment` — a
dense small int keyed by the pose path the prim takes: `'head'` for
skull-rigid bones, `axial:<head>-<tail>` for a torso/head bone's BoneFrame,
`limb:<limb>:<a.point>-<b.point>` for a limb bone's two bind points, and
`'organs'` for every `op === 'organ'` prim regardless of pose path. CPU-only;
never a GPU row.

`pack.ts` gains `boneCullMode: 'off' | 'cluster' | 'segment'`
(`packBoneClusters: true` remains as an alias for `'cluster'` — pinned
byte-identical). Segment mode buckets the live inside-flesh rows by tag,
writes rows segment by segment in ascending id order, and fits the SAME
`fitSphere`/`distortOf` per bucket. ANY untagged live row falls the whole
pack back to the exact cluster layout (lab bodies and chunks carry no tags).

### Texel layout (extends the cluster layout; the two rows are MAX_PRIMS wide)

| column | `ROW_CLUSTER_RANGE` | `ROW_CLUSTER_BOUNDS` |
| --- | --- | --- |
| 0..5 | flesh cluster ranges | flesh cluster spheres |
| 6..11 | bone-CLUSTER ranges (mode 1) | bone-cluster spheres (mode 1) |
| 12 | HEADER: `[tailStart, tailCount, segCount, mode]` — mode 0 off, 1 cluster, **2 segment** | (unused) |
| 13..44 | segment ranges `[start, count, distort, 0]` | segment spheres `[cx, cy, cz, r]` |

`BONE_SEG_MAX = 32` (validate.ts); columns 13..44 were all free. Segments
beyond the cap overflow to the tail, which the shader folds unconditionally.
Mode 2 leaves the cluster slots 0..5 zero.

### Shader

`APPLY_BONES` reads the header; `tail.w > 1.5` is the segment path: for each
segment `s < tail.z`, the SAME exact hard-min skip as the cluster path —

```
if (length(p - sb.xyz) - sb.w > d * sr.z) { continue; }
```

with `d` the WOUNDED running field — then `foldBoneRange` (the one shared
per-bone loop body) over the segment's range. Mode 1 and the flat fallback
are verbatim. `foldBoneRange` is called, never inlined, on all three paths.

### Segment counts (live pack, rest pose)

| character | segments | bone rows | tail |
| --- | ---: | ---: | ---: |
| zombie | 19 | 68 | empty |
| soldier | 21 | 22 | empty |
| goblin | 31 | 32 | empty |

All under `BONE_SEG_MAX`; no overflow. Zombie segment sphere radii range
0.024 (a hand bone) to 0.255 (the thoracic ribcage segment — the zombie has
only pelvis/spine/neck axial segments, so ~5 rib pairs share one sphere;
that sphere is the granularity floor for a chest wound).

## Exactness gates (both required, both PASS)

### Counter gate

Wounded frozen room-3 scene (throughput bench recipe, then `freeze(true)`),
cold read discarded, `__sdfGame.boneEvals()` per mode on the SAME pose
(counter.json):

| mode | rasterised | hits | bonesTotal |
| --- | ---: | ---: | ---: |
| off | 39206 | 24394 | 140964 |
| cluster | 39206 | 24394 | 124475 (−11.7%) |
| segment | 39206 | 24394 | 72830 (−48.3%) |
| off-again | 39207 | 24394 | 140964 |

**Hit counts identical (24394) across all three modes** — the cull is an
exact no-op on the field. `off-again` reproduces `off` exactly (rasterised
within 1 px, the known sub-pixel march jitter). Bone evaluations drop
**48.3%** in segment mode vs 11.7% for the cluster mode on this scene (the
cluster notes measured 18% on theirs) — just under the ≥50% headline target;
the residue is the thoracic-sphere coarseness above plus the organ segment,
both of which legitimately sit near a torso wound.

### Pixel gate

Captures `off-a`, `off-b`, `seg`, `off-c` (loop stopped, 3× step(1/60)
before each, warm-up discarded, `setBleed(false)`; bleed-ON floor pair taken
first). PIL channel delta > 8:

| comparison | mask px (delta > 8) | bbox |
| --- | ---: | --- |
| bleed-a vs bleed-b (floor, bleed ON) | 142335 | whole frame |
| off-a vs off-b (floor, bleed OFF) | 29924 | whole frame |
| seg vs off-a | 30088 | whole frame |
| seg vs off-b | 1529 | whole frame |
| off-c vs off-a | 30018 | whole frame |

seg-vs-off-a (30088) is within 0.5% of the off-a-vs-off-b floor (29924) and
seg-vs-off-b is 20x under it. The masks (mask-*.png, LOOKED at): the only
structure is the FPV gun/hands region at bottom frame, present IDENTICALLY
in the off-a/off-b floor mask — the weapon idles between stepped captures.
No bone- or crater-shaped region. Bleed ON quadruples the floor (mist), as
expected.

## Bench (Step 7)

TBD — running.

## Verdict

TBD.
