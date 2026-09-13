# Neural upscale P3 — shared contracts and rules

Read this before any P3 plan task. Every P3 plan (`p3a` capture, `p3b` trainer, `p3c` in-game,
`p3d` pre-flight + RunPod) implements against these formats. If a task's code disagrees with this
file, this file wins — stop and report the disagreement rather than inventing a third format.

**Spec:** `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md`
**Parent spec (stage, §4 reconstruction):** `docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md`

## 0. Rules for every P3 task

1. **Work only in the files your task lists.** Don't push, merge or rebase. Commit on your branch.
2. **Never weaken a gate or threshold to get a pass.** If a check fails after honest debugging,
   write the numbers and your diagnosis in the task's notes, commit, and stop.
3. **No comments inside any WGSL function parameter list** (three's `wgslFn` parser reads
   `word: word` there as a phantom input). No backticks inside WGSL template strings.
4. **Run only the tests your task names**, then `npm run build` once at the end of TypeScript
   tasks. Never run the whole `npx vitest run` suite alongside a GPU job.
5. **GPU scripts own their servers** through `scripts/lab-servers.sh` and use the port pair in
   the task. Kill and restart vite after any shader-source edit; a reused vite serves stale
   modules.
6. **Browser/GPU tasks must run on the `pi` harness.** The `dsh` sandbox blocks headless Chrome
   and `git commit`.
7. **Never spend money.** Agents never create, start or resume RunPod pods. Pod scripts are
   written and syntax-checked only. Agents never read, print or set API keys.
8. **Data locations are outside every worktree.** Dispatch worktrees are deleted when a task
   ends. Datasets live under `UPSCALE_DATA_ROOT` (default `~/blud-upscale-data`; smoke runs use
   `/tmp/blud-upscale-data`). Training runs live under `/tmp/blud-upscale-runs` locally and
   `/workspace/runs` on a pod.
9. **Extracted Blood assets never enter data or commits.** Captures render only the flesh layer
   of tracked `public/assets/lab/*` content.

## 1. Dataset v2 (`blud-upscale-dataset/2`)

Written by `scripts/upscale-capture-v2.mjs` (p3a), and by `nupscale.convert_p2` for the pre-flight
(p3b). Read by `nupscale.data.load_dataset` (p3b).

**Layout**

```
<dataset>/
  manifest.json               # written at the end of a capture
  sequences.jsonl             # appended per sequence while capturing (resume)
  pairs.jsonl                 # appended per pair while capturing (resume)
  pairs/<pair id>/in.npy
  pairs/<pair id>/target.npy
  pairs/<pair id>/target-coverage.npy
  pairs/<pair id>/native.npy  # validation pairs only
  pairs/<pair id>/normal.npy  # optional (captures from 2026-09-12 on): rgbn/rgbdn input sets
  pairs/<pair id>/detail.npy  # optional (run 4, 2026-09-12 late): output-res skin-detail field
  check-in.npy, check-target.npy   # optional, UPSCALE_DUMP_CHECK=1
```

**Arrays** — NumPy `.npy` v1.0, dtype `<f4`, row 0 = top of the rendered image:

| File | Shape | Channels |
|---|---|---|
| `in.npy` | (h, w, 4) | r, g, b, clip depth (≥ 1.0 = no flesh). The single-ray 400×300 march, cropped |
| `target.npy` | (2h, 2w, 4) | r, g, b = mean of hit samples; clip depth of the first hit in sample order; covered iff hit count k ≥ 8 of 16, else (0, 0, 0, 1.0) |
| `target-coverage.npy` | (2h, 2w, 1) | k / 16 |
| `native.npy` | (2h, 2w, 4) | the single-ray 800×600 march, cropped (validation pairs only) |
| `normal.npy` | (h, w, 3) | VIEW-space unit shading normal of the input march (x right, y up, z toward the camera), zero where `in` has no flesh. Captured by re-rendering the same frozen 400×300 frame in march debug mode 9 and rotating by the camera's matrixWorldInverse; the loader appends it as input channels 4..6 (`Pair.inp` becomes (7, h, w)). Optional: a pair without it can only train `rgb`/`rgbd` models |
| `detail.npy` | (2h, 2w, 4) | Run 4: the march's skin-detail noise `vec3(fbm(a*22), fbm(a*22+5), fbm(a*22+11))` evaluated at OUTPUT resolution from the rest-space anchor (sub-texel via screen-space anchor gradients), w = gate (`detailAmp`, 0 off flesh). The world-space normal perturbation the march applies — at 4× the sampling density. Optional; feeds the full-res branch of run-4 models |

