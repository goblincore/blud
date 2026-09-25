# Juggernaut — Task 2 notes (body + power armour), 2026-09-25

Plan: `docs/superpowers/plans/2026-09-25-juggernaut.md`, Task 2.

## What landed

- **`characters/juggernaut.blob`**: `soldier.blob` scaled by fixed factors, with
  the same skeleton topology and no hair. The header lists every factor:
  - overall size (H) 1.15, so 1.992 m becomes 2.291 m;
  - torso width 1.13x and depth 1.06x on top of H, making the shoulders
    1.3x the soldier's;
  - clavicle 1.13x, arm girth 1.12x, leg girth 1.10x, hip spacing 1.10x,
    neck girth 1.15x.

  The upper-arm tilt of 12° (not 8°) is the only change beyond the scaling.
  Scaled verbatim, his forearm sank 6.4 cm into the widened waist. The
  soldier's own forearm/waist overlap is 4.4 cm, which his kit hides, and
  tilt 12 brings the Juggernaut back to 4.6 cm.
- **`characters/juggernaut-kit.wam`**: classic power armour.
  - Domed pauldrons, about a 1.0 m shoulder span.
  - Upper-arm sleeves, boxy gauntlets and iron gloves.
  - Front thigh plates. Not tubes: the thighs overlap at the crotch.
  - Knee cops, greaves and big boots.
  - A round barrel-chest cuirass with a raised centre plate.
  - An iron waist girdle and gorget.
  - A sealed rounded helmet with a respirator snout and two glowing lenses.
  - A backpack power unit with twin exhaust stacks and a brass ammo drum.

  The skeleton is the `.blob`'s metres / 2.346 to six places.
- **`JUGGERNAUT_PROFILE`**: a soldier-family profile.
  - MARCH only (never runs), cruise 0.9, turn rate 1.8.
  - The soldier's shotgun at 1.38 scale as a placeholder until Task 3.
- **Registry entry `juggernaut`**, with the soldier's baked face and palette.
- **`lens` look** in `kit-overlay.ts`: glass sheen plus a dim red emissive.
- **Tests:**
  - `juggernaut-blob.test.ts`: topology, 1.15x height, 1.25-1.35x shoulder
    span, no hair, fused, the arm hug no worse than the soldier's, legs clear.
  - `juggernaut-kit.test.ts`: containment, the helmet seals the head, the
    pauldron crowns the deltoid, he stands on his boots, rest identity. It
    **skips until the glTF is built**.
  - `character-view.test.ts`: the red-eye rule now covers the soldier family.

## Not done here, and why

- **The kit is not compiled.** WAM lives outside the repo, and this session's
  sandbox refused to run it (external code). Build it on a machine with WAM:

  ```
  scripts/build-wam-kit.sh juggernaut
  npx vitest run src/lab/sdf-zombie/characters/juggernaut-kit.test.ts
  ```

  Until then the lab and game render him undressed; character-view logs the
  404 and carries on. The `.wam` was authored against measured flesh (the
  table in its header), but it has never been through the compiler. Expect a
  round of fixes: WAM lint, and whatever the fit test finds (most likely
  candidates: the pauldron inner-rim tuck bound, TUCK_MAX 0.10, and the
  helmet's clearance at the nose).
- **No GPU frames.** Headless Chromium here has only SwiftShader. The lab
  booted under a texture-view `swizzle` shim, then never finished its first
  frame in 15 minutes. `body-vs-soldier.png` is a scratch CPU sphere-trace
  of `sdBody` instead: flesh only, no kit, no face or palette. The panels are
  front, side and three-quarter views, soldier left and Juggernaut right in
  each pair. The blue guide lines mark 1.992 m and 2.291 m.
- **Gait:** MARCH, slowed by cruise. STOMP (the ogre's) is the alternative
  the plan names; that is the owner's pick once there are frames.

![body vs soldier](body-vs-soldier.png)
