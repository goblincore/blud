# Blood spray: per-stream goo fusion (spike, 2026-09-18)

The density spike left one cheap, named fix on the table: the goo density field
is **stream-blind**, so two independent wounds sum into a shape no single spray
produced (the `crossing` butterfly). This spike makes fusion **per stream**:
droplets of one spray fuse with each other, droplets of different sprays never
sum into a shared shape.

**The mechanism works and is verified. It is a no-op for a single spray
(byte-identical), and the raw-channel debug proves the two streams are separate
fields. But the required visual outcome for the `crossing` fixture is NOT met:
the two sprays overlap in space, so their union still reads as one connected
mass.** Details and the honest verdict below.

## What was built

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/goo-layer.ts` | Per-stream density channels, their blur pair, a combine pass, `setPerStream` / `setStreamRamp` / `setStreamDebug`, and per-stream surface materials. Defaults OFF. |
| `src/lab/sdf-zombie/webgpu/blood-compare-main.ts` | DENSITY panel toggle + fuse-ramp slider; `setDensity({perStream, streamRamp})`; `state().packing.perStream`; a new `wipe axis = perStream` (dense-blind | dense-per-stream on ONE frame); `__bloodCompare.setStreamDebug`. |
| `src/lab/sdf-zombie/webgpu/goo-layer.test.ts` | Pure channel/ramp tests, the combine-WGSL guards, the orientation flip, and source tripwires (default OFF, game never enables it). |
| `src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts` | Panel/API/state/wipe wiring tripwires. |
| `scripts/blood-density-capture.mjs` | `--per-stream` mode: jet + crossing at launch/mid/landing, the raw-channel debug frame, the thin-goo secondary A/B, a cost bench, sheets and gates. |
| `package.json` | unchanged (`npm run blood:density` runs the same script; pass `--per-stream`). |

**The game is untouched and no default moved.** `perStream`/`setStreamDebug`
default false, `streamRamp` 0. `game-main.ts` never calls them, the shipped
`densMat.colorNode` is unchanged, and the game never renders any of the new
targets (all gated behind `perStreamOn`). `blood-sim.ts` is not touched at all.

## The mechanism, and why this one

Droplets already carry a stable `stream` id (`blood-sim.ts`, assigned by the
caller). The layer packs a **small fixed number** of stream channels into the RGB
of one extra half-res density target (`GOO_STREAM_CHANNELS = 3`: two dedicated +
one shared for overflow/untagged/pools), renders the same instanced quads into it
with a per-instance `streamMask`, blurs each channel with its own separable pair,
and a **combine** pass writes ONE canonical field:

```
dens = max(stream0, stream1, shared)          // the strongest SINGLE source
depth / gut  = the canonical field's own density-weighted means
```

`max(channels) >= thresh` holds **iff some single stream alone clears the
threshold**, so this *is* per-channel thresholding without a per-channel pass:
two sprays can only overlap and occlude, never add into a shared peak. The output
is in the canonical layout (`r` density, `g` density*depth, `b` density*gut), so
the shipped surface shaders need only a texture swap — there is no shading fork.

Why this and not the alternatives:

- **Not separate shaded surfaces per stream.** They would cost N surface passes
  and still merge, because the two crossing sprays are at the same depth and the
  same colour: compositing one over the other produces the same union. The
  cheapest correct primitive is one field with the per-source max.
- **Not MRT / channel routing in one pass.** Extra density attachments would
  share the geometry cost but need per-attachment routing and gut/depth channels
  we do not have; two density passes is the straightforward, measurable shape.

Cost, from the lab's own pass timing (400x300 source, 200x150 density, crossing
fixture at 570 droplets, dense emission, 60 timed frames):

| pass | stream-blind | per-stream |
| --- | --- | --- |
| `goo:density` | 0.122 ms | 0.122 ms |
| `goo:blur` | 0.078 ms | 0.079 ms |
| `goo:stream-density` | — | **0.126 ms** |
| `goo:stream-blur` | — | **0.066 ms** |
| `goo:stream-combine` | — | **0.016 ms** |
| `goo:surface` | 0.180 ms | 0.180 ms |
| **goo chain total** | **0.380 ms** | **0.589 ms (+55 %)** |
| fenced frame span p50 | 2.10 ms | 2.30 ms |

So the price is one more density pass, its blur pair and a fullscreen combine —
**≈ +0.21 ms of labelled GPU (≈ +0.2 ms fenced)**, independent of the wound
count because channels are fixed. The surface pass is unchanged. The absolute
numbers are small and the per-label attribution is noisy at this magnitude; the
`gpuSpan` delta (+0.30 ms) is the more conservative read.

## Two implementation facts worth keeping

- **Orientation.** A single target-to-target fullscreen pass lands vertically
  flipped relative to the canonical *two*-pass blur chain (whose two flips
  cancel). The combine therefore pre-flips its source sampling
  (`GOO_STREAM_COMBINE_WGSL`'s `flipY`). The first capture of this spike rendered
  the whole goo mass upside down until that was found and fixed.
- **The partition is provable, not assumed.** `__bloodCompare.setStreamDebug(true)`
  draws the raw packed channels (R = stream 0, G = stream 1, B = shared).
  `crossing-debug-channels.png` shows a **red lobe (left wound), a green lobe
  (right wound) and a yellow overlap** — the two streams really are separate
  accumulation channels, and the centre is where they genuinely overlap.

## What the frames show

`sheet-per-stream.png` (jet, rows launch/mid/landing, columns stream-blind |
per-stream), `sheet-per-stream-crossing.png` (same for the crossing),
`sheet-per-stream-crossing-06.png` (the 0.6 s cross + ramp) and
`crossing-debug-channels.png` are the evidence.

**Single spray — the "must not re-fragment" gate: PASS, and stronger than
expected.** Per-stream is essentially byte-identical to the stream-blind dense
look: launch **0.000 %** of pixels changed, mid **0.003 %**, landing **0.28 %**
(half-float round-trip noise). One spray is one stream, so `max` is its own sum;
the connected sheet/rope is untouched. This is the strongest result here.

**Against "two sprays fuse into an invented shape" — the invention is gone, the
visual separation is not.** The additive cross-term is removed and the overlap is
no longer super-dense (the debug frame and the centre absorption both show it),
so the resulting shape is now the **union of two real single-spray shapes** rather
than a blob neither produced. But at every dense-framing time the crossing still
reads as **one connected mass**:

| frame | changed pixels | what it looks like |
| --- | --- | --- |
| crossing launch 0.15 s | 0.24 % | one horizontal bar; the two lobes already touch |
| crossing mid 0.50 s | 0.22 % | the same butterfly, slightly thinner |
| crossing 0.60 s | 0.25 % | the previous spike's merge, no longer additive |
| crossing landing 1.10 s | 0.24 % | pooled mass |
| crossing, thin goo (shipped 0.14/0.65/0) | 0.11 % | two lobes joined at the centre |
| jet (single spray) | 0.00–0.28 % | connected, unchanged |

The debug frame is the explanation: the two sprays **overlap across most of the
butterfly** (the yellow region), so their union is connected no matter how the
fusion is decided. Per-stream removes the invented *sum*; it cannot remove the
*overlap*, which is geometry, not fusion. The requirement's "they may overlap and
occlude, as two real liquids would" is satisfied; "read as two connected streams"
is not.

**Against the launch pulse — per-stream does not touch it; the ramp only
softens it.** A launch is a single stream, so per-stream is identical to blind
there. The optional fuse ramp (`streamRamp`, default 0) down-weights a stream's
first ~0.35 s in the stream channel only; it shrinks the launch goo envelope and
removes some of the saturated rim (3 479 px, 0.7 % of the frame, differ), but it
is a modest change and is left OFF. The current dense launch is a filled oval
with a dark, droplet-showing core, not the earlier hard ring.

**Against blown-out specular — not addressed.** The dense landing frames still
show white specular cores (`sheet-per-stream.png`, bottom row). The surface
shaders are shared with the game, and scaling `spec`/`gloss` by density would
have meant editing the shipped shading; it was left as the documented, purely
cosmetic gap the density spike already named.

## Honest verdict

- **Per-stream fusion is correct and cheap.** The partition is real (proved by
  the debug frame), a single spray is byte-identical (the re-fragmentation risk
  did not materialise), the game is untouched, and the extra cost is a fixed
  ~+0.2 ms of goo GPU.
- **It does not by itself make the dense look shippable.** It removes the
  *invented* cross-fusion, but for the `crossing` fixture the two sprays overlap
  in screen space and at the same depth, so the union still reads as one mass. A
  mechanism that only changes *where the threshold is decided* cannot produce a
  visual seam between two overlapping same-colour streams.
- **What is still missing**, in order of cost:
  1. **Separated emission** — the crossing fixture sprays the two wounds straight
     into each other by construction; the dense pack widens each into a fan that
     fills the gap. Per-stream plus an emission that keeps each stream a rope
     (rather than a fan) is the cheap way to make the two-stream read real.
  2. **Per-source surface primitives** — a capsule/volumetric field whose
     primitives carry their own identity (the wildfire teardown's §2) would let
     each stream own a real surface and show an occlusion seam instead of a
     shared screen-space field.
  3. The launch-pulse and spec/gloss polish named above.
- **Keep the implementation.** It is a necessary foundation (no invented sums,
  no single-spray regression, lab-only, default OFF), and it gives the next
  attempt a correct per-source field to build the surface read on.

## Reproduce

```
LAB_VITE_PORT=5245 LAB_CDP_PORT=9235 node scripts/blood-density-capture.mjs --per-stream
```

Outputs into `docs/dev-notes/2026-09-18-blood-per-stream/`: 24 PNGs + four sheets
+ `captures.json` (seed/scenario/camera, the exact looks, the diffs, and the
per-pass cost). The script boots headless Chrome + vite, drives the page only
through `__bloodCompare` (rAF off), and **fails** on a WebGPU pipeline/shader
error, a page exception, a flat frame, a non-reproducing blind baseline, or a
per-stream run that changed no crossing frame.

## Caveats

- The crossing fixture saturates `MAX_DROPLETS` (600) when packed, so its shape
  is partly FIFO eviction, as the previous spike noted.
- The cost bench is one scene at one time with a fixed seed; per-label GPU
  timings there are noisy and were reported as p50 over 60 frames.
- The **wipe frame is vertically mirrored** relative to the single-view captures.
  This is a pre-existing lab quirk (`wipe-density-mid.png` from the density spike
  has it too, ncc(flip)=1.000), not a per-stream regression; the A/B itself —
  left = dense stream-blind, right = dense per-stream, one frame — is correct.
- The visual separation judgement remains a human call on a GPU; the numbers are
  gates, not the verdict.