Clip depth is WebGPU [0, 1] clip depth. Linear view depth is
`near·far / (far − d·(far − near))`, with `near`/`far` from the manifest.

**Crop rule (input px).** Take the flesh bounding box of `in` (alpha < 1), unioned with the box of
target coverage ≥ 0.5 halved outward (floor the start, ceil the end). Pad by 8, clamp to the
400×300 frame. The target crop is exactly 2× the input crop.

**`manifest.json`**

```json
{
  "format": "blud-upscale-dataset/2",
  "created": "2026-09-12T10:00:00.000Z",
  "checkout": "<git sha>",
  "spec": "docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md",
  "seed": 1,
  "near": 0.1,
  "far": 200,
  "input":  { "fullW": 400, "fullH": 300, "sdfScale": 0.5, "fieldStyle": "off", "temporalStart": "on" },
  "target": { "fullW": 800, "fullH": 600, "samples": 16, "grid": 4, "coverageRule": "k >= 8", "temporalStart": "off" },
  "rowOrder": "row 0 = top",
  "checks": { "g2": {}, "supersample": {} },
  "stats": { "skippedStatic": 0, "skippedEmpty": 0, "skippedNoHead": 0, "secondsPerPair": 0 },
  "sequences": [ { "id": 0, "split": "train", "captured": 10, "class": "medium", "lookAt": "head", "character": "zombie", "room": 2, "distance": 2.3, "orbitDeg": 40.1, "eyeOffset": null, "eyeHeight": 1.5, "wounds": { "shots": 2, "slug": false, "blast": false, "blastAngle": 1.2 }, "lightPhase": 123456, "actorId": 17 } ],
  "pairs": [ {
    "id": "s0003-f007",
    "seq": 3, "frame": 7, "split": "val", "showcase": false,
    "class": "medium", "lookAt": "head", "character": "zombie", "room": 2,
    "distance": 2.31, "orbitDeg": 40.0, "wounds": 3,
    "crop": { "x": 120, "y": 80, "w": 96, "h": 110 },
    "files": { "in": "pairs/s0003-f007/in.npy", "target": "pairs/s0003-f007/target.npy",
               "targetCoverage": "pairs/s0003-f007/target-coverage.npy", "native": "pairs/s0003-f007/native.npy" },
    "regions": {
      "heads":  [ { "x": 21.5, "y": 44.2, "r": 11.3, "actorId": 17 } ],
      "wounds": [ { "x": 60.0, "y": 90.4, "r": 3.1, "type": "pellet", "actorId": 17 } ]
    },
    "inputCoverage": 0.031, "iouPrev": 0.87, "bytes": 2481920
  } ]
}
```

- `class` ∈ close | medium | far; `lookAt` ∈ head | wound | torso; `split` ∈ train | val.
- `files.native` is `null` for train pairs.
- **`regions` are in crop-local OUTPUT px** (origin = the top-left of `target.npy`), covering every
  actor visible in the crop, not only the staged one. `type` is whatever the game's `Wound.type`
  holds.
- `showcase` marks the 12 fixed validation pairs the dashboard shows (3 close, 5 medium, 4 far,
  preferring pairs with a head and a wound).
- Validation is chosen per **sequence** (never per frame): about 10% of sequences.
- `sequences`, `checks` and `stats` are informational; the trainer reads only `format`, `near`,
  `far` and `pairs`.

## 2. Model JSON (`blud-upscale-model/1`)

Written by `nupscale.export.export_model` (p3b) and `serializeUpscaleModel` (p3c, tests and smoke
models). Read by `parseUpscaleModelJson` (p3c).

```json
{
  "format": "blud-upscale-model/1",
  "id": "s16",
  "inputs": "rgbd",
  "source": "trained",
  "run": "s16-rgbd",
  "step": 12500,
  "layers": [
    { "inC": 5,  "outC": 16, "relu": true,  "dilation": 1, "weights": "<base64 float32 LE>", "bias": "<base64 float32 LE>" },
    { "inC": 16, "outC": 16, "relu": true,  "weights": "...", "bias": "..." },
    { "inC": 16, "outC": 16, "relu": false, "dilation": 1, "weights": "...", "bias": "..." }
    // `dilation` (2026-09-12, run 3): tap spacing of the 3x3, per HIDDEN_DILATIONS for the id (t24/t16 =
    // 1,2,1 hidden); optional, absent = the ladder's value for the id; a present mismatch is rejected. A reparameterised model is FUSED before export — always plain convs.
  ],
  "inScale": [1, 1, 1, 1, 0.10000000149011612],
  "inOffset": [0, 0, 0, 0, 0],
  "weightHash": "a1b2c3d4",
  "trainedOn": { "dataset": "v2-2026-09-12", "manifestHash": "<16 hex>" },
  "metrics": { "overall": 0.041 }
}
```

