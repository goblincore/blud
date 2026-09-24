# Bride — sword enemy, Task 1: the flesh body (2026-09-24)

Spec: `docs/superpowers/specs/2026-09-24-bride-sword-enemy-design.md`.
Body: `src/lab/sdf-zombie/characters/bride.blob` (the header is the design brief).
Pins: `src/lab/sdf-zombie/characters/bride-blob.test.ts`.

Flesh only. No shells, hair, kit, sword or face sheet yet (Tasks 2-5).

## Numbers (CPU field, `sdBody` probes)

| What | Value | Spec |
| --- | --- | --- |
| Prims | 63 flesh + 27 bone = 90 | ≤ 108 (128 − 20 for Task 3's cloth) |
| Flesh crown | 1.815 m | ~1.85 once the hair and veil are on |
| Hip joint / height | 1.04 / 1.815 = 0.57 | ≥ 0.54 |
| Waist half-width | 0.087 | ≤ 0.095 |
| Hip half-width | 0.169 | ~0.16 (must stay < 0.18, or the hips touch the forearms) |
| Thigh at mid-thigh | 0.045 semi | stick-thin |
| Neck bone | 0.140 m | ≥ 0.13 |
| Forearm R − L | 0.04 m (0.30 vs 0.26) | > 0.03 |

## Frames

Shot with `LAB_TMP=.lab-tmp LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 npm run blob:shot -- bride`.
The probe was `BLOB_PROBE="(window.__sdfLab.uniforms.lightDir.value.set(0.35,0.6,-0.72), 1)"`.

- **The light's z is negated** relative to the broodmother notes. In today's lab,
  **yaw 180 is her face** (frame 04 of 8), and the broodmother's `+0.72` lights her back.
- **Use private ports.** Another worktree's Vite was already on 5233. `lab-servers.sh`
  reuses any listener, so the first "bride" shot was that checkout's zombie.
  Sanity-shoot `cultist` on the same ports first.

![front](body-front.png) ![3/4](body-34.png) ![side](body-side.png) ![back](body-back.png)
![torso](torso-front.png) ![torso 3/4](torso-34.png) ![legs](legs-front.png)
![face](face-front.png) ![face 3/4](face-34.png)

## Things found on the way

- **A mirror block cannot make an asymmetric pair.** A bone outside the block cannot parent
  to `upperarm.r`, and it cannot carry arm prims. So the grammar gained `lenR=`, the `.r`
  copy's length (`blob-parse.ts` → `BoneDef.lengthR` → `mirror.ts`), with tests. The motion
  rig already measures each arm on its own (`makeMotionJoints` `arm.L` / `arm.R`), and the
  test pins that the long arm reaches it.
- **Chamfer reach is 4 × `blend`, and `buildBody` does not halve it.** Only round unions
  get `roundBlendScale` 0.5. The cheekbones' chamfer at 0.008 bevelled 3.2 cm of air into
  the head. With the other head blends, that grew a 0.092-wide "goggle" band at eye level
  with a shadow "moustache" under it. Smooth-min swell also accumulates across prims: four
  prims each ~2 cm away folded the field 1.9 cm negative.
- **Hips belong to the leg cluster.** Torso and leg meet at a hard seam between clusters.
  So a torso-owned hip flare always reads as a light bulb hung over two sticks. The flare
  is now a thigh prim, which is where the trochanter is anyway.
- **Paint is taken from the hit's nearest prim** (`prim-material.wgsl` `hitBest`). A
  buried lip painted a ~4 cm pink trapezoid, so the lip tint stays a step off the skin. A
  2 mm painted cross still reads as a dark drop at 1 m, not as a cross.
- **`stance humanoid` is enforced by the lab.** A shin pitched +1 put the knee 4 mm behind
  the hip-to-ankle line, and the lab then refused to load her. The test now pins
  `checkStance`.

## Honest read

- **At distance:** a tall, very thin, long-legged pale figure with a wasp waist and a long
  neck. It reads as graceful-strange and more mannequin than woman. The hair, veil, bodice,
  skirt and boots (Tasks 3-4) have to carry "female" and "bride".
- **Up close:** the rib window reads clearly. The raw-red seams read as red bands at both
  elbows and as lumps under the right shoulder. The flesh cuff tapers past the right fist.
- **The face:** large dark eyes with red-rimmed bruised sockets, a fine pointed nose, pale
  lips and a pointed chin. Uncanny and doll-like. The wrong half is the Task 2 sheet.
