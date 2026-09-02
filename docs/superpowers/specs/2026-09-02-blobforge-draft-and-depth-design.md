# Blobforge: draft a body from the mesh, and see inside the outline

**Date:** 2026-09-02
**Status:** design, approved
**Supersedes nothing.** Two new tools beside `blob:measure` and `blob:rings`.

Two of the four Blobforge items from the 2026-09-01 review
(`Claude Notes/Blud/2026-09-01-sdf-render-and-blobforge-review.md`). Posing the
reference and `--apply` are deliberately deferred.

## Why

The minotaur is the evidence, and it is worth stating precisely because a
weaker version of this story would justify the wrong work.

Round 1 finished with nine test pins green, `blob:render-check` exit 0, 1995
tests passing, `tsc` clean, and every bone length verified against the
reference rig to 0.1 mm. It was rejected on sight. The torso was a featureless
blob and the prosthetic leg read as a gravestone standing beside the figure.

Two separate failures, and only one of them is a tooling gap:

- **The torso is a measurement gap.** `blob:rings` fits a *radial average* per
  bone, so a smooth cylinder and a heavily muscled torso of equal average
  girth score identically — the same reason it could not see bonewalker's
  iliac blades. `blob:measure` scores a *silhouette*, and interior relief is
  invisible to an outline by construction. Nothing an author could have
  measured would have caught this. **Tool B fixes it.**
- **The prosthetic is a discipline gap.** `daylightOf` measures exactly this —
  surface-to-surface air, ignoring the joint region, with ~2% of standing
  height as the threshold at which separation reads from every yaw. It exists
  and was simply never called. **No tool here fixes that; a brief does.**

Separately, round 1 hand-derived every number in its scaffold, one prim per
rig bone, exactly as bonewalker did before it. No start-from-mesh exists
anywhere in the toolchain. **Tool A** removes that.

## Tool A — `blob:draft <name> [--height H]`

Emits a first-draft `.blob` to stdout, built from a skinned reference. The
author then runs the normal `blob:rings` loop from a body that is already
roughly right instead of from nothing.

Reference resolution matches `blob:rings` exactly: `--glb`, else
`docs/dev-notes/refs/<name>-mesh/<name>.glb`, else the first `.glb` in that
directory with a stderr warning. Rig detection is the existing `detectRig`;
bone grouping is the existing `groupByBone`. No new reference machinery.

### The joint-vs-skin trap, and the medial line

The known failure mode is that a Meshy rig's joints sit **9 to 13 cm off the
skin** (measured on the mouse: the shoulder and collar joints). A draft that
takes its bone axes from joint positions is subtly wrong *everywhere*, which
is worse than hand-authoring — a plausible body nobody can debug.

So the axis comes from the **vertex cloud, not the rig**: for each bone, take
its dominant-weight vertices and fit a medial line through them (principal
axis of the cloud). `len` is that line's extent, not the joint-to-joint
distance. The rig is still used to *group* vertices — that part is exact by
construction, being skin weights — but never to place geometry.

### What each number comes from

| field | source |
| --- | --- |
| `len` | extent of the cloud's medial line |
| `r` | ring MEDIAN of the cloud's radial distance from that line |
| `wide`/`deep` | the cos-2θ term of those radial distances |
| `dir`/`pitch`/`tilt` | inverting `dirVector` on the medial line's direction |

A median rather than a mean for `r` deliberately: the extremes are where blades
and spurs live, and a mean lets one spike move the whole ring. The 2θ term is
the same decomposition `ring-fit` performs on residuals, applied here to the
raw cloud because there is no body yet to take a residual against.

Two things an implementer would otherwise have to guess, pinned here:

- **`wide`/`deep` resolve onto the bone's own axes, not the ellipse's.**
  Fitting `d(θ) ≈ d0 + a·cos2θ + b·sin2θ` gives an ellipse whose semi-axes are
  `d0 ± hypot(a,b)` at orientation `atan2(b,a)/2`. But `.blob`'s `wide`/`deep`
  scale the primitive's OWN axes and carry no rotation, so the fit must be
  resolved onto those axes (`a` alone, with `b` discarded) rather than
  reporting the ellipse's principal orientation. **When `|b|` is large relative
  to `|a|` the cross-section is genuinely rotated and the format cannot express
  it** — emit the axis-aligned approximation and a `# fit:` comment saying by
  how much, so the author knows a hand pass is owed there.
- **The medial line is a straight principal axis, so a genuinely CURVED bone's
  cloud will fit poorly.** Report the residual of the cloud about that line per
  bone; where it is large, the draft is telling the author that bone wants a
  `bend=` it cannot emit.

**Every emitted number carries a `# fit:` comment naming its source**, e.g.
`# fit: median ring radius over 4,732 verts, cloud t 0.15-0.85`. This satisfies
the house rule ("every number has a source") by construction rather than by an
author's discipline.

### What it will NOT emit, and why that is stated in the output

- **`side`/`fwd` bones get a bare `dir=` and NO pitch/tilt.** `dirVector`'s
  pitch is a no-op when the base has no vertical component — `side` has
  `y0 = 0`, so `sign(y0) = 0` (see `blob-compile.ts`). Clavicles are commonly
  `dir=side`. Emitting a derived angle there would be a confident wrong
  number; the draft emits the direction and a comment saying it is not
  derivable.
- **No head, no hands.** The reference rig lumps the whole hand into one
  joint, and head prims are offset-positioned features plus a `face` block.
  `blob:rings` cannot see either, and neither can this.
- **No paint, no palette.** Colour is measured off the mesh's texture, which
  is a different pass.

The draft's header comment says all three out loud, so nobody mistakes a
scaffold for a character.

## Tool B — `blob:depth <name>`

Front and side depth-map diffs between the reference mesh and the compiled
body. This is the instrument that can see inside the outline.

`silhouette.ts` already does most of it and its view conventions are already
fixed and documented — `front: u = world x, depth = z`; `side: u = world z,
depth = x` — with `normalise` mapping both subjects to their own bounding box
so the comparison is about proportion, not size or position in frame.

What it does not do is keep depth, **on purpose**: its own comment reads *"a
silhouette only asks 'is anything here', so depth never has to be resolved."*
That is the extension. `maskFromBody` (which sphere-traces `sdBody`) and
`maskFromTriangles` (which rasterises the reference) both already compute a
hit distance per pixel and discard it.

So: give both an opt-in per-pixel depth buffer, diff where **both** are
occupied, and report the worst regions attributed to an owning `.blob` line —
reusing the attribution `bandOwners` already performs.

Diffing only where both are occupied is deliberate: a pixel occupied by one
and not the other is a *silhouette* difference, which `blob:measure` already
reports and reports better. This tool's whole job is the pixels where the
outline agrees and the surface does not.

## Order, and independence

The two are independent — the depth diff needs nothing from the draft. **Build
the depth diff first:** it is smaller, and it is immediately useful on the
minotaur that already exists, which is a real test case rather than a
synthetic one.

## What this explicitly does not do

- **Pose the reference.** Deferred. `blob:rings` is already pose-free, so
  POSE MISMATCH costs us `blob:measure` on Meshy references and nothing else.
- **`--apply`.** Deferred. Suggestions are still applied by a person.
- **Fix the prosthetic-reads-as-a-gravestone class.** That is `daylightOf`,
  which exists. The fix is a brief that requires it, not a tool.
