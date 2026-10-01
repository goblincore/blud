# GOBLIN: a design statement (draft 2, for the owner)

**Status:** draft 2, 2026-10-01, from a long conversation with the owner. Parts marked **agreed** are the owner's
direction from that conversation; everything else is a proposal. Agreed parts move into [vision.md](vision.md) as draft 4
when the owner says so. Draft 1's "everything is hungry" loop is replaced by §3 (the owner found a meat economy less fun
than plain shooting).

The [vision](vision.md) has strong parts: the three layers, the Line, the knock, the CDs, the Stoker. What held them
together was tone. This draft gives the game a **shape**: a classic shooter that turns into flesh, with the turn caused
by something you raise.

---

## 1. The statement

> **A shareware shooter that turns into flesh.** For the first third it is a classic FPS. Then an egg comes out of the
> screen, and what hatches crawls into your computer, and the game you play mutates with it. Above you, the Party
> spreads down your tower; the train climbs up to meet it.
> It looks like a 90s ray-traced competition still, or the prerendered cutscene from a 1997 PlayStation disc.

### 1.1 The surface: a 90s ray-traced image you can walk around in (agreed, the whole game)

**The visual law, from the owner, for the whole game:** the early ray-traced CGI of the 90s, plus the modern effects the
game already has (the train level's lighting and particles). References:

- the **Stanford CS 348B rendering competition** (from 1994): student ray tracers, procedural noise, marble and wood, hard
  key lights, sharp white highlights, glass and caustics, noise-modulated blobby objects isolated in black;
- the **Internet Ray Tracing Competition** stills (IRTC, 1996–2006, mostly POV-Ray; browse at
  <https://www.irtc.org/ftp/pub/stills/>), above all the 1999 "Horror" round: staged gory still lifes, procedural wood and
  brick, waxy flesh with hard highlights;
- the **prerendered cutscenes of PSX-era games** (FF7 and its peers): stylised, crude forms with a smooth, glossy finish.

"The game from the back of the box" already promised this: the box showed prerendered shots the real game never matched.
This one matches them.

**Why it fits the engine.** The SDF renderer is a ray tracer (a ray marcher), and its characters are built from blended
primitives, which is how POV-Ray scenes and the competitions' "blobby" hypertextures were built. The owner: the primitive
SDF characters go well with this look *because* they are made of primitives. Do not hide it.

**Render rules** (candidates for the art bible):

1. **Primitives, visibly.** Characters and props read as built from spheres, capsules, lathes and smooth blends.
2. **Procedural materials.** Noise, marble, wood grain, brick, checker: slightly too clean, slightly repetitive. Flesh is
   waxy and wet with a hard highlight.
3. **Light like a 90s ray tracer.** A few hard key lights, crisp shadows, sharp white highlights, mirror metal, real glass.
   Bounce light faked or absent; darkness falls off to black round the subject.
4. **Staged tableaux.** Rooms and set pieces are arranged like competition stills (world law 4).
5. **Modern effects on top, sparingly.** Volumetric shafts, particles, fog, the dynamic lights.
6. **The VHS and CRT treatment belongs to the screen**, not to the whole image.
7. **Not too smooth** (owner): period CGI had aliasing, hard terminators, visible procedural noise and low-resolution
   textures. A clean, denoised, soft-bounced modern finish reads as the wrong decade.

### 1.2 The shape (agreed)

| Part | What you do | What changes |
| --- | --- | --- |
| **The opening** (owner: 1–2 levels) | A classic FPS with the junk weapons (sawn-off, flail, grenade launcher...), stop by stop on the Line | The Flat is quiet; the frame is gentle |
| **The egg** | Night Train (or the second level) ends: the egg in the control room, the montage, the pull-back, **the egg comes out of the screen** ([emergence spec](../superpowers/specs/2026-10-01-flat-screen-emergence-design.md)) | The egg sits in the Flat |
| **The incubation** (a few levels) | More levels, still classic shooting; between them you tend the egg, which grows and changes, mysterious | The egg is the clock |
| **The hatching** (about the midpoint) | One morning it has hatched. It **crawls into the computer** and nests in the case | The machine starts to change |
| **The second half** | Shooting as before, but **your weapons mutate**, each into a biomech hybrid with a body effect nothing else has (§3.3); dreams open up | The machine mutates (§3.4); the Party's music grows louder (§3.7) |
| **The end** | The terminus, the Party in your flat, the birth (§4); open (owner thinking) | |

The shooter stays the product (vision P6): the Flat is where its consequences live, between stops, a few minutes at a time.

### 1.3 The secret: it is a gestation (proposed, never said)

A hidden law: it never appears in the text, but it decides content.

- **The Flat is a womb.** You cannot leave it, not yet.
- **The kick drum through the ceiling is a heartbeat.** A foetal heart runs at 110–160 bpm, which is techno tempo. Gabber
  runs above it: a heartbeat in distress.
- **The knock is someone outside the body.**
- **The FPS is the dream of something unborn**, assembled from muffled noise and borrowed games.
- **Things come through the screen wet.** The Line is a sperm going to an egg.
- **It answers "who is the figure in the egg?"** The next goblin.

The test it gives a content decision: *does this belong inside a body that is waiting to be born?* Optional: the shape
in §1.2 stands without it.

---

## 2. What each reference is for

| Reference | Its job in GOBLIN |
| --- | --- |
| **Blood** (1997) | The inner game: feel, gore, B-movie level types |
| **Fallout 1 & 2** | Fallout 1's intro **pulls back out of a TV into the ruined room round it**: our monitor transition. Its **ending slides** become ours (§4). The deadpan retro-ad irony is our box copy |
| **CS 348B, IRTC (POV-Ray), PSX FMV** | The visual law (§1.1) |
| ***Garage: Bad Dream Adventure*** | **The Flat's interior design** (owner): grounded but otherworldly, industrial Giger-esque metal with organic forms; the uneasy point-and-click layer |
| **H. R. Giger** | The biomechanical vocabulary: ribs, vertebrae, hoses, chrome-bone; the machine's later stages ("if Giger made an iMac") |
| ***Eraserhead*** (Lynch) | **The creature:** the swaddled, wheezing, needy thing, and the relationship (obligation, disgust, tenderness) |
| **Cronenberg** (*Scanners*, *Videodrome*, *The Fly*, *eXistenZ*) | Flesh tech: the breathing screen, the flesh gun, the gristle gun, transformation in stages; **more bugs** (owner) |
| ***Tetsuo: The Iron Man*** | Fusion: the creature and the machine, and in the end the goblin's own hands |
| **Artdink** | Strange, slow simulations; *Tail of the Sun*'s tower to the sun is our Line |
| **Love-de-lic** | *Moon*'s game inside a game and its music discs (our CDs); *UFO*'s routines watched in a building (our window); *L.O.L.*'s wordless language (the knock) |
| ***Cookie's Bustle*** | The gentle phase: toy-like, dream logic, a little wrong |
| **Tokyo apartments** | The Flat's room: tiny and crammed (§3.1) |
| **Bryce, Terragen** (90s landscape renderers) | **The view:** the idyll outside the window (§3.1, §3.7) |
| **Troma** | The humour: gross-out played straight |
| ***Angel's Egg*** | The egg, the silence, an ending that refuses to answer |
| **90s gabber, techno** | Tempo as structure: the heartbeat, the Party, levels built like tracks (§3.9) |

---

## 3. Systems

### 3.1 The Flat (agreed: fixed cameras; setting leaning, open)

- **Shot like FMV** (agreed): fixed cinematic angles that cut as the goblin moves, third person, never its face. Inside
  the screen you are the goblin; outside it you watch it.
- **A tiny, crammed room** (owner): like a Tokyo apartment, a six-tatami hikikomori room filled with stuff. The computer
  on a **low table** with floor sitting (leaning), a futon for the bed (§3.6), a kitchenette.
- **High up, and outside is paradise** (owner): not a dystopian city but an impossibly beautiful idyll: fluffy volumetric
  clouds, sunsets, sometimes waves, pastoral landscapes that **shift** from day to day. A period CGI image in its own
  right: **Bryce and Terragen** landscapes. The cramped, grotesque, biomechanical room against a heaven it can never reach.
  The Line climbs through it (§3.7). [Look-dev](../dev-notes/2026-10-01-flat-emergence-lookdev/view-bryce.png): fantastical Bryce, not a natural landscape (a gas giant, floating moons, rock arches, milky seas). (Draft 2's first pass had a Kowloon-like megablock outside; the owner prefers the
  idyll. The room itself can still be a tiny, crammed, Tokyo-style flat.)
- **Interior design after *Garage*** (owner): recognisable objects in industrial, Giger-esque metal with organic forms;
  grounded first, more biomechanical as the game goes on (§3.4).
- **At home the goblin wears a stained vest and shorts** (agreed).

### 3.2 The creature (agreed direction)

- **The egg:** it comes out of the screen at the turn and sits in the Flat, warm by the machine. It grows while you
  sleep; things move inside; music changes it (gabber makes it kick, dungeon synth settles it). You cannot make it hatch.
- **The hatching:** one morning it has hatched, an *Eraserhead* baby, swaddled in the torn membrane, wheezing, crying.
- **Into the machine** (agreed): it crawls into the computer and nests in the case. **You feed it through the CD tray**,
  its mouth. It moults in stages (*The Fly*).
- **Its needs read from its body**, never from meters: it gapes, its colour and breathing change, it makes sounds.
- **What it eats are discrete finds**, not a resource: secrets in levels, the spotlight enemy's organ, a jar of
  something; bugs caught in the Flat (optional). Each food decides a mutation (§3.3).

### 3.3 Weapon mutations (agreed direction; found by experiment)

The junk weapons stay the base; after the hatching, **what you feed the creature infects the game**, and the next time
you play, a weapon has mutated into a biomech hybrid with a body effect nothing else has (vision §10.5's test). Nothing
crosses out of the game; the infection goes in through the machine, and it is never explained.

| Junk weapon | Mutated (candidates) | What it does to a body |
| --- | --- | --- |
| Sawn-off | **Brood shot** | Pellets are larvae: a hit body swells, bursts, showers its neighbours |
| Flail | **Jaw flail** | The head grows teeth, bites and holds; yank back and the limb tears away |
| Grenade launcher | **Egg-sac launcher** | Sacs stick and hatch a swarm that strips flesh to the bone |
| Flamethrower (if planned) | **The melter** | Bodies sag, slump and pool |
| *new, late* | **The splicer** | Fuses two enemies into one two-headed thing that turns on itself (the effect only this engine can do) |

**The guiding principle is slapstick body comedy** (owner): the funny ones are the interesting ones, Troma played
straight. The owner's favourites so far: **budding** (a hit enemy buds baby versions of itself that waddle and nip, or
turn on their parent) and **bloat-float** (targets inflate and drift up, squeal against the ceiling, pop). More in that
vein: **the sneeze** (a wind-up "ah... ah..." and the head goes: *Scanners* as a gag), **rubber limbs** (arms and legs go
long and noodly; enemies trip over themselves), **the flesh magnet** (hit bodies stick together and roll up into a
growing ball), **the whoopee deflate** (they sag with a rude noise), **puppet tendons** (swing a corpse as a club or a
shield), **the tongue** (yank enemies, or pull yourself to walls), **the screech** (music-fed: organs liquefy, the body
ripples and deflates). Dropped: calcify (a freeze effect by another name).

**Whether each is good is found by playing it** (owner). The cheap way: a mutation test range in the ring testbed (bare
`/sdf-game.html`, god mode) against the existing enemies. Order proposed: bloat-float or budding (the owner's favourites; bloat
reuses the bloatmaw's inflation), then the brood shot (wound stamps and gibs), then the splicer (riskiest, most distinctive). The mutated models are designed one at a time, as each mutation lands; the
junk models stay valid for the first third.

### 3.4 The machine mutates (agreed)

The PC and the CRT are the creature's body now. They change in stages, a progress clock you can see in the room:

1. **A period CRT**, slightly off (the first third).
2. **Grounded biomech:** a bone-yellow face, a ribbed gunmetal carapace, spinal hoses
   ([look-dev](../dev-notes/2026-10-01-flat-emergence-lookdev/)).
3. **Full biomech, "if Giger made an iMac"** (owner): a translucent shell with the creature visible inside, backlit like
   the candled egg.

Its case breathes, its tray comes out like a tongue, cables become veins (vision §8.1's schedule, now with a reason).

### 3.5 Dreams (agreed: sleep warps the game)

**The futon is the second door into the shooter.** Sleep, and you are back in a stop you have played, warped. A dream is
a level plus two to four rules drawn from a deck, weighted by the creature's state:

- **Data only:** slow motion; you are tiny or huge; rooms re-linked in the wrong order (the train's carriages loop
  forever); every enemy swapped for bugs or for copies of you; no weapons, and the creature hunts you; the Party bleeding
  through; the dawn that never comes.
- **Camera and post:** third person or top-down (the iso branch); through the creature's eyes (fisheye, compound-eye
  mosaic); a datamosh smear, stutter, VHS tracking errors.
- **The ML idea, made practical:** an image model run offline over a level's textures and sky makes "dreamed" versions,
  swapped in at runtime.

Start with five or six cheap rules; the deck grows. Sleep is also the clock: the egg grows per sleep and hatches one
morning.

### 3.6 The bed

The futon: sleep (§3.5) and the passage of days. Waking is where the morning's changes land (the egg, the machine, a
weapon mutated, mail, the knock).

### 3.7 The view, the Line and the Party (proposed)

- **The window is the idyll** (§3.1): a new fantastical Bryce landscape each day, and later the vision's journey (desert,
  clouds, stars) as the Line climbs. **The Line is left out of the window view for now** (owner: the first try read
  badly; how the train is shown is the owner's to decide).
- **The Party is heard, not seen** (owner): its music comes into the flat through the ceiling, muffled and distant but
  audible. That is its presence in the Flat.
- **No race** (the owner was unsure about the Party descending as a countdown). The softer version: the music simply grows
  nearer as you progress through the game, a dread that follows your progress and never punishes you for being slow. The
  owner may drop even that.

### 3.8 Kept from draft 1

- **The knock:** a rhythm language taught by the soundtrack; replies are a track, a knock, an object.
- **The mix:** burn a CD mix from your shelf; it is your reply under the door and the finale's soundtrack.
- **Levels built like tracks:** intro, build, drop (the set piece the player triggers), breakdown, outro.
- **Tending replaces rather than adds:** decorating shrinks to placing what came through; the mail reports on the
  creature; *UFO* routines are its and the neighbours'.

### 3.9 Dropped

- **A meat economy** (meat as ammo, healing and food): the owner found it less fun than plain shooting.
- **Weapons crossing out of the game** (leaving a gun by the crib): the infection goes in through the machine instead.
- **The flesh bonsai:** open (§6).

---

## 4. The ending (proposed)

1. **The terminus.** The last stop on the Line is the Party itself, the tumour at the top of your own tower. You kill the
   Host, and **the music stops** for the first time in the game.
2. **They come downstairs.** In the silence the ceiling gives and the Party pours into your flat: the one fight in your
   own room (vision ending 1), the soundtrack your mix, your mutated arsenal, the creature in the machine with you.
3. **The birth.** The creature's last moult is an egg; the epilogue depends on how you raised it and whether you learned
   the knock:
   - **raised with care, and you answered the knock:** the door opens onto a lit stairwell, and the goblin carries the
     egg out;
   - **raised on violence:** it hatches into the next Host, and the pink light starts at your floor;
   - **neglected:** it crawls back into the screen; the game boots on its own and you watch it play.
4. **Ending slides**, Fallout-style: one prerendered still per stop on the Line, each with its fate in a line or two.

---

## 5. Left-field grab bag

- **The mascot:** the shareware box has a grinning cartoon goblin giving a thumbs up, the only face of the goblin anyone
  sees.
- **Attract mode:** leave the computer idle and the FPS plays a ghost of your last run on the CRT; the goblin watches.
- **Loading as FMV:** level loads are short prerendered stills or loops, compressed to look like the era.
- **The manual:** a printed-style manual for the shareware game, with pages that change between phases.
- **Eggs as saves:** the save slots are eggs on the desktop.
- **Baked light in the Flat:** light the Flat in Blender and bake it, so the room is literally prerendered.
- **The goblin's hands:** the FPS hands and the Flat's hands change together, so the layers leak through the one body
  part both show.

## 6. Open questions for the owner

1. The gestation secret (§1.3): in or out?
2. The setting: the idyll outside (high up, above the clouds?), a low table or the desk? (§3.1)
3. The creature's look: how literal an *Eraserhead* baby, and what it becomes as it moults inside the machine?
4. Which mutation to prototype first (§3.3)?
5. The bonsai: in or out?
6. The ending (§4): the owner is thinking about it ("I guess it's okay").
7. How long is each part? The owner's current shape: 1–2 levels, the egg, a few more levels, the hatching, then the second
   half.
