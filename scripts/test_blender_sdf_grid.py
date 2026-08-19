# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
"""Tests for scripts/blender_sdf_grid.py — Blender 5.2 headless SDF qualification.

Task 1 of the Blender-native SDF grid authoring plan
(docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md,
design: docs/superpowers/specs/2026-08-18-blender-sdf-grid-authoring-design.md).

Blender-dependent tests launch `blender --background --factory-startup` once per
fixture (~2-4 s each); they are skipped when no `blender` is on PATH.

Run either way (PEP 723 deps are identical to the baker's):

    uv run python -m unittest scripts/test_blender_sdf_grid.py -v
    uv run scripts/test_blender_sdf_grid.py -v
"""

from __future__ import annotations

import dataclasses
import importlib.util
import json
import math
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
SDF_SCRIPT = SCRIPTS_DIR / "blender_sdf_grid.py"
HAND_SCRIPT = SCRIPTS_DIR / "bake_hand_sdf.py"

BLENDER_BIN = shutil.which("blender")
HAVE_IGL = False
try:
    import igl  # noqa: F401

    HAVE_IGL = True
except ImportError:
    pass


def load_module(path: Path, name: str):
    """Import a script file as a module under a fake module name."""
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


SDF = load_module(SDF_SCRIPT, "blender_sdf_grid_under_test")


# ---------------------------------------------------------------------------
# Analytic reference distances (pure Python, metre space)
# ---------------------------------------------------------------------------

def dist_cube(p: tuple[float, float, float], half: float = 0.05) -> float:
    q = max(abs(p[0]) - half, abs(p[1]) - half, abs(p[2]) - half)
    outside = math.sqrt(max(q, 0.0) ** 2 + 0.0)
    return q if q > 0.0 else q      # negative inside, positive outside


def dist_sphere(p: tuple[float, float, float], radius: float = 0.05) -> float:
    return math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2) - radius


def rotated(p: tuple[float, float, float], deg: float, axes: str = "zxy") -> tuple[float, float, float]:
    """Inverse-rotate a world point into the cube's local frame (right-handed)."""
    a = math.radians(deg)
    x, y, z = p
    for axis in axes:                    # apply per-axis inverse rotations
        if axis == "z":
            x, y = x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a)
        elif axis == "y":
            x, z = x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a)
        elif axis == "x":
            y, z = y * math.cos(a) + z * math.sin(a), -y * math.sin(a) + z * math.cos(a)
    return (x, y, z)


# ---------------------------------------------------------------------------
# Pure-contract tests (no Blender)
# ---------------------------------------------------------------------------

class ImportSafetyTest(unittest.TestCase):
    """Normal Python imports must never pull in bpy."""

    def test_module_imports_without_bpy(self) -> None:
        self.assertNotIn("bpy", sys.modules,
                         "scripts/blender_sdf_grid.py must not import bpy at module level")

    def test_public_interfaces_exist(self) -> None:
        for name in ("SdfGridSpec", "SdfGridRoute", "SdfGridRequest", "MeshInput",
                     "DenseSdfResult", "build_node_contract", "run_blender_sdf",
                     "run_analytic_fixture", "validate_dense_sdf",
                     "canonical_json", "blender_executable"):
            self.assertTrue(hasattr(SDF, name), f"missing public interface {name}")

    def test_request_result_dataclasses_are_frozen(self) -> None:
        for cls in (SDF.SdfGridSpec, SDF.SdfGridRequest, SDF.MeshInput, SDF.DenseSdfResult):
            self.assertTrue(dataclasses.is_dataclass(cls))
            with self.assertRaises(Exception):
                cls().__setattr__("voxel_size_m", 0.02)  # type: ignore[attr-defined]

    def test_routes_are_pinned_strings(self) -> None:
        self.assertEqual(SDF.SdfGridRoute.DIRECT_VDB, "direct-vdb")
        self.assertEqual(SDF.SdfGridRoute.GRID_TO_MESH_LIBIGL, "grid-to-mesh-libigl")
        allowed = {SDF.SdfGridRoute.DIRECT_VDB, SDF.SdfGridRoute.GRID_TO_MESH_LIBIGL}
        self.assertIn(SDF.SdfGridRoute.selected_default(), allowed)


