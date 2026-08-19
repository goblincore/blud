# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2", "Pillow"]
# ///
"""Tests for scripts/bake_humanoid_sdf.py (humanoid SDF sever spike, Task 1).

Task 1 of docs/superpowers/plans/2026-08-17-humanoid-sdf-sever-spike.md.
Covers the canonical-owner-asset export contract and the weight-derived
planar partition math. Blender-only behaviour (the --blender-export stage) is
exercised through the plain-Python `inspect_source` wrapper, which launches
`blender --background` on the same file.

Run (PEP 723 deps mirror the baker plus Pillow for image assertions):

    uv run scripts/test_bake_humanoid_sdf.py -v
"""

import dataclasses
import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
BAKE_SCRIPT = SCRIPTS_DIR / "bake_humanoid_sdf.py"


def load_module(path: Path, name: str):
    """Import a script file as a module under a fake name (test_bake_hand_sdf
    pattern): the baker must define its helpers at import time and only run
    CLI stages when executed as __main__."""
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


BAKE = load_module(BAKE_SCRIPT, "bake_humanoid_sdf_under_test")


# ===========================================================================
# Module contract: constants and frozen dataclass shapes (plan Task 1 Step 4)
# ===========================================================================

class ModuleContractTest(unittest.TestCase):
    def test_constants_match_the_approved_spike_budgets(self) -> None:
        self.assertEqual(BAKE.ELBOW_OVERLAP_M, 0.030)
        self.assertEqual(BAKE.LIMB_PITCH_M, 0.006)
        self.assertEqual(BAKE.DETAIL_PITCH_M, 0.003)
        self.assertEqual(BAKE.MARGIN_M, 0.012)
        self.assertTrue(BAKE.SOURCE_GLB.exists(),
                        f"canonical source missing: {BAKE.SOURCE_GLB}")

    def test_source_info_fields_frozen(self) -> None:
        self.assertEqual(
            [f.name for f in dataclasses.fields(BAKE.SourceInfo)],
            ["vertex_count", "triangle_count", "joint_count", "bone_names",
             "texture_size", "source_sha256", "texture_sha256"])
        with self.assertRaises(dataclasses.FrozenInstanceError):
            BAKE.SourceInfo(0, 0, 0, (), (0, 0), "a", "b").vertex_count = 1  # type: ignore[misc]

    def test_source_soup_fields_frozen(self) -> None:
        self.assertEqual(
            [f.name for f in dataclasses.fields(BAKE.SourceSoup)],
            ["vertices", "faces", "face_uvs", "joints", "weights", "bone_names",
             "parents", "inverse_bind", "albedo_rgba", "base_color_factor",
             "texture_transform"])

    def test_joint_band_fields_frozen(self) -> None:
        self.assertEqual(
            [f.name for f in dataclasses.fields(BAKE.JointBand)],
            ["parent", "child", "center", "axis", "width_m"])

    def test_bone_partition_fields_frozen(self) -> None:
        self.assertEqual(
            [f.name for f in dataclasses.fields(BAKE.BonePartition)],
            ["name", "joint_index", "parent_index", "bind_to_model",
             "model_to_bind", "support_planes", "pitch_m"])

    def test_import_never_reaches_bpy(self) -> None:
        # Importing under uv (no bpy on path) succeeded by construction; also
        # prove the module did not keep a module-level bpy reference around.
        self.assertIsNone(sys.modules.get("bpy"))
        self.assertFalse(hasattr(BAKE, "bpy"))


# ===========================================================================
# Real owner asset (launches Blender through inspect_source)
# ===========================================================================

