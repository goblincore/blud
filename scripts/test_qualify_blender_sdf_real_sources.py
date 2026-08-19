# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2", "scipy==1.18.0"]
# ///
"""Tests for scripts/qualify_blender_sdf_real_sources.py.

Task 3 of the Blender SDF grid adapters continuation plan
(docs/superpowers/plans/2026-08-19-blender-sdf-grid-adapters-continuation.md).

Everything here is PURE: source preparation and gate scoring must be testable
without launching Blender, so the expensive real-source runs stay in the CLI.

    uv run scripts/test_qualify_blender_sdf_real_sources.py -v
"""

from __future__ import annotations

import dataclasses
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        del sys.modules[name]
        raise
    return module


QUAL = load_module(SCRIPTS_DIR / "qualify_blender_sdf_real_sources.py",
                   "qualify_real_sources_under_test")
SDF = QUAL.SDF
HUM = QUAL.HUM


# ---------------------------------------------------------------------------
# Dense-result fixtures (no Blender, no real assets)
# ---------------------------------------------------------------------------

def dense_result(**over) -> "SDF.DenseSdfResult":
    """A small, valid direct-vdb result: one negative blob well inside."""
    dims = (9, 9, 9)
    lo, hi = (-0.04, -0.04, -0.04), (0.04, 0.04, 0.04)
    field = np.full((dims[2], dims[1], dims[0]), 0.02, dtype=np.float32)
    field[3:6, 3:6, 3:6] = -0.01
    base = dict(
        route=SDF.SdfGridRoute.DIRECT_VDB, dimensions=dims,
        bounds_min_m=lo, bounds_max_m=hi,
        voxel_size_m=tuple((b - a) / (n - 1) for a, b, n in zip(lo, hi, dims)),
        values_f32=field, source_sha256="aa" * 32,
        node_contract_sha256="bb" * 32)
    base.update(over)
    return SDF.DenseSdfResult(**base)


def two_blob_result() -> "SDF.DenseSdfResult":
    field = np.full((9, 9, 9), 0.02, dtype=np.float32)
    field[2, 2, 2] = -0.01
    field[6, 6, 6] = -0.01
    return dense_result(values_f32=field)


def invalid_dense_results() -> list[tuple[object, str]]:
    all_positive = np.full((9, 9, 9), 0.02, dtype=np.float32)
    all_negative = np.full((9, 9, 9), -0.02, dtype=np.float32)
    boundary = np.full((9, 9, 9), 0.02, dtype=np.float32)
    boundary[0, 4, 4] = -0.01
    nonfinite = np.full((9, 9, 9), 0.02, dtype=np.float32)
    nonfinite[4, 4, 4] = np.nan
    return [
        (dense_result(values_f32=all_positive), "no inside"),
        (dense_result(values_f32=all_negative), "no outside"),
        (dense_result(values_f32=boundary), "boundary"),
        (dense_result(values_f32=nonfinite), "non-finite"),
        (dense_result(route=SDF.SdfGridRoute.GRID_TO_MESH_LIBIGL), "route drift"),
    ]


def run_a() -> "SDF.DenseSdfResult":
    return dense_result()


def exact_copy_of_run_a() -> "SDF.DenseSdfResult":
    original = run_a()
    return dataclasses.replace(original, values_f32=original.values_f32.copy())


def run_b_with_one_f32_changed() -> "SDF.DenseSdfResult":
    original = run_a()
    field = original.values_f32.copy()
    field[4, 4, 4] = 0.5                       # sign flip: survives f16 too
    return dataclasses.replace(original, values_f32=field)


# ---------------------------------------------------------------------------
# Tiny synthetic humanoid source (only .vertices/.faces and one partition)
# ---------------------------------------------------------------------------

FOREARM_TRANSLATION = np.array([-1.0, -2.0, -3.0])


def tiny_source_soup() -> "HUM.SourceSoup":
    vertices = np.array([
        [0.0, 0.0, 0.0], [0.1, 0.0, 0.0], [0.1, 0.2, 0.0],   # owned face
        [5.0, 5.0, 5.0], [5.1, 5.0, 5.0], [5.1, 5.2, 5.0],   # other face
    ], dtype=np.float64)
    faces = np.array([[0, 1, 2], [3, 4, 5]], dtype=np.uint32)
    return HUM.SourceSoup(
        vertices=vertices, faces=faces,
        face_uvs=np.zeros((2, 3, 2), dtype=np.float64),
        joints=np.zeros((6, 4), dtype=np.uint32),
        weights=np.zeros((6, 4), dtype=np.float64),
        bone_names=("RightForeArm", "Other"), parents=(-1, 0),
        inverse_bind=np.tile(np.eye(4), (2, 1, 1)),
        albedo_rgba=np.zeros((1, 1, 4), dtype=np.uint8),
        base_color_factor=np.ones(4), texture_transform=np.eye(3))