class NodeContractTest(unittest.TestCase):
    """The canonical node contract must never rely on node/UI defaults."""

    def test_contract_never_relies_on_node_defaults(self) -> None:
        contract = SDF.build_node_contract(SDF.SdfGridSpec.analytic_default())
        for key in ("voxelSizeM", "bandWidth", "backgroundM",
                    "threshold", "adaptivity", "indexToMetres"):
            self.assertIn(key, contract)

    def test_contract_pins_every_declared_value(self) -> None:
        spec = SDF.SdfGridSpec.analytic_default()
        contract = SDF.build_node_contract(spec)
        self.assertEqual(contract["voxelSizeM"], spec.voxel_size_m)
        self.assertEqual(contract["bandWidth"], spec.band_width)
        self.assertEqual(contract["threshold"], 0.0)
        self.assertEqual(contract["adaptivity"], 0.0)
        self.assertEqual(contract["backgroundM"], spec.band_width * spec.voxel_size_m)
        i2m = contract["indexToMetres"]
        self.assertEqual(i2m["voxelSizeM"], [spec.voxel_size_m] * 3)
        self.assertEqual(i2m["originM"], list(spec.bounds_min_m))
        self.assertEqual(i2m["basis"], "right-handed-y-up-blender")

    def test_canonical_json_is_stable_and_sorted(self) -> None:
        spec = SDF.SdfGridSpec.analytic_default()
        a = SDF.canonical_json(SDF.build_node_contract(spec))
        b = SDF.canonical_json(SDF.build_node_contract(
            dataclasses.replace(spec, dimensions=spec.dimensions)))
        self.assertEqual(a, b)
        self.assertEqual(json.loads(a), SDF.build_node_contract(spec))
        self.assertIn('"adaptivity":0.0', a)


class ValidateDenseSdfTest(unittest.TestCase):
    """validate_dense_sdf rejects anything that breaks the metre-space contract."""

    def _good(self, **over):
        spec = SDF.SdfGridSpec.analytic_default()
        x = np.linspace(spec.bounds_min_m[0], spec.bounds_max_m[0], spec.dimensions[0])
        y = np.linspace(spec.bounds_min_m[1], spec.bounds_max_m[1], spec.dimensions[1])
        z = np.linspace(spec.bounds_min_m[2], spec.bounds_max_m[2], spec.dimensions[2])
        zz, yy, xx = np.meshgrid(z, y, x, indexing="ij")
        pts = np.column_stack((xx.ravel(), yy.ravel(), zz.ravel()))
        vals = np.array([dist_cube(tuple(p)) for p in pts], dtype=np.float32)
        vals = vals.reshape(spec.dimensions[2], spec.dimensions[1], spec.dimensions[0])
        base = dict(
            route=SDF.SdfGridRoute.DIRECT_VDB,
            dimensions=spec.dimensions,
            bounds_min_m=spec.bounds_min_m,
            bounds_max_m=spec.bounds_max_m,
            voxel_size_m=tuple((b - a) / (n - 1) for a, b, n in
                               zip(spec.bounds_min_m, spec.bounds_max_m, spec.dimensions)),
            values_f32=vals,
            source_sha256="0" * 64,
            node_contract_sha256="1" * 64,
        )
        base.update(over)
        return SDF.DenseSdfResult(**base)

    def test_valid_analytic_result_passes(self) -> None:
        SDF.validate_dense_sdf(self._good())

    def test_rejects_unknown_route(self) -> None:
        with self.assertRaises(ValueError):
            SDF.validate_dense_sdf(self._good(route="mystery"))

    def test_rejects_nonfinite(self) -> None:
        v = self._good().values_f32.copy()
        v[0, 0, 0] = np.nan
        with self.assertRaises(ValueError):
            SDF.validate_dense_sdf(self._good(values_f32=v))

    def test_rejects_unsigned_field(self) -> None:
        with self.assertRaises(ValueError):
            SDF.validate_dense_sdf(self._good(values_f32=np.abs(self._good().values_f32)))

    def test_rejects_negative_boundary(self) -> None:
        v = self._good().values_f32.copy()
        v[0, 0, 0] = -0.001
        with self.assertRaises(ValueError):
            SDF.validate_dense_sdf(self._good(values_f32=v))

    def test_rejects_voxel_bounds_dims_mismatch(self) -> None:
        with self.assertRaises(ValueError):
            SDF.validate_dense_sdf(self._good(voxel_size_m=(0.02, 0.01, 0.01)))

    def test_rejects_missing_hashes(self) -> None:
        with self.assertRaises(ValueError):
            SDF.validate_dense_sdf(self._good(source_sha256="nothex!"))

    def test_sample_round_trips_index_to_metres(self) -> None:
        res = self._good()
        spec = SDF.SdfGridSpec.analytic_default()
        self.assertAlmostEqual(res.sample((0.0, 0.0, 0.0)), -0.05, delta=0.006)
        self.assertAlmostEqual(res.sample((0.11, 0.0, 0.0)), 0.06, delta=0.006)
        # index -> metre -> index round trip through the pinned transform
        for idx in ((0, 0, 0), (6, 6, 6), (12, 0, 9)):
            p = res.index_to_metres(idx)
            back = res.metres_to_index(p)
            self.assertEqual(tuple(back), idx)


