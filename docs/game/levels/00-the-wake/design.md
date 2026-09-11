# Level 0: The Wake — Design (draft 1)

**Date:** 2026-09-10 · **Vision:** [../../vision.md](../../vision.md) §6.1, §10 · **Tasks:** [tasks.md](tasks.md)

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
  starts the pull-back.

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
| 3 | **The graveyard** | Open ground, fog, headstones, a mausoleum | Shooting crowds, reloading | A loose group of 5–8 | A goblin-only gap under a fence leads to a secret |
| 4 | **The crypt / basement** | Tight, dark; flashlight | Close-range fights | 3–5 in small rooms | First time the Party's music is heard *above* |
| 5 | **The funeral home** | Parlour: pews, flowers, the coffin, the organ | The level's music source | Quiet walk-in, then the mourners all turn | Biggest fight. The organ keeps playing |
| 6 | **The open coffin** | The front of the parlour | — | None | The CD inside. Picking it up ends the level |

**Length target:** 5–8 minutes for a first-time player. Zombie total: roughly
15–25 depending on playtest.

## 5. Map (rough)

```
  [1 GATES] ── lane ──> [2 OPEN GRAVE]
                              │
                              v
        ┌──────────── [3 GRAVEYARD] ─────────────┐
        │   headstones, fog, mausoleum           │
        │   fence gap ─> (secret)                │
        └─────────────── stairs down ────────────┘
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
- Zombies: wet, wordless mourning sounds.
- Surfaces: gravel lane, grass, stone crypt, carpeted parlour.
- The CD pickup: the last sound before the pull-back; should feel wrong.

## 9. Open questions

1. Starting weapon: shovel, pickaxe or axe.
2. Does the goblin start at the gates, or climb out of a grave?
3. Artist and title of the first CD.
4. Secret rewards.
5. Does a soldier appear at all, or is the Wake zombies only?
