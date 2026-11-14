# The organ (2026-11-14)

A heavy quadruped whose back is a pipe organ. `?character=organ`, `?spawn=organ`
(`/sdf-game.html?level=arena&spawn=organ`).

![contact sheet](contact-sheet.png)

- **Body** `src/lab/sdf-zombie/characters/organ.blob`: the gorehound's rig (forelegs as arms, `foreleg` gait, the
  dog hind leg), a pleated bellows barrel of five disc folds, six flank mouths (SDF lips over a dark gullet), an
  eyeless head that is mostly mouth. 63 prims. The folds and mouths breathe on the `swell` morph.
- **Kit** `assets-source/organ-kit/` (headless `gorehound-kit/build.py`, skin from `scripts/organ-skin.ts`):
  `make_pipes.py` (saddle, two ranks of eight flue pipes, braces, trumpets en chamade, the voids), `make_head.py`
  (the mask, the head's teeth, the flank mouths' teeth), and the gorehound's `make_legs.py`. ~199k triangles,
  most of them the legs (the gorehound's at its HEAVY weights): not yet budgeted (biomech-style.md "Budget").
- **Hide** `characters/organ.detail` from `scripts/organ-detail-gen.ts`, baked to `organ-body-n.png` (pleat
  wrinkles, veins feeding the mouths, puckering round the saddle).
- **Motion** `ORGAN_TREAD` (gait.ts) and `ORGAN_PROFILE` (motion-profile.ts): slow, heavy, a deep bob.
- **Attacks** (enemy-mind.ts `makeOrganMind`): the hound mind's BITE up close (`ORGAN_BRAIN`); at 3.2-15 m the
  WAIL (hound-attack.ts `wail` pose, wail.ts): it plants and fills, throws its head back with the jaw wide, holds a
  trembling note and fires a chord of three slow notes from the trumpets, fanned so a strafing player clears it.
  A stagger cancels it.

## Not done / follow-ups

- A bespoke sonic visual (a refracting cone or ring per note). The notes are pale trembling tracers; a burst only
  feeds the post-aa blast ring when `blastDistort` is on.
- Sound: there is no wail audio.
- Kit budget: decimate the legs (the cerebrax went to a third with a baked normal atlas).
- The flank teeth drift a little off their lips at the wail's peak (rigid kit on `spine`, SDF on the rig points).
- Not playtested in a level: checked through `blob:shot`, the swing sweep and `webgpu/game-actor-organ.test.ts`.
