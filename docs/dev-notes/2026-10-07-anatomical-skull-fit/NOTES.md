# The anatomical skull's fit to the head: variants to choose from (2026-10-07)

Branch `claude/anatomical-skull-fit`, on top of `claude/split-anatomical-skull`. The default is unchanged; everything
here is behind the dev URL parameter `?skullfit=`.

**Since (2026-10-07, merged into `claude/sculpt-skull-2`):** the sculpted skull is the game's default, and this fit is
what the eight humanoids with no skull-shaped head bone draw by default: `snug`, fitted to the skin and held on the
painted eyes' line, per character. `?skullfit=<name>` still gives a named fit, to whoever draws the anatomical skull
(the eight by default, every humanoid under `?skull=anatomical`); it is read by `resolveSkull` now, and the fit runs
at spawn. The eyes of a skull fitted to the flesh are seated in its own orbits. This file is as it was written:
[the per-character table and what changed](../2026-10-07-sculpt-skull-2/NOTES.md).

## The complaint

The game draws each humanoid's skull as a mesh under the flesh: one anatomical skull of fourteen plates
(`public/assets/lab/anatomical-skull.glb`), fitted to each character's head. The owner playtested the zombie and found
the skull far too small inside the head: through a slug head burst, where the face is blown open, the skull sits small
in the cavity, and it reads worse than the sculpted skull it replaced.

The fit that ships (`skullFitMatrix` in `src/lab/sdf-zombie/webgpu/skeleton-spike/anatomical-skull.ts`) sizes the
skull to fixed shares of the head's bone envelope, a loose box around the authored bone prims. On the zombie that gives
a skull of 141 x 204 x 156 mm in a flesh head 180 mm wide, against the sculpted skull's 167 x 239 x 202 mm: 0.56 of the
sculpt's box volume. On heads whose bone prims are narrow it is far worse: the female's skull is 43 mm wide in a head
127 mm wide, the cultist's 63 mm in 162 mm.

It cannot simply be scaled up on the zombie. The zombie's head narrows toward the crown, and a human cranium is widest
high up: the upper sides of the cranium already sit 3.3 mm under the skin, while the face has 20 to 35 mm of flesh over
it and the back of the head 60 mm.

## What was built

A fit that reads the flesh instead of the bone envelope, in two stages, as a pure module with no renderer in it
(`skeleton-spike/skull-fit.ts`; the flesh it reads is `skeleton-spike/head-flesh.ts`).

1. **Size and place.** The flesh head is measured along its three axes. The skull's box aims at a share of that on
   each axis, and no axis scale may be more than 1.15 times another, so the skull keeps a skull's proportions. The
   skull is held by the point midway between its orbits: on the head's middle plane, and (for the three warped fits) at
   the height the game seats the eyes, so the face of the bone stays behind the face of the flesh at any size. It is
   then shrunk until no vertex needs more than a budget to get under the flesh, and each axis is grown again by itself
   as far as the flesh allows, the width first.
2. **Keep it under the flesh.** Where the sized skull would come within the margin of the skin, that region is pulled
   inward along the flesh's own gradient. The pull is a smooth displacement field with a falloff radius of 0.30 of the
   skull's width (45 mm on the zombie), so neighbours follow and no crease forms; vertices further than that from any
   offending vertex do not move at all. The field is a function of position alone: two vertices at one place move as
   one (seams and UV splits stay closed), a plate's inner surface moves with its outer one, and the authored normals
   are carried by the field's Jacobian rather than recomputed. Stage 1 leaves stage 2 a bounded job: no vertex of
   the cranium's plates may lack more than 0.10 of the skull's width when it is done, and none of the face's plates
   (cheekbones, jaws, teeth, nose) more than 0.03 to 0.04.

"The flesh" is the head's own flesh: the prims that turn with the rigid head, without hair strands and cloth shells.
It is closed under the chin, so the jaw is bounded by the chin and not by the neck, and bone held under it stays
covered when the head turns. On every humanoid a point inside it is at least as deep inside the whole body's flesh.

Everything downstream is made from the one fitted result: each plate's geometry and its debris twin, its pivot and
box, the triangles a shot is tested against, the merged whole skull, and the whole skull's box, which the head split
now bounds the skull by (a fitted skull can be larger than the bone envelope the default is bounded by).

## The fits, and how to try them

Add the parameter to any game URL, for example `/sdf-game.html?skullfit=snug` (the bare ring testbed) or
`/sdf-game.html?level=night-train&skullfit=snug`. `?spawn=<character>` puts another character in the zombie slots.

| URL parameter | What it is | Flesh kept over every vertex | Aimed share of the flesh | Stage 2 |
| --- | --- | --- | --- | --- |
| none, or `?skullfit=envelope` | What ships today: fixed shares of the bone envelope | 2 mm (by its own test) | not read | no |
| `?skullfit=affine` | Stage 1 alone, placed freely: the largest the skull can be with no vertex moved | 6 mm | 0.92 | no |
| `?skullfit=mid` | Both stages, orbits on the eye line | 10 mm | 0.88 | yes |
| `?skullfit=snug` | Both stages, orbits on the eye line | 6 mm | 0.92 | yes |
| `?skullfit=tight` | Both stages, orbits on the eye line | 3 mm | 0.95 | yes |
| `?skull=sculpt` | The sculpted skull, for comparison (no anatomical skull at all; `skullfit` is ignored) | | | |

