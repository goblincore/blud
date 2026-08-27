# Ring-fit: measuring `.blob` primitives against a skinned reference mesh

**Date:** 2026-08-26
**Status:** design, approved
**Supersedes nothing.** Sits beside `blob:measure`, does not replace it.

## Why

Authoring a `.blob` body is currently: read a band table from `blob:measure`, guess
a better radius, re-measure, repeat. `blob:measure` names the *line* that owns a
bad band — that was the last tool's contribution — but it does not say by how much,
and the arithmetic that follows is where the passes drift.

The comments in `characters/mouse.blob` are the evidence. They are full of
hand-derived ring measurements:

> `# Mesh torso, 0.26..0.46: half-width 0.064..0.079, half-depth 0.075 both ways`

and hand-derived blend corrections:

> `# At deep 1.15 these blended out to a 0.087 chest front, 12 mm past the mesh's
> # dressed surface`

That is a person doing, by hand and slowly, exactly what this tool does. The
reference mesh already contains every one of those numbers.

Two further limits of `blob:measure` this addresses directly, both documented in
`.claude/skills/authoring-sdf-characters/SKILL.md`:

- **Pose mismatch.** It rasterises a view, so the mouse mesh's T-posed arms
  against the `.blob`'s 47-degree rest dominate the whole-figure score and force
  `--range` windows. Ring-fit works in *bone-local* frames, where pose cancels.
- **The 5 mm depth step.** `D_STEP` in `silhouette.ts` steps over any feature
  thinner than 5 mm along the view axis and attributes the band to the next
  primitive inward. Ring-fit never rasterises, so it has no view axis to step
  along.

### Prior art, and what was deliberately not taken

Prompted by `github.com/img2threejs/img2threejs`, specifically
`integrations/glb_character_pipeline`. Its Stage 1 slices a GLB node's point cloud
by height and takes radial outlines — that idea is the seed of this design.

Its Stage 2/3 (splat an SDF, contour with Surface Nets, encode the mesh as base64
varint in a `.ts` module) is **explicitly rejected**: that uses an SDF as a baking
intermediate whose output is a static mesh. Our SDF is the runtime representation,
and the analytic field is load-bearing — `carve`/`groove`, wound damage, severing,
`clearOf`/`daylightOf` and click-to-shoot all evaluate `sdBody`. A decoded
`BufferGeometry` cannot be cut into at runtime.

Two further departures from the source, both because our situation is better:

- It slices **per GLB node** because its reference was a multipart GLB. Ours are
  not — `mouse.glb` and `schoolgirl.glb` are each a *single* skinned mesh (32,260
  and 115,226 verts) on one shared 24-joint rig. We segment by **skin weight**
  instead, which is exact by construction and lands on bones, which is how `.blob`
  is organised.
- It fits ring outlines directly. We fit the **residual of our own field**
  (below), because ring outlines alone ignore blending.

## Scope

**In:** prims riding `pelvis`, `spine1`, `chest`, `spine2`, `neck`, `clavicle`,
`upperarm`, `forearm`, `thigh`, `shin`, `foot` and their mirrors.

**How much of a reference this actually covers, measured 2026-08-27:** 79% of
`schoolgirl.glb`'s vertices, but only **40%** of `mouse.glb`'s — the mouse is a
head-dominated character (its ears alone are a quarter of its standing height
each) and 55% of its mesh is head and hands, both out of scope. Ring-fit is
therefore a far sharper instrument on the schoolgirl than on the mouse, and a
mouse run should not be read as covering the character.
Suggests `r`, `r2`, `deep`, `offset` for prims **that already exist**.

Scope is decided by the **bone**, not the limb tag. `bar head on neck` is in
scope — it is the neck stalk, a ring-shaped prim on a body bone — even though its
limb reads `head`. Only prims on `skull` are excluded.

Suggesting `r2` on a prim that has none is in scope: that adds a parameter to an
existing prim, which is a taper, not a new prim.

