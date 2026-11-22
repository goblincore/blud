# The one-call prototype, and what the walk's time really is (2026-11-09)

Third part of [LADDER.md](LADDER.md) and [WOUNDS.md](WOUNDS.md). Measurement only; no renderer
code changed. Everything here is with the hull exit bound ON, on three r186 (the primary checkout's
`node_modules`; `package.json` asks for r187).

**Answer.** Predicting each pixel's hit from last frame and verifying it with one field call does
not pay: it removes a third of the walk's steps and none of its time. The walk's time is not in its
steps. It is a fixed cost every rasterised fragment pays for seven private arrays of 64 entries that
hold a copy of its tile's list. Sized to 16 the shipped pass is 37 to 40 % faster on a clean
close-up with the picture identical to the bit, and a 12-body crowd pass halves.

## 1. The one-call walk

Frames captured in motion (`wounds/prelude-motion.js`: the camera moves before every hand-step, so
the pass's history texture is one move behind): still, strafing 5 cm a frame, turning 0.03 rad a
frame, and the body animating while the camera drifts.

The prediction (`LAD_PREDICT` in `ladder.mjs`) projects a guess on the ray into last frame's screen,
reads the depth drawn there, rebuilds that world point and takes its distance along the ray, three
times. Camera motion only. It is used when the point lies within 1.5 pixel footprints of the ray
and no more than 12 cm past the hull's entry. The walk's first sample is then the predicted point;
behind the surface, the walk restarts.

| Frame | Hits with a usable prediction | Verified as a hit by one call | Behind (restart) | Walk steps, hits | Walk only | Shipped pass | Hits lost (edge guard on) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| still | 84 % | 82 % | 2 % | 138,714 → 97,444 | −0.3 ms (−3 %) | −0.1 (−1 %) | 6 of 44,320 |
| strafe | 81 % | 75 % | 6 % | 98,712 → 67,630 | +0.3 (+4 %) | −0.1 (−1 %) | 10 |
| turn | 82 % | 80 % | 2 % | 135,102 → 96,997 | −0.1 (−1 %) | −0.5 (−4 %) | 16 |
| body animating | 46 % | 10 % | 21 % | 147,864 → 146,527 | 0 | 0 | 106 |

- Under camera motion the prediction lands on the surface for three quarters of hit pixels. For an
  animating body it does not: it knows nothing of the body's motion.
- **A third fewer steps, no time.** (2.2 steps a ray, not 1: not explained. Accepting the first
  sample inside the secant's own tolerance changed nothing.)
- The edge guard (no prediction from a texel beside a silhouette or a 3 cm depth step in last
  frame's picture) takes the lost hits from 39 to 66 a frame down to 6 to 16 under camera motion.
- Not sound: nothing checks that the ray is empty in front of the predicted point. A limb that
  moves in front of another surface inside the hull's slack would be skipped, and would stay
  skipped, since each frame predicts from the last one's picture.
- It moves 2,700 to 6,000 pixels of the shipped frame by more than 0.02.

Closed as measured and negative.

## 2. The walk by step count

The loop capped at n steps, a capped ray writing where it got to (so nothing is removed as dead).

| Capped at | still, clean | pellets |
| --- | --- | --- |
| 0 (setup) | 0.3 ms | 0.2 ms |
| 1 | 7.4 | 9.4 |
| 2 | 8.2 | 11.8 |
| 3 | 8.4 | 13.5 |
| 4 | 9.1 | 14.4 |
| 6 | 9.7 | 16.5 |
| uncapped | about 9.5 | about 16 to 18 |

- **Clean: the first field call of a pixel is about 7 ms of a 9.5 ms walk** (125 ns a pixel); the
  170,000 calls after it are about 2 ms together.
- Pellets: the first call is still the largest piece; later steps cost about twice a clean body's
  each and add 6 to 9 ms.
- This is why the step budget, the temporal start, the one-call walk and the air gate all moved
  nothing: they remove steps.

## 3. The per-pixel tile arrays

`gTileBounds`, `gTileGrp` (`vec4`), `gTileBand`, `gTileSlot` (`f32`), `gPixSlot`, `gPixFirst`,
`gPixEnd` (`i32`): seven private arrays of `TILE_MAX_ENTRIES` = 64, 3.3 KB a fragment, filled by the
tile preload. The rung `arrN` sizes them to N and clamps the tile's entry count to N: the same
picture wherever no tile lists more than N entries.

| Frame | Entries a hit pixel's tile lists | Shipped pass | Arrays of 32 | Arrays of 16 |
| --- | --- | --- | --- | --- |
| still, clean (0.6 m, 37 % cover) | 9.2 | 11.9 ms | walk only −3.1 | **−4.4 (−37 %), identical** |
| clean (0.6 m, 69 % cover) | 10.0 | 20.3 | −5.7 (−26 %), identical | **−7.9 (−40 %), identical** |
| pellets | 10.0 | 25.2 | −3.0 (−12 %), identical | −3.3 (−13 %), identical |
| chop | 7.8 | 21.4 | −3.0 (−14 %), identical | −3.5 (−16 %), identical |
| split | 13.3 | 26.5 | −2.8 (−11 %), identical | −3.6 (−14 %), 98 px moved |
| crowd, 12 zombies | 24.8 | 19.9 | −5.2 (−26 %), 207 px moved | −10.5 (−53 %), 2,805 px moved |

- The one-step walk on the still frame: 7.8 ms with arrays of 64, 3.0 with 16, 1.7 with 8.
- The cost follows the arrays' SIZE, not how many entries a tile has. Not isolated: whether it is
  the zero-initialisation WGSL requires of private variables, the fill, or what 3.3 KB of private
  memory does to how many fragments the GPU keeps in flight.
- **The crowd frame walks 16,491 pixels and costs 19.9 ms.** Its four type quads rasterise far more
  fragments than that, and a private variable exists for every one of them, discarded or not. This
  looks like the floor earlier notes kept meeting ("5 to 7 ms once any body is visible", "about
  40 % of a far body's march scales with target pixels", the quad's cost at low body counts).
- Wounded frames gain the same 3 to 3.5 ms as each other, less than the clean frame's 7.9 ms on the
  same pixels. Not explained.
- A rung that used no arrays reads 0.2 to 0.3 ms for the whole setup: the compiler drops unused
  private variables, which is how this stayed out of every earlier measurement.

### What this says to build

Sizing the arrays down is not the fix: a crowd tile can list 64 entries, and at 32 this crowd
frame already moves 207 pixels. The fix is to stop copying the list:

1. The walk and every other reader take a tile's entries from the tile buffer directly (the rung
   `lean-direct` in LADDER.md did this for the walk's fold and was faster with the arrays still
   present).
2. The per-ray sphere cull's result is a 64-bit mask, two `u32`.
3. The slot table goes: entries are sorted by slot, so a slot's run is found while walking them.

Expected, by the size trend: more than the 16-entry rungs above on every frame, with the picture
unchanged. To be measured, not assumed; the readers are `mapBody`, `foldGroup`'s callers, the
analytic normal's `ngGroup` walk and the quad's entry test.

## Running it

```bash
LAB_TMP=.lab-tmp SPIKE_PRELUDE="$(grep -v '^//' docs/dev-notes/2026-11-09-sdf-perf-research/wounds/prelude-motion.js)" \
  SPIKE_VARIANTS='stillship=(__ladderHome(),__ladderMotion(0,0));stillflat=(__sdfGame.setFlatAlbedo(true),__ladderHome());turnship=(__sdfGame.setFlatAlbedo(false),__ladderHome(),__ladderMotion(0,0.03));turnflat=(__sdfGame.setFlatAlbedo(true),__ladderHome())' \
  scripts/native-spike/servers.sh node scripts/native-spike/capture.mjs 5291 9291 .scratch/ladder/capm
LAB_TMP=.lab-tmp LADDER_SCENE=still scripts/native-spike/servers.sh node scripts/native-spike/ladder.mjs .scratch/ladder/capm 5 ship,ship-arr16,flat,cap0,cap1,cap2,onecall-esl,count-tile
```

Raw data: `wounds/onecall-*.json`, `wounds/stepcap-*.json`, `wounds/arrays-*.json`.