Three fits were planned: `affine`, a middle one keeping about 14 mm of flesh, and a snug one keeping about 6 mm. The
measurements moved them: at 14 mm the zombie's skull comes out no larger than today's, so `mid` keeps 10 mm; and a
skull the sculpt's size needs the sculpt's own least cover, 3 mm, so there is a fourth, `tight`.

## Look sheets

- [`look/01-zombie.jpg`](look/01-zombie.jpg): the zombie under the sculpt, today's fit and the four fits. Rows: closed
  head with the flesh hidden, from the front and from the side; the flesh drawn half see-through over the bone; a slug
  head burst after one and after two slugs; the axe's first and second head chop.
- [`look/02-other-characters.jpg`](look/02-other-characters.jpg): the soldier, the cultist, the female, the bride and
  the clown, closed head from the front with the flesh half see-through over the bone, same columns. (The bride's
  flesh is not drawn by the game when she is spawned this way, so her row is bone alone.)

Every column is one boot of the game with that URL. Blood spray and the player's weapon are switched off for the
photos. The eyes in every column are seated by the existing rule (see "The eyes" below). The pale ball beside the jaw
in four columns of the first sheet is a separate bone mesh the game draws there under today's fit too; it was not
looked into.

## The zombie, measured

Head frame: x across, y up, z out of the face; millimetres. The flesh head measures 180 x 281 x 226 mm through its
deepest point. "Flesh over bone" is the whole body's flesh field at rest, read at every vertex of the skull.

| | Size x, y, z | Share of the flesh, wide / deep | Flesh over bone: least / median / median over the outer surface | Width at the orbits | Axis scales | Furthest vertex move | Vertices moved | Time of the fit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sculpted skull | 167, 239, 202 | 0.92 / 0.89 | 3.2 / 11.9 / 10.5 | | | | | |
| `envelope` (today) | 141, 204, 156 | 0.78 / 0.69 | 3.3 / 33.9 / 26.1 | 135 | 1.02, 0.98, 0.90 | 0 | 0% | 3 ms |
| `affine` | 146, 226, 187 | 0.81 / 0.83 | 6.1 / 28.3 / 24.0 | 141 | 1.06, 1.09, 1.08 | 0 | 0% | 26 ms |
| `mid` | 143, 219, 179 | 0.79 / 0.79 | 10.0 / 27.3 / 19.1 | 141 | 1.06, 1.08, 1.06 | 18.8 | 49% | 44 ms |
| `snug` | 151, 231, 189 | 0.84 / 0.84 | 6.1 / 24.1 / 15.4 | 149 | 1.12, 1.14, 1.12 | 19.4 | 50% | 41 ms |
| `tight` | 156, 242, 197 | 0.87 / 0.86 | 3.1 / 20.4 / 12.6 | 154 | 1.16, 1.20, 1.17 | 21.0 | 54% | 43 ms |

The median over all vertices counts the plates' inner surfaces and the bone inside the skull (the anatomical skull has
them; the sculpt is one closed shell), so the outer-surface median is the fairer comparison with the sculpt: 26 mm
today, 15 mm with `snug`, 13 mm with `tight`, against the sculpt's 10.5 mm.

In box volume against the sculpt: today 0.56, `affine` 0.77, `mid` 0.69, `snug` 0.82, `tight` 0.93.

## All thirteen characters

The flesh head each fit was sized to:

| Character | Flesh head, width x height x depth (mm) |
| --- | --- |
| zombie | 180 x 281 x 226 |
| soldier | 177 x 254 x 192 |
| cultist | 162 x 241 x 235 |
| cultist-cowled | 162 x 229 x 236 |
| bride | 157 x 231 x 190 |
| female | 127 x 242 x 155 |
| schoolgirl | 193 x 228 x 205 |
| schoolgirl-alt | 181 x 212 x 178 |
| schoolgirl-described | 136 x 208 x 181 |
| clown | 555 x 355 x 434 |
| clown-alt | 555 x 355 x 434 |
| juggernaut | 204 x 259 x 220 |
| bonewalker | 122 x 199 x 198 |

Size of the skull, x by y by z in millimetres:

| Character | sculpt | envelope | affine | mid | snug | tight |
| --- | --- | --- | --- | --- | --- | --- |
| zombie | 167 x 239 x 202 | 141 x 204 x 156 | 146 x 226 x 187 | 143 x 219 x 179 | 151 x 231 x 189 | 156 x 242 x 197 |
| soldier | 150 x 213 x 167 | 137 x 182 x 132 | 130 x 194 x 168 | 140 x 201 x 162 | 147 x 222 x 169 | 154 x 232 x 179 |
| cultist | 80 x 151 x 120 | 63 x 120 x 91 | 130 x 218 x 177 | 134 x 210 x 182 | 144 x 219 x 193 | 152 x 229 x 208 |
| cultist-cowled | 80 x 141 x 101 | 63 x 111 x 76 | 131 x 192 x 175 | 134 x 199 x 172 | 143 x 208 x 184 | 149 x 207 x 194 |
| bride | 112 x 193 x 136 | 109 x 157 x 109 | 130 x 187 x 157 | 132 x 198 x 166 | 140 x 208 x 172 | 146 x 215 x 176 |
| female | 52 x 220 x 127 | 43 x 144 x 100 | 108 x 183 x 134 | 97 x 156 x 108 | 102 x 174 x 122 | 111 x 184 x 129 |
| schoolgirl | 72 x 169 x 150 | 58 x 134 x 115 | 152 x 200 x 181 | 150 x 195 x 176 | 160 x 208 x 187 | 166 x 216 x 195 |
| schoolgirl-alt | 68 x 161 x 141 | 54 x 128 x 108 | 142 x 188 x 162 | 139 x 182 x 152 | 150 x 195 x 162 | 155 x 202 x 169 |
| schoolgirl-described | 58 x 168 x 72 | 47 x 134 x 57 | 113 x 180 x 150 | 124 x 183 x 149 | 132 x 191 x 160 | 134 x 198 x 170 |
| clown | 178 x 208 x 178 | 139 x 163 x 134 | 250 x 327 x 313 | 240 x 312 x 299 | 250 x 327 x 313 | 259 x 337 x 323 |
| clown-alt | 178 x 208 x 178 | 139 x 163 x 134 | 250 x 327 x 313 | 240 x 312 x 299 | 250 x 327 x 313 | 259 x 337 x 323 |
| juggernaut | 172 x 254 x 194 | 158 x 209 x 152 | 158 x 212 x 197 | 167 x 223 x 189 | 175 x 233 x 200 | 181 x 241 x 206 |
| bonewalker | 47 x 125 x 95 | 39 x 101 x 75 | 91 x 155 x 131 | 83 x 134 x 118 | 95 x 151 x 134 | 106 x 173 x 152 |