# ---------------------------------------------------------------------------
# Blender qualification gates (skipped without a blender binary)
# ---------------------------------------------------------------------------

@unittest.skipIf(BLENDER_BIN is None, "no blender on PATH")
class BlenderCapabilityTest(unittest.TestCase):
    def test_probe_reports_blender_52_and_all_required_nodes(self) -> None:
        caps = SDF.probe_capabilities()
        self.assertTrue(caps["blenderFound"])
        ver = caps["blenderVersion"]
        self.assertTrue(ver.startswith("5.2."), f"Blender 5.2.x required, got {ver}")
        nodes = caps["nodes"]
        for name in ("GeometryNodeMeshToSDFGrid", "GeometryNodeSDFGridBoolean",
                     "GeometryNodeGridToMesh", "GeometryNodeStoreNamedGrid"):
            self.assertTrue(nodes.get(name), f"{name} not registered")


@unittest.skipIf(BLENDER_BIN is None, "no blender on PATH")
class AnalyticGridContractTest(unittest.TestCase):
    """The plan's Step 1 analytic gate (runs real Blender bakes)."""

    def test_cube_has_metre_space_sign_and_surface(self) -> None:
        result = SDF.run_analytic_fixture("cube", voxel_size_m=0.01)
        SDF.validate_dense_sdf(result)
        self.assertLess(result.sample((0.0, 0.0, 0.0)), -0.049)
        self.assertGreater(result.sample((0.11, 0.0, 0.0)), 0.009)
        self.assertLess(abs(result.sample((0.05, 0.0, 0.0))), 0.011)

    def test_sphere_has_metre_space_sign_and_radius(self) -> None:
        result = SDF.run_analytic_fixture("sphere", voxel_size_m=0.01)
        SDF.validate_dense_sdf(result)
        self.assertLess(result.sample((0.0, 0.0, 0.0)), -0.049)
        self.assertGreater(result.sample((0.0, 0.06, 0.0)), 0.004)
        self.assertLess(abs(result.sample((0.0, 0.05, 0.0))), 0.011)


@unittest.skipIf(BLENDER_BIN is None or not HAVE_IGL,
                 "no blender/libigl available")