- `id` ∈ s8 | s16 | s32 | zero. The layer chain is `[INPUT_CHANNELS[inputs], ...HIDDEN_WIDTHS[id], 16]`,
  with ReLU on every layer but the last.
- **Weight order is PyTorch `Conv2d`:** `weights[((o·inC + i)·3 + ky)·3 + kx]`, applied as
  cross-correlation at input texel (x + kx − 1, y + ky − 1) with replicate (edge-clamped) borders.
- **Input assembly:** rgb × hit, hit, and for `rgbd` also hit × linearDepth. The network input is
  `raw · inScale + inOffset`; `inScale[4]` = float32(0.1) for `rgbd`.
- **Pixel shuffle:** `out[c, 2y+i, 2x+j] = last[c·4 + i·2 + j](y, x)`, with c = r, g, b, coverage.
- **`weightHash`** = FNV-1a 32 (offset 0x811c9dc5, prime 0x01000193) over the little-endian float32
  bytes of each layer's `weights` then `bias`, in layer order, then `inScale`, then `inOffset`.
  Lowercase hex, 8 digits. A reader recomputes it and rejects a mismatch.

**Cross-language test vectors** (computed by `hashModel` in `upscale-model.ts` and a Python port;
both agree):

| Arrays, in order | weightHash |
|---|---|
| tiny: weights `[0.5, −1.25, 3, 0, 0, 0, 0, 0, 0.001]`, bias `[0.25]`, inScale `[1, 0.1]`, inOffset `[0, 0.5]` | `21f3e5c5` |
| `createUpscaleModel('zero', 'rgb', 1)` (all zeros; inScale `[1,1,1,1]`) | `3d86dba5` |
| `createUpscaleModel('zero', 'rgbd', 1)` (all zeros; inScale `[1,1,1,1,0.1]`) | `55870aa7` |

## 3. Training run and export layout (p3b → p3c/p3d)

```
<run root>/                         # e.g. /tmp/blud-upscale-runs/preflight or /workspace/runs/p3
  index.html  dashboard.json  img/*.png
  STOPPED_AT_CAP                    # only if the spend cap stopped the grid
  GRID_DONE.json                    # when the grid finishes
  <run>/                            # run = "<id>-<inputs>", e.g. s16-rgbd
    ckpt-latest.pt  ckpt-best.pt
    exports/<run>-best/model.json
    exports/<run>-best/parity/meta.json, input-0.npy, output-sp-0.npy, input-1.npy, output-sp-1.npy
    exports/<run>-final/...         # same layout
```

**`parity/meta.json`**: `{ "near": 0.1, "far": 200, "fixtures": [ { "pair": "<pair id>", "input": "input-0.npy", "output": "output-sp-0.npy" } ] }`
- `input-k.npy` (h, w, 4): the validation pair's `in.npy`.
- `output-sp-k.npy` (2h, 2w, 4): PyTorch's §4 reconstruction on CPU in float32. rgb is
  `max(src + residual, 0)` where covered, else 0; alpha is the source texel's depth where covered,
  else 1.0.

## 4. In-game model store (p3c)

```
.upscale-models/<name>/model.json   (+ optional parity/ copied from the export)
```

- `.upscale-models/` is gitignored and lives in the repo root. `UPSCALE_MODELS_DIR` overrides it.
- `<name>` matches `^[a-z0-9][a-z0-9._-]{0,63}$`, so no path separators.
- The convention is the export directory name, e.g. `s16-rgbd-best`.
- Dev server: `GET /__lab/upscale-models` returns a summary array; `GET /__lab/upscale-model/<name>`
  returns the JSON.
- Game: `?upscale=trained&upscalemodel=<name>[&upscalelayout=dc]`, or
  `await __sdfGame.setUpscale({ trained: '<name>' })`. The **U** key cycles native → nearest →
  model whenever an upscale is active.
