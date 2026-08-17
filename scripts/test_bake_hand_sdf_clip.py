# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
"""Tests for scripts/bake_hand_sdf_clip.py (X1.27 dispatch Task B).

Plan: docs/superpowers/plans/2026-08-17-sdf-dynamite-grip-release.md
Design: docs/superpowers/specs/2026-08-17-sdf-dynamite-grip-release-design.md

Run either way (PEP 723 deps are identical to the baker's):

    uv run scripts/test_bake_hand_sdf_clip.py -v
"""

import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
CLIP_SCRIPT = SCRIPTS_DIR / "bake_hand_sdf_clip.py"
BAKE_SCRIPT = SCRIPTS_DIR / "bake_hand_sdf.py"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


CLIP = load_module(CLIP_SCRIPT, "bake_hand_sdf_clip")
BAKE = load_module(BAKE_SCRIPT, "bake_hand_sdf")

LABELS = ("open", "approach", "first-contact", "wrap", "thumb-lock", "firm-grip")


# ---------------------------------------------------------------------------
# Synthetic fixtures: small meshes/fields that satisfy every structural rule
# without Blender, libigl solves, or the checked-in binary.
# ---------------------------------------------------------------------------

def _triangle_mesh(offset: float) -> tuple[np.ndarray, np.ndarray]:
    """A minimal degenerate-free triangle offset along X (for grid maths)."""
    verts = np.array([[-0.01 + offset, 0.0, 0.0],
                      [0.0 + offset, 0.0, 0.0],
                      [0.0 + offset, 0.01, 0.0]], dtype=np.float64)
    faces = np.array([[0, 1, 2]], dtype=np.int64)
    return verts, faces


def _valid_field(dims: tuple[int, int, int]) -> np.ndarray:
    """Negative core fully enclosed by a positive shell (validate_field-pass)."""
    nz, ny, nx = dims
    field = np.ones(dims, dtype=np.float64)
    field[1:nz - 1, 1:ny - 1, 1:nx - 1] = -0.5
    return field


def _valid_clip_dict() -> dict:
    """A structurally valid v2 manifest over a tiny 4x4x4-per-frame atlas."""
    dims = (4, 4, 4)
    frames = [_valid_field((dims[2], dims[1], dims[0])) for _ in LABELS]
    atlas = CLIP.pack_depth(frames)
    lo = (-0.006, -0.006, -0.006)
    hi = (0.006, 0.006, 0.006)
    voxel = tuple((b - a) / (n - 1) for a, b, n in
                  zip(lo, hi, (dims[0], dims[1], dims[2])))
    prop = json.loads((REPO_ROOT / "public" / "assets" / "lab" /
                       "dynamite-bundle-grip.json").read_text())
    return {
        "version": 2,
        "kind": "hand-sdf-clip",
        "binary": "hand-sdf-dynamite-grip-r.r16f",
        "encoding": "r16f-le",
        "order": "x-fastest-y-z",
        "axes": {"x": "thumbward", "y": "distal", "z": "dorsal"},
        "dimensions": list(dims),
        "atlasDimensions": [dims[0], dims[1], dims[2] * 6],
        "frameDepth": dims[2],
        "frameCount": 6,
        "frames": [{"label": label, "key": key} for label, key
                   in zip(LABELS, (0.0, 0.2, 0.4, 0.6, 0.8, 1.0))],
        "timing": {"closeSec": 0.22, "releaseSec": 0.12,
                   "swingSec": 0.24, "releaseAtSec": 0.15},
        "boundsMin": list(lo),
        "boundsMax": list(hi),
        "voxelSize": list(voxel),
        "isoValue": 0,
        "byteLength": int(2 * np.prod((dims[0], dims[1], dims[2] * 6))),
        "sha256": {"binary": "0" * 64, "source": "1" * 64},
        "attribution": "CC-BY-4.0 test attribution",
        "prop": {
            "url": "dynamite-bundle-grip.glb",
            "sha256": prop["sha256"],
            "gripLocal": [0.01, 0.02, 0.003],
            "axisLocal": [0.0, 1.0, 0.0],
            "modelGripOffsetM": -0.015,
            "modelRotationLocal": [1.0, 0.0, 0.0, 0.0],
            "contactRadiusM": 0.037,
            "contactBelowM": 0.115,
            "contactAboveM": 0.135,
            "fuseTipNode": "FuseTip",
            "flightPivotNode": "FlightPivot",
        },
    }


