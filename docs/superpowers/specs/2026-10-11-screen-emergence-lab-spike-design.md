# The screen emergence, lab spike — design

**Date:** 2026-10-11 · **Status:** built 2026-10-11, owner look pending ([notes](../../dev-notes/2026-10-11-screen-emergence/NOTES.md)); [plan](../plans/2026-10-11-screen-emergence-lab-spike.md) · **Branch:** `claude/screen-emergence-lab` (stacked on `claude/goblin-human-height`, PR goblincore/blud#46: the spike needs the 1.70 m goblin) ·
**Parent:** [the Flat set and the screen emergence](2026-10-01-flat-screen-emergence-design.md) (draft 2; this spec is its first slice, and where they differ this one wins) ·
**Look-dev:** [`docs/dev-notes/2026-10-01-flat-emergence-lookdev/`](../../dev-notes/2026-10-01-flat-emergence-lookdev/notes.md) (animatic, key frames, the P225f CRT blockout) ·
**Ending it follows:** [the Night Train egg ending](2026-09-30-night-train-egg-ending-design.md) §6.
**Owner decisions (2026-10-11):** the "goo transition" is the egg coming out of the monitor, the signature image of the game (vision §8.1); the first slice is a **lab spike**, not the train-to-Flat flow, so the look can be judged before any plumbing;
the technique is a **dedicated hand-written WGSL march on a proxy box** (approach A); the spike shows **all four beats** (swell and push, tear and crowning, goo strands and drips, out and heal); **the goblin touches the egg**
at the end (the draft's open question 2).

## 1. Why a lab spike first

The emergence has two parts that are not equally risky. The look (a screen that turns to a fluid membrane, an egg bigger than the glass pushing through it, a wet tear, strands) is the risky one: "gooey and shiny are key terms" (owner), and
the Blender animatic was judged a little too smooth. The plumbing (a second scene in one page, the sequence system's new camera kinds, the cut from the Night Train montage) is mechanical but large. The spike builds the look alone, on its own page,
scrubbable, so the owner can judge and steer it before the plumbing exists. The draft's riskiest item, two scenes in one page, is **not** in this slice.

## 2. Scope

**In:**
- A lab page `sdf-screen-lab.html` with `webgpu/screen-lab-main.ts` (a standalone page in the style of `sdf-shell-spike.html`; pages are dev-served, the build's `input` list is not touched): a CRT housing (a mesh after the P225f blockout), a desk, the lamp, a dark room,
  and the **real SDF goblin** at the desk through `createCharacterView`, driven by the pose layer.
- The **screen pass**: one WGSL march on a proxy box round the screen's face (sheet, bezel lip, stand-in egg, goo, tear), with the picture, scanlines, stretch, wet shading and its own light.
- The **timeline**: all four beats on a scrubbable clock (a slider, play and pause, speed, one camera preset per shot).
- The goblin's clips: the existing `type`, `jolt`, `recoil` and one new angle-only `reach` that puts the hand on the slumped egg.
- A headless capture script that checks the WGSL compiles, captures a key frame per shot and lays them next to the animatic's key frames, and measures cost.

**Out (later slices, none blocked by this one):** two scenes in one page; extending `ending-sequence.ts` (per-shot scene, camera kinds, cues); hooking the train ending's last montage frame to the pull-back; the early-stage Flat as a level state
(CRT and vest instead of the Giger iMac); a live CRT picture (render-to-texture, F-T2); the final egg design (the egg is a stand-in, the egg design is paused); a WAM mesh kit for the home clothes (the owner chose SDF cloth, section 6);
sound; the playable Flat.

## 3. Structure

Logic in pure, tested modules; drawing in hand-written WGSL (the release is a Rust and wgpu port, so nothing here leans on three.js beyond the host page).

| Unit | Does | Depends on |
| --- | --- | --- |
| `webgpu/emergence-timeline.ts` (pure) | The cue curves: from a time `t` in seconds, the screen pass's parameters (`push`, `reach`, `thin`, `tear`, `ripple`, `lipBow`, `heal`) and the shot, from authored keys with easing. One table, no renderer. | nothing |
| `webgpu/emergence-field.ts` (pure) | The CPU twin of the field: the sac function over the egg, the sheet's thickness, the lip's bow, the tear's opening, the picture's inverse-stretch mapping; and the constants the shader is built from (CRT and egg sizes, step budget). | the timeline's parameter type |
| `webgpu/goo-strands.ts` (pure) | The spring sim for a few strands (a handful of points each, anchored on the tear's lip and on the egg), beads and drips: stable, length-limited, deterministic from a seed and the clock. Outputs the point lists the shader reads. | nothing |
| `webgpu/screen-emergence.wgsl.ts` | The march and the shading, as WGSL strings (one function per string: `wgslFn` takes one), built from the field's constants. The twin of `emergence-field.ts`. | the field module |
| `webgpu/screen-lab-main.ts` + `sdf-screen-lab.html` | The page: renderer, set, goblin, the pass on its proxy box, the controls and the stats panel. | all of the above, `character-view.ts`, `pose.ts` |
| `characters/goblin-poses.ts` | Gains `REACH` (a held pose: the arm out and down to the desk, the hand over the egg) and `TOUCH` (a short clip from `recoil`'s end to `REACH`). Angles only. | `pose.ts` |
| `scripts/screen-emergence-check.mjs` + `.sh` | Headless: boot the page, check the shader compiled (no console errors), step the clock to each shot's key time, screenshot, lay out a sheet beside the animatic frames, read the frame cost. | the lab servers (`scripts/lab-servers.sh`) |

## 4. The field

All lengths are metres, in the screen's local frame (origin at the glass centre, +z out of the screen toward the room). The glass is 0.406 × 0.305 m (the P225f's viewable area); the bezel's inner opening is a little larger. The proxy box covers the screen and the sac's reach
(about a metre out at the peak), with a fixed budget of 64 steps and an early-out on the box.

- **The sheet:** the glass's rest plane, displaced by a **sac function** `sac(p)`: a smooth maximum of the flat glass and the egg's front surface, widening as the egg pushes, so that at full push the sheet is a long rounded sac (the Blender look-dev's tent, extended; its
  150 × 112 displaced grid proved the stretch reads). It is a thin shell, `|d| - thickness`, thickness falling where it stretches (`thin`). Radial folds where the sheet is dragged into the tent sell the rubberiness (the look-dev's finding).
- **The bezel's lip:** a rounded rectangular rim at the bevel's foot that bows outward and apart as the egg's cross-section exceeds the opening (`lipBow`); it **stays slightly warped after the heal**. The CRT mesh's inner bevel ends where the SDF lip begins, so the seam is hidden.
- **The egg (stand-in):** an ellipsoid about 0.35 m across and 0.45 m tall, so bigger than the glass: it cannot pass without the lip giving (owner). It has its own warm light, a candled look (opaque glowing shell, a few faint vessels), and is replaced when the egg is settled.
- **The tear:** a smooth subtraction opening from the sac's tip (`tear`), its edge ragged by noise. The look-dev's finding: the torn lip needs its own wet flesh-pink rim, or the edge reads as paper.
- **Goo:** strands (capsules between points on the tear's lip and the egg), beads (spheres) and drips (tapered capsules), their points from `goo-strands.ts` through a small uniform array; smooth-unioned into the sheet and the egg with a wide blend, so they web and neck like mucus.
  Few enough (about 6 strands, 8 beads, 4 drips) that the union stays cheap.

**Shading** (the owner's rule: 90s ray-traced CGI, not too smooth: hard terminators, hard highlights, a visible procedural noise; the game's modern effects on top):
- **The picture:** the committed Night Train frame (`assets-source/levels/flat-textures/screen-source.png`, from the iMac work), mapped from the rest plane through the inverse of the sac's stretch, so the image stretches with the sheet. Scanlines and a phosphor grain while it is glass.
- **Stretch** (displacement plus slope) is the one value that drives the rest (the look-dev's finding): it dims the picture and turns the sheet to translucent, veined flesh lit from behind by the egg's light.
- **Wet:** a clear coat with hard white highlights. **Mucus must be milky and glossy**, not clear: clear transmissive strands read as dark specks against the glowing egg (the look-dev's finding).
- **Light:** the lamp (warm, the key), the screen's own glow (its colour follows the picture), the egg's light (strong from the push on), a dim street-blue fill, and **hard shadows from the egg's light onto the goo and the desk** (one extra march per pixel for the goo only, behind a switch so cost can be read with and without).

The pass writes premultiplied colour and real depth (`depthNode`), in the pattern of the egg pass (`egg.wgsl.ts`, `game-egg.ts`: a proxy box with front faces in the SDF layer's late scene), so the goblin, the desk and the CRT housing occlude it correctly.

## 5. The timeline

About 14 s, from the draft's shots 3 to 7, with hard cuts between camera presets (the lab page has one preset per shot, and a free camera). The cue curves are authored keys, not simulation, except the strands.

| Shot | t (s) | What the parameters do | Goblin |
| --- | --- | --- | --- |
| Glass gives | 0 to 2.5 | the picture swells into a dome, a ripple runs across, reflections slide (`ripple`, a small `push`) | `type` |
| The push | 2.5 to 6.5 | `push` runs to its peak: the sac balloons most of a metre out, the picture stretched over it; `thin` rises, the picture dims to veined skin lit by the egg; `lipBow` rises | `jolt` at about 3 s |
| Crowning | 6.5 to 9 | `tear` opens at the tip; a wet lip rolls back round the egg; strands across its face; drips off the bezel | `recoil` |
| Out | 9 to 11.5 | the egg slumps onto the desk, tied to the torn screen by strands (the egg's position leaves the sac and falls to the desk; strands lengthen and sag) | thrown back, then `TOUCH` begins |
| Settle and heal | 11.5 to 14.5, then hold | the sac sucks back into the frame and heals, wrinkled and glistening, the picture distorted (`heal`); the bezel stays warped; the egg glows in its slick | `REACH`: the hand on the egg |

The page's clock is the only source of `t` (scrubbing is deterministic: the strands' sim is re-run from a seed to the requested `t` in fixed steps, so a scrub and a playback show the same frame). The timeline module also exposes the shot boundaries for the camera presets.

## 6. The goblin

The real SDF goblin in its skin and without armour, as `goblin-home` (`goblin.blob`'s 1.70 m body since PR #46, plus a vest and shorts as `shell` cloth: decision 7 of the draft, "a stained vest and shorts" at home, and the owner's 2026-10-11 choice of SDF cloth over a mesh kit because it reads more fluid; the plan's Task 10).
It sits at the desk by a pose clip (`sit` into `type`), and the existing `jolt` and `recoil` are used as built. The new `REACH` and `TOUCH` are angle-only keys in the same table (so the pose layer's tests and the "keys name real bones" check cover them): the arm swings out and down past the egg and the hand
comes to rest over it. The goblin's seat height against the CRT and the desk is set in the lab page from the goblin's measured joints, not guessed. The face rule is discarded (owner, 2026-10-11), so the cameras are free, but the shots stay behind the shoulder line where the hunch and the ears against the glow read best.

## 7. Verification

- **Unit (pure modules):** the sac function is zero at the lip and wraps the egg, monotone in the push; the sheet's thickness falls with stretch; the lip's bow rises with the egg's cross-section and stays after the heal; the tear opens from the tip and never reverses; the strand sim is stable, length-limited
  and deterministic (the same seed and `t` give the same points); the picture's inverse-stretch mapping is the identity at rest and continuous; the timeline's curves are continuous, monotone where they must be, and their shot boundaries are ordered; the new poses name real bones and keep limb lengths (the pose layer's existing check).
- **Headless:** `scripts/screen-emergence-check.mjs` compiles and draws the page (no console or WebGPU errors; nothing in node compiles WGSL), steps `t` to a key time per shot, screenshots, and writes a sheet beside the animatic's `keyframes.png` (look, not pixels). It reads the frame cost with the pass on, with the goo shadow on and off, and with the pass off.
- **Cost budget:** the pass should hold 30 fps at 1280 × 800 on the owner's machine in the close shots. It is a cutscene, but the SDF layer and the goblin draw too; the number is recorded, not gated.
- **The look is the owner's call.** The spike ends on look rounds against the animatic and the spec's "gooey and shiny": the plan reserves a task per round, and the first round's frames and the notes go to the owner before anything else is built on this.

## 8. Risks

- **The look.** Wet, stretched, torn and goo in one marched field is the heart of the sequence; the field is the thing to iterate on, and the timeline curves are the cheap knobs. If the sac reads as a balloon, not as skin, the stretch-to-skin shading is the first lever; if the goo reads as plastic, the milkiness and the wide blend are.
- **Depth and the proxy box.** The box must cover the sac at its peak and the goo at its sagging worst while the player-style camera sits close; the egg pass's conservative-depth lesson applies (the box's depth is a stand-in, so the pass writes its own depth).
- **Cost.** 64 steps over a close, large box with a goo shadow march. The early-out and the switch exist for this; if it does not fit, the shadow goes first, then the step budget with a conservative start from the box entry.
- **Scrub determinism.** The strands' spring sim must be replayable to any `t`; fixed steps from a seed, tested.
- **The goblin at the desk.** The pose layer was proved in the lab on the 1.30 m goblin; the 1.70 m goblin's thigh and arm lengths change the seat and the reach, so the seat and the reach target come from the measured joints.

## 9. Open for the owner (not blocking the plan)

1. The egg's size and the sac's reach: "most of a metre" is the draft's number; the look rounds will tune it.
2. ~~Shirtless goblin~~ Answered 2026-10-11: the home clothes are SDF cloth (a vest and shorts as `shell` prims, `goblin-home.blob`), in this slice.
3. Where the sequence goes after this spike: the two-scene seam and the train hookup (the draft's §3.1 and §3.5), or the early-stage Flat first.

## 10. Addendum: look round 1 (2026-10-12/13)

The owner's first notes changed the set and the goblin's choreography and the egg's look; the spec above is otherwise as built. See the [plan](../plans/2026-10-12-screen-emergence-look-round-1.md) and the [notes](../../dev-notes/2026-10-11-screen-emergence/NOTES.md). In short: the set is the Flat's floor-level kotatsu (no desk or chair; the CRT, keyboard and lamp on the board; the goblin cross-legged on a cushion); the goblin leans back and scoots away to let the egg out (no raised arms) and kneels forward to touch it; the egg is a smaller (0.123 x 0.158 x 0.123 m) matte speckled eggshell, with a shape that moves inside and shows only in strong backlight; the membrane's veins branch; one goo colour; the egg lands on the keyboard, which stays put and is coated in goo; the lab page renders at 640 x 480 by default.
