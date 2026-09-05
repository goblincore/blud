# Soldier kit — the POLYGON half. Dispatch brief

In-repo copy of `~/.claude/dispatch/plans/2026-09-05-soldier-kit.md`.

The `.blob` is now BODY ONLY — bare torso, bare arms, bare feet, trousers as
paint. Every hard thing the character wears was deliberately stripped from it
for this kit: shoulder pauldrons, chest plate, belt with pouches, knee plates
and boots.

---

```markdown
---
title: "Author soldier-kit.wam — mesh armour for the soldier: pauldrons, chest plate, belt, knee plates, boots. Dull metallic greenish-teal."
status: pending
project: /Users/donny/Projects/blud
model: kimi/k3:high
branch: dispatch/soldier-kit
base_branch: claude/soldier-character-modeling-7f88ae
priority: 1
max_runtime: 150m
created: 2026-09-05
depends_on: []
allowed_tools: Edit,Write,Bash,Read,Glob,Grep
harness: pi
---

## THE ONE JOB

`src/lab/sdf-zombie/characters/soldier-kit.wam`, compiled to
`public/assets/lab/soldier-kit.gltf`, so the soldier wears hard armour that
reads as METAL — not as `gloss=` faking it on a blob.

The owner will look at a turntable and judge whether the plate looks like
plate: hard edges, a dull metallic greenish-teal, and a clear material break
against the bare flesh underneath.

## READ FIRST, IN THIS ORDER

1. `src/lab/sdf-zombie/characters/goblin-kit.wam` — **the worked example and
   the house style.** Its header is the specification for this whole approach:
   why flesh is `.blob` and plate is `.wam`, the two silent unit/pitch
   conversions, and why ring sizes are MEASURED rather than eyeballed. Read it
   before you write a line.
2. `src/lab/sdf-zombie/characters/clown-kit.wam` — the second example.
3. `scripts/build-wam-kit.sh` — how a `.wam` becomes the committed `.gltf`.
4. `src/lab/sdf-zombie/characters/soldier.blob` — the flesh you are wrapping.

## WAM IS PRESENT

`~/Projects/2026/wam` exists on this machine, so `scripts/build-wam-kit.sh
soldier` will run. WAM lives outside the repo, so **the compiled
`public/assets/lab/soldier-kit.gltf` is what ships and must be committed** —
same bargain the other two kits make.

Register the kit in `webgpu/lab-main.ts`'s `KITS` map, next to the goblin's
and the clown's, or nothing will load it.

## WHAT TO BUILD

- **Shoulder pauldrons.** The second beat of his silhouette. Hard, flat-topped,
  spreading wider than the deltoid so the yoke reads as one bar across the
  shoulders from the front.
- **Chest plate.** A cuirass over the bare chest, with a distinct front plate.
- **Belt with pouches.** Wide, breaking the torso's line. Issued webbing is
  RECTANGULAR — the pouches should be boxes, not lozenges.
- **Knee plates.**
- **Boots.** They go OVER the bare flesh foot that is already in the `.blob`;
  do not model a foot.

**Colour: a dull metallic greenish-teal.** Not chrome, not bright — issued
kit that has been worn. This is the owner's one explicit colour instruction.

## THE TWO CONVERSIONS THAT ARE SILENT WHEN WRONG

Both are documented in `goblin-kit.wam`'s header. Getting either wrong
compiles fine and renders wrong.

- **UNITS.** WAM lengths are fractions of `height`; `.blob`'s are metres. The
  soldier's height is **1.70**, so every `.blob` metre value is divided by 1.70
  here. (The clown's height was 1.00, which made this invisible for that kit —
  do not copy its numbers expecting them to mean the same thing.)
- **PITCH SIGN ON `down` BONES.** WAM's pitch tips an `up` bone forward and a
  `down` bone BACKWARD; `.blob`'s always carries toward +z. So `up` bones
  (spine1, chest, spine2, neck, skull) share their pitch verbatim, and every
  `down` bone (upperarm, forearm, thigh, shin) has it NEGATED. This is what
  gave the goblin kangaroo knees. `tilt` needs no flip.

## THE SKELETON THIS MUST MIRROR

From `soldier.blob`, verbatim. Metres — divide by 1.70 for WAM.

```
bone spine1   parent=pelvis   dir=up   pitch=-1            len=0.16
bone chest    parent=spine1   dir=up   pitch=-1            len=0.17
bone spine2   parent=chest    dir=up   pitch=0             len=0.06
bone neck     parent=spine2   dir=up   pitch=0             len=0.08
bone skull    parent=neck     dir=up   pitch=2             len=0.22
bone clavicle parent=spine2   dir=side side=0.040          len=0.100
bone upperarm parent=clavicle dir=down tilt=8  pitch=2     len=0.26
bone forearm  parent=upperarm dir=down tilt=4  pitch=8     len=0.24
bone hand     parent=forearm  dir=down pitch=6             len=0.095
bone thigh    parent=pelvis   dir=down tilt=2 side=0.068   len=0.42
bone shin     parent=thigh    dir=down tilt=2              len=0.42
bone foot     parent=shin     dir=fwd                      len=0.13
```

**`dir=side` and `dir=fwd` bones do not take pitch/tilt** the way `up`/`down`
ones do — on `side`, pitch is a no-op; on `fwd`, both are inert after
normalisation. The clavicle and the foot are hand-written, not derived.

## MEASURE THE FLESH — DO NOT EYEBALL THE RINGS

`goblin-kit.wam`: *"RING SIZES ARE MEASURED, NOT EYEBALLED. Each piece wraps
flesh that is not in this file, so every w/d below comes from marching the
`.blob` field outward from the bone axis."*

Do the same. `sdBody` (`validate.ts`) answers "where is the surface" directly —
march outward from each bone axis, convert to height fractions, and record the
numbers in a comment block the way the goblin's kit does. **Every ring sits a
few thousandths PROUD of the measured flesh.** The arms are freshly bulked, so
any number carried over from an older version of this character is wrong.

## DONE WHEN

- `scripts/build-wam-kit.sh soldier` produces
  `public/assets/lab/soldier-kit.gltf`, and it is COMMITTED
- the kit is registered in `lab-main.ts`'s `KITS`
- `npm run blob:shot -- soldier` frames show hard plate over bare flesh, with
  a clear material break — `Read` them
- the plate reads as dull metallic greenish-teal, not chrome and not bright
- nothing floats: every piece sits on the flesh it wraps
- `npx vitest run src/lab/sdf-zombie/` green, `npx tsx --noEmit` clean
- your report records the measured flesh rings, and states what you invented

## THREE OF WAM'S LINTS ALWAYS FIRE ON A KIT

They check a whole CHARACTER and this is only the clothes: bones with no
geometry near them (the flesh lives in the `.blob`), and the lowest geometry
floating above the ground. `goblin-kit.wam` says to ignore exactly those. A
warning about anything else is real.

## COMMIT AS YOU GO

Runs here have been cut off mid-flight and lost everything. Commit after every
step that compiles.
```
