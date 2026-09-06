# Shared character view — and breaking `game-main` into modules

> Date: 2026-09-06
> Status: approved design, awaiting plan
> Blocks: soldier shoot-back AI tasks 6–8, held at
> `~/.claude/dispatch/plans-hold/` pending this work.
> Related: [soldier shoot-back AI](2026-09-06-soldier-shootback-ai-design.md)

## Why

`game-main.ts` is 5,450 lines and `lab-main.ts` is 4,779. Both are a single
`async function main()` whose nested functions share mutable closure scope —
`main()` in `game-main` holds **191 top-level bindings**. There is no seam to
extract against until that state has owners.

But the size is a symptom. The disease is that **the lab and the game duplicate
the wiring that puts a character on screen**, and the duplication has already
produced bugs three times:

1. `lab-main` silently renders the ZOMBIE for any character not hand-listed in
   its registry.
2. `bench-main` duplicates the face-sheet registry from `lab-main`.
3. The soldier shoot-back plan's tasks 6 and 7 were, in their own words,
   "mirrors lab-main's block" — a fourth copy, planned and nearly dispatched.

Every one of those is a registry-lookup miss, not a rendering fault.

### The owner's framing

> "the lab has some specifics that are specific to it but it is meant to be
> mostly a preview of things that can then be inserted easily into the game"

That is the design constraint, and it is not satisfied today. Kit overlays,
held props, motion profiles and baked faces were all previewed in the lab, and
getting the soldier into the game then cost three hand-porting tasks. Had a
shared layer existed, he would have appeared roughly for free.

## Decisions (owner, 2026-09-06)

| Question | Answer |
| --- | --- |
| Scope | Shared layer **and** split `game-main`. `lab-main` is converted to the shared layer but otherwise left alone this pass. |
| Shared layer reach | **A dressed character on screen.** Body, GPU view, face sheet, kit overlay, held prop, and the per-frame pose of all of them. Stops short of behaviour, damage, wounds and crowd. |
| Sequencing | Shared module first, adopted by the lab, then by the game — where it *replaces* held tasks 6 and 7 rather than following them. |
| `march.wgsl.ts` | Out of scope. 3,466 lines of generated shader source is a different animal. |

### Why not the alternatives

- **Split `game-main` first, share later.** Unblocks the soldier soonest, but
  means writing tasks 6–7's hand-port and deleting it a week later — paying
  twice for the same wiring.
- **Design the full target layout and move everything at once.** One reasoning
  pass over the boundaries, but a 10,000-line move across two files where one
  gate is screenshot-based is exactly where "all tests pass" and "the lab still
  works" come apart, with no bisect point when a capture goes wrong.

## 1. The shared modules

### `character-registry.ts`

Pure data. No THREE, no side effects. Name → `.blob` source, kit glTF URL,
face-sheet entry, motion profile.

This merges four registries that are keyed by the same strings and maintained
in three different files today: `lab-main`'s `CHARACTERS` (16 entries), its
`KITS`, its `FACE_TEXTURES`, and `motion-profile.ts`'s `BY_NAME`.

**Separating data from runtime is the point.** Every bug in this area has been
a lookup miss rather than a rendering fault, and a pure data module is directly
testable in ways the current copies are not:

- every registered name resolves to a parseable blob
- every character with a kit entry has a motion profile
- every character whose profile declares `carries` has a `prop` URL
- no character resolves to the zombie by accident — an unknown name is an
  explicit error, not a silent fallback

That last one is the lab's existing bug, fixed by construction.

### `character-view.ts`

The runtime. Given a registry entry and a world position, returns a handle
owning:

- the built, translated body (`parse → compile → buildBody → translate`)
- the `ZombieGpuView`
- the face sheet, **including the `compileSheet` throw-catch**. `compileSheet`
  raises `BlobError` on an unknown key, and one bad key cost an hour on
  2026-09-04 and silently swapped the soldier's face for the zombie's. That
  trap gets one home and one comment, not a copy in `game-main`.
- the `KitOverlay` and `HeldProp`, loaded fire-and-forget so a failed glTF
  cannot take the page down
- `pose(rigResult, bodyYaw, sinceFire)` — one call driving body, kit and prop
  together
- `release()` / `dispose()`

The interface follows the factory-closure pattern the codebase already uses in
`createZombieActor`, `KitOverlay`, `GooLayer`, `HeldProp` and `WoundPanel`, so
it introduces no new idiom. `main()` is the one place in the codebase that
never adopted that pattern.

### The boundary, stated explicitly

`character-view` owns **"a character appears on screen and animates."** It does
NOT own behaviour, damage, wounds, severing, crowd separation or the melee
ring — those are `game-actor`'s and stay there.

The line is *appears* versus *fights*. The lab needs the first and not the
second, which is precisely what makes the first shareable.

## 2. Adoption order

1. **Extract; adopt in `lab-main`.** The lab is the only place this wiring
   exists, so this is a move, not a design. Gate: captures byte-identical.
2. **Adopt in `game-main` — this IS held tasks 6 and 7.** The soldier reaches
   the game by calling the shared module instead of hand-porting the lab's
   block.
