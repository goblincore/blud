# Bone sphere cull — notes (2026-09-07)

**Question:** the near-wound zone tears the march open. Run 8 priced the bone
fold (the inside-flesh rows `applyBones` folds on every near-wound step) at
25–30% of the wounded march by REMOVING the bones from the field (`bone-mesh-on`).
This task keeps the bones and gives them the spatial cull the flesh groups
already have: one bound sphere per flesh cluster's bones, tested before that
cluster's bone range folds. The cull must be EXACT — a hard-min skip, not an
approximation — so the frame is bit-identical and only the wasted evaluations
disappear.

## Texel layout

No new row (no `DATA_ROWS` bump, which would move every band offset). The bone
spheres ride the FREE texels of the two cluster rows, whose first 6 texels hold
the flesh clusters:

| row | columns 0..5 | columns 6..11 | column 12 |
| --- | --- | --- | --- |
| `ROW_CLUSTER_BOUNDS` (3) | flesh cluster spheres | bone-cluster spheres (index c → col 6+c) | (unused) |
| `ROW_CLUSTER_RANGE` (4) | flesh cluster ranges | bone-cluster ranges (index c → col 6+c) | TAIL range |

- `boneClusterRange[c] = [start, count, distort, 0]` — the cull's per-cluster
  range in the PACKED bone span `[counts.x, counts.x + boneCount)`.
- `boneClusterBounds[c] = [cx, cy, cz, radius]` — `fitSphere` over that
  cluster's posed bone prims (the SAME routine `boundGroups` uses; a bent rib
  is bound over its Bezier hull).
- `boneClusterRange[MAX_CLUSTERS]` (column `2*MAX_CLUSTERS`) is the TAIL, for
  organs and any bone matching no cluster. Its `.w` is the cull's **enabled
  flag**: `1` whenever `packBoneClusters` is on, `0` when off. Zeros = the
  old flat loop, byte-identical. The shader reads the flag once
  (`tail.w > 0.5`) and falls back to the flat loop when it is 0.
- Bones are written cluster by cluster, then the tail, so each cluster's range
  is a contiguous slice of the bone span. Rest rows ride their posed rows
  (reordering moves both together).

## Shader

`foldBoneRange` (new helper) holds the per-bone fold exactly once — shape/bend
reads, the `gDebugBones` counter, the hard `min` — shared by the cluster-cull
path and the flat fallback, so they cannot drift. `APPLY_BONES` reads the tail
flag; enabled it walks the 6 clusters with the EXACT hard-min skip

```
if (length(p - cb.xyz) - cb.w > d * cr.z) { continue; }
```

where `d` is the WOUNDED running field (the call site passes `dmg`) and `cr.z`
is the cluster's distortion factor (`sdPrim` under-reports Euclid by at most
this). The tail folds unconditionally (viscera rides no sphere). Flag 0 = the
pre-cull flat loop over `[counts.x, counts.x + boneCount)`.

## Exactness gates (both required)

### Counter gate (load-immune)

Wounded scene (room 3 firefight), frozen, then the bone counter readback
(`__sdfGame.boneEvals`). Cull OFF vs ON on the SAME frozen pose. The first
read/capture after a freeze is COLD (an outlier — see the note in the bench
section); the numbers below are the warm pair.

| | rasterised | hits | bonesTotal |
| --- | ---: | ---: | ---: |
| cull OFF | 36472 | 23487 | 206856 |
| cull ON | 36471 | 23487 | 169070 |

**Hit-pixel counts IDENTICAL (23487 = 23487)** — the same pixels hit at the
same steps, so the cull is an exact no-op on the field. `bonesTotal` drops
**18.3%** (206856 → 169070), which is the whole point: near-wound pixels no
longer fold every bone of every cluster, only the clusters whose sphere is
within `d * distort`. `rasterised` is within 1 px (sub-pixel march jitter; the
off-a vs off-b repeat spread is the same 1 px).

### Pixel gate

Four captures per the attribution parity recipe (`setLoopRunning(false)` +
3×`step(1/60)`), warm-up capture discarded (cold frame). PIL channel delta > 8:

| comparison | mask pixels (delta > 8) |
| --- | ---: |
| off-a vs off-b (noise floor) | 40201 |
| on vs off-a | 34355 |
| on vs off-b | 10081 |

on-vs-off-a (34355) is WITHIN the off-a-vs-off-b noise floor (40201). The mask
is scattered dither/edge noise — no crater-shaped or bone-shaped region, so the
sphere is not too tight. (The whole-image noise floor is large because blood/
goo animate even when the wanderers are frozen; the counter's IDENTICAL hits is
the load-immune proof that the geometry is bit-identical.)

## Bench (Step 7)

_PENDING — machine load was 35.6 at writing time; the bench below is run on a
quiet machine and appended._

- Bones stay in the field (the tubes failed the look verdict); the cull is the
  fix.
- Verdict: _PENDING_ (ship-ON candidate / park / unresolved), with the fraction
  of the bone-mesh-on win recovered.
