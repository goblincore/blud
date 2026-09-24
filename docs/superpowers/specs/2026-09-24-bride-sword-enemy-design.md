# Bride — a sword-wielding melee enemy

**Date:** 2026-09-24
**Status:** approved (brainstorm with owner, 2026-09-24)
**Slug:** `bride`

## Goal

Add a new enemy: this game's version of Quake 1's death knight, a relentless
melee swordsman. She is fleshy and sexy rather than armoured head to toe,
because body horror is what this game mines. The pass delivers **the look and
a working sword melee in the game**: spawnable with `?spawn=bride`, closing on
the player and cleaving.

## Reference and design intent

The owner supplied an inspiration photo, which is **not committed**. It shows
a pale, waifish young woman with long dark hair and raw red-rimmed eyes. She
wears a white lace veil over her hair, a white corset bodice, a short tiered
lace ruffle skirt, cream suede thigh-high boots, and a chain belt and
necklaces hung with iron crosses. Her arms are in plate armour: vambraces,
gauntlets and a couter. She holds a longsword two-handed in a high guard over
her shoulder.

**The tension is the brief:** grotesque, yet still attractive. Every beat is
beautiful at first glance and wrong on the second look, and neither half wins.
The broodmother follows the same rule (`docs/dev-notes/2026-09-22-broodmother/NOTES.md`).

## Material split (approach A, fallback B)

| Material | What | How |
| --- | --- | --- |
| Flesh | the body, rib window, stigmata, flesh bulges at the armour seams, the hand cuff | SDF prims in `characters/bride.blob` |
| Soft cloth | corset bodice, ruffle skirt, veil | SDF `shell` prims. Lace is a PAINT pattern, not geometry |
| Stockings | ivory thigh-highs | paint on the leg flesh, with no shell layer |
| Hair | long, black, centre-parted, falling under the veil | `strand=` hairlock prims plus a scalp mass (as on broodmother and schoolgirl-described) |
| Hard kit | vambraces, gauntlets, couters, a pauldron, cream thigh boots, chain belt, cross pendants | `characters/bride-kit.wam` → `scripts/build-wam-kit.sh bride` → `public/assets/lab/bride-kit.gltf` |
| Sword | a hand-and-a-half longsword, ~1.2 m, cruciform guard | prop glb from a Blender script (`scripts/model-bride-sword.py`, following `model-cultist-smg.py`), with locators matching `GUN_GRIP` |
| Face makeup | corpse makeup and mouth sutures | a baked face sheet (`FaceSheet` in the registry), overlay-blended (the house default) |