**Out, and each for a reason:**

- **The head.** Head prims sit at `at=0.00` with large `offset=`/`tip=` vectors —
  free-floating features, not a stack along a bone — and the cranium comes from
  the `face` block, not a prim. A ring solver models that badly, and the
  face-projection trap (`hs` normalised by the fattest head prim) is exactly the
  kind of thing a naive fit gets wrong and then reports confidently.
  `scripts/head-profile.ts` remains the head tool. The command prints one line
  saying so.
- **Creating or deleting prims.** Placing a prim is a modelling judgment — one
  bent capsule versus two straight ones was a real call on the goblin nose — and
  a solver minimising ring error will pick the lumpy answer.
- **Coverage-gap detection.** Deferred. "Blend fills that gap" is legitimate, so
  the tolerance would produce false alarms before it produced findings.
- **`hand` and the finger bones.** The reference rig ends each arm at a single
  `LeftHand`/`RightHand` joint, so every vertex of the palm and all four fingers
  carries one weight. Our `.blob` models `hand` plus `f_index`/`f_middle`/
  `f_ring`/`f_little` separately. There is no sane per-bone attribution across
  that mismatch, and a fit would confidently average a hand and four fingers into
  one radius. Excluded until a reference with finger joints exists.
- **Unskinned references.** `cyclops.glb` is an unrigged Tripo sculpt with no
  `JOINTS_0`. It exits 2 with "no skin — unsupported". A nearest-our-own-bone
  fallback was considered and rejected for v1: it is circular, so a misplaced bone
  mis-attributes points and the fit then "confirms" the error.
- **Auto-applying edits.** The tool suggests; a person applies. `.blob` comments
  carry design intent a fit cannot see — `deep 1.15, not 1.30` exists because the
  mesh is *dressed* and the flesh must sit a fabric's thickness inside.

## Command

```
npm run blob:rings -- <name>
npm run blob:rings -- <name> --json
npm run blob:rings -- <name> --glb path/to/mesh.glb
```

`blob:rings` is added to `package.json` scripts alongside `blob:measure`.

Reference resolution, exit codes and the "a score is not a grade" framing follow
`scripts/blob-measure.ts` exactly: **exit 0 whenever it ran, however bad the
numbers; exit 2 for "did not run"**, so an agent can never read a failure to run
as a perfect fit.

## Pipeline

### 1. Read the reference

Parse the GLB with the existing `parseGlb` from `silhouette.ts`. Pull `POSITION`,
`JOINTS_0`, `WEIGHTS_0`, and the skin's `inverseBindMatrices` (accessor 6 on
`mouse.glb` — confirmed present on both skinned references).

### 2. Segment by dominant joint

Each vertex is assigned to the joint carrying its largest weight. Vertices whose
top weight falls below `MIN_DOMINANT_WEIGHT` (initial value 0.60) lie in the blend
between two joints; they are **excluded from the fit** and counted in a coverage
line. A bone whose sample is thin must look thin in the report rather than
yielding a confident number off forty points.

### 3. Map joints to bones

An explicit table, written down rather than inferred from names:

Each of our bones names the reference joint at its **head**, the one at its
**tail**, and the joints whose vertices it **claims**.

| our bone | head joint | tail joint | claims |
|---|---|---|---|
| `pelvis` | `Hips` | `Spine02` | `Hips` |
| `spine1` | `Spine02` | `Spine01` | `Spine02` |
| `chest` | `Spine01` | `Spine` | `Spine01` |
| `spine2` | `Spine` | `neck` | `Spine` |
| `neck` | `neck` | `Head` | `neck` |
| `clavicle.l` | `LeftShoulder` | `LeftArm` | `LeftShoulder` |
| `upperarm.l` | `LeftArm` | `LeftForeArm` | `LeftArm` |
| `forearm.l` | `LeftForeArm` | `LeftHand` | `LeftForeArm` |
| `thigh.l` | `LeftUpLeg` | `LeftLeg` | `LeftUpLeg` |
| `shin.l` | `LeftLeg` | `LeftFoot` | `LeftLeg` |
| `foot.l` | `LeftFoot` | `LeftToeBase` | `LeftFoot`, `LeftToeBase` |

