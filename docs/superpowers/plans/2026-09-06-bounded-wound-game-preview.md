# Bounded torso game preview

**Goal:** Make the approved preset shape playable behind `?bounded-wounds`, preserving the default game for comparison.

**Design:** One torso region per actor, attached in the first torso impact's primitive frame. Later eligible torso hits advance the shared intact/light/heavy IDs. Two fixed sphere cutters reuse the immutable recipes. The game adapter grows their radii over 160 ms; unlike the sampled probe's field interpolation this is parameter interpolation, so intermediate geometry is not an analytic/cache equivalence test. Retain the first hit's depth cap. Non-torso hits, burns and sever stumps keep the existing visual ring; gameplay always uses the original wound ring. No mutable volume allocation is introduced. The sampled library remains the separate comparison, not a migrated production cache.

- [x] Add behavioral tests and a bounded visual state adapter (first-hit frame, hit saturation, fallback, monotonic transition, actor isolation).
- [x] Upload simple cutter rows with scalar/gradient parity; leave stock wounds unchanged.
- [x] Wire projectile, blast, stump, moving/frozen frame and occluder exclusions through the preview. Actor recreation clears state. Detached chunks retain their existing torn-end/bake path; this preview does not add torso state transfer to chunks.
- [x] Run focused tests, TypeScript, actual GPU preview checks and review. Document limitations and retain the normal game default.