class SourceContractTest(unittest.TestCase):
    def test_real_owner_glb_has_required_rig_texture_and_topology(self) -> None:
        info = BAKE.inspect_source(BAKE.SOURCE_GLB)
        self.assertEqual(info.vertex_count, 62166)
        self.assertEqual(info.triangle_count, 98003)
        self.assertEqual(info.joint_count, 24)
        self.assertEqual(info.texture_size, (2048, 2048))
        self.assertIn("RightArm", info.bone_names)
        self.assertIn("RightForeArm", info.bone_names)
        self.assertIn("RightHand", info.bone_names)
        self.assertEqual(
            info.source_sha256,
            "2b23530a64466ca650ead74e49feaf54b6463c254ecccc9b3d56ba993a33cd28")
        self.assertNotEqual(info.texture_sha256, info.source_sha256)


# ===========================================================================
# Pure partition math (fixtures encode their own weights; no impl calls)
# ===========================================================================

class PartitionContractTest(unittest.TestCase):
    def test_right_elbow_uses_one_30mm_planar_overlap(self) -> None:
        points = np.array([
            [-0.040, 0.0, 0.0], [-0.012, 0.0, 0.0],
            [ 0.000, 0.0, 0.0], [ 0.012, 0.0, 0.0],
            [ 0.040, 0.0, 0.0],
        ])
        parent_w = np.array([0.95, 0.62, 0.50, 0.38, 0.05])
        child_w = 1.0 - parent_w
        band = BAKE.derive_joint_band(
            "RightArm", "RightForeArm", points, parent_w, child_w,
            axis=np.array([1.0, 0.0, 0.0]), width_m=0.030,
        )
        self.assertAlmostEqual(band.width_m, 0.030, places=9)
        self.assertAlmostEqual(np.linalg.norm(band.axis), 1.0, places=9)
        np.testing.assert_allclose(band.center, np.zeros(3), atol=1e-9)

    def test_halfspace_support_has_only_the_declared_overlap(self) -> None:
        parent, child = BAKE.joint_halfspaces(
            center=np.zeros(3), axis=np.array([1.0, 0.0, 0.0]), width_m=0.030)
        self.assertTrue(BAKE.inside_support(np.array([ 0.014, 0, 0]), parent))
        self.assertTrue(BAKE.inside_support(np.array([-0.014, 0, 0]), child))
        self.assertFalse(BAKE.inside_support(np.array([ 0.050, 0, 0]), parent))
        self.assertFalse(BAKE.inside_support(np.array([-0.050, 0, 0]), child))

    def test_joint_halfspaces_move_with_the_boundary_centre(self) -> None:
        # Same 30 mm band, but the boundary sits off-origin: the plane offsets
        # must follow the centre rather than pinning to the axis-through-origin.
        centre = np.array([0.31, -0.12, 0.07])
        axis = np.array([0.0, 1.0, 0.0])
        parent, child = BAKE.joint_halfspaces(center=centre, axis=axis, width_m=0.030)
        # 16 mm past the centre on the child side: still inside parent support.
        q_in = centre + axis * 0.016
        q_out = centre + axis * 0.020
        self.assertFalse(BAKE.inside_support(q_in, parent))
        self.assertFalse(BAKE.inside_support(q_out, parent))
        # 16 mm before the centre (parent territory): inside parent, outside child.
        q_back = centre - axis * 0.016
        self.assertTrue(BAKE.inside_support(q_back, parent))
        self.assertFalse(BAKE.inside_support(q_back, child))
        # Child keeps everything distal up to 15 mm into parent territory.
        self.assertTrue(BAKE.inside_support(centre - axis * 0.014, child))
        self.assertFalse(BAKE.inside_support(centre - axis * 0.016, child))

    def test_derive_joint_band_selects_only_equal_influence_samples(self) -> None:
        # Asymmetric fixture: the equal-influence cluster sits at x=+0.02, so
        # the centroid (and the plane through it) must land there, not at 0.
        points = np.array([
            [-0.030, 0.0, 0.0],
            [ 0.020, 0.004, -0.003],
            [ 0.020, -0.004, 0.003],
            [ 0.020, 0.0, 0.0],
            [ 0.090, 0.0, 0.0],
        ])
        parent_w = np.array([0.97, 0.52, 0.48, 0.50, 0.02])
        child_w = 1.0 - parent_w
        band = BAKE.derive_joint_band(
            "P", "C", points, parent_w, child_w,
            axis=np.array([1.0, 0.0, 0.0]), width_m=0.030)
        # The three selected samples are the x=0.020 triple.
        np.testing.assert_allclose(band.center, np.array([0.02, 0.0, 0.0]), atol=1e-12)
        self.assertEqual((band.parent, band.child), ("P", "C"))

    def test_derive_joint_band_rejects_a_non_unit_axis(self) -> None:
        points = np.zeros((1, 3))
        with self.assertRaises(ValueError):
            BAKE.derive_joint_band("P", "C", points, np.array([1.0]),
                                   np.array([0.0]), axis=np.array([2.0, 0, 0]),
                                   width_m=0.030)

    def test_derive_joint_band_rejects_an_empty_influence_band(self) -> None:
        points = np.array([[-0.04, 0, 0], [0.04, 0, 0]])
        parent_w = np.array([0.99, 0.01])
        with self.assertRaises(ValueError):
            BAKE.derive_joint_band("P", "C", points, parent_w, 1.0 - parent_w,
                                   axis=np.array([1.0, 0, 0]), width_m=0.030)

    def test_inside_support_intersects_all_planes(self) -> None:
        # Two opposed caps 100 mm apart: only the slab between them is inside.
        planes = np.array([
            [1.0, 0.0, 0.0, -0.05],
            [-1.0, 0.0, 0.0, -0.05],
        ])
        self.assertTrue(BAKE.inside_support(np.array([0.049, 9.9, -9.9]), planes))
        self.assertFalse(BAKE.inside_support(np.array([0.051, 0, 0]), planes))


