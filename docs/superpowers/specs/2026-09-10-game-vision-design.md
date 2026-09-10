# Blud — Game Vision (draft 1)

**Status:** first draft, 2026-09-10. A riff to react to, not a commitment.
Everything below the pillars is proposal; strike what's wrong.

**Nature of this doc:** not a story bible. It is a set of *laws* that produce a
mood, the way Quake's brown stone, runes and silence produce Quake. When a
content decision is unclear, the pillars and world laws should settle it.

---

## 1. The vision (one paragraph)

You are a goblin. You weren't invited. Somewhere above you a party has been
going on forever — you can hear the kick drum through the ceiling — and you are
going up there with a sawn-off shotgun and a bundle of dynamite. The world
never explains itself. Bodies are soft and give under fire like wet clay. The
spaces are not real places; they are arranged *as if for guests*. It looks like
the prerendered CG from the back of a 1998 game box, the game those
screenshots promised and nobody shipped. It is dark, grotesque and played
completely straight, which is exactly why it's funny.

**Pitch line:** *The game from the back of the box that never existed.*
**Tagline candidate:** *You weren't invited.*

---

## 2. Pillars

Each pillar has a **therefore** (what it forces) and an **anti-goal** (what it
forbids).

### P1 — The world does not explain itself
- **Therefore:** no cutscenes, no dialogue, no codex, no voiced narrator. Meaning
  lives in names, placement, and a handful of text cards.
- **Anti-goal:** a lore wiki. If a fact needs a paragraph, cut the fact.

### P2 — Flesh gives
The SDF deformation is the heart of the game, not a feature of it.
- **Therefore:** enemies are designed *from how their body deforms and comes
  apart* (bloat, dent, tear, reveal bone), before stats or behaviour. Weapons
  are judged by what they do to a body, not by DPS.
- **Anti-goal:** hitscan-and-fall-over enemies; armour that makes a body read as hard.

### P3 — Non-places
- **Therefore:** levels are built from *function without purpose*: a queue with
  no front, a cloakroom with ten thousand hooks, a dancefloor under a cistern.
  They imply use, never a real-world location.
- **Anti-goal:** simulacra, e.g. "a realistic office", "a recognisable church",
  "a subway station".

### P4 — Played straight, staged cheap (the B-movie rule)
The camp comes from **sincerity**, not jokes.
- **Therefore:** humour lives in *names, situations and staging*. The world
  takes itself deadly seriously; the audience notices it's absurd. Think a
  creature feature with a real budget spent on the wrong things.
- **Anti-goal:** a quipping protagonist, winking at the camera, meme humour.
  The goblin never talks. It grunts, giggles, wheezes.

### P5 — Sound is architecture
- **Therefore:** music and level space are designed together. The Party's music
  is *in the world*: it bleeds through walls and gets louder as you climb.
- **Anti-goal:** a generic looping combat track pasted over a level.

---

## 3. World laws (what is true)

1. **There is always a party upstairs.** Its music never stops. Height means
   closeness to the Party.
2. **Everything is flesh eventually.** Stone, machines and guests can all turn
   soft under enough violence.
3. **Nobody speaks.** Text exists only as signs, labels, tickets, level names
   and intermission cards.
4. **Spaces are arranged, not built.** Everything looks *set out* for someone:
   chairs in rows, plates laid, hooks waiting.
5. **The goblin is always smaller than the room.** Scale is a constant pressure:
   doors too tall, tables at head height, guests who loom.
6. **What you carry down, stays.** Things dragged back to the hub remain there
   and change it.

## 4. The Never list (what is never shown or explained)

- Who throws the Party, or whether there is a host at all.
- Why the goblin wasn't invited, or what it wants at the top.
- What the world was before, or whether this is Hell / a dream / a TV show.
- The goblin's face (at most, its hands and arm).
- Any enemy's name spoken aloud. Names appear only on menus, cards and signs.

This list is the most important part of the doc. Adding to it is cheap.
Removing from it needs a real reason.

## 5. Language budget

- **Per episode:** 1 episode title, ≤ 8 level names, 1 intermission card of
  **≤ 60 words**.
- **In levels:** signs and labels only, ≤ 5 words each.
- **Menus and item names** carry the deadpan jokes (see §8).
- No subtitles needed because nothing is said.

---

## 6. The goblin (verbs, not backstory)

**Tone call:** grotesque first, funny second, never cool.