`.r` mirrors each arm/leg row with the `Right*` joints. `LeftHand`, `RightHand`,
`Head`, `head_end` and `headfront` are deliberately unmapped and their vertices
are dropped (see Scope).

**The spine names are counter-intuitive and were verified against the file, not
assumed.** The reference chain runs `Hips -> Spine02 -> Spine01 -> Spine ->
{LeftShoulder, RightShoulder, neck}`, so `Spine02` is the **lowest** spine joint
and `Spine` is the **highest** — the reverse of what the numbering suggests. An
earlier draft of this spec had the mapping inverted. This is precisely the silent
mis-assignment the explicit table exists to prevent; do not re-derive it from
names.

`mouse.glb` and `schoolgirl.glb` carry the identical 24-joint rig, so one table
covers both. A reference with a different rig produces "no mapping for joint X"
per unmapped joint, never a silent mis-assignment.

### 4. Align

**One global uniform scale**, then a **per-bone rigid transform** (rotation and
translation only).

Reference joint positions come from composing the node hierarchy's TRS from the
scene root; mesh vertices are transformed by the mesh node's own world matrix, so
both land in one space. (`mouse.glb` puts everything under a single `Armature`
node carrying a uniform 0.01 scale.) A non-uniform scale anywhere in that chain
is asserted against rather than silently mishandled.

The scale comes from the median of per-bone length ratios across all mapped bones;
the spread is printed. The references are in centimetre-ish units — `Hips` sits at
y≈50.4 on a 1.10 m mouse — so the scale is around 0.01 but is measured, not
assumed.

The split matters and is the design's main judgment call:

- **Per-bone *rigid* alignment makes limb fitting pose-independent.** The mouse
  mesh's T-posed arm and the `.blob`'s 47-degree arm produce the same forearm
  rings, because each is measured in its own bone's frame. The POSE MISMATCH
  problem does not arise, and no `--range` window is needed.
- **Refusing per-bone *scale* keeps proportion errors visible.** A bone of the
  wrong length shows up as residual piling up at one end instead of being
  normalised away. Bone-length ratios print as their own short table, because
  that is a `len=` edit and must not be mixed into radius suggestions.

Known consequence: a character deliberately authored at a different scale from its
reference shows a uniform offset everywhere until the scale is stated. The scale
line at the top of the report is what makes that diagnosable at a glance.

The per-bone frame needs a roll convention, since a bone gives only head, tail and
direction. Use a fixed reference vector (world +z, falling back to +x when the
bone is within 5 degrees of parallel to it) to build the perpendicular basis, and
apply the same convention on both sides. Any convention works provided it is
identical for reference and body; this one is stated so the tests can pin it.

### 5. Evaluate the residual

Transform each surviving reference vertex into our world space and call
`sdBody(p, body)` from `validate.ts`.

On a perfect match it returns 0. The signed value is the error **in metres, with
blending already folded in**, because `sdBody` *is* the blended field. This is the
step that ring outlines alone cannot do: prims smooth-union, `smin(a,b) < min(a,b)`,
so the union surface is always fatter than any single prim, and a ring read
straight onto a prim's `r` systematically over-fattens.

Sign convention, fixed here so the report and the tests agree:

- `d < 0` — the reference point is *inside* our body; our surface sits outside it.
  Reported as **proud**, magnitude `|d|`.
- `d > 0` — the reference point is *outside* our body. Reported as **sunk**.
- A suggestion moves the surface onto the reference: `r_new = r + mean(d)`.

## The solver

Attribute each residual to a prim with `nearestPrim(p, body)` (`validate.ts`), then
bin per prim by angle θ around the bone axis and position t along it. The fix is
read off the **angular shape** of the residual — the first few Fourier terms:

