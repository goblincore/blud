# GOBLIN: a design statement (draft for the owner)

**Status:** a proposal written 2026-10-01 at the owner's request ("an overall statement of what this game is or could be,
given the references"). **Nothing here is adopted** until the owner picks from it; adopted parts move into
[vision.md](vision.md) as draft 4. One decision is already made in chat and marked **decided**.

The [vision](vision.md) has strong parts: the three layers, the Line, the knock, the CDs, the Stoker. What holds them
together today is tone. Every reference on the list is a *mood*; the game also needs one *act* the player does in every
layer, so the layers feel like one machine instead of three good ideas. This draft proposes a statement in three stacked
parts, a surface, a loop and a secret, then the systems that follow from it.

---

## 1. The statement

> **Kill inside the screen. Feed what comes out.**
> It looks like a 90s ray-traced competition still, or the prerendered cutscene from a 1997 PlayStation disc,
> and it never drops out of it.
> Secretly, it is a gestation.

### 1.1 The surface: a 90s ray-traced image you can walk around in (decided for the whole game)

**The visual law, from the owner (2026-10-01), for the whole game:** the early ray-traced CGI of the 90s, plus the modern
effects the game already has (the train level's lighting and particles). References:

- the **Stanford CS 348B rendering competition** (from 1994): student ray tracers, procedural noise, marble and wood, hard
  key lights, sharp white highlights, glass and caustics, noise-modulated blobby objects isolated in black;
- the **Internet Ray Tracing Competition** stills (IRTC, 1996–2006, mostly POV-Ray), above all the 1999 "Horror" round:
  staged gory still lifes (a pinned severed head by candlelight, a specimen in a glass tank, a severed finger in a pool of
  blood), procedural wood and brick, waxy flesh with hard highlights;
- the **prerendered cutscenes of PSX-era games** (FF7 and its peers): stylised, crude forms with a smooth, glossy finish.

"The game from the back of the box" already promised this: the box showed prerendered shots the real game never matched.
This one matches them.

**Why it fits the engine.** The SDF renderer is a ray tracer (a ray marcher), and its characters are built from blended
primitives, which is exactly how POV-Ray scenes and the competitions' "blobby" hypertextures were built. The owner: the
primitive SDF characters go well with this look *because* they are made of primitives. Do not hide it.

**Render rules that follow** (candidates for the art bible):

1. **Primitives, visibly.** Characters and props read as built from spheres, capsules, lathes and smooth blends (POV-Ray
   `blob`, CSG). Bevels are rare; joins are blends.
2. **Procedural materials.** Noise, marble, wood grain, brick, checker: slightly too clean, slightly repetitive. Flesh is
   waxy and wet with a hard highlight.
3. **Light like a 90s ray tracer.** A few hard key lights, crisp shadows, sharp white highlights, mirror metal, real glass.
   Bounce light is faked or absent; darkness falls off to black round the subject.
4. **Staged tableaux.** Rooms and set pieces are arranged like competition stills (world law 4: game places are arranged,
   not built).
5. **Modern effects on top, sparingly.** Volumetric shafts, particles, fog, the dynamic lights, the things a 1999 ray
   tracer would have rendered for hours.
6. **The VHS and CRT treatment belongs to the screen** (the Flat's CRT and moments where layers leak), not to the whole
   image.

**The Flat is shot like FMV (decided 2026-10-01).** Fixed cinematic camera angles that cut as the goblin moves (*Resident
Evil*, *FF7*, *Garage*), third person, never its face. Inside the screen **you are the goblin**; outside it **you watch the
goblin**. That is *UFO*'s voyeurism turned on the player's own character. Fixed angles are also cheap to make beautiful:
each can be lit and dressed like a render. The FPS keeps its first-person camera under the same render rules.

### 1.2 The loop: everything is hungry

One verb crosses every layer: **feeding**.

| Layer | Who eats | What |
| --- | --- | --- |
| The FPS | The guests, the Party | You make the food: bodies |
| The Line | The Stoker's fire | The bodies, shovelled in; the train climbs to the stars on them (vision §10.3) |
| The Flat | **The egg** (and the bonsai, below) | Whatever comes through the screen, and the music you play it |
| The finale | The Party | It comes downstairs for you |

Blood's carnage feeds love-de-lic's care. That tension is the point: the same player is a butcher on one side of the
glass and a nurse on the other. The Stoker already says it in one image, aspiration powered by flesh; this makes the
player do it.

**The filter for hybrid systems:** a minigame earns a place only if it is a form of feeding or tending. Point-and-click
passes (it is how you tend). A bonsai passes. Mixing a CD passes. A minigame that is only a minigame does not.

### 1.3 The secret: it is a gestation (never said)

A hidden law, like Quake's runes: it never appears in the text, but it decides content.

- **The Flat is a womb.** You cannot leave it, not yet.
- **The kick drum through the ceiling is a heartbeat.** A foetal heart runs at 110–160 bpm, which is techno tempo. Gabber
  runs above it: a heartbeat in distress.
- **The knock is someone outside the body.**
- **The FPS is the dream of something unborn**, assembled from muffled noise and borrowed games.
- **Things come through the screen wet.** Birth imagery, every time.
- **The Line is a sperm going to an egg.** The ending spec already shows the train from outside as a sperm, heading for the
  egg.
- **The vision already contains this reading without having meant it:** the door that gives under the hand, the ceiling
  that bulges, ending 3's door opening onto a lit stairwell.
- **It answers "who is the figure in the egg?"** The next goblin.

**The test it gives every content decision:** *does this belong inside a body that is waiting to be born?* It also caps the
grotesque: everything soft is warm, not rotten.

This part is optional. Parts 1.1 and 1.2 stand without it.

---

## 2. What each reference is for

A job for each, not a mood.

| Reference | Its job in GOBLIN |
| --- | --- |
| **Blood** (1997) | The inner game: feel, gore, B-movie level types (unchanged) |
| **Fallout 1 & 2** | Presentation and consequence. Fallout 1's intro **pulls back out of a TV playing an old ad into the ruined room around it**, which is our monitor transition. Its **ending slides** (one still per place, its fate in a few lines) become ours (§3.6). The deadpan retro-ad irony is our box copy and liner notes |
| **CS 348B, IRTC (POV-Ray), PSX FMV** | The visual law for every layer (§1.1): primitives, procedural materials, hard light, staged tableaux |
| **Artdink** | The Flat's slow, strange simulations. *Tail of the Sun*: a tribe builds a tower of tusks to reach the sun, which is our train to the stars, fuelled the same way |
| **Love-de-lic** | Structure. *Moon*: a game inside a game with collectable music discs you play on your own player, which is our CDs. *UFO*: routines watched in a small building. *L.O.L.*: a wordless language (the knock) |
| ***Garage: Bad Dream Adventure*** | The PC as a sticky biomechanical organ; the crude, uneasy point-and-click layer |
| ***Cookie's Bustle*** | The gentle phase's tone: toy-like, dream logic, a little wrong |
| ***Tetsuo: The Iron Man*** | Transformation outside the screen: goblin and machine fuse over the game (cables into the wrist, the mouse growing into the hand), and the FPS hands change with it |
| **Troma** | The humour: gross-out played completely straight |
| ***Angel's Egg*** | The egg, the silence, the melancholy, an ending that refuses to answer |
| **90s gabber, techno** | Tempo as structure: the heartbeat, the Party, levels built like tracks (§3.7) |

---

## 3. Systems that follow

Each is a candidate, filtered through §1.2. Sizes are rough (S/M/L).

### 3.1 The Flat as an FMV adventure (decided: fixed cameras; L)

- **Camera:** authored camera zones that cut as you move, third person.
- **Movement:** tank controls or camera-relative, decided at build time.
- **Verbs:** look, take, use, knock. You never see the goblin's face: angles, shadow, or a hood if it must.
- **Leaving:** sitting down at the desk is how you enter the FPS. The camera pushes into the screen, and Escape pulls it back
  out.

### 3.2 The egg (the Tamagotchi; M)

It arrives through the screen at the end of Night Train (the emergence) and stays on the desk by the CRT. It wants
warmth (the CRT's glow, the lamp), **food** (what comes through the screen) and **music** (CDs played to it). It grows
across the game: it pulses, it moves inside, it presses against the shell. Its state is the heart of the save file.

**Consequence:** it hatches at the end into what you fed it. Fed meat (you gibbed everything), fed music (you collected and
played), or neglected. That is the Fallout lever without a dialogue tree.

### 3.3 The flesh bonsai (the owner's idea, made of meat; M)

A cutting comes through the screen early: a small tree of meat and bone in a cracked pot. Between stops you prune it with
nail scissors, a slow, tactile Artdink simulation that feels surgical. It grows from what you bring back, and its shape
records how you played. It is the one thing in the Flat you shape by hand, and it is in the finale.

### 3.4 The mix (S–M)

Burn a CD mix from your shelf; the order matters. It is your reply under the door (the right rhythm is the right answer)
and **the finale's soundtrack is your mix** (vision §9, ending 1, already says "your CD shelf in order").

### 3.5 The knock (as in the vision; M)

A rhythm language taught by the soundtrack. Its replies are what you feed the door: a track, a knock, an object.

### 3.6 Ending slides (S)

After the finale, one prerendered still per stop on the Line, each with its fate in a line or two (inside the language
budget), decided by what you did there: bodies left, the CD found or not, the set piece triggered or not. Then the egg.

### 3.7 Levels built like tracks (design rule; S)

Each stop has an intro, a build, **a drop (the set piece the player triggers, vision §10.6 rule 9)**, a breakdown and an
outro. The level's CD is that track. The episode is an album, and the back of the box is its tracklist.

### 3.8 What tending replaces (scope)

Let feeding **replace** systems rather than add to them, because the vision is already large:

- **Decorating** shrinks to placing what came through.
- **The mail** can report on the egg and the bonsai instead of carrying its own thread.
- **Routines** (*UFO*) can be the egg's: when it sleeps, when it kicks.

---

## 4. Left-field grab bag

Unfiltered; any one could be cut.

- **The mascot:** the shareware box has a grinning cartoon goblin giving a thumbs up, the only face of the goblin anyone
  sees. A cheerful lie, played straight (Fallout's Vault Boy as a *type*).
- **Attract mode:** leave the desk idle and the FPS plays a ghost of your last run on the CRT, and the goblin watches it.
- **Loading as FMV:** level loads are short prerendered stills or loops in the FMV look, compressed to look like the era.
- **The manual:** a printed-style manual for the shareware game, with pages that change between phases.
- **Eggs as saves:** the save slots are eggs on the desktop.
- **Music changes what grows:** play the egg gabber and it kicks and darkens; play it dungeon synth and it sleeps.
- **Baked light in the Flat:** light the Flat in Blender and bake it, so the room is *literally* prerendered.
- **The goblin's hands:** the FPS hands and the Flat's hands change together (Tetsuo), so the layers leak through the one
  body part both layers show.

## 5. Open questions for the owner

1. Which parts of §1 land beyond the surface (decided): the loop (feeding), the secret (gestation)? Both, or which?
2. Does the egg in the Flat (§3.2) carry the game's consequence, so it hatches into what you fed it?
3. Bonsai: in or out? If in, does it come through the screen (a cutting from a level) or is it there from the start?
4. Does tending replace decorating and the mail thread (§3.8), or sit beside them?