Share of the flesh head, width / depth:

| Character | sculpt | envelope | affine | mid | snug | tight |
| --- | --- | --- | --- | --- | --- | --- |
| zombie | 0.92 / 0.89 | 0.78 / 0.69 | 0.81 / 0.83 | 0.79 / 0.79 | 0.84 / 0.84 | 0.87 / 0.87 |
| soldier | 0.85 / 0.87 | 0.78 / 0.69 | 0.74 / 0.88 | 0.79 / 0.84 | 0.83 / 0.88 | 0.87 / 0.93 |
| cultist | 0.50 / 0.51 | 0.39 / 0.39 | 0.81 / 0.75 | 0.83 / 0.77 | 0.89 / 0.82 | 0.94 / 0.88 |
| cultist-cowled | 0.50 / 0.43 | 0.39 / 0.32 | 0.81 / 0.74 | 0.83 / 0.73 | 0.88 / 0.78 | 0.92 / 0.82 |
| bride | 0.71 / 0.71 | 0.70 / 0.57 | 0.83 / 0.83 | 0.84 / 0.87 | 0.89 / 0.91 | 0.93 / 0.93 |
| female | 0.41 / 0.82 | 0.34 / 0.64 | 0.85 / 0.86 | 0.76 / 0.70 | 0.81 / 0.79 | 0.87 / 0.83 |
| schoolgirl | 0.38 / 0.73 | 0.30 / 0.56 | 0.79 / 0.89 | 0.78 / 0.86 | 0.83 / 0.91 | 0.86 / 0.95 |
| schoolgirl-alt | 0.37 / 0.79 | 0.30 / 0.60 | 0.78 / 0.91 | 0.77 / 0.85 | 0.83 / 0.91 | 0.86 / 0.95 |
| schoolgirl-described | 0.43 / 0.40 | 0.35 / 0.31 | 0.83 / 0.83 | 0.91 / 0.82 | 0.97 / 0.88 | 0.99 / 0.94 |
| clown | 0.32 / 0.41 | 0.25 / 0.31 | 0.45 / 0.72 | 0.43 / 0.69 | 0.45 / 0.72 | 0.47 / 0.74 |
| clown-alt | 0.32 / 0.41 | 0.25 / 0.31 | 0.45 / 0.72 | 0.43 / 0.69 | 0.45 / 0.72 | 0.47 / 0.74 |
| juggernaut | 0.84 / 0.88 | 0.77 / 0.69 | 0.77 / 0.89 | 0.82 / 0.86 | 0.86 / 0.91 | 0.89 / 0.94 |
| bonewalker | 0.38 / 0.48 | 0.32 / 0.38 | 0.75 / 0.66 | 0.68 / 0.59 | 0.78 / 0.68 | 0.87 / 0.76 |

Flesh over the bone in millimetres: least / median over all vertices / median over the outer surface:

