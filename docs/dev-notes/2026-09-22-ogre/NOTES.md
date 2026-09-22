# Ogre — chainsaw brute, first pass (2026-09-22)

Owner brief (prose, no reference): *"basically like the chainsaw ogre from Quake 1 — a big
brutish hunk of primordial flesh hunched over lugging a big chainsaw. Body and flesh SDF, kit
and chainsaw mesh. Goal is the base character and maybe a basic walk cycle."*

## What exists

| Piece | Source | Built into |
| --- | --- | --- |
| SDF body (44 prims) | `src/lab/sdf-zombie/characters/ogre.blob` | runtime (Blobforge) |
| Mouth decal | `scripts/make-ogre-face.py` (PIL, original art) | `public/assets/lab/faces/ogre-face.png` |
| Kit: belt+buckle, hide kilt, breeches, boots, bracers | `characters/ogre-kit.wam` | `scripts/build-wam-kit.sh ogre` → `public/assets/lab/ogre-kit.gltf` |
| Chainsaw prop | `scripts/make-ogre-chainsaw.py` (Blender, headless) | `public/assets/lab/ogre-chainsaw.glb` |
| Walk: `STOMP` gait + `saw` carry + `OGRE_PROFILE` | `gait.ts`, `carry.ts`, `motion-profile.ts` | runtime |
| Tests | `characters/ogre-blob.test.ts` (18), `characters/ogre-kit.test.ts` (7) | |

Look at it: `npm run dev` then `/sdf-lab-webgpu.html?character=ogre` (lab), or
`npm run blob:shot -- ogre` (turntable). Regenerate assets:

```
python3 scripts/make-ogre-face.py
scripts/build-wam-kit.sh ogre
blender -b --factory-startup --python scripts/make-ogre-chainsaw.py
```

## Design (the three beats — full reasoning is in the .blob header)

1. **Hunch** — spine/chest pitched 20°/28° (world), neck forward 32°, skull tipped back. The
   face hangs ~0.5 m ahead of the hips.
2. **Yoke** — a trapezius mass wider than the pelvis; the small bullet head sits set into it.
3. **Arms** — ham forearms, jaw-sized fists, 0.83 m arms (lengthened so the left hand can
   reach the saw's hoop).

Face: all structure is prims (bullet cranium, underbite jaw, brow shelf, pug nose, cheek slabs,
pointed ears, two ivory tusks, two dim yellow emissive eyes); the decal carries only the
grimace. Palette: sickly tan with grey-green bruise mottle.

## Walk cycle

The chainsaw is a **held prop on the soldier's carry machinery**, not a kit piece: the right arm
is rotated into the `saw` carry, the prop's grip locator seats on the right hand, and the left
hand is FABRIK'd onto the front hoop. So both fists are on the saw by construction, through
every stride. The saw is laid out on the shared `GUN_GRIP` locators (see the script header).

`STOMP` is procedural (no clip): 0.8 Hz, long stance, high knee, deep bob, a side roll with the
shoulders following. Measured on the CPU with real travel: ~1 m foot range, 16 cm lift.

![live walk](walk-live.gif)

**`holdPose('walk')` marches IN PLACE for every character** (no travel, so planted feet never
slide back) — judge a procedural gait from live wander, not from `BLOB_POSE=walk` stills.

![walk-pose turntable](turntable-walk-pose.png)
![face](face-closeup.png)
![chainsaw](chainsaw-blender.png)

## Things found on the way

- **`low` carry is not portable.** Carry angles are relative to the AUTHORED arm hang; the
  ogre's forearms hang 30° forward, so the soldier's `low` lifted the saw to his face. `saw` was
  grid-solved against the ogre rig for grip-at-belly, bar level and angled across the body,
  and the hoop within the left arm's reach.
- **Kit skeleton drift is silent.** Lengthening the .blob's arms without the .wam put the kit's
  wrists 60 mm off. `ogre-kit.test.ts` now pins every kit bone head within 10 mm of the .blob's.
- **Kit sized to the wrong cluster.** The belt/kilt were first sized to the torso cluster; the
  thigh-root masses are the widest flesh at hip height and stood 66 mm through. The test caught it.
- **Dark kit albedos render as silver** under `LOOK_DEFAULT` (env 0.9, rough 0.35): added
  `cloth` / `boot` looks to `kit-overlay.ts`.
- **`follow=thigh` split the kilt** at the crotch in the lab (rig pose ≠ bind). Kilt is rigid.
- **Turntable framing for held poses:** `blob-turntable.mjs` now re-runs `focusBody()` after a
  non-rest pose; before, a walk pose was framed ~1 m off-centre.
- **Lab front is yaw 180, and it is the unlit side** — frames here were lit with
  `BLOB_PROBE="(window.__sdfLab.uniforms.lightDir.value.set(0.45,0.72,-0.53), 1)"`.

## Fixed after the first look (same day)

- **Calf through the breeches, from behind, mid-stride.** At rest a ray probe from the shin axis
  found >= 8 mm of cloth over the flesh in every direction, so it was a MOTION-only gap at the
  breeches-hem / boot-cuff join. Fix: deeper BACK half (`dbot`) on the knee-to-hem and cuff
  rings, and 12-sided rings there. A back-view strip across a full stride shows no flesh.
- **Kilt V at the back hem.** Gone with the belt/kilt refit to the thigh-root width (the kilt now
  clears the trailing thigh); confirmed on the same back-view strip.

## Open / next

- From behind, the thigh-root masses read as two lobes (buttocks) sitting ABOVE the belt. Either
  raise the belt onto the spine bone or shrink/lower the thigh-root blobs.
- The gut reads as a separate ball from some angles; a bigger `blend` on it or a flank prim.
- Not done by design: attacks (chainsaw swing, the grenade launcher), sounds, gameplay/brain,
  gibbing tuning, a spawn in `sdf-game.html`. He uses the default brain via the registry.

![back view across a stride, after the calf/kilt fix](back-stride-after-fix.png)
