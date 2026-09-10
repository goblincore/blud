# GOBLIN — Game Vision (draft 2)

**Status:** draft 2, 2026-09-10. Draft 1 set up the pillars and the inner
game. Draft 2 adds the **meta frame**: a goblin in a basement room playing the
FPS on a beige CRT. It's a riff to react to; strike what's wrong.

**Working title:** *GOBLIN* (generic, fine for now; see §17). Replaces *Blud*.

**Nature of this doc:** not a story bible. It is a set of *laws* that produce a
mood, the way Quake's brown stone, runes and silence produce Quake. When a
content decision is unclear, the pillars and world laws should settle it.

---

## 1. The vision (one paragraph)

A goblin lives in a small basement room. Upstairs, a party has been going on
forever; the kick drum comes through the ceiling. The goblin sits at a beige
CRT and plays a shooter about crashing a party, floor by floor, with a sawn-off
and dynamite. That shooter is the real game: soft bodies that give like wet
clay under fire, non-places arranged as if for guests, the look of a 1998
magazine prerender. Around it is the room, the desktop, and mail from nobody.
The frame starts gentle and strange, and slowly turns sinister. Nothing is
explained. It is dark, grotesque and played completely straight, which is
exactly why it's funny.

**Pitch line:** *The game from the back of the box that never existed.*
**Tagline candidate:** *You weren't invited.*

## 2. Touchstones