| Character | sculpt | envelope | affine | mid | snug | tight |
| --- | --- | --- | --- | --- | --- | --- |
| zombie | 3.2 / 11.9 / 10.5 | 3.3 / 33.9 / 26.1 | 6.1 / 28.3 / 24.0 | 10.0 / 27.3 / 19.1 | 6.1 / 24.1 / 15.4 | 3.1 / 20.4 / 12.6 |
| soldier | 4.5 / 13.0 / 12.7 | 6.1 / 32.6 / 27.3 | 6.2 / 28.2 / 23.3 | 10.0 / 26.8 / 20.1 | 6.0 / 24.0 / 16.6 | 3.1 / 21.0 / 14.0 |
| cultist | 40.5 / 45.2 / 45.2 | 26.7 / 46.2 / 48.0 | 6.1 / 31.1 / 23.9 | 10.1 / 29.6 / 22.2 | 6.0 / 25.8 / 17.8 | 3.1 / 20.5 / 14.1 |
| cultist-cowled | 30.5 / 44.7 / 44.9 | 36.9 / 49.3 / 50.9 | 6.0 / 26.1 / 23.3 | 10.1 / 26.0 / 21.3 | 6.0 / 22.0 / 17.6 | 3.1 / 18.9 / 15.7 |
| bride | 16.7 / 22.5 / 22.2 | 11.7 / 33.9 / 31.1 | 7.2 / 23.7 / 19.6 | 10.1 / 22.4 / 17.5 | 6.0 / 19.6 / 14.0 | 3.2 / 16.8 / 11.4 |
| female | 18.6 / 38.7 / 39.4 | 4.2 / 39.6 / 39.7 | 6.0 / 21.1 / 17.9 | 10.1 / 35.6 / 27.0 | 6.0 / 33.4 / 24.4 | 3.1 / 30.9 / 22.5 |
| schoolgirl | 23.4 / 50.3 / 51.9 | 26.3 / 48.9 / 51.6 | 6.2 / 25.2 / 21.9 | 10.1 / 25.8 / 23.4 | 6.0 / 22.0 / 19.5 | 3.2 / 20.3 / 17.0 |
| schoolgirl-alt | 22.1 / 46.0 / 48.1 | 23.5 / 44.6 / 46.8 | 6.2 / 22.3 / 19.3 | 10.0 / 23.7 / 22.4 | 6.1 / 20.2 / 17.8 | 3.0 / 18.2 / 15.7 |
| schoolgirl-described | 21.5 / 42.0 / 42.2 | 31.8 / 47.3 / 46.1 | 7.3 / 23.0 / 21.0 | 10.1 / 22.1 / 18.4 | 6.2 / 18.6 / 14.9 | 3.0 / 15.5 / 12.2 |
| clown | 87.8 / 133.3 / 133.2 | 123.8 / 162.2 / 156.2 | 6.4 / 102.8 / 86.3 | 35.5 / 106.2 / 96.7 | 27.7 / 101.1 / 91.3 | 15.9 / 97.5 / 87.2 |
| clown-alt | 87.8 / 133.3 / 133.2 | 123.8 / 162.2 / 156.2 | 6.4 / 102.8 / 86.3 | 35.5 / 106.2 / 96.7 | 27.7 / 101.1 / 91.3 | 15.9 / 97.5 / 87.2 |
| juggernaut | 5.4 / 14.3 / 14.4 | 7.0 / 37.5 / 31.4 | 6.2 / 31.6 / 27.0 | 10.0 / 30.6 / 21.3 | 6.1 / 27.7 / 17.9 | 3.1 / 25.6 / 15.1 |
| bonewalker | 18.7 / 38.7 / 38.3 | 11.1 / 26.1 / 31.8 | 6.1 / 21.2 / 20.2 | 10.0 / 21.7 / 23.1 | 6.1 / 19.3 / 19.2 | 3.0 / 16.6 / 15.0 |

What each fit did: axis scales x, y, z; the furthest stage 2 moved a vertex; the share of vertices it moved by more
than 0.1 mm; its passes; and the least local volume it left (the determinant of the warp's Jacobian over the
vertices: 1 is untouched, 0 would be a fold):

