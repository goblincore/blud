# Cyberdemon — a roster character authored from a prose brief

**Date:** 2026-09-08
**Status:** approved
**Slug:** `cyberdemon`

## Goal

Add a new character to the SDF roster: an augmented flesh brute whose soft body
is raymarched SDF and whose hard augments are a polygon kit. Authored by a
dispatched agent working from a PROSE BRIEF ONLY — no reference mesh, no
reference plate, no inspiration image.

## Why this run exists

Every prior character task pointed the agent at a file. That works, and it also
produces a copy: `docs/dev-notes/refs/README.md` is built around "a dispatched
agent cannot see a description — it can see a file," and the tooling
(`blob:measure`, `blob:rings`, `blob:face-bake`, `head-profile`) all assumes a
reference to fit against. The owner's read is that agents handed a mesh spend
the run matching it rather than designing.

So this run removes the reference on purpose and asks what the agent makes.

**This is a known-risk path and the risk is accepted.** `refs/README.md`
records that the clown and the first mouse were authored from prose and "both
drifted a long way." The difference here is that drift is not a failure mode —
there is nothing to drift FROM. What replaces fit-to-reference is the check
suite plus the owner's eye on the turntable frames.

The nearest precedent is `characters/schoolgirl-described.blob`, which read its
plate once for a brief and then PUT IT DOWN — no rings, no measure, no
head-profile. Its header is the model for how to write this character's header.

## The creative brief

### Fixed (the character's identity — these are the beats)

- An **augmented flesh brute**: a heavy humanoid body, part meat and part machine.
- **Exposed red cabling** somewhere on the body, reading as bundled loom rather
  than as veins.
- **Eyes that read as lit** in a dim room.
- **Asymmetric**: at least one limb replaced or sheathed in machinery, and the
  other side left as flesh. The asymmetry is the silhouette's job.

### Free (the agent designs these — do not prescribe)

Head and skull shape, height, build and proportion, palette, which limbs are
augmented and how far, posture and stance, the shape and function of the
machinery, surface finish, and every number in the file.

### Forbidden (exactly one hard sculpt constraint)

- **No bovine head, no horns.** `characters/minotaur.blob` already occupies
  that silhouette. The owner is abandoning that iteration, but it is still in
  the registry and the roster must not gain a near-duplicate.

## Architecture: two languages, one character

Per `characters/goblin-kit.wam`'s header — flesh in `.blob` because blended
SDFs merge by construction and are round with no seams; plate in `.wam` because
smooth-min rounds every edge a plate lip, a rivet or a boot sole needs.

| Piece | Language | Output |
| --- | --- | --- |
| Flesh body, stump, socket, cabling that reads as soft | `characters/cyberdemon.blob` | compiled at import |
| Hard augments: limb cowl, plates, boot, weapon housing | `characters/cyberdemon-kit.wam` | `public/assets/lab/cyberdemon-kit.gltf`, committed |
| Registration | `character-registry.ts` | `kit:` + `face:` + `profile:` |
| Structural pins | `characters/cyberdemon-blob.test.ts` | vitest |
| Face decal + its generator | `public/assets/lab/faces/cyberdemon-face.png`, `scripts/make-cyberdemon-face.py` | committed |

The kit's skeleton is a **transcription** of the `.blob` skeleton, and nothing
in the build checks that the two stay in step. Two conversions apply, neither
optional (`goblin-kit.wam` header is the spec):

- **Units.** WAM lengths are fractions of `height`; `.blob`'s are metres.
- **Pitch sign on `down` bones.** WAM tips a `down` bone BACKWARD where `.blob`
  always carries toward +z. `up` bones share pitch verbatim; every `down` bone
  (upperarm, forearm, thigh, shin) NEGATES it. This is silent both ways and is
  what gave the goblin kangaroo knees.

WAM lives outside the repo at `$HOME/Projects/2026/wam` (verified present,
`python3 -m wam.cli` runs). `scripts/build-wam-kit.sh cyberdemon` compiles it.

## The face: the gargoyle road

No mesh means `blob:face-bake` cannot run, and a fully painted face is the
documented failure — `face.ts`'s header records four failed rebuilds, and the
authoring skill states that three dispatches of painted faces "read as a visor
band or a zombie."

`characters/gargoyle.blob` is the one-day-old precedent for a mesh-less face
and it is a third road:

- **Structure is prims.** Cranium, brow, muzzle, ears — and the **ember eyes
  are prims**, not texture.
- **The decal carries the mouth and nothing else.** `gargoyle-face.png` is
  512x512 RGBA with 4,564 of 262,144 texels above alpha 0 (1.7%): a dark mouth
  `(22,14,12)`, near-white teeth `(250,246,236)`, a soft alpha ramp, mid-grey
  alpha-0 elsewhere. 3.5 KB. Worn at `decal 0` (MULTIPLY).

The cyberdemon follows it. Two traps are already paid for and are quoted into
the dispatch brief rather than rediscovered (`gargoyle.blob` lines 235-256):

