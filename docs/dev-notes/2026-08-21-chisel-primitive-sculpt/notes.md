# Chisel for sculpting SDF PRIMITIVES (not baking grids)

**Date:** 2026-08-21
**Status:** Spike done, decision open
**Artifacts:** `scarecrow-chisel.blend`, `scarecrow.png`, `scarecrow-threequarter.png`

## Not the same question as the 2026-08-19 spike

[`2026-08-19-chisel-sdf-qualification`](../2026-08-19-chisel-sdf-qualification/notes.md)
asked whether Chisel could replace OpenVDB as a **mesh-to-SDF-grid** backend.
It could not, and Chisel stayed dev-only tooling. `X1.humanoid-sever-spike`
separately concluded that a **baked** SDF buys detail and costs deformability,
which is why the primitive zombie was kept.

Neither verdict touches this question, which is whether Chisel is a good
**authoring front-end for a primitive composition** — the same kind of thing
`.blob` compiles, still deformable, still a handful of numbers per limb.

## What Chisel actually is

Enabled here as `bl_ext.user_default.chisel` 4.0.1, with a `CHISEL` render
engine (its own raymarcher) and **90 operators**, all driveable from script —
`add_sphere/box/cone/capsule/cylinder/oblong/torus/trapezoid/prism/ngon/
curve/curve_tube/curve_revolve`, `add_boolean`, `set_profile`,
`convert_to_mesh`, `convert_to_sdf`.

The spike's note that "Chisel's normal operator is modal" is about the
interactive placement tool. `bpy.ops.chisel.add_sphere()` returns `FINISHED`
immediately, so the whole thing scripts cleanly over MCP.

Each primitive is a Blender object carrying `ob.chisel.primitive`:

```
primitive_type   SPHERE | BOX | OBLONG | NGON | CYLINDER | CONE | TORUS |
                 CAPSULE | PRISM | TRAPEZOID | CURVE | CURVE_TUBE |
                 CURVE_REVOLVE | MESH
half_extents     (x, y, z)
rounding         corner radius
profile          ROUND | SHARP | SOFT | TIGHT | CHAMFER
bevel            + bevel_profile, bevel_chamfer_smooth
cone_cap, major_radius, minor_radius, tube_radius, prism_sides, ...
```

Booleans carry `blend_radius` + the same five `blend_profile`s.

Materials: the engine reads a custom node tree, and **falls back to
`mat.chisel.color`** when there is none — so colour is one assignment, no node
wiring. That is what the renders here use.

## The finding that matters

**The wall we keep hitting is not the authoring tool. It is `.blob`'s
vocabulary.**

`.blob` has exactly one primitive — an axis-scaled capsule — and exactly one
blend, the quadratic polynomial smooth-min, with `hard` (k=0) as the only
alternative. That is why a sharp curved nose has been unreachable: smooth-min
rounds every tip it touches, and the goblin's nose is two ellipsoids faked into
a hook that reads as a bump in profile (`goblin.blob` says as much).

Chisel makes the gap concrete rather than theoretical. Two things it has that
`.blob` does not, and both are exactly the missing capability:

1. **Primitives that taper to a point** — `CONE`, `TRAPEZOID`, `PRISM`. The
   scarecrow's nose is one cone with `rounding=0`, and it is a real point.
2. **Blend profiles.** `SHARP` and `CHAMFER` give a crease where smooth-min
   gives a fillet. `.blob` can only choose between "fillet" and "no blend at
   all".

## The scarecrow

Built entirely from Chisel primitives via MCP, ~34 of them, in three passes of
about a minute each: sphere head, cone hat brim + cylinder crown, oblong torso,
cone skirt, capsule arms, oblong shoes, box eyes, trapezoid grin, a ring of
cones for the straw fringe, a cone nose, cylinder haft and trapezoid blade.

It reads as the reference. Worth being honest about what that does and does not
prove: this is *composition*, not *sculpting* — every shape is still a
parametric primitive with numbers, exactly like `.blob`. What Blender adds is
**seeing it while you place it**, and a wider primitive vocabulary. It does not
add organic freeform detail, and it is not obviously better than typing numbers
once the shapes are known.

Three orientation traps cost most of the iterations, all silent:

- A `CONE` runs along its **local Z**, so the long axis belongs in
  `half_extents[2]`. Put it in `[1]` and you get a squat cone aimed sideways.
- The apex is at **local −Z**, so `rot_x = +90°` points the tip away from a −Y
  camera. It renders as a flat disc — which looked exactly like a small sphere
  and read as "the cone did not work".
- `bpy.ops.chisel.add_*` places at the 3D cursor and makes the new object
  active; set `location`/`rotation_euler` **after**, not before.

## Options, in increasing order of cost

1. **Extend `.blob`'s vocabulary** — a tapered capsule (`r0`/`r1`) and one or
   two more blend profiles in the WGSL and its CPU mirror. Directly fixes the
   sharp-nose problem, in the engine, no Blender in the loop, no new format.
   Everything stays deformable. This is the smallest change with the biggest
   return, and Chisel is not required for it — the spike just showed which
   knobs are missing.
2. **Chisel → `.blob` exporter.** Primitives are Blender objects with readable
   properties, so a script could emit `.blob` from a selection. Only worth it
   once (1) exists, because today most Chisel primitives have no `.blob`
   equivalent to export *to*.
3. **Chisel as a preview/diagnostic surface** — already true and free.

Chisel remains GPL-3.0 and dev-only. Nothing from it may be vendored, and
nothing in the game may depend on it.
