# The sculpted skull, `full`, is the game's skull (2026-10-07)

The game draws each humanoid's skull as a mesh under the SDF flesh; it shows where flesh is shot or chopped away.
There are two skulls. The **sculpted** one is the character's own bone field, carved and painted. The **anatomical**
one is a modelled skull of 14 plates.

This file has five parts, newest first:
[the eight ball-headed humanoids draw a fitted anatomical skull](#the-eight-ball-headed-humanoids-draw-a-fitted-anatomical-skull-2026-10-07),
[the slug's split needs a precise aim](#the-slugs-split-is-a-reward-for-a-precise-shot-at-close-to-medium-range-2026-10-07-second-playtest),
then the decision that made the sculpted skull the default (below them), then
[the variants the owner chose from](#the-sculpted-skull-second-pass-variants-to-choose-from-2026-10-07), then
[the gun and the zombie's head](#the-gun-and-the-zombies-head-2026-10-07-after-the-owners-playtest-of-sculptfull).

---

# The eight ball-headed humanoids draw a fitted anatomical skull (2026-10-07)

When the sculpted skull became the default, eight of the thirteen humanoids were left showing balls: their head
bones were authored as a ball over a jaw ball, or a column of beads, 48 to 112 mm wide, for the SDF bone tubes
(the part below, "The characters that are not carved"). The owner: "for now the other ones can use the anatomical
skull as long as they are properly filled."

They now do. The sheet: [`look/ball-heads-anatomical.jpg`](look/ball-heads-anatomical.jpg). Left, before
(`?skull=sculpt`: every character's sculpted bone). Right, after (no skull parameter). For each: the bare bone from
the front and from three-quarter, the flesh drawn half see-through over the bone, and the face shot away with one
real pellet volley from 2 m, as the game ships, from 1.5 m at the player's eye height.

## What a page draws now

`resolveSkull` (`skeleton-spike/sculpt-variant.ts`) still decides, and now character by character. Its answer names
who draws the anatomical skull and under which fit; `skeleton-spike/sculpt-cache.ts` builds the kit with that plan.

| The page's query | The zombie, the soldier | The juggernaut, the two clowns | The eight |
| --- | --- | --- | --- |
| no skull parameter | sculpted, `full` | sculpted bone, second paint | **anatomical, each under its own fit** |
| `?skull=sculpt` | sculpted, `full` | the same | sculpted bone: the balls (the comparison) |
| `?sculpt=<variant>` | sculpted, that variant | sculpted bone | sculpted bone |
| `?skull=anatomical` | anatomical, the envelope fit | anatomical, the envelope fit | anatomical, the envelope fit: as it was |
| `?skullfit=<name>` added | (no change unless `?skull=anatomical`) | (the same) | anatomical under that named fit, plain |

- The eight: cultist, cultist-cowled, bride, female, schoolgirl, schoolgirl-alt, schoolgirl-described, bonewalker.
- `?skull=anatomical` is what it was: every humanoid on the plates under the envelope fit (fixed fractions of the
  bone envelope), with the eyes where the sculpted skull seats them. `?skull=anatomical&skullfit=snug` fits every
  humanoid to its flesh.
- `?skullfit=` takes `envelope`, `affine`, `mid`, `snug` or `tight` (the fits of
  [the fit's notes](../2026-10-07-anatomical-skull-fit/NOTES.md)). It gives the named fit as it is, without a
  character's own values. Where nobody draws the plates it is passed over, and the console says so in a dev build.
- `__sdfGame.skeletonDiagnostics()` reports `skull` (the page's: `'anatomical'` only when every humanoid draws the
  plates), `anatomical` (who draws them, with the fit's name), `skullFits` (every skull fitted since boot and what
  it cost) and `skullAssetMs`. `__sdfGame.skullFit(id)` gives one actor's fit, its box, the head it was sized to,
  its orbits and eye seats. `__sdfGame.meshEyes(id)` gives the eyes as drawn.

## The fit of each: "properly filled"

The table in the code is `skeleton-spike/skull-cast.ts` `BALL_HEADS`; `skull-cast.test.ts` makes each fit again on
the shipped asset and the character's own body and holds these numbers.

All eight are `snug` (both stages of the fit to the flesh: sized and placed, then pulled in where it would come
within 6 mm of the skin), with two things the named fit does not have:

- **The orbits are held on an eye line of the face**, not on the one read off the bone envelope. The bone says
  nothing of where these faces are: the female's envelope reaches up into her bun, and under plain `snug` her skull
  sat 47 mm high and dented her forehead; the cultists' ember eyes are 28 mm over their bone's line. The eye line is
  the painted eyes' height in the face sheet's own frame (`eyeHs`): for a face sheet, the eyes' row in the image put
  through the sheet's projection; for the cultists, whose eyes are prims, the ember prims' height.
- **It is fitted to the skin** (`skin`): the head's flesh without its painted prims. Three of these heads have hair
  modelled as ordinary prims (the schoolgirl's bob, the female's bun and cap), and the fit took it for head.

| Character | Sculpted bone (before) | Fitted skull, wide x tall x deep | Share of the head, wide / deep | Least flesh over it | Orbits against the painted eyes | Eye radius | Fit, in the browser |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cultist | 78 mm wide: two balls | 137 x 206 x 190 mm | 0.85 / 0.81 | 6.1 mm | level (0.9 mm under) | 18.4 mm | 74 to 105 ms |
| cultist-cowled | 78 mm: two balls | 138 x 202 x 188 mm | 0.85 / 0.796 | 6.1 mm | level (0.8 mm under) | 18.3 mm | 69 ms |
| bride | 112 mm: an egg and a nub | 128 x 204 x 164 mm | 0.90 / 0.90 | 6.5 mm | level (1.1 mm under) | 18.0 mm | 63 ms |
| female | 52 mm: six beads | 103 x 140 x 125 mm | 0.82 / 0.83 | 6.1 mm | level (1.0 mm under) | 13.1 mm | 57 ms |
| schoolgirl | 72 mm: a lump and beads | 126 x 168 x 156 mm | 0.85 / 0.83 | 6.3 mm | **66 mm over them** | 15.5 mm | 46 ms |
| schoolgirl-alt | 66 mm: the same | 114 x 152 x 139 mm | 0.83 / 0.82 | 6.1 mm | **49 mm over them** | 13.9 mm | 42 ms (Node; she cannot be spawned) |
| schoolgirl-described | 56 mm: three beads | 110 x 147 x 137 mm | 0.81 / **0.75** | 6.3 mm | **21 mm over them** | 14.9 mm | 45 ms |
| bonewalker | 48 mm: two beads | 92 x 141 x 135 mm | **0.75 / 0.68** | 6.0 mm | level (0.9 mm under) | 13.3 mm | 53 ms |

"Share of the head" is the skull's box over the skin head as the fit measures it through its deepest point. Under
the envelope fit, which is what these characters drew while the anatomical skull was the default, the same skulls
were 63, 63, 109, 43, 58, 54, 47 and 39 mm wide.

Where a number is short of what was asked (0.8 of the head each way, orbits level with the painted eyes):

- **The three schoolgirls' orbits are not on their painted eyes, and cannot be.** Theirs is a cartoon's face, small
  and low on a tall head: the painted eyes are 25 mm (schoolgirl) to 60 mm over the bottom of the chin, under
  200 mm of cranium, and a human skull has its orbits at mid height. Held on those eyes the skull is 47 mm wide on
  the schoolgirl and 76 mm on the described one, a quarter to a half of the head. So each is held at the lowest eye
  line where it still fills 0.8 of the head's width, and the orbits stand over the painted eyes by what the table
  says. The described one gives up depth for it (0.75).
- **The cowled cultist is 0.796 deep**, a hair under 0.8: his head is 236 mm deep under the cowl.
- **The bonewalker is 0.75 wide and 0.68 deep.** His head is 122 mm wide and 198 mm deep, with a muzzle, and his
  eyes are high under the horns. At that eye line the temples bound the width, and a skull's proportions (no axis
  scaled more than 1.15 times another) keep it from reaching down the muzzle. `tight` (3 mm of cover) would give
  0.79 / 0.72.
- `tight` was not taken for anyone: it fills 3 to 6 points more and leaves 3 mm of cover over broad parts of the
  cranium.

The fit never shrank the skull after its passes, turned nothing inside out (least local volume 0.45 to 0.70 of the
original), and moved no vertex more than 17.3 mm (the cultist; 5.8 to 14.4 on the others).

## The eyes

On a skull fitted to the flesh the eyes are seated in the fitted skull's own orbits and sized from them: 1.13 times
the mean radius of its two orbits (`skull-orbits.ts` `ORBIT_EYE_SIZE`: the zombie's 19.1 mm eye in its 16.9 mm
anatomical orbits, where the seats were tuned). The orbits are found on the plates as fitted, by rasterising them
from the front and taking the two largest closed basins, so they follow whatever the fit did to the skull. The
seated eyes, a split head's copies and the ejected eyes all come from the one answer (`mesh-renderer.ts`
`eyeSeats`).

The zombie's and the soldier's seats did not change: they draw the sculpted skull, and its seats are
`mesh-eyes.ts`'s as before (the pins hold, and the head-split gate predicts their eyes from those seats, unchanged).
A head on the ENVELOPE fit also keeps the sculpted skull's seats: `?skull=anatomical` is as it was, eyes included.

**This was ported, not written here.** Another session built the orbit seats on the anatomical skull's branch and
closed with the work uncommitted in its worktree (`.claude/worktrees/epic-goodall-fcf8af`, branch
`claude/anatomical-eye-seats`, cut from `3e9ae1de`). Taken from it by hand: `skull-orbits.ts` and its test (as they
were, plus the eye's size from the orbit), the renderer's single `eyeSeats`, `FittedSkull.orbits` and `eyes`, the
seam `__sdfGame.meshEyes(id)` and its test, and `anatomical-eyes.test.ts` (rewritten for the fits of this branch).
What differs from that work: there the orbit seats replaced the sculpted seats on EVERY anatomical head, the
envelope fit's included, and the eye kept the radius the bone's box gave it. Not taken: its capture gate
(`scripts/anatomical-eyes-gate.mjs`, 67 checks; the checks it made that matter here are made on the cultist in the
head-burst gate), and its refusal to load an asset whose front view does not hold two orbits.

## When the fit runs, and what the plates cost

- **The fit runs when a character's skeleton sources are built**: at spawn, and again for a body a sever re-derived
  (`game-skeleton-actors.ts` `buildSkeletonSources`). It is made once per head revision and kept, so the second
  cultist of a level costs nothing. Before, a fitted skull was made in the frame its bone first showed. In the
  browser the fits took 45 to 105 ms each (the table; the cultist's read 74, 76, 100 and 105 ms over four boots).
- **The plates' asset is loaded by every page on which somebody may draw it**, which by default is now every page
  (`anatomical-skull.glb`, 1.3 MB). Before, only `?skull=anatomical` asked for it. `?skull=sculpt` and `?sculpt=`
  pages still do not. The boot waits for it: 26 ms on the head-burst gate's cultist boot, from the local dev server (request, parse and
  the kit's making). On a real network that is the time of a 1.3 MB download added to every boot.
- **If it does not load, the boot goes on.** A failed request, a bad asset, or no answer in 8 s
  (`SKULL_ASSET_WAIT_MS`): every character draws its sculpted bone (the eight show their balls), and the console
  says so once, in any build. Tested with a loader that fails and one that never answers; not tried by blocking the
  request in a browser.

## Shots and the pop

Checked on a cultist in the head-burst gate (its new boot, `?spawn=cultist`): real pellet volleys at his face broke
the frontal plate off the fitted skull on the second volley, thrown as a plate; his head's pop released all
fourteen plates; and the sculpted skull's fragment cut never ran for him. (`fractureSkull` and `explodeSkull` ask
the kit per head, so a character either has plates or has the sculpted fragments.)

## What still looks wrong, plainly

Judged on the sheet's tiles and on larger crops of them.

- **The schoolgirl and the described schoolgirl.** The skull's face is too high in the head: on the schoolgirl its
  orbits are at her fringe and its teeth are behind her painted eyes; on the described one the orbits are at her
  brows. With the face shot away a skull shows in the head, the right size for the head and in the wrong place for
  the face. It is better than two beads and it is not right. Her painted face is itself laid low on the head (the
  sheet's mouth falls off her chin), which is the character's, not the skull's.
- **schoolgirl-alt was not seen at all.** She cannot be spawned (`createZombieActor` throws "no motion joints").
  Her fit is made and held by the test; nobody has looked at it.
- **The bride was judged on numbers and bare bone only.** Her flesh is not drawn when she is spawned with
  `?spawn=bride` (it was not before this work either; the fit's notes found the same). Her "flesh half see-through"
  and "face shot away" tiles are bone alone.
- **The bonewalker's skull is small between his horns** and ends above the big teeth of his painted face. In play
  his head is 1.20 m up and seen from above; the shipped tiles show the top of his cranium.
- **The female's skull is small against her whole head**, hair included (103 mm in a head 127 mm wide at the hair),
  and right against her face: orbits on her eyes, jaw at her chin, no dent.
- **The cultists read right**: the skull fills the hood's head and the embers sit in the orbits.
- **Hair is meat.** Hair modelled as prims is flesh to the wound system. The skull stays out of it now, so a shot
  through the schoolgirl's bob goes through 2 to 5 cm of red before bone.
- The eyes of every fitted skull are the same rose ball the sculpted skulls have, 13 to 18 mm in radius.

## The gates

| Gate | Before this part | Now | What changed |
| --- | --- | --- | --- |
| `scripts/head-burst-gate.mjs` | 90 checks, 0 failed | 103, 0 failed | A sixth boot, `?spawn=cultist`, with 13 checks (CU). Nothing else. |
| `scripts/head-split-gate.mjs` | 111, 0 failed | 111, 0 failed | Not edited. |
| `scripts/axe-gate.mjs` | 29, 0 failed | 29, 0 failed | Not edited. |
| `scripts/cut-wound-gate.mjs` | 33, 0 failed | 33, 0 failed | Not edited. |

CU's checks: the page lists the eight (and nobody else) as drawing the plates, the cultist under his fit; his skull
was fitted once, as the cast was spawned; the asset was loaded inside the boot's wait; the fit is `snug`, to the
skin, on his ember eyes' line; its box fills 0.848 of his head across and 0.808 front to back (the table's 0.85
and 0.81, both 0.8 or more); the orbits are 0.88 mm from the embers' line (within 2 mm); the head is drawn on the
plates' material; the two eyes are drawn at the fitted skull's own seats, inside their orbits and sized from them;
pellets break a plate off; the head stays on; the pop releases fourteen plates; every fragment is a plate and no
sculpted fragment was cut.

No gate expectation changed in this part. Unit tests whose expectation changed, each because the default page now
draws the plates on the eight:

| Test | Old | New |
| --- | --- | --- |
| `sculpt-renderer.test.ts`, the page's cache for no skull parameter | no kit | the kit (the plates are loaded); `?skull=sculpt` has none |
| the same file, "the plates are not loaded unless the page asks" | 0 loads for `''`, `?skull=nonsense` | 1 load each; 0 for `?skull=sculpt` and every `?sculpt=` |
| the same file, the failed load | one line, for `?skull=anatomical` | one line for any page that would draw the plates, said in any build |
| `sculpt-variant.test.ts`, whole-choice comparisons | the choice is `{ skull, variant, recipe, notes }` | the same four compared, and `anatomical` (who draws the plates) tested on its own for every combination |
| `anatomical-skull-fit.test.ts`, `?skullfit=` | read by `skullFitOf`, an unknown value warned on the console | read by `resolveSkull`, an unknown value is one of its notes |

The zombie's and the soldier's default pins (`sculpt-default-pin.test.ts`) did not move, and are now also checked on
the default page's cache with the plates loaded: the kit fits nothing for either.

Also run on the final code: `npx tsc --noEmit` (no error), `npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike`
(29 files, 761 tests) and `npm run test:changed` (58 files, 1,324 tests, 1 skipped).

## Not verified

- **Night Train, and live play.** The cultist is the one of the eight a level spawns; he was looked at on the ring
  page with `?spawn=cultist`, frozen. No level was booted with the new default.
- Frame time. A cultist's exposed skull is 9,947 triangles where his two balls were 972.
- A fitted skull when the head turns: the fit is made against the flesh at rest (the head's own rigid flesh, so it
  should hold; not measured in a posed head).
- `?skullfit=<name>` on a real page for the eight (the resolver and the kit are unit tested; the page was not booted
  with it).
- The asset failing in a browser.
- The eight under the head split: only the plain zombie splits.

## Code

| File | What |
| --- | --- |
| `skeleton-spike/skull-cast.ts` | The eight, each with its fit and what it measures. |
| `skeleton-spike/sculpt-variant.ts` | `resolveSkull`: who draws the plates, under which fit; `?skullfit=`. |
| `skeleton-spike/sculpt-cache.ts` | Loads the kit with the plan; the wait; the fallback. |
| `skeleton-spike/anatomical-skull.ts` | The kit fits by plan; a skull fitted to the flesh carries its orbits and eye seats. |
| `skeleton-spike/skull-fit.ts`, `head-flesh.ts` | The fit (merged from `claude/anatomical-skull-fit`); a character's own values (`SkullFitSpec`); the skin; the face sheet's frame. |
| `skeleton-spike/skull-orbits.ts` | The orbits and the eye seats (ported). |
| `game-skeleton-actors.ts` | The fit is made as the sources are built. |
| `scripts/ball-heads-look.mjs`, `scripts/ball-heads-sheet.py` | The sheet. |

To remake the sheet (own servers, headless):

```
node scripts/ball-heads-look.mjs <vite port> <cdp port> <frames dir>
python3 scripts/ball-heads-sheet.py <frames dir> docs/dev-notes/2026-10-07-sculpt-skull-2/look/ball-heads-anatomical.jpg
```

---

# The slug's split is a reward for a precise shot at close to medium range (2026-10-07, second playtest)

The owner played the rules of the last part of this file and said: "the frontal slug shouldn't always open up the
head: it should have to be a very precise hit. Also it should only happen at like medium to close range."

## What was wrong

A slug split a zombie's head when the slug's own line passed within 1.25 head radii of the head's centre. That is
nearly every slug that lands on a head. It had to be that loose: the slug leaves from the muzzle, beside and under
the eye, and lands about 10 cm under the crosshair, so with the crosshair dead on the head's centre the slug's line
runs 0.9 to 1.0 head radii off. Where the slug went said almost nothing about how well the shot was aimed. And the
split usually opened one half only, because the split was laid through where the slug landed.

## The rule now

`head-burst.ts` `headShotRule`, wired in `webgpu/game-head-shot.ts`. A slug that lands on a zombie's head:

1. **Splits the head when the AIM was precise and the head was in range.** As the gun fires, the slug records the eye
   and the crosshair's ray (the reticle's, under free aim): `game-weapon-rig.ts` `launchSlug`, carried on the slug's
   provenance (`damage.ts` `ShotAim`). When the slug lands, the shot is **precise** if that ray passes within
   `splitFrac` head radii of the head's centre, and **in range** if the head is within `splitRangeM` of that eye.
   Where the slug itself lands decides nothing.
2. **Opens both halves.** The split is laid on the head's middle line, not through the slug's impact, so a precise
   slug from the front always parts the head left and right, 0.55 rad a half. From the side it takes the face off,
   as before, where the slug landed.
3. **Is an ordinary slug wound otherwise**: an imprecise slug, a precise one from too far, a slug with no recorded aim.
4. **Pops a head that is already split wide, with no precision asked.** A head split to half its full angle or more
   (`popSplitMin`; the slug's own split and the axe's first chop both count) is a wide-open target: any slug that
   lands on it from within `splitRangeM` pops it. From farther it is an ordinary wound on the open head.

Pellets are ordinary wounds, as before. The slug that cuts the head off still pops it, from any range.

## The numbers

| Tuning (`burstTuning`) | Ships | What it is |
| --- | --- | --- |
| `splitAim` | `'crosshair'` | What precision is measured on. `'slug'` is the old measure, the slug's own line. |
| `splitFrac` | `0.3` | Precise: the crosshair's ray within this many head radii of the head's centre. 3.3 cm on the zombie, whose head radius is 10.9 cm. |
| `splitRangeM` | `5` | In range: the head within this many metres of the eye at firing. 0 or less: no limit. |
| `popPrecise` | `false` | `true`: the slug that pops a split head must be precise as well. |
| `popSplitMin` | `0.5` | Unchanged: how wide a split must stand for a slug to pop it. |

**What 0.3 means on screen.** Measured in the running game (`__sdfGame.flail.toScreen`, the lens included), in the
game's 800 x 600 picture at the default field of view (58 degrees drawn, 46 at the centre of the lens). The precise
zone is a disc on the head: 0.3 of the head's own radius at every range, 9% of the head's disc.

| Range | The head's radius | The precise zone's radius | The zone across | Mouse counts from its centre to its edge (mouse look, 0.0022 rad a count) |
| --- | --- | --- | --- | --- |
| 1 m | 76.5 px | 23.1 px | 46 px | 14.9 |
| 2 m | 38.5 px | 11.6 px | 23 px | 7.4 |
| 3 m | 25.7 px | 7.7 px | 15 px | 5.0 |
| 4 m | 19.3 px | 5.8 px | 12 px | 3.7 |
| 5 m (the limit) | 15.4 px | 4.6 px | 9 px | 3.0 |
| 6 m (out of range) | 12.8 px | 3.9 px | 8 px | 2.5 |

At 0.25 the zone's radius would be 19.3, 9.6, 6.4, 4.8 and 3.9 px at 1 to 5 m; at 0.2, 15.4, 7.7, 5.1, 3.9 and
3.1 px. 0.3 was kept: on the face it is the crosshair between the eyes or on the bridge of the nose, and at 4 to
5 m it is already a target 9 to 12 pixels across that the mouse holds within 3 or 4 counts. A tighter zone is under
8 pixels across at the edge of the range.

**Why 5 m.** Night Train's carriages are 3.4 to 4.2 m wide and 10 to 18 m long (two rooms are 8 m wide); the ring
testbed's rooms are 8 m square. Zombies close to arm's length, so the gun is used from the length of a carriage down
to nothing. 5 m is a little more than a carriage's width and about a third of its length: a zombie that has come
into the nearer part of the room. It is also where the precise zone falls under 10 pixels across; past it a
"very precise" aim stops being something a player does on purpose. A slug takes 0.17 s to fly 5 m.

Aimed slugs on frozen zombies, the crosshair on the head's centre from in front of the face
(`.lab-tmp` probe, one zombie per range): at 1, 2 and 4 m the head split, both halves; at 5.00 m (a hair over the
limit) and at 6 m the slug was an ordinary wound. The slug's own line ran 0.94 to 1.25 head radii off in all five.

## What to know before playing it

- **The shot is judged against where the head is when the slug arrives**, not where it was at the trigger. The
  slug flies at 30 m/s: 0.07 s to 2 m, 0.17 s to 5 m. A zombie walking across the line of fire has to be led; one
  walking at the player hardly moves off the ray. A zombie's head sways as it walks. Every number above is from
  frozen zombies: in play the split will be rarer than they suggest. If it is too rare, `splitFrac` is the knob.
- **Precision is where the crosshair is, with the slug landing somewhere else.** A precise shot between the eyes
  lands its slug on the chin. If the head moves between the trigger and the impact so that the slug misses the head,
  nothing splits, however good the aim.
- **The pop is easier than before on a split head** (no centring at all, where it needed the slug's line within
  1.25 radii), and now has a range.
- **A slug put in flight by hand** (`__sdfGame.slugFrom`, a gate's tool) records its own line as its aim. A slug
  with no recorded aim at all never splits or pops a head under `splitAim: 'crosshair'`.

**To put the old slug split back:** `__sdfGame.head.burstTune({ splitAim: 'slug', splitFrac: 1.25, splitRangeM: 0, popPrecise: true })`.
`__sdfGame.head.shot(id)` says what the rule made of the last round on a head, with the aim it was judged on
(`aimOffset` in head radii, `rangeM`) beside the slug's own line (`offset`). `__sdfGame.aimRay()` reads the eye and
the crosshair's ray a slug fired now would record.

## The gate

`scripts/head-burst-gate.mjs`: 80 checks before, 90 now, 0 failed. Its rules boot used to SOLVE a stance that put
the slug's line where it wanted. It now lays the crosshair, from in front of the face, and fires; every scenario
checks that the aim the leaf judged is the crosshair's ray read off the page before the shot. The whole rules boot
runs on the shipped tuning (it used to lower `splitFrac` to 0.35 to stage an off-centre slug).

| Scenario | Before | Now |
| --- | --- | --- |
| AIM | Crosshair on the centre: the slug's line is 0.5 to 1.25 radii off, inside the shipped `splitFrac` 1.25, and it splits. | The same shot. The recorded aim passes through the centre from 2 m (precise, in range); the slug's own line is still over 0.5 radii off, and decides nothing; it splits, and BOTH halves open on the middle line. |
| O | `splitFrac` 0.35; the slug's line laid 7 cm beside the centre: ordinary. | Shipped tuning; the crosshair laid 6 cm over the centre (0.55 radii, imprecise): ordinary, one slug crater. Its own line (0.42 radii) ran nearer the centre than AIM's. |
| FAR (new) | | The crosshair on the centre from 6 m (precise, out of range): ordinary, one slug crater. |
| S | `splitFrac` 0.35; the slug's line laid through the centre: splits, both halves or the one the slug landed on. | Shipped tuning; the crosshair laid 2 cm to one side of the centre (precise; farther off the middle line than a chop may be to open both halves): splits, and both halves are required: the two-sided angle, the pose turned both ways, the skull's three clipped copies, the field open on both sides, two cut faces. |
| X | A second slug laid through the centre pops the split head. | A slug with the crosshair 6 cm over the centre (imprecise, in range) pops it. |
| OFF | The slug's line laid through the centre, `on: false`: ordinary. | The crosshair on the centre, `on: false`: ordinary. |
| SA, XA (the plates) | As S and X, `splitFrac` 0.35. | As S and X now, shipped tuning; SA requires both halves. |

Expectations that changed:

| Check | Old | New | Why |
| --- | --- | --- | --- |
| AIM: the measure the split is granted on | the slug's line, over 0.5 and under 1.25 head radii | the aim, under 0.3 head radii, within 5 m; the slug's line still over 0.5 | Precision is the crosshair's now. |
| O: what makes the slug ordinary | its line at or over 0.35 radii (a lowered `splitFrac`) | its aim at or over 0.3 radii (the shipped `splitFrac`) | The same. |
| S, SA: which halves | both, or the one the slug landed on | both | The split is laid on the middle line. This is stricter. |
| S: where the field is open | on the turned half's side | on both sides (one check became two) | The same. |
| X, XA: the slug that pops | its line through the centre | any slug in range; the gate fires an imprecise one | The second stage needs no precision. |
| The stance of AIM, O, S, X, OFF, SA, XA | toward the room's centre from the head | straight in front of the face | The middle preset is the split of a shot from the front. With a zombie more in the pool (FAR), S's zombie stood side-on to the room's centre and took the face preset, as the rule says it should. |

No bound was loosened. The opening's boot, the decapitation boots and the pellet scenario are untouched. The
head-split gate's H scenario (a slug at a head forced a quarter open is an ordinary wound) passes unchanged: a head
only cracked takes any slug as an ordinary wound.

## Not verified

- Live play. A moving zombie, a walking player and free aim's dead zone were not tried; the numbers are frozen
  zombies' and a centred reticle's.
- Free aim's sensitivity in mouse counts (the table's counts are mouse look's).
- `scripts/head-burst-look.mjs` had its two slug scenes changed to aim (a precise slug for `slug-split`, an imprecise
  one for `slug-chin`) and was not run again; the sheet `look/burst-before-after.jpg` is the earlier rules'.

---

# The decision: the sculpted skull is the default

## The decision

The owner playtested both skulls and the variants below on 2026-10-07 and decided: the sculpted skull is the base
("fits and reads best"), in the variant `full` ("I like FULL"), and "make full and old skull the default". The
anatomical skull stays in the game behind a switch.

Until then a page with no skull parameter drew the anatomical skull (since 2026-10-06), and `?skull=sculpt` drew the
sculpted skull in its first look.

## What a page draws

One function decides: `resolveSkull` in `skeleton-spike/sculpt-variant.ts`. `skeleton-spike/sculpt-cache.ts` builds
the bone cache it asks for.

| The page's query | Skull | What that is |
| --- | --- | --- |
| no `skull`, no `sculpt` | sculpted, `full` | The second sculpt of the head at a 5 mm cell, under the second paint. |
| `?skull=sculpt` | sculpted, `full` | The same. `full` is the sculpted skull's look now. |
| `?skull=anatomical` | anatomical | The 14 plates, as the default was from 2026-10-06 to 2026-10-07. Every other bone is drawn as it was then (the first paint). |
| `?sculpt=classic` | sculpted, `classic` | The first look: the first sculpt at the 1 cm cell under the first paint. This is what `?skull=sculpt` drew before. |
| `?sculpt=shape`, `shape-fine`, `paint` | sculpted, that variant | The variants of the first sheets, unchanged. |
| `?sculpt=full-1cm` | sculpted, `full-1cm` | `full` with the head at the 1 cm cell (see "The head's cell"). |
| `?sculpt=full` | sculpted, `full` | The default, named. |
| `?sculpt=<variant>&skull=anatomical` | sculpted, that variant | A known `?sculpt=` asks for the sculpted skull and overrules `?skull=anatomical`. The console says so. |
| `?sculptheads=all` | sculpted | The variant's paint on every character, fitted or not (see "The characters that are not carved"). For looking; nothing ships with it. |
| an unknown `?skull=` or `?sculpt=` value | as if it were not there | The value is passed over. In a dev build the console says so once, naming the value and the values that exist. |

- `?skull=procedural` is an older name for `?skull=sculpt` and still works.
- The anatomical skull is an asset. If it does not load, the page draws the default sculpted skull and the console
  says so. A page that does not ask for it no longer requests the asset (`anatomical-skull.glb`, 1.3 MB): checked in
  the browser, 0 requests on the default page and with `?sculpt=classic`, 1 with `?skull=anatomical`. The console
  lines for an unknown or overruled value were read in the browser too.
- `?skeleton=procedural`, the deferred renderer and bones in detached chunks are untouched: they never drew either
  mesh skull.
- `__sdfGame.skeletonDiagnostics()` reports the skull in force (`skull`), the recipe in force (`sculpt`: which sculpt,
  the head's cell, which paint) and the variant that recipe is (`sculptVariant`). `__sdfGame.skullDrawn(id)` says, for
  each bone an actor draws, whether it is the head and which paint its material draws.

Night Train with each: `/sdf-game.html?level=night-train` (the default), `...&skull=anatomical`, `...&sculpt=classic`.

## The pins

`skeleton-spike/sculpt-default-pin.test.ts` pins two looks by hash, so a change to either is made on purpose:

| Look | Zombie's head mesh | Soldier's head mesh | Paint's shader text |
| --- | --- | --- | --- |
| The default (`full`) | 9,144 vertices, 18,296 triangles, `44f3c7f58b87817c` | 7,056 vertices, 14,108 triangles, `f470bb51944b39b1` | `61ebace5c3abd470` (the second paint, written for the second sculpt) |
| The first look (`classic`) | 2,220 vertices, 4,448 triangles, `492f9fb76d46f916` | 1,686 vertices, 3,392 triangles, `4eef1460c3417114` | `8232c6723fa94dba` (the first paint) |

The first look's hashes are the ones taken before the variants existed (`f127e868`); they did not move. They are
reached through `?sculpt=classic`, and through a bone cache built with no recipe, which is what the unit tests build.
The default's hashes are checked on the page's own cache for a query that names no skull.

## The head's cell: 1 cm against 5 mm

`full` extracts the two carved heads at a 5 mm cell. The first report could not tell 1 cm from 5 mm in shipped frames
under the old paint, and `full` at 1 cm had never been shot. It is `?sculpt=full-1cm` now, and this is the pair:
[`look/cell-1cm-5mm.jpg`](look/cell-1cm-5mm.jpg). Top row 1 cm, bottom row 5 mm; the soldier with his face shot
away (the same 18 wounds in both, 8 on the head) and the zombie's bare skull, each as the game ships from 2.5 m and
from 1 m, and clean from 0.6 m.

**5 mm stays the default**: it is what the owner played and approved. What the pair shows:

- **As the game ships, from 2.5 m: no difference** in either scene.
- **As the game ships, from 1 m: no difference on the soldier.** On the zombie's bare skull the frame of bone round
  the upper teeth is a little sharper at 5 mm. It takes the two tiles side by side to find it.
- **Clean, from 0.6 m: 5 mm is crisper.** The orbit rims, the edge of the upper jaw and the lower tooth arch have hard
  edges at 5 mm and rounded ones at 1 cm. At 1 cm the lower jaw's rising branches melt into the cheek.
- **The zombie's "boxed" mouth is softer at 1 cm.** The first notes called the 5 mm mouth a little mechanical seen
  straight on. The coarser cell rounds that box off. Some may prefer it.
- From three-quarter at 5 mm the cheekbone's lower edge and the orbit's outer rim show small ragged steps. At 1 cm
  they are smooth.

What 5 mm costs:

| | 1 cm (`full-1cm`) | 5 mm (`full`) | Difference |
| --- | --- | --- | --- |
| Zombie's head, triangles | 4,496 | 18,296 | 4.1 times |
| Soldier's head, triangles | 3,460 | 14,108 | 4.1 times |
| Zombie's head, extraction (Node, median of 7, first notes) | 65 ms | 219 ms | +154 ms |
| Soldier's head, extraction (the same) | 45 ms | 188 ms | +143 ms |
| Ring page, all bone extraction at boot, in the browser | 954 ms | 1,111 ms | +157 ms |
| Ring page with every zombie slot a soldier, the same | 379 ms | 446 ms | +67 ms |
| Triangles in the bone cache, ring page | 180,620 | 205,068 | +24,448 (one zombie head, one soldier head) |

The browser rows are one boot each (`__sdfGame.skeletonMesh().cacheStats.extractMs`), and the largest single
extraction of the ring page, a zombie torso segment, varied by 33 ms between the two boots: read them as "about a
tenth of a second, once". The cost is paid once per carved character at boot, not per actor. Every zombie whose
skull shows draws the 18,296 triangles. Frame time in a crowd of exposed skulls was not measured at either cell.

For the owner: 5 mm buys crisp edges that show at 0.6 m and closer. If the softer mouth at 1 cm is preferred, or
the boot time matters, `full-1cm` is one word in `SCULPT_DEFAULT_VARIANT`; the pin test then needs the new hashes.

## The characters that are not carved

Only the zombie and the soldier have the second sculpt. Every other character's head is its plain authored bone,
and a paint draws a face on it at fixed places of the bone's box. Under `full` as it was built, the second paint was
drawn on every head. This is each humanoid's bare head bone, front and three-quarter:
[`look/cast-bare-heads.jpg`](look/cast-bare-heads.jpg). Columns: the first look; the second paint on every head
(`?sculptheads=all`); the default as it ships; the anatomical skull.

The rule that came out of it (`sculpt-variant.ts` `SECOND_PAINT_CHARACTERS` and `sculptPaintOf`, tested): the second
paint is drawn on the characters it has been looked at on and fits. Every other character, a new one included, keeps
the first paint, and so is drawn exactly as `classic` draws it. The renderer builds both paints' bone materials and
puts each character's bones on its own.

| Character | Head bone (its width at its widest, and its shape) | Under the second paint | The default draws |
| --- | --- | --- | --- |
| zombie | 166 mm, carved by the second sculpt | The look the owner approved. | second paint |
| soldier | 148 mm, carved by the second sculpt | The look the owner approved. | second paint |
| juggernaut | 170 mm: the soldier's bone, larger, not carved (a ball over a jaw) | The orbits ring the eyes; the two tooth rows lie either side of the crease between the ball and the jaw; the nose sits between. It reads as a skull, and better than the first paint's flat wide teeth. It is still a face painted on a ball: no brow, no cheekbones. | second paint |
| clown, clown-alt | 176 mm: one round mass | The whole face is on the ball, the orbits round the eyes, a wide grin of separate teeth. Cleaner than the first paint, whose cheek sockets read as two rouge spots. A face painted on a ball, as it was. | second paint |
| cultist | 78 mm: a ball over a separate jaw ball | The eyes sit at the bottom of the upper ball and the teeth on the lower ball, under either paint. The second paint adds a dark outline high on the upper ball. Neither is a skull. | first paint |
| cultist-cowled | 78 mm: a ball over a jaw ball | The same two balls, joined. Teeth on the lower ball under either paint. | first paint |
| bride | 112 mm: an egg, with a nub 26 mm wide hanging under it | Sockets and nose sit on the egg. The teeth fall on the egg's bottom tip and on the nub. No gain over the first paint. | first paint |
| female | 52 mm: a column of beads (six primitives) | The face is spread over three beads under either paint. | first paint |
| schoolgirl | 72 mm: a lump with a muzzle, beads under it | The sockets are on the muzzle, the teeth on a bead below. | first paint |
| schoolgirl-described | 56 mm: three beads | The same. | first paint |
| bonewalker | 48 mm: two beads 4 cm apart | There is no face to paint on. | first paint |
| schoolgirl-alt | 66 mm: as the schoolgirl | Not photographed: the character cannot be spawned (`createZombieActor` throws "no motion joints"; `?spawn=schoolgirl-alt` stops the boot). Its bone has the schoolgirl's shape. | first paint |

Said plainly:

- **Eight of the thirteen humanoids have no skull under the sculpted skull.** Their head bones were authored as a
  few small balls for the SDF bone tubes, not as a skull. With the anatomical skull as the default they drew a
  modelled skull fitted to that bone's box (narrow on the narrow ones: 43 mm wide on the female). With the sculpted
  skull as the default they draw the balls, with a face painted across them. That is worse than what they drew
  yesterday, under either paint, and the per-character paint rule does not fix it: it only keeps the second paint
  from adding to it.
- **Of those eight, the cultist is in the levels** (a level spawn kind). When his face is shot away, or his head
  pops, the player sees two balls. The other seven are not placed by any level today (`level-def.ts` `SpawnKind`
  has no kind for them); they are reachable with `?spawn=<name>`.
- **The juggernaut and the two clowns are a judgment.** The second paint sits on their bones and reads better than
  the first, so they are listed. They are not carved, so their skulls are round. To put one back on the first paint,
  take its name out of `SECOND_PAINT_CHARACTERS`.
- Characters that are not humanoids (the goblin, the ogre and the rest) were not looked at. They keep the first
  paint, which is what they drew under both earlier defaults: they never had the anatomical skull.

What would fix the eight, for the owner to choose: give them the anatomical skull per character (the page would
load its asset whenever one of them is in the cast); or author a skull-sized head bone for each and carve it, the
cultist first. Neither is done here. (Done since: the owner chose the first, and the eight draw a fitted anatomical
skull: the first part of this file. This part's table of what a page draws is as it was written; the first part's
replaces it.)

The photographs are level with each head. The game holds the player's eye 1.62 m up, so the clown (head 0.77 m up)
and the bonewalker (1.20 m) are only ever seen from above in play. For these frames the capture lowers the page's
own eye height; nothing in the game does.

## The pop and the head split on the default

Both existed for the sculpted skull and neither was changed. Checked on the default in the gates:

- **The head split** draws the sculpted head's own mesh as three clipped copies on the bone's split material, under
  the second paint: the painted face outside, the dark inner wall on back faces, the pale rim along the fracture.
  The halves carry their orbit and half the nose; the teeth stay on the piece below the hinge. It reads correctly at
  the three stages (the head-split gate's `M-skull` and `M-bone` sheets). The seated eyes show more than they did:
  with the bone drawn, the second sculpt's orbits leave 0.91 of each eye in sight from the front, against 0.51 on
  the first look (the gate's own measure, not held).
- **The pop** throws the ten named fragments, each on the split material of the head's own paint (the second, for a
  zombie), cut once per mesh.
  Photographed with the flesh out of the frame (`scripts/head-burst-look.mjs`, `QUERY='' SCENES=slug-pop`, the
  `pop-bare` frames): the pieces are curved shells, pale outside and dark inside, and the blood burst covers most of
  them for the first tenth of a second. The jaw pieces show their teeth in the frames where they face the camera.
  Nothing draws wrong.
- The cultist's pop, on his two balls, throws seven pieces (the regions that hold 12 triangles or more of a
  972-triangle head mesh). Not photographed.

## The gates

Each boot now says which skull it wants where it matters, and checks that it drew it. No bound was loosened.

| Gate | Checks before | Checks now | Boots and their skulls |
| --- | --- | --- | --- |
| `scripts/head-split-gate.mjs` | 100, 0 failed | 111, 0 failed | Seven. Five on the default (S, W, K, O, L, F, M, C; R, A, H; B twice; T, J). One on `?sculpt=classic` (M alone, on the first look). One on `?skull=anatomical` (M on the plates, then P). |
| `scripts/head-burst-gate.mjs` | 67, 0 failed | 80, 0 failed | Five. Three on the default (the rules; the opening; the pop, DS). Two on `?skull=anatomical` (D and D0; SA and XA). |
| `scripts/axe-gate.mjs` | 27, 0 failed | 29, 0 failed | Two, both on the default. |
| `scripts/cut-wound-gate.mjs` | 30, 0 failed | 33, 0 failed | Three, all on the default. |

"Before" is the tree at `74d1eafb`, run the same day on the same machine. No check was removed. The new checks:

- Every boot of every gate checks the skull it drew (`skeletonDiagnostics()`): 2 in the axe gate, 3 in the cut-wound
  gate, 5 in the head-burst gate. The head-split gate already had one check for all its boots.
- Head-split M, on each of its three skulls: every bone copy of the split head is the head's own mesh, under the
  paint that boot's recipe gives the zombie (3 checks). M used to run on two skulls and runs on three (8 more).
- Head-burst S: every copy is the sculpted head's mesh on the bone's split material under the second paint. DS:
  every fragment keeps the second paint. SA and XA (6 checks): S's skull check and X, made again on the plates.

Expectations that changed because the default skull changed:

| Gate, check | Before | Now | Why |
| --- | --- | --- | --- |
| Head-split, C: which skull each boot draws | Every boot anatomical, the `sculpt` boot sculpted. | Five boots `sculpt full`, the `classic` boot `sculpt classic`, the `anatomical` boot anatomical. | The default changed; the boots that need another skull ask for it. |
| Head-split, the sculpt boot's URL | `&skull=sculpt` | `&sculpt=classic` | `?skull=sculpt` is `full` now. The boot exists to draw the first sculpt and the first paint's split material, which no other boot draws. |
| Head-split, M on the default boot: the materials of the split copies and of the whole skull | `skeleton-plate-split`, `skeleton-plate` | `skeleton-bone-split`, `skeleton-bone` | The gate takes them from the skull the boot draws. The plates' are still checked, on the anatomical boot. |
| Head-split, M: the eye seats the landmark is predicted from | z = 34.3 mm in front of the head's centre | 35.3 mm on a boot whose cache carves the second sculpt; 34.3 mm on the other two | The second sculpt's orbits seat the eyes 1.0 mm further forward (computed from `mesh-eyes.ts` for both sculpts). |
| Head-split, M on the anatomical skull: the really chopped head | Measured on the first boot's zombie, between S, W and K. | Measured on a zombie chopped for the skull alone (`chopsForSkull`), as the sculpt boot always did. | That first boot draws the default now. The same four checks, the same bounds. |
| Head-split, P: where it runs | Last in the second boot, after R, A and H. | Last in the anatomical boot, on the same zombie (the pool's sixth). | P is about the plates. |
| Head-burst, D and D0: the boot | no skull parameter | `&skull=anatomical` | D checks that all 14 plates are released. |
| Head-burst, DS: the boot | `&sculpt=full` | no skull parameter | That is the default now. |
| Head-burst, X: the fragments a split head's pop throws | 13 measured (the plates; the splitting slug had knocked one off), bound at least 10 | 10 measured (the sculpted head's fragments), bound at least 10 | The default changed. The plates' pop of a split head is XA now, on the anatomical skull: 13 thrown, as before. |

No numeric bound moved. Measured values that moved, all inside their unchanged bounds:

- Head-split M on the default: each eye's shift on screen is at worst 0.51 px off its prediction on the forced head
  and 0.19 px after chop 1 (bound 2 px; the anatomical skull read 0.41 and 0.15 px as the default, and reads 0.27 and
  0.40 px on its own boot). All 27 points of the fracture's line are bone closed and none open (the anatomical
  skull: 25 of 27, 0).
- Head-split P's on-screen measure reads 0.89 (bound at least 0.8). It read 0.96 when P followed R, A and H: the
  frame is a screenshot and what stood in the room before it differs. The margin is thinner. P's other measures are
  the same to the digit (36.9 mm, 10.2 mm, 0.0000 mm).
- Cut-wound H (a cut across the face): the mean change of luma in the cut's band is 8.84 in one run and 8.91 in the
  next, and was 8.99 (bound at least 4). The bone in the cut is the sculpted skull's now.
- Every other measure of the axe and the cut-wound gates that is not a frame time is the same as before to the
  digit, but two that are not about the skull: the axe head's mean luma at rest read 80.0 in one run and 85.3 in
  the next on the same code (it was 80.0), and the bone share beside the turned zombie's slot moved in its fifth
  decimal. Frame times moved by run-to-run amounts and are not gated.

## Not verified

- Live play on Night Train with the new default. Everything above was staged on the ring page with a frozen cast.
- Frame time: nothing was timed. A zombie's exposed head is 18,296 triangles where the anatomical skull was 9,947.
- The soldier's and the juggernaut's skulls in a pop or a split: only the zombie splits, and only the zombie's pop
  runs in a gate.
- The non-humanoid characters' heads, under any paint.
- `schoolgirl-alt`, which cannot be spawned.

## Code

| File | What |
| --- | --- |
| `skeleton-spike/sculpt-variant.ts` | `resolveSkull` (the one place that decides), the variants and their recipes, the characters the second paint is fitted to. |
| `skeleton-spike/sculpt-cache.ts` | The game's bone cache for a query; says the resolver's notes in a dev console; loads the anatomical asset only when asked. |
| `skeleton-spike/mesh-renderer.ts` | Both paints' bone materials; each character's bones on its own paint's. |
| `skeleton-spike/sculpt-default-pin.test.ts` | The two pinned looks. |
| `webgpu/game-seams-skeleton.ts` | `skeletonDiagnostics()` (skull, recipe, variant), `skullDrawn()` (head, paint, character), `skullFragments()` (paint). |
| `scripts/sculpt-skull-cast-look.mjs`, `scripts/sculpt-skull-default-sheet.py` | The cast's photographs and the two sheets of this part. |

To remake the two sheets (own servers, headless):

```
COLS='classic,every-head,default,anatomical=&skull=anatomical' CAST=zombie,soldier,juggernaut,clown,clown-alt,cultist,cultist-cowled,bride,female,schoolgirl,schoolgirl-described,bonewalker \
  node scripts/sculpt-skull-cast-look.mjs <vite port> <cdp port> <cast frames dir>
python3 scripts/sculpt-skull-default-sheet.py cast <cast frames dir> docs/dev-notes/2026-10-07-sculpt-skull-2/look/cast-bare-heads.jpg
COLS=full-1cm,full SCENES=soldier-face,zombie-bare node scripts/sculpt-skull-look.mjs <vite port> <cdp port> <cell frames dir>
python3 scripts/sculpt-skull-default-sheet.py cell <cell frames dir> docs/dev-notes/2026-10-07-sculpt-skull-2/look/cell-1cm-5mm.jpg
```

---

# The sculpted skull, second pass: variants to choose from (2026-10-07)

This part was written before the owner picked. They picked `full`, and it is the default now (the part above). What
follows is as it was written, with the URLs brought up to date: "the old skull" and "the old paint" are the first
look, `?sculpt=classic`, which was `?skull=sculpt` then; the anatomical skull was the default then.

The owner playtested both skulls on 2026-10-07 and chose the sculpted skull as the base: it fills the head and reads
best in play. What bothers them about it, in their order: the jaw and the teeth, the shape of the eye sockets, the
nose opening, and the lack of a brow ridge, cheekbones and hollows. It is worst on the soldier with his face shot
away, where it looks cartoony rather than frightening.

This pass built four variants of a more anatomical sculpted skull, switchable by URL, and left the default
untouched.

## How to see them

Add `?sculpt=<name>` to the game's URL. It asks for the sculpted skull.

| URL (dev server, `npm run dev`) | What it is |
| --- | --- |
| `/sdf-game.html?level=night-train&sculpt=classic` | The sculpted skull as it was then: the reference, the sheets' boxed first column. |
| `/sdf-game.html?level=night-train&sculpt=shape` | New bone, meshed at the usual 1 cm cell, under the old paint. |
| `/sdf-game.html?level=night-train&sculpt=shape-fine` | The same bone meshed at a 5 mm cell for the head, under the old paint. |
| `/sdf-game.html?level=night-train&sculpt=paint` | The old bone under the new paint. |
| `/sdf-game.html?level=night-train&sculpt=full` | The new bone at 5 mm under the new paint. The default since. |

For a room of soldiers to shoot at, use the ring testbed: `/sdf-game.html?spawn=soldier`.
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
  `full` they got the new face painted on their plain bone. Reviewed since: the part above ("The characters that are
  not carved"); the new paint is now drawn only on the characters it fits.

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
  the head-split and head-burst gates ran only on the default skulls of the time, not on the variants. (They run on
  `full` now: the part above.)

## Code

| File | What |
| --- | --- |
| `skeleton-spike/sculpt-variant.ts` | The variants and their recipes: which sculpt, the head's cell, which paint. |
| `skeleton-spike/sculpt-cache.ts` | The game's bone cache for a URL. |
| `skeleton-spike/mesh-skull-2.ts` | The second sculpt and its landmark table. |
| `skeleton-spike/sculpt-paint.ts` | The second paint: TypeScript twins and the WGSL written from the same tables. |
| `skeleton-spike/mesh-skull.ts`, `mesh.ts`, `mesh-renderer.ts` | Take the recipe; the default path is unchanged. |
| `skeleton-spike/sculpt-default-pin.test.ts` | Pins the first look (and, since, the default): the zombie's and the soldier's head mesh bytes and the paint's shader text, by hash. The first look's hashes were taken from the tree before this work. |
| `scripts/sculpt-skull-look.mjs`, `scripts/sculpt-skull-sheet.py` | The photographs and the sheets. |

To remake the sheets (own servers, headless):

```
node scripts/sculpt-skull-look.mjs <vite port> <cdp port> <frames dir>
python3 scripts/sculpt-skull-sheet.py <frames dir> docs/dev-notes/2026-10-07-sculpt-skull-2/look
```

## If the owner picks

The owner picked `full`. Done since: it is the default, and `full` at 1 cm was shot (the part above). Still open
from the list below: soften the zombie's boxed mouth; seed the cracks per actor; the eyes.

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

---

# The gun and the zombie's head (2026-10-07, after the owner's playtest of `?sculpt=full`)

The owner shot zombies in the head with the gun (weapon slot 2, pellets) and reported four things: shooting the face
takes the flesh off the BACK of the head; the head is left comically skinny; the shot face looks flat, the skull does
not protrude; and after the head comes off there is sometimes a small piece floating over the neck stump. They also
said what they had wanted all along, which was not what the game was doing.

This part says what the game did, what caused each observation (measured), what it does now, and how to put any of
it back. The sheet is [`look/burst-before-after.jpg`](look/burst-before-after.jpg).

## The words: the owner's and the code's

| The owner says | The code calls it | What it is |
| --- | --- | --- |
| an ordinary wound | `ZombieActor.hit` (a pellet), `hitSlug` (a slug) | One crater, stamped where the round lands: 5.5 cm radius for a pellet, 16 cm for a slug. A carve in the flesh, an everted lip round it, bone showing where the carve reaches it. |
| decapitation, "the head flies off" | the sever checks (`game-actor.ts runSeverChecks`, `connectivity.ts cutLimbs` and `cutChains`) and `onSever` | The craters' carves, taken together, cut through the neck. The head cluster is severed and thrown as one flying piece, and a stump wound is stamped on the shoulders. |
| the pop: "the head balloons and explodes" | `ZombieActor.beginHeadPop`, `head-pop.ts`, the actor's `onHeadPop` (`game-spawn.ts`) | The head swells (`inflateHead`), then is severed with no flying piece. In its place: a burst of blood, two eyeballs and lumps of the head (`headPopDebris`), and the skull in pieces (`explodeSkull`). The cultist has had it since 2026-09-24. |
| the head split | the head split leaf (`game-head-split.ts`), opened by the axe | The head opens in two halves about a hinge and stays on. |
| (the owner did not know this one) | the "burst", now called the OPENING (`game-head-damage.ts burst`) | The slug head burst of 2026-10-02: an entry crater, an exit crater on the far side, a jelly stretch of the head, a dent, bone shards. The head stays on. |

**What the game did until today.** On 2026-10-03 the owner could not trigger the slug head burst and asked for it to
"trigger all the time" while tuning. Two debug switches were added and left on: `anyWeapon` (every gun hit on a head
makes the opening, pellets too, once per trigger pull) and `alwaysSplit` (every such hit takes the full opening,
however far off centre). So for four days every volley that touched a zombie's head stamped a 12 cm entry crater and
a 14 cm exit crater on a head 22 cm deep. That is what the owner saw; "burst" was never something they asked a
pellet to do.

(Later the same day the split was made a reward for a precise aim from close range, and it now opens both halves:
the first part of this file. Items 2 and 3 below, `splitFrac` 1.25 and "the slug's split is one-sided" are as this
part was written.)

**What a gun round does to a zombie's head now, in order** (`head-burst.ts headShotRule` and `decapitationRule`,
wired in `webgpu/game-head-shot.ts`):

1. **A pellet is always an ordinary wound.** So is a slug whose line runs off centre, and any round on the neck.
2. **A centred slug on a closed head splits it** through the head split leaf, exactly as the axe opens a head,
   straight to the preset's full angle. The split's plane holds the shot's direction and the head's up axis: a slug
   from the front parts the head left and right, one from the side takes the face. The zombie lives. How the head
   opens is the split's own rule, the axe's (`head-split.ts choosePreset`): a slug that lands within 15% of the
   head's radius of its middle line (about 2 cm) opens both halves, 0.55 rad each; one that lands farther to a side
   peels the smaller side alone, 0.9 rad, with the plane through where it landed.
3. **A centred slug on a head already split wide pops it.** Wide is half the split's full angle or more
   (`popSplitMin` 0.5): the slug's own split opens all the way and the axe's first chop to 0.8, so both count. A
   head only cracked takes the slug as an ordinary wound (the head-split gate fires a centred slug at a head opened
   a quarter of the way and expects exactly that).
4. **Ordinary wounds can still take the head off** (the sever checks, unchanged). If the round that cuts the neck
   is a slug, the head pops instead of flying off: it swells for 0.12 s and bursts. If it is a pellet volley, a
   blast or a blade, the head flies off as before.
5. The opening is off. It is still in the code, behind `burstTune({ opening: true })`.

Only the plain zombie has any of this, as before. A head the flail has already damaged cannot split (the head damage
leaf's regions and deform are measured on the closed head, and the split leaf refuses it, for the axe as well): a
centred slug on it is an ordinary slug wound, which can still take the head off and pop it. An earlier ordinary
wound, a pellet's or an off-centre slug's, leaves no such state: the next centred slug still splits.

## What caused the owner's observations

Everything below was measured on the ring testbed with real rounds from 2 m, `?sculpt=full`, with the old behaviour
put back by tuning (the sheet's "before" columns; `scripts/head-burst-look.mjs`, `OLD=1`).

**1. "Shooting the face removes the flesh on the back of the head."** The opening's exit crater. One pellet volley
with the crosshair on the head stamped two craters: an entry of 12 cm radius carved 9.9 cm deep, and on the far
side an exit of 14 cm radius carved 9.9 cm deep. The zombie's head is 22.5 cm from the tip of its nose to the back
of its skull, and the flesh over the back of the skull is 5 to 10 mm thick (median 9 mm). The exit crater takes all
of it: the bare cranium stands out behind the flesh in every profile tile of the "before" columns.

**2. "A skinny head."** Mostly the same two craters, a little the deform.

- After one volley the flesh left along the head's front-to-back axis is 71 mm thick, of 225 mm. After two volleys
  it is 62 mm, after three 52 mm. Seen from the side the head is a tall slab with a flat front. This is the owner's
  screenshot.
- The opening also deforms the head for good. From the front that is not what thins it: the head is stretched 3%
  along the shot (then 3% short of its length once the entry dent reaches its 4 cm cap on the second volley), and
  WIDENED 10% across. But each shot dents the side it enters by 3 cm, each of the head's six sides keeps its own
  dent up to 4 cm, and nothing undoes them. Volleys from the front, the left, the back and the right left the head at
  80% of its width and 79% of its depth, and a fifth volley from the front at 73% and 80%: shots from all round
  ratchet the head thin.

**3. "The face is flat, the skull should protrude more."** Three causes were possible. Two are ruled out, the third
is the one, and it has nothing to do with the opening:

- *The sculpt's face sits behind the old one's:* no. At the brow ridge, between the eyes, on the bridge of the nose
  and at the teeth the second sculpt's surface is the authored bone's own (0.0 mm apart, on the middle line; only the
  forehead above the brow ridge is sunk, by 8 mm).
- *The entry dent flattens the skull:* it moves the skull's face back 3 cm with the flesh (the skull takes the head's
  deform), but it does not flatten it, and with the opening off there is no dent at all.
- *The flesh round the wound stands in front of the bone:* yes, by centimetres, because of the wound's LIP. The
  skull's face lies 9 to 19 mm UNDER the skin (16 mm at the brow ridge, 9 mm between the eyes, 19 mm at the bridge
  of the nose, 12 mm at the upper teeth). A crater's everted lip is a ring of flesh the shader raises round it, and
  its height is a share of the crater's radius: 24 mm proud of the skin round a pellet crater, 40 mm round a
  slug's, 47 mm or more round the opening's torn 12 cm crater. From the front the bone shows at the bottom of the
  hole. From the side it sits 3 to 6 cm behind a wall of lip, and the lip is what the profile shows.
  With the opening the entry carve is also cut off flat (a crater's carve is a sphere clipped by a depth plane, here
  9.9 cm under the skin), which is the "flat red plane from brow to chin".

The change for this one is `headLip`: a gun crater on a zombie's head is stamped with 0.3 of the stock lip (7 mm on
a pellet crater, 12 mm on a slug's). Measured in profile pictures of the same staged shots, with the stock lip and
with 0.3, how far the skull's silhouette stands in front of the flesh's at each landmark's height (negative: the
flesh is in front):

| One pellet volley, crosshair on the head | brow ridge | between the eyes | bridge of the nose | upper teeth | lower teeth | chin |
| --- | --- | --- | --- | --- | --- | --- |
| stock lip | -13 mm | -10 mm | -18 mm | -38 mm | -29 mm | -16 mm |
| `headLip` 0.3 | -13 mm | -8 mm | -13 mm | -3 mm | +32 mm | 0 mm |

| One slug on the chin | brow ridge | between the eyes | bridge of the nose | upper teeth | lower teeth |
| --- | --- | --- | --- | --- | --- |
| stock lip | -27 mm | -26 mm | -27 mm | +5 mm | +30 mm |
| `headLip` 0.3 | -21 mm | -14 mm | -14 mm | +38 mm | +61 mm |

(The gun lands its rounds low, so one volley aimed at the head opens the jaw and the mouth, and the brow and the
nose are still under intact skin: their rows read the skin's own cover. After a second volley the whole face is off,
and the skull's face stands in front of the receded flesh from the brow down: the sheet's "after" row 2.)

These numbers are read off pictures taken 1.5 m from the head, 1.6 mm to a pixel, with a perspective that makes
flesh on the camera's side of the head read about 6% further forward than it is, and a flying gib in front of the
face counts as flesh. They are good to about 5 mm, and only from frames taken a second after the shot.

**4. "A floating piece of the neck."** The stump's own lip, standing in the middle of a bigger crater's hole.

The shader raises a crater's lip wherever the lip's ring passes within a few centimetres of the body's skin AS IT WAS
BEFORE ANY WOUND. A carve does not take a lip away with the flesh under it. A decapitation stamps a stump wound, a
bowl 11 cm in radius where the neck was, and the stump has a lip like any crater. When the head was cut off by a big
crater (a slug's is 16 cm in radius, the opening's two were 12 and 14 cm), the stump's bowl opens INSIDE that
crater's hole. Its lip is then raised round a bowl that is not there: a cup or an arc of pale flesh with a red
inside, attached to nothing, standing on top of the big crater's own lip. It depends on where the wounds were, so it
comes and goes.

- Reproduced: two slugs from 40 degrees took a head off and left a cup of flesh over the stump, seen from all four
  sides. The stump's centre was 2.5 cm from the slug crater's, so the whole 11 cm bowl lay inside the 16 cm crater.
- Measured on a CPU twin of the shader's wound rows, as lip flesh standing more than 1.5 cm clear of the body with
  its carves taken out: 2,348 cubic centimetres, reaching 5.9 cm clear, as the game was. No single lip there is
  taller than 4.0 cm (the slug crater's); 5.9 cm is the stump's lip standing on it. With the rule below: 1,334
  cubic centimetres, none more than 4.0 cm clear, which is the slug crater's own lip lining its bowl, as it does on
  any crater. The photographs agree: the red bowl stays, the cup and the arc over it are gone.
- Ruled out by the draw lists (`__sdfGame.head.drawnNear`), with the piece on screen: no bone-mesh instance, eye or
  organ there (and it stayed with the bone meshes hidden); no piece the head damage leaf attached (no in-orbit eye,
  no dangling eye or socket plug, no flap); no flying or settled gib chunk; no mesh gib (brain, skull fragment); no
  other visible mesh of the scene; no live flesh of the head cluster (the cluster is dead on the CPU). It is in the
  body's own march, and it goes when the lips' height is set to nothing.
- The rule (`damage.ts lipsAfterSever`, run when a limb is severed): the stump loses its own lip when it opens in
  the hole of a crater at least as big as its bowl. A crater loses its lip when the flesh it rides is gone (the
  severed head's own craters), or when the stump's bowl cuts into flesh under its lip; a crater that holds the
  whole bowl keeps its lip. The carves and the wounds' paint stay.
- A first version took the lip off every crater near the stump and off the stump whenever any crater touched it.
  Nothing hung, but the stump drew as a pale, shallow dish with the spine in it and no red at all, at a lip share
  of 0, 0.1 and 0.25 alike: a crater's wall is painted by its distance from the crater's centre, and without the
  lip, which thickens the wall inward, the wall sits where the paint is mostly skin. That was worse than the
  floating piece and was dropped.
- **Not the same thing, and not changed:** after a decapitation by pellets (four volleys at the neck of a frozen
  zombie) a collar of flesh stands at the back of the stump, pale outside, red inside, attached to the shoulders.
  It is real flesh, not a lip: the base of the neck belongs to the torso, the pellets' small craters cut the neck
  through from the front, and the stump's 11 cm bowl does not reach the back of the neck's base. It is there with
  the lips' height at nothing, and the twin finds no lip there more than 2.7 cm clear of it. From the front it can
  read as a dark hollow with a pale rim over the neck. If that is the piece the owner meant, the fix is a different
  one (a wider stump bowl at the neck, or the neck's base leaving with the head) and is not made here.
- One thing fixed on the way: a wound uploaded with a lip height of exactly 0 makes the shader's lip gate a
  smoothstep whose two edges coincide, which WGSL leaves undefined. The upload now never sends 0
  (`character-view.ts MIN_LIP_SPLAY`). It was not established that this ever drew wrong; the pale stump first put
  down to it was the missing lip.

## What changed, and how to put each thing back

Every value is a field of `burstTuning` (`head-burst.ts`), live from the browser console:
`__sdfGame.head.burstTune({ ... })`; `__sdfGame.head.burstTuning()` reads them.

| Field | Ships | Before | What it is |
| --- | --- | --- | --- |
| `opening` | `false` | `true` | The burst opening (entry and exit craters, the jelly, the dent, shards) on a slug. |
| `anyWeapon` | `false` | `true` | With the opening on: pellets make it too. |
| `alwaysSplit` | `false` | `true` | With the opening on: every head hit takes the full opening. |
| `slugSplit` | `true` | (none) | A centred slug opens the head split. |
| `splitFrac` | `1.25` | (none) | How centred: the slug's line within this many head radii of the head's centre. |
| `splitOpen` | `1` | (none) | How far it opens, as a share of the split's full angle (the axe's second chop). |
| `slugPop` | `true` | (none) | The slug that takes the head off pops it. |
| `popSwellS` | `0.12` | (none) | The swell before the burst, seconds. 0 bursts on the frame of the hit. The cultist's is 0.12 to 0.2 s. |
| `popOnSplit` | `true` | (none) | A centred slug on a split head pops it. |
| `popSplitMin` | `0.5` | (none) | How wide the split must stand for that, as a share of its full angle. |
| `headLip` | `0.3` | `1` | The lip of a gun crater on a zombie's head, as a share of the stock lip. |
| `on` | `true` | `true` | Off: every round is ordinary and every decapitation a flying head. |

- **Everything as it was at the playtest:**
  `__sdfGame.head.burstTune({ opening: true, anyWeapon: true, alwaysSplit: true, slugSplit: false, slugPop: false, popOnSplit: false, headLip: 1 })`
  and `__sdfGame.head.stumpLips(false)`.
- The opening's own numbers (`centreFrac`, `swell`, `lethal`, `repeatStep`, `craterScale`, `splay`, `shardScale`,
  `flapCount`) are unchanged and act only while `opening` is on.
- `__sdfGame.head.stumpLips(false)` leaves every lip as it was after a sever (the floating piece comes back);
  `stumpLips(share)` leaves that share of a lip the rule would take (0 ships).
- `__sdfGame.head.pop(id)` pops a head by hand; `__sdfGame.head.shot(id)` says what the rule made of the last round
  on a head.

**The skull in the pop.** The anatomical skull releases its 14 plates, as the cultist's pop always did. The sculpted
skull has no plates, so the head mesh that was being drawn is cut into ten fragments by region of the head (brow and
forehead, two sides of the cranium top, two temples, the back, two cheek-and-orbit halves of the face, the upper jaw
with its teeth, the lower jaw; `skeleton-spike/sculpt-fragments.ts`). Each is thrown as a mesh gib the way a plate
is, keeps the sculpt's paint, and shows the bone's dark inner wall on its back faces. Every triangle is in exactly
one fragment; each fragment is 5% to 21% of the surface on the zombie and the soldier, either sculpt, either cell.
The cut is made at a mesh's first pop and kept: 7.4 to 10.9 ms for the zombie's 18,296-triangle `full` head in
the browser, over the runs made for this work.
On a split head each fragment leaves from where its half is drawn. The head mesh and its seated eyes stop being
drawn in the same call that throws the fragments.

## What to know before playing it

- **An aimed slug lands about 10 cm under the crosshair.** With the crosshair on the centre of a zombie's head, from
  0.8 m to 4 m, the slug's line passes 0.89 to 1.03 head radii from the centre (a head radius is 10.9 cm), 10 cm
  below it and 2 to 3 cm to one side: it lands on the chin. With the crosshair 2 cm lower it is 1.07 to 1.21 radii
  off; 4 cm higher, 0.53 to 0.68. At 6 m it is 1.17 with the crosshair on the centre. So "centred" cannot be strict:
  `splitFrac` ships at 1.25, which takes nearly every slug that lands on head flesh, because anything under about
  1.05 would not split on an aimed shot at the face. If the slug's aim is corrected, `splitFrac` can come down to
  0.5 or so and the split becomes a reward for a good shot.
- **The slug's split is one-sided at fighting distance.** The split's plane goes through where the slug lands, and
  both halves open only when that is within about 2 cm of the head's middle line. In the gate a slug from 2 m whose
  line passed 0.2 cm from the head's centre still landed 3.6 cm or more to one side of the middle line (the plane
  was put at its 3.6 cm limit), because the round does not leave from the crosshair's line, and one half peeled
  open 0.9 rad (the sheet's "slug, centred" row). To have a slug from the front always open both halves, the leaf
  would have to hand the split the head's middle line instead of the impact; that is a one-line change the owner
  can ask for.
- **Pellets on the head are ordinary damage again.** While every volley made the opening, a volley on the head did
  the opening's damage once. Now each pellet is a wound: in the staged shots the zombie was falling after the
  second volley on its head from 2 m (15 pellets on the head), where before it fell at the third.
- **The pop will be rare in play as it stands.** A frozen zombie's neck is cut by one to four slugs under the chin.
  In live play the zombie turns and walks between shots and dies of the slugs first: twice, ten slugs aimed at the
  neck killed the zombie without taking its head off. A centred slug on a split head (two good head shots) is the
  common way to a pop.
- **The swell is short on purpose.** 0.12 s is seven or eight frames at 60 frames a second. The head grows by 60%
  by the end, most of it in the last frames. It reads in the strip; in real time it is a flicker before the burst.

## The sheet

[`look/burst-before-after.jpg`](look/burst-before-after.jpg). The grid: pellet volleys 1 to 3 with the crosshair on
the head (by the third, in the "after" columns, the zombie is dying and falling forward, so those tiles look down
on its head and shoulders), a slug on the chin (off centre), a slug 4 cm over the head's centre (centred), and the
body after its head was taken off; before on the left, after on the right; each as front and profile the way the game ships (VHS on,
1.5 m) and a clean close profile (VHS off, 0.6 m). Under it, the round that takes the head off, frame by frame at 60
frames a second: before (a pellet volley, the head flies), after (a slug, the pop), the pop with the flesh out of
the frame so the skull's ten fragments show, and the same two on the anatomical skull with its 14 plates.

Two things about the staging, so they are not read as findings:

- The cast is frozen so a zombie can be staged, and thawed for a quarter of a second after every round. A frozen
  zombie never springs back from a hit, and the renderer's outer hull is built once per frozen stretch, so a frozen
  body that a shot has moved is drawn clipped to where it used to be: a head shot from the front showed as a thin
  slab of face with the whole skull bare behind it. That is a capture's artefact and looks exactly like the owner's
  second observation; the first frames taken for this work had it. The gates photograph frozen zombies after shots
  the same way, and their pictures should be read with that in mind.
- For the strips the cast is held frozen (see above: in live play the slug rarely cuts the neck), so the headless
  body does not react. The pop, the debris and the flying head are the game's own.

To remake it (own servers, headless):

```
LABEL=before OLD=1 TUNE='{"headLip":1}' node scripts/head-burst-look.mjs <vite> <cdp> <before dir>
LABEL=after node scripts/head-burst-look.mjs <vite> <cdp> <after dir>
LABEL=anat QUERY='&skull=anatomical' SCENES=slug-pop node scripts/head-burst-look.mjs <vite> <cdp> <anatomical dir>
python3 scripts/head-burst-sheet.py <before dir> <after dir> <anatomical dir> docs/dev-notes/2026-10-07-sculpt-skull-2/look/burst-before-after.jpg
```

## The gate

`scripts/head-burst-gate.mjs` was rewritten for these rules. It fires real rounds at frozen zombies on the ring page.
(This is the gate as it was written, with four boots, when the anatomical skull was the default. Since the
sculpted skull became the default the rules and the opening run on it, the pop of the 14 plates runs on a boot that
asks for the anatomical skull, and the gate has five boots and 80 checks: the first part of this file, "The
gates".)

- **The shipped rules** (anatomical skull): pellet volleys on a head leave ordinary craters and nothing else; a slug
  fired with the crosshair on the head, with no stance solved for it, is centred by the shipped `splitFrac` and
  splits the head; with `splitFrac` at 0.35 an off-centre slug is an ordinary wound and a centred one splits (the
  split's state, the pose, the skull drawn as clipped copies, the field open where the half was, the cut faces, the
  zombie alive); a second centred slug pops the split head; `on: false` makes a centred slug ordinary.
- **The pop**, on a page of its own: slugs at the neck until the head comes off. It swells for `popSwellS`, no head
  flies, all 14 plates are thrown, the head segment and its eyes are not drawn, and 2.5 s later nothing is left where
  the head was. With `popSwellS` 0 there is no swell frame.
- **The opening, switched on by tuning**: every scenario the gate had before today (a pellet volley opens the head
  once per shot; a dead-centre slug is lethal; a glancing slug cracks a region and a second one kills; with `lethal`
  off the zombie lives; `on: false`; the flaps share one draw), with the same checks and the same thresholds. The
  only difference is that their tuning now also says `opening: true, slugSplit: false, slugPop: false,
  popOnSplit: false`, because the opening is no longer what an untuned game does.
- **The sculpted skull** (`?sculpt=full`): the decapitating slug throws the head mesh as the ten named fragments,
  cut once.

No check of the old gate was removed. What went is the premise that an untuned game makes the opening: the unit
test that pinned `anyWeapon` and `alwaysSplit` on as the defaults (`head-burst.test.ts`) now pins the new defaults.
One existing test's expected value changed with the behaviour: `head-split-cpu.test.ts` compares a pellet's and a
slug's wound stamped through an opened half, field for field, with the wound built at the un-warped hit; its lip
scale is now that wound's times `headLip`, still compared exactly.

A stance has to wait for the gun: a round fired while the gun is still coming back from the last one leaves from a
displaced muzzle (a slug solved to pass 0.03 head radii from the centre passed 0.49 off). The gate waits a full
reload before it solves a stance.

As run on the final code of that work: this gate 67 checks, 0 failed; the head-split gate
(`scripts/head-split-gate.mjs`) 100 checks, 0 failed; the axe gate (`scripts/axe-gate.mjs`) 27 checks, 0 failed.
Neither of those two was edited then.

## What looks worse, or is not done

- **Head wounds are flatter.** A gun crater on a zombie's head has a third of its lip. The torn, everted edge was
  part of the look; on the head it was also what hid the skull. The body's craters are unchanged.
- **A stump after gunfire is a little cleaner.** Small craters on the edge of a stump's bowl lose their lips, and
  a stump that opens inside a slug's or a blast's crater loses its own. Stumps from a blade, and stumps with only
  pellet craters round them, keep their lip.
- **The swell is hard to see** at 0.12 s (see above).
- **The soldier and the cultist are untouched by the rules** (the split, the slug's pop and `headLip` are the plain
  zombie's). One thing does reach the cultist: his pop now throws his skull's mesh in pieces when his head is not on
  the anatomical skull. His head bone is not sculpted, so the cut gives six pieces, not ten. Not photographed.

## Not verified

- Live play. Everything was staged on the ring testbed.
- The sheet's pop frames were taken one commit before the last change to the lip rule (a stump beside craters
  smaller than its bowl keeps its lip). A slug's crater is bigger than the bowl, so those frames are not affected.
- The picture-profile numbers under the opening do not agree with a CPU model of the carve alone (the model puts
  the bone 4 cm proud of the entry's floor on the head's middle line; the pictures show flesh level with it). The
  opening's two torn craters have lips about 5 cm tall that the model leaves out, which is the likely reason. Not
  pursued: the opening no longer ships.
- The soldier's head wounds, and any character but the zombie under the new lip rule after a sever (the rule is the
  same for every body; only the zombie's decapitation was photographed).
- Frame cost. Nothing here adds work to a frame without a pop; the fragment cut is 7 to 11 ms once per head mesh.

## Code

| File | What |
| --- | --- |
| `head-burst.ts` | The rules (`headShotRule`, `decapitationRule`) and the tuning. |
| `webgpu/game-head-shot.ts` | The head-shot leaf: a round on a head is judged, and the split or the pop is asked for. |
| `webgpu/game-actor.ts` | The pop (`beginHeadPop`, `advanceHeadPop`), the decapitation that asks first (`onDecapitate`), the low head lip, the lips a sever takes. |
| `damage.ts` | `lipsAfterSever`. |
| `skeleton-spike/sculpt-fragments.ts`, `mesh-renderer.ts` (`explodeSkull`) | The sculpted skull in pieces. |
| `webgpu/game-head-damage.ts` (`burst`) | The opening, as it was, asked for only when its tuning is on. |
| `scripts/head-burst-gate.mjs` | The gate, rewritten for these rules; the opening's scenarios run with its tuning switched on. |
| `scripts/head-burst-look.mjs`, `scripts/head-burst-sheet.py` | The photographs, the measurements and the sheet. |
