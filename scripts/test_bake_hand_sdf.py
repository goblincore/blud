# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
"""Tests for scripts/bake_hand_sdf.py and the import-safety of pose helpers.

Task A of the X1.26 baked hand SDF plan
(docs/superpowers/plans/2026-08-17-sdf-hand-bake-prototype.md).

Run either way (PEP 723 deps are identical to the baker's):

    uv run python -m unittest scripts/test_bake_hand_sdf.py -v
    uv run scripts/test_bake_hand_sdf.py -v
"""

import dataclasses
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
POSE_SCRIPT = SCRIPTS_DIR / "pose_measure_hands.py"
BAKE_SCRIPT = SCRIPTS_DIR / "bake_hand_sdf.py"
HAND_MANIFEST = REPO_ROOT / "public" / "assets" / "lab" / "hand-detail.json"


def load_module(path: Path, name: str):
    """Import a script file as a module under a FAKE module name.

    A fake name is the whole point for pose_measure_hands.py: the module must
    define its helpers when imported, and must only run main() /
    write_manifest() when executed as __main__.
    """
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module     # dataclasses inspects sys.modules[cls.__module__]
    try:
        spec.loader.exec_module(module)
    except BaseException:
        del sys.modules[name]
        raise
    return module


BAKE = load_module(BAKE_SCRIPT, "bake_hand_sdf_under_test")


class PoseHelpersImportSafeTest(unittest.TestCase):
    """A1: pose_measure_hands.py must be importable without Blender and without
    the downloaded source model, and must not do work at import time."""

    def test_import_exposes_helpers_without_main_or_manifest(self) -> None:
        before = HAND_MANIFEST.read_bytes() if HAND_MANIFEST.exists() else None
        module = load_module(POSE_SCRIPT, "pose_measure_hands_import_probe")
        for attr in ("Gltf", "Hand", "add_rot", "flex_sign", "splay_sign"):
            self.assertTrue(hasattr(module, attr), f"missing {attr} after import")
        # Plain-python import: Blender helpers absent, early exit NOT taken.
        self.assertFalse(module.IN_BLENDER)
        after = HAND_MANIFEST.read_bytes() if HAND_MANIFEST.exists() else None
        self.assertEqual(before, after, "write_manifest() ran at import time")


class GridSpecTest(unittest.TestCase):
    """A2: the frozen grid specification and its measured voxel sizes."""

    def test_frozen(self) -> None:
        spec = BAKE.grid_spec((0.0, 0.0, 0.0), (0.1, 0.05, 0.02), 0.005, 0.01)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            spec.dims = (1, 1, 1)  # type: ignore[misc]

    def test_dims_voxel_bounds(self) -> None:
        spec = BAKE.grid_spec((0.0, 0.0, 0.0), (0.1, 0.05, 0.02), 0.005, 0.01)
        # extents 0.12/0.07/0.04 -> ceil(24)+1, ceil(14)+1, ceil(8)+1
        self.assertEqual(spec.dims, (25, 15, 9))
        self.assertEqual(spec.bounds_min, (-0.01, -0.01, -0.01))
        self.assertTrue(np.allclose(spec.bounds_max, (0.11, 0.06, 0.03)))
        for axis in range(3):
            extent = spec.bounds_max[axis] - spec.bounds_min[axis]
            self.assertEqual(spec.dims[axis] - 1, round(extent / spec.voxel[axis]))
            self.assertLessEqual(spec.voxel[axis], 0.005 + 1e-12)

    def test_non_divisible_pitch_gives_measured_voxel(self) -> None:
        spec = BAKE.grid_spec((0.0, 0.0, 0.0), (0.1, 0.1, 0.1), 0.03, 0.0)
        self.assertEqual(spec.dims, (5, 5, 5))       # ceil(3.33)+1
        self.assertAlmostEqual(spec.voxel[0], 0.025)  # 0.1/4, not the 0.03 pitch

    def test_rejects_degenerate_bounds(self) -> None:
        with self.assertRaises(ValueError):
            BAKE.grid_spec((1.0, 1.0, 1.0), (1.0, 1.0, 1.0), 0.005, -0.06)


class GridPointsTest(unittest.TestCase):
    """A2/A3: X-fastest, then Y, then Z query ordering."""

    SPEC = BAKE.GridSpec(dims=(3, 2, 2), bounds_min=(0.0, 0.0, 0.0),
                         bounds_max=(1.0, 1.0, 1.0), voxel=(0.5, 1.0, 1.0))

    def test_x_fastest_then_y_then_z(self) -> None:
        pts = BAKE.grid_points(self.SPEC, 0, 2)
        self.assertEqual(pts.shape, (12, 3))
        self.assertTrue(np.allclose(pts[:3, 0], (0.0, 0.5, 1.0)))   # X varies
        self.assertTrue(np.allclose(pts[:3, 1:], pts[0, 1:]))       # y,z fixed
        self.assertTrue(np.allclose(pts[3], (0.0, 1.0, 0.0)))       # Y advances
        self.assertTrue(np.allclose(pts[6], (0.0, 0.0, 1.0)))       # Z slowest
        self.assertTrue(np.allclose(pts[11], (1.0, 1.0, 1.0)))

    def test_slab_bounds_checked(self) -> None:
        with self.assertRaises(ValueError):
            BAKE.grid_points(self.SPEC, 1, 1)
        with self.assertRaises(ValueError):
            BAKE.grid_points(self.SPEC, 0, 3)