| Character | envelope | affine | mid | snug | tight |
| --- | --- | --- | --- | --- | --- |
| zombie | 1.02, 0.98, 0.90; 0.0 mm; 0%; 0; 1.00 | 1.06, 1.09, 1.08; 0.0 mm; 0%; 0; 1.00 | 1.06, 1.08, 1.06; 18.8 mm; 49%; 3; 0.51 | 1.12, 1.14, 1.12; 19.4 mm; 50%; 3; 0.55 | 1.16, 1.20, 1.17; 21.0 mm; 54%; 4; 0.45 |
| soldier | 0.99, 0.88, 0.76; 0.0 mm; 0%; 0; 1.00 | 0.94, 0.93, 0.97; 0.0 mm; 0%; 0; 1.00 | 1.03, 1.01, 0.96; 21.5 mm; 52%; 7; 0.25 | 1.08, 1.07, 1.00; 19.6 mm; 54%; 7; 0.34 | 1.14, 1.11, 1.04; 21.5 mm; 56%; 5; 0.40 |
| cultist | 0.45, 0.58, 0.53; 0.0 mm; 0%; 0; 1.00 | 0.94, 1.05, 1.02; 0.0 mm; 0%; 0; 1.00 | 1.00, 1.01, 1.15; 17.4 mm; 41%; 3; 0.41 | 1.10, 1.05, 1.21; 16.2 mm; 48%; 3; 0.46 | 1.17, 1.10, 1.27; 16.6 mm; 53%; 3; 0.41 |
| cultist-cowled | 0.45, 0.53, 0.44; 0.0 mm; 0%; 0; 1.00 | 0.95, 0.92, 1.01; 0.0 mm; 0%; 0; 1.00 | 1.01, 0.95, 1.10; 17.3 mm; 43%; 3; 0.44 | 1.09, 1.00, 1.15; 16.3 mm; 50%; 3; 0.52 | 1.11, 1.00, 1.15; 10.5 mm; 54%; 4; 0.61 |
| bride | 0.79, 0.76, 0.63; 0.0 mm; 0%; 0; 1.00 | 0.93, 0.90, 0.91; 0.0 mm; 0%; 0; 1.00 | 0.99, 0.97, 0.96; 14.5 mm; 49%; 3; 0.61 | 1.05, 1.02, 1.00; 15.1 mm; 50%; 3; 0.62 | 1.10, 1.05, 1.04; 15.8 mm; 56%; 3; 0.54 |
| female | 0.31, 0.69, 0.58; 0.0 mm; 0%; 0; 1.00 | 0.78, 0.88, 0.77; 0.0 mm; 0%; 0; 1.00 | 0.74, 0.75, 0.65; 17.3 mm; 24%; 4; 0.40 | 0.78, 0.84, 0.73; 18.5 mm; 22%; 4; 0.40 | 0.85, 0.88, 0.77; 16.4 mm; 23%; 5; 0.51 |
| schoolgirl | 0.42, 0.65, 0.67; 0.0 mm; 0%; 0; 1.00 | 1.09, 0.96, 1.05; 0.0 mm; 0%; 0; 1.00 | 1.08, 0.94, 1.02; 6.5 mm; 35%; 2; 0.79 | 1.15, 1.00, 1.08; 7.5 mm; 33%; 3; 0.80 | 1.20, 1.04, 1.12; 7.4 mm; 31%; 2; 0.80 |
| schoolgirl-alt | 0.39, 0.62, 0.62; 0.0 mm; 0%; 0; 1.00 | 1.02, 0.90, 0.94; 0.0 mm; 0%; 0; 1.00 | 1.00, 0.88, 0.89; 5.6 mm; 53%; 3; 0.64 | 1.08, 0.94, 0.94; 6.0 mm; 42%; 2; 0.78 | 1.12, 0.97, 0.98; 5.3 mm; 27%; 2; 0.81 |
| schoolgirl-described | 0.34, 0.64, 0.33; 0.0 mm; 0%; 0; 1.00 | 0.81, 0.86, 0.87; 0.0 mm; 0%; 0; 1.00 | 0.92, 0.88, 0.92; 15.2 mm; 41%; 3; 0.42 | 0.98, 0.92, 0.96; 11.5 mm; 41%; 3; 0.53 | 0.98, 0.95, 1.00; 8.7 mm; 44%; 3; 0.55 |
| clown | 1.00, 0.78, 0.77; 0.0 mm; 0%; 0; 1.00 | 1.81, 1.57, 1.81; 0.0 mm; 0%; 0; 1.00 | 1.73, 1.50, 1.73; 0.0 mm; 0%; 0; 1.00 | 1.81, 1.57, 1.81; 0.0 mm; 0%; 0; 1.00 | 1.86, 1.62, 1.86; 0.0 mm; 0%; 0; 1.00 |
| clown-alt | 1.00, 0.78, 0.77; 0.0 mm; 0%; 0; 1.00 | 1.81, 1.57, 1.81; 0.0 mm; 0%; 0; 1.00 | 1.73, 1.50, 1.73; 0.0 mm; 0%; 0; 1.00 | 1.81, 1.57, 1.81; 0.0 mm; 0%; 0; 1.00 | 1.86, 1.62, 1.86; 0.0 mm; 0%; 0; 1.00 |
| juggernaut | 1.14, 1.01, 0.88; 0.0 mm; 0%; 0; 1.00 | 1.14, 1.02, 1.14; 0.0 mm; 0%; 0; 1.00 | 1.24, 1.08, 1.10; 18.3 mm; 34%; 3; 0.63 | 1.30, 1.13, 1.16; 19.4 mm; 42%; 3; 0.62 | 1.34, 1.17, 1.20; 20.0 mm; 47%; 3; 0.63 |
| bonewalker | 0.28, 0.49, 0.43; 0.0 mm; 0%; 0; 1.00 | 0.66, 0.74, 0.76; 0.0 mm; 0%; 0; 1.00 | 0.60, 0.65, 0.69; 8.0 mm; 37%; 4; 0.42 | 0.68, 0.73, 0.78; 5.0 mm; 27%; 2; 0.70 | 0.77, 0.83, 0.88; 6.5 mm; 28%; 3; 0.63 |

Wall time of the fit in milliseconds (the best of three runs in Node on this machine, nothing else running). It runs
once for each character the first time one is seen, and is cached after that; it never runs per frame. In the running
game the zombie's measured 17 to 40 ms and the bride's 84 to 142 ms.

| Character | envelope | affine | mid | snug | tight |
| --- | --- | --- | --- | --- | --- |
| zombie | 3 | 26 | 44 | 41 | 43 |
| soldier | 1 | 34 | 57 | 53 | 51 |
| cultist | 1 | 178 | 124 | 108 | 111 |
| cultist-cowled | 1 | 134 | 99 | 86 | 76 |
| bride | 1 | 187 | 102 | 102 | 110 |
| female | 1 | 33 | 53 | 53 | 50 |
| schoolgirl | 1 | 47 | 28 | 32 | 32 |
| schoolgirl-alt | 1 | 67 | 83 | 36 | 33 |
| schoolgirl-described | 1 | 30 | 30 | 28 | 24 |
| clown | 1 | 20 | 20 | 20 | 20 |
| clown-alt | 1 | 21 | 20 | 19 | 20 |
| juggernaut | 1 | 27 | 23 | 25 | 25 |
| bonewalker | 1 | 35 | 35 | 29 | 30 |

## The eyes

The eye seats were not touched (`mesh-eyes.ts` seats them from the sculpted bone and the bone envelope, the same in
every column). Where they land against the fitted skull's orbits, for whoever seats them next.

