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