class UnionGridTests(unittest.TestCase):
    def test_union_grid_is_shared_by_every_frame(self) -> None:
        mesh_a = (np.array([[-0.01, 0, 0], [0, 0, 0], [0, 0.01, 0]],
                           dtype=np.float64),
                  np.array([[0, 1, 2]], dtype=np.int64))
        mesh_b = (np.array([[+0.02, 0, 0], [0, 0, 0], [0, 0.01, 0]],
                           dtype=np.float64),
                  np.array([[0, 1, 2]], dtype=np.int64))
        grid = CLIP.clip_grid([mesh_a, mesh_b], 0.005, 0.012)
        self.assertLessEqual(grid.bounds_min[0], -0.022)
        self.assertGreaterEqual(grid.bounds_max[0], +0.032)

    def test_grid_dims_follow_pitch_rule_with_margin_added_once(self) -> None:
        mesh = (np.array([[0.0, 0.0, 0.0], [0.05, 0.0, 0.0], [0.0, 0.05, 0.0]],
                         dtype=np.float64),
                np.array([[0, 1, 2]], dtype=np.int64))
        grid = CLIP.clip_grid([mesh], 0.005, 0.012)
        # extents: x,y = 0.05+2*0.012 = 0.074 -> ceil(14.8)+1 = 16;
        # z = 0.0+2*0.012 = 0.024 -> ceil(4.8)+1 = 6
        self.assertEqual(grid.dimensions, (16, 16, 6))
        self.assertEqual(grid.atlas_dimensions,
                         (grid.dimensions[0], grid.dimensions[1],
                          grid.dimensions[2] * 6))
        voxel = grid.voxel_size
        for i in range(3):
            self.assertLessEqual(voxel[i], 0.005 + 1e-12)
            extent = grid.bounds_max[i] - grid.bounds_min[i]
            self.assertAlmostEqual(voxel[i], extent / (grid.dimensions[i] - 1),
                                   places=12)

    def test_clip_grid_rejects_inconsistent_meshes(self) -> None:
        bad = (np.array([[0.0, 0.0, np.nan], [0.05, 0, 0], [0, 0.05, 0]],
                        dtype=np.float64),
               np.array([[0, 1, 2]], dtype=np.int64))
        with self.assertRaises(ValueError):
            CLIP.clip_grid([bad], 0.005, 0.012)


class DepthPackTests(unittest.TestCase):
    def test_depth_pack_is_frame_major_and_x_fastest_inside_each_slab(self) -> None:
        frames = [np.full((2, 2, 3), i, dtype=np.float32) for i in range(6)]
        atlas = CLIP.pack_depth(frames)
        self.assertEqual(atlas.shape, (12, 2, 3))
        self.assertEqual(atlas[0, 0].tolist(), [0, 0, 0])
        self.assertEqual(atlas[2, 0].tolist(), [1, 1, 1])
        self.assertEqual(atlas[-1, -1].tolist(), [5, 5, 5])

    def test_pack_depth_matches_plan_concate_atlas_0(self) -> None:
        frames = [np.arange(24, dtype=np.float64).reshape(2, 3, 4) + i * 100
                  for i in range(6)]
        atlas = CLIP.pack_depth(frames)
        self.assertTrue(np.array_equal(
            atlas, np.concatenate(frames, axis=0)))

    def test_pack_depth_rejects_mismatched_frames(self) -> None:
        with self.assertRaises(ValueError):
            CLIP.pack_depth([np.zeros((2, 2, 3)), np.zeros((2, 2, 4))])
        with self.assertRaises(ValueError):
            CLIP.pack_depth([])


