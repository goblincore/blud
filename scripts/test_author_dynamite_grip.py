# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
"""Tests for scripts/author_dynamite_grip.py and the parameterized grip solver.

Dispatch Task A of the X1.27 baked dynamite grip plan
(docs/superpowers/plans/2026-08-17-sdf-dynamite-grip-release.md, design:
docs/superpowers/specs/2026-08-17-sdf-dynamite-grip-release-design.md).

Run either way (PEP 723 deps are identical to the baker's):

    uv run python -m unittest scripts/test_author_dynamite_grip.py -v
    uv run scripts/test_author_dynamite_grip.py -v

Tests that exercise `export_pose_soups` need Blender (`blender` on PATH) and
the licensed hand/dynamite sources outside the repo; they are skipped when
either is missing so the pure contract/transform tests still run anywhere.
"""

import dataclasses
import hashlib
import importlib.util
import inspect
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
POSE_SCRIPT = SCRIPTS_DIR / "pose_measure_hands.py"
AUTHOR_SCRIPT = SCRIPTS_DIR / "author_dynamite_grip.py"
LAB_DIR = REPO_ROOT / "public" / "assets" / "lab"
DYNAMITE_SOURCE = Path(
    "/Users/donny/Downloads/additional blud assets test/dynamite_bundle.glb")

LABELS = ("open", "approach", "first-contact", "wrap", "thumb-lock", "firm-grip")


def load_module(path: Path, name: str):
    """Import a script file as a module under a FAKE module name (never __main__)."""
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


PM = load_module(POSE_SCRIPT, "pose_measure_hands_under_test")
AUTHOR = load_module(AUTHOR_SCRIPT, "author_dynamite_grip_under_test")


def blender_available() -> bool:
    import shutil
    return shutil.which("blender") is not None


def sources_available() -> bool:
    return PM.SRC.exists() and DYNAMITE_SOURCE.exists()


# ===========================================================================
# Task A1 — the trusted grip solver is radius-parameterized
# ===========================================================================

class BuildGripParameterizedTest(unittest.TestCase):
    def test_build_grip_is_radius_parameterized_without_changing_default(self):
        sig = inspect.signature(PM.build_grip)
        assert "prop_radius" in sig.parameters, (
            f"build_grip signature lacks prop_radius: {list(sig.parameters)}")
        assert sig.parameters["prop_radius"].default == PM.GRIP_PROP_R
        src = inspect.getsource(PM.build_grip)
        assert "prop_radius" in src
        assert "GRIP_PROP_R" not in src.replace("prop_radius=GRIP_PROP_R", "")


# ===========================================================================
# Task A2 — licensed source guards and the runtime prop contract
# ===========================================================================

def valid_contract() -> AUTHOR.PropContract:
    return AUTHOR.PropContract(
        glb="dynamite-bundle-grip.glb",
        sha256="a" * 64,
        source_sha256="b" * 64,
        dimensions_m=(0.074, 0.32, 0.074),
        model_up="+Y",
        model_grip_offset_m=-0.015,
        contact_radius_m=0.037,
        contact_below_m=0.115,
        contact_above_m=0.135,
        fuse_tip_node="FuseTip",
        flight_pivot_node="FlightPivot",
        attribution="Dynamite Bundle by DJMaesen/bumstrum, CC-BY-4.0",
    )


class SourceGuardTest(unittest.TestCase):
    def test_source_is_the_credited_djmaesen_asset(self):
        if not DYNAMITE_SOURCE.exists():
            self.skipTest(f"licensed source not present: {DYNAMITE_SOURCE}")
        meta = AUTHOR.read_glb_asset_extras(DYNAMITE_SOURCE)
        assert meta["author"].startswith("DJMaesen")
        assert meta["license"].startswith("CC-BY-4.0")
        assert meta["source"].endswith(
            "dynamite-bundle-6d333be39e454b458d48ad86f8a78df4")