| Source | What we take | What we leave |
| --- | --- | --- |
| **Quake** (id, 1996) | Mood as world. Implied, abstract non-places. Sound design as atmosphere | Brown palette, its runes and slipgates |
| **Blood** (Monolith, 1997) | Black humour, B-movie horror, a physical arsenal | Pop-culture quips, the talking protagonist |
| **Doom 3** (id, 2004) | Dread, darkness, light as a weapon of fear | Cutscenes, PDA lore dumps |
| ***Moon: Remix RPG Adventure*** (Love-de-Lic, 1997) | A game inside a game. A frame that questions the genre inside it. An ending that steps outside | Its RPG critique aimed at the inner game (ours doesn't undermine itself) |
| ***UFO: A Day in the Life*** (Love-de-Lic, 1999) | Schedules and routines, noticing, a small building as a whole world | Photo-cataloguing as the core loop |
| ***L.O.L. Lack of Love*** (Love-de-Lic, 2000) | Wordless meaning, behaviour as language | — |
| **Artdink** | Strange, tactile simulation; a whole odd machine built for you | Slowness in the shooter |
| ***Realms of the Haunting*** (Gremlin, 1997) | FPS mixed with adventure objects | FMV, heavy puzzles |
| **Prerendered CG in 90s magazines** | The visual target (§14) | — |

---

## 3. Pillars

Each pillar has a **therefore** (what it forces) and an **anti-goal** (what it
forbids).

### P1 — The world does not explain itself
- **Therefore:** no cutscenes, no dialogue, no codex, no voiced narrator. Meaning
  lives in names, placement, objects and short text on screens.
- **Anti-goal:** a lore wiki. If a fact needs a paragraph, cut the fact.

### P2 — Flesh gives
The SDF deformation is the heart of the game, not a feature of it.
- **Therefore:** enemies are designed *from how their body deforms and comes
  apart* (bloat, dent, tear, reveal bone), before stats or behaviour. Weapons
  are judged by what they do to a body, not by DPS.
- **Anti-goal:** hitscan-and-fall-over enemies; armour that makes a body read as hard.

### P3 — Non-places (inside the game) and one real place (outside it)
- **Therefore:** FPS levels are built from *function without purpose*: a queue
  with no front, a cloakroom with ten thousand hooks. The goblin's room is the
  opposite: small, specific, lived-in, *real*. The contrast is the point.
- **Anti-goal:** simulacra in the FPS ("a realistic office"); a generic,
  undecorated room outside it.

### P4 — Played straight, staged cheap (the B-movie rule)
The camp comes from **sincerity**, not jokes.
- **Therefore:** humour lives in *names, objects, situations and staging*. The
  world takes itself deadly seriously; the audience notices it's absurd.
- **Anti-goal:** a quipping protagonist, winking at the camera, meme humour.
  The goblin never talks. It grunts, giggles, wheezes.

### P5 — Sound is architecture
- **Therefore:** music and space are designed together, in both layers. The
  Party's music is *in the world*: through the ceiling of the room, and through
  the walls of the levels.
- **Anti-goal:** a generic looping combat track pasted over a level.

### P6 — The shooter is the product; the frame is where the strange lives
- **Therefore:** the FPS is complete and great on its own; someone who never
  touches the desktop still gets a full game. The frame is *seasoning*: it's
  where the weirdness, the mail, the room and the ending live.
- **Anti-goal:** an inner game that's a prop (the trap in most "game inside a
  computer" games), or a frame that mocks the shooting and makes it feel pointless.

---

## 4. The three layers

| Layer | What it is | Its job | Camera |
| --- | --- | --- | --- |
| **0. The Room** | A small basement flat. The goblin's, fully seen, decorated over time. **You can never leave it** | Home, mood, the Party through the ceiling, the ending | First person; walk and look anywhere inside |
| **1. The Desktop** | A made-up 90s OS on the beige CRT: the FPS icon, mail, files, a music tracker, a screensaver | The adventure layer; mysterious messages; bridge between room and game | Looking at the monitor |
| **2. The FPS** | The full shooter: floors (episodes) with the Cloakroom hub | The main game | Full shooter, bezel pushed almost out of view |

**Moving between layers is a camera move, never a menu.**
- Sit at the desk → the camera leans into the monitor → the desktop.
- Launch the FPS → the camera pushes in until the bezel is a faint edge.
  (An option lets people remove it entirely.)
- **Escape pulls back:** from the FPS to the desktop, from the desktop to the
  room. The pause menu *is* pulling back.

**Tech note:** the bezel means a smaller render target when framed, and it's
a natural home for the existing CRT / VHS / interlaced post-fx. The room is a
real SDF scene, so it's fair game for deformation later (§6).

---

## 5. World laws (what is true)

1. **There is always a party upstairs.** In the building *and* in the FPS. Its
   music never stops. Height means closeness to the Party.
2. **Everything is flesh eventually.** Stone, machines and guests can all turn
   soft under enough violence. Late in the game, the room isn't exempt.
3. **Nobody speaks.** Text exists only on screens and paper: signs, labels,
   level names, intermission cards, mail, notes under the door.
4. **Spaces in the FPS are arranged, not built.** Everything looks *set out*
   for someone: chairs in rows, plates laid, hooks waiting.
5. **The goblin is always smaller than the room it's in.** Doors too tall,
   tables at head height, guests who loom. The basement is the one room that
   fits.
6. **What you carry out, stays.** Things taken from the FPS end up on the
   desktop as files, and some end up in the room as objects.
7. **The layers leak, and leaking increases with progress.** Early on the
   layers are separate. By the end, they aren't.

## 6. The Room

**Small, specific, the goblin's.** Seeing someone's room is seeing who they
are, so the room does the characterisation the goblin never says.

**Walkable, but you can't leave.** First person, walk and look anywhere in the
flat: one main room, maybe a cupboard-sized bathroom or kitchenette. The front
door is there, and it is the most important object in the flat, because it
never takes you out. The reason is on the Never list (§10). How it refuses
is design space, and it should shift with the tone phases (§8):

- **Gentle:** the goblin reaches for the handle and just... doesn't. Turns back
  to the room, as if it forgot why it got up.
- **Strange:** the handle turns, the door opens a crack, and there's the same
  room again from the other side, or a second door right behind it.
- **Sinister:** the door is soft. It gives under the hand, like the guests do.

Notes under the door, catalogues and parcels still arrive. Things come in;
the goblin doesn't go out. The high window shows only feet passing and light
from upstairs. So the one thing the ending has to deliver is **leaving**
(§9).

**Contents at start:** a desk and the beige CRT, a chair too big for a goblin,
a mattress, the front door, the high basement window, pipes that carry the
music, a bucket under a leak.

**Decorating (the fun part):**
- **Trophies come through the monitor.** Beat a floor, find a secret, and an
  object turns up in the room: a guest's shoe on the shelf, a claim ticket
  pinned to the wall, a jar with something in it.
- **Mail-order.** Catalogues arrive under the door; ordering uses in-game
  currency found in the FPS (loose change from guests). Posters, lamps, a rug,
  a fish tank with something wrong with the fish.
- **Placement is free.** Objects can be put anywhere, like a doll's house. No
  grid, no score, just the goblin's taste.
- **The room remembers.** Decorations are part of the save and appear in the
  ending (§9).

**Routines (UFO influence):** the building has a schedule, heard more than seen.
Footsteps at certain times, the pipes knocking, someone who takes the rubbish
out, the party's set changing on the hour. Paying attention unlocks things.

**The mirror problem:** the Never list says the goblin's face is never shown.
The room has a mirror that is always cracked, fogged or covered. Uncovering it
is late-game and sinister.

## 7. The Desktop

A made-up OS ("*working name*: the OS on the goblin's computer"), built around
a small set of apps that grows over time. **Not** a copy of Windows: its own
look, its own click sounds, its own bugs.

| App | Purpose |
| --- | --- |
| **The FPS** | The icon for the game. Its box art is on the desk next to the monitor |
| **Mail** | Messages from nobody. Gentle, then strange, then sinister |
| **Files** | Where things carried out of the FPS land: `.BMP`s, saves, maps, sounds |
| **Tracker** | A music tracker with the soundtrack's patterns. Unlocked songs play in the room |
| **Screensaver** | Runs when idle. It changes. It shouldn't |
| **Later/optional** | A BBS over the modem, a paint program, a disk-space warning that grows |

**Cheat codes work across layers.** Typed in the FPS console, some change the
game; typed on the desktop, some change the room.

## 8. Tone of the frame: gentle → strange → sinister

The frame shifts in **three phases**, driven by FPS progress (and, lightly, by
time spent in the room). It never becomes jump-scare horror; the dread is
*quiet*.

| Phase | Floors | Room | Desktop | Party upstairs |
| --- | --- | --- | --- | --- |
| **Gentle** | B | Cosy clutter, warm lamp, catalogue arrives | Friendly spam, a chain letter, a helpful tip | Muffled, cheerful |
| **Strange** | G–1 | Objects move slightly; routines change; a knock | Mail mentions what you did in the last level. Files you didn't create | The track is one from *inside the FPS* |
| **Sinister** | ∞ | Pipes breathe; the ceiling bulges softly; the mirror | Mail mentions things you *haven't done yet*. The FPS icon won't close | Silence, or a single slow kick |

**Rule for the sinister phase:** the room gets strange, never gory. The gore
lives in the FPS. When the frame finally turns fleshy (law 2), it should be
the most shocking moment in the game precisely because it's been withheld.

---

## 9. Endings (layers connected)

The outer ending hasn't been decided. These are candidates, all connected to the
Party and the inner game's top floor, *Upstairs*.

### A — Going upstairs
The FPS's last floor is the building itself: the same stairwell, the same door,
rendered as a level. Clearing it, the music in the room stops too. The goblin
stands up from the chair, and the camera, for the first time, follows it to the
room's door. It opens onto the stairs. Cut.
*Never explained:* whether the goblin went, or whether it ever came back down.

### B — The invitation
After the last floor, an envelope comes under the door: an invitation. The
room is quiet. The player chooses: go upstairs (and the game ends), or stay
and decorate forever (and the party carries on, forever). *Moon*-like: the
choice is framed as whether to stop playing.

### C — Lights up
The only way to end the game is to switch off the CRT. The screen collapses to
a dot. In the silence, you realise the ceiling isn't thumping, and maybe never
was. The room remains; the decorations remain. A last note under the door.

### D — Guest list
Everything decorated in the room turns up in the final FPS level, arranged at
the Party *as if for a guest*: the rug, the lamp, the fish tank. The goblin was
furnishing the party all along. Ties decorating directly into the ending.

**Current lean:** combine **D** (the payoff for decorating) with **A** or **B**
(the step outside). C is the most *Moon*, but risks feeling like a trick.
Since the goblin can never leave the flat during play (§6), walking out of the
front door is the strongest single payoff the game has. That favours **A** or
**B**, and means C should only exist as a false ending, if at all.

---

## 10. The Never list (what is never shown or explained)

- Who throws the Party, or whether there is a host at all.
- **Whether the Party in the FPS and the party upstairs are the same party.**
- **Who sends the mail, or how they know.**
- **Why the goblin can't leave the flat.** Locked, afraid, forbidden, or
  something about the door itself: never said.
- Why the goblin wasn't invited, or what it wants at the top.
- What the world was before, or whether this is Hell / a dream / a TV show.
- The goblin's face. At most: hands, arm, a shadow, a covered mirror.
- Any enemy's name spoken aloud. Names appear only on screens and paper.

This list is the most important part of the doc. Adding to it is cheap.
Removing from it needs a real reason.

## 11. Language budget

- **FPS, per floor:** 1 floor title, ≤ 8 level names, 1 intermission card of
  **≤ 60 words**; in-level signs and labels ≤ 5 words.
- **Desktop mail:** ≤ 40 words per message, ≤ 3 new messages per floor. No
  sender names. Subjects do a lot of the work.
- **Room:** notes under the door ≤ 12 words; catalogues are item names and prices.
- **Menus and item names** carry the deadpan jokes.
- Nothing is voiced, so nothing needs subtitles.

---

## 12. Inside the FPS

### 12.1 The goblin (verbs, not backstory)

**Tone call:** grotesque first, funny second, never cool. Inside the FPS the
goblin is a "character" in the goblin's game. Whether it's meant to be the
goblin itself is on the Never list by implication.

| Verb | Design consequence |
| --- | --- |
| **Scurry** | Fast, low, twitchy movement. Low eye height sells world law 5 |
| **Squeeze** | Vents, gaps under tables, dumbwaiters: goblin-only routes and secrets |
| **Scavenge** | Weapons are found junk, not issued arms. Pickups are *stolen from guests* |
| **Haul** | Carry objects back to the Cloakroom, and out through the screen to the room |
| **Giggle** | The only "voice": wet giggles on kills, wheezes when hurt. Never words |

The first-person hands are the character. The existing goblin arm matters more
than any other piece of characterisation: dirty nails, knuckle hair, too many
rings stolen from guests.

### 12.2 Weapons (current kit, reframed)

| Asset | In-world read | Menu name (candidates) |
| --- | --- | --- |
| `shorty-double` | Sawn-off stolen from a bouncer | *The Short Answer* |
| `grapeshot-gun` | Hand-cannon loaded with whatever's in the pocket | *Loose Change* |
| `dynamite-bundle` | Party favours | *Party Favours* / *Surprise* |

Future weapon test (P2): *what does it do to a body that nothing else does?*

### 12.3 Guests (the roster, reframed)

| Character | Role at the Party | Deformation hook |
| --- | --- | --- |
| `zombie` | **Spent guests.** Partied out, still dancing | Soft, slumping, falls apart |
| `soldier` | **Door staff / security.** Shoot back, check lists | Uniform tears to reveal soft body |
| `clown` | **The entertainment.** Hired, bitter | Rubbery, stretchy, horrible when popped |
| `bloatmaw` | **The appetite.** Floats over the buffet | Bloat and burst |
| `gnasher` | **The bouncer brute** | Heavy flesh, deep dents |
| `cyberdemon` *(working name, id's; rename)* | **The headliner** | Flesh vs. machinery |

Unplaced: bonewalker, cyclops, gargoyle, minotaur, dragon, mouse, schoolgirl.
Each should earn a *role at the Party* before it ships.

### 12.4 Structure: the Cloakroom and floors

**The Cloakroom** is the FPS's own hub: a vast, dim cloakroom beneath the
Party, endless rails of coats that may be skins, a counter, a bell nobody
answers. Dungeon synth plays here.

- **Levels branch off it** through service lifts, stairwells and laundry chutes,
  grouped into **floors** (episodes). Clearing a floor opens the way *up*.
- **Claim tickets** are the light adventure layer: found in levels, redeemed at
  the counter for a weapon, a key, a mask, something alive. **Some tickets
  can't be redeemed in the game;** they work on the desktop or in the room.
- **Hauled things stay:** trophies accumulate in the goblin's corner of the
  Cloakroom, which mirrors the room outside.

| Floor | Theme | Frame phase | Music bias | Level-name samples |
| --- | --- | --- | --- | --- |
| **B — Service** | Kitchens, boilers, laundry, the larder | Gentle | Noise, dungeon synth | *The Larder*, *Hot Water*, *Plates Laid* |
| **G — The Queue** | Entrances, lists, doors, velvet ropes | Strange | Trap, slow and heavy | *The Queue*, *Guest List*, *No Re-Entry* |
| **1 — The Floor** | Club spaces inside non-places | Strange | Hard gabber | *Floorfiller*, *The Stack*, *4AM* |
| **∞ — Upstairs** | The Party itself, or the building (§9) | Sinister | All of it, then silence | *Afterparty*, *Lights Up* |

### 12.5 Level grammar (rules for non-places)

1. **Start from a function** (queueing, storing, serving, dancing), never from a
   real location.
2. **Break its purpose.** The queue loops. The cloakroom has no exit. The buffet
   serves guests.
3. **Arrange for someone absent.** Rows of chairs, laid tables, hooks.
4. **Build for a goblin's scale.** Big architecture; small routes through it.
5. **Tie space to sound.** Every level has a *music source* in its geometry and
   routes toward or away from it.
6. **Club levels move.** SDF geometry that swells and pulses on the kick.
7. **Late levels borrow from the room.** A pipe, a bucket, the rug. Small at
   first.

---

## 13. Sound and music

**Genre stack, with jobs:**

| Layer | Job |
| --- | --- |
| **Dungeon synth** | The Cloakroom, exploration, the lonely goblin |
| **Noise** | Dread, transitions, damage, the walls breathing |
| **Trap** | Swagger and weight: security, big guests, the Queue |
| **Hard gabber** | Combat peaks, the Floor, the Party proper |

**Rules:**
- **Diegetic bleed, in both layers.** In the room, the Party is heard through
  the ceiling. In the FPS, through walls. Height and proximity decide the low-pass.
- **Pulling back is a mix.** From the FPS to the desktop, the game audio shrinks
  to the CRT's small speaker while the room's sound rises.
- **The room has a quiet soundscape:** CRT whine, pipes, the leak, footsteps.
- **Combat escalates by layering onto the room's bleed**, not by swapping tracks.
- **Silence is a weapon:** the music cutting out, in either layer, is the scariest
  event in the game.
- **Body sounds are half the gun feel.** Wet, specific and exaggerated, like
  B-movie foley rather than realistic sound.

## 14. Visual target

- **The FPS: the magazine render.** Glossy flesh, soft area-light falloff,
  slightly too-clean CG, dramatic single light sources, fog. Palette: tungsten
  orange, sodium, sick greens, deep bruise purples, flesh pinks, crushed blacks.
- **The Desktop: its own 90s OS.** Beige, bevels, pixel fonts, dithered icons.
  Ours, not Windows.
- **The Room: warm, cheap, real.** One lamp, CRT glow, grey light from the high
  window. The same SDF renderer as the game, but softer and more homely, until
  the sinister phase.
- **Broadcast layer** (existing VHS / interlaced post-fx): belongs to the CRT
  and to moments where the layers leak.

## 15. Anti-references (what it is not)

- Not a Quake / Blood / Doom 3 remake. Touchstones for mood and pacing, not content.
- Not a "boomer shooter" nostalgia pastiche with pixel sprites.
- Not a cinematic narrative game.
- Not a meta game where the inner game is a prop (P6).
- Not an ARG / creepypasta jump-scare frame. The dread is quiet.
- Not a grimdark power fantasy. The goblin is pathetic and disgusting, and wins anyway.
- Not a realistic place inside the FPS, ever. The room is the only real place.

---

## 16. Fake artefacts

Written to test the tone. If these feel wrong, the pillars are wrong.

### 16.1 Back-of-box copy

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

*(This is the box of the game* inside *the game. It sits on the goblin's desk.)*

### 16.2 Fake 1998 magazine preview

A fictional magazine, *CD-ROM INFERNO*, issue 31, "First Look" page.

> Every few months a screenshot lands on our desk that makes the whole office
> gather round the monitor. This is that screenshot. We're told the glistening
> creature on the left, a floating mouth with arms "like a baby's", is running
> *in-engine*. We don't believe it either.
>
> The premise is pure midnight-movie: you play a goblin (yes, really) crashing a
> never-ending party, floor by floor, with a sawn-off and whatever you can pick up.
> What sets it apart is the flesh. Shoot a bouncer and his uniform tears; shoot
> him again and *he* does, dimpling like wet clay.
>
> No release date. No publisher. We want it anyway.
>
> **HYPE-O-METER: ██████████ 11**

*(Could exist in the room: a magazine on the floor, one page dog-eared.)*

### 16.3 Intermission card (end of Floor B)

> The dishes are done.
> Nobody thanked you.
> Above, the music changes. Someone has noticed
> the kitchen is quiet.
> They are putting your name on a list.

### 16.4 Mail, one per phase

> **Subject:** you've got mail!!
> hello new user :) remember to take breaks. drink water.
> the pipes are supposed to make that noise.
> *— Gentle*

> **Subject:** re: the larder
> you left one of the plates on the floor.
> we put it back.
> *— Strange*

> **Subject:** (no subject)
> we saved you a seat.
> it's by the rug.
> *— Sinister*

---

## 17. Open questions

1. **The outer ending:** which of §9 A–D, or something else? (Lean: D + A or B.)
2. ~~Room door~~ **Decided 2026-09-10:** the goblin can never leave the flat
   before the ending; the reason is never given. Open: exactly how the door
   refuses in each phase (§6 has candidates).
3. ~~Walkable or seated~~ **Decided 2026-09-10:** walk and look anywhere
   inside the flat. Open: is it one room, or one room plus a tiny bathroom
   or kitchenette?
4. **Mail-order economy:** is FPS currency spent in the room a good idea, or does
   it risk making the shooter feel like a grind for decorations?
5. **Club levels:** pulsing geometry only, or dancing crowds that turn on you?
6. **Title: working title GOBLIN, final title parked.** *Blud* reads as a Blood
   homage. Quick Steam/itch checks, 2026-09-10: *Gob* is taken three times over,
   by goblin games (Steam app 2538120; itch: gamma girl, OnePen, st33d). *Goon*
   is free as a bare title but the word is dominated by "gooning" slang. *Gloom*
   is heavily taken, including a 1995 Amiga Doom clone. Other threads: foreign
   words (*Gobelin*, *Rausch*, *Gaki*, *Duende*), and a separate campy name for the
   *inner* FPS, which the frame now allows.
7. **Roster cuts:** which existing characters don't belong at the Party?
8. **Scope:** what's the smallest frame that proves the idea? Suggest: room
   (no decorating yet), desktop with FPS + mail + files, one floor, one leak.
