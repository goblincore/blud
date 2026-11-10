# Wounded bodies and missed rays on the ladder (2026-11-09)

Second part of [LADDER.md](LADDER.md): the same method (a captured `sdf:march` pass replayed with
its shader text edited), on wounded bodies. Measurement only; no renderer code changed.

**Answer.** On a wounded body the extra cost is the shading after the hit, not the walk, and nearly
all of it is one thing: the analytic normal gives up across the whole wounded body, so about 90 %
of its hit pixels pay four more field calls. The split head is the exception: its walk costs about
two thirds more per pixel.

## A correction to LADDER.md first

The capture harness's `applyShipDefaults` (`scripts/lib/sdf-closeup-stage.mjs`) switches the hull
exit bound OFF. The game ships it ON (`GAME_HULL_EXIT_BOUND = 1`). LADDER.md's capture was taken
with it off, so:

- its missed-ray figures (60 % of steps, 48 % of folds) and its absolute milliseconds overstate the
  misses: with the bound off a missed ray walks to the far plane;
- its per-call result (11 ns through `mapBody`, 3.6 ns through `mapLean`, the same picture to the
  bit) does not depend on the bound.

Everything below is with the bound ON (`SPIKE_PRELUDE='__sdfGame.setHullExitBound(true); ...'`).
`march-hash.mjs` and `march-parity.mjs` go through the same helper, so their pins describe the
bound-off setting. Not changed here: the pins would move.

## The frames

One boot, one body (the ring zombie of room 1), the eye 0.6 m away, ship defaults with the exit
bound on. Captured four times, each as shipped and with the flat-albedo seam on:

| Frame | How it was staged | Walked pixels | Hit pixels |
| --- | --- | --- | --- |
| clean | | 99,330 | 82,880 |
| pellets | 2 slugs and 18 pellets stamped from the pose (`stampWoundAt`) | 99,330 | 82,908 |
| chop | + `axeChop(id, "R", "torso")` | 80,189 | 62,773 |
| split | + two head chops; the head split open | 61,885 | 48,657 |

The body recoils from a chop, so the chop and split frames cover less of the target; compare them
per pixel. Staging: `wounds/prelude.js`.

## Across the frames (one rotation, six repeats, each within 0.2 ms)

| Frame | Shipped pass | Walk only | After the hit | Pass, per walked pixel | Walk, per walked pixel | After the hit, per hit pixel |
| --- | --- | --- | --- | --- | --- | --- |
| clean | 16.4 ms | 12.2 | 4.2 | 165 ns | 123 ns | 51 ns |
| pellets | 21.2 | 12.2 | 9.0 | 214 | 123 | 109 |
| chop | 17.6 | 10.5 | 7.2 | 220 | 130 | 115 |
| split | 20.5 | 12.7 | 7.8 | 331 | 205 | 160 |

- **Twenty pellet and slug wounds add 4.9 ms and none of it is in the walk.**
- A torso chop adds about 5 % to the walk per pixel; the split head adds 67 %.
- Two invocations of the ladder do not share a machine state: the pellet frame's shipped pass read
  24.6 ms in one and 21.4 in the next, each tight within itself. Frames are only comparable when
  they ran in the same repeats (`ladder.mjs` rungs `x-<frame>-ship` / `-flat`).

## After the hit: the field calls, removed one kind at a time

Each removal draws a wrong picture; these are ceilings. Paired differences on the shipped pass.

| | clean | pellets | chop | split |
| --- | --- | --- | --- | --- |
| The finite-difference normal (4 calls) | −0.4 ms (−2 %) | −4.2 to −4.6 (−19 to −20 %) | −3.1 to −3.4 (−15 to −17 %) | −4.3 to −4.4 (−18 %) |
| The AO and scatter probes (2 calls) | −3.1 (−17 %) | −2.8 (−13 %) | −2.0 (−10 %) | −2.9 (−12 %) |
| The wound soft shadow | 0, the picture is identical: it does not run at these settings | | | |
| All three | −3.8 (−21 %) | −7.4 (−35 %) | −6.2 (−31 %) | −7.6 (−30 %) |

- **The pellets' whole 4.9 ms is the finite-difference normal.** With it removed, 74,020 of the
  pellet frame's 82,908 hit pixels change; on the clean frame 6,512 do. Only 11,813 of those hits
  (14 %) had an accepting sample near a wound.
- Why: the analytic normal's wound loop (`ngWounds`) sends a pixel to `calcNormal`'s taps when any
  OWNED wound is within reach, and its reach still carries the fixed 0.25 m that `applyWounds`
  dropped on 2026-10-08. A cut (flag 32) or a torn wound always takes the taps.
- **The probes are 2 to 3 ms on every body, clean included.**

### Keeping the analytic normal on a wounded body

