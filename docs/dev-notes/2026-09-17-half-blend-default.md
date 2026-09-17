# Half-strength character blends — manual playtest default

The owner approved applying the half-strength profile to zombie, soldier and other models, with manual playtesting to follow. Applied in the primary checkout, based on `efdb5eb2`. Earlier renderer experiments and their measurements remain on `codex/blend-march-2026-09-17` (`0402afae`).

`buildBody` now defaults `roundBlendScale` to 0.5. It scales live additive rounded flesh primitives once, after placement/clustering and before bone containment checks and validation. This includes generated facial primitives. Subtractions/grooves, internal bone/organ blends, chamfers, boxes, shells and hair strands retain their authored blend semantics. Primitive order and source definitions stay intact. Explicit tuning-panel `primBlendK` overrides remain absolute effective strengths, applied after scaling.

CPU field queries, character caching, posing, wound ownership, severing, GPU packing and offline gib extraction all receive the same effective body. There is no camera-distance switch or render-only mutation. Derived bones still undergo the existing containment filter against the effective flesh; mouse and dragon each lose two automatically derived bone primitives under the narrower flesh. Authored bones are retained and their validation diagnostics remain visible.

Regenerated zombie and soldier gib assets (24 and 19 pieces). Recipes record `roundBlendScale`; the asset checker now compares current body-build defaults rather than trusting the old recorded defaults, so a later profile change cannot silently reuse stale baked geometry.

## Manual observations to check

The rest-pose audit against `roundBlendScale: 1` found these additional diagnostics:

- Zombie: eleven authored torso bone/organ containment warnings (possible internal anatomy exposure through thinner flesh).
- Soldier: one authored head bone/organ containment warning.
- Female: both arm clusters flagged by the connectivity probe (possible shoulder gaps).
- Other registered characters: no additional validation messages in this audit.

These are real diagnostic findings, not a clean-geometry claim. They were not suppressed, and no bone/face polish or model-specific blend exceptions were introduced. Check shoulders, neck, ribs and wounded close-ups during the owner's playtest; report appearance and close-up frame spikes. The earlier ~26% close wounded crowd saving was a frozen renderer stress fixture, not a guarantee for live gameplay or every model.

## Verification

300 tests across 14 files passed: body building/caching, all 20 registry characters' blend propagation, GPU packing, damage, severing, rig binding, validation and gib build/load/deformation/head integration. Full production build and TypeScript passed (existing bundle-size warning only). `npm run gib:assets:check` confirms both regenerated assets are current. Two sparse synthetic source-provenance/nearest-primitive fixtures explicitly retain `roundBlendScale: 1`, because those tests exercise their authored geometry rather than the new character default. Validators themselves are unchanged.

At implementation time, no new GPU timing or live-play acceptance was claimed; see the subsequent owner acceptance below. A Vite server on port 5498 serves the primary checkout for manual playtest at `/sdf-game.html`.

To revert the profile, set `DEFAULT_BUILD_OPTS.roundBlendScale` back to 1 and regenerate gib assets with `npm run gib:assets`. Do not compensate in the shader alone.

## Owner acceptance — 2026-09-17

After the heading fix, the owner manually playtested, reported everything looked good, and authorized shipping both changes to main and pushing. Half-strength blending remains the accepted default. See the [combined wrap-up and lessons](2026-09-17-character-blends-wrap-up.md). The diagnostic and timing limitations above remain applicable.