class ValidateFieldTest(unittest.TestCase):
    """A2: what makes a baked field untrustworthy."""

    def spec(self, nx: int = 8, ny: int = 7, nz: int = 9) -> BAKE.GridSpec:
        return BAKE.GridSpec(dims=(nx, ny, nz), bounds_min=(-0.04, -0.04, -0.04),
                             bounds_max=(0.04, 0.04, 0.04),
                             voxel=(0.08 / (nx - 1), 0.08 / (ny - 1),
                                    0.08 / (nz - 1)))

    def valid_field(self, nz: int = 9, ny: int = 7, nx: int = 8
                    ) -> np.ndarray:
        # 0.05-halfwidth negative core around the center, positive shell.
        idx = np.indices((nz, ny, nx)).astype(np.float64)
        c = np.array([(nx - 1) / 2, (ny - 1) / 2, (nz - 1) / 2])
        r = np.sqrt(((idx[2] - c[0]) ** 2 + (idx[1] - c[1]) ** 2
                     + (idx[0] - c[2]) ** 2))
        return 0.01 * (r - 1.5)

    def test_accepts_valid(self) -> None:
        f = self.valid_field()
        stats = BAKE.validate_field(f, self.spec())
        self.assertGreater(stats["negatives"], 0)
        self.assertGreater(stats["positives"], 0)
        self.assertGreater(stats["boundaryMin"], 0.0)
        self.assertLess(stats["min"], 0.0)

    def test_rejects_wrong_shape(self) -> None:
        with self.assertRaises(ValueError):
            BAKE.validate_field(self.valid_field().transpose(1, 0, 2), self.spec())
    def test_rejects_non_finite(self) -> None:
        f = self.valid_field()
        f[4, 4, 4] = np.nan
        with self.assertRaises(ValueError):
            BAKE.validate_field(f, self.spec())

    def test_rejects_all_outside(self) -> None:
        with self.assertRaises(ValueError):
            BAKE.validate_field(np.ones((8, 8, 8)), self.spec())

    def test_rejects_all_inside(self) -> None:
        with self.assertRaises(ValueError):
            BAKE.validate_field(-np.ones((8, 8, 8)), self.spec())

    def test_rejects_boundary_leak(self) -> None:
        f = self.valid_field()
        f[0, 0, 0] = -0.01                       # inside sample on the AABB face
        with self.assertRaises(ValueError):
            BAKE.validate_field(f, self.spec())