| | pellets | chop | split |
| --- | --- | --- | --- |
| `ngWounds` given `applyWounds`' exact reach | 0 | 0 | −0.4 ms (−2 %) |
| Analytic near owned wounds (the existing `counts2.z + 64` switch, forced on) | −0.8 (−4 %) | 0 | 0 |
| Both | **−3.1 (−13 %)** | 0 | 0 |
| Pixels moved by more than 0.02, both | 25,064 | 137 | 45 |

- On pellets the two together return two thirds of the fallback's cost. Neither does alone: twenty
  wounds' exact reach still covers most of a torso, and the owned rule alone leaves the 0.25 m.
- **It changes the look**: [`look/pelship-ng-both.png`](look/pelship-ng-both.png) (the game's frame,
  the changed one, the difference times 8). The skin's fine mottling shifts over the whole wounded
  area: the analytic normal and the taps carry the surface detail differently. Clean bodies already
  use the analytic one, so today a body's skin detail changes when it takes its first wound.
- Chops and the split get nothing from those two: a cut always takes the taps, and its reach is a
  sphere round the whole slot (at least twice its half-length), so one torso chop covers the torso.

### A cut bounded by its slab, and why each pixel takes the taps

`applyWounds`' cut branch only touches the field in a thin slab: within 1.2 half-lengths along the
slot and a few kerf widths across it. The rung `ship-ng-cut` makes `ngWounds` skip a cut for a
pixel outside that slab (7.7 kerf widths across), as it skips a wound out of reach.

| | pellets | chop | split |
| --- | --- | --- | --- |
| The slab alone | | 0, the same picture | 0, the same picture |
| The slab + the exact reach + analytic near owned wounds | −3.1 ms (−13 %) | −1.4 (−8 %) | not resolved (−0.1, range −1.4 to +3.8) |
| Pixels moved by more than 0.02 | 25,064 | 17,416 | 10,965 |

The slab alone changes nothing because every pixel of these bodies also has an owned pellet wound
in reach. The reason codes, exact, as a share of hit pixels:

| Why the normal is what it is | clean | pellets today → with all three | chop today → with all three | split today → with all three |
| --- | --- | --- | --- | --- |
| Analytic | 91 % | 0 → 85 % | 0 → 68 % | 0 → 36 % |
| Taps: an unsupported wound in reach (owned, cut, torn) | 0 | **100 %** → 2 % | **100 %** → 18 % | 49 % → 7 % |
| Taps: within a guard band of a reach or a kink | 0 | 0 → 5 % | 0 → 8 % | 0 → 4 % |
| Taps: bone proximity | 9 % | 0 → 8 % | 0 → 6 % | 0 → 2 % |
| Taps: inside the open head's region sphere | | | | 51 % → 51 % |

- **Today every hit pixel of a wounded body takes the four taps** (the "about 90 %" above came from
  counting pixels whose colour moved).
- The analytic normal is not free: a pixel moved off the taps returns about 35 to 45 ns of the taps'
  55.
- The split frame's remaining half is the open head's region sphere, where the analytic normal is
  switched off by design: it does not know the pieces' turn or their caps.
- Sheets: [`look/chopship-ng-all.png`](look/chopship-ng-all.png),
  [`look/splitship-ng-all.png`](look/splitship-ng-all.png).

## The walk on a wounded body

Paired differences on the walk-only frame.

| | clean | pellets | chop | split |
| --- | --- | --- | --- | --- |
| `applyWounds` removed (a wrong picture when wounded) | about −10 to −22 % | −3.3 ms (−22 %) | −3.0 (−25 %) | −3.0 (−20 %) |
| The owner re-fold removed | −12 % | −1.6 (−10 %) | −1.9 (−14 %) | −1.4 (−9 %) |
| The cut branch removed | | −0.3 (−2 %), same picture | wrong picture | wrong picture |
| `applyWounds` skipped by a runtime test on the wound count | +0.1 ms: nothing | | | |

- The wound code costs the walk about as much on a clean body, where it never runs, as on a
  wounded one. A runtime guard round the call returns nothing; removing the code does. The cost is
  its presence in the walk's field call.
- Counters, hits only: 23 to 25 primitive folds a ray on clean, pellets and chop, 50 on the split;
  3.1 to 3.2 steps a ray, 4.5 on the split. The split's pieces each fold the body again.
- Wound rows that pass the reach test: about 2.0 M on pellets (of 382 k steps), 2.4 M on chop.

### Two gates that did not pay

- **Per sample, outside the body's wound bound.** Bit-identical on wounded frames, colour and
  depth. But the bound is one sphere round all of a body's wounds, and at this range every walk
  sample is inside it (3 of 218,000 fell outside with 5 wounds). It skips nothing.
