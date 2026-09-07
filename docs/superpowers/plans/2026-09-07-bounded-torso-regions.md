# Bounded torso regions and comparison

**Goal:** Fix the confirmed chest-after-belly coverage gap and measure the revised candidate against the procedural baseline.

**Approved design:** Four regions (upper/lower × front/back), each retaining its first wound frame and the shared intact/light/heavy recipes with 160 ms transitions. Classify hits in the actor's rest body so pose/yaw do not change region identity. Each active region reserves two upload slots; at most eight torso cutters leave eight latest stock fallback wounds when all four are active. Original gameplay/sever history remains unchanged. Hits inside one region remain approximate; this is not full per-impact coverage.

- [x] Write failing tests for upper/lower/front/back independence, canonical classification across pose, and bounded upload/fallback state.
- [x] Implement four-region state and pass rest-body geometry into hit classification.
- [x] Re-run coverage fixtures and actor/shader tests; review geometry and lifecycle changes.
- [x] Compare baseline/candidate at explicit 640x480, SDF1.0, FXAA on/smear0.25. Keep shot sequence, body/camera and sampling identical. Separate transitions and steady state. Treat system contention as a measurement limitation rather than promising a speedup.
- [x] Document measured results, caveats and the current opt-in preview.
