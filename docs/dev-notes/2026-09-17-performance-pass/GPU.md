# GPU validation and shutter follow-up

Default graphics, Apple M3, 800×600 output / 400×300 character march,
shipped t16 RGB upscaler (weight hash `7ab8f2fe`), CAS 0.5. The performance
branch includes main's accepted shutter integration at `4ce1e826`.

**The requested 5 ms whole-frame saving has not been established.** Keep the
measured CPU improvement in [CPU.md](CPU.md), the exact-output probe optimization,
and the small blood-upload improvement below. Do not add savings from different
fixtures or equate GPU pass duration with whole-frame latency.

## Verification

- 499 focused tests across 19 files pass (probe maths/WGSL, rig/packing,
  goo upload transitions, shutter/gib blur, post-AA and gib tearing).
- `npm run build`: TypeScript and production Vite build pass; existing large
  bundle warning only. Both edited JavaScript GPU harnesses pass `node --check`.
- GPU parity, real-game blur captures and repeated comparisons described below
  pass. The entire repository test suite was not run.

## Probe correctness

The actual WebGPU kernel compiles and matches the reference bit for bit over
all 6,400 output floats, repeatedly within each frozen boot:

- Rooms 1/3/5: 35/180/225 capsules, flashlight lighting; rays
  0/1/2/3/5/8/16/31/32/47/64.
- Room 5 plus eight additional zombies: **705 capsules, two lights** (flashlight
  plus a confirmed muzzle flash); rays 0/1/3/32/47/64.
- The frozen blast fixture also matches at all eleven ray counts. Its camera
  is in a tunnel: its probe list has 35 capsules and one light. The 28 flying
  gibs are a blur workload, not 28 bodies in that probe list.

Every check observes advancing dispatch counts, finite nonzero radiance, and
zero console/shader errors. Summary records retain digests, gates and equality
results in `gpu/parity-*.json` and `gpu/blast-parity.json`.

## Probe performance

In the frozen blast, steady same-boot reference GPU pass medians are
0.095–0.100 ms versus 0.052–0.059 ms with the candidate. The separately compiled
original shader from main measures 0.087–0.095 ms after the first block, so the
improvement is not just a slow reference branch in the combined A/B shader.
The gather dispatches every second frame. This small scene therefore saves
roughly **0.02 ms of amortized pass time**, with no resolved whole-frame win.

The larger crowd result is recorded in `gpu/crowd-timing.json` (705 capsules,
two lights, 32 rays; four alternating pairs). Read its fenced frame samples
separately from its per-dispatch GPU timestamps.

| Pair | Reference frame | Candidate frame | Reference gather | Candidate gather |
| --- | ---: | ---: | ---: | ---: |
| 0 | 42.4 | 43.1 | 1.8410 | 0.5397 |
| 1 | 42.8 | 44.2 | 1.8446 | 0.5463 |
| 2 | 44.7 | 44.0 | 1.8437 | 0.5497 |
| 3 | 57.5 | 48.7 | 2.6624 | 0.6133 |

Milliseconds, 100 fenced frames per variant. Median-of-repeats gather duration
drops from **1.844 to 0.547 ms (70%)**, about **0.648 ms amortized per frame**
at the unchanged every-other-frame cadence. Frame times drift markedly and the
first three pairs do not show a consistent frame win; do not credit the last
pair's 8.8 ms difference to this change. This is evidence of less probe GPU work,
not a measured five-millisecond whole-frame improvement. The timing leg asserts
the shipped 400×300 input scale; the earlier native-scale stress run is excluded.

The first reference timing block in the blast harness is consistently slower
even after warming both modes. All samples remain in the evidence; the cold
block is **not** credited as an optimization. GPU timestamp intervals can
overlap and must not be summed into a claimed frame saving.

## Shutter cost

One seeded live-game blast, then fixed simulation time and camera. **28 flying
pieces, 182 gib motion stamps, 431 blood stamps**. Shipped VHS, exposure
44.44 ms, 120 px maximum trail, 24 taps, full seed resolution and mutual
occlusion remain unchanged. Each variant renders the same instant; order
reverses between repetitions. Each sample fences the GPU.

| Repetition | Sharp | Blood only | Gibs only | Both | Both − sharp |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 15.3 | 15.9 | 15.0 | 15.7 | +0.4 |
| 1 | 15.0 | 15.3 | 17.0 | 15.0 | 0.0 |
| 2 | 15.0 | 15.6 | 15.7 | 15.5 | +0.5 |

