# X1.25 — PSX-friendly AA (FXAA at internal res + temporal smear + sharp-bilinear upscale)

Owner brief: the raw low-res look is LIKED — keep the chunky pixel grid — but the
stair-step jaggies and temporal edge crawl are too much. Three independently
toggleable passes in `webgpu/post-aa.ts`, wired as a wrapper around the existing
draw chain (`lab-main` installs `postAa.render(() => gooLayer.render(...))`):

- **FXAA** (default ON) — Lottes reduced kernel over a full-content-res capture
  of the frame. Blends in display space (every tap goes through three's own
  sRGB OETF constants, mirrored in WGSL).
- **Temporal smear** (default 0.25, slider 0–0.6) — `mix(current, history, smear)`
  over a ping-pong history pair. Hides edge crawl; ghosting on fast gibs is
  on-aesthetic.
- **Sharp upscale** (default OFF) — canvas backing grows to the window and the
  final blit does a UV-snapped bilinear (fat pixels, antialiased BORDERS only)
  instead of the CSS nearest stretch.

All-off is an EXACT pass-through: `postAa.render` drops the redirect and calls
the pre-X1.25 chain directly — same code path, not an equivalent one.

## The root-cause story (why the first run timed out "fighting colour")

The first run's all-off-vs-FXAA A/B showed a systematic ~8-level background
shift (26,17,22 → 34,25,22) and chased it through unorm8→HalfFloat targets and
three's canvas colour-space handling. **It was never colour — it was Y-FLIP.**
Every target-bound quad pass on this backend inverts Y once. With an ODD number
of active intermediate passes (fxaa-only, smear-only) the output landed upside
down: the brighter floor pixels from the BOTTOM of the frame appeared at the
TOP corner probes, masquerading as a +8 background shift. The owner-default
combo (fxaa+smear = two passes) was accidentally upright — the flips cancel —
which is how the bug survived the first visual check. Corner probes against the
wrong (flipped) reference corners then "confirmed" a colour shift.

Fix: the FXAA and blend passes each flip their ENTRY sampling once, so every
intermediate target always holds the capture's orientation no matter how many
passes ran, and the blit's single flipY uniform handles the one canvas boundary
identically for every toggle combination. (The HalfFloat targets from the first
run were still correct and necessary — the capture holds pre-encode values and
unorm8 destroyed the dark end.)

Colour chain, settled: rendering into a RenderTarget applies NO output
transform in three r185 (`Renderer.currentColorSpace` is the working space
off-canvas; clear color is copied raw for both canvas and targets in
`common/Background.js`). The sdf/goo materials emit legacy-gamma-DECODED values
(EOTF applied in-shader) and polygonal materials emit working-space values;
the post chain OETF-encodes on entry (so FXAA luma and smear blending happen
in exactly the display space the canvas would have received) and EOTF-decodes
in the blit so the canvas's own OETF cancels it — one encode total, as today.

## Verification (scripts/verify-psx-aa.mjs, two builds + PIL)

Parity gate — base build (pre-change) vs current all-off, statues frozen at the
origin in the authored pose (atomic `setMotionEnabled(true); setMotionEnabled(false)`
in one evaluate, so no frame integrates between reset and freeze):

- Per-pixel flicker-envelope test over 6 interleaved screenshots per build:
  cross-build envelope gap > 4 levels on **0.0105%** of pixels — 20x LESS than
  the same-build self-check with half the samples (0.2125%). Statistically
  indistinguishable; the failing pixels sit inside the body bbox (residual
  eye-glow flicker extremes). `parity-envelope-fail-gt4.png`.
- Corner probes identical (25,17,22 top / 34,25,22 bottom) across base,
  all-off, fxaa, smear, default, sharp.

Orientation: top/bottom half brightness upright in EVERY toggle combination
(was: fxaa-only and smear-only flipped).

FXAA efficacy (the point of the pass): source-texel-gradient energy in the
body crop, all-off → fxaa = 253.6M → 127.4M (**-50%**); default (fxaa+smear)
= 68.5M (**-73%**). Screenshot-scale "hard step" counts do NOT drop (and must
not): the nearest upscale re-hardens every fat-pixel border — the chunky grid
survives, the texel VALUES along staircases are what get smoothed.

Bench (`benchGpu`, 1 body, n=240, this machine): all-off 2.18 ms median →
default 2.27 ms (**+0.09 ms**) → all-on 2.52 ms (**+0.34 ms**). Well under the
+1 ms budget. `results.json` (canvas attrs included: sharp grows the backing
930x540 → 1400x813 and drops `image-rendering: pixelated`; off restores both).

## Shots

- `01-all-off` — pass-through reference (== base build, see envelope above)
- `02-fxaa-on` — jaggies softened, grid intact
- `03-smear-converged` — smear 0.25 converged on the static scene (≈ identical)
- `04-default-fxaa-smear25` — the owner default
- `05/06-smear-*-moving` — ghosting illustration at 0.15 / 0.35 while wandering
- `07-sharp-upscale` — UV-snapped bilinear: fat pixels, AA borders