The orbits: centre x of the right (-x) and left (+x) orbit; their height; their radius (the mean distance, in the
face's plane, from the orbit's point to where bone stands 15 mm in front of the cavity's floor); and the skull's width
at the orbits' height. Millimetres, head frame.

| Character | envelope | affine | mid | snug | tight |
| --- | --- | --- | --- | --- | --- |
| zombie | -30 / 23; 81; r 16; face 135 | -28 / 28; 47; r 17; face 141 | -27 / 27; 87; r 16; face 141 | -28 / 28; 87; r 17; face 149 | -29 / 28; 87; r 17; face 154 |
| soldier | -29 / 22; 110; r 14; face 132 | -24 / 24; 104; r 15; face 125 | -27 / 27; 116; r 16; face 138 | -28 / 28; 116; r 16; face 144 | -29 / 29; 116; r 17; face 151 |
| cultist | -13 / 10; 48; r 8; face 60 | -24 / 24; 45; r 16; face 125 | -25 / 25; 52; r 15; face 131 | -27 / 27; 52; r 16; face 141 | -28 / 28; 52; r 17; face 150 |
| cultist-cowled | -13 / 10; 53; r 8; face 60 | -25 / 25; 47; r 14; face 126 | -26 / 26; 57; r 15; face 131 | -28 / 28; 57; r 16; face 141 | -28 / 28; 57; r 15; face 147 |
| bride | -23 / 18; 141; r 12; face 105 | -24 / 24; 133; r 14; face 124 | -25 / 25; 145; r 15; face 129 | -26 / 26; 145; r 15; face 137 | -27 / 27; 145; r 15; face 144 |
| female | -9 / 7; 135; r 8; face 41 | -20 / 20; 105; r 13; face 104 | -19 / 19; 152; r 12; face 97 | -20 / 20; 152; r 13; face 102 | -22 / 22; 152; r 13; face 110 |
| schoolgirl | -12 / 9; 73; r 8; face 56 | -28 / 28; 82; r 16; face 146 | -28 / 28; 77; r 15; face 144 | -30 / 30; 77; r 16; face 153 | -31 / 31; 77; r 17; face 159 |
| schoolgirl-alt | -12 / 9; 105; r 8; face 52 | -26 / 26; 117; r 15; face 136 | -25 / 25; 109; r 14; face 133 | -28 / 27; 109; r 15; face 144 | -29 / 29; 109; r 16; face 149 |
| schoolgirl-described | -10 / 8; 120; r 8; face 45 | -21 / 21; 107; r 13; face 108 | -23 / 23; 124; r 13; face 110 | -25 / 24; 124; r 14; face 121 | -24 / 24; 124; r 14; face 128 |
| clown | -30 / 23; 156; r 14; face 134 | -47 / 47; 211; r 26; face 240 | -45 / 45; 160; r 25; face 230 | -47 / 47; 160; r 26; face 240 | -48 / 48; 160; r 27; face 248 |
| clown-alt | -30 / 23; 156; r 14; face 134 | -47 / 47; 211; r 26; face 240 | -45 / 45; 160; r 25; face 230 | -47 / 47; 160; r 26; face 240 | -48 / 48; 160; r 27; face 248 |
| juggernaut | -34 / 26; 127; r 17; face 152 | -30 / 30; 118; r 17; face 152 | -32 / 32; 133; r 18; face 165 | -34 / 34; 133; r 19; face 173 | -35 / 35; 133; r 19; face 178 |
| bonewalker | -8 / 6; 134; r 6; face 38 | -17 / 17; 150; r 11; face 88 | -16 / 16; 137; r 9; face 80 | -18 / 18; 137; r 11; face 91 | -20 / 20; 137; r 12; face 102 |

The eye seat's centre minus the orbit's point (x, y, z), right eye / left eye. The orbit's point is inside the cavity,
about 10 mm in front of its back wall, so a seat with z near zero sits in the cavity and a negative z is behind it,
inside the bone:

| Character | envelope | affine | mid | snug | tight |
| --- | --- | --- | --- | --- | --- |
| zombie | -6, 5, -14 / 13, 7, -15 | -9, 40, -22 / 9, 41, -23 | -9, -1, -24 / 10, 1, -25 | -8, -1, -28 / 8, 0, -29 | -8, -1, -34 / 8, 0, -35 |
| soldier | -3, 5, -12 / 9, 6, -13 | -7, 11, -24 / 7, 12, -25 | -5, -1, -25 / 5, 1, -26 | -4, -1, -29 / 4, 1, -30 | -3, -1, -34 / 3, 1, -34 |
| cultist | -1, 3, -16 / 4, 4, -16 | 10, 6, -24 / -10, 8, -25 | 11, -1, -22 / -11, 1, -23 | 12, -1, -28 / -13, 1, -29 | 13, -0, -36 / -13, 1, -37 |
| cultist-cowled | -1, 3, 1 / 4, 4, 0 | 10, 9, -17 / -10, 11, -18 | 12, -1, -14 / -12, 1, -15 | 13, -1, -19 / -13, 0, -20 | 14, -1, -29 / -13, 0, -30 |
| bride | -2, 4, 24 / 8, 5, 24 | -1, 12, 9 / 1, 13, 8 | -0, -1, 13 / 0, 1, 12 | 1, -1, 8 / -1, 1, 8 | 2, -0, 2 / -2, 1, 1 |
| female | -1, 16, 28 / 3, 17, 28 | 10, 46, 14 / -10, 48, 13 | 10, -0, 41 / -10, 1, 40 | 10, -1, 37 / -10, 1, 36 | 12, -1, 35 / -12, 1, 34 |
| schoolgirl | -1, 4, 37 / 4, 4, 36 | 15, -6, 24 / -15, -5, 23 | 14, -1, 16 / -14, 1, 15 | 16, -1, 13 / -16, 1, 12 | 18, -1, 11 / -18, 1, 10 |
| schoolgirl-alt | -1, 3, 0 / 4, 4, -1 | 14, -8, -15 / -14, -7, -16 | 13, -0, -17 / -12, 0, -17 | 15, -1, -18 / -15, 0, -19 | 16, -1, -20 / -16, 1, -21 |
| schoolgirl-described | no seats | no seats | no seats | no seats | no seats |
| clown | -2, 4, 42 / 9, 5, 41 | 15, -52, -7 / -15, -50, -9 | 13, -1, -3 / -13, 1, -5 | 15, -1, -7 / -15, 1, -8 | 16, -1, -9 / -16, 1, -11 |
| clown-alt | -2, 4, 42 / 9, 5, 41 | 15, -52, -7 / -15, -50, -9 | 13, -1, -3 / -13, 1, -5 | 15, -1, -7 / -15, 1, -8 | 16, -1, -9 / -16, 1, -11 |
| juggernaut | -3, 6, 41 / 11, 7, 40 | -7, 15, 26 / 7, 16, 25 | -4, -1, 29 / 4, 1, 28 | -3, -1, 25 / 3, 1, 24 | -2, -1, 22 / 2, 1, 21 |
| bonewalker | no seats | no seats | no seats | no seats | no seats |

On the zombie the seats are 19 mm in radius against an orbit of 16 to 17 mm, and stand 36 mm either side of the middle
against the orbits' 27 to 29 mm. With `mid`, `snug` and `tight` the seats are level with the orbits (within 1.4 mm in
height) but 8 to 10 mm wide of them and 24 to 35 mm behind them, so they are hidden inside the bone; with `affine` the
orbits are 40 mm below the seats.

