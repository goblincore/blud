#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2", "scipy==1.18.0"]
# ///
"""Qualify the Blender/OpenVDB array-mesh adapters against REAL Blud sources.

Task 3 of the Blender SDF grid adapters continuation plan
(docs/superpowers/plans/2026-08-19-blender-sdf-grid-adapters-continuation.md).

Two bounded smokes, each run TWICE in separate Blender processes:

  firm-grip-hand-union
      the authored `pose-05-firm-grip` hand soup unioned with one CLOSED wrist
      continuation box, on a 2 mm lattice.

  humanoid-right-forearm-intersection
      the COMPLETE canonical humanoid soup, transformed into RightForeArm
      bind-local metres, intersected with one CLOSED support box derived from
      the faces that partition actually owns, on the partition's 6 mm pitch.

This is a smoke report, not a production bake: it never writes an atlas, a
runtime asset, or a source preview. Everything expensive lives behind the CLI
so `test_qualify_blender_sdf_real_sources.py` stays pure and instant.

    uv run scripts/qualify_blender_sdf_real_sources.py --hand --humanoid \
        --output /absolute/adapter-qualification.json
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as _datetime
import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Literal, Sequence

import numpy as np
import numpy.typing as npt

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
NOTES_DIR = REPO_ROOT / "docs" / "dev-notes" / "2026-08-18-blender-sdf-grid"
DEFAULT_REPORT = NOTES_DIR / "adapter-qualification.json"
GRIP_NOTES_DIR = REPO_ROOT / "docs" / "dev-notes" / "2026-08-17-sdf-dynamite-grip"
POSE_CONTACT_SHEET = GRIP_NOTES_DIR / "pose-contact-sheet.png"

FIRM_GRIP_POSE = "pose-05-firm-grip.npz"

# -- hand union geometry (the hand soup's own local metre basis; +y is distal)
WRIST_BAND_M = 0.005            # band thickness selecting the proximal rim
WRIST_BOX_PAD_M = 0.005         # lateral pad around the band's x/z bounds
WRIST_BOX_OVERLAP_M = 0.010     # how far the box reaches INTO the soup
WRIST_BOX_REACH_M = 0.050       # how far it continues proximally
WRIST_MIN_BAND_VERTICES = 4
HAND_PITCH_M = 0.002
HAND_MARGIN_VOXELS = 6
HAND_DIMENSION_CAP = 192

# -- humanoid forearm support geometry (RightForeArm bind-local metres)
FOREARM_SUPPORT_PAD_M = 0.020
FOREARM_MARGIN_VOXELS = 4
FOREARM_DIMENSION_CAP = 512

SOURCES: tuple[str, str] = (
    "firm-grip-hand-union",
    "humanoid-right-forearm-intersection",
)


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


SDF = _load(SCRIPTS_DIR / "blender_sdf_grid.py", "blender_sdf_grid_for_qual")
HUM = _load(SCRIPTS_DIR / "bake_humanoid_sdf.py", "bake_humanoid_sdf_for_qual")

closed_box_mesh = SDF.closed_box_mesh


# ===========================================================================
# Pure gate scoring
# ===========================================================================

def count_negative_components(result: "SDF.DenseSdfResult") -> int:
    """6-connected components of the inside region, fast enough for real grids.

    SDF.count_negative_components is a plain Python flood fill: correct, but
    minutes on a million-voxel lattice. This is the same 6-connectivity via
    scipy's labeller, and the two are asserted equal on random fields.
    """
    from scipy import ndimage

    mask = np.asarray(result.values_f32) < 0.0
    if not mask.any():
        return 0
    structure = ndimage.generate_binary_structure(3, 1)
    return int(ndimage.label(mask, structure=structure)[1])


def negative_component_stats(result: "SDF.DenseSdfResult") -> dict[str, Any]:
    """Size distribution of the inside region's 6-connected components.

    A bare component count is not evidence: one solid body plus a scatter of
    single-voxel isosurface specks and a genuinely shattered field both read as
    "many". The largest-component fraction separates them.
    """
    from scipy import ndimage

    mask = np.asarray(result.values_f32) < 0.0
    negatives = int(mask.sum())
    if negatives == 0:
        return {"count": 0, "negativeSamples": 0, "largestComponentVoxels": 0,
                "largestComponentFraction": 0.0, "singleVoxelComponents": 0,
                "largestComponentSizes": []}
    labels, count = ndimage.label(
        mask, structure=ndimage.generate_binary_structure(3, 1))
    sizes = np.bincount(labels.reshape(-1))[1:]
    order = np.sort(sizes)[::-1]
    return {
        "count": int(count),
        "negativeSamples": negatives,
        "largestComponentVoxels": int(order[0]),
        "largestComponentFraction": float(order[0]) / float(negatives),
        "singleVoxelComponents": int((sizes == 1).sum()),
        "largestComponentSizes": [int(v) for v in order[:8]],
    }


def score_repeat(first: "SDF.DenseSdfResult",
                 second: "SDF.DenseSdfResult") -> dict[str, Any]:
    """Two separate Blender processes must agree byte for byte."""
    metadata_equal = (SDF.canonical_json(SDF.result_metrics(first))
                      == SDF.canonical_json(SDF.result_metrics(second)))
    f32_equal = (np.ascontiguousarray(first.values_f32).tobytes("C")
                 == np.ascontiguousarray(second.values_f32).tobytes("C"))
    r16f_equal = SDF.encode_r16f_bytes(first) == SDF.encode_r16f_bytes(second)
    return {
        "metadataEqual": metadata_equal,
        "f32Equal": f32_equal,
        "r16fEqual": r16f_equal,
        "passed": bool(metadata_equal and f32_equal and r16f_equal),
    }


def score_dense_gate(result: "SDF.DenseSdfResult", *, expected_route: str,
                     expect_components: int | None = None) -> dict[str, Any]:
    """Every dense gate the plan pins, raising on the first violation."""
    wanted = SDF.SdfGridRoute.check(expected_route)
    if result.route != wanted:
        raise ValueError(
            f"route drift: expected {wanted}, result carries {result.route}")
    metrics = SDF.validate_dense_sdf(result)        # signs, boundary, finite
    stats = negative_component_stats(result)
    components = stats["count"]
    if expect_components is not None and components != expect_components:
        raise ValueError(
            f"negative components {components} != required {expect_components}")
    return {
        "route": result.route,
        "bothSigns": True,
        "boundaryOutside": True,
        "negativeComponents": components,
        "requiredComponents": expect_components,
        "negativeComponentStats": stats,
        "valueMinM": metrics["min"],
        "valueMaxM": metrics["max"],
        "boundaryMinM": metrics["boundaryMin"],
        "negativeSamples": metrics["negatives"],
        "positiveSamples": metrics["positives"],
        "negativeFraction": metrics["negativeFraction"],
    }


# ===========================================================================
# Pure source preparation
# ===========================================================================

@dataclasses.dataclass(frozen=True)
class Box:
    minimum_m: tuple[float, float, float]
    maximum_m: tuple[float, float, float]
    band_vertex_count: int = 0

    def mesh(self) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.int64]]:
        return closed_box_mesh(self.minimum_m, self.maximum_m)

    def to_json(self) -> dict[str, Any]:
        return {"minimumM": list(self.minimum_m), "maximumM": list(self.maximum_m),
                "bandVertexCount": int(self.band_vertex_count)}


@dataclasses.dataclass(frozen=True)
class OwnedBounds:
    name: str
    row: int
    basis: str
    minimum_m: npt.NDArray[np.float64]
    maximum_m: npt.NDArray[np.float64]
    owned_face_count: int
    owned_vertex_count: int
    model_to_bind: tuple[tuple[float, ...], ...]
    pitch_m: float

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name, "partitionRow": int(self.row),
            "basis": self.basis,
            "minimumM": [float(v) for v in self.minimum_m],
            "maximumM": [float(v) for v in self.maximum_m],
            "ownedFaceCount": int(self.owned_face_count),
            "ownedVertexCount": int(self.owned_vertex_count),
            "modelToBind": [list(r) for r in self.model_to_bind],
            "pitchM": float(self.pitch_m),
        }


def wrist_continuation_box(vertices_m: npt.NDArray[np.floating]) -> Box:
    """A CLOSED proximal continuation of the hand soup, in its local basis.

    The wrist band is every vertex within WRIST_BAND_M of the soup's minimum y
    (`y` is distal). The box spans that band's x/z bounds plus a pad, overlaps
    the soup from min_y through min_y + WRIST_BOX_OVERLAP_M, and continues
    proximally to min_y - WRIST_BOX_REACH_M.
    """
    verts = np.asarray(vertices_m, dtype=np.float64)
    if verts.ndim != 2 or verts.shape[1] != 3 or verts.shape[0] == 0:
        raise ValueError(f"hand vertices must be (V, 3), got {verts.shape}")
    min_y = float(verts[:, 1].min())
    band = verts[verts[:, 1] <= min_y + WRIST_BAND_M]
    if band.shape[0] < WRIST_MIN_BAND_VERTICES:
        raise ValueError(
            f"wrist band has only {band.shape[0]} vertices within "
            f"{WRIST_BAND_M} m of min y; need {WRIST_MIN_BAND_VERTICES}")
    lo_x, hi_x = float(band[:, 0].min()), float(band[:, 0].max())
    lo_z, hi_z = float(band[:, 2].min()), float(band[:, 2].max())
    return Box(
        minimum_m=(lo_x - WRIST_BOX_PAD_M, min_y - WRIST_BOX_REACH_M,
                   lo_z - WRIST_BOX_PAD_M),
        maximum_m=(hi_x + WRIST_BOX_PAD_M, min_y + WRIST_BOX_OVERLAP_M,
                   hi_z + WRIST_BOX_PAD_M),
        band_vertex_count=int(band.shape[0]))


def partition_owned_bounds(soup: "HUM.SourceSoup",
                           partitions: "HUM.PartitionResult",
                           name: str) -> OwnedBounds:
    """Bind-local metre bounds of the faces one partition actually OWNS.

    Vectorized O(V + F): one matrix multiply over all vertices, one boolean
    face mask, one unique() gather. No vertex is ever compared with every face.
    """
    rows = [i for i, p in enumerate(partitions.partitions) if p.name == name]
    if not rows:
        raise ValueError(
            f"no partition named {name!r}; have "
            f"{[p.name for p in partitions.partitions]}")
    row = rows[0]
    part = partitions.partitions[row]
    owned_faces = np.asarray(soup.faces)[np.asarray(partitions.face_owners) == row]
    if owned_faces.size == 0:
        raise ValueError(f"partition {name!r} owns no faces")
    owned_vertex_ids = np.unique(owned_faces.reshape(-1))
    matrix = np.asarray(part.model_to_bind, dtype=np.float64)
    local = (np.asarray(soup.vertices, dtype=np.float64)
             @ matrix[:3, :3].T + matrix[:3, 3])
    owned_local = local[owned_vertex_ids]
    return OwnedBounds(
        name=name, row=row, basis="owned-face-vertices",
        minimum_m=owned_local.min(axis=0), maximum_m=owned_local.max(axis=0),
        owned_face_count=int(owned_faces.shape[0]),
        owned_vertex_count=int(owned_vertex_ids.shape[0]),
        model_to_bind=tuple(tuple(float(v) for v in r) for r in matrix),
        pitch_m=float(part.pitch_m))


def partition_bind_bounds(partitions: "HUM.PartitionResult",
                          name: str) -> OwnedBounds:
    """The partition's ALREADY-VALIDATED bind-local bounds from Task 1.

    Preferred over partition_owned_bounds() for sizing a support volume.
    `face_owners` flood-fills isolated islands by their own strongest bone, so
    a partition can own far-away specks: measured on the canonical humanoid,
    168 of RightForeArm's 1,592 owned faces sit ~0.5 m away in bind-local
    metres and inflate an owned-face AABB to body size. `coverage` records the
    weight-bound vertex bounds that Task 1 gated, which is the honest extent.
    """
    rows = [i for i, p in enumerate(partitions.partitions) if p.name == name]
    if not rows:
        raise ValueError(
            f"no partition named {name!r}; have "
            f"{[p.name for p in partitions.partitions]}")
    row = rows[0]
    part = partitions.partitions[row]
    entries = partitions.coverage.get("partitions") or []
    entry = next((e for e in entries if e.get("name") == name), None)
    if entry is None or entry.get("boundsLocalMin") is None:
        raise ValueError(
            f"partition {name!r} has no recorded bind-local bounds in coverage")
    minimum = np.asarray(entry["boundsLocalMin"], dtype=np.float64)
    maximum = np.asarray(entry["boundsLocalMax"], dtype=np.float64)
    if not np.all(maximum > minimum):
        raise ValueError(
            f"partition {name!r} bind bounds not strictly ordered: "
            f"{minimum} .. {maximum}")
    return OwnedBounds(
        name=name, row=row, basis="weight-bound-vertices",
        minimum_m=minimum, maximum_m=maximum,
        owned_face_count=int(entry.get("faces", 0)),
        owned_vertex_count=int(entry.get("boundVertices", 0)),
        model_to_bind=tuple(tuple(float(v) for v in r)
                            for r in np.asarray(part.model_to_bind,
                                                dtype=np.float64)),
        pitch_m=float(part.pitch_m))


def stray_owned_faces(soup: "HUM.SourceSoup", partitions: "HUM.PartitionResult",
                      bounds: OwnedBounds, *, tolerance_m: float = 1e-4
                      ) -> dict[str, Any]:
    """Count owned faces lying wholly OUTSIDE the partition's bind bounds.

    Evidence, not a gate: it makes the flood-fill contamination visible in the
    report instead of silently widening the support volume.
    """
    matrix = np.asarray(bounds.model_to_bind, dtype=np.float64)
    local = (np.asarray(soup.vertices, dtype=np.float64)
             @ matrix[:3, :3].T + matrix[:3, 3])
    owned = np.asarray(soup.faces)[np.asarray(partitions.face_owners) == bounds.row]
    lo = np.asarray(bounds.minimum_m) - tolerance_m
    hi = np.asarray(bounds.maximum_m) + tolerance_m
    inside = np.all((local >= lo) & (local <= hi), axis=1)
    face_inside = inside[owned.astype(np.int64)]
    wholly_outside = int((~face_inside).all(axis=1).sum())
    return {
        "ownedFaces": int(owned.shape[0]),
        "facesWhollyOutsideBindBounds": wholly_outside,
        "facesPartlyOutsideBindBounds": int((~face_inside).any(axis=1).sum()),
        "toleranceM": tolerance_m,
    }


def forearm_support_box(bounds: OwnedBounds) -> Box:
    """A CLOSED distal support spanning the owned x/z plus a pad.

    It runs from the owned distal y minimum minus the pad through the owned y
    MIDPOINT, so the intersection is bounded to the distal half of the forearm
    instead of an open crop of the whole body mesh.
    """
    lo = np.asarray(bounds.minimum_m, dtype=np.float64)
    hi = np.asarray(bounds.maximum_m, dtype=np.float64)
    midpoint_y = 0.5 * (float(lo[1]) + float(hi[1]))
    minimum = (float(lo[0]) - FOREARM_SUPPORT_PAD_M,
               float(lo[1]) - FOREARM_SUPPORT_PAD_M,
               float(lo[2]) - FOREARM_SUPPORT_PAD_M)
    maximum = (float(hi[0]) + FOREARM_SUPPORT_PAD_M,
               midpoint_y,
               float(hi[2]) + FOREARM_SUPPORT_PAD_M)
    if any(b <= a for a, b in zip(minimum, maximum)):
        raise ValueError(
            f"forearm support box is degenerate: {minimum} .. {maximum}")
    return Box(minimum_m=minimum, maximum_m=maximum)


def padded_spec(minimum_m: Sequence[float], maximum_m: Sequence[float], *,
                pitch_m: float, margin_voxels: int,
                dimension_cap: int = HAND_DIMENSION_CAP) -> "SDF.SdfGridSpec":
    """A pitch-exact, endpoint-inclusive lattice with a positive outer margin.

    Bounds snap OUTWARD to pitch multiples so `voxel_measured()` is exactly the
    declared pitch. The caps are hard: this fails loudly rather than silently
    coarsening the pitch to fit.
    """
    if pitch_m <= 0.0 or margin_voxels < 1:
        raise ValueError(f"bad lattice request: pitch {pitch_m}, "
                         f"margin {margin_voxels}")
    margin = float(margin_voxels) * float(pitch_m)
    lo, hi, dims = [], [], []
    for a, b in zip(minimum_m, maximum_m):
        if not b > a:
            raise ValueError(f"bounds not strictly ordered: {a} .. {b}")
        low = float(np.floor((float(a) - margin) / pitch_m - 1e-9)) * pitch_m
        high = float(np.ceil((float(b) + margin) / pitch_m + 1e-9)) * pitch_m
        n = int(round((high - low) / pitch_m)) + 1
        lo.append(low)
        hi.append(low + (n - 1) * pitch_m)
        dims.append(n)
    if max(dims) > dimension_cap:
        raise ValueError(
            f"lattice {tuple(dims)} exceeds the per-axis dimension cap "
            f"{dimension_cap} at pitch {pitch_m} m; refusing to coarsen")
    voxels = int(dims[0]) * int(dims[1]) * int(dims[2])
    if voxels > SDF.MAX_DENSE_VOXELS:
        raise ValueError(
            f"lattice {tuple(dims)} is {voxels} voxels, over "
            f"{SDF.MAX_DENSE_VOXELS}; refusing to coarsen")
    return SDF.SdfGridSpec(
        voxel_size_m=float(pitch_m), band_width=SDF.DEFAULT_BAND_WIDTH,
        bounds_min_m=(lo[0], lo[1], lo[2]), bounds_max_m=(hi[0], hi[1], hi[2]),
        dimensions=(dims[0], dims[1], dims[2]))


# ===========================================================================
# Report schema
# ===========================================================================

@dataclasses.dataclass(frozen=True)
class RepeatGate:
    metadata_equal: bool
    f32_equal: bool
    r16f_equal: bool

    @property
    def passed(self) -> bool:
        return bool(self.metadata_equal and self.f32_equal and self.r16f_equal)

    def to_json(self) -> dict[str, Any]:
        return {"metadataEqual": self.metadata_equal,
                "f32Equal": self.f32_equal,
                "r16fEqual": self.r16f_equal,
                "passed": self.passed}


@dataclasses.dataclass(frozen=True)
class QualificationRun:
    source: Literal["firm-grip-hand-union",
                    "humanoid-right-forearm-intersection"]
    passed: bool
    source_sha256: str
    operation_source_sha256: str
    f32_sha256: str
    r16f_sha256: str
    repeat: RepeatGate
    grid: dict[str, Any]
    gates: dict[str, Any]
    source_contract: dict[str, Any]
    timings: dict[str, float]

    def to_json(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "passed": bool(self.passed),
            "sourceSha256": self.source_sha256,
            "operationSourceSha256": self.operation_source_sha256,
            "f32Sha256": self.f32_sha256,
            "r16fSha256": self.r16f_sha256,
            "repeat": self.repeat.to_json(),
            "grid": self.grid,
            "gates": self.gates,
            "sourceContract": self.source_contract,
            "timings": self.timings,
        }


@dataclasses.dataclass(frozen=True)
class AdapterQualificationReport:
    schema_version: Literal[1]
    generated_at: str
    selected_route: Literal["direct-vdb"]
    passed: bool
    runs: tuple[QualificationRun, ...]


def report_to_json(report: AdapterQualificationReport) -> dict[str, Any]:
    """Serialize, refusing any run ordering other than the pinned one."""
    got = tuple(run.source for run in report.runs)
    if got != SOURCES:
        raise ValueError(
            f"report must contain exactly one of each source in order "
            f"{SOURCES}, got {got}")
    return {
        "schemaVersion": int(report.schema_version),
        "generatedAt": report.generated_at,
        "selectedRoute": SDF.SdfGridRoute.check(report.selected_route),
        "passed": bool(report.passed),
        "runs": [run.to_json() for run in report.runs],
    }


def write_report_atomically(path: Path, payload: dict[str, Any]) -> str:
    """Canonical JSON via a sibling temp file + replace; returns its sha256.

    A cancelled Blender run can never leave a half-written report behind.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, sort_keys=True, indent=2,
                      ensure_ascii=True, allow_nan=False) + "\n"
    handle, tmp_name = tempfile.mkstemp(dir=str(path.parent),
                                        prefix=path.name + ".", suffix=".tmp")
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(handle, "w") as fh:
            fh.write(text)
        json.loads(tmp_path.read_text())          # parse back before replacing
        tmp_path.replace(path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
    return SDF.sha256_bytes(text.encode("utf-8"))


# ===========================================================================
# Blender-backed qualification runs (each source baked TWICE)
# ===========================================================================

def _result_hashes(result: "SDF.DenseSdfResult") -> tuple[str, str]:
    f32 = SDF.sha256_bytes(np.ascontiguousarray(result.values_f32).tobytes("C"))
    return f32, SDF.sha256_bytes(SDF.encode_r16f_bytes(result))


def _grid_json(result: "SDF.DenseSdfResult", spec: "SDF.SdfGridSpec",
               gate: dict[str, Any]) -> dict[str, Any]:
    return {
        "dimensions": list(result.dimensions),
        "boundsMinM": list(result.bounds_min_m),
        "boundsMaxM": list(result.bounds_max_m),
        "voxelSizeMeasuredM": list(result.voxel_size_m),
        "voxelSizeDeclaredM": spec.voxel_size_m,
        "bandWidth": spec.band_width,
        "gridName": spec.grid_name,
        "nodeContractSha256": result.node_contract_sha256,
        "denseVoxels": int(np.prod(result.dimensions)),
        "valueMinM": gate["valueMinM"],
        "valueMaxM": gate["valueMaxM"],
    }


def _mesh_input(label: str, vertices, triangles, source_sha: str):
    return SDF.MeshArrayInput(
        label=label, vertices_m=np.asarray(vertices, dtype=np.float64),
        triangles=np.asarray(triangles, dtype=np.int64),
        source_sha256=source_sha, source_to_grid_m=SDF.IDENTITY_4X4)


def _twice(bake, *, expected_route: str, expect_components: int | None
           ) -> tuple[Any, Any, dict[str, Any], dict[str, Any], dict[str, float]]:
    """Run one bake in two separate Blender processes and score both."""
    diag_a: dict[str, Any] = {}
    t0 = time.monotonic()
    first = bake(diag_a)
    first_s = time.monotonic() - t0
    diag_b: dict[str, Any] = {}
    t0 = time.monotonic()
    second = bake(diag_b)
    second_s = time.monotonic() - t0
    gate = score_dense_gate(first, expected_route=expected_route,
                            expect_components=expect_components)
    score_dense_gate(second, expected_route=expected_route,
                     expect_components=expect_components)
    repeat = score_repeat(first, second)
    timings = {"firstRunS": round(first_s, 3), "secondRunS": round(second_s, 3)}
    for name, diag in (("first", diag_a), ("second", diag_b)):
        blender_s = diag.get("timings", {}).get("blenderS")
        if blender_s is not None:
            timings[f"{name}BlenderS"] = float(blender_s)
    return first, second, gate, {"repeat": repeat, "diagnostics": diag_a}, timings


def qualify_hand_union(*, blender_bin: str | None = None) -> QualificationRun:
    """Union the authored firm-grip hand soup with a closed wrist continuation."""
    import author_dynamite_grip as GRIP           # noqa: N812  (script module)

    sheet_before = (SDF.sha256_bytes(POSE_CONTACT_SHEET.read_bytes())
                    if POSE_CONTACT_SHEET.exists() else None)
    with tempfile.TemporaryDirectory(prefix="blud-hand-soups-") as tmp:
        GRIP.export_pose_soups(Path(tmp), contact_sheet=False)
        sheet_after = (SDF.sha256_bytes(POSE_CONTACT_SHEET.read_bytes())
                       if POSE_CONTACT_SHEET.exists() else None)
        if sheet_after != sheet_before:
            raise RuntimeError(
                "the tracked pose contact sheet changed during a smoke export "
                f"({sheet_before} -> {sheet_after}); fix the source export "
                "path rather than staging or restoring the preview")
        authoring = json.loads((Path(tmp) / "authoring.json").read_text())
        with np.load(Path(tmp) / FIRM_GRIP_POSE, allow_pickle=False) as npz:
            vertices = np.asarray(npz["vertices"], dtype=np.float64)
            faces = np.asarray(npz["faces"], dtype=np.int64)
            pose_diagnostics = json.loads(str(npz["diagnostics"]))

    soup_sha = SDF.sha256_bytes(
        np.ascontiguousarray(vertices, dtype="<f8").tobytes("C")
        + np.ascontiguousarray(faces, dtype="<u4").tobytes("C"))
    box = wrist_continuation_box(vertices)
    box_vertices, box_faces = box.mesh()
    box_sha = SDF.sha256_bytes(
        np.ascontiguousarray(box_vertices, dtype="<f8").tobytes("C"))

    lo = np.minimum(vertices.min(axis=0), np.asarray(box.minimum_m))
    hi = np.maximum(vertices.max(axis=0), np.asarray(box.maximum_m))
    spec = padded_spec(lo, hi, pitch_m=HAND_PITCH_M,
                       margin_voxels=HAND_MARGIN_VOXELS,
                       dimension_cap=HAND_DIMENSION_CAP)
    meshes = (_mesh_input("firm-grip-hand", vertices, faces, soup_sha),
              _mesh_input("wrist-continuation", box_vertices, box_faces, box_sha))

    # The hand soup may legitimately carry more than one closed island, so the
    # component count is RECORDED here, never required.
    first, second, gate, extra, timings = _twice(
        lambda diag: SDF.bake_mesh_union_to_dense(
            meshes, spec, blender_bin=blender_bin, keep_tmp=False,
            diagnostics=diag),
        expected_route=SDF.SdfGridRoute.DIRECT_VDB, expect_components=None)

    f32_sha, r16f_sha = _result_hashes(first)
    repeat = RepeatGate(extra["repeat"]["metadataEqual"],
                        extra["repeat"]["f32Equal"],
                        extra["repeat"]["r16fEqual"])
    topology = extra["diagnostics"]["topology"]
    return QualificationRun(
        source="firm-grip-hand-union",
        passed=bool(repeat.passed),
        source_sha256=first.source_sha256,
        operation_source_sha256=extra["diagnostics"]["operationSourceSha256"],
        f32_sha256=f32_sha, r16f_sha256=r16f_sha, repeat=repeat,
        grid=_grid_json(first, spec, gate), gates=gate,
        source_contract={
            "pose": FIRM_GRIP_POSE,
            "handSourceSha256": authoring.get("handSourceSha256"),
            "propSha256": authoring.get("prop", {}).get("sha256"),
            "wristCutM": pose_diagnostics.get("wristCutM"),
            "soupVertexCount": int(vertices.shape[0]),
            "soupTriangleCount": int(faces.shape[0]),
            "soupSha256": soup_sha,
            "wristBox": box.to_json(),
            "wristBoxSha256": box_sha,
            "indexedTopology": topology,
            "contactSheetSha256": sheet_before,
            "operands": [d["label"] for d in extra["diagnostics"]["payloads"]],
            "payloadSha256": [d["payloadSha256"]
                              for d in extra["diagnostics"]["payloads"]],
        },
        timings=timings)


def qualify_humanoid_intersection(*, blender_bin: str | None = None
                                  ) -> QualificationRun:
    """Clip the COMPLETE humanoid body by a closed distal-forearm support box."""
    with tempfile.TemporaryDirectory(prefix="blud-humanoid-source-") as tmp:
        soup = HUM.export_source_npz(Path(tmp) / "source.npz")
    partitions = HUM.derive_partitions(soup)
    bounds = partition_bind_bounds(partitions, "RightForeArm")
    owned = partition_owned_bounds(soup, partitions, "RightForeArm")
    strays = stray_owned_faces(soup, partitions, bounds)

    matrix = np.asarray(bounds.model_to_bind, dtype=np.float64)
    body_local = (np.asarray(soup.vertices, dtype=np.float64)
                  @ matrix[:3, :3].T + matrix[:3, 3])
    faces = np.asarray(soup.faces, dtype=np.int64)
    body_sha = SDF.sha256_bytes(
        np.ascontiguousarray(body_local, dtype="<f8").tobytes("C")
        + np.ascontiguousarray(faces, dtype="<u4").tobytes("C"))

    box = forearm_support_box(bounds)
    box_vertices, box_faces = box.mesh()
    box_sha = SDF.sha256_bytes(
        np.ascontiguousarray(box_vertices, dtype="<f8").tobytes("C"))

    # The intersection cannot reach outside the support, so the lattice is
    # bounded by the SUPPORT box, not by the whole body.
    spec = padded_spec(box.minimum_m, box.maximum_m, pitch_m=bounds.pitch_m,
                       margin_voxels=FOREARM_MARGIN_VOXELS,
                       dimension_cap=FOREARM_DIMENSION_CAP)
    source = _mesh_input("humanoid-body", body_local, faces, body_sha)
    support = _mesh_input("right-forearm-support", box_vertices, box_faces, box_sha)

    first, second, gate, extra, timings = _twice(
        lambda diag: SDF.bake_mesh_intersection_to_dense(
            source, support, spec, blender_bin=blender_bin, keep_tmp=False,
            diagnostics=diag),
        expected_route=SDF.SdfGridRoute.DIRECT_VDB, expect_components=1)

    deepest = float(np.asarray(first.values_f32).min())
    if not deepest < 0.0:
        raise ValueError(f"deepest sample {deepest} is not negative")

    f32_sha, r16f_sha = _result_hashes(first)
    repeat = RepeatGate(extra["repeat"]["metadataEqual"],
                        extra["repeat"]["f32Equal"],
                        extra["repeat"]["r16fEqual"])
    forearm = partitions.partitions[bounds.row]
    return QualificationRun(
        source="humanoid-right-forearm-intersection",
        passed=bool(repeat.passed),
        source_sha256=first.source_sha256,
        operation_source_sha256=extra["diagnostics"]["operationSourceSha256"],
        f32_sha256=f32_sha, r16f_sha256=r16f_sha, repeat=repeat,
        grid=_grid_json(first, spec, gate),
        gates={**gate, "deepestSampleM": deepest},
        source_contract={
            "sourceGlbSha256": HUM.EXPECTED_SOURCE_SHA256,
            "bodyVertexCount": int(soup.vertices.shape[0]),
            "bodyTriangleCount": int(faces.shape[0]),
            "bodyLocalSha256": body_sha,
            "bindBounds": bounds.to_json(),
            "ownedFaceBounds": owned.to_json(),
            "ownedFaceStrays": strays,
            "supportBox": box.to_json(),
            "supportBoxSha256": box_sha,
            "supportPlanes": [[float(v) for v in row]
                              for row in np.asarray(forearm.support_planes)],
            "indexedTopology": extra["diagnostics"]["topology"],
            "operands": [d["label"] for d in extra["diagnostics"]["payloads"]],
            "payloadSha256": [d["payloadSha256"]
                              for d in extra["diagnostics"]["payloads"]],
        },
        timings=timings)


# ===========================================================================
# CLI
# ===========================================================================

def build_report(runs: Sequence[QualificationRun]) -> AdapterQualificationReport:
    stamp = _datetime.datetime.now(_datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return AdapterQualificationReport(
        schema_version=1, generated_at=stamp,
        selected_route=SDF.SdfGridRoute.DIRECT_VDB,
        passed=all(run.passed for run in runs), runs=tuple(runs))


ADAPTER_COMMAND = (
    "uv run scripts/qualify_blender_sdf_real_sources.py --hand --humanoid "
    "--output docs/dev-notes/2026-08-18-blender-sdf-grid/"
    "adapter-qualification.json")


def update_task1_qualification(report_path: Path, report_sha256: str,
                               report: AdapterQualificationReport,
                               qualification_path: Path | None = None) -> None:
    """Record the adapter outcome in Task 1's report WITHOUT touching its hashes.

    Only the new `arrayMeshAdapters` key is written; every capability and
    analytic result hash Task 1 recorded is carried through untouched.
    """
    target = Path(qualification_path or (NOTES_DIR / "qualification.json"))
    if not target.exists():
        raise FileNotFoundError(f"Task 1 qualification report missing: {target}")
    payload = json.loads(target.read_text())
    payload["arrayMeshAdapters"] = {
        "reportPath": str(Path(report_path).relative_to(REPO_ROOT))
        if Path(report_path).is_absolute()
        and Path(report_path).is_relative_to(REPO_ROOT) else str(report_path),
        "reportSha256": report_sha256,
        "selectedRoute": report.selected_route,
        "passed": bool(report.passed),
        "command": ADAPTER_COMMAND,
        "gates": {run.source: {"passed": bool(run.passed),
                               "repeat": run.repeat.to_json(),
                               "f32Sha256": run.f32_sha256,
                               "r16fSha256": run.r16f_sha256,
                               "dimensions": run.grid["dimensions"],
                               "negativeComponents":
                                   run.gates["negativeComponents"]}
                  for run in report.runs},
        "booleanWorkaround":
            "Blender 5.2 GeometryNodeSDFGridBoolean returns Grid 2 for every "
            "operation; unions fold OpenVDB min and intersections fold max.",
    }
    write_report_atomically(target, payload)


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--hand", action="store_true",
                    help="run the firm-grip hand union smoke")
    ap.add_argument("--humanoid", action="store_true",
                    help="run the humanoid right-forearm intersection smoke")
    ap.add_argument("--output", type=Path, default=None,
                    help="report path (required unless BOTH sources run)")
    ap.add_argument("--blender-bin", default=None,
                    help="override the blender executable")
    ap.add_argument("--no-task1-update", action="store_true",
                    help="do not record arrayMeshAdapters in qualification.json")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    hand = args.hand or not (args.hand or args.humanoid)
    humanoid = args.humanoid or not (args.hand or args.humanoid)
    both = hand and humanoid
    output = args.output or (DEFAULT_REPORT if both else None)
    if output is None:
        raise SystemExit(
            "--output is required for a single-source diagnostic run; only the "
            "full two-source run may default to the checked-in report")

    sys.path.insert(0, str(SCRIPTS_DIR))
    runs: list[QualificationRun] = []
    if hand:
        print("[qualify] firm-grip hand union ...", flush=True)
        runs.append(qualify_hand_union(blender_bin=args.blender_bin))
    if humanoid:
        print("[qualify] humanoid right-forearm intersection ...", flush=True)
        runs.append(qualify_humanoid_intersection(blender_bin=args.blender_bin))

    report = build_report(runs)
    if both:
        payload = report_to_json(report)
    else:
        payload = {
            "schemaVersion": 1, "generatedAt": report.generated_at,
            "selectedRoute": report.selected_route, "passed": report.passed,
            "partial": True, "runs": [run.to_json() for run in report.runs],
        }
    digest = write_report_atomically(Path(output), payload)
    if both and not args.no_task1_update:
        update_task1_qualification(Path(output), digest, report)
        print(f"[qualify] arrayMeshAdapters recorded in "
              f"{NOTES_DIR / 'qualification.json'}", flush=True)
    for run in runs:
        print(f"[qualify] {run.source}: passed={run.passed} "
              f"dims={run.grid['dimensions']} "
              f"components={run.gates['negativeComponents']} "
              f"f32={run.f32_sha256[:12]}", flush=True)
    print(f"[qualify] report -> {output} (sha256 {digest})", flush=True)
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