| Term | Meaning | Suggests |
|---|---|---|
| mean (a₀) | uniformly proud or sunk | `r` |
| cos 2θ / sin 2θ | proud on one cross-section axis, sunk on the other | reported as evidence; `scale` itself is solved by least squares (below) |
| cos θ / sin θ | proud on one side only | `offset=` |
| linear trend in t | one end fatter than the other | `r2=` / taper |

Every suggestion is printed with the term that produced it, so the report says
*why*, not only *what*. A term below the noise floor prints `—` rather than a
spurious third decimal.

**Scale is solved by least squares, not by attributing a Fourier term to an
axis.** An earlier draft of this spec picked one world axis to hold and one to
solve, chosen by which axis the bone ran along. **That rule is unsound and was
removed** — it assumed the ring basis tracks world axes closely enough that the
`cos 2θ` term maps onto a single `scale` component, which is only true for
near-axis-aligned bones. Measured on `mouse.blob`:

| bone | direction | dropped axis | margin |
|---|---|---|---|
| `upperarm` | `(0.74, −0.67, −0.03)` | `wide` | **0.074** |
| `forearm` | `(0.62, −0.79, 0.03)` | `tall` | 0.172 |

Two bones in the same chain get different held axes, and `upperarm`'s margin is
so thin that changing its authored `tilt=48` to `44` would flip the tool's
suggestion from `tall=` to `wide=`. Worse, for those diagonal bones `e1` sits
~42° off a world axis — a near-even mix of `wide` and `tall` — so attributing
the residual to either alone is about half right and the rest leaks.

The correct formulation needs no axis choice. For a direction `w` perpendicular
to the bone, the primitive's surface sits at radius

```
ρ(w) = r / sqrt( Σ_k (w_k / s_k)² )
```

whose partials are analytic:

```
∂ρ/∂r    = ρ / r
∂ρ/∂s_k  = ρ³ · w_k² / (r² · s_k³)
```

So fit `(Δr, Δwide, Δtall, Δdeep)` per primitive by **ridge least squares**
against those partials, using each sample's own world direction `w`. A diagonal
bone puts weight in both the `wide` and `tall` columns and the fit distributes
it correctly; the component running along the bone has `w_k ≈ 0`, so its column
is naturally rank-deficient and the ridge term absorbs it rather than producing
a wild value. `tall` on a vertical bone is therefore not suggested because the
data cannot see it, not because a rule excluded it.

The ring basis survives, but only to bin θ and to express an offset — both of
which are correct for *any* orthonormal frame spanning the perpendicular plane,
so its roll no longer carries meaning and `heldAxis`/`solvedAxis` are gone.

`bar` prims (`from=`/`to=`) bin across their span rather than at a single `at=`.

**Mirrored prims share one source line.** `both`/`mirror` expands to two placed
prims, so their suggestions must merge back to a single number. Take the mean, and
**print the left/right disagreement** — a large one means either the reference is
genuinely asymmetric or the alignment is wrong, and both are worth knowing before
trusting the merged value.

### The stated limit

`nearestPrim` returns the closest prim, but at a blend seam the surface belongs to
the smooth-min of two. Each prim therefore reports a **blend-dominated fraction**:
the share of its points having a second prim within blend distance. A prim at 60%
blend-dominated is telling you its number is soft. Surfacing that is the point —
laundering it would reproduce the failure mode the tool exists to remove.

One round of suggestions per run. Apply, then re-run. No auto-iterate loop.

## Output

```
=== mesh docs/dev-notes/refs/mouse-mesh/mouse.glb  scale 0.01000 (24 bones, spread 3.1%)
=== 28914/32260 verts assigned (89.6%), 3346 below weight 0.60
=== head skipped — use `npx tsx scripts/head-profile.ts mouse`

  1. mouse.blob:126   blob torso on chest at=0.50 r=0.065 deep=1.00
     mean 8.2mm proud     n=1840   blend-dominated 12%
     r     0.065 -> 0.057   uniform, -8.2mm
     deep  1.00  -> 1.21    cos2θ: proud 11mm in x, sunk 6mm in z
     offset  —              cos1θ 0.9mm, below noise
```

