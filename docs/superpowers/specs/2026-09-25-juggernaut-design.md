# Juggernaut (chaingunner soldier variant) — design

**Date:** 2026-09-25 · **Status:** approved direction (owner, 2026-09-25); step 1 landed.

## Why

The soldier is the most finished enemy and a good base for a family of variants
("same basic idea, different kit and behaviour"). This is the first variant. The
owner picked the Juggernaut over the Grenadier because it is the simpler one: it
is a tank, and its behaviour is mostly tuning on the soldier's existing brain.
The Grenadier (gas mask, grenades, flushing, dynamite dodging) stays the
candidate for the second variant.

## The read

Doom's chaingunner in classic Fallout-style **power armour**. He is visibly
**bigger than the soldier**, both taller and broader, and he walks slowly. When he
plants and spins up the gun, you get out of the way.

- **Frame:** about 1.15x the soldier's height (roughly 2.3 m against 1.99 m) and
  about 1.3x broader across the shoulders and chest. The flesh body is a
  scaled-up soldier (his own `.blob`) with **no hair**, so nothing pokes through
  the helmet.
- **Power armour (WAM kit):** the rounded, riveted, bulky suit of classic Fallout
  power armour:
  - huge domed pauldrons;
  - a barrel-chest cuirass with a raised centre plate;
  - segmented armour on the upper arms and forearms;
  - thick thigh and shin tubes;
  - boots with a big sole;
  - a backpack power unit with an **ammo drum**.
  The flesh body only shows at the joints.
- **Helmet:** a sealed, rounded helm with a jutting snout or grille and two round
  lenses, possibly with a dim glow behind them. The helmet is a kit piece that
  can be shot off.
- **Chaingun:** a new Blender-scripted prop on the shared `GUN_GRIP` locators. It
  has a rotating barrel cluster, a rear grip, a top carry handle and a feed belt
  running to the backpack. It is carried at the hip with two hands, using the
  existing `hip` carry. The barrels spin during spin-up and fire.

## Behaviour: plant and fire (walk-and-fire is a later option)

He runs on the soldier's brain (`makeSoldierMind`) with a new `CHAINGUN_TUNING`:

| Knob | Soldier | Juggernaut (starting point) | Why |
| --- | --- | --- | --- |
| Movement | strafes, backs off inside `tooClose` | **no strafe, no back-off** (new tuning flag) | a tank does not dance |
| cruise / turnRate | 1.25 / 5.5 | ~0.9 / ~1.8 | a slow sweep is the dodge: you can outrun it by strafing |
| aimSec (telegraph) | 0.5 | ~0.9, the **spin-up**: barrels spin plus a whine | the only warning before a stream |
| burst | 2–3 shells | **15–25 rounds** at ~10 rounds/s | "he just shreds" |
| settle / cooldown | 0.22 / 0.55 | ~0.6 spin-down / ~1.5 | the punish window |
| fireRange / preferredRange | 6 / 2.6 | ~9 / ~5 | stands off and hoses |
| Stagger | every hit | only slugs and blasts; pellets do not stagger | armoured |

Each round is **one bullet**, not the soldier's 8-pellet volley. Today every
enemy shot, the cultist's tommy gun included, calls `spawnPellets(..., 1, ...)`,
and one "barrel" is 8 pellets. The chaingun needs a single-round path.

Player health is **out of scope** (owner, 2026-09-25). His rounds are visual
only, like everyone else's.

## Damage: armour that actually works

The soldier's plates only break off visually (`kit-damage.ts`). On the Juggernaut
the plates **absorb** hits:

- A hit on an intact plate spends plate hit points (with sparks) and does no
  flesh damage. When a plate breaks off, the flesh under it takes the soldier's
  regional injury rules as normal. You peel him open.
- **The helmet** has to come off before head hits count (the soldier's "4 head
  pellets in one volley" rule included).
- Higher regional thresholds than the soldier. Dynamite is the intended answer.
- *Optional:* once the backpack drum is exposed, shooting it cooks it off using
  the existing explosion damage.

## Architecture

- **Soldier family trait (step 1, done):** `MotionProfile.family = 'soldier'`
  plus `isSoldierFamily()` replace about 37 `name === 'soldier'` checks across
  motion, actor, game-actor, character-view, lab-main, flame-lab, burning and
  gibs. A variant with its own name keeps injury rules, kit breakoff and
  sparks, casings, grounded footwork, structural collapse and corpse handling.
- **Profile:** `JUGGERNAUT_PROFILE` spreads `SOLDIER_PROFILE`. It overrides name,
  gait speeds and turn rate, sets carries to `hip` and `prop` to the chaingun,
  and sets `gunner: { weapon: 'chaingun' }`.
- **Brain tuning (pure):** `CHAINGUN_TUNING: SoldierTuning` in `soldier-brain.ts`.
  The new flags (`strafe: false`, stagger resistance) are plain data, and the
  brain branches on them. Tested headless like `SMG_TUNING`.
- **Armour absorption (pure):** a renderer-free `plate-armor.ts` holding each
  plate's hit points, the hit-to-plate mapping, and the shed events that feed
  `kit-damage` visuals and `soldier-damage` injury. It has its own tests.
- **Rendering:** no new shaders are expected. The barrel spin is a prop
  sub-node rotation, and the lens glow reuses the glow-prim or emissive
  material path.

## Out of scope for this pass

Walk-and-fire, player health, the Grenadier and other variants, and a
chaingun-specific audio set (placeholder SFX are fine).
