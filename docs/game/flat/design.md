# The Flat — Design (draft 1)

**Date:** 2026-09-10 · **Vision:** [../vision.md](../vision.md) §6–§8 · **Tasks:** [tasks.md](tasks.md)

The goblin's basement flat: the only real place in the game, the space the
player sees most outside the FPS, and the arena of the finale. Small, specific,
lived-in. **It can never be left.**

---

## 1. Decisions so far

- **Construction:** normal mesh (Blender) for the shell and props. **SDF only
  for the parts that distort:** the CRT screen, the PC case, the front door,
  and later the ceiling.
- **Walkable,** first person, free look. No leaving.
- **One main room.** A tiny bathroom is optional (open question).
- **Built through the same Blender → game pipeline as the levels** (see the
  Wake's pipeline tasks), so the flat and the Wake prove one route.

## 2. Layout (draft)

Roughly 4 × 5 m. The furniture is goblin-sized: the one space in the game
that fits the goblin (world law 5).

```
 ┌──────────── high window (feet pass) ────────────┐
 │  mattress              pipes ║        bucket ░   │
 │  ▭▭▭▭                        ║       (leak)      │
 │                                                  │
 │  CD shelf ▯▯▯      rug ▒▒▒▒▒         stereo ◫    │
 │                                                  │
 │  mirror ▮ (covered)                              │
 │                     desk ▬▬▬▬▬ + CRT ▣ + printer  │
 │  bathroom?                chair ⌂                │
 └──────── front door ▯ (mail slot) ────────────────┘
```

### Sightline rules

1. **Seated at the desk, the front door is behind you.** The knock must come
   from out of view.
2. **From the door, the CRT glow is the first thing you see.**
3. **The CD shelf is visible from the desk** with a small turn of the head: the
   collection is always in reach.
4. **The high window is in view from the mattress,** so routines (feet, light
   from upstairs) are noticed when idle.
5. **Open floor between desk and shelf** for decorations and, later, the finale
   fight. Leave room to move; the finale needs cover and lanes.

## 3. Props

| Prop | What it says | Soft/flesh variant later? | Priority |
| --- | --- | --- | --- |
| **Beige PC tower** | The goblin's whole world | Yes: pores, warmth, breathing | Hero |
| **CRT monitor** | The portal | **Yes, SDF screen** (push-through) | Hero |
| **Desk** | Clutter: cans, wrappers, a magazine with a cover disc | No | Hero |
| **Keyboard, mouse** | Worn, grimy keys | Mouse cable goes too soft | Hero |
| **CD tray** (on PC) | First portal route | Moves like a tongue | Hero |
| **Chair** | Too big for a goblin (the exception to fit) | No | Hero |
| **Front door + mail slot** | The way out that isn't | **Yes, SDF door** | Hero |
| **CD shelf** | The collection; starts nearly empty | No | Hero |
| **Stereo** | Plays found CDs | No | High |
| **Dot-matrix printer** | Second portal route | No | High |
| **Mattress** | No bed frame | No | Medium |
| **Pipes** | Carry the Party's music | Late: breathe | Medium |
| **Bucket under a leak** | The building above is wet | No | Medium |
| **High window** | Only feet and light | No | Medium |
| **Covered mirror** | The face is never shown | Late-game event | Medium |
| **Rug** | First decoration spot | No | Low |
| **Magazine** (*CD-ROM INFERNO*) | Where the demo disc came from | No | Low |

Decorations that arrive later are designed per level, not here.

## 4. The desk close-up

The most-seen shot in the game. It must read in one glance:

- The **CRT** centred, beige, slightly yellowed, a sticker or two, a faint burn-in.
- **The PC tower** to one side with the CD tray facing the player.
- **Keyboard** pulled close, **mouse** on a worn pad.
- **Printer** at the edge, paper trailing.
- **Clutter** that says goblin: gnawed pencils, a jar of something, crumbs, a
  ring left on the desk from a mug.
- **After the cold open:** the wet film on the screen and a stain on the bezel,
  permanent.

## 5. Light and sound

- **Light:** one warm lamp, CRT glow (blue-white, flickering with the game),
  grey light from the high window, dark corners. Night is the default.
- **Sound (needs audio foundation, G3):** CRT whine, PC fan, pipes, the leak,
  the Party's kick through the ceiling, footsteps above, the knock.
- **Placement now:** mark sound emitters in the scene even before audio exists.

## 6. The distorting parts (SDF)

| Part | First use | Behaviour |
| --- | --- | --- |
| **CRT screen** | Cold open | Bulges, stretches, an object pushes through, the membrane settles slowly |
| **PC case** | Strange phase | Subtle surface change: pores, slow breathing |
| **Front door** | Sinister phase | Gives under the hand |
| **Ceiling** | Sinister phase | Soft bulge on the Party's kick |

**The screen comes first** and is the pilot for soft architecture elsewhere.

## 7. Open questions

1. One room, or one room plus a tiny bathroom?
2. Goblin scale: exact eye height and furniture dimensions (take from the player
   controller and the goblin arm model).
3. How much clutter can the renderer afford alongside the FPS on the CRT?
4. Is the chair too big (comic) or sized to fit (sad)?
