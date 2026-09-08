# Gargoyle — a stone-beast SDF enemy (2026-09-07)

Authored `src/lab/sdf-zombie/characters/gargoyle.blob` from the roth_gargoyle
reference mesh (`docs/dev-notes/refs/gargoyle-mesh/gargoyle.glb`, a static
unrigged render of the Realm of the Haunting gargoyle beast; committed with
`git add -f` — `docs/dev-notes/refs/**/*.glb` is gitignored). The owner framed
the mesh as INSPIRATION, not a fit target, so `blob:measure` numbers are a
baseline (whole-figure IoU 0.416, aspect 0.837 vs 0.835, POSE MISMATCH
flagged — the reference crouches) and were not optimised.

## What shipped

- 2.05 m hunched digitigrade beast: low hips (0.57 hip line, 0.28 of height),
  spine→skull pitch chain ~74° of forward lean, long knuckle-dragger arms
  (hand tails at y ~0.31, in front of the hips), bird-fold legs (hock forward;
  `stance digitigrade` passes checkStance at kneeOffset −16 mm), folded wing
  fans (unmapped `wing1/2` bones off the spine; olive-green membrane on the
  torso cluster so nothing severs a wing), and a two-segment tail curling to
  the ground.
- Grey-blue stone palette (linear base 0.165/0.175/0.225, mottle 0.40 at
  scale 2.2, dry: wetness 0.15, translucency 0.05). Wounds stay house-red.
- Registered in `character-registry.ts` with `motionProfileFor('gargoyle')`
  (zombie shamble default — it has not earned a bespoke profile).
- `gargoyle-blob.test.ts` pins the structural intent (stance fold, ground
  contact, hand hang, head jut, wing/tail bones).

## The head: three passes, owner-driven

1. Face-block oval (the house default) — owner: heads should not always be
   "an orb or oval variation".
2. All-`box` chiseled skull — read as a widescreen monitor/blockhead. Owner:
   "not a blockhead — multiple blended orbs plus shaped prims" (goblin
   idiom). Boxes were removed the same day.
3. Shipped: cranium dome + cheek/jaw mass (painted one step darker so the
   seam reads as the mouth's shadow) + muzzle orb + pointy snout bar +
   paired brow ridges angled outer-UP (first pass drooped and read sad) +
   tapered ember-eye wedges slanted the same angry way (`glow=0.9` prims,
   colour IS the emission) + big bat-ear blades + forward-curling horns.

## Sheet traps (paid for here, written down for the next character)

- An ALL-WHITE identity sheet renders the face GLOWING RED: raw luma 1.0
  clears `eyeGlowCut`, so the whole head enters the eye-glow path. The
  zombie-flat's neutral MID-GREY is the proven identity that stays under the
  cut. (An all-grey flat was used mid-session and discarded with the bake
  plan.)
- Near-white PAINTED TEETH in a decal trip the same mask — the first grin
  rendered as glowing red fangs. Gate the sheet's glow off hard:
  `eyeGlowCut 0.99` + `eyeGlowAmp 0` (the gargoyle's eyes are prims; the
  sheet needs no glow).
- The decal row is positioned against the FATTEST head prim — by VOLUME that
  is the cranium, not the visibly-widest cheek; the first grin drew on the
  forehead. Upper lip sits at image row ~282/512 in `gargoyle-face.png`.
- The grin itself is hand-authored (Python/PIL, 512², alpha 0 elsewhere):
  dark cavity + near-white teeth MULTIPLIED over the stone — multiply can
  only darken, so teeth must be near-255 to stay stone-bright.
- A mesh FACE BAKE was ruled out: the reference's UVs repeat (`uv % 1`
  wraps; a texel-probe returned eye colours scattered over the whole model),
  so `blob:face-bake` would sample garbage.

## Suite findings shipping a new character surfaces

- `blob-checks.test.ts` strandedOf sweep caught two real floats: the fang
  prims (34 mm proud of the cheek — now removed entirely, the painted grin
  carries corner fangs; a geometric pair read as a walrus goatee, owner) and
  the wing spur claw (104 mm past the fan's end — re-seated at the strut's
  own end on wing1).
- `pack.test.ts` glow inventory pins glowing-prim counts cast-wide; updated
  for the gargoyle's two ember eyes (minotaur precedent, documented in the
  test).
- The authoring-aid probes (`gargoyle-probe.ts` etc.) were transient and are
  not committed; the numbers they produced live in the .blob's `# fit:`
  comments.

## Branch note

This work lives on `gargoyle-character`, branched off `main`. The
`iso-experiment` branch's commit 2ad35032 accidentally swept in an earlier
hunk of the gargoyle registry entry (while `gargoyle.blob` itself stayed
untracked there) — a fresh checkout of iso-experiment will fail to resolve
`./characters/gargoyle.blob?raw` until that hunk is reverted or the blob is
added there too. Owner's call; not fixed here.
