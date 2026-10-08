# Anatomical humanoid skull

**Status, 2026-10-07: opt-in.** This skull was the forward mesh default from 2026-10-06 to 2026-10-07. After
playtesting it against the sculpted skull the owner chose the sculpted one, in its variant `full`, as the default: it
fills the head and reads better in play. The anatomical skull is drawn with `?skull=anatomical`, and its asset is
loaded only then. Everything below holds for a page that asks for it; "the forward mesh default" and "retain
`?skull=sculpt` for comparison" are no longer true (a page with no skull parameter draws the sculpted skull, and the
earlier sculpted look is `?sculpt=classic`). One function decides which skull a page draws, `resolveSkull` in
`src/lab/sdf-zombie/webgpu/skeleton-spike/sculpt-variant.ts`; the decision and its consequences are in
[the notes](../../dev-notes/2026-10-07-sculpt-skull-2/NOTES.md).

Use the supplied Downloads GLB for a simplified anatomically faithful humanoid skull. Preserve major anatomical bone boundaries, orbit and nasal cavities, mandible and dental silhouette. Budget: 10k triangles total, one normal atlas, stable names and per-piece pivots. Source metadata credits WitmerLab / CC BY-NC-ND 4.0; the user confirmed separate permission for this modified game asset on 2026-10-06. Preserve embedded provenance. The original and editable high reference stay outside public in ignored scratch; only the finished low mesh and manifest enter public assets.

Review intact and exploded geometry in Blender. Game integration must share intact geometry across actors, fit within intact flesh, follow the head affine deformation, and preserve existing wound/sever behavior. Fracture selection and impulses belong in renderer-free tested modules. Do not add a texture march for details a normal bake can carry; real openings and fracture thickness require geometry.

The delivered asset has 9,947 triangles, fourteen pieces and one embedded 1024-square normal atlas. Group minor palate/lacrimal bones into maxillae, lower teeth into mandible, and the small internal nasal bones into one core. Keep frontal, paired parietals, occipital, paired temporals, paired zygomatics, paired maxillae, upper teeth, mandible, cranial base and nasal core distinct.

Make anatomical skulls the forward mesh default for the thirteen supported humanoid head sources. Retain `?skull=sculpt` for comparison and fall back to sculpt if loading fails. Deferred and procedural rendering, nonhumanoid heads and bones embedded in detached flesh chunks keep their existing path.

Ray-test actual triangles in the posed head frame. A slug releases one plate; three pellets into that plate release it. Removed pieces cannot release twice. Head pops release every remaining plate. The melee brain stage uses the same fracture seam, with existing chip fallback when it cannot release a plate. Launch fragments through existing mesh-gib physics with deterministic impulses, shape supports and an independent bounded pool. Intact skulls stay one shared draw; only damaged heads split into per-piece draws.

**On a split head** (the axe's head split, [spec section 10.5](2026-10-04-axe-and-head-split-design.md); built 2026-10-06, [notes](../../dev-notes/2026-10-06-split-anatomical-skull/NOTES.md)). A head the axe has opened draws its skull once per piece of the split, each copy turned about the hinge and clipped along the fracture. The plates take part in that as plates: they have a split material of their own (the plate's surface and normal map on both faces, cut bone within 4 mm of the fracture, no painted inner wall), a damaged skull is drawn as its surviving plates' clipped copies, and a pellet or slug is ray-tested against the plates where they are drawn, so the plate that breaks is the one the player sees hit and its fragment leaves from the opened half. The bone of an open head stands in the gap with no flesh in front of it, and the projectile loop finds its hits on the flesh: for such a head a round's step is cast at the skull from the step's start, and a step that meets none of the actor's flesh is cast along its length, so that bone can be shot too (one plate of a skull to a round). A plate the fracture runs through is still one plate to a hit. The sculpted skull keeps its own split path under `?skull=sculpt`.
