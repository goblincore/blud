# Cyberbride — character design (2026-09-09)

A cyborg Terminator figure: a **chrome mesh endoskeleton** worn under a
**translucent SDF corpse-flesh female body**, so the machine ghosts through
the skin. Authored with Blobforge (`.blob` flesh + WAM kit mesh) plus a new
forward-path feature: per-character translucent flesh.

## Who she is

`cyberbride` — the machine that grew itself a bride. The cast is a Weird West
bestiary; she is the one body that is TWO bodies: a polished endoskeleton
(the kit) and the rotting woman grown over it (the .blob), skin thin enough
to read the chrome through. The flesh follows the **Venus de Willendorf**:
wide heavy hips, soft belly, oversized sagging breasts — fertility-figure
proportions on a corpse, grotesque rather than idealised. The face keeps the
female oval but the mouth is a monster's: a grinning row of chunky fangs
(the cyclops' teeth) under a small nose, imp-pointed ears (the goblin's
trick), grey-white corpse hair hung in strands (schoolgirl-described's
strand system, rippling with the same wind the cloth sways in).

Silhouette beats, in the house three-beat budget:

1. **THE HOURGLASS GHOST** — Willendorf hips wider than the bust, both wider
   than the waist, and the chrome ribcage/spine ghosting through the torso.
   From behind she is hips and spine; from the front, breasts and pelvis.
2. **THE GRIN** — the fang row + red glowing eye prims; the one saturated
   accent on a grey body, readable at arena distance.
3. **THE CHROME** — skull dome, jaw, rib hoops, sternum, spine, pelvis
   wings, limb bones with ball joints: a complete endoskeleton, slightly
   proud of nothing, seen ONLY through the flesh (plus through wounds, as
   bone always is).

## Flesh — `characters/cyberbride.blob`

- Skeleton: the widow/schoolgirl female frame (root 0.86, spine1/chest 0.15,
  spine2 0.06, neck 0.08, skull 0.22; clavicle side 0.028; arms tilt 9/6/8;
  thigh side 0.062). Height 1.72.
- Torso: wide pelvis blob (half-width ~0.13), soft belly bar, chest bar
  WIDER at the top than the belly (the soldier pot-belly lesson, run
  forward), two breast mounds `both` on chest with forward+down droop
  (tip=), r≈0.058 at ±0.048 — bust narrower than the hips (Willendorf
  taper, and it keeps her reading female-not-just-round).
- Head: `face` block female oval (schoolgirl-derived numbers, headRadius
  0.072); ZOMBIE_FLAT sheet (no reference mesh exists, and the flat is a
  feature MASK, not a face — the right base for a corpse); two red `glow`
  eye prims (GLOW_PRIMS pins 2); cyclops-style fang row (r2 points, pale
  bone paint, gloss) + a mouth groove; goblin-style pointed ears (`r2`
  points, `chamfer`, `both`).
- Hair: schoolgirl-described's three-bundle pattern (crown mass stays a
  MASS; fringe/side curtains/nape are `strand=` bundles), pale grey-white.
- Skin: corpse palette (desaturated pink-grey base, bruise-green mottle,
  red deep/wound colour, moderate wetness) — `# fit:` comments per the
  house rule; every number is eyeballed and SAYS so.
- Clothing: one tattered burial skirt shell (warp folds, the
  schoolgirl-described skirt pattern, hem mid-thigh, funeral grey). Torso
  stays bare — the breasts and the ghost are the read.
- `stance humanoid`; interior `bones` block mirrors the soldier's (cranium,
  rib hoops, sternum, spine) so wounds/melt reveal anatomy in the usual way.

## Endoskeleton — `characters/cyberbride-kit.wam`

WAM kit (the owner's mesh-for-hard-surfaces rule; `cyberdemon` is the
precedent). Materials: `chrome` (bright steel; new LOOK entry in
kit-overlay.ts) and `darkiron` (joints, cable). Parts, all chunky 8-sided
lofts along the .blob skeleton (height-fraction units, pitch NEGATED on
`down` bones — the goblin-kangaroo-knee trap):

