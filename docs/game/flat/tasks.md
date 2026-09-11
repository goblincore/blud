# The Flat — Tasks (draft 1)

**Date:** 2026-09-10 · **Design:** [design.md](design.md) · **Scope:** [../production-scope.md](../production-scope.md) (G4)

Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.
**Deps** lists task IDs that must land first. Engine-heavy tasks get their own
superpowers spec/plan when they start; link it on the task.

---

## Design

- [ ] **F-D1 Layout and sightlines.** Final floor plan with dimensions at goblin
  scale; check the five sightline rules (design §2).
  *Deps:* F-D5. *Done when:* a top-down plan and four eye-level sketches (desk,
  door, shelf, mattress) exist.
- [ ] **F-D2 Prop list and stories.** Confirm the prop table (design §3); mark
  hero props and which get SDF variants. *Done when:* the table is final.
- [ ] **F-D3 Mood board.** Basement light, CRT glow, cheap 90s bedsits, *Moon* /
  *UFO* rooms, the prerender look. *Done when:* one board, 15–30 images, with notes.
- [ ] **F-D4 Desk close-up spec.** Composition, props, the post-cold-open stain.
  *Deps:* F-D2. *Done when:* a paintover or blockout render of the shot.
- [ ] **F-D5 Goblin scale.** Measure eye height, reach and step from the player
  controller and arm model; derive furniture sizes. *Done when:* a scale sheet.

## Assets (Blender)

- [ ] **F-A1 Room shell.** Walls, floor, ceiling, window recess, door frame.
  *Deps:* F-D1, P-1 (pipeline conventions). *Done when:* exports into the game.
- [ ] **F-A2 Hero props.** Beige PC, CRT housing (screen as a separate SDF part),
  desk, keyboard, mouse, chair, door, CD shelf. *Deps:* F-D2, F-D5.
- [ ] **F-A3 Secondary props.** Stereo, printer, mattress, pipes, bucket, mirror,
  rug, magazine. *Deps:* F-D2.
- [ ] **F-A4 Materials.** Warm, cheap, prerender-glossy; yellowed beige plastic.
  *Deps:* F-A2.
- [ ] **F-A5 Clutter kit.** Small dressing props for the desk and floor.

## Tech

- [ ] **F-T1 Room scene in the game.** Load the exported room, walk it, collide.
  *Deps:* P-2 (importer), F-A1. *Done when:* walk the flat at 30 fps with props.
- [ ] **F-T2 Render-to-texture spike.** Draw the current grey-box FPS level onto
  the CRT screen in the room. Measure cost with both scenes live.
  **Riskiest frame question; start early.** Can use a placeholder box room
  before F-T1. *Done when:* the FPS is visible on the monitor in the room, with
  numbers for frame cost.
- [ ] **F-T3 Camera transitions.** Walk → sit → lean into the monitor → push into
  the FPS; Escape pulls back each step. One continuous move, no cuts.
  *Deps:* F-T1, F-T2.
- [ ] **F-T4 Input routing.** Room controls vs. FPS controls; what the mouse does
  while leaning in. *Deps:* F-T3.
- [ ] **F-T5 Screen push-through (SDF).** The CRT glass bulges, an object pushes
  through and drops onto the desk wet; membrane settles; residue stays.
  *Deps:* F-T2. *Done when:* the cold-open CD push-through plays in the flat.
- [ ] **F-T6 Room lighting.** Lamp, CRT glow driven by the FPS image, window.
  *Deps:* F-T1.
- [ ] **F-T7 Room state save.** Positions of placed objects, stain state.
  *Deps:* F-T1, G1 save/load.

## Blocked / later

- [!] **Room audio** — needs G3. Place emitters in the scene now (F-A1).
- [!] **Decorating (placement)** — G7.
- [!] **PC / door / ceiling flesh stages** — G7, after F-T5 proves soft parts.

## Suggested order

F-D5 → F-D1/F-D2/F-D3 (parallel) → **F-T2 spike** (in parallel with design) →
F-A1/F-A2 → F-T1 → F-T3 → F-T5 → F-D4/F-A4/F-T6.