def tiny_partition_result() -> "HUM.PartitionResult":
    model_to_bind = np.eye(4)
    model_to_bind[:3, 3] = FOREARM_TRANSLATION
    forearm = HUM.BonePartition(
        name="RightForeArm", joint_index=0, parent_index=-1,
        bind_to_model=np.linalg.inv(model_to_bind), model_to_bind=model_to_bind,
        support_planes=np.zeros((0, 4)), pitch_m=0.006)
    other = HUM.BonePartition(
        name="Other", joint_index=1, parent_index=0,
        bind_to_model=np.eye(4), model_to_bind=np.eye(4),
        support_planes=np.zeros((0, 4)), pitch_m=0.006)
    return HUM.PartitionResult(
        partitions=(forearm, other),
        face_owners=np.array([0, 1], dtype=np.int64),
        unowned_face_indices=np.zeros((0,), dtype=np.int64),
        bands=(), coverage={})


EXPECTED_MINIMUM_M = np.array([0.0, 0.0, 0.0]) + FOREARM_TRANSLATION
EXPECTED_MAXIMUM_M = np.array([0.1, 0.2, 0.0]) + FOREARM_TRANSLATION


# ---------------------------------------------------------------------------

class RealSourceQualificationContractTest(unittest.TestCase):
    """Pure gates: geometry preparation and gate scoring, no Blender."""

    def test_box_mesh_is_closed_right_handed_and_inside_declared_bounds(self) -> None:
        vertices, faces = QUAL.closed_box_mesh((-1, -2, -3), (1, 2, 3))
        self.assertEqual(vertices.shape, (8, 3))
        self.assertEqual(faces.shape, (12, 3))
        self.assertEqual(
            SDF.closed_mesh_info(vertices, faces.astype(np.int64))["boundaryEdges"], 0)
        np.testing.assert_allclose(vertices.min(axis=0), (-1, -2, -3))
        np.testing.assert_allclose(vertices.max(axis=0), (1, 2, 3))

    def test_repeat_gate_requires_metadata_f32_and_r16f_equality(self) -> None:
        self.assertFalse(
            QUAL.score_repeat(run_a(), run_b_with_one_f32_changed())["passed"])
        good = QUAL.score_repeat(run_a(), exact_copy_of_run_a())
        self.assertTrue(good["passed"])
        self.assertTrue(good["metadataEqual"])
        self.assertTrue(good["f32Equal"])
        self.assertTrue(good["r16fEqual"])

    def test_report_rejects_empty_negative_region_boundary_touch_and_route_drift(self) -> None:
        for result, message in invalid_dense_results():
            with self.subTest(message=message), \
                    self.assertRaisesRegex(ValueError, message):
                QUAL.score_dense_gate(result, expected_route="direct-vdb")

    def test_dense_gate_records_and_can_require_component_count(self) -> None:
        gate = QUAL.score_dense_gate(dense_result(), expected_route="direct-vdb")
        self.assertEqual(gate["negativeComponents"], 1)
        self.assertTrue(gate["bothSigns"])
        self.assertTrue(gate["boundaryOutside"])
        self.assertEqual(gate["route"], "direct-vdb")
        with self.assertRaisesRegex(ValueError, "negative components"):
            QUAL.score_dense_gate(two_blob_result(), expected_route="direct-vdb",
                                  expect_components=1)
        self.assertEqual(
            QUAL.score_dense_gate(two_blob_result(),
                                  expected_route="direct-vdb")["negativeComponents"],
            2)

    def test_component_stats_separate_one_body_from_a_shattered_field(self) -> None:
        solid = QUAL.negative_component_stats(dense_result())
        self.assertEqual(solid["count"], 1)
        self.assertEqual(solid["largestComponentFraction"], 1.0)
        self.assertEqual(solid["singleVoxelComponents"], 0)
        specks = QUAL.negative_component_stats(two_blob_result())
        self.assertEqual(specks["count"], 2)
        self.assertEqual(specks["singleVoxelComponents"], 2)
        self.assertEqual(specks["negativeSamples"], 2)
        self.assertEqual(specks["largestComponentSizes"], [1, 1])

    def test_component_labeller_matches_the_reference_flood_fill(self) -> None:
        rng = np.random.default_rng(20260819)
        for _ in range(6):
            field = rng.normal(size=(7, 8, 9)).astype(np.float32)
            result = dense_result(
                dimensions=(9, 8, 7),
                bounds_min_m=(0.0, 0.0, 0.0), bounds_max_m=(0.08, 0.07, 0.06),
                voxel_size_m=(0.01, 0.01, 0.01), values_f32=field)
            self.assertEqual(QUAL.count_negative_components(result),
                             SDF.count_negative_components(result))

    def test_forearm_bounds_use_owned_faces_in_bind_local_metres(self) -> None:
        bounds = QUAL.partition_owned_bounds(
            tiny_source_soup(), tiny_partition_result(), "RightForeArm")
        np.testing.assert_allclose(bounds.minimum_m, EXPECTED_MINIMUM_M)
        np.testing.assert_allclose(bounds.maximum_m, EXPECTED_MAXIMUM_M)
        self.assertEqual(bounds.owned_face_count, 1)
        self.assertEqual(bounds.owned_vertex_count, 3)
        self.assertEqual(bounds.row, 0)
        self.assertEqual(bounds.basis, "owned-face-vertices")
        with self.assertRaisesRegex(ValueError, "no partition named"):
            QUAL.partition_owned_bounds(
                tiny_source_soup(), tiny_partition_result(), "LeftToe")

    def test_bind_bounds_come_from_the_validated_partition_coverage(self) -> None:
        partitions = tiny_partition_result()
        coverage = {"partitions": [
            {"name": "RightForeArm", "faces": 1592, "boundVertices": 938,
             "boundsLocalMin": [-0.1, -0.05, -0.09],
             "boundsLocalMax": [0.07, 0.27, 0.05]},
            {"name": "Other", "faces": 1, "boundVertices": 3,
             "boundsLocalMin": None, "boundsLocalMax": None},
        ]}
        with_coverage = dataclasses.replace(partitions, coverage=coverage)
        bounds = QUAL.partition_bind_bounds(with_coverage, "RightForeArm")
        np.testing.assert_allclose(bounds.minimum_m, (-0.1, -0.05, -0.09))
        np.testing.assert_allclose(bounds.maximum_m, (0.07, 0.27, 0.05))
        self.assertEqual(bounds.basis, "weight-bound-vertices")
        self.assertEqual(bounds.owned_face_count, 1592)
        with self.assertRaisesRegex(ValueError, "no recorded bind-local bounds"):
            QUAL.partition_bind_bounds(with_coverage, "Other")
        with self.assertRaisesRegex(ValueError, "no partition named"):
            QUAL.partition_bind_bounds(with_coverage, "LeftToe")

    def test_stray_owned_faces_counts_flood_fill_contamination(self) -> None:
        soup = tiny_source_soup()
        partitions = tiny_partition_result()
        tight = QUAL.OwnedBounds(
            name="RightForeArm", row=0, basis="weight-bound-vertices",
            minimum_m=EXPECTED_MINIMUM_M, maximum_m=EXPECTED_MAXIMUM_M,
            owned_face_count=1, owned_vertex_count=3,
            model_to_bind=tuple(tuple(float(v) for v in r)
                                for r in tiny_partition_result()
                                .partitions[0].model_to_bind),
            pitch_m=0.006)
        clean = QUAL.stray_owned_faces(soup, partitions, tight)
        self.assertEqual(clean["ownedFaces"], 1)
        self.assertEqual(clean["facesWhollyOutsideBindBounds"], 0)
        shrunk = dataclasses.replace(
            tight, minimum_m=EXPECTED_MINIMUM_M - 10.0,
            maximum_m=EXPECTED_MINIMUM_M - 9.0)
        self.assertEqual(
            QUAL.stray_owned_faces(soup, partitions, shrunk)
            ["facesWhollyOutsideBindBounds"], 1)

    def test_forearm_support_box_pads_owned_bounds_and_stops_at_the_midpoint(self) -> None:
        bounds = QUAL.partition_owned_bounds(
            tiny_source_soup(), tiny_partition_result(), "RightForeArm")
        box = QUAL.forearm_support_box(bounds)
        np.testing.assert_allclose(box.minimum_m[0], EXPECTED_MINIMUM_M[0] - 0.020)
        np.testing.assert_allclose(box.maximum_m[0], EXPECTED_MAXIMUM_M[0] + 0.020)
        np.testing.assert_allclose(box.minimum_m[1], EXPECTED_MINIMUM_M[1] - 0.020)
        np.testing.assert_allclose(
            box.maximum_m[1], 0.5 * (EXPECTED_MINIMUM_M[1] + EXPECTED_MAXIMUM_M[1]))
        self.assertTrue(all(b > a for a, b in zip(box.minimum_m, box.maximum_m)))

    def test_wrist_box_overlaps_the_soup_and_extends_proximally(self) -> None:
        rng = np.random.default_rng(7)
        vertices = rng.uniform(-0.03, 0.03, size=(64, 3))
        vertices[:, 1] = rng.uniform(0.10, 0.30, size=64)
        vertices[:8, 1] = 0.100                       # a flat wrist band
        box = QUAL.wrist_continuation_box(vertices)
        min_y = float(vertices[:, 1].min())
        np.testing.assert_allclose(box.minimum_m[1], min_y - 0.050)
        np.testing.assert_allclose(box.maximum_m[1], min_y + 0.010)
        self.assertGreaterEqual(box.band_vertex_count, 8)
        self.assertLess(box.minimum_m[0], float(vertices[:8, 0].min()))
        self.assertGreater(box.maximum_m[2], float(vertices[:8, 2].max()))

    def test_wrist_box_requires_a_real_band(self) -> None:
        with self.assertRaisesRegex(ValueError, "wrist band"):
            QUAL.wrist_continuation_box(
                np.array([[0.0, 0.0, 0.0], [0.0, 0.5, 0.0], [0.1, 0.6, 0.0]]))

    def test_padded_spec_is_pitch_exact_and_refuses_to_coarsen(self) -> None:
        spec = QUAL.padded_spec((-0.01, -0.02, -0.03), (0.05, 0.06, 0.07),
                                pitch_m=0.002, margin_voxels=6)
        for measured in spec.voxel_measured():
            self.assertAlmostEqual(measured, 0.002, places=12)
        self.assertTrue(all(lo <= -0.01 - 0.012 + 1e-12 for lo in spec.bounds_min_m))
        self.assertTrue(spec.bounds_max_m[0] >= 0.05 + 0.012 - 1e-12)
        SDF.validate_adapter_request(
            (SDF.canonicalize_mesh_array(SDF.MeshArrayInput(
                label="probe",
                vertices_m=QUAL.closed_box_mesh((0.0, 0.0, 0.0), (0.01, 0.01, 0.01))[0],
                triangles=QUAL.closed_box_mesh((0.0, 0.0, 0.0), (0.01, 0.01, 0.01))[1],
                source_sha256="ab" * 32)),), spec)
        with self.assertRaisesRegex(ValueError, "dimension cap"):
            QUAL.padded_spec((0.0, 0.0, 0.0), (1.0, 1.0, 1.0),
                             pitch_m=0.002, margin_voxels=6, dimension_cap=192)

    def test_report_requires_both_runs_exactly_once_in_order(self) -> None:
        hand = QUAL.QualificationRun(
            source="firm-grip-hand-union", passed=True,
            source_sha256="aa" * 32, operation_source_sha256="bb" * 32,
            f32_sha256="cc" * 32, r16f_sha256="dd" * 32,
            repeat=QUAL.RepeatGate(True, True, True),
            grid={}, gates={}, source_contract={}, timings={})
        humanoid = dataclasses.replace(
            hand, source="humanoid-right-forearm-intersection")
        report = QUAL.AdapterQualificationReport(
            schema_version=1, generated_at="2026-08-19T00:00:00Z",
            selected_route="direct-vdb", passed=True, runs=(hand, humanoid))
        payload = QUAL.report_to_json(report)
        self.assertEqual([r["source"] for r in payload["runs"]],
                         ["firm-grip-hand-union",
                          "humanoid-right-forearm-intersection"])
        self.assertEqual(payload["schemaVersion"], 1)
        self.assertEqual(payload["runs"][0]["repeat"]["f32Equal"], True)
        with self.assertRaisesRegex(ValueError, "exactly one"):
            QUAL.report_to_json(dataclasses.replace(report, runs=(humanoid, hand)))
        with self.assertRaisesRegex(ValueError, "exactly one"):
            QUAL.report_to_json(dataclasses.replace(report, runs=(hand, hand)))

    def test_report_is_written_atomically_and_canonically(self) -> None:
        payload = {"schemaVersion": 1, "b": 2, "a": [3, 1]}
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "adapter-qualification.json"
            QUAL.write_report_atomically(out, payload)
            text = out.read_text()
            self.assertTrue(text.endswith("\n"))
            self.assertEqual(json.loads(text), payload)
            self.assertLess(text.index('"a"'), text.index('"b"'))
            self.assertEqual(list(Path(tmp).iterdir()), [out])


if __name__ == "__main__":
    unittest.main(verbosity=2)
