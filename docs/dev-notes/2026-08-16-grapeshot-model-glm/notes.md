# Grapeshot gun model (glm bake-off run) — construction notes

**Date:** 2026-08-16
**Script:** `scripts/model_grapeshot_gun_glm.py` (deterministic, standalone)
**Output:** `public/assets/lab/grapeshot-gun-glm.glb`
**Spec:** `docs/superpowers/specs/2026-08-16-sdf-lab-grapeshot-design.md` §1

Reproduce: `blender --background --python scripts/model_grapeshot_gun_glm.py`
(from repo root; writes the .glb and the 4 turntable PNGs in this folder).

## Numbers

| Metric | Value | Budget |
|---|---|---|
| Triangles (scene / exported glb) | **1,372 / 1,516** | < 8,000 |
| .glb size | **68 KB** | < 1 MB |
| Length (Y, muzzle→butt) | 0.769 m | ~0.75 m |
| Width / height | 0.103 m / 0.238 m | — |
| Mesh objects | 20 (+ GunRoot empty) | — |

Origin is the **grip point** (grip block center); muzzle points down **−Y** in
Blender; the glTF exporter's default axis conversion handles the rest. The
`GunRoot` empty parents every part, so a runtime can transform the whole gun
as one node.

## Construction choices

Everything is built from primitives (boxes / cylinders / one low-seg torus /
bevel-depth curves for wires), then converted to plain meshes. Fixed seed
(`random.Random(1337)`) drives all hand-cut jitter and tape-wrap skew.

- **Plank stock** — box subdivided 4× along its length, tapered ~10% toward
  the muzzle, per-vertex jitter ±4 mm, rough-sawn top bulge, 5 mm bevel.
  Reads boxy/hand-cut, not machined. 180 tris.
- **Twin pipes** — 16-segment cylinders (Ø 38 mm each, 48 cm long), side by
  side at x = ±20.5 mm on the plank top. 12-segment dark bore insets recessed
  in the muzzle faces fake open bores for 44 tris each. Fully smooth-shaded.
- **Tape wraps** — chunky boxes with pulled-in end faces (stretched-wrap
  look) + ±1.2 mm jitter + a few degrees of roll so each band sits crooked:
  3 wrapping plank+pipes, 2 on the muzzles, 1 holding the igniter. 12 tris
  each. Deliberately oversized (104 mm wide over the 103 mm assembly).
- **Trigger loop** — 12×6 torus (52 mm outer — oversized per claymation
  proportions), hole axis along X, plus a small angled blade inside. 144+12 tris.
- **Igniter block** — dark bakelite-ish box taped under the plank ahead of
  the trigger, slight 2° skew. 108 tris.
- **Wires** — 3 bezier tubes (Ø 8.4 mm — chunky on purpose), resolution 3,
  octagonal cross-section: two run from the igniter back along the plank
  sides up to the pipe breech, one loops to the trigger. ~136 tris each.
- **Grip / butt** — angled beveled boxes; grip leans back 18°, stock slants
  down 6° rearward, taped butt plate.

## Materials

Dark and matte so the SDF latex hands stay the visual star (spec §1): wood
albedo 0.155/0.095/0.05 rough 0.85; steel albedo ~0.05 metallic 1.0 rough
0.45; tape near-black rough 0.92; wires rubber-dark + one muted cloth-tan for
readability; bores near-black. No textures — materials only, keeping the glb
tiny. If the art pass later wants more separation, the tape could go a shade
lighter without touching geometry.

## Determinism

Two clean runs produce a **byte-identical .glb** (md5 `de94989e…`). The
turntable PNGs differ slightly between runs — EEVEE's render noise seed is
not exposed; geometry, materials and framing are identical. If byte-stable
review renders ever matter, switch those to Cycles and pin `scene.cycles.seed`.

## Review-render caveat

The authoring agent cannot see images — the turntable PNGs are for human
review, and the script prints per-view luminance diagnostics (background
level, max, subject coverage, subject bbox) as a stand-in eye. In this run:
bg 0.275, max 0.48–0.74 (no clipping), side view subject spans 86% of frame
width — matching the 0.769 m gun at 1.36 m with a 55 mm lens, so framing is
as intended.

Two traps found while wiring the render block (recorded to dualmem): the
"flat white" renders in the interactive session were a 4-sun overexposure
bug, and early "no subject" verdicts were cameras staring at backlit dark
faces against a similar-value world — the render pipeline was never broken.
