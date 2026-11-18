# The zap's look: spike notes

2026-11-18. A look spike on the zap state built on 2026-11-17 (`docs/dev-notes/2026-11-17-tesla-zap/NOTES.md`,
spec `docs/superpowers/specs/2026-11-17-tesla-arc-design.md`). The owner played the first build and found it short
of a cartoon electrocution. This is what was tried, what the captures show, and what should go back into the spec.
Spike code: it is tested and typechecks, but it is tuned by eye from stills and has not been played.

## Summary

Three looks, switchable while the game runs:

- `__sdfGame.zapLook('a' | 'b' | 'c')` in the console (no argument reads it back), or
- `&zapLook=b` in the URL, e.g. `/sdf-game.html?level=arena&spawn=zombie&zapLook=b`.

A body already under the arc takes the new look on its next tick.

| | a (baseline) | b "cartoon" | c "burst" |
| --- | --- | --- | --- |
| Strobe | 0.08 s jolts, 0.25 to 0.7 s apart | 0.10 to 0.14 s jolts, 0.16 to 0.26 s apart | bursts of 3 to 5 jolts of 0.05 s, 0.05 s apart, then 0.3 to 0.6 s |
| Flesh, positive frame | flat blue-white, mixed in by the flickering glow | flat light blue, white rim, mixed in hard | hotter and whiter, mixed in hard |
| Flesh, negative frame | near black | near black with a blue-white rim line | near black, fainter rim |
| Bones | flat: black, or white on a jolt | dark blue with darker edges, drawn 1 cm thinner; white with dim edges on a jolt | the body's glow shows through the bone's middle, dark edges (an x-ray plate); white with dim edges on a jolt |
| Eyes | the skull's colour (lost) | the opposite of the skull: bright in the dark skull, black in the bright one | as b |
| Crackle on the flesh | no | yes | yes |
| Crawl arcs round the body | no | up to 10 | up to 14 |
| Kit | untouched | glows on the positive frame, blacked out on the negative | as b |
| Halo | no | no | yes |
| Body with no skeleton to show (`ZapTier.xray: false`: teratoma, cerebrax) | x-rayed anyway | no x-ray; the kit plays the bones | as b |

**Recommended: b**, with two things taken from c to try next (below). b is the one that reads as the cartoon at
every distance captured: a bright body with a dark skeleton in it, then a black body with a white skeleton, at
about 3 flips a second. Its skull has sockets, a nose, teeth and a jaw line in both states. c's positive frame
is whiter and its skull is the most detailed of the three from 1 m, but from 3.5 m its see-through bones nearly
vanish into the white body, so the positive frame reads as "white figure" and only the negative frame shows a
skeleton; its halo also lifts the whole room behind the body from close up, which costs the contrast it was
meant to add; and its bursts are 10 flips a second (see "Flashing" below).

Worth carrying from c into b in a follow-up: the halo at a lower gain (it is what makes a mesh-heavy body read as
lit from within at range), and c's bone treatment for the SKULL only from close range, if a distance switch is
wanted. Neither was built.

## What the brief had wrong, or what the code turned out to be

