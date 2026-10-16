# Task 3b: a viable toothy grin (2026-10-14)

Plan: `docs/superpowers/plans/2026-10-13-goblin-expressions.md`, `### Task 3b`. Goal: at a gape of about 0.15 a dark opening
AT THE LIP LINE with the upper teeth and fangs clearly visible; closed and tooth-free at gape 0; the painted mouth on the real
opening; natural flesh lips about today's size (no lipstick, no big-lips redesign).

Frames (all `BLOB_DIST=0.3 BLOB_TARGET_Y=1.14 BLOB_PITCH=0.05`, ports 5281/9281; `frame-00` front, `frame-01` 45 degrees,
shot with 8 frames and the first two kept):

| dir | what |
|---|---|
| `gape-0`, `gape-0.15`, `gape-0.3`, `gape-0.5` | `BLOB_GAPE=<g>` |
| `expr-grin`, `expr-shout`, `expr-scowl` | `BLOB_EXPR=<name>` (fully formed; grin = gape 0.168, shout 0.6, scowl 0.108) |
| `before-after-0.png`, `before-after-0.15.png` | mouth crops, Task 4 spike (left) vs now (right) |
| `old-hinge/` | the shout with the new geometry but the SHARED hinge (the reason for the per-body hinge) |

## Step 1: where things were (before)

Measured on the committed head (CPU field, `sdBody`, front rays along -z):

