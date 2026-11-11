# A baked wound volume for the march (`?woundvol`)

2026-11-11. Design, not built. Follows two spikes on the wounded 22-body mob:
[WOUNDS-WALK.md](../../dev-notes/2026-11-10-silhouette-spike/WOUNDS-WALK.md) (the wound list costs about
26 ms of a 65 ms march, spread over every field call) and
[WOUND-VOLUME.md](../../dev-notes/2026-11-10-silhouette-spike/WOUND-VOLUME.md) (reading the wounds from a 3D
texture takes 16 ms of that back in the replay, at 1 cm or 2 cm voxels alike).

The owner's rule for this work: an approximation is fine if it is not noticed in play, and play is the only
test. So the design is staged to put something playable behind a flag as early as possible, and each stage
ends at an owner playtest that can stop the work.

## Goal

On a mob of wounded bodies the march's field call stops walking a list of up to 32 wounds. It reads one
voxel of a volume that was baked when the body was hit.

Not a goal: a look identical to the list's. The replay differs on about 11,500 of 120,000 pixels, mostly
where the limb re-fold is gone.

## Stage 1: the re-fold off, in game (`?woundfold=0`)

About 10 of the replay's 16 ms came from the owner re-fold no longer running, and the list can drop that
without any volume. The re-fold is what stops a crater on one limb from eating a limb beside it.