- **"Crackle or mini-arcs in the body shader or as a cheap overlay": both exist now, and the overlay was nearly
  free.** `character-effects.ts createBrainArcs` (the cerebrax's seizure arcs) already draws jagged additive
  ribbons from a list of paths. The zap's crawl arcs are new paths (`zap-arcs.ts`) handed to that drawer through a
  new `show(paths, bright)`; the drawer gained a width scale and a depth-test switch.
- **The spec lists "crawl arcs" under plan 2 (the arc).** They are built here, on the body, with no weapon end.
  Plan 2 can drop them or point its bolt's forks at the same drawer.
- **A flesh colour over about 1.5 in any channel does not come out of the SDF layer as that colour.** Found on
  the teratoma in look c: a positive frame of (1.3, 1.61, 1.95) drew as speckle over what looked like unlit pink
  flesh; (0.65, 0.84, 1.05) drew clean. The baseline's centre is (0.93, 1.2, 1.5), which is clean, and its rim
  goes to 3.4 x the core: that is the dotted, broken silhouette every zapped body has in the 2026-11-17 frames
  (the old notes call it "edges clipped to white"). Looks b and c clamp their flesh at 1.5
  (`ZAP_LOOK_VARIANTS.cap`). **Where in the layer this happens was not traced**; the baseline is untouched and
  still has it.
- **Most of the cast compiles pipelines on its first zap in the baseline** (1 to 4 each; the table under
  "Pipelines"): presumably their bone batches, which the boot warm-up does not hold. The zombie, the soldier, the
  cyberdemon and a few others compile none. This is the 2026-11-17 build's, not the spike's; the old notes only
  measured the zombie. Which pipelines they are was not read out.
- **Six characters cannot be spawned in the arena at all** (`zombie 1: no motion joints`, thrown by
  `createZombieActor`; the boot fails): mouse, cyclops, dragon, gargoyle, bloatmaw, broodmother. Nothing to do
  with the zap; found by the sweep. The broodmother is the registry's other "spider" (eight legs), so if the
  owner meant her and not the cerebrax, she could not be looked at.
- **"Jolts every 0.33 to 0.78 s"** is right for the baseline, and the more telling number is the share of the
  time the negative frame is up: 15%. A jolt is 5 frames; the eye gets a blink, not a second state.

## How it is built

All paths under `src/lab/sdf-zombie/`.

- `zap-look.ts` (new, pure): the three looks as data (strobe timing, arcs, kit flash, halo, the code), the live
  selector, and the lane's encode and decode. Tests: `zap-look.test.ts`.
- **The lane.** The body's record (`REC_BURN.w`) and its bone instances (`iZap`) already carried the signed glow.
  They now carry `sign x (2 x code + glow)`: code 0 is the 2026-11-17 value to the bit, so look a's shader input
  is unchanged, and no uniform, vertex buffer or record slot is added. Both shaders decode it
  (`floor(abs(lane) / 2)`), so the look is per body and cannot bleed across a crowd type.
- `zap.ts`: `createZap` and `stepZap` take a strobe (default: the baseline's). A strobe with ranges of one value
  draws nothing from the seed, so the baseline clock is the old one exactly: 600 steps at three seeds compared
  against the `b4844284b` module, output for output, before the change was kept. Bursts are a `burstLeft`
  counter on the state. `game-actor.ts` hands it the live look's strobe each step.
- `webgpu/march/body/blocks/post/zap.wgsl.ts`: `ZAP_BLOCK` decodes the lane and, for a variant, writes the code
  and the crackle to a new private `gZapLook` (`fields/groups.wgsl.ts`). The crackle is the zero lines of a
  kinked `noise3`, in patches, re-rolled 16 times a second off `faceCfg3.y` (5 `noise3` calls a zapped flesh
  pixel; no other pixel runs it). `ZAP_LIGHT_BLOCK` keeps the baseline's lines under `gZapLook.x < 0.5` and adds
  the variants' branch: two hard states (the mix is full from a glow of 1/3), a rim on the negative frame, the
  crackle, the cap.
- `webgpu/skeleton-spike/zap-xray.ts`: `zapXrayColour(lit, zap, facing, kind)`. For a variant the bone keeps two
  terms the flat colour threw away: its own lit colour as a compressed tone (its paint: a socket, a tooth gap)
  and how far the surface faces the eye (its edge, which is what draws teeth, jaw and nose). `kind` 1 is an
  eyeball. `zapXrayPull` takes the vertex normal and, for look b, draws the surface 1 cm in along it before the
  pull (not an eyeball: its material is marked `zapNoThin`). TS twins `xrayColourLook` and `xrayDeflate`, tested.
  `mesh-renderer.ts` and `segment-instance.ts` pass the two new arguments; no new attribute or varying buffer.
- `zap-arcs.ts` (new, pure): arc paths over the body's posed primitives (each a capsule), three kinds: a crawl
  along one, a bridge to another 0.2 to 0.75 m off, a leap into the air. Tests: `zap-arcs.test.ts`.
- `webgpu/game-zap-fx.ts` (new): the overlay, stepped from `stepZapLook`: strikes the arcs 24 times a second,
  flashes each zapped body's kit, places the halo. Creates nothing while look a is live.
- `webgpu/zap-halo.wgsl.ts` (new): the halo's falloff. One additive, depth-tested billboard at the body's
  centre, sized to the box of its primitives plus 0.35 m; the body's own depth hides its middle.
- `webgpu/kit-overlay.ts`: `KitOverlay.zap(+1 | -1 | 0)`: every standard material's emissive and albedo, saved
  on entry and restored on 0. Uniforms only.
- `motion-profile.ts`: `ZapTier.xray` (default true). False on the teratoma and the cerebrax.
- Seams (`game-seams-fire.ts`): `zapLook(id?)`, `zapFxArcs(on)`, `zapBox(id)`. The URL param is read where
  `game-zap.ts` loads.
- `scripts/zap-look-capture.mjs` (new): the capture every number below comes from.

## Numbers

All from `node scripts/zap-look-capture.mjs` (headless Chrome, 960 x 600, the arena, `__warmGate.phase ===
'ready'`, fails on a renderer pipeline error; none in any run). JSON beside this file: `zap-look-zombie.json`,
`zap-look-chars.json`, `zap-look-sweep*.json`.

### The skull's features (zombie, from 1.0 m)

The same instant drawn with the bones shown and hidden; the pixels that differ by more than 40 of 255 are the
skeleton. Inside that mask in a box round the head, with its rim eroded 3 px so the silhouette is not counted:
luminance standard deviation (contrast), 5th to 95th percentile spread, and mean Sobel gradient (edge). Crawl
arcs off for the measurement.

| look | state | contrast | spread | edge | mask px |
| --- | --- | --- | --- | --- | --- |
| a | positive | 4.7 | 3.4 | 2.2 | 10456 |
| a | negative | 3.3 | 6.0 | 1.6 | 11472 |
| b | positive | 24.7 | 76.8 | 14.5 | 6846 |
| b | negative | 38.7 | 106.2 | 17.0 | 5991 |
| c | positive | 45.8 | 146.0 | 29.6 | 5859 |
| c | negative | 35.0 | 107.0 | 18.6 | 9211 |

Against the baseline: b has 5 to 12 times the contrast and 6.5 to 11 times the edge; c 10 to 11 and 12 to 13.
Two earlier runs of the same build gave b 26.7 / 37.0 contrast and c 30.8 / 33.5, so read these to about +/- 30%
(the head sits a little differently in the box each run). The mask is smaller for b (thinner bones) and for c's
positive frame (a bone's middle is near the flesh's colour there, so it is under the 40 threshold): the numbers
are over what is left, which is the darker, edge-heavy part.

### The body in the two strobe states

From the saved full-body frames: the body is the pixels that differ by more than 30 of 255 between the positive
and the negative frame, in the scene area (HUD rows and the first-person gun left out). Mean luminance of that
mask in each state, and the mean absolute change between them.

| character | look | positive | negative | change | mask px |
| --- | --- | --- | --- | --- | --- |
| zombie | a | 119.0 | 140.8 | 126.5 | 20969 |
| zombie | b | 178.8 | 87.2 | 130.2 | 21567 |
| zombie | c | 144.0 | 70.8 | 93.7 | 47411 |
| soldier | a | 110.0 | 142.3 | 121.2 | 21249 |
| soldier | b | 203.8 | 91.0 | 146.0 | 27193 |
| soldier | c | 150.9 | 63.2 | 97.6 | 60530 |
| cyberdemon | a | 138.4 | 104.0 | 134.5 | 24838 |
| cyberdemon | b | 205.9 | 79.3 | 155.3 | 24288 |
| cyberdemon | c | 159.4 | 59.2 | 108.4 | 45130 |
| teratoma | a | 124.3 | 137.6 | 140.2 | 32979 |
| teratoma | b | 170.8 | 91.5 | 168.6 | 37777 |
| teratoma | c | 185.8 | 67.1 | 174.1 | 43140 |
| gorehound | a | 148.5 | 133.8 | 122.5 | 14808 |
| gorehound | b | 203.9 | 92.9 | 155.3 | 41900 |
| gorehound | c | 203.3 | 98.0 | 136.6 | 54415 |
| cerebrax | a | 92.2 | 94.7 | 87.9 | 35244 |
| cerebrax | b | 95.2 | 103.9 | 115.5 | 36082 |
| cerebrax | c | 103.9 | 65.3 | 79.9 | 73360 |

- **In the baseline the "bright body" frame is not brighter than the jolt**: 119 against 141 on the zombie, 110
  against 142 on the soldier. The bones fill the body, so the positive frame is mostly dark bone. This is the
  owner's point 2 as a number.
- In b the positive frame is about twice the negative (179 / 87 on the zombie, 204 / 91 on the soldier).
- c's masks are about twice the size because the halo is in them; that pulls its means and its change down.
- The cerebrax is the exception in b: its brain is small and its kit (which plays the bones, so it is bright on
  the negative frame) is most of the body, so the two means are near each other. The flip is still there (change
  115 against the baseline's 88); it is a flip of which part is lit, not of how much.
- The gorehound's baseline frames are head-on and its b and c frames side-on (it turned between runs), so its
  mask sizes are not comparable across looks.

### The strobe

| look | jolts a second (10 s, `zap-look.test.ts`) | negative frame up | in the game (zombie, to the statue, 1.6 s) |
| --- | --- | --- | --- |
| a | about 1.8 | 15% | 3 jolts, 1.88 a second, 15.6% |
| b | about 3 (gated 2.6 to 3.5) | about 35 to 40% (gated 30 to 45%) | 5 jolts, 3.13 a second, 34.4% |
| c | bursts of 3 to 5 at 10 a second | about 25 to 33% | 8 jolts, 5.0 a second, 33.3% |

The in-game sample is short because the body cooks through in 1.6 to 2.2 s and stops strobing. The other
characters' runs gave b 2.5 and c 3.13 a second over the same 1.6 s (a different seed).

### Pipelines

`pipelineLog().totalPipelines` before a look's first zap and a few frames after its first jolt.

| character | a | b | c (after b in the same boot) |
| --- | --- | --- | --- |
| zombie | +0 | +2 | +1 |
| soldier | +0 | +3 | +1 |
| cyberdemon | +0 | +2 | +2 |
| teratoma | +3 | +5 | +4 |
| cerebrax | +3 | +5 | +4 |
| gorehound | +2 | +4 | +3 |

So over the baseline: the crawl arcs compile 2 pipelines on their first strike (b), the halo 1 (c). Neither is
in the boot warm-up, so the first zap of a session hitches; a kept look needs them pre-warmed. One more pipeline
turned up on the soldier and the juggernaut in b (+3, not +2) and on the cyberdemon in c; **its source was not
found**. The soldier and the juggernaut are the two armoured kits, so it is probably the kit's flash on one of
their materials: "the kit flash compiles nothing" holds for the other eleven kits run (goblin, clown, warbull,
twinhead, butcher, flayer, deadeye, gibbet, chair, gamer, imp: +2 each over their baseline) and NOT for those.

The sweep also showed the baseline compiling on a first zap for far more than the teratoma and the cerebrax:
twinhead, butcher, flayer, deadeye and tallow +3, imp +4, gorehound, gibbet, chair, gamer and venus +2, clown
and bride +1.

### Boot time

`node scripts/boot-time.mjs`, a fresh Chrome profile each run, base and spike alternating in one session (base
first). Base: the branch's head before the spike, `b4844284b`, as a `git archive` copy under `.lab-tmp/base`.
Spike: the look code as measured here (the working tree at `d9a8940e4` plus nothing that touches a shader).

| pair | base `drawOnce` (ms) | spike `drawOnce` (ms) | base warmMs | spike warmMs |
| --- | --- | --- | --- | --- |
| 1 | 1004.5 | 970.8 | 24926 | 19699 |
| 2 | 1061.4 | 1077.7 | 1542 | 1485 |
| 3 | 1079.5 | 1098.0 | 1487 | 1580 |
| mean | 1048.5 | 1048.8 | | |

Ratio of the means 1.000; the pairs are -34, +16 and +19 ms, inside the spread one checkout shows (75 ms across
the three base runs). The first pair's long warmMs is on both, as in the 2026-11-17 runs.

### The baseline is still the baseline

`node scripts/zap-trace.mjs` (the 2026-11-17 trace; it runs on look a) after the spike:

- the two-body bleed scenario (crowd program `ready`), the 4 s series and the split-head scenario ran with no
  gate failing; the bone instances carry `0.7348845601081848` at t = 0.25 s and `-0.6967968344688416` on the
  first jolt, the same values to the last digit as the lane before the spike; skeleton share 16.36 of 255 on the
  glow and 17.74 on the jolt (16.32 and 18.05 in the 2026-11-17 notes); pipelines 125 before, 125 after;
- **that run did not finish as one run**: the boot for its last scenario (slot 9) timed out in the harness
  (`Runtime.evaluate timed out ... setBloodBlur(false)`), after an hour of captures on the same machine. The
  slot 9 scenario was then run alone (`ZAP_TRACE_TESLA_ONLY=1`) and passed: `DONE`, pipelines 125 and 125. An
  earlier attempt at the full trace failed sooner on a screenshot timeout, straight after the machine had been
  idle for over an hour. So: every scenario has passed since the spike, never all in one process.
- The zap clock under the baseline strobe was compared against `b4844284b`'s module, output for output, over
  600 steps at three seeds: identical.

### What was not measured

GPU frame time. The crackle is 5 `noise3` calls on a zapped flesh pixel in looks b and c and nothing elsewhere;
the bone shader gains a handful of arithmetic ops on every bone pixel in every look (the decode and the branch).
No number was taken for either.

## Per character

Every character the arena can spawn was zapped in looks a and b (sheets `zap-look-sheet-sweep1/2/3.png`), and
the zombie, teratoma, cerebrax, soldier, cyberdemon and gorehound in c as well. 34 asked for; **six cannot be
spawned in the arena at all** (`zombie 1: no motion joints` at boot): mouse, cyclops, dragon, gargoyle, bloatmaw,
broodmother. Not the zap's doing; they have no verdict. Near-duplicates (the goblin's home and cinematic bodies,
`clown-alt`, the other schoolgirls, `cultist-cowled`) were not run.

The main finding: **only the zombie-family bodies have a skeleton that is a skeleton.** Their mesh skeleton has
a skull, ribs, a pelvis and limb bones. Most of the rest of the cast draws a stand-in: rods for limbs and round
discs at the joints and down the spine. X-rayed, that is a stick figure with dots, in any look. It still gives
the two-state flip, and on a biped it still says "skeleton" from range; it does not survive a close look, and on
a body that is not a biped it says nothing.

"Body luma" is the positive / negative mean from the table's method above, looks a then b.

| character | kind | baseline (a) | look b | verdict and what it needs |
| --- | --- | --- | --- | --- |
| zombie, female, schoolgirl, bonewalker | biped, real skeleton, no kit | reads, but dark: bones fill the body (zombie 119 / 141) | reads well (179 / 87) | Good in b. The reference case. |
| goblin, imp | biped, small kit | reads; kit unlit | reads (goblin 169 / 83, imp 178 / 94) | Good in b. |
| butcher, flayer, deadeye, twinhead | biped, real skeleton, machinery kit | flesh reads; the machinery stays lit and dull, so the positive frame is darker than the jolt (butcher 116 / 145) | whole figure flips (butcher 208 / 84) | Good in b: the kit's flash is what fixes them. |
| soldier, juggernaut | biped, armour kit over most of the body | **weak**: olive armour untouched, the glow shows only at the gaps (soldier 110 / 142, juggernaut 95 / 158) | whole figure flips (204 / 91, 210 / 85) | Good in b. The held gun is a prop, not kit: it stays lit as it was in both states. |
| cyberdemon, warbull, minotaur, ogre, gnasher, tallow, venus, bride, cultist | biped, stand-in skeleton (rods and discs) | reads as a stick figure with dots | the same figure, in a body that now flips (cyberdemon 206 / 79) | Acceptable from range, poor up close. Needs real bone meshes, or a skull at least; the look cannot invent them. The cultist's robe hides nothing (it is flesh, so it glows), which is right. |
| clown | biped, big hat and collar kit | **weak**: the white hat and collar are most of the silhouette and do not react (158 / 158: no flip at all) | flips (231 / 88) | Good in b. |
| teratoma | a floating ball, one skull plate, kit eye / teeth / horns | **bad**: the x-ray is one dark shape in the ball that reads as a blob or a saucer | reads: glowing ball with dark horns and teeth, then black ball with bright horns and teeth (171 / 92) | Fixed in b by `xray: false` (built): the kit plays the bones. The eye keeps its own yellow glow in both states. No star pose to take; the tremor carries it. |
| cerebrax (the spider) | a brain on a mesh harness and four mesh legs | **bad**: four dark discs in the brain; legs, harness and gun untouched, and they are nearly all of it (92 / 95) | reads as a flip of WHICH part is lit: brain bright with dark legs, then legs bright with a dark brain (95 / 104, change 115 against 88) | Fixed in b by `xray: false` (built). Its legs do not move in the zap (no star); the kit's flash and the arcs along the legs carry it. A leg splay is the obvious next step and was not tried. |
| gorehound | quadruped, `star: false`, stand-in skeleton | reads weakly: head-on it is a small glow with bars | glowing beast, bars and discs inside (204 / 93) | Acceptable. No pose change beyond the tremor; wants an arched-back or stiff-legged zap pose of its own. |
| gutcrawler | low crawler, `star: false`, no kit | **bad**: a small glow with a blob in it | glowing body with a row of discs down it | Weak in both. The discs read as beads. Candidate for `xray: false`, but it has no kit to play the bones, so it would be a glow and arcs only; wants its own pose (a spasm or a curl). |
| gibbet | a body in a mesh cage with big mesh arms | weak: cage and arms untouched | cage and arms take the strobe; discs inside | Acceptable in b. Candidate for `xray: false` (kit as bones): the cage would be the "ribs", which is the better joke. Not tried. |
| chair, gamer | a body seated in a mesh chair | weak: a pale slab with dots, chair untouched | the whole thing flips (chair 227 / 63) but the figure is hard to read in either state | Weak. Candidates for `xray: false`. The chair is the obvious "electric chair" beat and deserves its own treatment. |

Proposed per-character rule, in the order to do it:

1. Keep `ZapTier.xray` and set it false wherever the bone instances are not a readable skeleton AND there is a
   kit to play the bones: teratoma and cerebrax (done), then gibbet, chair, gamer (one line each; look at them).
2. Give the stand-in skeletons a skull. The eyes-opposite-the-skull rule is what makes a skull read, and it only
   works where there is a skull mesh.
3. A zap pose per non-biped (`star: false` bodies today only tremble): gorehound, gutcrawler, cerebrax's legs.
4. Held props (guns, the ogre's saw, the bride's sword) take the strobe with the kit.

## The outline the owner floated, and what it costs

What was built toward "the whole character glows, flesh and mesh alike":

1. **The kit takes the strobe** (b and c). Every kit material glows the zap's blue-white on the positive frame
   and is blacked out on the negative. Cost: a handful of uniform writes when the state flips; no draw, no
   geometry. (Pipelines: see the caveat above.) This is the change that fixes mesh-heavy bodies: the soldier's
   positive frame goes from 110 to 204.
2. **The halo** (c). One additive billboard a zapped body, sized to its box plus 0.35 m, depth tested so the
   body hides its middle. Cost: 1 pipeline, one quad a zapped body, one layer of overdraw over roughly the body's
   screen box. It is a soft glow round the figure, not an outline: it does not follow the silhouette, the floor
   cuts its bottom edge flat, and from 1 m it greys the whole room behind the body.
3. **The rim on the negative frame** (b and c): a fresnel line on the flesh, in the march. Free. Flesh only.

A true silhouette outline was NOT built. The two ways to get one, as far as the code was read:

- **Flesh: the march already tracks a near miss.** `trace.wgsl.ts` keeps `missNear` (the closest a missed ray
  came to the surface, in pixel footprints) for the checker edge experiment, behind `gInstMelt.y == 2`, and a
  missed ray then returns it under a sentinel instead of discarding. A zap outline could ride that: a missed ray
  within N footprints of a zapped body returns a glow. Cost: the min in the march loop for zapped bodies only, and
  the SDF layer's composite has to learn to draw that return (today it treats it as a miss with a depth just
  short of the far plane). It cannot reach past the body's proxy box, and it interacts with the upscaler's miss
  handling (the early-Z notes have a fringe there already). A plan of its own, not a spike step.
- **Kit: an inverted hull**, a second draw of each skinned kit mesh, back faces, pushed out along the normal.
  Cost: one more skinned draw a kit mesh while zapped and a pipeline a kit material class.
- Or one screen-space pass over a mask of zapped bodies (flesh and kit together): a mask target, a blur or a
  dilate, a composite. It is the only one that gives a single clean outline round both; it is also a new
  full-screen pass.

## Flashing

Look b flips about 3 times a second, c in bursts at 10 a second. The common guideline for photosensitive
seizures (WCAG 2.3.1) is no more than three flashes in any one second over more than a small part of the view. A
zapped body at range is a small part of the view; a zapped body at 1 m, or a room of them, is not. b sits at the
line; c is over it. If c's bursts are wanted, they want an accessibility switch or a cap on how much of the view
may strobe. Not a ruling, a flag: nobody has played either.

## What should go back into the spec

- The zap is **two hard states** that alternate, not a glow with a short blink: the positive frame (bright body,
  dark detailed bones) and the negative (dark body, bright bones). The strobe's timing is part of the look
  (`ZapStrobe`), stepped by the zap clock.
- The bone look keeps the bone's paint and edge; the eyes take the opposite of the skull.
- `ZapTier.xray`: a body whose skeleton is not one a player can read is not x-rayed; its kit plays the bones.
- The kit takes the strobe.
- The flesh's colour stays at or under 1.5 a channel until the layer's handling of brighter values is understood.
- Crawl arcs belong to the zap state (they are on the body), not to plan 2.
- The arcs' and the halo's pipelines, and the bone batches of bodies outside the boot warm-up, need pre-warming.
- The flashing question above.

## Not verified

- **Anything in motion.** Every judgement here is from stills. The strobe, the arcs' flicker and the crackle's
  crawl have been seen only as single frames.
- **The crowd draw.** Every capture here zaps the arena's one body; whether it was drawn through the crowd
  program or the per-body fallback was not checked (the 2026-11-17 trace found its single-body scenarios run on
  the fallback). The lane is the same record slot either way, and `zap-trace.mjs`'s two-body bleed scenario was
  rerun on look a only (below).
- **The split-skull pipelines** (`skeleton-bone-split`, `skeleton-plate-split`, `skeleton-eye-split`) under
  looks b and c. They get the same colour wrap and the same pull, and `zap-trace.mjs`'s split scenario passes on
  look a, but no split head was captured in b or c.
- **The procedural skeleton** (`?skeleton=procedural`): the march's bone probe takes the variants' colours
  (`zapBones`), never run.
- **Look b's thinning on thin bones.** 1 cm along the normal turns a bone thinner than 2 cm inside out. In the
  captures the ribs and the arm bones are thinner and intact; fingers and other small segments were not looked
  at closely.
- **The crackle on the positive frame.** White lines on a light-blue body: it is hard to find in the stills. It
  shows on the negative frame. Whether it reads in motion is unknown.
- **Crawl arcs against a wall or another body.** They are depth tested (so the first-person gun hides them, and
  so does the body's own flesh where an arc dips into it); nothing but the empty arena was captured.
- **Night Train, any sector level, bullet time, a burning body, a wounded body.**
- **GPU cost** (above), and **the extra pipeline** (above).
- **The kit flash on a kit with glow-from-attribute materials** beyond the teratoma's eye (it stays yellow in
  both states, which reads fine); the soldier's visor and status lights under the flash were not looked at
  closely.
- **A body whose arc leaves mid-burst and recovers** in look b or c, in a capture (`zap-look.test.ts` covers the
  clock).

## Files

Contact sheets (PNGs here are gitignored; the script rewrites them):

- `zap-look-sheet-zombie.png`: the zombie, looks a / b / c, each: body positive, body negative, skull positive,
  skull negative.
- `zap-look-sheet-chars.png`: teratoma, cerebrax (the spider), soldier and cyberdemon (mesh-heavy), gorehound;
  a row a character, looks a / b / c, positive then negative.
- `zap-look-sheet-sweep1.png`, `-sweep2.png`, `-sweep3.png`: the rest of the cast, looks a and b.

Single frames: `<character>-<look>-body-pos.png`, `-body-neg.png`, and for the zombie `-skull-pos.png`,
`-skull-neg.png` (with `-bones` / `-nobones` twins: the measurement's pair, arcs off).

## Update 2026-11-18: look c is the default, and its four weak spots

The owner played all three and picked **c** (`ZAP_LOOK_DEFAULT` in `zap-look.ts`). `scripts/zap-trace.mjs` pins
`zapLook=a`, since its gates were written against the baseline. Then the four things this spike had flagged in c:

- **Bones at range.** A see-through bone with a sub-pixel dark edge is no bone from a few metres. The bone's middle
  now goes from the body's glow at 1.6 m to look b's dark bone at 3.0 m and beyond (`ZAP_XRAY_LOOK.cFarM`;
  `zapXrayColour` takes the fragment's distance from the eye). Up close it is unchanged.
- **The halo up close.** Its strength falls from full at 3.0 m to a fifth at 1.2 m and nearer (`zapHaloAmount`,
  `ZAP_HALO.nearM` / `nearFloor`), so the billboard no longer greys the room when it fills the view.
- **First-zap hitch.** `prewarmZapFx` (called beside the tracers' pre-warm in `game-tick.ts`) draws the crawl arcs
  and one halo once, under the floor at no strength. Halos are now pooled instead of disposed.
- **Flash rate.** The default bursts are left as the owner picked them (10 jolts a second inside a burst). Under
  the repo's `?flashes=reduced` every variant strobes with single 0.12 s jolts, never more than 3 in any second
  (`ZAP_STROBE_REDUCED`, tested over 60 s at five seeds).

Capture (`cfix/zap-look-sheet-cfix.png`, zombie, look c): pipelines on the first zap 131 before and 131 after (it
was +3); skull from 1 m contrast 40.7 / 27.6 and edge 19.2 / 10.9 (positive / negative), inside the earlier run's
spread; from 3.5 m the skeleton is dark against the bright body, and the close frames' background is dark.

Not verified: cold-boot `drawOnce` after the bone shader's new parameter; `?flashes=reduced` in the running game
(unit tests only); the pre-warm on Night Train or with look a at boot and a later switch to c; any of it in motion.
