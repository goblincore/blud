# Flame lab — surface look after the fix pass (2026-09-17)

Captures from `npm run flame:capture` (`scripts/flame-capture.mjs`, headless
Chrome, `?seed=1`, 1380×820): six poses (`close`, `stand`, `walk`, `run`,
`collapsed`, `distant`) × two stages (`-fresh` = burn 1 char 0, `-charred` =
burn 1 char 0.6), plus `contact.png`, which puts `close-fresh`, `stand-fresh`
and `stand-charred` in a row beside the Blood reference tiles (3321/3323/3325)
at matched body height. Judge from `contact.png` first.

**This file replaces an earlier version that overstated the result.** That one
said the bodies "read unambiguously as on fire" when the captures showed a
glowing white-pink statue with no dark anywhere. The fix pass corrected the
shading; this note is written from the new captures.

## Tuning that produced these frames

`fireGain 2.8`, `noiseScale 7`, `charPatch 0.55`, `fireCoverage 0.9`,
`skeletonShow 0.7`, `revealDepth 0.08` (shader constant). Presets `ember` and
`inferno` carry their own coverage/skeleton values.

## What the surface pass gives

- **Char works.** At char 0.6 the body is genuinely blackened with embers in the
  low spots, and it reads as a burnt corpse rather than a tinted live one.
  Killing gloss and metal under the soot mask is most of what sells it — before
  that the charred body still read as wet latex.
- **Coverage is tunable and no longer blows out.** One noise field drives flame
  where it is high and soot where it is low, so dark shows between the flames
  from the first frame, which is what the reference sprites do.
- **The fire light, glow and heat warp all read**, and the light pool on the
  floor carries the effect at distance on its own.
- **The skeleton show-through is present but weak.** On `close-charred` and
  `collapsed-charred` there is a pale cap on the skull, pale streaks along the
  forearms and shins, and a spine line — anatomically placed, and correctly
  absent at the fresh stage. But it reads as *pale patches*, not as recognisable
  bone. Ribs do not come through at all: the chest flesh is deeper than the
  8 cm reveal, and pushing the reveal to 0.1 over-pales whole limbs into
  looking like fresh flesh, which is worse. Making bone read as bone probably
  needs the bone's own shading and shape rather than an albedo tint.

## What it does not give — the brief for the tongue plans

The body reads as **molten, not aflame**: glowing cracks and embers over dark
skin, like cooling lava. The reference is a body *wrapped* in fire, with ragged
tongues rising off the silhouette and dancing independently of the pose. Nothing
here leaves the skin: no upward licks, no flame past the outline, no volume
between the viewer and the body.

That gap is exactly what the three tongue techniques exist to close, and the
`close` framing is where to judge them — `distant` already reads acceptably from
the emissive and the light pool alone, so tongues must not wreck that.

Also unaddressed, by decision: the soldier's mesh kit (`soldier-kit.gltf`) does
not burn, so armour stays green while the flesh under it chars. The owner's call
is that the tongues will envelop it; revisit only if they do not.

## Provenance

The fix pass ran as dispatch tasks `2026-09-17-flame-fix-task-a` (done) and
`-task-b` (hit its 45-minute cap after landing the skeleton work and the
captures; this note and a mangled comment in the capture script were the
unfinished remainder, completed by hand). Reports are in
`~/.claude/dispatch/reports/`.

## Flame cards (plan task 3, verified 2026-09-18)

Captures: `npm run flame:capture -- --technique cards` →
`cards-<pose>-<stage>.png` + `cards-contact.png` (close-fresh, stand-fresh and
stand-charred beside tiles 3321/3323/3325). Atlas: `npm run flame:atlas` packs
FIRE01 tiles 3532-3539 into the untracked `public/assets/flame-placeholder/`
(gitignored; never committed).

**What the frames actually show.**

- **Stand / walk / run read as fire, not particles.** The FIRE01 flipbook at a
  Nearest mag filter gives crisp, ragged licks with dark gaps between them;
  they rise past the silhouette and do not pulse in step. This is the closest
  any technique has come to the reference tiles.
- **Upper body is the strongest part.** Heads and torsos are well engulfed;
  the flame licks read as fire in motion.
- **The lower body is still thin and the soldier's is bare below the knee.**
  Root cause is the soldier's MESH greaves: `depthTest` stays on (walls and
  bodies must occlude), and the kit writes depth several centimetres outside
  the SDF shin, so the shin/boot cards are occluded. A per-slot camera-bias
  experiment that pushed those cards forward was tried and abandoned: the
  lab's camera/pose drift between runs made the A/B unjudgeable and the frame
  contrast dropped.
- **Close-ups show hard card seams.** At `close` the atlas cells read as
  rectangular pixel blocks where a card crosses the body edge — the documented
  card-clipping failure mode, worst at close.
- **Collapsed poses keep the flame on the body** (the posed-anchor fix holds);
  the legs stay sparse there too.
- **Distant is unaffected** (luma std ~22): the cards add without wrecking
  readability.

**Leg anchor correction.** `limbCentre` used a limb's FATTEST prim; for a leg
that is an end mass — the soldier's hip ball at y≈1.12, the zombie's splayed
foot at y≈0.24 — so the `FLAME_CARD_SLOTS` offsets, which are authored against
the mid-limb centre, landed at the waist or the ankle. `limbAnchors` now feeds
the legs the posed cluster MEAN centre (`refitClusters`): soldier y≈0.80,
zombie y≈0.52, moving the leg cards ~0.3 m onto the leg. Head/torso/arms are
unchanged so the good upper-body look is untouched. The same end-mass bias
applies to the arms (fattest prim is the shoulder; offsets want the elbow); it
is left alone deliberately — arms are not the reported gap and are part of the
upper-body look the owner likes.
