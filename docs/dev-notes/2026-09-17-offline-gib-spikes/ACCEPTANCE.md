# Owner acceptance and defaults

The owner manually confirmed the long pole gibs are gone and the asset candidate generally looks good. Material differences from marched gibs are acceptable for now. This supersedes the earlier reports keeping assets opt-in pending an owner look. Reusable mesh gibs now default on, with `?gibrender=march` retained for comparison and automatic fallback for unsupported geometry/assets.

The supplied dynamite tuning is now the startup/panel default: core bones, 0.2s rupture, 0.045m amplitude, 0.35 jiggle, settle bake on, AOE0.82, optical wave on at2.7x, smoke0.76, life1.55s, fire gain3.3, plume0.1 and cap flatten0.955. Other supplied values match existing runtime defaults. URL overrides remain supported. The panel exposes wave enable/strength; its multiplier is applied once.

Verification: spike-fix dispatch reports full342files/5358tests and build passing; root verified generated assets are current. Final tuning uses focused panel/post-processing tests and a production build. The owner's manual pole-fix confirmation is direct visual evidence; no new performance benchmark or performance win is claimed. Performance measurements and tuning are deferred to the next session at the owner's request.
