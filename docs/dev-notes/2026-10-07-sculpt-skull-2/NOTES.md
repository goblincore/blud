# The sculpted skull, second pass: variants to choose from (2026-10-07)

The game draws each humanoid's skull as a mesh under the SDF flesh; it shows where flesh is shot or chopped away.
There are two skulls. The **sculpted** one (`?skull=sculpt`) is the character's own bone field, carved and painted.
The **anatomical** one (the default) is a modelled skull of 14 plates.

The owner playtested both on 2026-10-07 and chose the sculpted skull as the base: it fills the head and reads best in
play. What bothers them about it, in their order: the jaw and the teeth, the shape of the eye sockets, the nose
opening, and the lack of a brow ridge, cheekbones and hollows. It is worst on the soldier with his face shot away,
where it looks cartoony rather than frightening.

This pass builds four variants of a more anatomical sculpted skull, switchable by URL, and leaves the default
untouched. Nothing here is the default until the owner picks.

## How to see them

Add `?sculpt=<name>` to the game's URL. It implies `?skull=sculpt`.

| URL (dev server, `npm run dev`) | What it is |
| --- | --- |
| `/sdf-game.html?level=night-train&skull=sculpt` | The sculpted skull as it is today: the reference. |
| `/sdf-game.html?level=night-train&sculpt=shape` | New bone, meshed at the usual 1 cm cell, under the old paint. |
| `/sdf-game.html?level=night-train&sculpt=shape-fine` | The same bone meshed at a 5 mm cell for the head, under the old paint. |
| `/sdf-game.html?level=night-train&sculpt=paint` | The old bone under the new paint. |
| `/sdf-game.html?level=night-train&sculpt=full` | The new bone at 5 mm under the new paint. |

For a room of soldiers to shoot at, use the ring testbed: `/sdf-game.html?spawn=soldier&sculpt=full`.
`__sdfGame.skeletonDiagnostics().sculpt` says which recipe a page is drawing.

## The sheets

- [`look/sheet-as-the-game-ships.jpg`](look/sheet-as-the-game-ships.jpg): every scene from 2.5 m and from 1 m, drawn
  as the game ships: the default post chain with VHS on, the default 800 x 600 internal resolution, wounds bleeding,
  the camera at the player's eye height (1.62 m).
- [`look/sheet-clean-close-up.jpg`](look/sheet-clean-close-up.jpg): every scene from 0.6 m with VHS off and the blood
  drops cleared, plus the jaw and teeth from 0.45 m. This one is for inspecting the work. The game is not judged at
  this distance.

Columns: the old skull (boxed), `shape`, `shape-fine`, `paint`, `full`. Rows: the soldier with his face shot away;
the soldier's bare skull (front, three-quarter, jaw and teeth); the zombie after two slugs (the head burst); the
zombie after the axe's first and second head chop (the head split); the zombie's bare skull.

Each tile is the same 0.34 m window around the head, enlarged from the frame by the factor written on its row
(about 3 times from 2.5 m, 1.2 times from 1 m). The frames are 1280 x 800 captures of the game's 800 x 600 picture. At
2.5 m a head is about 85 pixels tall in the capture, which is about 64 of the game's own pixels.

How the scenes were staged, the same in every column (`scripts/sculpt-skull-look.mjs`, seed 1, frozen cast, the
light clock held at 0):

- **Face shot away:** three real pellet volleys (`fire(1)`) from 2 m, the crosshair 2 cm under the eye line. Every
  column recorded the same 18 wounds, 8 of them on the head. The helmet stays on and the face comes off.
- **Flesh hidden:** one stamped torso wound (an unwounded actor draws no bones), then the flesh's proxy box is shrunk
  to nothing. The bone meshes are untouched.
- **Two slugs:** two real slugs (`fireSlug()`) at the head from 2 m. Every column recorded the same burst.
- **Axe chops:** `axeChop(id, "H", "head")` twice, photographed after each.

`look/shots.json` records, per frame, where the head is and, per boot, the recipe, the wounds and the bone cache's
sizes.

Two limits of the staging, so they are not read as findings:

- The jaw rows are "three-quarter, from the player's eye height". The game holds the player on the floor, so the
  camera cannot go below 1.62 m. The soldier's head centre is at 1.80 m, so his jaw is seen from slightly below. The
  zombie's head centre is at 1.62 m, so his is seen level.
- Loose gore (blood drops, the brain, flesh chunks) is simulated and differs a little between boots. The wounds and
  the bone do not.

## What each variant does

### The second sculpt (`shape`, `shape-fine`, `full`)

`mesh-skull-2.ts`. It starts from the same authored bone as the first sculpt and keeps its frame and landmarks (the
eye line, the eye spacing, the bite line), so the seated eyes and either paint sit where they did. In the head's
normalized coordinates it:

- sinks the forehead 5 mm behind a brow ridge left standing over the orbits;
- cuts orbits that are rounded quadrilaterals, wider than tall, turned 15 degrees so the outer corner droops, with a
  flat floor the eyes sit on;