class ManifestValidationTests(unittest.TestCase):
    def _assert_rejected(self, mutate, *, needle: str = "") -> None:
        manifest = _valid_clip_dict()
        mutate(manifest)
        try:
            CLIP.validate_manifest(manifest)
        except ValueError as exc:
            if needle:
                self.assertIn(needle, str(exc))
        else:
            raise AssertionError("invalid manifest was accepted")

    def test_valid_manifest_passes(self) -> None:
        CLIP.validate_manifest(_valid_clip_dict())

    def test_rejects_wrong_version_and_kind(self) -> None:
        self._assert_rejected(lambda m: m.update(version=1))
        self._assert_rejected(lambda m: m.update(version=3))
        self._assert_rejected(lambda m: m.update(kind="hand-sdf"))

    def test_rejects_frame_count_other_than_six(self) -> None:
        self._assert_rejected(lambda m: m.update(frameCount=5))
        self._assert_rejected(lambda m: m.update(frameCount=7))

    def test_rejects_duplicate_labels(self) -> None:
        def dup(m):
            m["frames"][2]["label"] = m["frames"][1]["label"]
        self._assert_rejected(dup)

    def test_rejects_out_of_order_labels(self) -> None:
        def swap(m):
            m["frames"][1]["label"], m["frames"][2]["label"] = \
                m["frames"][2]["label"], m["frames"][1]["label"]
        self._assert_rejected(swap)

    def test_rejects_keys_not_strictly_increasing_from_0_to_1(self) -> None:
        self._assert_rejected(lambda m: m["frames"][0].update(key=0.1))
        self._assert_rejected(lambda m: m["frames"][-1].update(key=0.9))
        self._assert_rejected(lambda m: m["frames"][3].update(key=0.15))
        self._assert_rejected(lambda m: m["frames"][3].update(key=0.4))  # == frame 2
        self._assert_rejected(lambda m: m["frames"][3].update(key=0.8))  # == frame 4

    def test_rejects_atlas_depth_mismatch(self) -> None:
        self._assert_rejected(
            lambda m: m.update(atlasDimensions=[4, 4, m["frameDepth"] * 5]))
        self._assert_rejected(
            lambda m: m.update(atlasDimensions=[4, 4, m["frameDepth"] * 6 + 1]))
        self._assert_rejected(lambda m: m.update(frameDepth=5))

    def test_rejects_byte_length_mismatch(self) -> None:
        self._assert_rejected(lambda m: m.update(byteLength=m["byteLength"] + 2))
        self._assert_rejected(lambda m: m.update(byteLength=0))

    def test_rejects_prop_hash_mismatch(self) -> None:
        self._assert_rejected(
            lambda m: m["prop"].update(sha256="f" * 64), needle="prop")

    def test_rejects_non_unit_axis_or_quaternion(self) -> None:
        self._assert_rejected(lambda m: m["prop"].update(axisLocal=[0, 2.0, 0]))
        self._assert_rejected(
            lambda m: m["prop"].update(modelRotationLocal=[2.0, 0, 0, 0]))

    def test_rejects_missing_attribution(self) -> None:
        self._assert_rejected(lambda m: m.update(attribution=""))
        self._assert_rejected(lambda m: m.pop("attribution"))

    def test_rejects_unsafe_relative_paths(self) -> None:
        self._assert_rejected(lambda m: m.update(binary="/abs/path.r16f"))
        self._assert_rejected(lambda m: m.update(binary="../escape.r16f"))
        self._assert_rejected(lambda m: m.update(binary="https://x/y.r16f"))
        self._assert_rejected(lambda m: m["prop"].update(url="C:\\glb"))
        self._assert_rejected(lambda m: m["prop"].update(url="../up.glb"))

    def test_rejects_bad_timing_and_axes(self) -> None:
        self._assert_rejected(lambda m: m["timing"].update(closeSec=0.0))
        self._assert_rejected(lambda m: m["timing"].update(releaseAtSec=-0.1))
        self._assert_rejected(lambda m: m["timing"].pop("swingSec"))
        self._assert_rejected(lambda m: m.update(axes={"x": "palmward",
                                                       "y": "distal",
                                                       "z": "dorsal"}))
        self._assert_rejected(lambda m: m.update(encoding="r32f-le"))
        self._assert_rejected(lambda m: m.update(order="z-fastest"))

    def test_rejects_inconsistent_bounds_or_voxel(self) -> None:
        self._assert_rejected(lambda m: m.update(boundsMin=[0.01, -0.006, -0.006]))
        self._assert_rejected(lambda m: m.update(boundsMax=[0.0, 0.006, 0.006]))
        self._assert_rejected(
            lambda m: m.update(voxelSize=[0.005, 0.004, 0.004]))

    def test_rejects_missing_prop_nodes(self) -> None:
        self._assert_rejected(lambda m: m["prop"].update(fuseTipNode="tip"))
        self._assert_rejected(
            lambda m: m["prop"].update(flightPivotNode="root"))