- A compile-time flag in the style of `normal-loose-flag.ts`. Default on (today's text, byte for byte);
  `?woundfold=0` compiles `mapBody` without the re-fold and without the owner bookkeeping in `applyWounds`.
- A golden test pins the default text; a text test pins that the off text has no re-fold call.
- Measure by alternation on the wounded ring mob (`frameSplit`), with an A/A control.
- **Owner playtest.** If a crater eating a neighbouring limb is not noticed, this ships as the default and
  stage 2 starts from it. If it is noticed, stage 2 has to give the re-fold's result, which decides the
  volume's layout (below).

This stage is small and is worth having whatever happens to the volume.

**Built 2026-11-11** (`march/wound-fold-flag.ts`; one `false &&` on the re-fold's condition in `mapBody`, the
owner bookkeeping left in because the inside-flesh fold's gate reads it). The wounded mob's `sdf:march` pass,
captured from the game with the flag on and off and replayed by alternation, 5 repeats: **59.3 ms on, 48.6 ms
off, -10.8 ms (-11.2 to -10.1)**; on against on, -0.1 (-1.7 to +1.7). The game's `?woundfold=0` text is the on
text with that one edit (a generated buffer name aside). Sheet:
[`mobw-woundfold-off.png`](../../dev-notes/2026-11-10-silhouette-spike/look/wound-volume/mobw-woundfold-off.png)
(on | off | difference x 8). Not measured: live frame time, the compute march, motion. **Off by default since
2026-11-11** (owner's call after playing it: "looks fine, make it default"; `?woundfold=1` brings the re-fold
back, byte for byte). So stage 2 starts from a march without the re-fold, and its volume need not replace it.

## Stage 2: the volume, in game (`?woundvol`)

### Where a wound lives

A `Wound` already rides one primitive (`primIdx`, `local`, `axis0` in `damage.ts`); the CPU moves it to
world space every frame only so the shader can test it against the posed body. The volume keeps it where it
is stored:

- **One volume per wounded body, in the body's rest pose.** The shader maps a sample point to the rest pose
  with `restPoint` (it exists, and the replay charged about 2 ms for a call on every read), and reads the
  volume there. Limbs are apart in the rest pose, so a crater on an arm mostly cannot reach the torso; this
  is the design's stand-in for the re-fold.
- A per-body volume needs no body id texture. The spike needed one only because its grid was shared.
- If stage 1's playtest says limbs must be kept strictly apart, the fallback is a volume per limb cluster.
  That costs a read per cluster near the point and is not designed here.

### What a voxel holds

Four values, `rgba16float`, as the spike found:

| Channel | Value |
| --- | --- |
| r | the carve chain run with the rim bumps, from deep inside (`d = -1`) |
| g | the sum of the rim bumps |
| b | the largest bump amplitude |
| a | the carve chain run without the bumps |

The read, in place of the wound loop:
`max(dIn - gate * g, mix(a, r, gate))` with `gate = 1 - smoothstep(-b * 0.3, b * 0.7, dIn)`, joined by the
list's `smax`. A voxel at the floor value in both chains with no bump returns `dIn` untouched.

### The bake

- **Rebake, not stamp.** The chain is order-dependent (a later crater cuts an earlier rim), so a new hit is
  not a `max` over the old voxels. Each time a body's wound list changes, the voxels inside the boxes of the
  changed wounds are recomputed from the whole list. Age enters the shape in one place only: a burn
  deepens over its first second (`depth * 0.35 * clamp(age, 0, 1)`), so a burn's box is rebaked each frame
  for that second. Nothing else is rebaked between hits.
- **On the CPU first, in a pure module** (`wound-volume-bake.ts`, no renderer imports): rest-pose wound
  rows in, a `Float32Array` box out. It is a transliteration of the `applyWounds` chain (the ragged and torn
  edges' noise included), checked by a test against values the shader itself returns for a fixed wound
  list, recorded once through the replay harness. No CPU mirror with the rim bump exists today
  (`chunk-bake-field.ts` drops it). The renderer uploads the box with a partial
  texture write.
- Expected cost at 2 cm, not measured: a pellet's box is about 15³ voxels, a blast's about 30³; a body hit
  by a volley is on the order of 100,000 chain evaluations, about a millisecond of JavaScript. Stage 2
  measures it on a double-barrel volley into the mob. If it shows in the frame, the bake moves to a compute
  pass in WGSL with the same inputs; the module stays as its reference.

### Memory

- 2 cm voxels. A rest-pose body box of about 1.0 × 0.6 × 2.0 m is 50 × 30 × 100 voxels, 1.2 MB.
- A pool of 24 bodies in one 3D texture (about 29 MB), one voxel of padding between neighbours so the
  trilinear read does not bleed.
- A body takes a slot at its first wound. When the pool is full the slot of the farthest wounded body is
  reused and that body goes back to the list. Bodies with no slot draw exactly as today.

### What stays on the list

- Bodies with a cut wound, an open head split, gib chunks and the first-person hands: no volume, today's
  path. The instance row carries the slot (or none), and `applyWounds` branches on it once, after its bound
  test.
- The hit's shading: the analytic normal, the wound masks, holes and decals read the list as now. That is
  per shaded pixel, not per step.

### Where the text lives

- `march/wound-volume-flag.ts`: `WOUND_VOLUME`, default off, off text byte-identical (the golden holds it).
- `march/fields/wound-volume.wgsl.ts` (not in the barrel): the read block and the extra bindings.
- `wounds.wgsl.ts`: the branch, spliced only when the flag is on.
- `webgpu/wound-volume-pool.ts`: slots, eviction, the texture and its partial writes.
- `wound-volume-bake.ts`: the pure bake.

The compute march takes the same helper text; it is checked in the same playtest.

### Measuring and deciding

- By alternation on the wounded ring mob, flag off and on, with an A/A control: march time and whole frame.
- The cold compile of the march programs, since both wound paths are now in the text.
- A look sheet (off | on | difference) on a still frame and on a body mid-stride with a wound at the elbow
  and one at the hip.
- **Owner playtest.** The stage is dropped if the gain in game is under about 8 ms on that mob, or if the
  owner sees seams or swimming craters at joints.

## Revision, 2026-11-11: the goal is more wounds

Stage 1 shipped and left the volume about 4 ms to win, so the owner stopped. The owner then gave a different
reason to build it: the ring of 32 wounds a body (`MAX_WOUNDS`) is too few. It shows on the spider brain (a big
fleshy mass), on soldiers and the chaingunner, and with the shotgun, where every pellet is a wound; a blast
stamps 16 (`BLAST_WOUNDS_PER_BODY`), so two blasts fill the ring. A volume has no count. This section replaces
what it contradicts above.

**The goal now:** a body's wound shape is not capped. Frame time must not be worse than today's on the wounded
mob; a gain is welcome and not required.

### A hit is stamped, not rebaked

Wounds are only ever appended, and appending wound `k` to a voxel is an update from its old values:

| Channel | Update |
| --- | --- |
| r (chain with bumps) | `smax(r, carve_k) - bump_k` |
| a (chain without bumps) | `smax(a, carve_k)` |
| g (sum of bumps) | `g + bump_k` |
| b (largest amplitude) | `max(b, amp_k)` |

So the stamp touches the voxels in the new wound's box only and needs nothing of the body's history. The
order-dependence found in the spike matters only for removing or reordering a wound, which the volume never
does: a wound evicted from the ring stays in the volume. The one in-place replacement today is a head region's
crater; the head stays on the list (below). A burn's first second is the other exception: its depth grows, and
a carve only deepens, so it is re-stamped each frame for that second with `smax`, its bump added once at the end.

### Stage 2a: the look (`?woundvol`), humanoids only

A plain box a body (the layout of "Memory" above, pool of 24, 8 bits a value), stamping on hit, the read in
`applyWounds`. The ring stays at 32 and keeps feeding the hit's shading (normal, masks, colour, holes, decals),
the head, cuts, and bodies with no slot. Bodies with a slot stop walking the list for shape.

**8 bits a value from the start** (owner's call, 2026-11-11: "8 bit should be acceptable"). The values span
about 12 cm either way, so a step is about 1 mm and a humanoid's box is about 0.6 MB. Two things to watch, since
the spike was 16-bit: a stamp reads rounded values and writes rounded values, so many overlapping stamps can
drift by a step each; and the bump sum is clamped to the range.

This stage answers what only play can:

- seams and swimming craters at joints;
- softer crater edges at 2 cm;
- whether a crater older than the ring still reads as a wound (the colour volume below).

**The colour is stamped too** (owner, 2026-11-11: a crater that keeps its shape and loses its colouring is an
issue, so this is in 2a and not a later fix). The hit's shading takes four things from the rows: the one wound
mask (`woundMask`: 0 at healthy skin, 1 deep inside, the 1.6-radius footprint), its cavity share, the char mask
of burns (`charMask`), and the wet-lip and cloth-hole marks. A second 8-bit texture beside the shape holds those
four, each stamped as the larger of old and new. At the hit the shading takes the larger of what the rows give
and what the volume gives, so a wound still in the ring looks as it does today and one that has left it keeps a
voxel-soft copy of its colouring. That doubles the memory: about 1.2 MB a humanoid at 8 bits.

What the copy loses, to be judged in play: the ragged and torn edges' fine detail (2 cm voxels), the soak's
frayed edge, and anything that ages (a row's age is gone with the row; the stamp holds the look at stamp time).

**Owner playtest**, on a soldier and a chaingunner shot well past 32 pellets. Dropped if the joints or the old
craters read wrong, or if the wounded mob's march is slower than today's.

### Stage 2b: bounded memory, and the big bodies

Only if 2a passes. A dense box is about 1.2 MB for a humanoid and about 20 MB for a 3 m body, nearly all of it
voxels no wound touches.

- **Bricks.** A body has a coarse pointer grid over its rest-pose box; bricks of 16 x 16 x 16 voxels (32 cm at
  2 cm) come from one shared 3D texture when a stamp first touches them. One more texture read a field call.
- **A fixed budget.** The shared texture does not grow (about 32 MB to start). When it is full the bricks of the
  farthest wounded body are reused and that body goes back to the ring's list.
- **Voxel size by body.** 3 to 4 cm on the spider brain, whose craters are larger.

Stage 2b is measured as stage 2 was, plus the budget under a long fight: how many bodies hold bricks, and
whether a body falling back to the list is seen.

## Revision 2, 2026-11-11: the rest-pose volume tears; nothing of stage 2a is built

Before building 2a its first risk was measured on the CPU, and it fails. `restPoint` maps a point through its
DOMINANT primitive, by a shortest-arc swing of that primitive's own axis. Two primitives of one rigid limb
therefore map the same motion differently, and a zombie's torso is six primitives, an arm four. A cluster of the
zombie was turned rigidly and the mapping compared with the true one
([`wound-seam.scratch.test.ts.txt`](../../dev-notes/2026-11-11-wound-volume/wound-seam.scratch.test.ts.txt);
move it into `src/lab/sdf-zombie/` as a `.test.ts` to run it):

| Motion of the limb | Step in the mapping across a primitive boundary, points under 3 cm apart (median / 90th centile) |
| --- | --- |
| 8 degrees of twist, 10 of bend | torso 1.6 / 2.4 cm, arm 0.9 / 2.5 cm, leg 0.4 / 1.6 cm |
| 20 and 30 | torso 1.5 / 6.5 cm, arm 3.2 / 8.1 cm, leg 1.4 / 3.5 cm |
| 45 and 70 | torso 3.1 / 13.4 cm, arm 5.3 / 15.1 cm, leg 2.9 / 8.0 cm |

A pellet crater is 5.5 cm in radius. A crater read from one rest-pose volume would crack along every primitive
boundary it crosses, by centimetres, in an ordinary walk; not only at joints. The skin noise lives with the same
seams because it is small and statistical. A crater cannot. (The test turns a cluster rigidly and sets no orient
quaternion, as `rest-space.test.ts` does; a rig that stamps an exact quaternion on every primitive would not
have the seam, and today only point spheres and skull primitives carry one.)

**What the cap does today, found on the way:** at 32 the ring does not drop the oldest wound, it MERGES it into
its nearest crater on the same primitive when one is in reach (`pushWound`, `mergeVictim`), and evicts it only
when none is. So "too few wounds" shows as craters fusing into fewer, larger ones.

### The layout that does not tear (proposed, not approved)

- **A volume a wounded primitive, in that primitive's own frame**, the frame its wounds already ride in. Every
  crater moves rigidly with its primitive, as craters do today. Memory is sparse by construction (a forearm's box
  is about 90 KB at 2 cm and 8 bits, a torso primitive's about 200 KB; nothing for an unwounded primitive), so
  the bricks of stage 2b are not needed for humanoids.
- **Stamped when a wound leaves the ring**, in place of the merge. The newest 32 wounds stay on the list and look
  exactly as today: ragged and torn edges, ageing, the exact colour. Only what would have been merged away goes
  into the volume, as a round, voxel-soft crater with its colour. The order comes out right for free: the volume
  holds the oldest wounds and is applied first, the list after it.
- **The read**: a body carries a short table of its wounded primitives (world bound, the world-to-volume
  transform the CPU already knows, the box in the atlas). A field call tests each bound and reads the volumes it
  is inside, before the wound loop. A body under 32 wounds has no table and pays nothing.
- **What it gives up against the first design:** no speed-up. The list is walked as today, and a body past 32
  wounds pays the volume reads on top. The ring's size becomes the knob: a smaller ring moves wounds into the
  volume sooner, which is cheaper and softer.

### Built, 2026-11-11 (`?woundvol`, default off)

The layout above, after the owner saw a close-up of baked craters (exact | 2 cm | 1 cm, 8 bits) and passed the
look. What is in the tree:

- `wound-volume-stamp.ts` (pure): the voxel box, the stamp of one round crater (shape and colour), and the CPU
  twins of the shader's read. Tested against the list's crater steps.
- `webgpu/wound-volume-store.ts`: one RGBA8 3D atlas (192 x 192 x 128, 19 MB), a box a wounded primitive with its
  colour voxels stacked after its shape voxels, and a body's table of boxes. A stamp sends only the voxels it
  touched to the GPU.
- `webgpu/character-view.ts`: under the flag the wound ring never merges at its cap; the crater that overflows
  is stamped at the next refresh.
- `march/fields/wound-volume.wgsl.ts`: `applyWounds` reads the boxes before its list; the wound masks take the
  stamped colour; inside a stamped crater's footprint the shading normal comes from the finite-difference taps.
- **No new binding.** The atlas is bound where the shader takes `segVolumeAtlas` (used only by
  `?skeleton=volume`; the two do not combine), and the table rides the wound rows' free columns (32 and up).
- `?woundvol=<cm>` sets the voxel (1 to 4 cm; `?woundvol` is 2 cm). Up to 24 boxes a body.

Seen in the game (arena, one zombie, 100 pellets fired from the eye, 86 to 89 landing): the list holds 32, 13
boxes hold the rest in 2.0 MB, no GPU errors.
[`arena-100-pellets-off-on.png`](../../dev-notes/2026-11-11-wound-volume/arena-100-pellets-off-on.png): left,
the switch off (the overflow merged: the torso opens into a few large cavities); right, on.

Not done, not measured:

- **Frame time.** Nothing was timed. A body past 32 wounds pays the box reads on top of the list.
- **Gameplay.** With the switch on the ring no longer merges, so a crater that would have grown (and could sever)
  leaves the list instead. Not played.
- Motion, the mob, soldiers and the chaingunner (their visual wound lists), the spider brain, an open head split,
  gib chunks (a severed part does not take its boxes with it), the compute march, the hull pass.
- The ragged and torn edges of a stamped crater; cuts, decals, cloth holes and head craters are never stamped.
- The normal-gradient probe page does not compile with the switch on (its `applyWounds` call has no atlas).
- A full atlas drops the wound, as an evicted wound always was dropped; nothing is evicted to make room.

## Risks

1. **Joints.** `restPoint` follows the dominant primitive, and the dominant primitive flips at a joint. A
   crater across a joint is read from two rest positions and can tear. The roll about a limb's own axis is
   also not resolved by `restPoint`; the stamp must use the same mapping so the two agree. This is the
   reason stage 2 can fail, and only motion shows it.
2. **Softer crater edges.** The replay kept 14 % of the carve at crater edges that the list removes. At
   2 cm a pellet crater (5.5 cm radius) is under six voxels across.
3. **The gain in game is not the replay's.** The replay's 16 ms included 10 from the re-fold, which stage 1
   takes on its own. The volume's own share was about 6 ms less 2 for `restPoint`.
4. **Two paths in one shader.** Compile time and text size go up for a gain that only wounded mobs see.

## Not in this design

A stamp per hit on the GPU (the stamp is on the CPU first), per-limb-cluster volumes, cut wounds and the head split in the volume, a
smaller texel format, volumes for corpses beyond the pool. Each waits on stage 2's playtest.

## Timed, 2026-11-11

`scripts/native-spike/wound-volume-ingame.mjs` with `docs/dev-notes/2026-11-11-wound-volume/prelude-mob-heavy.js`:
the 22-zombie mob, the six nearest bodies shot about 70 times each (every one overflows the list). Whole frames,
fresh page a leg, four rounds, headless Chrome on the M3 (`ingame-mob-heavy.json` beside the prelude).

| Leg | Frame | Against off |
| --- | --- | --- |
| off | 62.30 ms | |
| off again (control) | 62.33 ms | −0.19 ms (−1.09 to +0.54) |
| `?woundvol` (2 cm) | 68.29 ms | +5.49 ms (+4.71 to +6.48), +8.8 % |

- With the flag on the six bodies hold 34 boxes, 6.3 MB of the 19 MB atlas.
- The two legs do not draw the same wounds: off merges the overflow into larger craters, on keeps them apart.
- Baking is not a spike: `stampCrater` 0.25 ms a crater at 2 cm (1.8 ms at 1 cm), an atlas upload 0.07 to 0.2 ms.
- Not timed: 1 cm voxels, a body with boxes but a short list, MAP28.

### Where the 5.5 ms goes (same day)

Same scene and script; each row is `?woundvol` against off, three or four rounds.

| Build | Against off |
| --- | --- |
| As first built (whole box, eight texels a read) | +5.49 ms (+4.71 to +6.48) |
| Touched sub-box only, four texels a read (tetrahedral); kept | +5.41 ms (+1.44 to +7.93) |
| ... without the near flag from baked craters | +4.89 ms (−0.71 to +5.35) |
| ... without the shading normal's fallback on baked pixels | +4.91 ms (+4.75 to +6.11) |
| ... without the carve in `applyWounds` | +0.26 ms (−1.30 to +0.77) |
| ... every read done, the shape left unchanged (carve scaled by 1e-4) | +2.28 ms (+1.77 to +5.62) |

- The cost is the carve in the march. The near flag and the normal's fallback are not it.
- About 2 ms of it is the lookups. The rest is marching a body that shows some forty more craters than the merged
  one does, and comes with showing them.
- The sub-box and the four-texel read made no difference the run can resolve (noise is about 1 ms). They stay:
  fewer loads, and the still holds (`mob-heavy-on.png`, `mob-heavy-off.png` beside the prelude).
- The variants were temporary `?wvdbg` bits, removed.

## On by default, 2026-11-11

The owner played it on E1M1 and MAP28 and made it the default. `?woundvol=0` restores the shader text of before the
switch byte for byte (the golden holds it) and the merge on overflow.

- `?skeleton=volume` turns it off: that mode needs the 3D texture for its own volumes.
- The normal-gradient probe compiles the list-only `applyWounds` (`probeApplyWounds`), so the page builds again.
- What the default now changes in play: a body past 32 wounds keeps separate craters where it used to grow a few
  merged ones (up to 16 cm). Whether any sever rule read the merged size is not checked.
- Not re-taken: the march-hash pins and the other GPU gates. `scripts/native-spike/ladder.mjs` edits the old
  `applyWounds(...)` call text and needs `woundvol=0` captures.
- Pages with their own renderer (not `lab-renderer.ts`) never call `bindRenderer`, so a stamp there re-uploads the
  whole 19 MB atlas; the game does not.
