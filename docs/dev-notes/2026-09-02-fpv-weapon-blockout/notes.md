# FPV weapon blockout — the seven rounds that produced the locked silhouette

**Date:** 2026-09-02. **Spec:** [../../superpowers/specs/2026-09-02-fpv-weapon-overhaul-design.md](../../superpowers/specs/2026-09-02-fpv-weapon-overhaul-design.md)

`blockout.py` is the v7 script, run headless:

```
blender -b -noaudio -P docs/dev-notes/2026-09-02-fpv-weapon-blockout/blockout.py -- <outdir> v7
```

It is NOT the shipping model script — it has no GLB export, no named nodes, no
hinge split. It exists because every tuned number in the spec came out of it,
and re-deriving them from prose would be worse than reading the source.

## What each round changed, and why

The owner drove all seven. Recording the *rejected* states matters more than the
final one, because three of them are traps a fresh pass would walk straight back
into.

| round | change | driver |
|---|---|---|
| v1 | boxes + bevels, fat 30 mm barrels, exposed hammers, tape arch | first pass |
| v2 | barrels longer/thinner; arch and stock nub deleted; backstrap + grip became ONE extruded outline | "too cartoony", "grip should transition smoothly into the receiver like the Serbu" |
| v3 | hammers deleted (hammerless boxlock + top lever); ejection port deleted; thin walls over a BIG bore; breech re-cut long and low; top rib + brass bead | "reads more as a pistol than a short shotgun" |
| v4 | receiver/tang/grip became a lofted solid with a varying-width rounded cross-section | "still way too squared off, the Serbu has a very nice rounded backend" |
| v5 | loft rounding pulled WAY back; trigger group traced off the Serbu | v4 overshot — see trap 1 |
| v6 | body outline rebuilt to a measured landmark table; smooth-shade-by-angle | "the trigger cuts into the grip, the receiver needs to be longer" |
| v7 | triggers rebuilt as hanging blades, inline on the centreline; grip filled out; `GRIP_RAKE_DEG` | "triggers are almost horizontally parallel to the barrel"; "top part of the grip is so thin" |

## Three traps

1. **Subdivision and high `round_frac` both DESTROY these forms.** Subsurf on an
   uncreased cube collapses it to ~2/3 volume — that is what ate v1's grip and
   fore-end. Then v4 swung the other way: `round_frac 0.92` rounded the entire
   cross-section into a cylinder and the grip came out a paddle. The Serbu is
   **slab-sided with generously rounded edges**: `round_frac ~0.30`, many loft
   sections, and `shade_smooth_by_angle`. Not subsurf, not a near-1.0 round.

2. **`loft()` silently inverts on a clockwise outline.** `outline_normals` only
   points outward on a CCW loop, so a CW one insets the wrong way and deforms the
   solid. v4's fore-end came out a wedge from exactly this. The function now
   measures signed area and flips; do not remove that.

3. **The trigger/grip collision is a proportion error, not a nudge.** v5 had the
   trigger 4 mm from the grip's front strap. `measure-serbu-profile.py` slices the
   reference and reports the lowest material per slice, which puts the landmarks
   at (fraction of overall length): grip butt 0.00, grip front strap 0.13,
   trigger centre 0.165, guard front 0.20, receiver front 0.36. On a 42 cm gun
   that is a **15 mm** gap and a ~97 mm action body. Build to the table.

## The FPV preview is approximate

`blockout-fpv.png` places the eye by inverting the Blender→glTF axis map
(`(x,y,z)_b → (-x, z, y)_c`) against a grip at camera-space `FPV_GRIP`, under a
75° **vertical** fov to match `lab-renderer.ts:187`. Six attempts did not produce
a frame worth calling good: seen from behind along its own axis the gun
foreshortens hard, and the cant/offset that fixes that has to be tuned live.
Treat this render as a smoke test. **The look gate is an in-engine capture.**

One real finding fell out of it: a grip 0.215 m below and 0.255 m out sits at 40°,
past the 37.5° half-angle of a 75° fov — which is why the CURRENT gun's grip runs
off the bottom edge of `../2026-08-25-grapeshot-model-k3/fpv.png`.
