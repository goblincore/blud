# Persistent surface blood

Owner accepted the investigation proposal on 2026-09-30. Preserve airborne goo; add opt-in `?surfaceblood=1` and live on/off control. Actual swept mesh hits deposit persistent lit stains. Floor, wall and furniture placement uses visible art, respecting thin walls and receiver normals. No midair expiry deposit in the candidate mode; mist evaporates and gut chains retain ownership. Old simulation and visuals stay unchanged when off.

Use pure triangle BVH queries and clipped decal triangles; seeded procedural masks in hand-written WGSL provide wet pools, splash satellites and elongated smears. Roughness and normal detail distinguish wet from dry. Keep memory bounded and batch geometry by receiver/room rather than one draw per droplet. Nearby deposits merge by receiver and normal. Persistent stains survive disabling airborne emission; clear/reset is explicit. Dynamic level meshes use receiver-local records so deposited geometry follows the receiver. Transparent glass and scenery are excluded.

Expose candidate toggle, appearance (wet/dry/smear/auto), clear and a deterministic surface-directed preview burst. The initial scope is static world and level doors, not blood adhering to animated actors, footprints or body-drag tracking. Forward and opt-in deferred must be checked; no change to the renderer default.
