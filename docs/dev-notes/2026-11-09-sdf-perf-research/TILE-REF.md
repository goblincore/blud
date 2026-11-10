# The tile reference list: a pixel keeps references to its tile's groups, not copies (2026-11-09)

Built from the finding in [ONE-CALL.md](ONE-CALL.md) §3. Behind `?tileref`, off by default
(`march/tile-ref-flag.ts`). On top of the lean walk (`claude/march-lean-walk-40ed5e`, PR 107),
which is on in every boot below.

**Result.** The same picture to the bit on every exact gate, and the march pass is 51 % faster on
a clean close-up, about 31 % with 20 wounds, about 40 % with the head split open, and about 25 % on
a 12-body crowd.

## What changed

The tile preload copied each kept entry of a pixel's tile into private arrays (`gTileBounds`,
`gTileGrp`, `gTileBand`, `gTileSlot`) and built a slot table beside them (`gPixSlot`, `gPixFirst`,
`gPixEnd`): seven arrays of `TILE_MAX_ENTRIES` = 64, 3.3 KB a fragment.

With `?tileref`:

- A pixel keeps ONE array, `gTileRef`: a `u32` a kept entry, `(slot << 8) | the group's index in
  its body`. 256 bytes.
- The fold reads the group's bound and range from the body's data rows (`ROW_GROUP_BOUNDS`,
  `ROW_GROUP_RANGE`): `tileBounds` / `tileRange` at the tail of `FOLD_GROUP`. A tile entry is a copy
  of exactly those two texels (`zombie-gpu.ts` builds both from `groupBounds` / `groupRange`).
- No slot table: entries are sorted by slot, so `mapBody`, `mapLean` and the lean test find a
  slot's run by walking the list (`tileRunEnd`).
- The group's index reaches the shader on the entry's meta lane, as a fraction beside the body
  index (`tile-cull.ts` `tileMetaX`: `slot + index / 256`, exact in float32). Both binners write it
  through that one function, so the flag is a boot switch for the CPU's packers as well as the
  shader. Off, the records and the shader text are byte-identical.
- Readers changed: the tile preload, `mapBody`'s tiled fold, `mapLean` and the lean test, and the
  analytic normal's tile walk (`ngBody`). `mapBody`'s signature is unchanged: it needs no tile
  buffer, only the data texture it already takes.

**One deliberate difference.** A body with an open head split names its per-step cull sphere by an
offset from a grown sphere (`tile-cull.ts` `cullOffset`), and the copy rebuilt it in float32 with a
pad. The data row is that group's own closed sphere, exactly: the one the cluster walk has always
culled with. Both are sound, and a group a sound cull drops is one whose fold is exactly `min`.

## Gates

| Gate | Result |
| --- | --- |
| `npm run typecheck`; `npx vitest run src/lab/sdf-zombie/webgpu/march` and the tile tests | clean; 478 tests (3 new in `tile-ref.test.ts`); golden snapshot unchanged |
| `march-hash`, shipped default (quad, tiles on), clean / wounded | flag off = flag on: `07f628a3…` / `9bedb27c…` |
| `march-hash`, boxes dispatch | off = on: `e0a128e7…` / `97cb53f4…` |
| `march-hash`, per-body (tiles off) | off = on: `565aaad4…` / `31996c1a…` |
| 12-body frame, one body wounded, exit bound on (`lean-walk-parity.mjs` with `LEAN_PARITY_FLAG=tileref`): the arrays without the lean walk against the reference list with it | 0 texels differ, clean and wounded; 5,903 lean pixels and 4,941 hit pixels with more than one body in their tile |
| The flag-on boots really ran the reference list | their captured shaders declare `gTileRef` and none of the seven arrays |

The hashes are the lean-walk branch's own (its notes; the pins in `march-hash.mjs` are stale and
were not touched). Raw: `tileref/hashes.txt`, `tileref/parity-crowd.json`.

**The split head, not proven exact.** The hash and parity frames hold no open head. A pinned
close-up (frozen page, fixed pose: `tileref/prelude-pinned.js`) captured depth-only in three boots:

| Frame | Flag off against flag off | Flag off against flag on |
| --- | --- | --- |
| clean | 0 floats differ | 0 |
| 20 pellets | 16,828 | 4,130 |
| + torso chop | 2,833 | 141 |
| + head split | 1,273 (max 0.514) | 14 (max 1.2e-7) |

The wounded stagings are not repeatable across boots with the flag off, so they cannot show
identity; the flag-on boot is nearer the first flag-off boot than the second flag-off boot is. No
sign of a difference, and no proof.

## Timing

The `sdf:march` pass of a pinned frame, captured in a flag-off boot and a flag-on boot and replayed
in alternation (`lean-ab.mjs`, 6 repeats, 10 copies a submit); every replay matched its own game
readback. Hull exit bound on. Differences are per repeat against flag off.

| Frame (400 × 300) | Flag off | `?tileref` | A/A control |
| --- | --- | --- | --- |
| Clean close-up, 0.6 m | 10.57 ms | **−5.44 ms (−5.61 to −4.60), −51.5 %** | −0.10 (−0.24 to +1.01) |
| 20 pellet and slug wounds | 21.95 | −6.88 (−8.69 to −4.68), −31 % | 0.00 (−2.96 to +4.51) |
| Chop + head split | 15.41 | −6.10 (−8.95 to −2.31), −40 % | +0.74 (−2.85 to +7.81) |
| Crowd, 12 zombies | 15.50 | −3.85 (−8.04 to −1.85), −25 % | −0.37 (−5.35 to +1.30) |

- The clean row is tight. The machine was busy for the other three (see their A/A ranges): the
  sign held in every repeat, the sizes are loose.
- The frames are separate stagings of one pinned scene (the flag changes the records, so one
  frame cannot be replayed with the other program). The clean stagings are identical to the bit;
  the wounded ones differ by a few hit pixels.

## Cold compile

`scripts/compile-census.mjs 1`, a fresh Chrome profile and a fresh constant in `hash13` per boot, bare
page, flag off and on alternated, two boots each (`tileref/cold.txt`). The machine was busy (1-minute
load 3 to 20).

| | Flag off | `?tileref` |
| --- | --- | --- |
| The warm-up the loader waits for | 54.4 s, 48.6 s | 55.2 s, 50.0 s |
| Crowd program ready, from navigation | 181 s, 224 s | 380 s, 239 s |

About a second more on the loader's program in each pair. The crowd program's time is not resolved:
the 380 s boot ran while the load went from 6 to 20. To be re-taken on a quiet machine before any
default change.

## Not verified

- The live game's frame time: everything is a replayed pass.
- Bodies other than the zombie (cloth, kits, the bare-bones bypass), and a body with more than 255
  groups (`tileMetaX` throws).
- The lab page (`lab-main.ts`) builds its own group inputs with no group index, and its CPU-against-
  GPU list check compares the raw meta lane: both are wrong under the flag. Not touched.
- `?limbs`, `?shadebound`, `?raymask` and `?splitablate` builds combined with the flag (they
  compile from the same templates; not booted).
- The capture gates (wound, head-split, axe, crowd) with the flag on.
- Three r186: the worktree links the primary checkout's `node_modules`.
