# The nosferatu — design (2026-10-27)

Owner, after the skeleton-cloak cost note (`docs/dev-notes/2026-10-27-skeleton-cloak-cost/NOTES.md`): "take the
existing cultist body and make it into a separate character — like a nosferatu type character that casts magic or
something". The owner's choices:

- **The look plus one spell**, not a spell system.
- **The cultist is unchanged.** The nosferatu is a copy that diverges. The cultist keeps its body until the
  cloaked-skeleton work replaces it, which is a separate spec.
- **A bald head and a long dark coat** (the Orlok read), not a hood.
- **The spell is a bat swarm.** The bats are **shootable and die in one hit**.

## 1. The character

**`characters/nosferatu.blob`**, copied from `cultist.blob` as it is on main, then changed as below. It gets a
registry entry `nosferatu` in `character-registry.ts`. The arena picks it up through `arenaCharacters()`, and
`?level=arena&spawn=nosferatu` shows it.

- **Skeleton.** The cultist's (the zombie's) skeleton, more hunched: more `pitch` on the spine and neck, so the head
  leads and the shoulders round forward. The `hem` pendulum stays: the coat's skirt rides it.
- **Head: bald and bare.** The hood, drape and peak shells are deleted, and so is the `when=dead` hood-down set.
  - **The skull is a tall, narrow dome.** The face block's head is taller and narrower; the jaw stays gaunt.
  - **Pointed ears:** one tapered, chamfered prim each side, swept up and back past the crown line.
  - **Two rat-like front incisors,** long and close together at the centre of the upper jaw. They replace the
    cultist's eight-tooth snaggle row.
  - **The hooked nose is kept.**
  - **Sockets and ember eyes are kept,** under a heavier, lower brow.
  - **Skin:** pale, cold grey-white, bruised violet round the eyes. That is a palette change.
- **Hands: long claws.** Four fingers per hand, longer than the cultist's (about 1.3x), each ending in a tapered
  nail prim. The bony wrist is kept.
- **The long coat.** The robe skirt and capelet shells are kept, recoloured **charcoal**, as are the bell cuffs. The
  painted sleeves and torso take the same charcoal. The skirt keeps `warp=` folds only if the cost check below
  allows it.
- **Prim budget.** The cultist's head cluster is 24 prims and is the reason it costs 5-8x a zombie (the cost note).
  The nosferatu's head must come in **at or under 20 prims**, with the hood and peak gone and the teeth down from
  eight to two. Detail beyond that (wrinkles, veins on the dome, brow furrows) goes in a baked body normal map
  (`<char>.detail`), per the biomech style, not as prims.
- **Motion profile.** `motionProfileFor('nosferatu')`:
  - It starts from the cultist's **GLIDE** gait (short low steps that stay inside the coat).
  - It is **not a soft target**: zombie damage rules, wounds and gore. He is a gore target. Since he bleeds, his
    coat takes `clothifyWound` tears rather than `clothDecal` marks.
  - **His melee is a two-handed claw rake** in the zombie's melee band. It reuses the zombie's swing variants with
    the arms raised higher.

## 2. The caster mind

**`nosferatuMind`** in `webgpu/enemy-mind.ts` is built the way the gibbet's squirt mind is: the melee mind, plus a
ranged attack in a distance band.

- **Tuning** (`NOSFERATU_TUNING`, beside `GIBBET_TUNING` in `hound-attack.ts` or in its own file if that one has
  grown too large):
  - `castBand: { min: 4, max: 14 }` m. The player must be visible.
  - `castSec: 0.9`: the whole cast.
  - The swarm leaves at phase 0.7, so about **0.6 s of tell**.
  - `castCooldown: 5.0` s; `castFirst: 1.5` s after he first sees you.
- **The cast.** In the band and off cooldown, he halts, turns to face the player and plays a **`cast` pose**: the
  right arm rises, palm forward and claws spread, and the head tips back. On the fire frame (a `castFires(prev,
  phase)` edge, like `squirtFires`), `fire` goes up for one frame.
- **Where the swarm leaves from.** `game-actor` places the swarm at the right hand through `MotionProfile.spit`
  (`from: 'handR'`, the wrist joint, plus an offset to the palm). `game-spawn` creates the swarm there, heading for the player.
- **Inside `castBand.min`** he walks in and claws. A stagger cancels a cast, as it cancels a squirt.
- **The cast's dark-red glow.** A point light at the palm ramps up over the tell, so the cast reads in a dark room.
  It uses an existing dynamic-light path (the plan picks which: muzzle flash or tracer lights), with no new light
  type.

## 3. The bats

