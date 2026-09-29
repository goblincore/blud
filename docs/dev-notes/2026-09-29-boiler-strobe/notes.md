# Boiler Room: cold flash bursts after the strobe — dev note, 2026-09-29

Owner feedback (playing the Boiler Room after the strobe, torch off): the red beacons become overwhelmingly dominant and
everything reads flat, washed in red. Chosen direction: **a contrasting cold blue-white strobe** (lightning-like), **discs in
cyan-to-white**, and the discs on the enemies; built in three steps with a look check after each.

## Step 1 — cold flash bursts (`lamp-moods.ts` strobe afterglow) — done

After the opening strobe the tubes (already cold: 0.78, 0.9, 1.0) stay dark for `burstDelayS` (3.5 s: the red gets a beat, and every
gate probe sits inside it), then fire bursts: one per 6 s window at a hashed offset, at least 2.5 s clear of the next, each 2 or
3 flashes of 70 ms with 60 ms gaps, at level 1.7 (a tube is 1). The whole room flashes together (seeded by the script's start),
each lamp a few ms off. Never more than 3 flashes in any second. All in `LAMP_SCRIPT`, so it tunes in one place.

- `?flashes=reduced`: the opening strobe slows to 2 Hz and each burst is one smooth 0.4 s pulse.
- Sheet: [burst-step1.png](burst-step1.png) — red only / flash / gap / flash (`scripts/sdf-strobe-burst-capture.sh`,
  `BURST_SHEET=`). The party discs go white on a flash (they follow the lamp level); step 2 gives them their own cool colour.
- Tests: `lamp-moods.test.ts` "strobe afterglow" (delay, burst shape, gap, 3-per-second cap, room sync, determinism, reduced).

## Owner note: optimisation cheats are welcome during the strobe

"Visual artefacts are fine since they add to the frenetic state — trails from previous frames." Candidate cheats, to be applied
only where a measurement shows they pay: hold the body march on alternate frames while lamps flash (the existing `hold` path
reuses the last march result: ghost trails), skip the live tube shadow re-render during flashes (stale shadows; measured 0–1 ms so
small), freeze the probe gather. First measure the flash-frame cost against a steady frame.
