# Level 1: Night Train — Design (draft 1)

**Date:** 2026-09-23 · **Vision:** [../../vision.md](../../vision.md) §10.3 (the Line), §10.4 · **Tasks:** [tasks.md](tasks.md)
**Previous:** [Level 0, The Wake](../00-the-wake/design.md)

The first level of the full game, and the level that *builds the hub*. You
board the train at the back, fight forward carriage by carriage, reach the
engine and the Stoker, and set off the fire that drives the train out of the
night into a desert dawn. After this, the train is where you live between stops.
(The lift-off into space comes later, between the Keep and Cold Storage;
vision §10.3.)

---

> **Revised 2026-09-24** ([new game flow](../../../superpowers/specs/2026-09-24-new-game-flow-design.md)): Night Train is
> now the **first level played**. The player arrives through the void's portal straight into the
> guard's van (beat 0, the platform, is cut). Cultists replace the soldier ticket inspectors. It
> ends with the dawn, then the first CD's pull-back into the Flat. **First slice:** carriages 1,
> 3, 5, 8; revised beats in the spec.

> **Art direction (owner, 2026-09-24):** an old-timey interior, wood floors and wood-panelled
> walls. Inspiration: the first train level of *Resident Evil 0* (the owner has a fan
> recreation), as a *type*, like Blood: its mood and materials, never its layout or assets.
> Divergences welcome. Built with the [mesh key](../../../superpowers/specs/2026-09-24-level-mesh-key-design.md).

## 1. Decisions so far

- **Type:** a night train, the classic FPS train level as a *type* (Blood's
  first episode goes cemetery → tracks → train). Never its layout or details.
- **Linear, back to front.** The player boards the last carriage and fights
  toward the engine. The engine is "north" (−z), like every level's exit.
- **Carriages stay still; the world moves.** The level geometry never moves.
  Scenery scrolls past the windows, the camera sways, the sound rattles. That
  is the whole trick, and it's cheap.
- **The set piece is the dawn** (level rule 9): at the engine, the player
  blows the firebox open and the train tears out of the night into a desert
  dawn. It plays in-engine, with the player free to move and look. No
  cutscene (P1).
- **The Stoker** is in the cab, back turned, shovelling. It never fights, never
  turns, never reacts (vision §10.3). No behaviour beyond that for now
  (decided 2026-09-23).
- **This level's geometry becomes the hub.** Its carriages are reused, quiet, as
  the train between stops. Build them once, well.
- **Dynamite comes from the Wake** (decided 2026-09-23). Here the party
  carriage restocks it as a table of party favours, right before the cab where
  it's needed. The firebox can also just be shot open.

## 2. What doesn't work (level rule 2)

A party train on a line with no stations. Guests in their best clothes, party
hats askew, asleep in their seats or still dancing, travelling to a Party they
will never arrive at. The dining car is laid for a meal nobody eats. The ticket
inspectors check tickets nobody has.

## 3. The Party ahead (level rule 3)

The Party is *ahead* this time, not overhead: the train is going to it. The
kick drum comes from the front of the train and gets louder carriage by
carriage. At the engine it turns out to be the Stoker's shovel hitting the
firebox, in time. (Never explained whether the Party's beat is the Stoker's, or
the other way round.)

## 4. Beat sheet

| # | Carriage | Space | Teaches | Encounter | Notes |
| --- | --- | --- | --- | --- | --- |
| 0 | **The platform** | Behind the cemetery: a short platform, the train already pulling out slowly | Urgency | None | You run and jump onto the last carriage's rear step. The only moment the train visibly moves |
| 1 | **The guard's van** | Luggage, trunks, a coffin or two, dark | Close quarters, the flashlight | 3–4 passengers burst out of trunks | Shells and health among the luggage |
| 2 | **Third class** | Rows of seats, sleeping guests, streamers, bottles | Crowds in a narrow space | 6–8 guests, asleep until the first shot | Seats are cover; the aisle is a kill lane both ways |
| 3 | **The dining car** | Tables laid, candles, a buffet counter, a kitchen galley | Tables as cover, a side route | Waiters and diners; optional bloatmaw floating over the buffet (a preview of Cold Storage) | The galley is a goblin route past the fight |
| 4 | **The sleeper** | A narrow corridor, compartment doors either side | Doors, ambushes, choosing a route | 4–6, some behind compartment doors | **Emergency brake cord** here (§5.2). Secret under a bunk |
| 5 | **The party carriage** | The biggest carriage: a dance floor, a jukebox, lights | The level's music source; a dynamite restock | The biggest fight: 8–10 dancing guests turn | Dynamite restock as party favours on a table. The CD is in the jukebox |
| 6 | **First class / coat check** | Quiet. Rails of coats, a counter, a bell nobody answers | Claim tickets | 2 ticket inspectors (soldiers) | The future hub carriage. First claim ticket on the counter |
| 7 | **The tender** | Open air on top of the coal: wind, a night sky | Exposure, footing | 2–3 climbing up the sides | The "coal" is soft lumps. Never looked at closely |
| 8 | **The cab** | The engine. The Stoker, the firebox, gauges | The set piece | None | §5.1 |

**Length target:** 8–12 minutes. **Enemy total:** roughly 25–35.

## 5. Set pieces

### 5.1 The dawn (the level's set piece)

- **The cab.** The Stoker shovels steadily into a firebox that's burning low.
  The train is slowing; the gauges droop; the beat from the front drags.
- **The player triggers it:** throw dynamite into the open firebox, or shoot
  the firebox door off its hinges.
