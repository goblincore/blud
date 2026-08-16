# Grapeshot gun model — dev notes (2026-08-16)

**Source of truth:** `scripts/model_grapeshot_gun.py` — deterministic (no
randomness anywhere), standalone, runs headless:

```
blender --background --python scripts/model_grapeshot_gun.py
# skip renders:  blender --background --python scripts/model_grapeshot_gun.py -- --no-renders
```

Verified: exit 0 from a clean scene, byte-identical .glb across reruns
(shasum `4f3a6def…` at time of writing).

## Construction choices

Modeled interactively via the Blender MCP bridge, then frozen into the
committed script. All primitives — no booleans, no textures, flat PBR colors.

| Part | Construction |
| --- | --- |
| Stock | 3 beveled boxes (fore-plank, taller butt slab, palm-swell grip) — hand-cut lump silhouette |
| Barrels | 2 steel cylinders (16-seg) side by side, +0.10 breech → −0.58 muzzle |
| Bores | dark inset discs at the muzzle to fake hollow pipes |
| Breech | small beveled steel plate capping both pipes |
| Tape | 3 fat z-squashed (0.82×) cylinders around the pipe pair + 1 strap over the igniter |
| Trigger | bezier tube loop (bent-metal read) + a tilted blade box inside it |
| Igniter | beveled box taped to the right breech side |
| Wires | 2 bezier tubes (red/black) from the igniter block forward along the right pipe to the muzzle tape |

Materials are single-node Principled BSDF, tuned dark (wood 0.23/0.13/0.07,
steel 0.17 @ 0.85 metallic, tape near-black) so the latex FPV hands stay the
visual star per Spec D.

## Numbers

- **2 960 triangles** total (budget: < 8 k)
- **17 named nodes**, 8 materials, **122 KB** .glb (budget: < 1 MB)
- World dims: **0.761 m long** (target ~0.75), 0.101 wide, 0.248 tall
  (trigger loop is the lowest point)
- **Origin at the grip point**; barrel points down −Y in Blender (glTF
  exporter's default +Y-up conversion turns that into glTF −Z forward).
  Round-trip reimport confirmed bounds and node names.
- Grip lump spans y ∈ [−0.045, 0.085] around the origin — that's where the
  SDF hand pose should clamp.

## For the reviewer

- Turntables in this folder: `front.png` (muzzle-on), `back.png` (butt),
  `left.png` (profile — best silhouette read), `three-quarter.png`.
- If proportions need tweaking: all dimensions are literals in `build_gun()`
  with a coordinate comment at the top of the function. Rerun the script and
  the .glb + turntables regenerate together.
- The curve-based parts (trigger loop, wires) are converted to mesh before
  export so the .glb is mesh-only.
