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

# Flame polish pass (plan tasks 1–5, 2026-09-18)

Captures: `npm run flame:capture -- --technique cards` → `cards-<pose>-<stage>.png`
for `close|stand|walk|run|collapsed|distant` × `fresh|charred`, the three
`cards-death-*` frames, and `cards-contact.png` (close-fresh, stand-fresh,
stand-charred beside Blood tiles 3321/3323/3325). This section is written from
those images plus the `flow-sweep/` and `bone-sweep/` A/B folders; the commits
are `d89df81e`, `64befd71`, `3a4a1e6a`, `492c7216`, `afe78c1d`, and this pass's
task-5 commit.

**1. Close-range card seams — fixed; the guess in the plan was wrong.**
The plan blamed atlas-UV bleed (Cause A) or hard depth clipping (Cause B). The
actual cause was the atlas texture NODE being built over a 1×1 `DataTexture`
whose default filters are Nearest; `WGSLNodeBuilder.isUnfilterable()` then baked
`textureLoad` into the compiled shader, and because `setAtlas()` swaps by
`.value` there is no recompile — so the real 31×25 FIRE01 atlas was ALWAYS
point-sampled and every texel became a ~10 px flat block. All three fixes
shipped: the Linear/Linear fallback (the fix), a half-texel UV inset plus a 2 px
atlas gutter, and the soft-particle depth fade (`cardSoftFade`, 0.08 m). In
`cards-close-fresh` the point-block mosaic at the body edge is gone and the
flame reads as continuous licks. **Still not right:** at the `close` framing the
cards' own quad silhouette is visible as flat-topped rectangles against the dark
(see the upper-left card in `cards-contact.png`). That is the cell art reaching
the top of the quad, not atlas bleed, and no UV inset can remove it.

**2. Curl-noise flow.** A 64³ seeded RGBA8 curl volume (`curl-volume.ts`) both
warps each card's atlas UV (bounded to the gutter) and displaces its CPU anchor,
so a limb's cards move from one field instead of flickering alone; `flameFlow`
default 0.35. In `flow-sweep/cards-stand-fresh-f0.png` the licks are separate
quads; at `-f1.png` the whole mass leans and warps together. The sweep stops
helping near the top: above roughly 0.7 the displacement is large enough to pull
cards off the flesh and the mass reads sparse/torn, which is why the default is
0.35.

**3. Flame down the kit-covered legs.** `cardStandoff(slot, {kitRadius})` pushes
a leg card out past the covering shell and `cardAnchorDrop` lowers the boot slot
to the boot; the lab feeds the soldier `SOLDIER_LEG_KIT_RADIUS = 0.14` (measured
from `soldier-kit.gltf`), 0 for the zombie. `--frozen` plus `__flameLab.pose()`
finally made the A/B pixel-comparable. In `cards-stand-fresh` (soldier legs)
flame now runs down the greaves and wraps the boot instead of stopping at the
knee — no visible float off the leg at this framing. **Still not right:** the kit
is mesh and does not char, so green greave still shows through the flame.

**4. Bone reads as bone.** The old probe result was lerped into albedo as a flat
pale tint. The probe now drives the bone material: bone albedo with a
depth-recessed core, near-matte bone gloss, and a normal taken from the isolated
bone field's own gradient; `skeletonDepth` (default 0.08) is the tunable reveal
depth. On `cards-close-charred` the skull cap and the forearm tubes read as hard
shaped bone rather than blotches. **Still not right:** the ribcage still does not
come through at any `skeletonDepth` in `bone-sweep/` that does not also pale a
whole limb into looking like fresh flesh (the 0.12/0.15 frames trade ribs for
that); the accepted compromise is 0.08.

