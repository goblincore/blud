# Per-pass GPU attribution

1280x800, repeats=1, rooms=1, query: crowd=1&tiles-playtest

**INCOMPLETE — 0 leg-run(s) failed and are absent below:** 
**3 leg-run(s) aborted by the frame guard and skipped:** rep0 baseline/room1 (probe p50 n/a ms), rep0 crowd-quad/room1 (probe p50 n/a ms), rep0 crowd-boxes/room1 (probe p50 n/a ms)

Pass ms = median over repeats of the per-frame GPU pass time p50 (overall,
all segments). Share = of the labelled total. Gap = fenced frame p50 minus
the labelled total: CPU submit, inter-pass bubbles, unlabelled work.

## baseline: NO PASS SAMPLES

## crowd-quad: NO PASS SAMPLES

## crowd-boxes: NO PASS SAMPLES

## Repeatability (fenced frame p50 across repeats)

| leg | room | reps | spread % of min |
| --- | ---: | --- | ---: |
