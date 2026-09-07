# Shared wound torso comparison implementation plan

**Goal:** Compare the same bounded wound presets analytically and from one shared sampled library, starting with torso intact/light/heavy.
**Spec:** `docs/superpowers/specs/2026-09-06-shared-wound-torso-comparison-design.md`
**Execution:** Inline, preserving the default game and the older cache branch.

1. Implement `shared-wounds/presets.ts`: immutable two-cutter recipes, shared two-state R32F atlas, exact eight-corner value/gradient reconstruction, conservative measured derivative bound, and instance-only bounded transition IDs. Public interfaces: `createPresetLibrary(resolution)`, `sampleAnalytic(id,p)`, `sampleCached(library,id,p)`, `createRegionState()`, `hitRegion(state,timeMs)`, `advanceRegion(state,timeMs)`.
2. Run the behavioral tests in `presets.test.ts`: 100 actors and 100 repeated hits without library growth, uninterrupted two-endpoint playback under repeated hits, long-frame catch-up, monotonic severity, interpolation error, numerical derivative agreement, and outside-volume extension.
3. Add a diagnostic WGSL evaluator and a native-WebGPU torso comparison, using the same recipes/atlas. Keep the comparison out of production game bindings. Show both representations, severity and transition controls, shared vs instance memory, and explicit experiment labeling.
4. Run real-GPU compile/render checks and inspect captures of intact/light/heavy. Record conservative-bound and interpolation differences instead of claiming pixel identity between discretized and analytic shapes. Retain shared library allocations once per device; actor state never owns a texture.
5. Review the result, record the migration interfaces and remaining gameplay work, and preserve findings. Do not claim stable 30fps without specified encounter load, resolution, quiet timing, and wound/gib/bake lifecycle validation.