All values are median milliseconds from 60 fenced frames per variant. This is
a bounded scene measurement, not a universal marginal cost: separating the
selected geometry also changes the base rendering work. It does show that the
accepted blur is not consuming an extra five milliseconds in this fixture.
Median seed build costs with both effects active are about 0.4 ms for gibs and
0.3 ms for blood; they are included in the frame cost, not additional to it.

## Blood upload change

`goo-layer.sync()` used to clear every unused matrix and upload all 1,000 slots
on every sync. Shutter blur invokes it for both the sharp and airborne
partitions. It now uploads only `[0, count)` and leaves the undrawn tail alone.
Every newly live slot is fully rewritten before increasing the instance count.
Zero-count frames do not dirty the buffers. The original behavior remains
available through `__sdfGame.setGooUploadOptimization(false)` for comparison.

The actual sync paths produce identical drawn matrix/mask bytes across
full→small→empty→growing transitions, both fill algorithms and both shutter
partitions. Pending update ranges are replaced even if multiple syncs happen
before a draw. Rendering, target clears, particle counts and shading are unchanged.

CPU-only benchmark of two real sync calls per frame, 15 alternating batches
of 1,000 frames after warm-up (GPU submission excluded):

| Fixture | Full upload preparation | Live-prefix preparation | Saving |
| --- | ---: | ---: | ---: |
| Empty | 0.01993 ms | 0.00006 ms | 0.01987 ms |
| 48 drops + 32 pools | 0.02714 ms | 0.00726 ms | 0.01988 ms |
| 431 drops + 256 pools | 0.07794 ms | 0.06437 ms | 0.01357 ms |

For that synthetic blast, the two uploads shrink from 144,000 to 49,464 bytes
per frame (66% less). Initial buffer allocation still uploads the full buffer.
Browser frame timings overlap; no whole-frame speedup is claimed for this edit.

GPU captures with VHS disabled and 120 settle frames per variant: candidate
versus repeated reference changes 148 pixels by more than 8/255, while reference
versus reference controls change 213–322. This is below the existing temporal
noise floor, not a claim of pixel-exact screenshot identity. The drawn input
arrays are exact in the focused tests. Captures were visually inspected.

## Measurement limits and reproduction

The initial full-fight matrix was stopped after six legs: census counts differed
between legs, and frame medians ranged 17–51 ms. It is invalid for attribution.
The largest labelled cost was the character march; that is a future target,
especially for wounded crowds, rather than reducing the accepted blur quality.

The original benchmark's `upscale-ship` leg loads the development model store,
not the tracked shipped path. For that run the exact tracked
`public/assets/lab/upscale/t16-rgb-v32.json` was copied under
`/tmp/blud-perf-20260917/models/t16-rgb-v32/model.json` and supplied with
`UPSCALE_MODELS_DIR`. The new frozen harness uses the actual default boot model.

All browser runs used an owned Vite/Chrome pair on 5492/9492, with profiles
outside the checkout and cleanup through `scripts/lab-servers.sh`. No concurrent
GPU job or build was launched by this task. Ordinary desktop/background load
remained present. No primary-checkout source changes, push or merge.

```sh
# Run inside the performance worktree, after lab_servers_up on owned ports:
node scripts/sdf-gather-dispatch-check.mjs --optimization-ab --room 5 \
  --flash --crowd 8 --rays 0,1,3,32,47,64 --out /tmp/probe-parity.json
node scripts/sdf-gather-dispatch-check.mjs --optimization-ab --timing-ab \
  --room 5 --flash --crowd 8 --rays 32 --out /tmp/probe-timing.json
SHUTTER_OUT=/tmp/shutter-cost node scripts/sdf-shutter-perf.mjs
SHUTTER_AB=uploads SHUTTER_OUT=/tmp/shutter-uploads node scripts/sdf-shutter-perf.mjs
SHUTTER_AB=probes SHUTTER_PARITY=1 SHUTTER_OUT=/tmp/shutter-probes node scripts/sdf-shutter-perf.mjs
GOO_OUT=/tmp/goo-sync.json npx vite-node scripts/sdf-goo-sync-bench.ts
```

The probe parity harness deliberately pins `performance.now()` for scene clocks;
its optional timing uses the unmodified `Performance.prototype.now` method.
An earlier timing attempt returned zero wall times because of that pin and was
discarded. Shader/crowd changes need the GPU parity gate, not just TypeScript.
