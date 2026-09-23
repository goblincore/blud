# The Wake: reference study (Blood E1M1, E1M2)

**Date:** 2026-09-23 · **Scale used:** 256 Build units per metre (calibrated on
doorways, below)

What these maps are: E1M1 "Cradle to Grave" — you climb out of a grave,
cross a cemetery to the Morningside funeral home (parlour, organ hall, morgue,
crematorium, crypt) and end in its walled backyard; E1M2 "Wrong Side of the
Tracks" — the episode then spills out into a rail yard around an industrial
complex. That is the same *type* as the Wake: funeral, cemetery, crypt, out to
the tracks. Every number below was measured from the maps at the calibrated
scale; nothing is copied except as a number or a pattern. Type names come from
the NotBlood source (`kDude…` / `kItem…` enums in
`source/blood/src/common_game.h`): 202 = shotgun cultist, 201 = tommy-gun
cultist (E1M2), 203 = axe zombie, 205 = buried axe zombie (rises from a grave),
219 = bat, 220 = rat, 245 = innocent (civilian, E1M2). Weapons/pickups near the
starts: 43 = flare pistol, 41 = sawed-off, 68 = shell box, 67 = shell pack,
62/63 = TNT bundle/box, 46 = napalm launcher, 100 = skull key, 103 = dagger
key, 109 = life essence, 107 = doctor's bag, 117 = guns akimbo.

**Scale calibration.** Build stores heights 16× finer than floor area, so
metres = raw z ÷ 4096 at 256 BU/m. I measured three named doorways in E1M1 and
compared the two candidate scales:

| Doorway | at 256 BU/m | at 512 BU/m |
| --- | --- | --- |
| The mausoleum's grand double doors (start plot → cemetery) | 5.0 m tall | 2.5 m |
| A ~1 m-wide service door at the top of the home's back stairs | 2.0 m | 1.0 m |
| A ~3 m-wide doorway on the home's east wing | 1.75 m | 0.875 m |

At 512 BU/m both ordinary doors are under a metre — nobody walks through them.
At 256 BU/m the ordinary doors read as real interior doors (1.75–2.0 m) and the
ceremonial pair as a proper 5 m entrance. 256 BU/m it is; it is also the
retired sim's constant (`src/sim/units.ts`). All numbers below are metres at
256 BU/m.

## 1. Shape

E1M1 is 336 × 240 m of bounding box but only ~170 × 190 m of that is playable:
125 connected sectors (of 155; the rest are sealed pockets — secret closets and
teleport nooks) holding ~17,300 m² of floor. It is a **line with side pockets and a meshed middle**:
about a dozen distinct spaces in sequence — grave plot → terrace with
mausoleum → sunken front yard → open cemetery south of the house → the funeral
home (parlour ~700 m², tall organ hall ~720 m², west wing, morgue,
crematorium) → a crypt of ~2,760 m² *underneath* the cemetery, reached only
from inside the house (10 connections deep) → the sunken walled backyard court
(~1,890 m², floor 10 m below the start) where the level ends. Branches: a west
annex off the yard and a low tunnel (~6.5 m wide) off the north end.

The graph is heavily meshed, not a tree: 151 walk-through connections over 125
sectors = **27 independent loops**. The start space has **exactly two ways
out, both grand doors** (5 m openings, shut until opened); there is no secret
third way out of the plot — the secrets begin beyond the doors.

The vertical is terraced: the start plot sits ~2 m above the front yard, the
yard and cemetery have a sunken lower level 10 m down, and the exit court is a
10 m-deep walled pit ringed by an elevated walkway.

E1M2 shows how the episode continues: scale doubles. 254 reachable sectors,
~41,700 m² of floor, and the signature space is a **rail/canyon ring road —
about 20,000 m² of it in five giant slabs — that loops the entire complex**
(40 connections deep at the far side, both ends landing near the start). The
middle is a dense multi-building yard; you start in a 312 m² room at its south
edge with **two ways out**, both into the yard maze.

