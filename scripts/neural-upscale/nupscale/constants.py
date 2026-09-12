"""Shared constants. Network shapes mirror src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts."""

HIDDEN_WIDTHS = {"s8": (8, 8), "s16": (16, 16), "s32": (32, 32), "s64": (64, 64), "s64d": (64, 64, 64),
                 "zero": (8, 8)}
# Input sets: rgb = rgb*hit + hit; rgbd adds hit*linearDepth; rgbn adds the view-space surface
# normal * hit (dataset pairs with a normal.npy; 2026-09-12); rgbdn has both.
INPUT_CHANNELS = {"rgb": 4, "rgbd": 5, "rgbn": 7, "rgbdn": 8}
NORMAL_CHANNELS = 3
LAST_CHANNELS = 16
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
        ("s32", "rgbn"), ("s64", "rgbn"), ("s64d", "rgbn"), ("s64", "rgbdn"))
G4_KEYS = ("overall", "face", "wound", "edge", "class:medium", "class:far")
RUN_OVERHEAD = 1.15
RESERVE_S = 45 * 60
