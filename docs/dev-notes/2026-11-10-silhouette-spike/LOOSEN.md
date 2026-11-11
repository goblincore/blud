# The fast walk for wounded bodies, and three looser shading options (2026-11-10)

Follows [SHADING.md](SHADING.md). Prototyped as shader text edits in the replay harness
(`scripts/native-spike/loosen.mjs`); no renderer code changed. Fragment march, 400 x 300, the 22-body ring mob clean
and wounded, each leg compared with the game's own readback of the frame and timed against the shipped pass by
alternation (5 repeats).

**Answer.** The fast walk per sample does not pay on a wounded mob: wounds are too big and too many for any sample
near a wounded body to be outside them. Dropping the finite-difference normal does pay: −6 ms (−17 %) on the clean mob
with the picture changed at edges only. The owner's standing rule (2026-11-10) is that a speed-up that loosens the
look is fine where it is not noticed, so the pictures are in [`look/loosen/`](look/loosen/) to judge.

## The fast walk per sample (lead 1 of SHADING.md): no

A pixel with wounded bodies in its table lists their wound spheres once and takes `mapLean` for every sample outside
all of them (up to 8 spheres; more, and the pixel stays on `mapBody`).

| Sphere | Walk steps sent to `mapLean` (of 358,770 on hit pixels) | Pixels moved by more than 0.02 | Time against shipped |
| --- | --- | --- | --- |
| The body's wound bound (exact) | 3 % | 0 | 0 |
| Each wound, the shader's own reach + 0.25 m (exact) | 0.3 % | 0 | not timed |
| Each wound, 2 x its radius + 3 cm | 8 % | 0 (34 texels, largest 0.001) | 0 (+1.4, −0.3 to +19) |
| Each wound, 1.5 x its radius + 2 cm | 22 % | 2,677 | 0 (−0.1, −17 to +3.6) |
| Each wound, 1 x its radius + 2 cm | 40 % | 7,668, and 52 pixels change hit or miss | −1.8 ms (−15 to −0.8) |

- A body's wound bound is a sphere 0.8 to 1.2 m in radius: the whole body.
- A wound is about 10 cm in radius, the shader's reach for one is 30 to 65 cm, and a hit pixel's body carries 8 on
  average here (45 shots across the view). Every sample that matters is inside some wound's reach.
- Even at 40 % of steps moved the time barely changes. So the wounded walk's cost is not "samples that could have
  been lean". What a wounded body needs is a cheaper field call WITH its wounds: `mapLean`'s fold and carves plus
  `applyWounds`, without `mapBody`'s other bookkeeping. Not built; the re-fold of a limb through a crater is the
  hard part.
- On the clean mob every form is neutral (−0.7 to +0.0 ms).
- The wounded run was disturbed (load 6 at its start; the same pass again read +0.3 with a range to +27), so its
  ranges are wide. The medians agree with the step counts.

## Looser shading

| | Clean mob (36.7 ms) | Pixels moved > 0.02 | Wounded mob (62.1 ms, noisy) | Pixels moved > 0.02 |
| --- | --- | --- | --- | --- |
| The same again | +0.1 (−0.9 to +1.1) | | +0.3 (−1.5 to +26.9) | |
| No finite-difference normal | **−6.1 (−6.7 to −4.7), −17 %** | 4,612 | −6.4 (−24.8 to −4.1) | 5,806 |
| Probes on `mapLean` | −2.5 (−3.6 to −1.7), −7 % | 17,716 | −5.8 (−23.7 to −1.1) | 33,140 |
| No wound shadow | 0, the same picture | 0 | −1.2 (−17.1 to +0.5), the same picture | 0 |
| All three | **−9.1 (−9.8 to −7.7), −25 %** | 20,153 | −13.2 (−29.0 to −12.2), −21 % | 34,991 |

- **No finite-difference normal** ([clean](look/loosen/mob-no-fd.png), [wounded](look/loosen/mobw-no-fd.png)): where
  the analytic normal gives up, its own gradient is used and the four field taps are not taken. The change is thin
  lines at silhouettes, belts and wound lips. This is the one to take.
- **Probes on `mapLean`** ([clean](look/loosen/mob-probes-lean.png), [wounded](look/loosen/mobw-probes-lean.png)):
  it moves the picture on a clean body too, so the probes' `mapBody` call is not the walk's (the probe pass flag).
  The red glow through thin parts weakens and lit skin goes flatter and brighter. Visible; 2.5 ms on the clean mob,
  where removing the probes outright was 6 ms, so the lean call is still most of their cost.
- **The wound shadow never runs on these frames** (the picture is identical without it), yet cutting the chain
  before it read 2.6 ms faster in SHADING.md. That stage figure is a property of the cut program, not a saving.
- All three: [clean](look/loosen/mob-loose.png), [wounded](look/loosen/mobw-loose.png). Each sheet is the game's
  frame, the edited one, and the difference times 8.

## In the game: `?ngloose` (2026-11-10)

The cheaper fallback normal is in the march behind `?ngloose` (`march/normal-loose-flag.ts`), off by default when
this section's numbers were taken (on by default since the owner's second playtest, below), the
shipped text unchanged when off. It keeps `calcNormal` where `ngBody` did not run at all (an open head split), which
the replay edit above did not. The game's own pass, captured with the flag and replayed against the shipped
captures of the same frozen scenes (two boots; 5 repeats):

| | Shipped | With `?ngloose` | Control |
| --- | --- | --- | --- |
| Clean mob | 35.8 ms | 30.7, −5.1 (−5.9 to −3.5), −14 % | +0.5 (−0.2 to +2.7) |
| Wounded mob | 62.0 ms | 54.9, −6.7 (−8.5 to −5.7), −11 % | −1.9 (−2.5 to +0.4) |

Not checked: the look in motion, the compute march with the flag (it shares the text), an open head split.

**Owner's playtest of that first form: a visible loss.** Zombies and the teratoma looked smooth, and wounds simpler.
Two causes: the stand-in gradient had no skin detail term (`ngDetail`, which the analytic path adds), and near a
wound the taps carry the crater's shape, which `ngBody`'s gradient does not. The second form adds the detail term
and keeps `calcNormal` where the hit is near a wound. Re-captured and re-timed the same way:

| | Shipped | With `?ngloose`, second form | Control |
| --- | --- | --- | --- |
| Clean mob | 42.8 ms (a busier run) | 37.0, −6.9 (−15.0 to −5.0) | +0.5 (−2.8 to +8.5) |
| Wounded mob | 61.0 ms | 60.6, −0.6 (−1.3 to +0.3) | −0.2 (−0.7 to +1.0) |

So the saving is kept on clean bodies and is gone on wounded ones: on the wounded mob nearly every pixel that takes
the taps is near a wound. **Owner's playtest of the second form (2026-11-10): looks right.** Clean zombies and the teratoma
read as they do without the flag. **On by default since 2026-11-10 (owner's call).** `?ngloose=0` is the old text to the byte (the march golden
holds it). Not re-timed after the flip: the default text is the text `?ngloose` gave.

## Not shown

Motion (a normal that changes source at an edge can shimmer), the upscaler on top, MAP28's butchers and flayers, the
compute march. `ng0` on a pixel whose analytic normal gave up for a reason other than the wound rule was not checked
by reason code.

Raw: [`results/loosen-mob.json`](results/loosen-mob.json), [`results/loosen-mobw.json`](results/loosen-mobw.json), run output beside them.
