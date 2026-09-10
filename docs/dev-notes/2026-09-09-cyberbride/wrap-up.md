# Cyberbride — wrap-up (2026-09-09)

She shipped: `?character=cyberbride` in the lab. Chrome endoskeleton (WAM
kit) under translucent corpse-flesh (.blob, registry `fleshAlpha: 0.78`).
Turntables: `.lab-tmp/blob-shot/cyberbride-final/` (8 yaws); the A/B that
proves the feature is `cyberbride-final` vs `cyberbride-opaque-ab`
(`__sdfLab.setGhostAlpha(1)` = opaque).

## What was built

- `characters/cyberbride.blob` — description-authored (no reference mesh;
  soldier/widow route). Female frame (schoolgirl skeleton, narrower
  clavicles 0.024/0.080, arms tilt 16/8+pitch 18), Willendorf torso (hip
  band half-width 0.153 > bust 0.113 > soft waist), drooped cone mounds,
  cyclops-pattern fang row (7 teeth) over a dark maw, goblin-pattern ear
  points, schoolgirl-described-pattern strand hair, one warp-shell burial
  skirt, glow eyes, interior `bones` block for wound reveals.
- `characters/cyberbride-kit.wam` → `public/assets/lab/cyberbride-kit.gltf`
  (committed): skull dome+jaw+orbits, banded ribcage loft, sternum,
  vertebrae, iliac wings/pubis/sacrum, humerus/radius+ulna/femur/tibia+fibula
  rods, ball joints, palm/foot plates. Materials `chrome`/`darkiron`, LOOK
  entries in kit-overlay.ts.
- THE FEATURE — `sdf-layer.ts` ghost pass: `setGhostBodies(list, alpha)`.
  Ghost bodies march into a new float target (excluded from the opaque
  march by visibility toggles), then a second composite quad — same WGSL,
  `transparent: true`, alpha = a uniform — blends them over the output.
  Coverage sentinel/depthNode untouched, so walls occlude as before and
  kit-in-front stays depth-correct; alpha 1.0 is bit-identical to the old
  path. Wired in lab-main (hero) + game-main (per-actor split by
  `entry.fleshAlpha`); `__sdfLab.setGhostAlpha/get ghostAlpha` in the lab, plus a PANEL SLIDER:
"body → flesh alpha (see-through)" in the lab's debug panel — boots showing
the registry value, dragging below 1 puts ANY character in the ghost list,
1.00 restores the exact legacy path. setGhostBodies only forces a fresh
march when the body LIST changes (element-wise compare — the game re-passes
freshly mapped arrays every frame), so slider drags re-blend the held
target instead of re-marching.

## The traps that cost time (all now in memory)

- Willendorf busts collide with deltoids and arm shafts; three bust drafts
  failed the daylight/fuse probes before at=0.62/r 0.060 with tilt-16 arms.
- A skirt SHELL's `clipd` is WORLD Y (sdShellWrap's dPlane): the first value
  left the shell's mirror lobe hanging 20 cm below the hem, and the daylight
  probe caught the forearm wearing it. Cloth-vs-arm clearance is measured
  with shells EXCLUDED from the torso field (the test does this).
- WAM kit: metre values pasted into fraction slots on attach boxes (cranium
  rendered as a helmet). Rule that fell out: skeleton lengths AND part
  w/h/d/size/offsets are ALL /1.72; audit every number, not just the bones.
- Kits that stick out of a NUDE character read as artifacts, not armour —
  the opaque A/B frame (alpha 1) is the tool for finding them; it killed
  the clavicle bars and trimmed the foot plates.

## Known limits / follow-ups

- Game: she is registered but NOT in the spawn list — fielding her is a
  gameplay task. The forward ('bodies' default) path renders her correctly.
- Deferred renderer: translucency needs the routed-forward seam; ghosts fall
  back to opaque there (and in the 'sdf'/'frame' field styles).
- Hair/cloth share the flesh alpha (ghostly strands); a per-prim alpha
  override would let hair stay solid — not built.
- Wounds reveal the .blob's pale `bones` block, not the chrome kit (kit
  pieces are not wound-breakable); the chrome reads through intact skin.
- Only ONE ghost alpha per frame (one uniform, one group). Fine while the
  roster has one translucent character.
