# Boiler Room owner calls — 2026-09-29

Sheets in this folder: [before.png](before.png) (one row of 4 tubes, 96 stars), [rows2.png](rows2.png) (two rows),
[stars144.png](stars144.png) (two rows, 144 stars), [beacon-torch.png](beacon-torch.png). Captured with
`scripts/sdf-disco-check.sh` (`DISCO_SHEET=`) and `scripts/sdf-beacon-torch-capture.sh` (`BEACON_SHEET=`), owner's
default layers for the second (the disco check boots `?layers=all`).

## 1. Second tube row — done, with a hard limit found

The room now has two rows of 4 (`rows=[-2.0, 2.0]` in `night_train_layout.py`, `lamps()` takes `rows`). The side walls
and far end read lit; the tubes' cones show across the room ([rows2.png](rows2.png)).

**The limit:** eight shadow-casting tubes need 18 sampled textures in the fragment stage; WebGPU's default is 16
(this adapter allows 48, others will not) and NO pipeline compiled (`did not boot`, "Invalid PipelineLayout"). So
lights gained an optional `shadow: false` (tube fixtures only: layout → `build_night_train.py` → `export_level.py` →
`level-json.ts` → `game-level.ts` → `makeTube`), and rows 2+ put their shadows on a checkerboard: **4 of the 8 cast**,
the same count as before, so the shadow cost is unchanged. Pinned by a test in `level-json.night-train.test.ts`.
Any future light that casts a shadow spends one of those 16.

Not measured: the frame cost of four more (shadowless) spots — needs a quiet machine.

## 2. Disco stars — 96 → 144 (`DISCO.count`)

Denser, still reads as sparkle rather than noise ([stars144.png](stars144.png)). The disco check pins 144.

## 3. Beacon weight on torch-lit bodies — `beaconTorch` 2.5 (owner's pick)

With the torch lit the old per-pixel beam keys the body; the beacon's red barely tints it. `setListLook({ beaconTorch: k })`
scales the beacon profile's gain and back rim by k **only while the torch is lit** (`setTorchLit`, written each frame by
`writeLightList`); 1 leaves the packed table byte-identical (unit-tested); the shipped default is now **2.5**, which changes only torch-lit bodies near a beacon, so the march-hash pins (torch off) should hold — not re-run (needs a quiet machine).
[beacon-torch.png](beacon-torch.png): torch off (flat saturated red, the blow-out), then torch on at x1 / x2.5 / x4. x4
is a visible but modest move (redder rims and shoulders, still pink overall). Torch-off is untouched by this knob.
Owner chose x2.5 (2026-09-29); the value lives in `look.beaconTorch` in `light-list.ts`.
