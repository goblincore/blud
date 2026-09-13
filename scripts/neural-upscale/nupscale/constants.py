"""Shared constants. Network shapes mirror src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts."""

# Hidden layers as (width, dilation) — the last (16-channel) layer is always dilation 1. Mirrors
# upscale-model.ts HIDDEN_LAYERS. 't24'/'t16' (2026-09-12 run 3): three layers with the middle one
# dilated 2, so the receptive field grows 7 -> 11 texels at ~s32 / ~half-s32 multiply-adds — the v3 grid
# showed a third layer beats doubling width and the research pass says RF is the lever for AO/shadow.
HIDDEN_LAYERS = {
    "s8": ((8, 1), (8, 1)), "s16": ((16, 1), (16, 1)), "s32": ((32, 1), (32, 1)),
    "s64": ((64, 1), (64, 1)), "s64d": ((64, 1), (64, 1), (64, 1)),
    "t24": ((24, 1), (24, 2), (24, 1)), "t16": ((16, 1), (16, 2), (16, 1)),
    "zero": ((8, 1), (8, 1)),
}
HIDDEN_WIDTHS = {k: tuple(w for w, _ in v) for k, v in HIDDEN_LAYERS.items()}
HIDDEN_DILATIONS = {k: tuple(d for _, d in v) for k, v in HIDDEN_LAYERS.items()}
# Input sets: rgb = rgb*hit + hit; rgbd adds hit*linearDepth; rgbn adds the view-space surface
# normal * hit (dataset pairs with a normal.npy; 2026-09-12); rgbdn has both.
INPUT_CHANNELS = {"rgb": 4, "rgbd": 5, "rgbn": 7, "rgbdn": 8}
NORMAL_CHANNELS = 3
LAST_CHANNELS = 16
# Run-4 full-res HEAD (plan 2026-09-12-neural-upscale-run4-relief §4): one 3x3 layer at OUTPUT resolution over
# [reconstructed rgb (3), covered (1), detail noise*gate (3), nearest-up input rgb*hit (3)] -> rgb residual.
HEAD_IN_CHANNELS = 10
HEAD_WIDTH = 8
HEAD_OUT_CHANNELS = 3
DEPTH_INPUT_SCALE = 0.1
ICNR_SCALE = 0.1

DATASET_FORMAT = "blud-upscale-dataset/2"
MODEL_FORMAT = "blud-upscale-model/1"
CLASSES = ("close", "medium", "far")

# Loss (spec §2): where regions overlap, the largest weight applies.
REGION_WEIGHTS = {"face": 2.0, "wound": 2.0, "edge": 1.5, "interior": 1.0}
EDGE_BAND_PX = 2
MIN_REGION_RADIUS_PX = 1.0
COVERAGE_MARGIN = 0.25
DETAIL_WEIGHT = 0.5
COVERAGE_WEIGHT = 1.0

# Sampling and schedule defaults (spec §2), recorded per run.
CROP_IN = 64
BATCH = 64
LR = 1e-3
MAX_STEPS = 20_000
TIME_CAP_S = 25 * 60
VAL_EVERY = 500
LOG_EVERY = 50
REGION_CENTRED_SHARE = 0.5
# Flip augmentation (2026-09-12): each crop is mirrored in x and/or y with these probabilities.
# Free data; the §4 sub-pixel neighbour mapping is symmetric under mirroring.
FLIP_X = 0.5
FLIP_Y = 0.5
SHOWCASE_FALLBACK = 12

# Coverage-aware bicubic baseline.
BICUBIC_A = -0.5
BICUBIC_MIN_WEIGHT = 0.25

# The grid (spec §4) and its spend estimate.
GRID = (("s8", "rgb"), ("s8", "rgbd"), ("s16", "rgb"), ("s16", "rgbd"), ("s32", "rgb"), ("s32", "rgbd"),
        ("s64", "rgb"), ("s64", "rgbd"), ("s64d", "rgb"),
        ("s32", "rgbn"), ("s64", "rgbn"), ("s64d", "rgbn"), ("s64", "rgbdn"),
        ("t24", "rgbn"), ("t16", "rgbn"), ("t24", "rgb"), ("t16", "rgb"))
G4_KEYS = ("overall", "face", "wound", "edge", "class:medium", "class:far")
RUN_OVERHEAD = 1.15
RESERVE_S = 45 * 60