## 2. The first minute

E1M1 opens with no enemies visible and nothing explained: you climb out of an
open grave in a fenced plot. First enemy is a single axe zombie ~34 m away in
the yard (two more wait ~30 m off in the other direction). The **first weapon —
the flare pistol — is ~35 m in**, sitting in the middle of the front yard,
*after* the doors and the first fight. A shell box is 10 m from the grave and
TNT bundles 13 m (in the mausoleum's secret alcove), so you have tools before
you have a gun. The plot teaches three things: how doors work, that walls with
odd details open (hit the coffin → flares; hit the curved wall → TNT), and one
long sightline — from the doors you can see a shotgun cultist guarding the
skull key ~46 m away across the open cemetery, which tells you where the level
is going without a single word.

E1M2 does the opposite of ramp up: a shotgun cultist stands **8 m** from the
start, the sawed-off and first shells are at 33 m, and two harmless civilians
are penned ~40 m east. The first minute says: this place is meaner, you are
already behind, and the rules about who matters have changed.

## 3. Proportions

- **Doorways:** ordinary doors 1.75–2.0 m tall × 1–3 m wide; grand ceremonial
  entrances 3–5 m; the lowest passage (a vehicle ramp/tunnel) 1.25 m tall ×
  6.5 m wide — crouch-only. Against our guide table: a 1.75 m capsule fits
  Blood's doors with the same clearance we allow at our 2.2 m minimum ceiling.
- **Rooms:** service closets 5–50 m² at 2–4 m tall; ordinary work rooms
  100–400 m²; the showcase rooms 400–750 m² (parlour ~700 m², organ hall
  ~720 m² and 24 m tall); the outdoor slabs (cemetery, exit court) 1,900–
  2,800 m² with 8–9 m of headroom. Sector heights p10/p50/p90 =
  2.0 / 8.0 / 13.3 m — the *median* space is big and tall; small rooms are the
  exception, used as punctuation.
- **Corridors:** 1–3 m wide and short; Blood strings rooms together with doors
  every 10–20 m of progress instead of long corridors.
- **Open vs enclosed:** E1M1 is mostly enclosed — the one genuinely open space
  (the ~2,800 m² cemetery) is fenced and overlooked from the porch and the
  mausoleum. E1M2 inverts the ratio: the huge open ring is the level's spine
  and the buildings are the pockets.

## 4. Fights

E1M1 fields **46 enemies placed in the map on ~17,300 m² — one per ~375 m²**
(the retail game gates a few spawns by difficulty). Mix: 12 shotgun
cultists (ranged), 7 axe zombies, 9 buried axe zombies, 17 rats, 1 bat.
Placement logic:

- Cultists guard *things*: the skull key (1, out in the cemetery), the dagger
  key (1, in the crematorium), doors and stairs (2 per big room, behind cover
  such as pews). They are the map's "soldiers".
- Zombies wait in side rooms and vestibules, usually in pairs, and the buried ones **rise from the graves you are walking past**
  — the open cemetery and the crypt are their floors.
- Rats and the bat swarm (5–9 strong) in closets and loot rooms; they are
  startle-and-flank trash, not fights.

Almost everything is stationary until triggered; the scripted moments are the
grave-rises and closet swarms. You meet enemies at thresholds and inside rooms
— rarely in open mid-crossing, except where the ground itself is the trigger.

E1M2 fields **98 enemies on ~41,700 m² (one per ~425 m²)** and flips the mix
ranged-heavy: 42 cultists (35 shotgun + 7 tommy) against 43 zombies, plus 4
bats, 3 rats, 6 innocents. Pressure scales with depth: the first band of
spaces holds ~11 enemies, the middle ~23, the deep third ~53 — and ~11 more
wait in sealed ambush pockets off the main loop.

Translation for the Wake: cultists are our `soldier`, axe/buried zombies are
our `zombie` (the buried-rise is exactly our grave-burst bell wave), rats and
bats have no equivalent — their job (startle in closets) folds into zombie
placement.

## 5. Loops and secrets

Loops: the route structure has 27 independent loops in E1M1's graph; as
*routes* you can name ~3–4: the cemetery rings the house (yard wraps its south
and east, so any fight in the open can be circled), the exit court has an
elevated walkway ringing the pit, the house interior forms its own small
circuit, and a destructible-barrel wall opens a **shortcut back toward the
start**. E1M2's ring road is one continent-sized loop with the complex's
internal mesh inside it.

Secrets: E1M1 has 11 official secrets + 1 super secret, all hinted physically —
a discoloured hedge panel, a pushable wall-coffin, an organ that plays an
off-key note when used, wall cracks (some only dynamite opens), a furnace you
crawl into, a bier that slides when you step on the right bench, an invisible
wall section opposite the exit hole. Rewards scale with depth: flares and TNT
early, armour in the middle, a life seed and the napalm launcher (super
secret) at the far end. The super secret is placed where you are already
staring at the wall that hides it. E1M2's loot pockets are mostly sealed rooms
visible from the ring road.

## 6. Pickups

E1M1: **71 pickups for 46 enemies (~1.5 each).** Health is the scarce
currency: 1 doctor's bag, 4 life essences, 1 life seed — about 6 heals for the
level, mostly past the midpoint and never inside a fight room. Ammo follows
the weapon curve: 7 flare packs clustered near the flare pistol, 5 shell boxes
and 5 tommy drums appearing only around their weapons mid-map, and 22
explosive pickups (8+4 TNT, 2 prox, 4 remote, 4 gas) salted everywhere —
including 4 TNT bundles within the first 26 m, which teach throwing before you
have a gun. 4 armour pieces sit in secrets or hard corners. E1M2: 67 pickups
for 98 enemies — leaner per enemy, but shells are everywhere (13 packs, paying
for 42 cultists) and health is slightly better (8 heals, 5 armour).

The pattern both maps share: **ammo is placed after the fight that spends it;
health is placed near — but not in — the room that needs it.**

## 7. Lessons for the Wake

1. The gates open with doors and nothing else: the Wake's first space should
   have plain door exits, one onward line, and no secret cracks in its own
   walls — secrets start past the doors (§1, §5).
2. First fight by ~35 m, alone and melee; the sawn-off comes after it, ~35 m
   further, lying in the open (§2, §6).
3. Doors are 2.0 m and roomy halls are the norm, not the exception — budget
   most spaces at 2.5–4 m ceilings and save one 20 m+ hall for the parlour
   (§3).
4. The cemetery is a loop, not a box: ring the funeral home with the graveyard
   so every outdoor fight can be circled, and let the bell-tower base get the
   "walkway ringing a sunken court" treatment for the crypt gate (§1, §5).
5. Enemies wait where they make sense and rise where the fiction says: zombies
   wait in vestibules and porches; grave-bursts trigger on the ground the
   player must cross (§4).
6. One soldier per key, ~45 m out, across open ground, visible from the door
   before it is reachable (§2, §4).
7. Closet fights are startle fights — 3–5 zombies in a small room guarding
   loot, no soldiers (§4).
8. Secrets must be physical: discoloured stone, a crack, an odd prop, an
   instrument that plays wrong — and the biggest one hides opposite the exit,
   in plain sight (§5). The fence gap should read the same way.
9. Ammo follows the weapon curve, health is scarce and never in the fight
   room; dynamite in the crypt mirrors Blood's TNT-in-the-first-minute — teach
   the throw early (§2, §6).
10. Escalate with depth and end outward: pressure roughly doubles band to band
    as spaces get deeper (E1M2's 11 → 23 → 53), the biggest fight is
    second-to-last in the parlour, and the exit is a threshold from enclosed
    to open — the coffin, then the window with the train (§1, §2, §4).