| Verb | Design consequence |
| --- | --- |
| **Scurry** | Fast, low, twitchy movement. Low eye height sells P3 world law 5. |
| **Squeeze** | Vents, gaps under tables, dumbwaiters: goblin-only routes and secrets. |
| **Scavenge** | Weapons are found junk, not issued arms. Pickups are *stolen from guests*. |
| **Haul** | Drag objects (and maybe bodies) back to the hub. See §9. |
| **Giggle** | The only "voice": wet giggles on kills, wheezes when hurt. Never words. |

The first-person hands are the character. The existing goblin arm is the most
important piece of characterisation in the game: dirty nails, knuckle hair, too
many rings stolen from guests.

## 7. Weapons (current kit, reframed)

Working names. Deadpan menu names carry the jokes.

| Asset | In-world read | Menu name (candidates) |
| --- | --- | --- |
| `shorty-double` | Sawn-off stolen from a bouncer | *The Short Answer* |
| `grapeshot-gun` | Hand-cannon loaded with whatever's in the pocket | *Loose Change* |
| `dynamite-bundle` | Party favours | *Party Favours* / *Surprise* |

Future weapon test (P2): *what does it do to a body that nothing else does?*

## 8. Guests (the roster, reframed)

Enemies are **the guests and staff of the Party**, arranged by how close to the
top they're allowed.