class RouteGatesTest(unittest.TestCase):
    """Both result routes must satisfy the DenseSdfResult contract."""

    def test_route_a_direct_vdb_reports_topology_and_deep_interior(self) -> None:
        diagnostics: dict = {}
        result = SDF.run_analytic_fixture("cube", voxel_size_m=0.01,
                                          route=SDF.SdfGridRoute.DIRECT_VDB,
                                          diagnostics=diagnostics)
        self.assertEqual(result.route, "direct-vdb")
        SDF.validate_dense_sdf(result)
        grid = diagnostics["routeA"]["vdb"]
        self.assertEqual(grid["gridClass"], "level set")
        self.assertEqual(grid["gridName"], "sdf")
        self.assertAlmostEqual(max(grid["voxelSizeM"]), 0.01, delta=1e-6)
        self.assertGreater(grid["backgroundM"], 0.0)
        # Deep-interior probe: must read NEGATIVE; with the analytic band
        # covering the whole cube it may be an active true value.
        self.assertLess(grid["deepInteriorProbeM"], -0.029)
        self.assertGreater(grid["activeVoxelCount"], 0)

    def test_capability_probe_proves_inactive_signed_interior_tiles(self) -> None:
        """0.2 m cube, band 6 cm: deep interior is an INACTIVE signed tile.

        This is the exact failure mode the design forbids: an active-voxel-only
        reader would return the POSITIVE background deep inside the body.
        """
        caps = SDF.probe_capabilities()
        vdb = caps["routeA"]["vdb"]
        self.assertTrue(caps["routeA"]["supported"])
        self.assertAlmostEqual(vdb["backgroundM"], 0.06, delta=1e-4)
        self.assertLess(vdb["deepInteriorProbeM"], -0.059)
        self.assertTrue(vdb["interiorProbeInactive"],
                        "0.2 m cube center must be an inactive interior tile")
        self.assertFalse(vdb["deepInteriorProbeM"] > 0.0)

    def test_capability_probe_captures_broken_boolean_evidence(self) -> None:
        """The SDF Grid Boolean bug must be captured, never silently worked around."""
        caps = SDF.probe_capabilities()
        ev = caps["sdfGridBoolean"]
        self.assertTrue(ev["grid1Ignored"],
                        f"boolean union unexpectedly works now: {ev}")
        self.assertLess(ev["measuredValuesM"][1], -0.02)   # grid 2 present
        self.assertGreater(ev["measuredValuesM"][0], 0.0)  # grid 1 missing
        self.assertIn("verdict", ev)

    def test_route_b_grid_to_mesh_is_closed_and_libigl_signed(self) -> None:
        diagnostics: dict = {}
        result = SDF.run_analytic_fixture("cube", voxel_size_m=0.01,
                                          route=SDF.SdfGridRoute.GRID_TO_MESH_LIBIGL,
                                          diagnostics=diagnostics)
        self.assertEqual(result.route, "grid-to-mesh-libigl")
        SDF.validate_dense_sdf(result)
        rb = diagnostics["routeB"]
        self.assertTrue(rb["closed"], "Grid to Mesh output must be one closed component")
        self.assertEqual(rb["boundaryEdges"], 0)
        self.assertEqual(rb["components"], 1)
        self.assertGreater(rb["triangles"], 0)
        self.assertLess(result.sample((0.0, 0.0, 0.0)), -0.049)
        self.assertGreater(result.sample((0.11, 0.0, 0.0)), 0.009)

    def test_mesh_round_trip_uses_existing_winding_number_path(self) -> None:
        """The Route B resampler must be the existing libigl unsigned+FWN pair."""
        self.assertTrue(callable(SDF._libigl_signed_distance_chunk))
        v, f = SDF._hand_reference_cube_mesh()
        d = SDF._libigl_signed_distance_chunk(
            np.array([[0.0, 0.0, 0.0], [1.25, 0.0, 0.0]], dtype=np.float64), v, f)
        self.assertLess(d[0], 0.0)
        self.assertGreater(d[1], 0.0)