class PropContractTest(unittest.TestCase):
    def test_runtime_contract_rejects_a_proxy_scale(self):
        c = valid_contract()
        bad = dataclasses.replace(c, dimensions_m=(0.01, 0.01, 0.01))
        try:
            AUTHOR.validate_prop_contract(bad)
        except ValueError as exc:
            assert "derived dimensions" in str(exc)
        else:
            raise AssertionError("invalid proxy dimensions were accepted")

    def test_valid_fixture_contract_passes(self):
        AUTHOR.validate_prop_contract(valid_contract())   # must not raise

    def test_contract_json_uses_the_exact_task_b_keys(self):
        j = AUTHOR.contract_json(valid_contract())
        assert j == {
            "glb": "dynamite-bundle-grip.glb",
            "sha256": "a" * 64,
            "sourceSha256": "b" * 64,
            "dimensionsM": [0.074, 0.32, 0.074],
            "modelUp": "+Y",
            "modelGripOffsetM": -0.015,
            "contactRadiusM": 0.037,
            "contactBelowM": 0.115,
            "contactAboveM": 0.135,
            "fuseTipNode": "FuseTip",
            "flightPivotNode": "FlightPivot",
            "attribution": "Dynamite Bundle by DJMaesen/bumstrum, CC-BY-4.0",
        }


# ===========================================================================
# Task A3 — six poses against the exact derived prop
# ===========================================================================

def _pose_export_available() -> bool:
    return (blender_available() and sources_available()
            and hasattr(AUTHOR, "export_pose_soups"))


import numpy as np
from collections import namedtuple

PoseRecord = namedtuple("PoseRecord", "label origin basis path")


def load_exported_fixture_poses(export_dir: Path) -> list[PoseRecord]:
    """Six NPZ metadata records in numeric filename order."""
    records = []
    for npz_path in sorted(Path(export_dir).glob("pose-*.npz")):
        with np.load(npz_path) as data:
            frame = np.asarray(data["frame"], dtype=np.float64)  # rows x,y,z,origin
            records.append(PoseRecord(str(data["label"]), frame[3], frame[0:3],
                                      npz_path))
    return records


class GripPoseLabelTest(unittest.TestCase):
    def test_pose_labels_are_exact_and_ordered(self):
        assert AUTHOR.grip_pose_labels() == LABELS


@unittest.skipUnless(_pose_export_available(),
                     "needs Blender + licensed sources + export_pose_soups")
class ExportedPoseSoupsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix="pose-soups-")
        cls.fixture_dir = Path(AUTHOR.export_pose_soups(Path(cls._tmp.name)))
        cls.poses = load_exported_fixture_poses(cls.fixture_dir)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "_tmp"):
            cls._tmp.cleanup()

    def test_six_npz_files_in_numeric_label_order(self):
        assert [p.label for p in self.poses] == list(LABELS)

    def test_every_pose_uses_one_wrist_origin_and_anatomical_basis(self):
        authored = self.poses
        assert len({tuple(round(v, 9) for v in p.origin) for p in authored}) == 1
        assert len({tuple(round(v, 9) for row in p.basis for v in row)
                    for p in authored}) == 1

    def test_npz_contract_fields_present(self):
        for p in self.poses:
            with np.load(p.path) as data:
                for key in ("vertices", "faces", "label", "rotations",
                            "grip_local", "axis_local", "diagnostics",
                            "source_sha256", "prop_sha256"):
                    assert key in data, f"{p.path.name} missing {key}"
                assert np.isfinite(np.asarray(data["vertices"]).astype(np.float64)).all()
                assert data["grip_local"].shape == (3,)
                assert data["axis_local"].shape == (3,)
                rot = np.asarray(data["rotations"], dtype=np.float64)
                assert rot.ndim == 2 and rot.shape[1] == 4
                norms = np.sqrt((rot * rot).sum(axis=1))
                assert np.allclose(norms, 1.0, atol=1e-6), norms

    def test_topology_is_identical_across_frames(self):
        counts = []
        for p in self.poses:
            with np.load(p.path) as data:
                counts.append(np.asarray(data["faces"]).shape[0])
        assert len(set(counts)) == 1, counts

    def test_authoring_json_records_contract_and_keys(self):
        meta = json.loads((self.fixture_dir / "authoring.json").read_text())
        assert meta["labels"] == list(LABELS)
        for key in ("fingerT", "thumbT", "firstContactT", "thumbContactT",
                    "gripLocal", "axisLocal", "modelRotationLocal", "prop"):
            assert key in meta, key
        assert len(np.array(meta["modelRotationLocal"]).flatten()) == 4


if __name__ == "__main__":
    unittest.main(verbosity=2)