- **What happens, all in-engine, the player free to move:**
  1. The fire roars white. The Stoker doesn't flinch; it shovels faster.
  2. The beat doubles. The gauges swing past their stops. The train surges.
  3. The night outside thins: the town and the cemetery fall behind, the
     landscape flattens and empties.
  4. The sky goes grey, then pale gold. The train is running across an endless
     desert at dawn, a low sun, telegraph poles ticking past.
  5. The sound drops to the wheels, the fire and the shovel.
- **Level end:** the departure board in the coat-check carriage flickers to the
  next stop's name. Walking back through the train *is* the hub from here on.

**Later, not here:** the lift-off into space is the hub's set piece between the
Keep and Cold Storage (vision §10.3). This level's tech (window views, the
sky transition) is what that moment reuses.

### 5.2 The emergency brake (a smaller beat)

In the sleeper, a red cord. Pull it (or shoot it) and everything loose in the
train flies forward: passengers, luggage, bottles. Bodies pile softly against
the forward wall. It clears a hard fight if you find it; it's optional.

## 6. Enemies: guests in transit

| Who | Existing character | Role |
| --- | --- | --- |
| **Guests** | `zombie` in party dress (hats, streamers) | Asleep, dancing or dining. The bulk |
| **Waiters** | `zombie` variant, or `soldier` without a gun | Dining car |
| **Ticket inspectors** | `soldier` | First class; they shoot back |
| **The appetite** | `bloatmaw` (optional) | Hovers over the buffet |
| **The Stoker** | **New**, not an enemy | The cab |

New work is mostly dressing (party hats, streamers) on existing bodies. The
Stoker is the only new character.

**The Stoker, visually:** far too big for the cab, hunched, soft and pale in
the firelight, sleeves rolled up on arms thicker than the goblin, a huge coal
shovel. Seen from behind only; never a face. Shooting it does nothing visible;
it doesn't react. It's the one body in the game that doesn't give. Never explained.

## 7. Map (rough)

```
  [8 CAB: the Stoker, firebox]          ← front, −z
  [7 TENDER: open air]
  [6 FIRST CLASS / COAT CHECK]          ← future hub carriage
  [5 PARTY CARRIAGE: jukebox (CD), dynamite]
  [4 SLEEPER: brake cord, secret]
  [3 DINING CAR: galley route]
  [2 THIRD CLASS]
  [1 GUARD'S VAN]
  [0 PLATFORM]                          ← start, jump aboard
```

Each carriage is one room; each gap between carriages is a short vestibule
corridor. That maps directly onto the level format (rooms plus tunnels along z).

**Dimensions (goblin scale):** carriages about 3.0 m wide inside, 16–20 m long,
2.6 m ceilings (the party carriage 3.2 m). Seats leave an aisle of **at least
1.4 m** so the enemy navigation grid can route through (Wake brief §3).

## 8. The CD

- **Source:** the jukebox in the party carriage, playing the level's track the
  whole time you approach.
- **Track:** rhythmic noise built on the wheel rhythm, with the Party's kick
  bleeding in from the front; trap weight in the party carriage.
- **Pickup:** the CD sits behind the jukebox glass. Shooting or opening the
  jukebox stops the music mid-bar (silence as a beat, P5).

## 9. Secrets

- **Under a bunk** in the sleeper: a goblin-only crawl to a stash (health, shells).
- **The galley** in the dining car: a back route past the fight, with a claim ticket.
- **The roof** (in scope, decided 2026-09-23; needs multi-height floors): a
  hatch in the guard's van onto the carriage roofs, with a wind-blown route
  forward over the fighting, dropping back in through a vestibule hatch.

## 10. Sound notes (for G3)

- **The wheels:** the rhythm under everything; it changes on bridges and points.
- **The Party's beat** from the front, getting louder, turning into the shovel.
- **The jukebox:** the level's music source.
- **Wind** in the vestibules and on the tender.
- **The dawn:** everything drops out except the wheels, the fire and the shovel.

## 11. Tech notes and risks

- **Moving scenery.** Window views are cards or distant geometry scrolling
  past; the carriages don't move. Needs a "window" marker in the level format
  (a plane that shows the scrolling view), not a real opening.
- **Sway.** A small camera roll and bob, and loose props that shift. It must
  not affect collision.
- **Open-air tender.** A room with a sky backdrop instead of a ceiling.
- **The dawn sky.** A scripted transition from night to a desert dawn. The
  later lift-off (desert to stars, plus the pink light) reuses the same system.
- **The Stoker.** A large, mostly static SDF body with a looping shovel
  animation. Never reacts to hits.
- **The firebox.** A light source, and ideally the first soft set piece in a
  level: the door bulges before it bursts.
- **As a hub.** After the dawn, the same carriages must load in a quiet
  state (no enemies, departure board live). The level format needs a state or
  variant flag; revisited stops need the same thing.

## 12. Decisions from the design review (2026-09-23)

- **Dynamite** is found in the Wake; the party carriage restocks it.
- **The Stoker** doesn't respond to anything, for now.
- **The roof route is in**, so multi-height floors move up the engine list
  (production scope §4.7).
- **Hub carriages:** the dining car, the party carriage (its jukebox plays your
  collection), the coat check and the cab. The other carriages are locked or
  removed in the hub state.
- **Hub windows:** a desert first, stars after the lift-off.
- **The lift-off moves later:** this level ends in a desert dawn; the train
  leaves the ground between the Keep and Cold Storage, as a hub set piece.
  The trigger is feeding the Stoker's fire again (decided 2026-09-23).

## 13. Open questions

1. **What the Stoker could do later** (hold out a hand, stop shovelling once),
   parked.