@unittest.skipIf(BLENDER_BIN is None, "no blender on PATH")
class BooleanTransformGatesTest(unittest.TestCase):
    """Union, intersection, rotation and translation must keep metre-space truth."""

    ROUTES = (SDF.SdfGridRoute.DIRECT_VDB, SDF.SdfGridRoute.GRID_TO_MESH_LIBIGL)

    def _run(self, shape: str, route: str):
        return SDF.run_analytic_fixture(shape, voxel_size_m=0.01, route=route)

    def test_union_of_overlapping_pair_is_one_component(self) -> None:
        for route in self.ROUTES:
            with self.subTest(route=route):
                res = self._run("union-pair", route)
                SDF.validate_dense_sdf(res)
                self.assertLess(res.sample((0.0, 0.0, 0.0)), -0.02)
                self.assertLess(res.sample((0.03, 0.0, 0.0)), -0.02)  # overlap region
                self.assertGreater(res.sample((0.0, 0.0, 0.10)), 0.004)
                comp = SDF.count_negative_components(res)
                self.assertEqual(comp, 1, f"union must be one component ({route})")

    def test_intersection_clips_body_by_support(self) -> None:
        for route in self.ROUTES:
            with self.subTest(route=route):
                res = self._run("body-support-intersect", route)
                SDF.validate_dense_sdf(res)
                # inside both body and support -> negative
                self.assertLess(res.sample((0.0, 0.0, 0.0)), -0.004)
                # inside the body but outside the support -> positive
                self.assertGreater(res.sample((0.0, 0.0, 0.045)), 0.004)
                comp = SDF.count_negative_components(res)
                self.assertEqual(comp, 1)

    def test_rotated_input_matches_rotated_analytic(self) -> None:
        # The rotated AABB anchors the level-set lattice OFF our sample phase,
        # so the honest bound is the trilinear resample error: 1.5x pitch.
        for route in self.ROUTES:
            with self.subTest(route=route):
                res = self._run("rotated-cube", route)
                SDF.validate_dense_sdf(res)
                self.assertLess(res.sample((0.0, 0.0, 0.0)), -0.02)
                worst = 0.0
                for p in ((0.06, 0.0, 0.0), (0.0, 0.06, 0.0), (0.04, 0.04, 0.0),
                          (0.0, 0.0, 0.055), (0.03, -0.03, 0.03)):
                    got = res.sample(p)
                    want = dist_cube(rotated(p, 30.0))
                    worst = max(worst, abs(got - want))
                self.assertLessEqual(worst, 0.0151,
                                     f"rotated surface error {worst:.4f} m ({route})")

    def test_translated_input_matches_shifted_analytic(self) -> None:
        for route in self.ROUTES:
            with self.subTest(route=route):
                res = self._run("translated-cube", route)
                SDF.validate_dense_sdf(res)
                off = (0.02, -0.01, 0.03)
                self.assertLess(res.sample(off), -0.02)
                # outside the translated cube (y max is 0.04) but on-lattice
                self.assertGreater(res.sample((0.0, 0.06, 0.0)), 0.004)
                worst = 0.0
                for p in ((0.0, 0.0, 0.0), (0.07, 0.0, 0.0), (0.0, 0.03, 0.0)):
                    got = res.sample(p)
                    want = dist_cube((p[0] - off[0], p[1] - off[1], p[2] - off[2]))
                    worst = max(worst, abs(got - want))
                self.assertLessEqual(worst, 0.0151,
                                     f"translated surface error {worst:.4f} m ({route})")


@unittest.skipIf(BLENDER_BIN is None, "no blender on PATH")
class DeterminismTest(unittest.TestCase):
    def test_repeated_run_is_byte_identical(self) -> None:
        route = SDF.SdfGridRoute.selected_default()
        a = SDF.run_analytic_fixture("cube", voxel_size_m=0.01, route=route)
        b = SDF.run_analytic_fixture("cube", voxel_size_m=0.01, route=route)
        self.assertEqual(a.route, b.route)
        self.assertEqual(a.dimensions, b.dimensions)
        self.assertEqual(a.source_sha256, b.source_sha256)
        self.assertEqual(a.node_contract_sha256, b.node_contract_sha256)
        self.assertEqual(SDF.canonical_json(SDF.result_metrics(a)),
                         SDF.canonical_json(SDF.result_metrics(b)))
        self.assertEqual(SDF.encode_r16f_bytes(a), SDF.encode_r16f_bytes(b))
        self.assertTrue(np.array_equal(a.values_f32, b.values_f32))


# ===========================================================================
# Task 1 (adapters continuation): public array-mesh + canonical payload
# ===========================================================================

def tetrahedron_arrays() -> tuple[np.ndarray, np.ndarray]:
    """Small closed, outward-wound tetrahedron: pure, instant, deterministic."""
    vertices = np.array([
        [0.00, 0.00, 0.00],
        [0.04, 0.00, 0.00],
        [0.00, 0.04, 0.00],
        [0.00, 0.00, 0.04],
    ], dtype=np.float64)
    triangles = np.array([
        [0, 2, 1],
        [0, 1, 3],
        [0, 3, 2],
        [1, 2, 3],
    ], dtype=np.int64)
    return vertices, triangles


