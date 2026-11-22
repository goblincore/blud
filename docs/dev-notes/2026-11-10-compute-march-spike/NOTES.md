# The march as a compute pass: a spike in the replay harness (2026-11-10)

The idea is [the research note's §3 D](../2026-11-09-sdf-perf-research/NOTES.md): march the bodies in a compute
pass, one workgroup per screen tile, so a tile's pixels share one copy of its list and empty tiles are never
dispatched. Measurement only, in the replay harness. No renderer code changed.

**Answer: faster, by a quarter to a half on crowds, and not for the reason the idea gave.** The shipped `sdf:march`
pass (lean walk, tile reference list, hull exit bound on), replayed as a compute pass made from the same shader
text, against the fragment pass of the same captured frame, 400 × 300, Apple M3:

| Frame | Fragment pass | Compute, one 16 × 16 workgroup a tile | Compute, 8 × 8 workgroups (four a tile) |
| --- | --- | --- | --- |
| Clean close-up, one zombie at 0.6 m | 5.1 ms | 4.2 ms, **−17 to −19 %** | 3.8 ms, **−24 to −26 %** |
| The same, walk only (flat albedo) | 1.7 ms | 1.7 ms, no different (−0.3 %) | 1.6 ms, −7 % |
| Crowd, 12 zombies across the room | 13.6 ms | 7.8 ms, **−43 to −45 %** | 6.0 to 6.7 ms, **−50 to −55 %** |
| The same, walk only | 7.1 ms | 4.4 ms, −38 % | not run |
| Close mob, 22 zombies filling the screen | 37.7 ms | 27.8 ms, **−26 to −27 %** | 24.1 to 25.0 ms, **−33 to −35 %** |
| The same, walk only | 18.8 ms | 13.8 ms, −26 to −29 % | 11.6 ms, −40 % |

Percentages are the median paired difference, as a range over the runs that hold that leg (one to four runs of six
repeats each). The A/A control (the fragment pass against itself) read between −1.7 and +0.9 % in every run.

What the numbers say:

1. **The gain comes from being a compute pass, not from what a tile shares.** The straight port, with every pixel
   still reading and culling its tile's list for itself, has all of it. Skipping empty tiles adds 0 to 2 points.
   Reading the tile's entries once a workgroup adds nothing. Replacing the pixel's own list with a 64-bit mask over
   the workgroup's copy adds 0.5 to 2 points on the shipped frames (2 to 6 on the walk-only ones).
2. **The workgroup's size and shape matter more than its contents.** 8 × 8 beats 16 × 16 on every frame. 8 × 4 and
   4 × 8 are within 3 % of 8 × 8. Strips lose to blocks of the same count (16 × 4 against 8 × 8, 16 × 2 against
   8 × 4). 4 × 4 is slower than the fragment pass on the close-up and the mob, and on the mob 2 × 2 and 1 × 1 are 4
   and 14 times slower.
3. **It needs the reference list.** On the old per-pixel arrays (`?tileref=0`) the same port is no faster on the
   close-up (+0.8 %) and 8.5 % faster on the mob. The risk §3 D named, that the reference list had already taken
   the gain, is the wrong way round: the list is what lets the compute pass pay.
4. **The picture is the same to the eye and not to the bit.** No texel changes between hit and miss. The walk-only
   frames have 0, 0 and 1 texels over the harness's 1e-4 bar. The shipped frames have 48 to 143 of 120,000, and one
   pixel of the mob moves by more than 0.02. Detail below.
5. **Why is not established.** The data fit a GPU that runs invocations in fixed-width batches, where a batch waits
   on its slowest member and neighbours that take different paths cost each other. That is a reading, not a
   measurement.

This is a replayed pass, not the game. Nothing here says what a frame gains.

## Method

- **Frames.** Three frozen scenes on the shipped page (`?frozen=1`), each captured twice from one boot: as shipped,
  and with the flat-albedo seam on (the walk without the post-hit chain). `scripts/native-spike/compute-capture.sh`.

  | Frame | Draws in the pass | Hit pixels | Tiles in the draws' rects | Not empty | Longest list |
  | --- | --- | --- | --- | --- | --- |
  | Close-up (the pinned pose of [TILE-REF.md](../2026-11-09-sdf-perf-research/TILE-REF.md)) | 1 | 44,558 (37 %) | 475 | 467 | 14 |
  | Crowd (`SPIKE_SCENE=crowd`, 12 zombies) | 4 | 13,514 (11 %) | 576 | 149 | 58 |
  | Mob (`prelude-mob.js`: 22 zombies in a block from 0.9 m, plus the room's own) | 3 | 81,277 (68 %) | 877 | 478 | 64 (the cap) |

- **The compute pass.** `scripts/native-spike/compute-march.mjs` turns each captured fragment program into a compute
  program by exact-match edits of its text (an edit that stops matching throws by name). The field code, the
  buffers and the textures are the game's. What changes:
  - the entry point: `@compute`, the pixel from the workgroup's tile and the invocation's position, `fragCoord` built
    as the pixel's centre (the march takes its ray from `fragCoord`, so the ray is the same expression);
  - every `discard` becomes a flag and the invocation writes nothing;
  - the outputs: colour to an `rgba32float` storage texture, depth to an `r32float` one that is read back and tested
    less-equal, as the render pipeline's depth test does, so a pass with several draws composes the same way;
  - one extra bind group: the two targets and a tile list the harness builds from the captured tile header buffer.
  One dispatch a captured draw, in the draw's order. A clear of both targets runs before the compute pass, in place
  of the render pass's own clear.
- **Legs** (the names the script takes):

  | Leg | What it is |
  | --- | --- |
  | `frag`, `frag2` | The fragment pass as captured, and again (the A/A control) |
  | `port` | One 16 × 16 workgroup per tile of the draw's screen rect, empty tiles included; the per-pixel code unchanged |
  | `list` | The same program over the tiles whose list is not empty |
  | `shared` | `list`, and the tile's entries read once a workgroup into workgroup storage; a pixel culls against that copy and keeps its own compacted list |
  | `mask` | `shared`, and the pixel's own list (256 bytes) replaced by a 64-bit mask over the workgroup's copy |
  | `list8`, `list4`, `list8x4`, … | `list` with smaller workgroups: 8 × 8 is four a tile, 8 × 4 is eight |
  | `mask8` | `mask` with 8 × 8 workgroups, each loading the tile's entries |

- **Timing.** As [`lean-ab.mjs`](../../../scripts/native-spike/lean-ab.mjs): 10 copies of the pass a submit, 15
  rounds, the median; legs in rotation; six repeats; each leg's difference from `frag` in the same repeat. The
  1-minute load was 1.6 to 7.1 at the start of the runs. The ranges are tight all the same (the worst single A/A
  repeats were −6.8 % and +10 %, both on the crowd).
- **Comparison.** Each leg's colour target (rgb, and clip depth in alpha) against the game's own readback of that
  frame, which is the fragment pass's output. The replayed fragment pass matches it exactly on every frame (0 floats
  differ).

## Results

Median ms a pass, and the median paired difference from the fragment pass with its range over the repeats. Run 1
unless marked.

**One workgroup a tile**

| Frame | `frag` | `port` | `list` | `shared` | `mask` |
| --- | --- | --- | --- | --- | --- |
| Close-up, shipped | 5.08 | 4.19, −17.4 % (−20.5 to −15.2) | −17.7 % | −17.8 % | 4.11, −18.5 % (−21.7 to −16.0) |
| Close-up, walk only | 1.69 | 1.69, −0.3 % (−2.4 to +1.8) | −1.8 % | −1.5 % | 1.56, −8.0 % (−11.2 to −4.1) |
| Crowd, shipped | 13.56 | 7.77, −42.8 % (−46.6 to −41.2) | −44.5 % | −43.9 % | 7.49, −45.1 % (−47.9 to −43.2) |
| Crowd, walk only | 7.12 | 4.43, −37.7 % (−40.6 to −32.0) | −39.2 % | −39.2 % | 4.14, −41.5 % (−43.0 to −36.8) |
| Mob, shipped | 37.74 | 27.84, −25.7 % (−26.9 to −25.6) | −26.2 % | −25.8 % | 27.33, −27.5 % (−27.7 to −27.0) |
| Mob, walk only | 18.75 | 13.75, −26.3 % (−27.6 to −24.6) | −27.0 % | −27.1 % | 12.82, −31.9 % (−32.1 to −29.5) |

Run 2 of the three shipped frames, a few minutes later, reads the same: `port` −18.4 %, −44.1 % and −26.6 %.

**Workgroup size and shape** (the tiles that are not empty; shipped frames; from the size and shape runs)

| Workgroup | Invocations | Close-up | Crowd | Mob |
| --- | --- | --- | --- | --- |
| Fragment pass | | 5.19 ms | 13.70 ms | 37.55 ms |
| 16 × 16 | 256 | 4.26, −17.6 % | 7.43, −45.3 % | 27.52, −26.8 % |
| 16 × 4 | 64 | 4.08, −19.2 % | 7.06, −47.6 % | 26.81, −29.6 % |
| 16 × 2 | 32 | 4.23, −16.3 % | 7.08, −47.0 % | 27.44, −28.0 % |
| **8 × 8** | 64 | **3.86, −25.9 %** | **6.71, −50.8 %** | **25.01, −33.4 %** |
| 8 × 4 | 32 | 3.92, −22.9 % | 6.71, −50.0 % | 25.37, −33.4 % |
| 4 × 8 | 32 | 3.96, −22.0 % | 6.61, −50.9 % | 25.38, −33.2 % |
| 4 × 4 | 16 | 7.32, **+41.4 %** | 9.33, −31.8 % | 44.86, **+19.4 %** |
| 2 × 2 | 4 | | | 139 (one repeat) |
| 1 × 1 | 1 | | | 512 (one repeat) |
| 8 × 8 with the mask | 64 | 3.81, −26.6 % | 6.75, −50.4 % | 25.04, −33.2 % |

- The strips and the 8 × 4 pair come from a separate run: their percentages are against that run's own fragment
  leg (5.06, 13.46 and 38.13 ms), and its 8 × 8 read 3.86, 6.61 and 24.95 ms.
- On the walk-only frames 8 × 8 reads −6.7 % (close-up) and −39.7 % (mob), and the mask on top of it −17.5 % and
  −42.0 %.

**The old per-pixel arrays** (`SPIKE_QUERY='frozen=1&tileref=0'`, the same three scenes staged again)

| Frame | `frag` | `port` | `list` |
| --- | --- | --- | --- |
| Close-up, shipped | 11.10 | 11.16, +0.8 % (−0.1 to +2.2) | +0.5 % |
| Mob, shipped | 51.49 | 47.15, −8.5 % (−9.0 to −7.3) | 43.39, −15.8 % |
| Mob, walk only | 30.73 | 30.83, −0.4 % (−4.4 to +0.6) | 26.88, −13.0 % |

- A compute invocation pays for 3.3 KB of private arrays as a fragment does. The stage does not make private
  storage free.
- Here skipping empty tiles is worth about 4 ms on the mob, because every invocation of an empty tile still paid
  for the arrays. With the reference list the same skip is worth 0 to 0.2 ms.

**A wounded mob** (added the same day; `prelude-mob-wounded.js`, scene `mobw`: the same 22 bodies with a 9 × 5 fan
of pellet and slug shots from the eye, each stamped on the nearest body it hits)

| Frame | `frag` | `list` (16 × 16) | `list8` (8 × 8) | A/A |
| --- | --- | --- | --- | --- |
| Wounded mob, shipped | 61.09 | 44.98, −26.0 % (−29.7 to −23.9) | 40.45, −33.9 % (−37.1 to −31.4) | −1.7 % (−15.1 to +4.4) |

- The gain holds on the heavier path: the same percentages as the clean mob, on a pass that is 23 ms dearer.
- The machine was noisier for this run (see the A/A range); the sign held in every repeat.
- The staging asserts at least 12 wounds on at least 5 bodies; the exact count was not recorded.
- Its comparison: 83 texels over 1e-4, largest difference 1.2e-3, no pixel over 0.02, no hit/miss change.

## The comparison

Every compute leg of a frame gives the same numbers, whatever its list handling or workgroup size, so the
differences come from the stage and not from the edits to the list.

| Frame | Texels over 1e-4 (of 120,000) | Largest difference | Floats not identical (of 480,000) | Pixels whose colour moved by more than 0.02 |
| --- | --- | --- | --- | --- |
| Close-up, walk only | 0 | 9.5e-7 (depth) | 5,284 | 0 |
| Crowd, walk only | 0 | 1.2e-7 (depth) | 781 | 0 |
| Mob, walk only | 1 | 7.3e-4 (depth) | 3,704 | 0 |
| Close-up, shipped | 79 | 9.9e-4 (colour) | 45,019 | 0 |
| Crowd, shipped | 48 | 1.4e-3 (colour) | 10,758 | 0 |
| Mob, shipped | 143 | 0.046 (colour) | 44,930 | 1 |

- No texel is a hit in one image and a miss in the other, on any frame.
- On the shipped frames the depth agrees to 1e-6 (one texel of the mob aside, the same texel as in its walk-only
  frame); the differences over the bar are in the colour.
- The old-arrays captures give the same counts (80 and 144 texels), so the reference list is not the cause either.
- **So the 1e-4 bar is not met on the shipped frames, and bit identity is not met on any.** The cause is not
  established. The two stages compile the same text; the likeliest reading is that the compiler rounds some
  arithmetic differently in a compute function, and the post-hit chain (normals, probes) amplifies the last bit.
  `march-hash` pins would move.

## What the tile shares: managed, and what stood in the way

| | Done? | How, or why not |
| --- | --- | --- |
| The tile's entry list read once a workgroup | Yes (`shared`, `mask`) | Three `var<workgroup>` arrays of 64 (bound, distortion, reference). The first n invocations load one entry each, then `workgroupBarrier()`. The barrier must sit in uniform control flow, so it comes before any return. Worth nothing measurable. |
| The tile's header read once a workgroup | No | An invocation has to learn which tile it is in: it reads its tile's record (two `vec4<u32>`) from the spike's tile buffer, which also carries the header's offset and count. WGSL gives a workgroup no shared value without a read or a barrier. One uniform-indexed read a pixel. |
| A pixel's cull as a mask over the tile's list | Yes (`mask`) | Twelve edits: the readers loop over the tile's list and skip entries and slot runs whose bits are clear, so each fold sees the same entries in the same order. Its comparison numbers are `list`'s on every frame (the two outputs were not compared with each other). |
| Empty tiles never dispatched | Yes, in the harness | The harness builds the list of non-empty tiles on the CPU from the captured header buffer. The game bins on the GPU (`tile-bin-compute.ts`), so it would need a compaction kernel and an indirect dispatch. With the reference list this is worth 0 to 2 points; dispatching every tile of the rect is enough. |
| Storage texture formats | No obstacle | Colour is a write-only `rgba32float` storage texture. A depth texture cannot be a storage texture, so depth is `r32float`, bound read-write (the `readonly_and_readwrite_storage_textures` language feature) for the depth test. |
| Binding counts and limits | No obstacle | One more bind group (two storage textures, one storage buffer): six storage buffers in the stage against a default limit of eight. No limit was raised. |
| One workgroup per 16 × 16 px tile | With a correction | At 300 px high the grid has 19 rows of 15.8 px, so a tile is 15 or 16 rows. A workgroup starts at its tile's first pixel and an invocation that lands in the next tile returns. |

No compile or validation error stopped any leg. Each new compute text took 25 to 58 s to compile cold in Chrome
(one to three programs a frame); the fragment programs were already in the cache, so there is no cold comparison.

## What this suggests

- A compute march in 8 × 8 workgroups, with the per-pixel code as it is, is the form to build if this goes on: it
  needs no workgroup storage, no barrier and no list of tiles. On the mob's march pass it is 37.7 ms to about 25.
- Whether the batch reading in point 5 is right could be tested directly: sort a tile's rays before the walk so that
  rays of a kind sit together (§3 D's "rays can be grouped"), which a compute pass allows and this spike did not try.
- The gain is on top of the reference list and needs it. Whether it stacks with the levers still open (the
  field-derived silhouettes, the analytic normal on wounded bodies) is not measured.

## In the game, behind `?marchcompute` (added the same day)

Built as the form above suggests: `src/lab/sdf-zombie/webgpu/march-compute.ts`, switch in
`march/compute-flag.ts`. Off by default; off, no node of it is created and the golden shader snapshot is unchanged.

- **What it does.** Each quad-dispatch crowd type gets a compute twin of its march material: the same `marchBody`
  call with the same arguments, on a compute stage's pixel and camera (uniforms), in 8 × 8 workgroups over the
  quad's pixel rect, with every `discard` of the entry turned into a flag. It writes a storage texture. Around the
  march's render the layer swaps the type's quad onto a material that copies that texture into the march target
  and writes the hit depth through the depth test. The target, its depth, and everything after them are untouched.
- **What it does not cover.** Per-body views, chunks, the first-person hands, box dispatch, the per-body gate, and
  the march's extra attachments (`graphics=high`): all stay on the fragment march. The compute program compiles on
  its first frame, on the main thread; it is not in the background warm-up.
- **Picture** (22-body mob, light and probe clocks pinned as `march-hash.mjs` pins them, five captures from one
  boot): fragment against fragment 0 texels differ, compute against compute 0, fragment against compute 145 texels
  over 1e-4 (largest 0.048, one pixel over 0.02, no hit/miss change). That is the replay's stage difference and
  nothing more. Unpinned, two fragment captures of the frozen frame differ in 80,000 texels, so an unpinned
  comparison says nothing.
- **Whole frames** (`scripts/native-spike/compute-ingame.mjs`: one compiled page, `__sdfGame.setMarchCompute`
  flipped in alternation, 30 hand-stepped frames a sample to the GPU fence, headless):

  | Scene | Run | Fragment march | Compute march | A/A |
  | --- | --- | --- | --- | --- |
  | Clean mob | 1 (8 rounds) | 52.4 ms | −5.2 ms, −9.9 % (−17.6 to +2.1) | −0.1 % (−6.4 to +5.7 ms) |
  | Clean mob | 2 (12 rounds) | 51.0 ms | −2.8 ms, −5.5 % (−11.5 to +8.6) | +0.4 % (−23.7 to +16.2 ms) |
  | Wounded mob | 1 (8 rounds) | 71.0 ms | −10.9 ms, −15.4 % (−17.6 to +21.6) | −3.4 % (−10.1 to +28.2 ms) |
  | Wounded mob | 2 (12 rounds) | 70.6 ms | −8.6 ms, −12.1 % (−16.9 to +21.5) | −0.7 % (−10.2 to +21.0 ms) |

  **Faster in both scenes in both runs, and the size is not pinned down.** The machine was busy for both runs
  (1-minute load 8 to 12 at the start of run 2) and single rounds of the control swing as far as the effect. The
  medians are also about half what the replayed pass predicts (12 and 20 ms). Whether that is noise or the frame
  (the copy, the passes that share the GPU) is not established: a quiet-machine run is owed.

## Not verified

- **The live game.** Every number is a replayed pass: the game's frame time, the three.js node path (the march is a
  node material there), and whatever reads the march's depth attachment after the pass were not looked at.
- **An open head split, any body but the zombie, a wounded close-up.** The three main frames are clean zombies, so
  the walk is the lean walk throughout; one wounded mob was timed afterwards (above).
- **three r187.** Everything ran on three r186: the worktree links the primary checkout's `node_modules`, which
  holds 0.186.0 while `package.json` asks for `^0.187.0`.
- **Why it is faster**, and why 4 × 4 is slower. Metal's execution width cannot be read through WebGPU and no
  counter was taken.
- **The cause of the float differences**, and a look at the two pictures side by side by a person.
- **Other GPUs.** One Apple M3, Chrome's WebGPU. The release target is Rust + wgpu on the same Metal; not run.
- **Cold compile** of a compute program against the fragment one, on a cold cache for both.
- The mob is a staged block of 22, not the playtest's `doom-map28` mob, and its densest tiles hit the 64-entry cap.
- Box and per-body dispatch, and tiles off: the script refuses them (it reads the quad dispatch with tile lists).

## Running it

```bash
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
# the three frames, shipped and walk-only (-ship, -flat), into .scratch/compute
scripts/native-spike/compute-capture.sh
# one frame: frag, frag2 (A/A), port, list, shared, mask; six repeats
LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 scripts/native-spike/servers.sh \
  node scripts/native-spike/compute-march.mjs 6 .scratch/compute/mob-ship
# workgroup sizes and shapes
LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 scripts/native-spike/servers.sh \
  node scripts/native-spike/compute-march.mjs 6 .scratch/compute/mob-ship frag,frag2,list,list8,list4,mask8,list8x4,list16x4
# the old arrays
SPIKE_QUERY='frozen=1&tileref=0' scripts/native-spike/compute-capture.sh .scratch/compute-arr "closeup mob"
LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 scripts/native-spike/servers.sh \
  node scripts/native-spike/compute-march.mjs 6 .scratch/compute-arr/mob-ship frag,frag2,port,list
rm -rf /tmp/blud-gpu-timing.lock
```

- Zero repeats (`compute-march.mjs 0 <dir>`) compiles each leg and prints the comparison only.
- `COMPUTE_DUMP=<dir>` writes each leg's WGSL.
- A look by eye: `node scripts/native-spike/compute-view.mjs` serves an index of every captured frame and leg at
  `http://localhost:5392/`; a leg's page shows the game's frame, the replay and their difference times 8.
- `replay.html` gained the compute path (a pass record with `compute`) and three fields in its comparison (texels
  over the bar, floats not identical, hit/miss flips). A fragment replay is unchanged.

## Raw results

`results/`, one `.json` a run (every repeat, the comparison, the tile counts). The runs' console logs sit beside
them locally and are not committed (`*.log` is ignored):

| Files | Run |
| --- | --- |
| `run1-*` | The six frames, `frag,frag2,port,list,shared,mask` |
| `run2-*` | The three shipped frames again, with `list8` |
| `sizes-*` | `frag,frag2,list,list8,list4,mask8` on five frames |
| `shapes-*` | `frag,frag2,list8,list8x4,list4x8,list16x2,list16x4` on the three shipped frames |
| `arrays-*` | The `?tileref=0` captures, `frag,frag2,port,list` |
| `wounded-mob-ship.json` | The wounded mob, `frag,frag2,list,list8` |
| `sweep-small-workgroups-mob-ship.txt` | The one repeat that holds 2 × 2 and 1 × 1, stopped by hand |

`prelude-closeup.js` and `prelude-mob.js` beside this note stage the close-up and the mob.

## On by default (2026-11-10)

The owner's call after a playtest on `doom-map28`: a close mob that read about 70 ms a frame read 50 to 60 with
`&marchcompute`, and "in general things feel a lot smoother". `MARCH_COMPUTE` is now true unless the page has
`?marchcompute=0` (`march/compute-flag.ts`); off is the fragment march and its shader text, byte for byte.

Checked on the default page (no parameter), headless, the clean 22-body mob, whole frames, a quieter machine
(`results/ingame-default-on-mob.json`, 4 rounds of 30 frames): the compute march dispatches, and the frame is
37.5 ms with it switched off at run time against 29.5 ms on, −7.8 ms (−12.5 to −7.5), −21 %. The off-against-off
control read +1.5 ms (−4.7 to +3.9).

What changes for other tools: the replay harness measures the FRAGMENT march, so `native-spike/capture.mjs` adds
`marchcompute=0` to its page unless the query names the flag. Anything else that reads the `sdf:march` pass or
hashes the march target (`march-hash.mjs`, `lean-walk-parity.mjs`) now sees the compute march's picture, which
differs from the fragment one by float order (145 texels of 120,000 over 1e-4 on a pinned mob, no hit or miss change).

Still owed: the compute program compiles on the first frame that draws bodies, on the main thread, not in the
background warm-up (how long that is on a cold cache was not measured); a look in motion under a gate; the paths
it does not cover (per-body views, chunks, first-person hands, box dispatch, the per-body gate, `graphics=high`).