- Lip line (the groove's crease): y 1.128-1.131. Upper lip front z 0.135-0.139 at y 1.138-1.148. Lower lip prim: a
  front-to-back pout capsule whose front sloped DOWN to (y 1.10, z 0.123), i.e. the chin's shelf rather than a lip.
- Nose tip: z 0.168 at y 1.150-1.155, 2.9 cm ahead of the lips' front.
- The opening: at gape 0.15 the skull-side mass (the face block's jaw ellipsoid, bottom y 1.100) still filled y 1.10-1.14 at
  z 0.10-0.115, so the jaw opened BELOW it, y 1.10-1.115, and not one upper tooth was visible from the front (the front-ray
  map at 0.15 showed skull skin across the whole lip line).
- Two further blockers found on the way:
  - The **groove** (`groove head on skull ... offset=(0,-0.014,0.060)`) cuts 4 mm of field from EVERY head prim in its band,
    teeth included: once the jaw opened, the field on a tooth's axis at y 1.13 read +1.1 mm (the tooth was cut away exactly
    where it should show).
  - **`BLOB_GAPE` did nothing** since Task 9: `stepExpression` overwrote the hand-set gape with the clip's (0) every frame.
    Fixed in its own commit (`setJawGape` now holds until an expression is held or played).

## What changed

**Seam at the lip line (`goblin.blob`).** Everything above y ~1.133 is the skull's, everything below the jaw's:

- Face block jaw ellipsoid shortened again: `jawHeight 0.537 -> 0.467`, `jawDrop 0.0743 -> 0.0589` (centre y 1.165,
  semi-height 0.043): its underside clears y 1.132 everywhere in front of z 0.10.
- New **upper ridge** (skull): a flat bent bar along the arch, x +-0.045, y 1.133-1.145, front z 0.117. It restores the face
  just above the seam that the shorter ellipsoid gave up, and its flat underside is the mouth's top edge.
- **Lower lip** (jaw) rebuilt as a bent bar along the arch (top y 1.1335, front z 0.122, flesh, about the old size).
- **Chin** (jaw) lowered at the top (1.137 -> 1.128 on the axis) so it stays under the floor when the jaw tips open.
- New **cheek fill** pair (skull, x 0.046, y 1.122): the seam wraps round the face and left a 4 mm waist at y 1.12.
- New **mouth corners** pair (jaw, x 0.037, y 1.124): the lower chin left the corners open at rest.
- New dark **floor** (jaw, `color=2a0608`): a flat disc behind the lower lip that the lower teeth root in.
- The **throat bar** (skull, dark) moved up and forward to the new seam, x +-0.041, y 1.090-1.138, z 0.060-0.084; gloss
  0.85 -> 0.05 (the gloss lit its ends as grey edges framing the mouth).
- **Groove removed** (see above). The mouth line is the real seam plus the painted sheet mouth.
- **Teeth re-placed**, still 11: upper roots y 1.137-1.138 inside the ridge, tips 1.119-1.125, fangs 1.111-1.113,
  z 0.095-0.107, a little thicker (r 0.005-0.0068). Lower: roots in the floor at y 1.121, tips 1.138-1.141, z 0.085-0.095
  (behind the lower lip; further forward they showed as brown studs on the lip's top once the jaw tipped open).
- **Sheet mouth** on the real seam: `mouthRise 0.80 -> 0.805`, `mouthCurve -0.50 -> -0.15`, `mouthWidth 0.54 -> 0.40`,
  `mouthOpen 0.042 -> 0.030`. Through the cranium projection (headShape; faceProj 0.58/0.56) that is centre y 1.1335 (the
  seam), corners 4 mm higher, half-width 4 cm (the opening's), +-7 mm thick. Paint never touches the teeth or the inside (a
  coloured prim replaces the sheet).

**Per-body jaw hinge (own commit).** `hinge=0.06` on the goblin's jaw bone puts the hinge at y 1.1326 (the lip line), 2 cm
behind the skull axis. With the shared hinge (0.30, the bride's upper lip, 5.6 cm above the goblin's lips) the jaw swung back
into the throat: at 0.5 rad the lower lip's middle dropped 4.7 cm and moved back 4.5; now it drops 5.1 and moves back 1.7. At
the shout (0.6) the old hinge made the lower jaw vanish into the neck (`old-hinge/shout-frame-01.png`). The grin gape (0.15)
was already fine with the old hinge (the lip front drops ~2 cm either way); the hinge was the blocker for 0.3 and up.

**No per-prim morph** (the pre-approved escalation was not built): with the seam at the lip line, nothing on the face covers
the teeth at 0.15 (every upper tooth paints part of the front view at 0.15; pinned), so the frames did not call for it.

## Numbers (CPU, front-ray paint sweep, 1-2 mm grid)

- Rest: no tooth or interior prim paints the rest skin; every tooth and interior end is 2-11 mm inside tooth-free flesh.
- Gape 0.15: all 7 upper teeth show (9-32 hits each), the lower teeth just (2-13), the throat between them (60).
  Front opening at x=0 from y 1.117 to 1.133, the full width x +-0.04.
- Gape 0.3: every tooth, the throat (351) and the floor (22) show.
- Head profile vs the approved head: every pin within 2.5 mm except `front y1.13`, re-pinned 0.116 -> 0.121 (the groove that
  cut a 5 mm channel there is gone). Front silhouette half-width within 2 mm of the approved head at every height
  y 1.06-1.17 (2 mm narrower at y 1.11-1.12, 2 mm wider at y 1.09-1.10).
- Nose still leads: tip z 0.168 vs upper lip 0.139 and lower lip 0.122 (unchanged upper lip; the 45-degree frames show the hook
  as the leading edge at every gape).
- Head prims: +6 (ridge, cheek pair, corner pair, floor), -1 (groove). Frame cost not measured.

## What I see

- `gape-0`: closed, no tooth. A straight mouth line at the seam under the upper lip, a fuller lower lip below it. The lower face
  reads a little more like a separate rounded "puck" than the approved head (there is a crease under the lower lip), though the
  silhouette numbers hold.
- `gape-0.15` / `expr-grin`: **the grin reads**: a full row of upper teeth with the two fangs hanging right under the upper lip,
  dark between them, the lower lip just below. At 45 degrees the teeth show under the overhanging upper lip and the nose leads.
  Compare `before-after-0.15.png`: before, the teeth were a low band in the chin; now they are at the mouth.
- `gape-0.3`: a dark mouth, upper row hanging, the lower row's tips standing on the floor.
- `gape-0.5` / `expr-shout`: a wide dark mouth with the upper row on top and the four lower teeth along the floor's front edge;
  at 45 degrees the jaw drops down instead of swinging into the neck.
- `expr-scowl` (gape 0.108): a thin dark slit with tooth tips along it: reads as bared, clenched teeth.

## What still does not work (honest list)

- **The mouth is a box.** The opening has a flat top (the ridge), a flat floor and near-vertical side walls at the corners; at
  0.3 and wider it reads as a nutcracker/puppet mouth rather than a lipped one. The corners do not curl up in the grin; the only
  "smile" is the sheet's paint. A real smile shape (corners pulled up and out, cheeks bunching) is exactly what the pre-approved
  per-prim morph would do; it was not built because the teeth read without it. This is the owner's call.
- The lower teeth are small and only just show at the grin gape; from 0.5 they read as four studs along the floor's front edge.
- At big gapes, a thin horizontal line runs back along the cheek at the seam height in the 45-degree view (the skull/jaw seam
  opening at the side).
- The rest face's lower half is puffier than the approved head (lower lip + chin), within the profile tolerances.
- The grin expression's `smileCurve 0.9` still bows the painted mouth into a 2 cm U at full smile; it does not read as a second
  mouth in `expr-grin` (the teeth dominate), so I did not retune `goblin-expressions.ts` (only its comment about the neutral).
- `maxGape 0.6` with the new hinge makes the shout very wide (the jaw drops about 6 cm); worth a look.