TETRA_SOURCE_SHA = "ab" * 32


def canonical_tetra_input():
    vertices, triangles = tetrahedron_arrays()
    return SDF.MeshArrayInput(
        label="tetra",
        vertices_m=vertices,
        triangles=triangles,
        source_sha256=TETRA_SOURCE_SHA,
        source_to_grid_m=SDF.IDENTITY_4X4,
    )


def rot_z_4x4(degrees: float, translation=(0.0, 0.0, 0.0)):
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    return (
        (c, -s, 0.0, float(translation[0])),
        (s, c, 0.0, float(translation[1])),
        (0.0, 0.0, 1.0, float(translation[2])),
        (0.0, 0.0, 0.0, 1.0),
    )


def payload_hash_with_one_vertex_changed(base):
    vertices = base.vertices_m.copy()
    vertices[2, 1] += 1e-4
    changed = dataclasses.replace(base, vertices_m=vertices)
    return SDF.mesh_payload_hash(SDF.canonicalize_mesh_array(changed))


def payload_hash_with_source_hash_changed(base):
    changed = dataclasses.replace(base, source_sha256="cd" * 32)
    return SDF.mesh_payload_hash(SDF.canonicalize_mesh_array(changed))


def payload_hash_with_translation_changed(base):
    changed = dataclasses.replace(
        base, source_to_grid_m=rot_z_4x4(0.0, (0.0, 0.001, 0.0)))
    return SDF.mesh_payload_hash(SDF.canonicalize_mesh_array(changed))


def invalid_mesh_cases() -> list[tuple[object, str]]:
    """(MeshArrayInput, expected ValueError regex) for every rejection gate."""
    vertices, triangles = tetrahedron_arrays()

    def mesh(**over):
        return dataclasses.replace(canonical_tetra_input(), **over)

    non_finite = vertices.copy()
    non_finite[1, 0] = math.nan
    infinite = vertices.copy()
    infinite[3, 2] = math.inf

    cases: list[tuple[object, str]] = [
        (mesh(vertices_m=vertices[:, :2]), "vertices.*shape"),
        (mesh(vertices_m=vertices.ravel()), "vertices.*shape"),
        (mesh(triangles=triangles[:, :2]), "triangles.*shape"),
        (mesh(vertices_m=np.zeros((0, 3))), "vertices.*empty"),
        (mesh(triangles=np.zeros((0, 3), dtype=np.int64)), "triangles.*empty"),
        (mesh(vertices_m=non_finite), "vertices.*non-finite"),
        (mesh(vertices_m=infinite), "vertices.*non-finite"),
        (mesh(triangles=triangles - 1), "triangle indices out of range"),
        (mesh(triangles=triangles + 1), "triangle indices out of range"),
        (mesh(triangles=np.array([[0, 1, 1], [0, 1, 2], [0, 2, 3], [1, 2, 3]])),
         "degenerate triangle"),
        (mesh(source_sha256="AB" * 32), "not a lowercase hex sha256"),
        (mesh(source_sha256="ab" * 31), "not a lowercase hex sha256"),
        (mesh(label="   "), "label.*empty"),
        (mesh(source_to_grid_m=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0))),
         "transform.*4x4"),
        (mesh(source_to_grid_m=(
            (1.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, math.nan), (0.0, 0.0, 0.0, 1.0))),
         "transform.*non-finite"),
        (mesh(source_to_grid_m=(
            (1.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.1, 1.0))),
         "transform final row"),
        # reflection: det(R) = -1
        (mesh(source_to_grid_m=(
            (-1.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0))),
         "not a proper rigid rotation"),
        # anisotropic scale
        (mesh(source_to_grid_m=(
            (2.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0))),
         "not a proper rigid rotation"),
        # uniform scale
        (mesh(source_to_grid_m=(
            (2.0, 0.0, 0.0, 0.0), (0.0, 2.0, 0.0, 0.0),
            (0.0, 0.0, 2.0, 0.0), (0.0, 0.0, 0.0, 1.0))),
         "not a proper rigid rotation"),
        # shear
        (mesh(source_to_grid_m=(
            (1.0, 0.3, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0))),
         "not a proper rigid rotation"),
        # non-orthonormal "rotation" (columns not unit length)
        (mesh(source_to_grid_m=(
            (0.9, -0.5, 0.0, 0.0), (0.5, 0.9, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0))),
         "not a proper rigid rotation"),
    ]

    over_v = np.zeros((SDF.MAX_VERTICES_PER_MESH + 1, 3), dtype=np.float64)
    cases.append((mesh(vertices_m=over_v), "vertex count"))
    over_f = np.zeros((SDF.MAX_TRIANGLES_PER_MESH + 1, 3), dtype=np.int64)
    cases.append((mesh(triangles=over_f), "triangle count"))
    return cases


