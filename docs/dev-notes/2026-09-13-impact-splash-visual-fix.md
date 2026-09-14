# Impact splash — strand-bundle rebuild (visual fix) — 2026-09-13

**Status: topology REBUILT and verified in live WebGPU by this dispatch
(native vision, bounded-size image reads). Branch is ready for independent
parent/user visual comparison; acceptance still rests with them.**

## What the second review rejected, and what was actually wrong

Parent's live WebGPU review (seed 12345, front yaw0 pitch .14 dist 1.35):

- t=.30: opaque flower/fan of dull pink-brown overlapping petals, glossy
  pill-shaped droplets.
- t=.55: some holes but the broad leaf fan remained.
- Reference: many narrow tapered slightly curved red fingers with small gaps,
  selected ragged sheets, then fast fragmentation.

**Root cause (from code + this dispatch's own re-read of the same baseline
captures): topology, not tuning.** The previous geometry was 3 full-2π swept
SKIRT sheets around the wound axis with finger-modulated rims. Viewed from the
front that construction IS a flower: broad petal-like surface plates radiating
from the centre, overlapping, opaque. Alpha holes carved inside the plates
could not change the silhouette. Secondarily: the skirt surfaces are
near-tangent to light and view over large areas, so 0.20 ambient made them go
dull brown; `dropletStretch: 2.4` made beads read as glossy pills.

## Baseline evidence (preserved on disk, full size)

- `/tmp/blud-retry-shots/before-t{0.15,0.30,0.55,0.80}-{front,tq}.png` — the
  rejected build. t0.30 front: ~14 broad overlapping petal wedges, dull
  pink-brown, tiny dark centre, glossy red pills around. t0.30 tq: flat fan
  pinned to the wound plane ("paper flower on the chest").

## What the rebuild does (`impact-splash.ts`, new construction)

- **Strand bundle (dominant mass)**: 38 tapered tubes (cap 48). Each strand:
  golden-angle azimuth + jitter, bimodal cone angle (dense inner jet cone +
  wide outliers), own length (0.45–1.0 × radiusMax), base radius, roll,
  lateral bend, growth delay. Centreline decelerates outward; radius profile
  pinches to zero at root AND tip (no disc ends) and tapers to a fine point.
  Gaps between strands are STRUCTURAL — no surface exists between tubes, so
  the burst cannot close into a fan. This directly answers "narrower varied
  fingers, less overlapping opaque coverage".
- **Core**: displaced UV-sphere at the wound mouth (dark wet centre, covers
  strand roots).
- **Sheet flakes**: 2 small spherical-band patches, partial in azimuth (never
  full revolution), dissolving at 1.6× the event dissolve — "selected ragged
  sheets" that tear early.
- **Fragmentation**: per-strand dissolve stagger thins and removes strands
  piece by piece; alpha-noise raggedness rides on top. Total triangle area
  collapses ~55%+ from crown to late (test-pinned).
- **Droplets**: 100–150 per event, size 0.004–0.010 m, stretch 1.25 (near-round),
  launch along strand directions with linear aerodynamic drag (1.15/s) and
  stylized gravity 3.0 m/s² — the reference spray LINGERS near the burst
  instead of raining away; travel stays bounded (~1.5 m worst case).
- **Material**: base red raised to (0.46, 0.010, 0.016), ambient 0.32 —
  shadowed blood stays RED (owner requirement), never brown/black. Specular
  0.20 with gloss noise; fresnel 0.04; droplets get specScale 0.55 (no pills,
  no foil).
- **Timing**: burst reaches full extent ~0.24 s (per-strand stagger to 0.30),
  holds, fragments 0.4–0.9 s, gone at the 1.15 s lifetime. Dissolve ramp kept
  monotonic/back-loaded; per-event dissolve still rides the vertex attribute.

