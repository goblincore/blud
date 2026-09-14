# The Sump — SDF bestiary character

Status: Ready for implementation  
Character ID: `sump`  
Purpose: A self-contained task for testing an agent without Dispatcher UI access.

## Task

Implement one original character in the **active SDF bestiary**, using Blobforge and existing creatures as examples. Work directly through the repository's normal tools; no Dispatcher UI, dispatch queue, or delegated task is needed. Read `AGENTS.md` and preserve unrelated changes. Deliver the character implementation, verification evidence, and a short handoff. This is a character-authoring task, not a new enemy AI project.

## Creative direction

**The Sump** is a big, lumbering, formerly human brute: the weight and menace of a Quake 1 ogre, filtered through Dead Space's anatomical disruption and the grotesque practical-creature sensibility of Frank Henenlotter's Basket Case films. Use those as tonal influences, not designs to copy. It should feel like a tragic living prosthetic effect: flesh stretched around a body that has grown in the wrong directions.

At first glance, read an enormous hunched shoulder line, a small head shoved forward, a hanging belly, and two short, load-bearing legs. Aim for roughly 2.2–2.5 metres standing height, with the crouch reducing its apparent height. The body is heavy and grounded, not athletic or balloon-shaped. Its neck disappears into a raised back; its belly hangs between the hips without swallowing the leg silhouette. Broad, flattened feet look capable of carrying it.

One arm has overgrown into a dragging, knotted striking limb with an oversized fist and fused-looking knuckles. The other remains recognizably human, though thick and misshapen, and could eventually grip a chainsaw. Keep both attached and visibly separate from the torso. The asymmetry must affect the outline, not just surface color.

Its defining horror is **a second, incomplete face compressed into the swollen shoulder above the huge arm**. A collapsed brow, one recessed eye, and a crooked mouth-like fold suggest another person being absorbed into it. This is attached anatomy, not a separate head sitting on top or a decorative face decal. Make it readable at inspection distance without competing with the main face. If the exact anatomy fights the existing authoring system, simplify it while retaining the unmistakable face-in-shoulder idea.

The main face is small and ugly: a low brow, crushed nose, one sagging cheek, and an off-centre heavy jaw with a few irregular teeth. Its expression should suggest dim recognition and discomfort. Avoid a giant toothy monster grin. Along the back and shoulder, stretched ridges and compressed folds explain where the extra mass came from. Choose a few strong anatomical landmarks rather than covering everything in random tumors or spikes.

Use sickly, desaturated flesh: waxy grey-beige, bruised plum in compressed folds, and restrained raw red where tissue is exposed. Most skin should feel thick and dull; reserve wet highlights for the mouth and a few irritated seams. Eyes are small, inset, and non-glowing. Avoid neon lesions, flat red stickers, shiny plastic skin, and obvious stacks of spheres. It should remain convincing under neutral lighting without fog or post-effects hiding the sculpt.

These are art-direction anchors, not a coordinate prescription. Use your imagination for the exact anatomy, proportions, folds, and expression. No reference mesh or image is required: the owner explicitly wants an original interpretation from this prose.

## Scope and implementation

- Author the raw organic body in `src/lab/sdf-zombie/characters/sump.blob`; compile through Blobforge, not handwritten `BodyDef` TypeScript.
- Register `sump` in `src/lab/sdf-zombie/character-registry.ts` and make it selectable through the existing SDF lab/bestiary flow. Verify `/sdf-lab-webgpu.html?character=sump` actually displays it.
- Reuse a compatible existing rig and motion profile. Verify a neutral pose and an existing moving pose; modest character-specific adjustments are appropriate if needed to keep this body coherent. New attacks, AI, sound, combat balance, FPS spawn integration, and bespoke animation systems are outside this task.
- The creature must work as a bare organic body. A **chainsaw is optional stretch work**, only after the body meets acceptance. If added, use the existing separate mesh accessory/kit path and attach it to the rig. Clothing and other manufactured accessories also belong in mesh. Do not build them from SDF or invent an accessory framework. Use the established hairlock approach if hair is added.
- Reuse the current grammar and renderer. Do not change renderer defaults, introduce primitives, raise shader budgets, or remodel other creatures to complete this task. Do not reference nonexistent kit or texture assets.