class MeshArrayContractTest(unittest.TestCase):
    """Pure, Blender-free gates on the public array-mesh adapter contract."""

    def test_canonical_copy_is_little_endian_owned_and_does_not_mutate_input(self) -> None:
        vertices, triangles = tetrahedron_arrays()
        original_v = vertices.copy()
        original_f = triangles.copy()
        padded = np.zeros((len(vertices), 4), dtype=np.float64)
        padded[:, :3] = vertices
        view = padded[:, :3]                        # genuinely non-contiguous
        self.assertFalse(view.flags.c_contiguous)
        mesh = SDF.MeshArrayInput(
            label="  tetra  ",
            vertices_m=view,
            triangles=triangles.astype(">i8"),
            source_sha256=TETRA_SOURCE_SHA,
            source_to_grid_m=SDF.IDENTITY_4X4,
        )
        canonical = SDF.canonicalize_mesh_array(mesh)
        self.assertEqual(canonical.vertices_m.dtype.str, "<f8")
        self.assertEqual(canonical.triangles.dtype.str, "<u4")
        self.assertTrue(canonical.vertices_m.flags.c_contiguous)
        self.assertTrue(canonical.vertices_m.flags.owndata)
        self.assertTrue(canonical.triangles.flags.c_contiguous)
        self.assertTrue(canonical.triangles.flags.owndata)
        self.assertEqual(canonical.label, "tetra")
        self.assertIsInstance(canonical.source_to_grid_m, tuple)
        self.assertIsInstance(canonical.source_to_grid_m[0], tuple)
        np.testing.assert_array_equal(canonical.vertices_m, vertices)
        np.testing.assert_array_equal(canonical.triangles, triangles)
        np.testing.assert_array_equal(vertices, original_v)
        np.testing.assert_array_equal(triangles, original_f)

    def test_canonicalize_is_idempotent(self) -> None:
        once = SDF.canonicalize_mesh_array(canonical_tetra_input())
        twice = SDF.canonicalize_mesh_array(once)
        self.assertEqual(SDF.mesh_payload_hash(once), SDF.mesh_payload_hash(twice))

    def test_payload_hash_is_stable_but_covers_geometry_source_and_transform(self) -> None:
        base = canonical_tetra_input()
        h0 = SDF.mesh_payload_hash(SDF.canonicalize_mesh_array(base))
        h1 = SDF.mesh_payload_hash(SDF.canonicalize_mesh_array(base))
        self.assertEqual(h0, h1)
        self.assertEqual(len(h0), 64)
        self.assertNotEqual(h0, payload_hash_with_one_vertex_changed(base))
        self.assertNotEqual(h0, payload_hash_with_source_hash_changed(base))
        self.assertNotEqual(h0, payload_hash_with_translation_changed(base))

    def test_payload_hash_covers_face_order_and_label(self) -> None:
        base = SDF.canonicalize_mesh_array(canonical_tetra_input())
        h0 = SDF.mesh_payload_hash(base)
        permuted = dataclasses.replace(base, triangles=base.triangles[::-1].copy())
        self.assertNotEqual(h0, SDF.mesh_payload_hash(permuted))
        relabelled = dataclasses.replace(base, label="tetra-2")
        self.assertNotEqual(h0, SDF.mesh_payload_hash(relabelled))

    def test_rejects_invalid_geometry_and_transforms_before_blender(self) -> None:
        for mesh, message in invalid_mesh_cases():
            with self.subTest(message=message), \
                    self.assertRaisesRegex(ValueError, message):
                SDF.canonicalize_mesh_array(mesh)

    def test_accepts_proper_rigid_rotation_and_translation(self) -> None:
        mesh = dataclasses.replace(
            canonical_tetra_input(),
            source_to_grid_m=rot_z_4x4(30.0, (0.01, -0.02, 0.03)))
        canonical = SDF.canonicalize_mesh_array(mesh)
        self.assertAlmostEqual(canonical.source_to_grid_m[0][3], 0.01)

    def test_resource_limits_are_checked_without_launching_blender(self) -> None:
        spec = SDF.fixture_spec("cube")
        tetra = canonical_tetra_input()
        with self.assertRaisesRegex(ValueError, "dense voxel count"):
            SDF.validate_adapter_request(
                (tetra,),
                dataclasses.replace(
                    spec, dimensions=(257, 257, 257),
                    bounds_min_m=(0.0, 0.0, 0.0),
                    bounds_max_m=(2.56, 2.56, 2.56)))
        with self.assertRaisesRegex(ValueError, "mesh count"):
            SDF.validate_adapter_request((), spec)
        with self.assertRaisesRegex(ValueError, "mesh count"):
            SDF.validate_adapter_request(
                tuple(tetra for _ in range(SDF.MAX_MESHES + 1)), spec)
        with self.assertRaisesRegex(ValueError, "voxel size"):
            SDF.validate_adapter_request(
                (tetra,), dataclasses.replace(spec, voxel_size_m=0.05))
        with self.assertRaisesRegex(ValueError, "dimensions"):
            SDF.validate_adapter_request(
                (tetra,), dataclasses.replace(spec, dimensions=(1, 25, 25)))
        with self.assertRaisesRegex(ValueError, "bounds"):
            SDF.validate_adapter_request(
                (tetra,), dataclasses.replace(spec, bounds_max_m=(-1.0, 0.12, 0.12)))
        ok = SDF.validate_adapter_request((tetra,), spec)
        self.assertEqual(len(ok), 1)
        self.assertEqual(ok[0].vertices_m.dtype.str, "<f8")

    def test_payload_files_are_written_and_verified_deterministically(self) -> None:
        meshes = SDF.validate_adapter_request(
            (canonical_tetra_input(),
             dataclasses.replace(canonical_tetra_input(), label="tetra-b")),
            SDF.fixture_spec("cube"))
        with tempfile.TemporaryDirectory() as tmp_a, \
                tempfile.TemporaryDirectory() as tmp_b:
            first = SDF.write_mesh_payloads(Path(tmp_a), meshes)
            second = SDF.write_mesh_payloads(Path(tmp_b), meshes)
            self.assertEqual(len(first), 2)
            self.assertEqual([d.vertices_file for d in first],
                             ["mesh-000.vertices.f64le", "mesh-001.vertices.f64le"])
            self.assertEqual([d.triangles_file for d in first],
                             ["mesh-000.triangles.u32le", "mesh-001.triangles.u32le"])
            self.assertEqual([SDF.descriptor_to_json(d) for d in first],
                             [SDF.descriptor_to_json(d) for d in second])
            for d in first:
                blob = Path(tmp_a, d.vertices_file).read_bytes()
                self.assertEqual(len(blob), 8 * 3 * d.vertex_count)
                self.assertEqual(SDF.sha256_bytes(blob), d.vertices_sha256)
                faces = Path(tmp_a, d.triangles_file).read_bytes()
                self.assertEqual(len(faces), 4 * 3 * d.triangle_count)
                self.assertEqual(SDF.sha256_bytes(faces), d.triangles_sha256)
                self.assertEqual(SDF.descriptor_to_json(d)["kind"], "array-payload")

    def test_payload_writer_rejects_path_separators_in_labels(self) -> None:
        for bad in ("../escape", "a/b", "a\\b"):
            mesh = dataclasses.replace(canonical_tetra_input(), label=bad)
            with self.subTest(label=bad), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaisesRegex(ValueError, "label"):
                    SDF.write_mesh_payloads(
                        Path(tmp), (SDF.canonicalize_mesh_array(mesh),))


if __name__ == "__main__":
    unittest.main(verbosity=2)