class ClipAssetValidationTests(unittest.TestCase):
    """Per-slab validation of an atlas binary against its manifest."""

    def test_slab_validation_passes_and_slices_every_frame(self) -> None:
        manifest = _valid_clip_dict()
        dims = tuple(manifest["dimensions"])
        atlas = CLIP.pack_depth(
            [_valid_field((dims[2], dims[1], dims[0])) for _ in LABELS])
        slabs = CLIP.validate_atlas(atlas.astype("<f2"), manifest)
        self.assertEqual(len(slabs), 6)
        for stats in slabs:
            self.assertGreater(stats["negatives"], 0)
            self.assertGreater(stats["positives"], 0)
            self.assertGreater(stats["boundaryMin"], 0.0)

    def test_slab_validation_rejects_wrong_atlas_shape(self) -> None:
        manifest = _valid_clip_dict()
        atlas = np.zeros((4, 4, 4 * 6 + 2), dtype="<f2")
        with self.assertRaises(ValueError):
            CLIP.validate_atlas(atlas, manifest)

    def test_frame_keys_are_the_plan_table(self) -> None:
        self.assertEqual(CLIP.FRAME_KEYS, (0.0, 0.2, 0.4, 0.6, 0.8, 1.0))
        self.assertEqual(CLIP.TIMING, {"closeSec": 0.22, "releaseSec": 0.12,
                                       "swingSec": 0.24, "releaseAtSec": 0.15})
        self.assertEqual(CLIP.grip_pose_labels(), LABELS)


class CheckedInAssetTests(unittest.TestCase):
    """The real checked-in clip: runs only once Task B has baked it."""

    R16F = REPO_ROOT / "public" / "assets" / "lab" / "hand-sdf-dynamite-grip-r.r16f"
    JSON = REPO_ROOT / "public" / "assets" / "lab" / "hand-sdf-dynamite-grip-r.json"

    @unittest.skipUnless(JSON.exists() and R16F.exists(),
                         "clip not baked yet (run bake_hand_sdf_clip.py)")
    def test_checked_in_clip_validates(self) -> None:
        result = CLIP.validate_checked_in(self.JSON, self.R16F)
        manifest = result["manifest"]
        self.assertEqual(manifest["version"], 2)
        self.assertEqual(manifest["frameCount"], 6)
        self.assertEqual(len(result["slabs"]), 6)
        mib = self.R16F.stat().st_size / (1 << 20)
        self.assertLess(mib, 35.0, f"clip binary {mib:.1f} MiB above the 35 MiB gate")


if __name__ == "__main__":
    unittest.main(verbosity=2)