**Fallback B:** if the perf census in step 2 shows a garment shell costs too
much (the owner already rates the cultist's all-shell costume as slow), that
garment moves into the WAM kit as mesh. The flesh stays SDF either way.

## The look

### Silhouette: wrong anatomy, the cheap version
- About 1.85 m tall, with legs roughly 10% too long, stick-thin thighs, a wasp
  waist and a neck roughly 20% too long. At distance she still reads as
  graceful and female. The proportions turn wrong as she approaches.
- **No second elbow in this pass.** Motion joints are a fixed set
  (`gait.ts` `JOINT_AT`/`GAIT_JOINTS`; `makeMotionJoints` returns null on an
  unmapped bone). Instead, the sword forearm is lengthened under the vambrace,
  and the swing arcs fake the whip-like snap.

### Face: the veil hides a wrong face
- Pretty in its parts: large dark eyes, a fine nose, high cheekbones, pale lips.
- **Structure is prims:** the sockets, the cheekbones, and a `jaw` prim hung on
  a new `jaw` bone.
- **The makeup is the baked sheet:** smoky black sockets, bruised red lids, a
  hollowed cheek contour, grey-lilac lips, faint blue temple veins, and fine
  stitched sutures running from the mouth corners back toward the ears. The
  sutures say the mouth can open far too wide.
- **The jaw gapes on the attack windup.** This needs a new optional `jaw`
  joint in the motion joint map, driven by the attack phase. If the joint map
  resists (for example, other characters start failing `makeMotionJoints`), the
  gape is cut from this pass and the sutures carry the idea alone.

### Stigmata / reliquary
- The corset bodice shell is clipped open down the sternum. Laces cross a gap
  that shows pale ribs pressing against the skin (flesh ridges or bone prims).
- Cruciform wounds on the throat and the inner thighs weep dark lines down
  beneath the painted stockings.

### Fused gauntlets
- Mesh armour covers both arms, with a pauldron on the sword shoulder.
- Flesh bulge prims swell out of the elbow crease and from under the pauldron
  rim. The paint ramps to raw red where metal meets skin, and faint veins run
  from the seams into pale skin.
- A flesh cuff grows over the sword hand into the grip: she cannot let go.

### Palette
Blue-porcelain skin, bruised red around the eyes and at the seams, ivory and
white lace, dull steel, cream suede boots.

## The sword and melee

### Profile
`BRIDE_PROFILE` in `motion-profile.ts`, added to `BY_NAME`:
- **Gait:** a new stalking gait — long, slow, deliberate strides with a slight
  sway that the `hem` pendulum picks up.
- **Carry:** a new two-handed `sword` carry in `carry.ts`. Walking holds a high
  guard with the blade raised over the right shoulder, as in the ref. Running
  lowers the point to drag near the floor.
- **Prop:** the sword glb, with a `gripReach` tuned so the cuff sits on the grip.

### Swings move the sword (new plumbing)
Today a `carry` character's carry block (`motion.ts` ~940) overwrites the swing
arm arc (~869), so a held prop never swings. The fix:
- Each swing variant gets a short keyframed **carry track** — guard → windup →
  strike → recover — expressed as `CarryArm` angles plus the left-hand pole.
- The track is sampled on the existing `attack.ts` phase clock.
- The carry block uses the track's pose whenever an attack is live, so the arm,
  both hands and the blade stay locked together.
- The path is generic, so any melee-with-prop character can reuse it (e.g. the
  ogre's saw later).

### Moves
A new mind, `makeSwordMind(tuning)` in `webgpu/enemy-mind.ts`, drives the
existing `stepBrain` with a `SWORD_TUNING`. `game-main.ts` (~3168) branches to
it on a new profile field, `melee: { kind: 'sword' }`. New `SwingVariant`s go in
`attack.ts`:

| Move | When | Feel |
| --- | --- | --- |
| **cleave** | inside reach | Overhead, two-handed. The windup is slow and readable, and the jaw gapes during it. Hits hard. |
| **sweep** | inside reach | A flat horizontal arc, faster, with a wider hit cone. |
| **lunge** | 2–3 m | A thrust with ~1.2 m of root drive to close the gap. The brain halts locomotion during an attack, so the lunge travels through `attackPose.rootOffset`, and the actor commits that offset to her position when the swing ends. |

Melee reach goes up to ~2 m. Windups are long enough to read and dodge, in the
death knight's rhythm.

### Contact and "damage"
- The sword mind emits `contact` once per swing, at its strike phase. The test
  is an arc against the player's capsule.
- `game-main` finally passes an `onMeleeContact` handler (the hook exists at
  `game-actor.ts` ~1136 but is unused today).
- **There is no player health yet**, so a hit produces feedback only: screen
  shake, a red flash, a hit sound (reusing an existing sample), and a counter
  on `__sdfGame` (e.g. `playerHits()`). Real damage plugs into the same event
  once player health exists.

### Toughness
- Medium-tough: roughly 2–3 shotgun blasts. Full SDF gore on the flesh — she is
  not a soft target like the cultist.
- Shots on the armoured arms and the pauldron throw sparks and leave no wound.
  The player learns to aim for flesh.
- Veil and skirt hits get the existing cloth bullet holes and tears.

## Build order

Each step ends with frames the owner can look at.

1. **Body:** `bride.blob` (flesh, rib window, face prims, `jaw` bone), the baked
   face sheet, a `character-registry.ts` entry, and a line in `webgpu/lab-main.ts`
   `CHARACTERS`. Without that line `blob:shot` silently renders the zombie.
2. **Cloth and hair:** the bodice, skirt (with `hem` bone) and veil shells, plus
   the strands. Run a perf census against the cultist, and send any costly
   garment to fallback B now.
3. **Kit and sword:** `bride-kit.wam` built to glTF, and the sword Blender script
   plus its glb.
4. **Carry and gait:** the `sword` carry (guard and run), the stalking gait, and
   `BRIDE_PROFILE`.
5. **Melee:** the carry tracks; the cleave, sweep and lunge variants;
   `makeSwordMind`; the contact hook and hit feedback; the armour sparks; the
   jaw gape.

## Testing

- `characters/bride-blob.test.ts`, in the ogre/cultist style:
  - the prim count stays ≤ 128 (`MAX_PRIMS`, flesh + bone);
  - the proportions (leg ratio, neck, waist);
  - the kit must match the blob skeleton. The kit skeleton is a hand
    transcription and nothing else checks it. Compare bone lengths
    (height fractions) and pitch signs (pitch negates on every "down" bone).
- `bride-kit.test.ts`, matching the other kits.
- `attack.ts` tests: the phase windows for each new variant, and the lunge's
  root drive.
- A carry-track test: through a full swing, the grip point stays seated on the
  prop's `Grip_Hand` (within tolerance).
- Mind tests: the lunge fires only at 2–3 m, the cleave and sweep only inside
  reach, and `contact` fires exactly once per swing.

## Verification

- Lab frames through `blob:shot`: front, 3/4, side, a face close-up, and the
  windup pose. Sanity-shot a known character first.
- Game: `?spawn=bride`, then `__sdfGame.teleport(2)` and `placePlayer`.
  Placement bugs (translateBody) never appear in the lab. In the game, confirm
  the veil and skirt render uncut, the sword follows the swing, and a hit fires
  the feedback.
- Record the perf census numbers next to the cultist's.
- Notes and frames go in `docs/dev-notes/2026-09-24-bride/NOTES.md`, plus a
  row in `TASKS.md`.

## Out of scope

- The second elbow (skeleton surgery across `gait.ts` and `motion.ts`).
- The veil collapsing on a head hit (the cultist cowl rule, which is
  unimplemented anywhere).
- A ranged special attack (the death knight's magic).
- Real player damage and health.
- Sounds beyond one reused hit sample.
