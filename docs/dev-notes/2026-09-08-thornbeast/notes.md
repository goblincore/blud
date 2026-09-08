# Thornbeast — a bramble-hulk SDF enemy (2026-09-08)

Authored `src/lab/sdf-zombie/characters/thornbeast.blob` from a 2D concept
plate (`docs/dev-notes/refs/thornbeast-reference.png`, a Meshy AI generation
the owner supplied). **The plate is inspiration-only by owner instruction** —
no mesh was provided precisely so nobody spends a session measuring. Every
number is eyeballed off the plate and tuned against turntable frames; the
`# plate:` comments in the .blob say what each is matching. `blob:measure`
was never run and there is no IoU.

## What shipped

- 2.1 m gangly hulk, `stance humanoid` (knee +42 mm forward of the
  hip->ankle chord — a deliberate contrast with the gargoyle's bird fold).
  Hip line 1.10 (0.52 of height), spine chain hunched ~30 deg, short
  forward-thrust neck so the head sinks between the shoulders.
- The silhouette: a massive shoulder YOKE (0.61 m wide — the widest prim on
  the body), absurd arm reach (wrist y ~0.87, fingertips at knee level),
  thorn rows raking back along the forearms, a YOKE BURST of two thick pale
  spike pairs rising up-out beside the head, a back fan of quills, big
  two-claw talon feet, three claw lines per hand. No tail, no wings, no big
  ears — the gargoyle owns all three; this one is thorns.
- 61 prims (gargoyle-scale; the perf note about schoolgirl/cyclops does not
  apply). Registered in character-registry with the zombie shamble profile
  (`motionProfileFor('thornbeast')`), same as the gargoyle until it earns
  its own. Face falls back to the shared zombie flat (no sheet block).
- Palette: rust bark (linear 0.23/0.10/0.035) with olive-green mottle
  (amp 0.55, scale 3.0 — a HUE step, per the reference.md palette rule),
  pale-bone thorns `color=c9b896`, dark claws, two beady ember eyes
  `color=ff6a1a glow=0.8`. pack.test's glow inventory was extended: three
  glow authors now (minotaur, gargoyle, thornbeast), two prims each.
- `thornbeast-blob.test.ts` pins stance fold, ground contact, arm reach and
  clearance, the sunk head, the 17-prim bone-thorn inventory, and no
  tail/wings. Full sdf-zombie suite 3383/3383 green; blob:render-check 0
  holes.

## The head: what the owner should look at first

The head is authored prims (goblin/gargoyle idiom; face block shrunk to a
nub — second character to suppress the emitted skull, still no named
`face skull off` word). Owner pass 1 (2026-09-08, after v1) called the eyes
and brows FLOATING and the face unmemorable; pass 2 landed the current
read: paired pale brow RIDGES angled outer-UP (the gargoyle's angry slant),
two ember eyes seated in DARK-PAINTED socket rings (`color=241408` — the
bare ember washed out against lit rust; the ring is the contrast), four
small pale teeth hanging into the dark maw slot (inside the mouth line —
the gargoyle's walrus-goatee failure is about fangs past the jaw, not teeth
in a dark slot), crown thorns reseated into the slab's top.

THE SEATING RULE that fixed the float: every face feature must be
half-embedded in its host mass — compute q = sum(((point−centre)/semi)²)
against the host ellipsoid and land the feature CENTRE at q ≈ 0.6-1.1, so
only a radius pokes out. v1's brow hung 88 mm clear of the cranium (q 2+)
and the eyes 18 % clear of any mass; the probes in this session's
`/tmp/thorn-face.ts` print per-prim q against the head masses. `strandedOf`
did NOT catch these: the eyes/brow touched the MUZZLE's flesh within its
15 mm tolerance while reading as detached from the head's silhouette —
seating is a judgement above the automated checks, hence the close-up loop.

Also: neck+skull pitch 22+10, not 30+22 — the pitches ACCUMULATE (58 deg at
the skull at the steeper setting), tipping the face plane under the slab's
brim into its own shadow. The face fine-tuning is still owner-work in the
live lab; v2 is a base to judge.

## The maw decal saga — written down so nobody re-fights it

The first plan was the gargoyle's proven third road: a hand-authored
512² maw decal at MULTIPLY (`blob:face-bake` needs a mesh; there is none).
Four close-up rounds could not make it read, and the post-mortem is
instructive — the pipeline was never the bug:

1. **The turntable orbits the FIELD CENTRE, not the head** (`-0.20, 1.01,
   0.37` for this figure), so `BLOB_TARGET_Y` close-ups are oblique and
   slightly off-centre; several "the face is missing" reads were framing
   lies. Use `__sdfLab.setCam` / account for the centre before concluding
   anything from a close-up.
2. **The decal's |hs| facing fade is the silent killer on protruding
   muzzles.** The projection normalises by the FATTEST UNPAINTED head prim
   (`lab-main.ts headShape`, radius*maxScale, painted prims skipped). Any
   face feature far from that prim's centre lands at large |hs|; the fade
   starts at 1.95 (decal reach 1.5 x 1.30) and my muzzle front sat at 2.1
   against the cranium's frame — the decal rendered at ~3% strength, i.e.
   invisible, with position math that was actually correct.
3. **Y-coordinates: `uv = hs.xy * projScale.xy + projCentre.xy`, v flipped
   at upload (v = 1 - imageRow/512), v increasing UP the face.** Solved
   twice on paper; each solve was invalidated by a head-geometry change
   (which prim wins the frame) underneath it.
4. Chrome + vite are REUSED between blob:shot runs, so swapping the PNG
   under the same filename serves stale pixels — cache-bust by renaming
   the file if you must A/B a decal image.
5. Resolution: the maw is a dark-painted thin PRIM (`tall 0.28` crescent
   on the muzzle's lower front) — no projection to miss, reads as the
   open-mouth shadow at roster distance. The decal experiment files were
   removed; if anyone revives the decal for a protruding-muzzle head,
   start from point 2 and pick the frame prim DELIBERATELY (unpaint and
   resize the prim nearest the art, like the cheek here: wide 1.9 so it
   beats the cranium's 0.213).

## Sunk head, two geometry lessons

- The head sinking jaw-deep into the yoke needs the CHEEK/JAW mass's
  bottom BELOW the clavicle tops — the thornbeast test pins
  `cheekCentreY - semiY < shoulderY + 0.02` (watch the sign; a first draft
  asserted the mass's TOP and the head "passed" while perched).
- The cranium slab's front lip overhangs everything beneath it. Any face
  feature that does not clear the lip in z reads as a blank dome from the
  game's eye height, and casts the lower face into its own shadow. The
  muzzle must be the most-forward prim by a wide margin (here ~0.48 m vs
  lip 0.35).

## strandedOf and the thorn seatings

`blob-checks`' strandedOf sweep caught the first yoke-burst pass launching
from the slope's AIR (32.7 mm float — the gargoyle wing-spur lesson
repeating). Spikes must be seated by computing the host ellipsoid's
surface at the base point, not by eye. The cheek-thorn pair, meanwhile,
was removed after every placement read as horizontal handlebar rods — at
jaw = shoulder-line height, horizontal head spikes cross the whole
silhouette.

## Not done / next

- Owner visual pass on the head (live lab), the plate's teeth-vs-maw
  balance, and thorn density.
- In-game spawn wiring: like the gargoyle at registration time, the
  thornbeast is roster+lab only; no EnemyMind tuning, no bespoke motion
  profile (shambles with the zombie's, arm style 'reach').
- The plate's orange-tipped quills are approximated as uniform bone
  (c9b896); per-prim two-tone paint does not exist.
