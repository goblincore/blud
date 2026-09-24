# The Void and the portal — Design

**Date:** 2026-09-24 · **Status:** approved (owner, 2026-09-24)
**Parent:** [New game flow](2026-09-24-new-game-flow-design.md) (build order item 2) ·
**Format:** [Level Format v1](2026-09-23-level-format-design.md) · **Related:** [Outdoor v1](2026-09-23-outdoor-v1-design.md)

## 1. What it is

The first place a new player stands. It's the hub before any lights come on: darkness, slow
embers and one red portal. Through the portal, rail tracks run off into black. Walking into it
loads the first level. There's nothing to fight.

## 2. Look

**The portal** (visual reference: the red portal from Diablo II: Lord of Destruction; the image is
not stored in the repo, the same rule as for Blood assets):

- **Shape:** an upright oval, about 2.2 m wide and 3.4 m tall, with no frame. It is only light.
- **Rim:** a thick, ragged ring of red flame, white-hot on its inner edge, breaking outward into
  wisps and sparks. It flickers all the time (animated noise).
- **Inside:** a dark red haze that swirls slowly. **The tracks** show through it: two rails and
  their sleepers on a ground plane behind the portal, red-tinted and dim, fading to black.
- **Glow:** additive and self-lit. It is the only light in the void.

**The void:**

- Pure black. There is no visible floor, wall or ceiling, and the fog and background are black.
- **A glow pool:** a soft red radial gradient on the floor in front of and under the portal,
  so the unseen floor reads as there.
- **Embers:** a few hundred faint specks drift slowly around the player and wrap as the player
  walks, so walking reads as moving. Those near the portal take its red.
- **The start:** the player stands about 12 m from the portal, facing it.

## 3. Level format additions

Both are additive (format spec §10: new keys and capabilities, parser + exporter + conventions
change together).

- **Room `void: true`** (opt, default false): the room's generated walls, floor and ceiling are
  **not drawn**. Collision is unchanged, so the walls still bound the player. `void` excludes
  `sky`, `edge` and `paths`. It needs the capability **`void`**.
- **Top-level `portals`**: `{id, pos [x,y,z], yaw, width, height, target}[]`. `pos` is the base
  centre of the oval and `yaw` its facing (the side that shows the tracks). `target` is a level
  id matching `^[a-z0-9-]+$`, with no check that the file exists. It needs the capability
  **`portals`**.
- **Blender:** a `portal:<target>` empty in the `markers` collection, its scale giving width and
  height (the Blender conventions doc gets a row). The void room carries a `void` custom property.

`ENGINE_CAPABILITIES` gains `void` and `portals`.

## 4. The level: `the-void`

Built by `scripts/levels/build_the_void.py` and exported as usual into
`public/assets/levels/the-void.level.json`. It has:

- one room, 40 × 40 m, `void: true`, height 8 m;
- one portal at the room's far side, with `target: "the-wake"` until Night Train exists;
- no spawns, pickups, graves or bells, and `completeOn` unused.

Weapons stay as they are for now (open, §8).

## 5. Rendering (hand-written WGSL)

- **Portal surface:** one quad at the marker, drawn additively, with no depth write and depth
  test on. One WGSL fragment function (`portal.wgsl.ts`, `PORTAL_COLOR`) does all of this:
  - the **rim**, from an oval signed distance plus two octaves of time-scrolled noise:
    white-hot at the inner edge, red outward, with alpha breaking into wisps;
  - the **haze**, as swirling noise inside the oval;
  - the **tracks**: the view ray through the pixel is carried past the portal plane and
    intersected with the ground plane `y = 0` in the portal's local frame. The hit point is
    tested against two rails (`|x ∓ 0.72| < 0.04`) and sleepers (the fract of `z / 0.6`), then
    faded by distance to black and tinted red. Parallax follows from the real ray.
- **TypeScript twin** `portal-color.ts`: the same maths (oval distance, track hit, fade) for unit
  tests. It follows the sky dome's `sky.wgsl.ts` / `sky-color.ts` pattern.
- **Light:** one red point light at the portal centre, with no shadow. It lights the weapon and
  the embers.
- **Glow pool:** a floor quad in front of the portal with an additive radial red gradient.
- **Embers:** an instanced camera-facing sprite set of about 300 specks, in a 24 m box around the
  player. Positions come from a hash and time in WGSL (slow rise and drift), wrapped into the box
  around the camera, so there's no per-frame CPU work. Each speck's tint is red, scaled by its
  distance to the portal.

Pure decisions (portal trigger test, ember wrap, glow falloff) live in renderer-free modules
(`void-portal.ts`), with the three.js/TSL wiring in a leaf module (`game-void-leaves.ts`) that
follows the `game-outdoor-leaves.ts` pattern.

## 6. Entering the portal

- **Trigger:** the player's position is inside the portal's box: its width, a depth of 0.6 m
  and its height. The check is pure: `insidePortal(portal, pos)`.
- On entry: a 250 ms red-to-white full-screen flash (a CSS overlay is fine), then
  `location.assign(levelUrl(location.href, portal.target))` (`game-menu.ts`).
- It fires once. Input is ignored during the flash.

## 7. Menu

- The Esc menu's **New game** starts the void: `levelUrl(href, 'the-void')`.
- The level picker stays below it as **Levels (dev):** Ring (testbed), The Void, The Wake (WIP).
- The intro cutscene and title screen are out of scope (parent spec, build item 5).

## 8. Open

- Whether the player is unarmed in the void (it needs a "no weapon" loadout path).
- Portal sound (there is no audio system yet).
- The upgrade path, from the parent spec: real tracks that exist in the void and are seen
  through a masked oval, once the hub lights up.

## 9. Testing

- **Unit:**
  - `level-json` accepts `void` and `portals`, and rejects `void` combined with `sky`, a bad
    target id and a missing capability;
  - `insidePortal`;
  - `portal-color` (the rails show on-axis, nothing shows outside the oval, the fade reaches
    black by the far distance, and parallax shifts the rails when the eye moves sideways);
  - the ember wrap;
  - the `the-void` level test (one void room, one portal, start 12 m out, facing it).
- **Headless gate** `scripts/sdf-game-void-gate.sh`:
  - boot `?level=the-void` with no errors;
  - a CDP screenshot shows the screen centre mostly red and the corners near black;
  - teleport the player into the portal and check the URL becomes `?level=the-wake`.
- **Regression:** the Wake and shorty gates pass, and boot `drawOnce` is within noise.
