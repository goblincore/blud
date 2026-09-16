# Probe allocation correction and startup investigation

2026-09-16, based on rupture candidate ae30d9c2.

The observed `1030 capsules exceed max 1024` came from admitting 515 bone
instances. Each instance produces two capsules. game-main allowed up to 1024
bone instances but allocated only 1024 output capsules. The shared producer
budget now sizes the gather output for 2048 capsules. This preserves all
previously admitted occluders rather than silently dropping half the inputs.
The array is bounded (65552 bytes, previously 32784). Kernels read the packed
live count; they do not trace unused capacity. Larger valid crowds that used
to fail will now run their intended gather work, whose cost needs measurement.

Validation under Node 22.22.1: 71 tests passed across probe-dynamic,
probe-gather-workgroup and probe-dynamic.wgsl. Regression cases cover the
reported 515 rows and full 1024-row input, checking the final capsule contents.
`npm run build` passed (TypeScript + Vite). Live GPU verification remains for
the profiling task, along with runtime-error counters and lighting review.

Startup observations, not yet attribution:
- Owner saw WebGPU loss. Chrome GPU process had recently restarted.
- Console later showed successful warm-up in 38906ms and rendered arena.
- warmPipelines measures the entire routine, including awaits, real frame,
  computes and SDF precompilation; do not call this pure shader compile time.
- Loader Promise.race stops waiting after 15s, does not cancel warmPipelines.
- Historical carve build ~19.7s was reported for gibrender=carve. Source in
  this branch defaults to march; boot ensureCarvedLibrary is gated on carve.
  Explicit runtime setter can enable it. Establish actual runtime mode/build
  count before blaming the historical cost for today's default-mode delay.
- Default march has asynchronous settled-chunk baking; it is distinct from
  the opt-in carved archetype library.
- Owner authorized pausing playtest for GPU profiling. Chrome AX inventory
  subsequently showed its 5415 game tab had been closed. Leave other tabs,
  unrelated jobs, and owner server5391 untouched. Server5415 serves the original
  rupture candidate, not this fix branch.
