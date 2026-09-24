# Level 0: The Wake — Design (draft 1)

**Date:** 2026-09-10 · **Vision:** [../../vision.md](../../vision.md) §6.1, §10 · **Tasks:** [tasks.md](tasks.md)

> **Moved later (2026-09-24,** [new game flow](../../../superpowers/specs/2026-09-24-new-game-flow-design.md)**):** no longer
> the first level or the cold open. Reached when the train crashes back to earth; gains cultists
> and a new monster when it resumes. The pull-back moves to the end of Night Train. The text
> below is the original first-level design.

The demo level and the cold open. The first thing anyone plays. It has to sell
the shooting and the bodies in 5–8 minutes, then hand over to the pull-back.

---

## 1. Decisions so far

- **Type:** cemetery and funeral home, at night.
- **Reference:** the *type* of Blood's opening, outside a funeral home: gates,
  graveyard, the building. Take the kind of place and its mood; never its
  layout, landmarks or details.
- **Built via Blender** as the first test of the level pipeline (production
  scope §4.1, route B/D). The flat shares the pipeline.
- **The goblin starts with a melee tool and finds the sawn-off early.**
- **Last pickup:** a CD in an open coffin. Picking it up ends the level and
  starts the pull-back. When the full game resumes, the level continues out
  of the funeral home's back door to the rail line behind the cemetery, where
  the train to level 1 waits (vision §10.3).
- **Dynamite is found here (decided 2026-09-23):** a bundle in the crypt,
  the gravediggers' own blasting charges. Needs a `dynamite` pickup item in the
  level format and pickups module (Wake plans 1–2 list only melee, shotgun,
  shells, health, cd; add it when wiring).
- **The glimpse (decided 2026-09-23):** just before the coffin, a tall window
  at the back of the parlour looks out over the cemetery to the tracks. The
  train is there, stopped, windows lit, the firebox glowing at the front. No
  prompt, no explanation. It's the reason to sit back down at the computer
  after the pull-back.
- **Blockout v1 limits (2026-09-11):** every floor is at one height, so the
  crypt sits *at grade* (a low, dark room) rather than down stairs, and the
  goblin-only fence gap is a narrow 1.4 m passage, not a crawl space. Stairs
  and crouching need engine work first. See the
  [implementation brief](implementation.md) §3.

## 2. What doesn't work (level rule 2)

A wake still going with nobody left to mourn. Chairs in rows, flowers, the
organ playing to itself, a party upstairs in the funeral home that no one
downstairs can hear except you.

## 3. Starting weapon (open)

A gravedigger's tool, found or carried from the first second.

| Candidate | For | Against |
| --- | --- | --- |
| **Shovel** | Most "cemetery"; flat blade dents bodies, a clear deformation read | A bit comic, less threatening |
| **Pickaxe** | Goblins-in-mines folklore; the point punctures, the swing hooks | Slow; overlaps with a future heavy weapon |
| **Axe** | Chops; strong gore read | Quake's starting weapon is an axe; closest to a borrowed trope |

