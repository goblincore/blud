# Night Train — reference study: the *Resident Evil 0* train (art direction)

**Date:** 2026-09-24 · **For:** the train carriage kit spec · **Design:** [design.md](design.md)

**Source:** a fan recreation of RE0's opening train, from Sketchfab (by Katydid, Sketchfab
Standard licence), supplied by the owner as `~/Downloads/resident-evil_train.glb`. **Reference
only**, the same rule as Blood: nothing from the file (geometry, textures, renders) is
committed or shipped. What we take is the *type* of interior: mood, materials, proportions.
Never its layout or details. Renders were made headless in a scratch scene and not kept.

## What is in the file

Three carriages in a row, each about 12 m long (the model's units read as centimetres):

1. **A coach:** pairs of high-backed seats either side of a central aisle, vestibules at
   both ends.
2. **A sleeper:** a narrow side corridor along one wall, compartments along the other,
   opening into a wood-floored day room with one carpeted compartment.
3. **A lounge / dining car:** a long patterned carpet runner, red velvet tub chairs along the
   windows, an ornate moulded ceiling, and a wrecked far end (debris, a smashed section).

## What makes it read as "old-timey train"

- **Dark wood everywhere below the waist:** a panelled dado with vertical boards along both
  walls, a dark plank floor (in the corridors), heavy wood door frames.
- **Pale plaster or leather above:** stained, mottled cream wall panels between the dado and
  the ceiling. The contrast of dark wood below and pale panels above is the single strongest cue.
- **Brass:** window frames, handrails along the corridor windows, door handles, round
  porthole-like ornaments on the compartment wall.
- **The ceiling:** a shallow curved or clerestory roof with a lighter rail running its length,
  a row of small ribbed brackets along each side, and round ceiling lamps at intervals. The
  lounge has a moulded, patterned ceiling.
- **Soft goods:** torn lace or fringe curtains at the windows, patterned carpet runners
  (dark blue, ornate), red velvet upholstery.
- **Windows** are black (night outside) in brass or wood frames. They are the brightest
  edges in the scene, not light sources.
- **Decay:** broken windows, torn curtains, a wrecked end of the lounge. It fits our
  "decadent decay" note from the Wake.

## Proportions (measured by raycast from the aisle)

| | RE0 recreation | Our design (goblin scale, [design §7](design.md)) |
| --- | --- | --- |
| Interior width, wall to wall | 2.6–2.8 m | 3.0 m |
| Floor to ceiling | about 1.8 m | 2.6 m (party carriage 3.2 m) |
| Sleeper side corridor | about 1.0 m | at least 1.4 m (enemy navigation) |
| Carriage length | about 12 m | 16–20 m |

The recreation is built for fixed camera angles: the ceiling and corridor are far too tight
for first person. **Take its materials and silhouette, not its dimensions.** Our 2.6 m ceiling
and 1.4 m minimum aisle stand.

## Lessons for the kit

1. **Two-tone walls:** a dark wood dado (about 0.9–1.0 m) under pale, stained panels. It works
   at any carriage length and is cheap: one wall module, textured.
2. **The ceiling sells it:** a clerestory rail plus side brackets plus round lamps, repeated at
   a fixed pitch. The kit needs a ceiling module, not a flat plane.
3. **Brass as the accent** on frames, rails and handles: few triangles, and it catches the
   flashlight.
4. **Repeat a bay:** window, pillar, lamp, bracket, seat pair every ~1.8–2.0 m. A carriage is a
   bay module repeated, which matches kit instancing.
5. **Soft goods for mood:** curtains, runners and upholstery can be simple planes and boxes
   with a good texture.
6. **Decay as variants,** not separate models: a broken window, a torn curtain, a fallen rack.