Preserved: deterministic seeds (no RNG state), wound-direction basis (w =
outward normal; works for any orientation), bounded allocations (layer
preallocates `impactSplashMaxVerticesPerEvent()` × 8 events; per-event ≈ 5.3k
verts, in budget), depth-writing alpha-tested cutout with EXPLICIT opacityNode
(three r185 NodeMaterial alpha-test contract, unchanged), the shared event-time
comparison in `sdf-blood-compare.html`, and the untouched "Current slug" path
(IMPACT_GOUT/WOUND_BLEED non-mutation test-pinned). `game-main.ts` opt-in
(`?impactsplash=1`) untouched.

## After evidence (same times/angles/seed, live WebGPU, no console/shader errors)

- `/tmp/blud-retry-shots/after-t{0.15,0.30,0.55,0.80}-{front,tq}.png`
- `/tmp/blud-retry-shots/after-t0.30-tqclose.png`, `after-t0.55-tqclose.png`
  (three-quarter, zoomed to distance 1.2)

What I saw (viewed at 800 px long edge; source renders were 897×600 canvas):

- t0.15: compact mid-extension red burst, spiky, growing — matches reference
  burst emergence.
- t0.30 (the reviewed moment): dense saturated-red burr of narrow tapered,
  slightly curved spikes radiating with varied lengths from a dense centre;
  small round beads trailing; small structural gaps everywhere. Front view
  matches the reference's head-on burst frames; tq view matches its profile.
  No petals, no opaque fan, no foil, no pills.
- t0.55: strands thinning/tearing with per-strand stagger, bead spray
  dispersing outward with sag — the reference's fragmentation phase.
- t0.80: ragged remnants near the wound + fine lingering spray — matches the
  reference's dissolve phase. Animation evolution verified, not just one still.

## Checks run

```
npx tsc --noEmit                     # clean
npx vitest run impact-splash.test.ts blood-compare-main.test.ts \
  blood-sim.test.ts goo-layer.test.ts goo-presets.test.ts \
  blood-connections.test.ts          # 6 files, 233 tests passed
npx vitest run fisheye occluder-hull free-aim game-actor post-aa fpv-mode
                                     # 6 files, 212 tests passed
```

Test changes: the old topology pins (shell ring closure, rim-tip counts,
`IMPACT_SPLASH_MAX_SHELLS`) were replaced with strand-bundle pins: tube ring
closure, root/tip pinch taper, structural azimuthal gaps at the crown moment
(the anti-fan test: covered bins < 24/24 at mid radius), triangle-area
fragmentation collapse, dense-core presence, damped droplet arcs, bounded
vertex/triangle/droplet budgets, dead-event semantics for non-positive
lifetimes, and the explicit opacityNode/alphaTest plumbing. None restate
tuning constants as magic values beyond the documented budget caps.

Capture method: my own vite (5499) + headless Chrome CDP (9499) driving
`/sdf-blood-compare.html` via `__bloodCompare` (setShape/replay/setSplashTime,
synthesized pointer drag for yaw, wheel for distance). The preserved
`/tmp/blud-blood-review` preview and its 5413 server were untouched. My
servers were shut down after capture.

## GPU vs CPU honesty

- The images above are ACTUAL WebGPU renders (headless Chrome, WebGPU path);
  no console or shader-compile errors were recorded across any capture.
- CPU tests prove geometry contracts only; they do not prove shading.
- No performance measurement was made; the per-event vertex count DROPPED
  (7,527 → ~5.3k) but no frame-time claim is made.

## Remaining shortcomings / deferred

- Droplets are a touch uniform (even size/roundness); the reference spray has
  more size variety and some translucency late. A size-shader variety pass
  could help.
- No shutter blur (deferred by owner).
- Sheet flakes are subtle; if the owner wants more "torn sheet" reads they
  could be raised (count 2→3 or dissolveBoost lower).
- Scale was retuned for the compare page's framing (radiusMax 0.42 → 0.50 m);
  in-game framing may want a further pass.
- Acceptance remains with parent/user after independent visual comparison.