1. An **all-white identity sheet GLOWS RED**.
2. The fix is gating the sheet's glow off hard — `eyeGlowCut 0.99`,
   `eyeGlowAmp 0` — leaving the eyes to emissive prims.

**Improvement over the precedent:** `gargoyle-face.png` has no committed
generator (`scripts/` holds only `blob-face-bake.py`, which needs a mesh), so
it cannot be regenerated or tweaked without redrawing it by hand. The
cyberdemon commits `scripts/make-cyberdemon-face.py` beside its PNG, so the
decal is reproducible and the next mesh-less character has a worked example.

**Registry face entry:** `ZOMBIE_FLAT` unless the `.blob` declares a `sheet`
block naming a file that actually exists. The minotaur entry is the live
warning here — it declares `image minotaur-face.png` for a file absent from
`public/assets/lab/faces/`, and the lab has been 404ing it silently.

## The loop, rebuilt without a reference

`blob:measure` and `blob:rings` both resolve a reference and exit 2 without
one, so the documented loop's backbone is gone. What replaces it, in order:

1. `validateBody` + the `fused`/`clear` checks — closure, connectivity,
   non-interpenetration.
2. `daylightOf(body, limb, against, join, joinRadius)` at roughly **2% of
   standing height** — whether limbs READ as limbs. This is not optional
   ceremony: the goblin failed owner review twice while `clearOf` reported a
   comfortable +13.4 mm and the render showed a torso with arm-shaped bulges.
   `clearOf` samples centrelines; two surfaces can be a hair apart with both
   axes safely outside each other.
3. `checkStance` — and `stance` must be declared, because omitting it means
   "not checked", not "humanoid".
4. `npm run blob:shot -- cyberdemon` every ~5 edits, and LOOK at the frames.
5. `npm run blob:render-check -- cyberdemon` BEFORE editing further whenever a
   hole or artefact appears. A round hole over a solid CPU field is a renderer
   bug, not a `.blob` bug.
6. `npx vitest run src/lab/sdf-zombie/` green before commit.

`characters/gargoyle-blob.test.ts` is the template for the test file: its
header states the reference is "INSPIRATION, not a fit target (owner,
2026-09-07) — so these are structural pins, not mesh-derived thresholds."
That is exactly this character's situation, with no reference at all.

## Vision: self-report, then adapt

`deepseek-v4.1-flash-expires-on-0910` is **not in the dsh model catalog**
(`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js:1592`
holds three entries; only `deepseek-v4-flash-vision-exp` declares
`inputModalities: ["text","image"]`). The schema defaults absent models to
`["text"]`, and the composed profile overrides nothing — `grep -c
inputModalities` over the full dump returns 0. The model still RUNS, because
dispatch-ui's `writeDshModelPatch` only writes provider + model id.

Catalog therefore says text-only; this has not been tested against the live
API. So the agent **reports what it observes**: `Read` frame-00 once, state
plainly whether it saw pixels, and fall back to the sidecar if not. The result
is recorded to memory so the next run does not re-derive it.

Sidecar: `python3 scripts/vision-ask.py <frame> "<question>"`. It needs
`ZAI_API_KEY`, which lives in `~/.claude/hooks/dualmem-env.sh` and is NOT in a
default shell — the brief tells the agent to source it first.

## Ordering, so a timeout is survivable

Runs here have been cut off mid-flight. The flesh body is a complete,
committable deliverable on its own; the kit is the second half.

1. Skeleton + flesh masses -> checks green -> **commit**
2. Registry entry + test file -> **commit**
3. Verify `?character=cyberdemon` renders the cyberdemon and NOT the zombie
4. Palette + paint -> **commit**
5. Face decal + generator script -> **commit**
6. `.wam` kit -> `build-wam-kit.sh` -> commit the `.gltf`
7. Re-verify, re-run tests -> **commit**

A run that dies after step 3 still leaves a working roster entry.

## Done when

- `?character=cyberdemon` renders a character that is recognisably not the
  zombie and not the minotaur.
- `npx vitest run src/lab/sdf-zombie/` is green.
- `validateBody` errors empty; `daylightOf` clears ~2% of standing height on
  every limb; `checkStance` passes against a declared stance.
- Turntable frames exist in `/tmp/blob-shot/cyberdemon/`.
- The `.blob` header explains the character in the voice `zombie.blob` and
  `schoolgirl-described.blob` use, and every non-obvious number carries its
  reason.
- The report states whether the model could see images, and the numbers behind
  every claim.

## Risks accepted

- **Prose drift.** Accepted by design; there is no reference to drift from.
- **Scope.** Flesh plus kit is two files in two languages and, by precedent,
  650-1000 lines. The ordering above is the mitigation, not a guarantee.
- **Skeleton desync.** Nothing checks the `.wam` skeleton against the `.blob`
  skeleton. If the flesh moves after the kit is built, the plate floats.