Avoid the pitchfork (Blood's starting weapon). Current lean: **pickaxe** or
**shovel**; test both on a zombie before deciding (W-B4).

## 4. Beat sheet

| # | Beat | Space | Teaches | Encounter | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | **The gates** | Iron gates, a lane, a gatehouse | Movement, look, melee | 1–2 slow zombies (mourners), one at a time | You start here. Nothing explained |
| 2 | **The open grave** | Just past the gates | Pickup; the gun | None, then 2 zombies climb out | The sawn-off lies in an open grave / on a dead groundskeeper |
| 3 | **The graveyard** | Open ground, fog, headstones, a mausoleum, **the bell tower** | Shooting crowds, reloading | A loose group of 5–8, then **the bell** (§4.1) | A goblin-only gap under a fence leads to a secret |
| 4 | **The crypt / basement** | Tight, dark; flashlight | Close-range fights | 3–5 in small rooms | First time the Party's music is heard *above* |
| 5 | **The funeral home** | Parlour: pews, flowers, the coffin, the organ | The level's music source | Quiet walk-in, then the mourners all turn | Biggest fight. The organ keeps playing |
| 6 | **The open coffin** | The front of the parlour | — | None | The CD inside. Picking it up ends the level |

**Length target:** 5–8 minutes for a first-time player. Zombie total: roughly
15–25 depending on playtest (the bell adds to it).

### 4.1 Set piece: the bell (added 2026-09-10)

Inspired by a giant-bell moment in a Warhammer 40,000 *Space Marine* game:
shoot the bell, and the enemies come. Ours is a **funeral bell**.

- **The bell tower** rises over the graveyard, visible from the gates, so the
  player sees it long before reaching it. A huge, dark bell hangs in the open
  belfry.
- **The crypt stairs are sealed** (a gate, a slab) until the bell rings. The
  level tells you nothing; the bell is the only obvious thing to shoot.
- **Shooting the bell tolls it,** and **each toll wakes the dead:** graves burst
  open across the graveyard and mourners climb out. The toll is loud enough to
  silence everything else for a moment, including the organ in the distance.
- **Three tolls, three waves, and the player picks the moment.** The first toll
  opens the crypt stairs and brings a small wave; each further toll brings a
  bigger wave and a reward (ammo, a secret grave opening). You can walk away
  after one.
- **The bell gives (P2, world law 2):** shots leave soft dents in the bronze. A
  metal thing behaving like flesh, as early as the demo level.
- **Frame rhyme:** the toll rhythm can match the knock pattern in the flat.
  Never stated.
- **Why it works here:** it's the demo's spectacle moment, it teaches that the
  world reacts to shooting, and it gives the player control over the pacing of
  the biggest outdoor fight.

**Rule for every level:** one set piece the player *triggers*, not one that
just happens to them. Now vision §10.6, rule 9; the bell is the first.

## 5. Map (rough)

```
  [1 GATES] ── lane ──> [2 OPEN GRAVE]
                              │
                              v
        ┌──────────── [3 GRAVEYARD] ─────────────┐
        │   headstones, fog, mausoleum           │
        │   BELL TOWER (shoot: tolls = waves)    │
        │   fence gap ─> (secret)                │
        └──── crypt stairs (open on 1st toll) ───┘
                              │
                              v
                     [4 CRYPT / BASEMENT]
                              │ stairs up
                              v
                  [5 FUNERAL HOME PARLOUR]
                     pews · organ · coffin
                              │
                              v
                      [6 OPEN COFFIN: CD]
            (upstairs, unreachable: the party)
```

## 6. The CD

The first release the player owns. Sets the tone for all of them.

- **Artist / title:** TBD. Needs a made-up name that's funny read straight.
- **Track:** the level's music, built around the funeral organ; noise and
  dungeon synth.
- **Cover:** a prerendered CG image (the visual target at 12 cm).
- **Liner notes:** ≤ 50 words.

## 7. Secrets

- **Fence gap** (goblin-only) in the graveyard: a small reward, and a first
  lesson that goblin routes exist.
- Optional second secret in the crypt.
- Secret rewards: to decide (ammo, a claim ticket, a decoration for the flat).

## 8. Sound notes (for G3)

- Funeral organ: the diegetic music source, audible from the graveyard, loud in
  the parlour.
- The Party: muffled kick through the funeral home ceiling, first heard in the crypt.
- **The bell:** a toll that ducks every other sound, long decay rolling across
  the graveyard; dented tolls sound flatter and wetter.
- Zombies: wet, wordless mourning sounds.
- Surfaces: gravel lane, grass, stone crypt, carpeted parlour.
- The CD pickup: the last sound before the pull-back; should feel wrong.

## 9. Open questions

1. Starting weapon: shovel, pickaxe or axe.
2. Does the goblin start at the gates, or climb out of a grave?
3. Artist and title of the first CD.
4. Secret rewards.
5. Does a soldier appear at all, or is the Wake zombies only?