# ===========================================================================
# Synthetic two-bone soup: end-to-end derive_partitions without Blender
# ===========================================================================

def synthetic_two_bone_soup() -> "BAKE.SourceSoup":
    """A closed tube along +X skinned to Parent (x<0) and Child (x>0).

    Weights cross exactly at x=0 through tanh(x/20mm), so the equal-influence
    band is the x=0 ring and the boundary centre is the origin by symmetry.
    A third zero-weight bone (ChildTip) must fold into Child. Parent bind head
    sits at x=-0.24, Child head at x=0, so the measured joint-to-child axis is
    exactly +X.
    """
    segs, sides, radius = 96, 12, 0.03
    xs = np.linspace(-0.24, 0.24, segs + 1)
    ang = np.linspace(0.0, 2.0 * np.pi, sides, endpoint=False)
    verts: list[tuple[float, float, float]] = []
    for x in xs:
        for a in ang:
            verts.append((float(x), radius * np.cos(a), radius * np.sin(a)))
    vid = lambda i, j: i * sides + j
    faces: list[tuple[int, int, int]] = []
    for i in range(segs):
        for j in range(sides):
            k = (j + 1) % sides
            faces.append((vid(i, j), vid(i + 1, k), vid(i + 1, j)))
            faces.append((vid(i, j), vid(i, k), vid(i + 1, k)))
    # end caps (fan around a centre vertex) close the tube
    base_c = len(verts)
    verts.append((-0.24, 0.0, 0.0))
    tip_c = len(verts)
    verts.append((0.24, 0.0, 0.0))
    for j in range(sides):
        k = (j + 1) % sides
        faces.append((base_c, vid(0, k), vid(0, j)))
        faces.append((tip_c, vid(segs, j), vid(segs, k)))

    vertices = np.array(verts, dtype=np.float64)
    w_p = 0.5 * (1.0 - np.tanh(vertices[:, 0] / 0.02))
    w_c = 1.0 - w_p
    weights = np.column_stack([w_p, w_c, np.zeros_like(w_p), np.zeros_like(w_p)])
    joints = np.column_stack([np.full(len(vertices), 0),
                              np.full(len(vertices), 1),
                              np.full(len(vertices), 0),
                              np.full(len(vertices), 1)]).astype(np.int64)
    faces_np = np.array(faces, dtype=np.int64)

    # Bind matrices are column-major 4x4. Parent head at x=-0.24, Child head
    # at the joint (x=0), ChildTip at x=+0.24 (identity-ish, never weighted).
    def translate(tx: float) -> np.ndarray:
        m = np.eye(4)
        m[:3, 3] = (tx, 0.0, 0.0)
        return m

    inverse_bind = np.stack([translate(0.24), translate(0.0), translate(-0.24)])
    return BAKE.SourceSoup(
        vertices=vertices,
        faces=faces_np.astype(np.uint32),
        face_uvs=np.zeros((len(faces_np), 3, 2)),
        joints=joints,
        weights=weights,
        bone_names=("Parent", "Child", "ChildTip"),
        parents=(-1, 0, 1),
        inverse_bind=inverse_bind,
        albedo_rgba=np.zeros((4, 4, 4), dtype=np.uint8),
        base_color_factor=np.ones(4),
        texture_transform=np.eye(3),
    )


class DerivePartitionsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.soup = synthetic_two_bone_soup()
        self.result = BAKE.derive_partitions(self.soup)

    def test_folds_zero_weight_bones_and_keeps_deforming_ones(self) -> None:
        names = [p.name for p in self.result.partitions]
        self.assertEqual(names, ["Parent", "Child"])
        folded = self.result.coverage["foldedBones"]
        self.assertEqual(folded, [{"bone": "ChildTip", "into": "Child",
                                   "rule": BAKE.FOLD_RULE_NAME}])

    def test_one_planar_band_with_the_declared_30mm_width(self) -> None:
        self.assertEqual(len(self.result.bands), 1)
        band = self.result.bands[0]
        self.assertEqual((band.parent, band.child), ("Parent", "Child"))
        self.assertAlmostEqual(band.width_m, 0.030, places=9)
        np.testing.assert_allclose(band.axis, [1, 0, 0], atol=1e-9)
        np.testing.assert_allclose(band.center, [0, 0, 0], atol=1e-9)

    def test_support_planes_are_bone_local_and_capped_at_15mm(self) -> None:
        parts = {p.name: p for p in self.result.partitions}
        # Parent local frame is translated by +0.24 in x: the boundary plane
        # x_model = 0 with a +15 mm child-side cap must sit at x_local = 0.255.
        parent = parts["Parent"]
        self.assertEqual(parent.support_planes.shape, (1, 4))
        np.testing.assert_allclose(parent.support_planes[0], [1, 0, 0, -0.255],
                                   atol=1e-9)
        self.assertTrue(BAKE.inside_support(np.array([0.254, 0, 0]), parent))
        self.assertFalse(BAKE.inside_support(np.array([0.256, 0, 0]), parent))
        child = parts["Child"]
        np.testing.assert_allclose(child.support_planes[0], [-1, 0, 0, -0.015],
                                   atol=1e-9)
        self.assertTrue(BAKE.inside_support(np.array([-0.014, 0, 0]), child))
        self.assertFalse(BAKE.inside_support(np.array([-0.016, 0, 0]), child))

    def test_every_face_is_owned_and_weak_faces_resolve_deterministically(self) -> None:
        self.assertEqual(self.result.unowned_face_indices.size, 0)
        self.assertTrue((self.result.face_owners >= 0).all())
        counts = self.result.coverage["facesPerPartition"]
        self.assertEqual(counts["Parent"] + counts["Child"], self.soup.faces.shape[0])
        self.assertGreater(counts["Parent"], 0)
        self.assertGreater(counts["Child"], 0)
        # Determinism: identical input, identical output arrays.
        again = BAKE.derive_partitions(self.soup)
        np.testing.assert_array_equal(self.result.face_owners, again.face_owners)

    def test_bounds_extend_exactly_15mm_into_the_neighbour(self) -> None:
        band_cov = self.result.coverage["jointBands"][0]
        self.assertLessEqual(band_cov["parentExtensionM"], 0.015 + 1e-9)
        self.assertLessEqual(band_cov["childExtensionM"], 0.015 + 1e-9)
        self.assertGreater(band_cov["parentExtensionM"], 0.014)
        self.assertGreater(band_cov["childExtensionM"], 0.014)
        # 30 mm total overlap, never more.
        self.assertLessEqual(band_cov["parentExtensionM"]
                             + band_cov["childExtensionM"], 0.030 + 1e-9)

    def test_bind_transforms_round_trip_and_index_parents(self) -> None:
        parts = {p.name: p for p in self.result.partitions}
        for name, joint_index, parent_index in (("Parent", 0, -1),
                                                ("Child", 1, 0)):
            p = parts[name]
            self.assertEqual(p.joint_index, joint_index)
            self.assertEqual(p.parent_index, parent_index)
            product = p.bind_to_model @ p.model_to_bind
            np.testing.assert_allclose(product, np.eye(4), atol=1e-9)
        np.testing.assert_allclose(parts["Parent"].bind_to_model[:3, 3],
                                   [-0.24, 0, 0], atol=1e-9)
        np.testing.assert_allclose(parts["Child"].bind_to_model[:3, 3],
                                   [0, 0, 0], atol=1e-9)
        # The measured joint-to-child axis came from those bind heads.
        band = self.result.bands[0]
        head_dir = (parts["Child"].bind_to_model[:3, 3]
                    - parts["Parent"].bind_to_model[:3, 3])
        np.testing.assert_allclose(band.axis,
                                   head_dir / np.linalg.norm(head_dir), atol=1e-9)
        # Pitch: synthetic names carry no Head/Hand token -> limb pitch.
        for p in self.result.partitions:
            self.assertEqual(p.pitch_m, BAKE.LIMB_PITCH_M)