Worst-first by mean `|residual|`. Every entry names a `.blob` line. `--json` emits
the same content structurally, for agents.

Bone-length ratios follow as a separate short table.

## Modules

Four units. Three pure, one thin CLI. Deliberately **not** added to
`silhouette.ts`, which is already 1013 lines of raster work and is a different
concern.

| Module | Responsibility | Depends on |
|---|---|---|
| `src/lab/sdf-zombie/ref-skin.ts` | GLB skin read, dominant-joint segmentation. Bytes in, `{joint, position}[]` out. | `parseGlb` |
| `src/lab/sdf-zombie/ref-align.ts` | Joint→bone table, global scale, per-bone rigid transforms. | `types.ts`, `vec.ts` |
| `src/lab/sdf-zombie/ring-fit.ts` | Residual binning, Fourier decomposition, per-prim suggestions. The real logic. | `validate.ts` (`sdBody`, `nearestPrim`) |
| `scripts/blob-rings.ts` | Reference resolution, wiring, formatting. | all three |

## Testing

**The load-bearing test is a round-trip with ground truth and no GLB.** Build a
`.blob`, sample points on its surface (project prim-surface samples onto the body
with a few Newton steps along the numeric gradient of `sdBody`), then perturb one
prim's `r` by a known amount and assert the fitter recovers that perturbation.
Repeat for `deep` and for `offset`.

This is the same shape as the zombie anchor test: it must be **proven to fail**
under a deliberate perturbation, not merely observed to pass.

Also:

- **Negative control.** Unperturbed body in, every suggestion below the noise
  floor out. Catches a fitter that always finds something.
- **Mirror merge.** A symmetric body must report zero left/right disagreement; a
  deliberately asymmetric one must report it.
- **`ref-skin.test.ts`** — hand-built minimal GLB bytes, including a vertex below
  `MIN_DOMINANT_WEIGHT` that must be excluded and counted.
- **`ref-align.test.ts`** — a synthetic two-bone rig at two different poses must
  produce identical bone-local point sets.
- **Integration against `mouse.glb`** — pins the *top-3 prim names*, never their
  numbers. Those numbers should move as the `.blob` improves, and pinning them
  would make every genuine improvement read as a regression.

## Open questions

None blocking. Two things to revisit after first use:

1. ~~`MIN_DOMINANT_WEIGHT` starts at 0.60 — an assumption, not a measurement.~~
   **CLOSED 2026-08-27: measured, and moved to 0.50.** Share of vertices kept,
   swept against both real references:

   | threshold | 0.90 | 0.80 | 0.70 | 0.60 | 0.50 | 0.40 |
   |---|---|---|---|---|---|---|
   | mouse | 60% | 68% | 77% | 86% | 95% | 99% |
   | schoolgirl | 41% | 54% | 65% | 80% | 95% | 99% |

   0.50 is the knee — it recovers 15 points on the schoolgirl where 0.40 buys
   only 4 more — and it is the one value on the curve with a meaning behind it:
   a **strict majority**. Above it a joint owns the vertex outright; at or below
   it the vertex is genuinely shared and "dominant" is a plurality. The
   comparison is therefore `<=`, so an exact 0.5/0.5 tie still drops rather than
   being broken by whichever weight the exporter wrote first. Dropped share fell
   14%→5% (mouse) and 20%→5% (schoolgirl).
2. The noise floor for suppressing a Fourier term starts at **one quarter of the
   per-prim residual standard deviation**, so it scales with the character rather
   than being a fixed millimetre count. That ratio is the guess. Per the source
   project's own anti-pattern catalog — *a tolerance the same size as the error it
   is meant to tolerate measures nothing* — re-derive it from the observed spread
   once a real character has been through a pass, and record what it moved to.