## Start here

All paths below are repository-relative. Read the relevant sections rather than assuming old comments describe current runtime behavior.

| Reference | Use it for |
| --- | --- |
| `.claude/skills/authoring-sdf-characters/SKILL.md` and `reference.md` beside it | Blobforge workflow, syntax, material controls, geometry checks, capture tools, and known traps. The prose-first instruction above overrides the skill's reference-mesh prerequisite. |
| `src/lab/sdf-zombie/characters/zombie.blob` | House style, humanoid structure, and comments explaining non-obvious choices. |
| `src/lab/sdf-zombie/characters/gnasher.blob` | Prose-authored heavy anatomy, jaw construction, and separating limbs from a large body. Borrow techniques, not its animal silhouette. |
| `src/lab/sdf-zombie/characters/bloatmaw.blob` and `bloatmaw-blob.test.ts` | Irregular anatomy, seated eyes, flesh materials, and structural design checks. Sump should remain a walking humanoid brute. |
| `src/lab/sdf-zombie/character-registry.ts` and `motion-profile.ts` | Character registration, optional kits, face assets, and existing motion profiles. |
| `src/lab/sdf-zombie/blob-checks.ts` and `validate.ts` | Attachment, clearance, stance, stranded geometry, and primitive limits. |
| `scripts/blob-shot.sh` and `scripts/blob-turntable.mjs` | Supported WebGPU turntable capture and camera framing. |

Start with silhouette and limb separation, then the two faces, then material and folds. Use tapered/curved forms, controlled blending, and supported grooves where useful. Check current grammar before using subtraction outside the head: documented carve ownership and groove-width semantics can be surprising. A feature that compiles is not proof it renders correctly. Keep each cluster within the existing 64-primitive limit.

## Acceptance and verification

1. **Distinct identity:** front, side, back, and three-quarter views show a grounded, hunched humanoid brute with a hanging belly, unequal arms, and a shoulder-face. It reads without a chainsaw. The side and back are authored, not unfinished surfaces behind a front-view sculpt.
2. **Readable anatomy:** limbs remain visibly separate away from their joints; feet support the stance; eyes sit in flesh; the shoulder-face is integrated. No accidental floating pieces, missing surfaces, severe pose intersections, or sphere-stack silhouette.
3. **Working integration:** `sump` resolves to its own source and correct assets in the lab. Inspect an existing animated pose for attachment and deformation problems. Do not silently substitute a stock creature or claim FPS compatibility without testing it.
4. **Focused checks:** add `sump-blob.test.ts` covering compilation/validation, explicit face/palette/sheet compilation as applicable, registry identity, and meaningful structural properties such as attachment, stance, and limb daylight. Explain intentionally chosen tolerances; do not pretend prose-derived proportions are mesh measurements.
5. **Run verification:** run the new character tests, relevant registry tests, and Blobforge parse/compile/check tests. Run `npx tsc --noEmit` for integration changes. Record actual commands and outcomes; distinguish pre-existing failures from new ones.
6. **Visual evidence:** use `LAB_TMP=.lab-tmp npm run blob:shot -- sump`, adjusting camera distance to frame the larger body. Inspect the actual frames and iterate. Capture full-body views and close-ups of both faces; save a small final evidence set under `docs/dev-notes/sump/`. Confirm the selected character before judging images. Use `blob:render-check` if CPU geometry and rendered surfaces disagree.

Coordinate GPU work with other running jobs; use available task-owned ports and stop only resources you started. If GPU capture or image inspection is unavailable, finish the implementation and CPU checks, document the exact limitation, and mark visual acceptance **unverified**. A CPU silhouette or passing tests do not constitute a WebGPU visual pass. Do not run mesh-fitting tools without a reference or invent fit scores.

## Handoff

Provide the changed files, the design choices you made, test results, reproducible preview instructions, screenshot paths, and any remaining defects. State whether the optional chainsaw was omitted or implemented. Keep the work reviewable; do not merge or push it. Success is one convincing, integrated creature with honest evidence, not a larger engine project.