class EdgeAdjacencyTest(unittest.TestCase):
    """The weak-face flood fill is only as good as this adjacency."""

    def test_two_triangles_sharing_an_edge_pair_with_each_other(self) -> None:
        faces = np.array([[0, 1, 2], [1, 2, 3]], dtype=np.int64)
        fa, fb = BAKE._edge_adjacency(faces)
        self.assertEqual(len(fa), 1)
        self.assertEqual({int(fa[0]), int(fb[0])}, {0, 1},
                         "a shared edge must pair the two DIFFERENT faces")

    def test_every_reported_pair_actually_shares_an_edge(self) -> None:
        # closed octahedron: 6 vertices, 8 faces, 12 edges, each interior
        verts = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0],
                          [0, -1, 0], [0, 0, 1], [0, 0, -1]], dtype=np.float64)
        faces = np.array([
            [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
            [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
        ], dtype=np.int64)
        fa, fb = BAKE._edge_adjacency(faces)
        self.assertEqual(len(fa), 12, "a closed octahedron has 12 shared edges")
        self.assertEqual(int((fa == fb).sum()), 0, "no face may pair with itself")
        for a, b in zip(fa, fb):
            shared = set(faces[int(a)].tolist()) & set(faces[int(b)].tolist())
            self.assertGreaterEqual(
                len(shared), 2, f"faces {int(a)},{int(b)} do not share an edge")
        # every face must reach every other face through the adjacency graph
        seen, stack = {0}, [0]
        neighbours: dict[int, list[int]] = {i: [] for i in range(len(faces))}
        for a, b in zip(fa, fb):
            neighbours[int(a)].append(int(b))
            neighbours[int(b)].append(int(a))
        while stack:
            for nxt in neighbours[stack.pop()]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        self.assertEqual(len(seen), len(faces), "adjacency graph is disconnected")



if __name__ == "__main__":
    unittest.main(verbosity=2)