- Skull: dome-capped loft on `skull` + upper/lower jaw lofts.
- Ribcage: three rib pairs, each rib two loft arcs (front + back), plus a
  sternum slab — the soldier's SDF `bones` rib layout transcribed to mesh.
- Spine: small vertebra boxes up `spine1`/`chest`/`spine2`.
- Pelvis: iliac wing plates + pubis bar.
- Arms/legs: humerus/radius, femur/tibia tapered lofts; ball joints at
  shoulder/elbow/hip/knee; mitt plates at the hands, foot frames.
- BUILD: `scripts/build-wam-kit.sh cyberbride` → committed
  `public/assets/lab/cyberbride-kit.gltf`; registered `kit:` in
  character-registry.ts.

## Translucent flesh — the new forward-path feature

Nothing in the SDF path blends today: the composite quad hard-codes alpha
1.0 (`sdf-layer.ts` quadMat), coverage is a discard sentinel, and kit-overlay
documents why a material flag cannot do it. The endoskeleton renders in
pass 1 (ordinary kit on layer 0); the flesh composite must therefore BLEND
over it, per character, without breaking coverage sentinels, the goo depth
contract, or any existing character.

Design: a **ghost body group** with its own march target and composite draw.

- `character-registry.ts`: `fleshAlpha?: number` on `CharacterEntry` (pure
  data; absent = 1.0 = exactly today).
- `sdf-layer.ts`:
  - `setGhostBodies(list, alpha)` — a second body list marched into a new
    float target `ghostTarget` (excluded from the opaque pass by visibility
    toggles), composited by a second quad whose material is
    `transparent: true` (src-alpha) with `depthNode`/`depthWrite` unchanged.
    Alpha comes from a uniform on that quad; pixels without marched flesh
    still discard (sentinel untouched), so blending only ever happens where
    flesh exists. Where the metal is IN FRONT of the flesh the composite's
    depth test already fails the flesh fragment — kits keep their existing
    depth-correct behaviour; only behind-flesh pixels blend.
  - COMPOSITE_WGSL gains a per-instance texture binding; the ghost instance
    samples `ghostTarget`/`ghostPrev` (field styles) and shares holdMode/
    reprojection uniforms, so half-rate and the 'bodies' interleave keep
    working; holds composite the retained ghost frame.
  - 'sdf'/'frame' field styles fall back to marching ghosts opaquely
    (documented limitation).
  - Default (no ghost list) renders bit-identically: no second pass runs,
    and `transparent` on an alpha-1.0 src-over blend is a mathematical
    no-op for the opaque quad.
- Call sites: the lab (hero view) and the game (split `visibleActors` by
  `entry.fleshAlpha`) pass the ghost list through.

The deferred (opt-in) renderer is NOT wired — translucent SDF content needs
the routed-forward seam there; documented as follow-up.

## Registration + tests

- character-registry.ts entry (kit, ZOMBIE_FLAT face, fleshAlpha, zombie
  motion profile — deliberate, the cyberdemon precedent).
- pack.test.ts GLOW_PRIMS row (`cyberbride.blob: 2` — the eye pair).
- `characters/cyberbride-blob.test.ts`: structural pins on the
  gargoyle-blob.test.ts template (validateBody clean, stance, female-form
  anchors: hips widest then bust then waist; strand/ear/fang/glow counts;
  daylightOf arms-vs-torso) — no mesh-derived thresholds (no reference
  mesh exists; description-authored like the soldier/widow).

## Verification

`blob:shot` frames every ~5 edits and READ (LAB_TMP=.lab-tmp), render-check
on any hole, vitest `src/lab/sdf-zombie/`, `tsc --noEmit`. The owner judges
the final frames; the ghost feature is judged by A/B: same frame with
fleshAlpha 1 vs authored value.