The zombie's painted eyes (the glow on the face, `head-eye.ts`) are at x = -44.7 and +40.4 mm, heights 84.0 and
95.4 mm. Distance in the face's plane from each painted eye to the orbit under it:

| | Orbit centres x, right / left | Orbit heights | Painted eye to orbit, right / left |
| --- | --- | --- | --- |
| `envelope` (today) | -29.9 / 22.9 | 81.4 / 80.0 | 15.0 / 23.3 |
| `affine` | -27.5 / 27.5 | 47.3 / 45.8 | 40.5 / 51.3 |
| `mid` | -27.0 / 26.7 | 87.6 / 86.1 | 18.1 / 16.6 |
| `snug` | -28.3 / 28.1 | 87.8 / 86.3 | 16.8 / 15.3 |
| `tight` | -28.6 / 28.4 | 88.2 / 86.6 | 16.6 / 14.9 |

No fit closes that gap. The glow is 85 mm apart and the orbits 55 to 57 mm; a skull wide enough to match would need
about 1.5 times the width, which the head has no room for and the 1.15 limit forbids. What the fits do: today's skull
is off its own middle (its orbits are at -30 and +23), and the flesh fits centre the orbits on the head; the warped
fits put them at the painted eyes' mean height.

## What was found

- **The share of the flesh the sculpt has cannot be reached without distorting the face.** The zombie's head is an
  egg, widest at mid height; the anatomical skull is widest at the top of the cranium and narrow at the cheeks. Its
  size is bounded twice at once: the left parietal is at the cranium's budget (it lacks 16.5 of 16.6 mm under `snug`)
  and the left cheekbone near the face's (4.6 of 5.0 mm). `tight` reaches 0.87 of the flesh's width against the
  sculpt's 0.92.
- **Stage 2 does move the face, by being next to the forehead.** The budgets bound what a vertex lacks, and a vertex
  beside a needier one is carried with it. On the zombie under `snug` the forehead (the frontal bone, which holds the
  orbits' upper rims) moves up to 16 mm and the parietals 19 mm; the cheekbones move up to 8 mm, the upper jaws and
  the nose 6 mm, the teeth 2 mm and the lower jaw under 1 mm. Under `tight`: forehead 21 mm, cheekbones 10 mm, upper
  jaws and nose 9 mm, teeth 4 mm, lower jaw 1 mm. The first sheet's top two rows show the result: the vault narrows
  to the crown.
- **Width at the face was preferred where there was a choice** (stage 1 grows the width first, past its share, up to
  the limit): the skull's width at the orbits goes from 135 mm today to 149 mm (`snug`) and 154 mm (`tight`) on the
  zombie, in a head 180 mm wide there.
- **`affine` sits low.** With no vertex moved, the largest skull is one that slides down out of the narrow crown: its
  orbits are 40 mm under the zombie's eye line and its jaw is at the chin. It is larger than today's but its face is
  in the wrong place.
- **With the orbits held on the eye line, `mid` is hardly larger than today's skull on the zombie** (143 x 219 x 179
  against 141 x 204 x 156): it is taller and deeper, not wider, because 10 mm of cover at the upper sides costs what
  the scale gains. `snug` and `tight` are the ones that answer the complaint.
- **The female looks worse under the warped fits than under `affine`.** Her eye line comes from a bone envelope that
  reaches up into her hair bun, so `mid`, `snug` and `tight` hold the skull too high: the cranium stands up into the
  bun and the forehead is dented where the bun meets the face (see the second sheet). `affine`, placed freely, sits in
  her face. The eye line needs another source than the bone envelope on heads like hers before a warped fit is used
  there.
- **The soldier's crown comes to a point under `snug` and `tight`** (second sheet). The flesh there is his helmet,
  which narrows to a cap; the cranium is pulled into its shape. Under `snug` two of the asset's large triangles
  (edges of 19 mm) on the crown lose more than half their area, and a corner normal ends 84 degrees off its
  triangle's facing: the worst measured anywhere. It is not a fold (no triangle turns over on any character under any
  fit), but it may read as a crease.
- **The bride's flesh is not drawn when she is spawned with `?spawn=bride`**, with or without the crowd path, under
  the sculpt and under every fit: only her bones appear. Her row of the second sheet is therefore bone alone. This
  was not looked into.
- **The clown's head is a ball 555 mm wide.** Sized to the flesh the skull is 250 to 259 mm wide (1.8 times the
  asset), held there by the height of the head and the 1.15 limit; it still fills under half the width.