- **The air gate** (a sample more than T outside the pre-wound body skips the wound code). 60 % of
  the walk's samples are more than 2 cm out and 83 % more than 1 cm. With the "near a wound" flag
  cleared the walk accepts hits on skin a crater removed; with it kept, and applied to the walk's
  calls only, hits are lost where a lip stands further out than T (123 of 39,578 at 2 cm, 3 at
  4 cm, 1 at 6 cm). It halves the wound rows at 2 cm, and the time does not move (+0.1 ms on the
  walk-only frame, A/A +0.1): removing the wound code outright was only −7 % on that frame.

## The temporal start, switched off

The game's `?tstart=0`, as the rung `no-temporal`. A frozen frame is the temporal start's best case:
last frame's depth is this frame's.

| | clean | pellets | split |
| --- | --- | --- | --- |
| Shipped pass | −0.4 ms (−2 %) | −1.0 (−4 %) | −1.8 (−7 %) |
| Walk only | −0.4 (−3 %) | −1.0 (−7 %) | −1.1 (−7 %) |
| Pixels moved by more than 0.02 | 819 | 750 | 522 |

- With it on, hit rays take 2.4 % fewer steps (clean: 258,497 against 264,686) and the frame folds
  7 % more primitives: the probe costs more than the start it finds. The hull's entry is already
  closer to the surface than the temporal margin.
- The picture moves a little because hits land at slightly different depths inside the accept
  tolerance. Not looked at in motion.

## Missed rays (clean frame, exit bound on)

| | Pixels | Steps | Folds |
| --- | --- | --- | --- |
| Rays that hit | 39,209 | 139,012 (3.5 a ray) | 614,272 |
| Rays that walked and missed | 11,101 | 79,506 (7.2 a ray) | 307,934 |

(The 0.7 m, 33 % cover capture; the 0.6 m one reads 3.1 and 7.1 steps a ray.)

- Misses are 22 % of the walked pixels, 36 % of the steps, 33 % of the folds.
- They are not grazing rays: every one stays more than 5 mm from the body, 97 % more than 1 cm,
  77 % more than 2 cm, 34 % more than 4 cm. A missed ray walks about 12.5 cm from the hull's entry
  to its closest approach and 12.7 cm on to the hull's exit; 41 % of its steps come after the
  closest approach.
- So they are rays in the hull's slack. At 0.7 m, 3 cm is a ring about 17 march texels wide.

## What this says to do, in order of evidence

1. **The analytic normal on wounded bodies**: `ngWounds` on the exact reach, analytic near owned
   wounds, a cut bounded by its slab. −13 % of the pass on pellets, −8 % with a torso chop, with the
   mottling shift above (owner, 2026-11-09: not a big deal).
2. **An analytic normal for the open head** (each piece is a rigid turn of the closed head cut by
   planes): half of the split frame's hit pixels. Ceiling about −10 % there; not designed.
3. **The probes on the stripped call where the pixel is clean** (the fast-path branch's test):
   they are 17 % of a clean close-up. Untested here.
4. **The hull's fit**, for the missed rays: a third of the walk.
5. **The temporal start off** (`?tstart=0` exists): −2 to −7 % on a still frame, where it should be
   at its best. Needs a look in motion.
6. The split's walk and the wound code's presence in the walk: real, with no cheap lever found.

Not verified: any body but the zombie, a crowd, the live game, what the eye makes of any picture
change (only the sheets and the counts).

## Running it

As LADDER.md, with the staging prelude and one capture per frame:

```bash
LAB_TMP=.lab-tmp SPIKE_PRELUDE="$(cat docs/dev-notes/2026-11-09-sdf-perf-research/wounds/prelude.js)" \
  SPIKE_VARIANTS='ship=0;flat=__sdfGame.setFlatAlbedo(true);pelship=(__sdfGame.setFlatAlbedo(false),__ladderStamp(__A,4),__ladderStamp(__B,10));pelflat=__sdfGame.setFlatAlbedo(true);chopship=(__sdfGame.setFlatAlbedo(false),__ladderChop("R","torso"));chopflat=__sdfGame.setFlatAlbedo(true);splitship=(__sdfGame.setFlatAlbedo(false),__ladderChop("H","head"),__ladderChop("H","head"),__ladderNeedSplit());splitflat=__sdfGame.setFlatAlbedo(true)' \
  scripts/native-spike/servers.sh node scripts/native-spike/capture.mjs 5291 9291 .scratch/ladder/capy
LAB_TMP=.lab-tmp LADDER_SCENE=pel scripts/native-spike/servers.sh node scripts/native-spike/ladder.mjs .scratch/ladder/capy 6 ship,ship-no-fd,ship-ng-both
LAB_TMP=.lab-tmp scripts/native-spike/servers.sh node scripts/native-spike/ladder.mjs .scratch/ladder/capy 6 x-clean-ship,x-pel-ship,x-chop-ship,x-split-ship
```

`LADDER_SHEETS=<dir>` writes a look sheet per rung. Raw data: `wounds/*.json`.