3. **Split `game-main`'s remaining subsystems** (§3).
4. **Held task 8 (the shot)** lands on clean ground.

Step 2 is load-bearing: it converts *"a dev tool and the shipping game can
share this"* from an assertion into a demonstration, on real work, while the
change is still small enough to reverse.

## 3. `game-main`'s factory split

The 191 bindings are not 191 independent things. They cluster, and each cluster
is a subsystem that never became a module:

| Module | Bindings absorbed | What `main()` keeps |
| --- | --- | --- |
| `game-fpv-weapon.ts` | `aimRig`, `hingePivot`, `muzzleNodes`, `shellNodes`, `breechNodes`, `extractorNode`, `topLeverNode`, `extractorRestZ`, … | one `weapon` handle |
| `game-chunks.ts` | `chunkBakeEnabled`, `bakedChunkMat`, `bakedChunkSeed`, `totalBakes`, `lastBakeMs`, `lastBakeInfo`, … | one `chunks` handle |
| `game-bleed.ts` | bleed registry, gut ropes, spill state | one `bleed` handle |
| `game-cast.ts` | `actors`, `nextId`, `onSeverDispatch`, `boneRatioOverride` | one `cast` handle |
| `game-tuning.ts` | panel glue, `probeWeight`, `adaptive*`, `normalGradient*`, `boneMesh` | one `tuning` handle |

Eight `let`s become one `weapon`.

### `tick(dt)` is extracted LAST

It is roughly lines 2650–3348 (~700 lines) and it is where the subsystems
interleave. Once the modules exist it becomes a sequence of `weapon.step(dt)`,
`chunks.step(dt)`, `bleed.step(dt)`.

**The ordering between those calls is load-bearing and undocumented.** That is
the single most likely place in this whole refactor for a silent behaviour
change, which is why `tick` moves last, in its own commit, with the current
order transcribed literally and a comment saying so.

## 4. Verification

### Baselines are captured FIRST, as commit one

There is no standing baseline-PNG suite; the "89 PNGs identical" precedent was
assembled ad hoc. A baseline taken after the first extraction is worthless — it
bakes in whatever that extraction already broke.

This is the step most likely to feel like overhead and most likely to be
skipped. It is task one of the plan, not an appendix.

### Three tiers, cheapest first

| Tier | Command | Catches |
| --- | --- | --- |
| Unit + typecheck | `npm test`, `npm run build` | Signature and logic drift |
| Game gates | `sdf-game-{crowd,bleed,slug,shorty}-gate.mjs` | Simulation regressions unit tests miss |
| Lab captures | `blob-render-check.sh` per character, `blob-turntable.mjs`, `lab-look-once.mjs`, `crowd-capture.mjs` | Rendering — byte-identical against commit one |

**No test file may be edited.** A test that needs changing means behaviour
changed, and that is a finding, not an obstacle.

`blob-render-check.sh` exit codes are meaningful and must be propagated: 0 the
renderer agrees with the field, 1 it shows a hole, 2 the check could not run.

### If the captures turn out not to be deterministic

"Byte-identical" assumes GPU output is reproducible run to run on this
machine. The 89-PNG precedent says it is, but that was one task's experience,
not a property anyone has asserted. **Commit one must therefore capture the
baselines TWICE and diff them against each other**, before any code moves. If
that diff is non-empty the gate degrades to a perceptual diff with a stated
threshold, and that is a finding worth recording — it changes how every future
rendering change in this repo is verified, not just this one.

### The honest limitation

None of the above catches `tick()` ordering. Move `bleed.step()` ahead of
`chunks.step()` and every test passes, every capture is a single frame and
looks identical, and the bug surfaces as something subtly wrong in motion a
week later.

Mitigation: `tick` extracted last, in isolation, and the **owner playtest is
the gate for that commit** — which matches the standing preference on anything
motion-related.

### Definition of done

`git diff --stat` shows lines **moved, not rewritten**. Any hunk that is not a
move is a behaviour change wearing a refactor's clothes and belongs in its own
commit with its own justification.

## 5. This is two phases, and the plan should say so

Strictly, this spec covers two projects that the chosen sequencing couples:

- **Phase A — the shared character view.** Baselines, `character-registry`,
  `character-view`, adopted by the lab and then the game. Ends with the soldier
  in the game and held tasks 6–7 obsolete. Delivers working software on its own.
- **Phase B — `game-main`'s factory split.** The five modules, then `tick` last.
  Also delivers working software on its own, and is independently reversible.

They are one spec because Phase A's step 2 is what validates the boundary
Phase B then builds on. But the implementation plan should keep them as clearly
separable phases, so Phase A can ship — and the soldier work resume — without
waiting for Phase B.

## 6. Out of scope

- `lab-main.ts`'s own factory split. It is converted to `character-view` and
  otherwise left alone. Its remaining ~4,000 lines are a later pass.
- `march.wgsl.ts` (3,466 lines) — generated shader source.
- `bench-main`'s duplicated face registry. It should adopt
  `character-registry` too, but it is a third consumer and a separate change.
- Any behaviour change, feature or tuning adjustment. This is a pure refactor.