- **Stage 2 compresses what lies under a pulled region.** The least local volume left is 0.25 (the soldier, `mid`)
  and typically 0.4 to 0.6: inside the skull, in the falloff under the cranium's pulled plates. A plate's thickness
  right under a pulled surface was not measured on the asset; in the module's own test a shell 5 mm thick keeps
  between 0.8 and 1.2 of it.
- **The asset is not symmetric.** The point midway between its orbits is 3.4 mm to one side of the middle of its
  box, which is why today's skull has its orbits at -30 and +23 mm. The flesh fits put that point on the head's
  middle plane.
- **The asset is coarse where the fits bend it.** It has 627 triangles under 1 mm high among its 9947, and vault
  triangles with edges up to 24 mm. The tests judge folds on the other 9320.
- **Hair and cloth are not flesh to the fit**, so a skull never grows into a hood, a veil or a ponytail. A helmet
  that is an ordinary prim (the soldier's) is flesh to it.

## Checks

The photos, the gates and the full test tree were run on commit `441dcf81`; the last source commit, `a459ecd2`,
differs from it by two comments in `skull-fit.ts`, and the typecheck and the targeted tests were run again on it.

- `npx tsc --noEmit`: one error, the known `pack-golden.test.ts` `node:crypto` one.
- `npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike src/lab/sdf-zombie/skull-fracture.test.ts src/lab/sdf-zombie/head-split`:
  20 files, 564 tests, all passed. New among them: `skull-fit.test.ts` (14: the field against its own Jacobian by
  finite differences, the normal's carry, the two stages on a made-up head, the shrink that follows passes that do
  not settle), `head-flesh.test.ts` (17) and `anatomical-skull-fit.test.ts` (176, about 30 s).
- `npx vitest run src/lab/sdf-zombie scripts/lib --exclude '**/cut-wound.test.ts'`: 534 files, 7857 tests passed, 1
  skipped (7650 passed before; the 207 more are the three new files).
- What `anatomical-skull-fit.test.ts` holds, for each of the four fits on each of the thirteen humanoids: every
  distinct vertex is under the whole body's flesh at rest by the fit's margin (a micron of slack for float32); the
  axis scales are within 1.15 of each other; the passes settle without the fallback shrink; no triangle turns over and
  none loses more than 0.8 of its area (the 627 slivers under 1 mm high are not judged); no corner normal that stood
  within 45 degrees of its triangle's facing ends on its other side; the way from the front to a point inside each
  orbit and inside the nasal opening meets no bone; vertices that share a place in the asset share one in the fit, and
  those that shared a normal share one still; none of the 194 pairs of vertices where two plates meet (up to 0.5 mm
  apart in the asset; none coincide exactly) opens by 0.1 mm; each plate's box, pivot, debris geometry and shot
  triangles, the merged skull and the whole skull's box are the fitted result's own.
- The default: for each of the thirteen, the merged skull's position, normal and uv bytes and every plate's pivot and
  box hash to the value taken from the kit of commit `f127e868`, under the same cache key, with the fit named or not;
  the default kit never reads a head's flesh; `?skull=sculpt` makes no kit whatever `skullfit` says.
- Gates on the default fit, each with this session's servers: `scripts/head-split-gate.mjs` 100 checks, 0 failed;
  `scripts/axe-gate.mjs` 27 checks, 0 failed; `scripts/head-burst-gate.mjs` 26 checks, 0 failed (the same 26 checks
  pass on a copy of `f127e868`).
- In the running game: `__sdfGame.skeletonDiagnostics().skullFit` names the fit of the boot, and the fitted skull's
  box read back through `__sdfGame.skullFit(id)` and `skullPlates(id)` is the one measured offline (the zombie under
  `snug`: 150.6 x 231.2 x 189.4 mm in both). No console error or exception in any boot behind the sheets.
  One boot (`?skullfit=mid&spawn=soldier`) stopped answering during a 60 s step once and was taken again without
  trouble; the cause was not found.

## Not verified

- The fits were checked at rest against the flesh at rest. That the skull stays covered when the head turns rests on
  the flesh being the head's own rigid flesh; it was not measured in a posed head.
- Only the default fit was run through the head split, axe and head burst gates. The fits were seen split, chopped
  and burst in the look sheets' photos (the zombie only), and their plates break and scatter in a unit test; no gate
  measured them.
- How thin cover reads in play: with `tight`, 3 mm of flesh lies over broad parts of the cranium, so shallow wounds
  will show bone over a larger area than today. Not played.
- Frame cost was not measured. The triangle count is unchanged; the skull covers more pixels.
- Of the thirteen, the zombie, soldier, cultist, female, bride and clown were photographed in the game. The cowled
  cultist, the three schoolgirls, the second clown, the juggernaut and the bonewalker are in the tables and the tests
  only.
- The Night Train level was not booted with a fit other than the default.

## For the owner to decide

1. Which fit the zombie ships with: today's, `snug` or `tight` (or `mid` or `affine`). `snug` keeps 6 mm of flesh;
   `tight` is the nearest to the sculpt's size and keeps the sculpt's own 3 mm.
2. Whether one fit serves every character, or each character names its own. On the second sheet the female reads
   best under `affine` (or needs a better eye line), the soldier under `mid`, the cultist under any of the four, and
   nothing here gives the clown a skull that fills his head.
3. If a fit ships as the default: it costs 20 to 190 ms the first time a character is seen. It should then run at
   load, or be baked per character, rather than on first sight.
4. The eye seats and the painted eyes are a separate change; the numbers above are for it.
