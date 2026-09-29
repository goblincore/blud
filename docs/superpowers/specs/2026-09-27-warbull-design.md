# Warbull (cyber-minotaur) — design

**Date:** 2026-09-27 · **Status:** approved direction (owner, 2026-09-27: "hybrid
is good, i like the general description"); second draft (fresh body from the owner's reference plate) landed, awaiting the kit build and owner playtest.

## Why

The owner wants a flesh/cybernetic hybrid: a fleshy SDF body with **embedded mesh
parts** for the hard surfaces (shiny metal, blinking lights, wires) that read as
*cybernetic*, not as armour worn over a body. The creature is a Doom-cyberdemon
analogue: a minotaur with cybernetic augmentation.

The roster has two relatives, and neither is the answer:

- `cyberdemon.blob` is an ape-faced brute with a ram arm, written as "NOT A
  MINOTAUR" on purpose, walking the zombie shamble.
- `minotaur.blob` was fitted to a reference mesh and has good flesh, but its
  prosthetic is SDF `box` plates *painted* metal, which never read as metal
  (TASKS `X2`; the owner verdict was "not particularly good").

The Juggernaut worked (owner playtest, 2026-09-26) because of its recipe: a proven
body, scaled; a WAM polygon kit for the hard parts; plates that work; a
soldier-family brain. The Warbull uses the same recipe on the minotaur's flesh.

## Second draft (owner, 2026-09-27): a fresh body from a reference plate

The owner rejected the first draft's body as the same creature as the
existing bull brutes: it was `minotaur.blob` scaled up. They supplied a
reference plate, `docs/dev-notes/refs/warbull-reference.png`, a front view of
a dark-brown, heavily muscled minotaur with glowing red eyes, a bright red
cable wrap round his waist, chrome ankle braces over hooves (one chrome-shod),
and a chrome cannon for a forearm.

The body, face decal, kit and launcher were rebuilt from it:

- **Body.** A new skeleton and new prims, measured off the plate at
  3.25 mm/px; its front silhouette matches the plate at IoU 0.85. What reads:
  - no neck;
  - horns out and up;
  - a 0.96 m-to-0.51 m V-taper;
  - long, splayed legs;
  - a clawed hanging hand.
- **Face.** A decal cropped from the plate's own head.
- **Kit.** The plate's parts and nothing else:
  - the red cable belt;
  - chrome braces with calf cables;
  - one chrome-shod hoof and a chrome cuff over the other.
- **Launcher.** Restyled to the plate's cannon.

Superseded by the second draft: everything in the first-draft list below
that the plate does not show (steel horn, optic, jaw brace, spine rack,
reactor, knee pistons, shoulder cap).

**The plate's cannon is on his left arm.** Every carry holds props in the
right hand, so the figure is authored mirrored.

**Only the launcher is a plate.** The belt and braces are thin metal round
flesh. The region-plate mechanism stays for future characters.

Gameplay is unchanged:
- the rocket volley;
- the charge and wall stun;
- the disarm, brawl and rage;
- the status lights, which now pulse the braces' LEDs and the launcher's.

## The read (first draft)

A hunched, bull-headed brute about **2.6 m to the horn tips**, a head taller than
the Juggernaut. Pink-red hide under hard light. Machinery is **bolted into** him:
every metal part meets the flesh at a **flange collar**, a bolted ring that bites
into the meat. That seam is what says "cybernetic" rather than "armour".

- **Flesh (`warbull.blob`):**
  - the minotaur ×1.28, with its painted metal removed;
  - a hump behind the neck;
  - the left horn and left glowing eye kept as flesh;
  - a face decal baked from the minotaur's reference mesh.
- **Hard parts (`warbull-kit.wam`):**
  - a **steel right horn** collared into the flesh horn root;
  - a **cyclops optic** in the right eye socket (lens, housing ring, LED);
  - a **jaw brace**;
  - a **spine rack** of vertebral plates down the hump;
  - a **chest reactor** with a glowing core in a collar;
  - **knee cops and hock pistons**;
  - **steel-shod hooves** over the paws;
  - an **elbow socket collar** on the right arm;
  - **cable tubes**, sagging from the spine rack over the right shoulder to the
    socket, and from the rack to the reactor.
- **Launcher (held prop, like the chaingun):** a three-tube rotary launcher that
  swallows the right fist and lower forearm. It has a Grip_Hand locator inside
  the housing, a Muzzle, and a `Barrels` node that indexes round one tube per
  shot, reusing the chaingun's spin path.
- **Materials:** chrome and gunmetal (high metallic, low roughness, env-mapped
  like the held props), dark iron, brass fittings, red lens and LED glow.
- **Blinking lights:** new. A pure `status-lights.ts` (the `barrel-spin.ts`
  pattern) turns the mind's state into a pulse per LED group:
  - slow heartbeat when idle;
  - fast strobe when aiming (the rocket telegraph);
  - stutter when a cyber plate is damaged;
  - dark once the plate is gone.

  The kit overlay writes that pulse into the LED material's emissive intensity.

## Behaviour: hybrid

**Ranged (launcher intact):** plant-and-fire on the soldier's brain with a
`ROCKET_TUNING`.

- Slow turn. A spin-up telegraph: the tubes index and the LEDs strobe.
- A volley of **3 rockets**, about 0.35 s apart.
- A long cooldown.
- He stands off at range and does not strafe.

**Rockets** are slow and visible (around 9 m/s, dodgeable by strafing). They
detonate on world or actor contact, or at max range, through the **dynamite blast
path**: the same explosion VFX, gore and blast wounds on actors, so the player's
own tool is turned on them. Player health stays out of scope, as for the
Juggernaut.

**Melee (always available up close; the only mode once disarmed):**

- **Charge:**
  - the telegraph is a hoof scrape and head down, about 0.8 s;
  - then a straight-line charge at about 3× cruise with a very low turn rate;
  - a miss that meets a wall **stuns** him for about 2 s, the punish window.
- **Gore:** a close-range horn swipe (the zombie's attack states, bigger reach).

**Disarm: the launcher is a plate.** Shooting it off (sparks, then it sheds and
drops) removes the ranged mode for good. He goes **enraged**: faster cruise,
charges on cooldown, LEDs go red. The player chooses between disarming him first
and going for the meat.

## Damage

- **Cyber plates** (`plate-armor.ts`, an `ArmorSpec` like the Juggernaut's) cover
  **only the metal**:
  - launcher (the forearm and hand bones, right side);
  - optic and steel horn (a small plate on the skull, so a head shot must break
    it first on that side);
  - reactor (the chest);
  - spine rack (the neck and spine2).

  An absorbed hit gives sparks, no wound.
- **Flesh is flesh:** everything else wounds on the first hit, with an injury
  tuning scaled up for his size (Juggernaut ×1.5 is the starting point).
  Blasts wound through everything and crack every plate they reach.
- Pellets do not stagger him; slugs and blasts do; a wall-stun always does.

## Out of scope

- Player health and knockback on the player (the charge and gore are visual and
  audible only, like every enemy's damage today).
- Walk-and-fire.
- Audio beyond reusing existing cues.