**5. Burning death.** `killBurning()` in `burn-state.ts` starts a
`corpseBurnSec` (default 6) window in which the char drives to 1 while the fire
fades linearly to 0; the lab's 'k' key now enters it on every alight body (and
still collapses), and the card frame carries the burn-down progress as `settle`,
which pulls the cards horizontally over the corpse's footprint and down to a
`FLAME_PILE_LIFT` heap while shortening them. `__flameLab.death(sec)` pins an
exact point in the window and pauses burn integration so the capture is
repeatable. `cards-death-lit.png` shows both bodies standing in fire;
`cards-death-midburn.png` shows the killed bodies down with the particles gone:
the zombie is a dark charred mass under a low band of warm card licks and the
floor still carries the fire-light pool; `cards-death-out.png` is the same pair
with the pool dark and `cards.live = 0`, so the flame visibly dies rather than
snapping off. **Still not right:** at `death-out` the task-4 bone reveal at
`char = 1` is bright enough (near-white tubes) that the cold zombie reads as
glowing bone, not as a purely charred corpse; dimming that would change task 4's
accepted bone look, so it is left as-is. The soldier's mesh kit is still green
lying in the dark. The mid-burn heap is a low band over the corpse rather than a
tall column collapsing, which reads closer to the retired `GroundFlame` heap
than to NotBlood's full flame column.

**Still not right across the pass, in one list:** card quad silhouettes at close;
flow tearing above ~0.7; unburnt mesh kit on both characters; ribs never read;
bright bone at full char makes the cold death corpse look lit; the death heap is
low rather than a collapsing column.

# Bone fix — scorched bone, capped reveal (2026-09-18)

Captures: `npm run flame:capture -- --technique cards`, overwriting the same
`cards-<pose>-<stage>.png` set plus `cards-death-*` and `cards-contact.png`.
This worktree had no placeholder atlas, so it was rebuilt from the primary
checkout's extraction with `npm run flame:atlas` first (gitignored either way).

**What changed** (`march.wgsl.ts`, the bone-reveal block; test in
`march.wgsl.test.ts`, "scorches the revealed bone with char and caps the reveal
at skeletonShow"):

1. **Scorched albedo.** `let boneShade = mix(boneColor, scorchedBone, charAmt)
   * mix(0.8, 1.0, nearBone);` with `scorchedBone = vec3(0.16, 0.13, 0.11)`.
   Bone that has been in a fire is dark grey-brown, not ivory: at char 1 the
   revealed bone lands at ~1.4x the surrounding char, so a burnt body no longer
   reads pale. The depth term can now only DARKEN (0.8..1.0) — shape comes from
   the bone normal and the gloss difference, never from lifting albedo.
2. **Capped reveal.** `boneMat = clamp(nearBone * 3.5, 0.0, 1.0) * skelK;`,
   where `skelK = charAmt * burnSkeleton`. The old unconditional
   `clamp(showBone * 3.5, ...)` saturated to a full bone mix above showBone
   ~0.29, which is what turned whole thin forearms bone-coloured end to end.
   Scaling by `skelK` makes `skeletonShow` a hard ceiling, so a fragment can
   only ever be PART bone.
3. **Steeper depth falloff.** `nearBone` is the squared linear smoothstep ramp,
   so bone well under the surface contributes very little.
4. **Nothing emissive.** `gBurnEmit` is multiplied by `(1.0 - boneMat)`, so
   revealed bone does not pick up the fire emission; at boneMat 0 the factor is
   1.0 and the line is unchanged. Bone gloss dropped 0.45 → 0.3 so a specular
   highlight does not make cold bone read as lit.
5. Gate unchanged: still `charAmt * burnSkeleton`, so char 0 is byte-identical
   (boneMat stays 0, the emission factor stays 1).

**What the captures show.**

- `cards-close-charred.png`: the zombie reads **black/charred** with ember
  cracks between the flames and only a faint bone sheen along an arm edge. The
  pre-fix frame had the whole body pale ivory with hard bone tubes; this is the
  regression reversed. (Luma std 73.2 → 56.26; the orbit camera drifts between
  loads, so judge the two side by side rather than by pixel diff.)
- `cards-death-out.png`: the corpse is a **cold, dark charred mass** with bone
  at most faintly speckled. The pre-fix frame showed a bright ivory skeleton
  (std 23.34 → 20.03).
- `cards-*-fresh.png`: no bone, as before — the gate is 0 at char 0. The pale
  tubes still visible on the soldier in `cards-close-fresh` are its mesh
  kit/flesh and are present identically in the charred frame; they are not the
  SDF bone reveal.

**Still not right.** Ribs still do not read (unchanged from task 4 — the chest
flesh is deeper than 0.08). The reveal is now deliberately subtle; if the owner
wants the skull more legible, that should come from `skeletonShow`/char rather
than from brightening the bone albedo, which is the trap this fix removes. The
soldier's mesh kit is still unburnt green, the close-view card-quad silhouettes
and the low death heap are unchanged.