| Character | Role at the Party | Deformation hook |
| --- | --- | --- |
| `zombie` | **Spent guests.** Partied out, still dancing | Soft, slumping, falls apart |
| `soldier` | **Door staff / security.** Shoot back, check lists | Uniform tears to reveal soft body |
| `clown` | **The entertainment.** Hired, bitter | Rubbery, stretchy, horrible when popped |
| `bloatmaw` | **The appetite.** Floats over the buffet | Bloat and burst |
| `gnasher` | **The bouncer brute** | Heavy flesh, deep dents |
| `cyberdemon` *(working name, id's; rename)* | **The headliner** | Flesh vs. machinery |

Unplaced so far: bonewalker, cyclops, gargoyle, minotaur, dragon, mouse,
schoolgirl. Each should earn a *role at the Party* before it ships.

**Originality note:** "cyberdemon" is Doom's name. Rename anything that reads as
borrowed. The goal is our own game.

---

## 9. Structure — the hub

**Proposal: The Cloakroom.** A vast, dim, candle-and-strip-light cloakroom
beneath the Party: endless rails of coats that may be coats and may be skins, a
counter, a bell nobody answers. It's the only quiet place; dungeon synth plays
here.

- **Levels branch off the Cloakroom** through service lifts, stairwells and
  laundry chutes, grouped into **floors** (episodes). Each floor completed
  opens the way further *up*, and the Party gets louder in the hub itself.
- **Claim tickets** are the light adventure layer (the Realms of the Haunting
  door, kept cheap). Tickets found in levels are redeemed at the counter for
  whatever was checked in: a weapon, a key, a mask, something alive. No
  inventory-puzzle engine, just objects that open things.
- **Hauled things stay** (world law 6): trophies, heads, stolen décor
  accumulate in the goblin's corner. The hub is the progress bar.

### Floors (episodes), draft

| Floor | Theme | Music bias | Level-name samples |
| --- | --- | --- | --- |
| **B — Service** | Kitchens, boilers, laundry, the larder | Noise, dungeon synth | *The Larder*, *Hot Water*, *Plates Laid* |
| **G — The Queue** | Entrances, lists, doors, velvet ropes | Trap, slow and heavy | *The Queue*, *Guest List*, *No Re-Entry* |
| **1 — The Floor** | Club spaces: dancefloors inside non-places | Hard gabber | *Floorfiller*, *The Stack*, *4AM* |
| **∞ — Upstairs** | The Party itself, or its absence | All of it, then silence | *Afterparty*, *Lights Up* |

Open: does the top floor reveal an empty room with the music still playing?
(Probably yes. Also on the Never list: *why*.)

---

## 10. Level grammar (rules for non-places)

1. **Start from a function** (queueing, storing, serving, dancing), never from a
   real location.
2. **Break its purpose.** The queue loops. The cloakroom has no exit. The buffet
   serves guests.
3. **Arrange for someone absent.** Rows of chairs, laid tables, hooks.
4. **Build for a goblin's scale.** Big architecture; small routes through it.
5. **Tie space to sound.** Every level has a *music source* in its geometry (a
   speaker stack, a pipe organ, a wall that thumps) and routes that move you
   toward or away from it.
6. **Club levels move.** SDF geometry that swells and pulses on the kick. The
   tech, the sound and the setting in one mechanic.

## 11. Sound and music

**Genre stack, with jobs:**

| Layer | Job |
| --- | --- |
| **Dungeon synth** | The hub, exploration, the lonely goblin |
| **Noise** | Dread, transitions, damage, the walls breathing |
| **Trap** | Swagger and weight: security, big guests, the Queue |
| **Hard gabber** | Combat peaks, the Floor, the Party proper |

**Rules:**
- **Diegetic bleed:** the Party's track is audible, muffled, through ceilings.
  Height and proximity decide the low-pass filter.
- **Combat escalates by layering onto the room's bleed**, not by swapping tracks.
- **Silence is a weapon:** the music cutting out is the scariest event in the game.
- **Body sounds are half the gun feel.** Wet, specific and exaggerated, like
  B-movie foley rather than realistic sound.

## 12. Visual target — the magazine render

- **The reference is the prerender, not the game.** Glossy flesh, soft
  area-light falloff, slightly too-clean CG materials, dramatic single light
  sources, fog.
- **Palette:** tungsten orange, sodium, sick greens, deep bruise purples,
  flesh pinks. Blacks that crush.
- **The broadcast layer** (existing VHS / interlaced post-fx) is available as
  an *optional* framing: the whole thing as a tape of something you shouldn't
  have recorded. Candidate for menus, intermissions and the Afterparty only, to
  avoid it becoming a filter over everything.

## 13. Anti-references (what it is not)

- Not a Quake / Blood / Doom 3 remake. They're touchstones for mood and pacing,
  not content.
- Not a "boomer shooter" nostalgia pastiche with pixel sprites.
- Not a cinematic narrative game.
- Not a grimdark power fantasy. The goblin is pathetic and disgusting, and wins anyway.
- Not a realistic place, ever.

---

## 14. Fake artefacts

Written to test the tone. If these feel wrong, the pillars are wrong.

### 14.1 Back-of-box copy

> **THEY DIDN'T INVITE YOU.**
>
> Somewhere upstairs, the party of the millennium has been raging for a
> thousand years. Down here in the Cloakroom, one goblin has had *enough*.
>
> - **FLESH THAT FEELS EVERY SHOT:** revolutionary SOFTBODY™ technology
>   means no two kills are ever the same!
> - **AN ENTIRE BUILDING OF GUESTS** to disappoint: bouncers, clowns, the
>   Bloatmaw, and worse.
> - **A PULVERISING SOUNDTRACK** of noise, synth and hardcore that follows you
>   through the walls.
> - **STEAL, HAUL AND HOARD** your way from the service floors to the top.
>
> *Contains scenes of extreme gore, loud music and poor manners.*

### 14.2 Fake 1998 magazine preview

A fictional magazine, *CD-ROM INFERNO*, issue 31, "First Look" page.

> **BLUD** — *Early Look*
>
> Every few months a screenshot lands on our desk that makes the whole office
> gather round the monitor. This is that screenshot. We're told the glistening
> creature on the left, a floating mouth with arms "like a baby's", is running
> *in-engine*. We don't believe it either.
>
> The premise is pure midnight-movie: you play a goblin (yes, really) crashing a
> never-ending party, floor by floor, with a sawn-off and whatever you can pick up.
> What sets it apart is the flesh. Shoot a bouncer and his uniform tears; shoot
> him again and *he* does, dimpling like wet clay. Developers promise a hub
> world, "claim tickets", and a soundtrack they describe only as "hardcore for
> dungeons."
>
> No release date. No publisher. We want it anyway.
>
> **HYPE-O-METER: ██████████ 11**

### 14.3 Intermission card (end of Floor B)

> The dishes are done.
> Nobody thanked you.
> Above, the music changes. Someone has noticed
> the kitchen is quiet.
> They are putting your name on a list.

*(37 words, within the 60-word budget.)*

---

## 15. Open questions

1. **Hub name and conceit:** is *the Cloakroom* right, or is the hub somewhere
   else below the Party?
2. **The top:** empty room with music, a host, or never reached?
3. **Club levels:** how literal? Pulsing geometry only, or crowds of dancing
   guests that turn on you?
4. **Broadcast/VHS framing:** menus-only, or a bigger conceit?
5. **Hauling bodies:** in scope (the physics exists-ish) or trophies only?
6. **Title: unresolved, parked.** *Blud* reads as a Blood homage. Owner leans
   **GOB** or **GOON**; party-themed names rejected as titles (fine as in-game
   names). Quick Steam/itch check, 2026-09-10: *Gob* is taken three times over,
   by goblin games (Steam app 2538120; itch: gamma girl, OnePen, st33d). *Goon*
   is free as a bare title but the word is dominated by "gooning" slang in
   search and tags. Paths: GOB plus subtitle, a longer name with GOB as the
   logo, or Gob as the goblin's name inside a differently titled game.
7. **Roster cuts:** which existing characters don't belong at the Party?