**`bats.ts`**, plain data like `bile.ts` and `rockets.ts`: no three, no clock, no world of its own. `game-tick`
steps it with the world's segment tests.

- **The swarm.** One cast releases **8 bats**. Each bat has a position, velocity, flap phase, HP 1, age and state
  (`seek`, `retreat`, `dead`).
- **Steering** runs every step, per bat:
  - **seek** the player's head height;
  - **cohesion** toward the swarm centre;
  - **separation** from bats within 0.25 m;
  - a seeded **jitter**, so the flight flutters.
  - The steering is clamped to a maximum speed of **6 m/s**, so a running player can outpace the swarm for a
    while.
  - Bats collide with walls, floor and ceiling through the world segment test, sliding along them, never through.
- **Contact.** A bat within 0.35 m of the player's head **nips**: **4 damage** (player-vitals scale: a zombie bite is
  10). Then it **retreats** for 0.6 s (it flies off and up) before seeking again. A swarm that all lands at once is
  about 32 damage, which is the threat.
- **Lifetime.** After **6 s** a bat disperses: it flies up and away and shrinks out (an opaque bat, so no transparent pass), doing no damage.
- **Shooting bats.** Pellets, slugs and SMG rounds already step as segments (`traceProjectile`). Each segment is
  also tested against the live bats as spheres (radius **0.12 m**, generous for a small target, with the
  `segmentNearAnySphere` shape).
  - The first bat hit **dies and the round stops**. A shotgun's spread of pellets is what clears a swarm.
  - **A dynamite blast** kills every bat within its radius.
  - **A dead bat** drops under gravity, bounces once on the floor and is removed after 3 s.
- **Determinism.** All randomness comes from a seeded RNG passed in, never `Math.random`, so a recorded run replays
  the same swarm. The plan finds the game's seeded source (`?seed=`) and threads it.
- **Telemetry** events: `bat-cast`, `bat-nip`, `bat-kill`, `bat-expire`, like bile's `bile-splash`.

### Drawing the bats

**`webgpu/bat-view.ts`**: one `THREE.InstancedMesh` for every live bat in the level. It is the pattern of the blood
view's instanced drops.

- **The mesh** is a low-poly bat, 40-80 triangles: a body, two wings and ears. It is built in code or exported from
  Blender. If exported, it is a small committed `.glb` under `public/assets/lab/`.
- **The flap** is done in the vertex shader. A per-instance flap phase rotates the wing vertices about the body's
  long axis, and dead bats hold their wings folded.
- **Material:** matte black-brown with a faint rim so they read against dark walls. Unlit by the level lights is
  acceptable if lighting them costs anything.
- **Cost:** zero march cost, one draw call. Instance count is capped at **48** (six casts' worth). Past it, a new
  cast reuses the oldest dispersing bats.

## 4. What is not in scope

- More spells, teleporting or summoning beyond the swarm.
- Bat gore beyond a falling body: no blood spray per bat.
- Changes to the cultist or the cloaked skeleton.
- Placing nosferatu in story levels. He is in the arena registry only, and level placement is a level-design task.

## 5. Testing and gates

- **Pure tests:**
  - **`bats.test.ts`:**
    - steering converges on a still target;
    - separation keeps bats apart;
    - the speed clamp holds;
    - a nip retreats the bat;
    - expiry disperses it;
    - a segment through a bat kills it and stops the round;
    - a blast kills every bat in its radius;
    - a seeded run is reproducible.
  - **The mind's tests:**
    - the cast starts only in the band and off cooldown;
    - it fires once per cast;
    - a stagger cancels it.
- **`nosferatu-blob.test.ts`**, the per-character blob test every character has:
  - it compiles with no errors;
  - every cluster is fused;
  - the head prim count is ≤ 20;
  - the ears clear the crown;
  - the incisors stand proud of the jaw.
- **The look:**
  - a `blob:shot` turntable;
  - an arena capture (`spawn=nosferatu`) of the front, the side and a cast at its fire frame;
  - the owner's verdict on the face before the spell work is judged.
- **Gameplay:** a GIF in the arena of a cast, the swarm reaching the player and a shotgun clearing it.
- **Cost gate:** `docs/dev-notes/2026-10-27-skeleton-cloak-cost/arena-cost.mjs` with
  `VARIANTS=zombie,cultist,nosferatu`. That driver lands with draft PR goblincore/blud#87; until then, take it
  from that branch. The nosferatu must come in **below the cultist** at every stage. Record the
  figures in the character's dev note.
- **The usual checks:** `npm run typecheck` and `npm run test:changed`. CI runs the rest.