class VolumeIOTest(unittest.TestCase):
    """A2/A3: R16F encoding, X-fastest sentinel, manifest v1 round-trip."""

    def test_x_fastest_half_encoding(self) -> None:
        field = np.arange(3 * 2 * 2, dtype=np.float64).reshape(2, 2, 3)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "f.r16f"
            n_bytes, sha = BAKE.write_r16f(path, field)
            self.assertEqual(n_bytes, 2 * 3 * 2 * 2)
            back = BAKE.decode_r16f(path.read_bytes(), (3, 2, 2))
            self.assertEqual(back.shape, (2, 2, 3))
            # X changes across the first three half values, then Y, then Z.
            self.assertEqual([float(v) for v in back.flat[:3]], [0.0, 1.0, 2.0])
            self.assertEqual(float(back.flat[3]), 3.0)
            self.assertEqual(float(back.flat[6]), 6.0)
            self.assertEqual(float(back.flat[11]), 11.0)
            self.assertEqual(len(sha), 64)

    def _write_valid_asset(self, tmp: Path) -> tuple[Path, Path, BAKE.GridSpec]:
        spec = BAKE.grid_spec((0.0, 0.0, 0.0), (0.1, 0.05, 0.02), 0.005, 0.01)
        nz, ny, nx = spec.dims[2], spec.dims[1], spec.dims[0]
        idx = np.indices((nz, ny, nx)).astype(np.float64)
        c = np.array([(nx - 1) / 2, (ny - 1) / 2, (nz - 1) / 2])
        r = np.sqrt(((idx[2] - c[0]) ** 2 + (idx[1] - c[1]) ** 2
                     + (idx[0] - c[2]) ** 2))
        field = 0.004 * (r - 2.5)
        r16f, man = tmp / "v.r16f", tmp / "v.json"
        n, sha = BAKE.write_r16f(r16f, field)
        assert n == 2 * nx * ny * nz
        BAKE.write_manifest(man, spec, binary_file=r16f.name, binary_sha256=sha,
                            source_sha256="a" * 64, attribution="CC-BY test",
                            stats=BAKE.validate_field(field, spec),
                            pitch_m=0.005, margin_m=0.01, duration_s=0.5)
        return r16f, man, spec

    def test_manifest_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            r16f, man, spec = self._write_valid_asset(Path(tmp))
            out = BAKE.validate_asset(man, r16f)
            m = out["manifest"]
            self.assertEqual(m["version"], 1)
            self.assertEqual(m["encoding"], "r16f-le")
            self.assertEqual(m["order"], "x-fastest-y-z")
            self.assertEqual(m["axes"], {"x": "thumbward", "y": "distal",
                                         "z": "dorsal"})
            self.assertEqual(m["dimensions"], list(spec.dims))
            self.assertEqual(m["byteLength"], 2 * int(np.prod(spec.dims)))
            self.assertEqual(m["isoValue"], 0.0)
            for key in ("min", "max"):
                a = np.array(m["boundsMin"])
                b = np.array(m["boundsMax"])
                self.assertTrue((a < b).all())
            self.assertEqual(m["sha256"]["binary"],
                             hashlib.sha256(r16f.read_bytes()).hexdigest())
            self.assertGreater(out["stats"]["negatives"], 0)
            self.assertGreater(out["stats"]["positives"], 0)

    def test_validate_asset_rejections(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            r16f, man, _ = self._write_valid_asset(Path(tmp))
            good = json.loads(man.read_text())
            data = r16f.read_bytes()

            def mutate(**kw):
                m = json.loads(json.dumps(good))
                for k, v in kw.items():
                    m[k] = v
                man.write_text(json.dumps(m))
                return man

            cases = [
                ("version", mutate(version=2)),
                ("encoding", mutate(encoding="r16f-be")),
                ("order", mutate(order="z-fastest-x-y")),
                ("axes", mutate(axes={"x": "thumbward", "y": "distal",
                                      "z": "palmar"})),
                ("byteLength", mutate(byteLength=len(data) + 2)),
                ("voxel", mutate(voxelSize=[v * 1.1 for v in good["voxelSize"]])),
                ("dims", mutate(dimensions=[d + 1 for d in good["dimensions"]])),
            ]
            for name, path in cases:
                with self.assertRaises(ValueError, msg=name):
                    BAKE.validate_asset(path, r16f)
            # binary tamper: same length, different bytes
            man.write_text(json.dumps(good))
            r16f.write_bytes(data[:-2] + b"\x00\x3c")
            with self.assertRaises(ValueError):
                BAKE.validate_asset(man, r16f)
            # truncated binary
            r16f.write_bytes(data[:-2])
            with self.assertRaises(ValueError):
                BAKE.validate_asset(man, r16f)


class CubeSignTest(unittest.TestCase):
    """A3: fast-winding sign on closed and dirty soups (needs libigl)."""

    def test_closed_cube(self) -> None:
        import igl

        v, f = BAKE.cube_mesh(1.0)
        q = np.array([[0.0, 0.0, 0.0], [1.25, 0.0, 0.0]], dtype=np.float64)
        d = BAKE.bake_chunk(q, v, f)
        self.assertLess(d[0], 0.0)
        self.assertAlmostEqual(d[0], -1.0, places=9)      # center inside
        self.assertGreater(d[1], 0.0)
        self.assertAlmostEqual(d[1], 0.25, places=9)      # 0.25 m outside
        w = igl.fast_winding_number(v, f, q)
        self.assertGreater(abs(w[0]), 0.5)
        self.assertLessEqual(abs(w[1]), 0.5)
        # zero crossing within one pitch along a ray through the +X face
        pitch = 0.05
        ray = np.linspace(0.5, 1.5, 41, dtype=np.float64)[:, None] \
            * np.array([[1.0, 0.0, 0.0]], dtype=np.float64)
        dd = BAKE.bake_chunk(ray, v, f)
        self.assertLessEqual(float(np.abs(dd).min()), pitch)

    def test_dirty_cube_keeps_exact_magnitude(self) -> None:
        import igl

        v, f = BAKE.cube_mesh(1.0, remove_face="x+")
        center = np.array([[0.0, 0.0, 0.0]], dtype=np.float64)
        w = float(igl.fast_winding_number(v, f, center)[0])
        self.assertGreater(abs(w), 0.5, "winding must still classify inside")
        self.assertAlmostEqual(abs(w), 5.0 / 6.0, places=3)
        d = float(BAKE.bake_chunk(center, v, f)[0])
        self.assertAlmostEqual(d, -1.0, places=9, msg=(
            "combined signed distance must remain exactly the unsigned "
            "magnitude (~-1.0), not libigl's combined-mode -0.667"))

    def test_relaxed_pose_table_matches_spec(self) -> None:
        self.assertEqual(
            BAKE.RELAXED_POSE,
            {"index": (9.0, (12.0, 18.0, 8.0)),
             "middle": (0.0, (15.0, 22.0, 10.0)),
             "ring": (5.0, (19.0, 27.0, 13.0)),
             "pinky": (11.0, (24.0, 32.0, 16.0))},
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