- hollows the temples 7 mm behind the orbit's outer rim;
- cuts a pear-shaped nasal aperture: narrow under the nasal bones, two lobes at the bottom;
- sinks the face 4 mm under the orbits and beside the nose, which leaves the cheekbones proud;
- cuts the side of the face away under the cheekbone, so the upper jaw is an arch standing forward of the lower jaw's
  rising branch;
- parts the jaws with a real gap (9 mm on the zombie, 8 mm on the soldier), closed only at the back;
- makes the lower jaw an arch with a chin, a groove under the lower teeth and a hollow underside.

The zombie's sculpt only removes bone. The soldier's authored bone is a ball over a small jaw, with a crease between
them where the upper teeth belong. His sculpt first adds an upper jaw in that crease and a branch on each side from
the jaw's corner to the cheekbone, and raises the brow ridge 5 mm and the cheekbones 6 mm. His flesh is 10 to 37 mm
thick there.

Least flesh over any extracted vertex (the first sculpt's guarantee; the tests hold 3 mm):

| | Old sculpt, 1 cm | New sculpt, 1 cm | New sculpt, 5 mm |
| --- | --- | --- | --- |
| Zombie | 3.2 mm | 4.0 mm | 3.8 mm |
| Soldier | 4.5 mm | 4.9 mm | 4.1 mm |

### Mesh size and bake time

The bake is paid once per character at boot. Times are the head's extraction alone, median of 7 runs in Node on this
machine.

| Head | Vertices | Triangles | Bake |
| --- | --- | --- | --- |
| Zombie, old sculpt, 1 cm | 2,220 | 4,448 | 33 ms |
| Zombie, new sculpt, 1 cm (`shape`) | 2,238 | 4,496 | 65 ms |
| Zombie, new sculpt, 5 mm (`shape-fine`, `full`) | 9,144 | 18,296 | 219 ms |
| Soldier, old sculpt, 1 cm | 1,686 | 3,392 | 19 ms |
| Soldier, new sculpt, 1 cm (`shape`) | 1,718 | 3,460 | 45 ms |
| Soldier, new sculpt, 5 mm (`shape-fine`, `full`) | 7,056 | 14,108 | 188 ms |

So the fine cell costs about 4 times the triangles for each head and about 0.2 s more cold boot per sculpted
character. Only the head of a character the sculpt carves uses the fine cell. Every other bone stays at 1 cm.

### The second paint (`paint`, `full`)

`sculpt-paint.ts`. It reads the second sculpt's landmark table, so it sits on that bone in `full` and stands in for
its shapes on the old bone in `paint`. It draws:

- orbits with the sculpt's drooping outline, darker with depth, and a stained halo outside the rim;
- the pear-shaped nasal aperture;
- long separate teeth: crowns that narrow toward the gum, dark wedges between them, a dark gum line, root ridges
  above it, a pointed canine, and the parting of the jaws dark between the rows;
- shade in the temples and under the cheekbones;
- a few bold dark lines: the coronal and sagittal sutures and four cracks.

The same fields give a height in metres, and its gradient tilts the shading normal, so light catches the teeth, the
orbit rims and the ridges. On the old bone the height also carries a brow ridge, cheekbones and hollows. No texture
assets are used.

Two things fade with distance, on purpose. Detail finer than a pixel turns into crawling dots, so past a footprint
of 4 to 9 mm per pixel the teeth become one light band over one dark one, and past 2.5 to 7 mm per pixel the normal
tilt stops.

The paint differs from the old one in tone as well: the bone is drier and more yellow, there are fewer blood
blotches on a head, and the fine red vessels around the sockets are gone. The wound stain near a crater is kept.

### Frame cost

One measurement, not a benchmark: the median time of a still frame with the soldier's bare skull filling the view
from 0.35 m, three runs of 120 frames each.

| Column | Median frame time |
| --- | --- |
| `shape` | 22.8 / 21.5 / 21.4 ms |
| `shape-fine` | 22.5 / 21.4 / 21.5 ms |
| `paint` | 22.2 / 21.5 / 21.7 ms |
| `full` | 23.4 / 21.4 / 21.5 ms |

The four variants are within the run-to-run spread of each other. The old skull read 27.8 / 25.7 / 26.3 ms, but it
was the first boot of the run, so that is not evidence that it is slower. No cost of the new paint or the finer mesh
showed at this scale. A crowd was not measured.

## What works and what does not

Judged on the sheets, at the game's resolution first.

- **`full` is the best in every row.** At 1 m it reads as a human skull: angular sockets under a brow, a pear nose,
  cheekbones, long separate teeth and a parted jaw. At 2.5 m the differences shrink to cleaner dark sockets, a
  clearer nose and a jaw line, which is what survives at that size. On the soldier it also fixes the silhouette: the
  old skull is a light bulb over a hanging bucket, the new one has a face.
- **`paint` gives most of the face for no change of shape.** Sockets, nose and teeth read well at 1 m and still read
  cleaner at 2.5 m. The soldier's silhouette is still the light bulb and the bucket. The painted brow and cheekbones
  barely show in play: the tilt fades with distance and the game's bone lighting is mostly ambient and rim.
- **`shape` and `shape-fine` fix the silhouette and make the teeth worse.** The old paint was drawn for the old bone.
  Its round dark socket patches blur the new angular orbits. Its lower tooth row falls into the new parting, so the
  mouth is a dark slot with a thin strip of teeth. For the owner's first priority, the jaw and teeth, these two are
  no better than today and arguably worse. They are useful for seeing what the bone alone contributes.
- **`shape-fine` over `shape` is visible only in the clean close-ups** (crisper rims and edges). At 1 m and 2.5 m in
  the shipped frames the two cannot be told apart. The finer mesh may not be worth its bake time.

What looks worse or is unfinished, in the variants that otherwise work:

- **The zombie's mouth seen straight on, in `full`.** The lower jaw's rising branches and the cheekbones' lower
  borders frame the teeth as a box. From three-quarter it reads as a jaw. Straight on it is a little mechanical.
- **The seated eyes are untouched.** They are 38 mm rose balls and are now the most cartoon thing in the head. The
  larger, darker orbits help, but the eyes were out of scope.
- **Every head has the same cracks.** The forked crack over the left brow is bold and reads, but it is identical on
  every zombie and soldier. It could be seeded per actor.
- **The new paint is less bloody.** Some may miss the old skull's wet red sockets.
- **At 2.5 m the teeth are a band**, by design. Individual teeth start to read at about 1 m.
- **The axe-chop rows show little difference.** What shows in an open head is mostly the cranium's halves, which the
  variants change least.
- **Other characters' heads** (cultist, bride and the rest) are not carved by either sculpt. Under `paint` and
  `full` they get the new face painted on their plain bone, as they get the old face today. Not reviewed.

Not built:

- **`bake`** (the anatomical skull's detail projected onto the old shape). It is not cheap here: the sculpted path
  does not load the anatomical asset, so it needs that load, a CPU rasteriser, a texture and a sampler in the bone
  material, and a second code path in the split material.
- **Parallax for the sockets.** Both sculpts already have the sockets as real pits about 5 cm deep, so parallax would
  add nothing there. Parallax for the teeth would cost a march of several steps through the tooth field in the bone's
  fragment shader, on a surface a few dozen pixels across at fighting distance.

Not verified:

- The variants in live play on Night Train. The sheets are staged on the ring testbed with a frozen cast.
- Frame cost in a crowd, or on other hardware.
- Shots, eye ejection and the head split were photographed and ran without console errors in all five columns, but
  the head-split and head-burst gates run only on the default skulls, not on the variants.

## Code

| File | What |
| --- | --- |
| `skeleton-spike/sculpt-variant.ts` | The variants and their recipes: which sculpt, the head's cell, which paint. |
| `skeleton-spike/sculpt-cache.ts` | The game's bone cache for a URL (`?sculpt=`). |
| `skeleton-spike/mesh-skull-2.ts` | The second sculpt and its landmark table. |
| `skeleton-spike/sculpt-paint.ts` | The second paint: TypeScript twins and the WGSL written from the same tables. |
| `skeleton-spike/mesh-skull.ts`, `mesh.ts`, `mesh-renderer.ts` | Take the recipe; the default path is unchanged. |
| `skeleton-spike/sculpt-default-pin.test.ts` | Pins the default: the zombie's and the soldier's head mesh bytes and the old paint's shader text, by hashes taken from the tree before this work. |
| `scripts/sculpt-skull-look.mjs`, `scripts/sculpt-skull-sheet.py` | The photographs and the sheets. |

To remake the sheets (own servers, headless):

```
node scripts/sculpt-skull-look.mjs <vite port> <cdp port> <frames dir>
python3 scripts/sculpt-skull-sheet.py <frames dir> docs/dev-notes/2026-10-07-sculpt-skull-2/look
```

## If the owner picks

- **`full`:** make it the sculpted skull's default; decide whether the head needs the 5 mm cell or the 1 cm one is
  enough under the new paint (a `full` at 1 cm was not shot); soften the zombie's boxed mouth; seed the cracks per
  actor; then look at the eyes.
- **`paint`:** make it the default paint and drop the second sculpt, or keep the second sculpt for the soldier only,
  whose silhouette gains the most.
- **`shape` or `shape-fine`:** the old paint needs its teeth and sockets moved onto the new bone first, which is most
  of what the new paint already does.
- **None:** the default is unchanged, and the four variants can be deleted: the four new modules and their tests, and the recipe
  argument in `mesh-skull.ts`, `mesh.ts` and `mesh-renderer.ts`.

Later, per the owner: combine the anatomical skull's breakaway plates with the sculpted skull. Not part of this
pass.
