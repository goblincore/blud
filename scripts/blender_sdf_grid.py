# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
"""Qualify Blender 5.2's headless Geometry-Nodes SDF grid workflow for Blud.

Task 1 of the Blender-native SDF grid authoring plan
(docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md,
design: docs/superpowers/specs/2026-08-18-blender-sdf-grid-authoring-design.md).

Two process roles share this file (the same split as scripts/bake_hand_sdf.py):

  outer (normal Python via `uv`; libigl for the fallback route)
      resolves Blender from PATH, writes a canonical JSON request into a
      task-owned temporary directory (outside git), launches

          blender --background --factory-startup --python THIS_FILE -- \
              --blender-inner /abs/request.json /abs/result.json

      then converts the inner result into a DenseSdfResult.

  inner (runs INSIDE Blender 5.2; no libigl there)
      asserts the Blender version and node registrations, constructs the
      Geometry Nodes graph entirely from Python (Mesh to SDF Grid, SDF Grid
      Boolean, Store Named Grid, Bake, Grid to Mesh -- every socket assigned
      explicitly), evaluates it and writes route diagnostics + dense samples.

Result routes (never selected silently; the route string rides every result):

  direct-vdb          Store Named Grid -> GeometryNodeBake(bake_target='DISK')
                      -> blobs/*.vdb -> read back with Blender's bundled
                      `openvdb` module -> dense samples via a fixed-order
                      trilinear evaluation of the level-set grid (signed
                      background included, so deep interior stays negative).
  grid-to-mesh-libigl Grid to Mesh(threshold=0.0, adaptivity=0.0) -> closed
                      triangulated PLY -> the EXISTING libigl unsigned +
                      fast-winding-number sampler from bake_hand_sdf.py.

Determinism contract: repeating a bake twice must yield byte-identical
canonical metadata and byte-identical R16F encodings. Temporary .blend/.vdb/
.npy/.ply intermediates stay in a mkdtemp directory outside git.

Usage:
    uv run scripts/blender_sdf_grid.py --probe-capabilities
    uv run scripts/blender_sdf_grid.py --analytic-fixture
    uv run scripts/blender_sdf_grid.py --blender-inner REQ.json RES.json
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path
from typing import Any, Literal, Sequence

import numpy as np
import numpy.typing as npt

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
HAND_BAKE_SCRIPT = SCRIPTS_DIR / "bake_hand_sdf.py"
NOTES_DIR = REPO_ROOT / "docs" / "dev-notes" / "2026-08-18-blender-sdf-grid"

BLENDER_MINIMUM = (5, 2)
BLENDER_MAXIMUM_EXCLUSIVE = (5, 3)
DEFAULT_VOXEL_SIZE_M = 0.01
DEFAULT_BAND_WIDTH = 6                 # band_depth = 0.06 m at the default pitch
GRID_NAME = "sdf"
FIELD_DTYPE = "<f4"                    # dense result values, little endian

# --- array-mesh adapter ceilings (rejected BEFORE Blender is launched) ----
MAX_MESHES = 8
MAX_VERTICES_PER_MESH = 250_000
MAX_TRIANGLES_PER_MESH = 500_000
MAX_DENSE_VOXELS = 16_000_000
BLENDER_TIMEOUT_S = 300

# Rigid source->grid transform identity, in row-major (row-vector-last) form.
IDENTITY_4X4: tuple[tuple[float, float, float, float], ...] = (
    (1.0, 0.0, 0.0, 0.0),
    (0.0, 1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
)

# Byte formats pinned into every payload hash; changing one changes the hash.
PAYLOAD_FORMATS = {
    "verticesFormat": "f64le",
    "trianglesFormat": "u32le",
    "vertexOrder": "x-y-z",
    "faceKind": "triangles",
}

# Node identifiers that MUST be registered before anything else runs.
REQUIRED_NODES = (
    "GeometryNodeMeshToSDFGrid",
    "GeometryNodeSDFGridBoolean",
    "GeometryNodeGridToMesh",
    "GeometryNodeStoreNamedGrid",
)


# ===========================================================================
# Route enum + import-safe frozen request/result dataclasses (before any bpy)
# ===========================================================================

class SdfGridRoute:
    """The two allowed result routes. Never a silent choice."""

    DIRECT_VDB: Literal["direct-vdb"] = "direct-vdb"
    GRID_TO_MESH_LIBIGL: Literal["grid-to-mesh-libigl"] = "grid-to-mesh-libigl"
    ALL = (DIRECT_VDB, GRID_TO_MESH_LIBIGL)

    @staticmethod
    def selected_default() -> str:
        """The route the qualification selects when both are available."""
        return SdfGridRoute.DIRECT_VDB

    @staticmethod
    def check(route: str) -> str:
        if route not in SdfGridRoute.ALL:
            raise ValueError(f"unknown route {route!r}; allowed {SdfGridRoute.ALL}")
        return route


@dataclasses.dataclass(frozen=True)
class MeshInput:
    """One analytic source mesh in Blender world (metre) space.

    kind      'cube' (edge length size) or 'sphere' (diameter size)
    location  object translation, metres
    rotation_euler  XYZ Euler rotation, radians
    """

    kind: Literal["cube", "sphere"] = "cube"
    size: float = 0.1
    location: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation_euler: tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclasses.dataclass(frozen=True, eq=False)
class MeshArrayInput:
    """One caller-supplied conventional triangle mesh, in array form.

    `source_to_grid_m` maps source coordinates into the adapter's common
    grid-local metre basis. Translation and a PROPER rotation are allowed;
    scale, shear, and reflection are rejected, because the caller must strip
    source scene scale and declare a rigid metre-space frame before baking.
    Array fields are never mutated: canonicalize_mesh_array() always returns
    owned, C-contiguous, little-endian copies.
    """

    label: str
    vertices_m: npt.NDArray[np.floating]
    triangles: npt.NDArray[np.integer]
    source_sha256: str
    source_to_grid_m: tuple[tuple[float, float, float, float], ...] = IDENTITY_4X4


@dataclasses.dataclass(frozen=True)
class SdfGridSpec:
    """Every grid parameter that the node graph must be given explicitly.

    The dense output lattice is endpoint-inclusive: sample index i sits at
    bounds_min_m + i * voxel_size_m, so voxel = extent / (dims - 1).
    """

    voxel_size_m: float = DEFAULT_VOXEL_SIZE_M
    band_width: int = DEFAULT_BAND_WIDTH
    grid_name: str = GRID_NAME
    threshold: float = 0.0             # Grid to Mesh (fallback route only)
    adaptivity: float = 0.0            # Grid to Mesh (fallback route only)
    interpolation: str = "trilinear"   # dense conversion of the level set
    bounds_min_m: tuple[float, float, float] = (-0.12, -0.12, -0.12)
    bounds_max_m: tuple[float, float, float] = (0.12, 0.12, 0.12)
    dimensions: tuple[int, int, int] = (25, 25, 25)

    @staticmethod
    def analytic_default() -> "SdfGridSpec":
        """0.1 m cube fixture lattice: 25^3 samples at exactly 1 cm pitch."""
        return SdfGridSpec()

    def voxel_measured(self) -> tuple[float, float, float]:
        return tuple(                                   # type: ignore[return-value]
            (b - a) / (n - 1)
            for a, b, n in zip(self.bounds_min_m, self.bounds_max_m, self.dimensions)
        )


@dataclasses.dataclass(frozen=True)
class SdfGridRequest:
    spec: SdfGridSpec
    meshes: tuple[MeshInput, ...]
    operation: Literal["single", "union", "intersection"] = "single"
    route: str = SdfGridRoute.DIRECT_VDB
    blender_bin: str | None = None     # None -> resolve from PATH/$BLENDER_BIN


@dataclasses.dataclass(frozen=True)
class DenseSdfResult:
    """The shared dense output contract for BOTH routes (plan-pinned fields)."""

    route: str
    dimensions: tuple[int, int, int]
    bounds_min_m: tuple[float, float, float]
    bounds_max_m: tuple[float, float, float]
    voxel_size_m: tuple[float, float, float]
    values_f32: npt.NDArray[np.float32]        # field[z, y, x], x fastest
    source_sha256: str
    node_contract_sha256: str

    # -- pinned index-to-metre transform -----------------------------------

    def index_to_metres(self, idx: Sequence[int]) -> tuple[float, float, float]:
        return tuple(                                # type: ignore[return-value]
            lo + i * v for i, lo, v in
            zip(idx, self.bounds_min_m, self.voxel_size_m))

    def metres_to_index(self, p: Sequence[float]) -> tuple[float, float, float]:
        return tuple((c - lo) / v for c, lo, v in
                     zip(p, self.bounds_min_m, self.voxel_size_m))

    def sample(self, p: Sequence[float]) -> float:
        """Trilinear sample of the dense field; clamps outside the bounds.

        This is the route-agnostic readout used by the analytic gates; it
        deliberately never extrapolates (a distance field outside the baked
        window is undefined, and clamping keeps the sign contract honest).
        """
        f = self.metres_to_index(p)
        cx = min(max(f[0], 0.0), self.dimensions[0] - 1.0)
        cy = min(max(f[1], 0.0), self.dimensions[1] - 1.0)
        cz = min(max(f[2], 0.0), self.dimensions[2] - 1.0)
        x0, y0, z0 = int(math.floor(cx)), int(math.floor(cy)), int(math.floor(cz))
        x1, y1, z1 = min(x0 + 1, self.dimensions[0] - 1), \
            min(y0 + 1, self.dimensions[1] - 1), min(z0 + 1, self.dimensions[2] - 1)
        ax, ay, az = cx - x0, cy - y0, cz - z0
        g = self.values_f32
        c000 = float(g[z0, y0, x0]); c100 = float(g[z0, y0, x1])
        c010 = float(g[z0, y1, x0]); c110 = float(g[z0, y1, x1])
        c001 = float(g[z1, y0, x0]); c101 = float(g[z1, y0, x1])
        c011 = float(g[z1, y1, x0]); c111 = float(g[z1, y1, x1])
        return float(
            c000 * (1 - ax) * (1 - ay) * (1 - az) + c100 * ax * (1 - ay) * (1 - az) +
            c010 * (1 - ax) * ay * (1 - az) + c110 * ax * ay * (1 - az) +
            c001 * (1 - ax) * (1 - ay) * az + c101 * ax * (1 - ay) * az +
            c011 * (1 - ax) * ay * az + c111 * ax * ay * az)


# ===========================================================================
# Canonical JSON / hashing / lattice helpers (pure, shared by both roles)
# ===========================================================================

def canonical_json(obj: Any) -> str:
    """Deterministic JSON text: sorted keys, tight separators, no NaN."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hex64(value: str, what: str) -> str:
    if len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ValueError(f"{what} is not a lowercase hex sha256: {value!r}")
    return value


def blender_executable(override: str | None = None) -> str:
    env = override or os.environ.get("BLENDER_BIN")
    resolved = env or shutil.which("blender")
    if not resolved:
        raise FileNotFoundError(
            "no blender binary: add one to PATH or set BLENDER_BIN")
    return resolved


def lattice_points(bounds_min: Sequence[float], bounds_max: Sequence[float],
                   dimensions: Sequence[int]) -> npt.NDArray[np.float64]:
    """Dense query points, x fastest then y then z (exactly the stored order).

    p = bounds_min + index * voxel in float64 -- the SAME explicit formula the
    inner Blender process uses, so both roles enumerate one identical lattice.
    """
    dims = tuple(int(n) for n in dimensions)
    if min(dims) < 2:
        raise ValueError(f"dimensions {dims} must be >= 2 per axis")
    voxel = tuple((b - a) / (n - 1) for a, b, n in
                  zip(bounds_min, bounds_max, dims))
    nx, ny, nz = dims
    xi = np.arange(nx, dtype=np.float64)
    yi = np.arange(ny, dtype=np.float64)
    zi = np.arange(nz, dtype=np.float64)
    xs = bounds_min[0] + xi * voxel[0]
    ys = bounds_min[1] + yi * voxel[1]
    zs = bounds_min[2] + zi * voxel[2]
    zz, yy, xx = np.meshgrid(zs, ys, xs, indexing="ij")
    return np.column_stack((xx.ravel(), yy.ravel(), zz.ravel()))


def build_node_contract(spec: SdfGridSpec) -> dict[str, Any]:
    """Canonical node-graph contract: nothing may come from a UI default."""
    return {
        "blenderVersionConstraint": "5.2.x",
        "operationNodes": {
            "meshToSdfGrid": "GeometryNodeMeshToSDFGrid",
            "sdfGridBoolean": "GeometryNodeSDFGridBoolean (registered, UNUSED: "
                              "evaluates to Grid 2 only in Blender 5.2.0)",
            "gridToMesh": "GeometryNodeGridToMesh",
            "storeNamedGrid": "GeometryNodeStoreNamedGrid",
            "getNamedGrid": "GeometryNodeGetNamedGrid",
            "joinGeometry": "GeometryNodeJoinGeometry",
            "bake": "GeometryNodeBake",
        },
        "composition": {
            "single": "object-info -> mesh-to-sdf-grid",
            "union": "mesh-to-sdf-grid x2 -> store-named-grid+bake(DISK) per "
                     "grid -> openvdb read x2 -> combine(min)",
            "intersection": "mesh-to-sdf-grid x2 -> store-named-grid+bake(DISK) "
                            "per grid -> openvdb read x2 -> combine(max)",
        },
        "units": "metres",
        "basis": "right-handed-y-up-blender",
        "signConvention": "negative-inside-positive-outside",
        "voxelSizeM": spec.voxel_size_m,
        "bandWidth": spec.band_width,
        "backgroundM": spec.band_width * spec.voxel_size_m,
        "gridName": spec.grid_name,
        "threshold": spec.threshold,
        "adaptivity": spec.adaptivity,
        "interpolation": spec.interpolation,
        "indexToMetres": {
            "formula": "p = bounds_min_m + index * voxel_size_m",
            "basis": "right-handed-y-up-blender",
            "originM": list(spec.bounds_min_m),
            "voxelSizeM": list(spec.voxel_measured()),
            "dimensions": list(spec.dimensions),
            "endpointInclusive": True,
        },
        "bake": {
            "bakeTarget": "DISK",
            "useCustomPath": True,
            "operator": "bpy.ops.object.geometry_node_bake_single",
        },
    }


def validate_dense_sdf(result: DenseSdfResult) -> dict[str, Any]:
    """Reject a dense result that breaks the metre-space SDF contract."""
    SdfGridRoute.check(result.route)
    dims = tuple(int(n) for n in result.dimensions)
    if len(dims) != 3 or min(dims) < 2:
        raise ValueError(f"dimensions {dims} invalid")
    lo = tuple(float(v) for v in result.bounds_min_m)
    hi = tuple(float(v) for v in result.bounds_max_m)
    if not all(math.isfinite(v) for v in lo) or not all(math.isfinite(v) for v in hi):
        raise ValueError("bounds not finite")
    if any(b <= a for a, b in zip(lo, hi)):
        raise ValueError(f"bounds not strictly ordered: {lo} .. {hi}")
    field = np.asarray(result.values_f32)
    if field.dtype != np.float32:
        raise ValueError(f"values dtype {field.dtype} != float32")
    if tuple(field.shape) != (dims[2], dims[1], dims[0]):
        raise ValueError(f"values shape {field.shape} != z,y,x {(dims[2], dims[1], dims[0])}")
    if not np.isfinite(field).all():
        raise ValueError("field contains non-finite samples")
    negatives = int((field < 0.0).sum())
    positives = int((field > 0.0).sum())
    if negatives == 0:
        raise ValueError("field has no inside (negative) samples")
    if positives == 0:
        raise ValueError("field has no outside (positive) samples")
    faces = (field[0, :, :], field[-1, :, :], field[:, 0, :], field[:, -1, :],
             field[:, :, 0], field[:, :, -1])
    worst = min(float(f.min()) for f in faces)
    if worst <= 0.0:
        raise ValueError(f"AABB boundary not wholly outside: min {worst:.6f}")
    voxel = tuple(float(v) for v in result.voxel_size_m)
    want = tuple((b - a) / (n - 1) for a, b, n in zip(lo, hi, dims))
    if any(abs(v - w) > 1e-9 + 1e-6 * abs(w) for v, w in zip(voxel, want)):
        raise ValueError(f"voxel {voxel} inconsistent with bounds/dims {want}")
    hex64(result.source_sha256, "source_sha256")
    hex64(result.node_contract_sha256, "node_contract_sha256")
    return {
        "min": float(field.min()), "max": float(field.max()),
        "negatives": negatives, "positives": positives,
        "boundaryMin": worst,
        "negativeFraction": negatives / field.size,
    }


def result_metrics(result: DenseSdfResult) -> dict[str, Any]:
    """Canonical comparison payload for the determinism gate (no timings)."""
    return {
        "route": result.route,
        "dimensions": list(result.dimensions),
        "boundsMinM": list(result.bounds_min_m),
        "boundsMaxM": list(result.bounds_max_m),
        "voxelSizeM": list(result.voxel_size_m),
        "sourceSha256": result.source_sha256,
        "nodeContractSha256": result.node_contract_sha256,
        "r16fSha256": sha256_bytes(encode_r16f_bytes(result)),
    }


def encode_r16f_bytes(result: DenseSdfResult) -> bytes:
    """Little-endian float16, x fastest (C order) -- Blud's R16F encoding."""
    return np.ascontiguousarray(result.values_f32).astype("<f2").tobytes("C")


def count_negative_components(result: DenseSdfResult) -> int:
    """6-connected components of the negative (inside) region."""
    mask = result.values_f32 < 0.0
    seen = np.zeros(mask.shape, dtype=bool)
    nz, ny, nx = mask.shape
    count = 0
    for z0 in range(nz):
        for y0 in range(ny):
            for x0 in range(nx):
                if not mask[z0, y0, x0] or seen[z0, y0, x0]:
                    continue
                count += 1
                stack = [(z0, y0, x0)]
                seen[z0, y0, x0] = True
                while stack:
                    z, y, x = stack.pop()
                    for dz, dy, dx in ((1, 0, 0), (-1, 0, 0), (0, 1, 0),
                                       (0, -1, 0), (0, 0, 1), (0, 0, -1)):
                        zz, yy, xx = z + dz, y + dy, x + dx
                        if (0 <= zz < nz and 0 <= yy < ny and 0 <= xx < nx
                                and mask[zz, yy, xx] and not seen[zz, yy, xx]):
                            seen[zz, yy, xx] = True
                            stack.append((zz, yy, xx))
    return count


# ===========================================================================
# Public array-mesh contract: canonicalization, payload bytes, request guards
# ===========================================================================

def _check_label(label: Any) -> str:
    if not isinstance(label, str):
        raise ValueError(f"mesh label must be a string, got {type(label).__name__}")
    stripped = label.strip()
    if not stripped:
        raise ValueError("mesh label must not be empty")
    return stripped


def _validate_rigid_transform(transform: Any) -> tuple[tuple[float, ...], ...]:
    """Accept only a finite 4x4 affine whose 3x3 block is a proper rotation."""
    try:
        matrix = np.asarray(transform, dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"source_to_grid_m transform must be 4x4: {exc}") from exc
    if matrix.shape != (4, 4):
        raise ValueError(
            f"source_to_grid_m transform must be 4x4, got shape {matrix.shape}")
    if not np.isfinite(matrix).all():
        raise ValueError("source_to_grid_m transform contains non-finite values")
    if not np.allclose(matrix[3], (0.0, 0.0, 0.0, 1.0), rtol=0.0, atol=1e-9):
        raise ValueError(
            f"source_to_grid_m transform final row must be (0, 0, 0, 1), "
            f"got {tuple(matrix[3])}")
    rot = matrix[:3, :3]
    if not np.allclose(rot.T @ rot, np.eye(3), rtol=0.0, atol=1e-6) or \
            abs(float(np.linalg.det(rot)) - 1.0) > 1e-6:
        raise ValueError(
            "source_to_grid_m transform rotation is not a proper rigid rotation "
            "(scale, shear, and reflection are rejected)")
    return tuple(tuple(float(v) for v in row) for row in matrix)


def _is_canonical_mesh_array(mesh: Any) -> bool:
    """O(1) check: already the exact owned/little-endian/tuple canonical form."""
    if not isinstance(mesh, MeshArrayInput):
        return False
    v, f = mesh.vertices_m, mesh.triangles
    return (isinstance(v, np.ndarray) and isinstance(f, np.ndarray)
            and v.dtype.str == "<f8" and f.dtype.str == "<u4"
            and v.flags.c_contiguous and f.flags.c_contiguous
            and v.flags.owndata and f.flags.owndata
            and isinstance(mesh.source_to_grid_m, tuple)
            and len(mesh.source_to_grid_m) == 4
            and all(isinstance(r, tuple) for r in mesh.source_to_grid_m)
            and isinstance(mesh.label, str) and mesh.label == mesh.label.strip()
            and bool(mesh.label))


def canonicalize_mesh_array(mesh: MeshArrayInput) -> MeshArrayInput:
    """Validate a public array mesh and return an owned canonical copy.

    Checks run cheapest-first (shape, emptiness, ceilings, then content) so a
    rejected oversized input never pays for a full finite/index scan. All work
    is vectorized O(V + F); no vertex is ever compared against every face.
    The caller's arrays are never written to.
    """
    if not isinstance(mesh, MeshArrayInput):
        raise ValueError(f"expected MeshArrayInput, got {type(mesh).__name__}")
    label = _check_label(mesh.label)
    source_sha = hex64(str(mesh.source_sha256), "source_sha256")
    transform = _validate_rigid_transform(mesh.source_to_grid_m)

    vertices = np.asarray(mesh.vertices_m)
    triangles = np.asarray(mesh.triangles)
    if vertices.ndim != 2 or vertices.shape[1] != 3:
        raise ValueError(
            f"vertices must have shape (V, 3), got {vertices.shape}")
    if triangles.ndim != 2 or triangles.shape[1] != 3:
        raise ValueError(
            f"triangles must have shape (F, 3), got {triangles.shape}")
    if vertices.shape[0] == 0:
        raise ValueError("vertices array is empty")
    if triangles.shape[0] == 0:
        raise ValueError("triangles array is empty")
    if vertices.shape[0] > MAX_VERTICES_PER_MESH:
        raise ValueError(
            f"mesh {label!r} vertex count {vertices.shape[0]} exceeds limit "
            f"{MAX_VERTICES_PER_MESH}")
    if triangles.shape[0] > MAX_TRIANGLES_PER_MESH:
        raise ValueError(
            f"mesh {label!r} triangle count {triangles.shape[0]} exceeds limit "
            f"{MAX_TRIANGLES_PER_MESH}")

    if not np.issubdtype(vertices.dtype, np.floating):
        raise ValueError(f"vertices dtype {vertices.dtype} is not floating point")
    # An explicit copy, never np.ascontiguousarray: that ALIASES an input that
    # is already <f8 and C-contiguous, so the canonical mesh would share memory
    # with (and inherit the writeability/ownership of) the caller's array.
    verts64 = np.array(vertices, dtype="<f8", order="C", copy=True)
    if not np.isfinite(verts64).all():
        raise ValueError(f"mesh {label!r} vertices contain non-finite values")

    if not np.issubdtype(triangles.dtype, np.integer):
        raise ValueError(f"triangles dtype {triangles.dtype} is not integral")
    tri64 = np.array(triangles, dtype=np.int64, order="C", copy=True)
    if int(tri64.min()) < 0 or int(tri64.max()) >= verts64.shape[0]:
        raise ValueError(
            f"mesh {label!r} triangle indices out of range [0, "
            f"{verts64.shape[0]}): [{int(tri64.min())}, {int(tri64.max())}]")
    degenerate = ((tri64[:, 0] == tri64[:, 1]) | (tri64[:, 1] == tri64[:, 2])
                  | (tri64[:, 2] == tri64[:, 0]))
    if bool(degenerate.any()):
        first = int(np.argmax(degenerate))
        raise ValueError(
            f"mesh {label!r} has {int(degenerate.sum())} degenerate triangle(s); "
            f"first at row {first}: {tuple(int(i) for i in tri64[first])}")

    return MeshArrayInput(
        label=label,
        vertices_m=verts64,
        triangles=np.array(tri64, dtype="<u4", order="C", copy=True),
        source_sha256=source_sha,
        source_to_grid_m=transform,
    )


def mesh_payload_hash(mesh: MeshArrayInput) -> str:
    """SHA-256 over geometry bytes, label, upstream source, and transform."""
    canonical = mesh if _is_canonical_mesh_array(mesh) else \
        canonicalize_mesh_array(mesh)
    vertices_bytes = canonical.vertices_m.tobytes("C")
    triangles_bytes = canonical.triangles.tobytes("C")
    return sha256_text(canonical_json({
        **PAYLOAD_FORMATS,
        "label": canonical.label,
        "vertexCount": int(canonical.vertices_m.shape[0]),
        "triangleCount": int(canonical.triangles.shape[0]),
        "verticesSha256": sha256_bytes(vertices_bytes),
        "trianglesSha256": sha256_bytes(triangles_bytes),
        "sourceSha256": canonical.source_sha256,
        "sourceToGridM": [list(row) for row in canonical.source_to_grid_m],
    }))


@dataclasses.dataclass(frozen=True)
class MeshPayloadDescriptor:
    """One array mesh as it crosses the outer -> inner process boundary.

    File names are RELATIVE to request.json; an absolute temporary path never
    enters a canonical hash, so the same geometry hashes identically in every
    temporary directory.
    """

    label: str
    vertex_count: int
    triangle_count: int
    vertices_file: str
    triangles_file: str
    vertices_sha256: str
    triangles_sha256: str
    source_sha256: str
    source_to_grid_m: tuple[tuple[float, float, float, float], ...]
    payload_sha256: str


def descriptor_to_json(descriptor: MeshPayloadDescriptor) -> dict[str, Any]:
    """The tagged request entry the inner Blender loader consumes."""
    return {
        "kind": "array-payload",
        "label": descriptor.label,
        "vertexCount": int(descriptor.vertex_count),
        "triangleCount": int(descriptor.triangle_count),
        "verticesFile": descriptor.vertices_file,
        "trianglesFile": descriptor.triangles_file,
        "verticesSha256": descriptor.vertices_sha256,
        "trianglesSha256": descriptor.triangles_sha256,
        "sourceSha256": descriptor.source_sha256,
        "sourceToGridM": [list(row) for row in descriptor.source_to_grid_m],
        "payloadSha256": descriptor.payload_sha256,
        **PAYLOAD_FORMATS,
    }


_LABEL_FORBIDDEN = ("/", "\\", ":", "\x00")


def _check_payload_label(label: str) -> str:
    """Labels are evidence, never a path: no separators, no traversal."""
    clean = _check_label(label)
    for ch in _LABEL_FORBIDDEN:
        if ch in clean:
            raise ValueError(
                f"mesh label {label!r} must not contain a path separator ({ch!r})")
    if clean in (".", "..") or clean.startswith(".."):
        raise ValueError(f"mesh label {label!r} must not be a path traversal")
    return clean


def write_mesh_payloads(out_dir: Path, meshes: Sequence[MeshArrayInput],
                        ) -> tuple[MeshPayloadDescriptor, ...]:
    """Write raw little-endian geometry blobs and describe them canonically.

    File names come from the numeric mesh index only. Every blob is read back
    and re-hashed before its descriptor is returned, so a short or corrupted
    write fails here rather than inside Blender.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    descriptors: list[MeshPayloadDescriptor] = []
    for index, mesh in enumerate(meshes):
        canonical = mesh if _is_canonical_mesh_array(mesh) else \
            canonicalize_mesh_array(mesh)
        label = _check_payload_label(canonical.label)
        vertices_file = f"mesh-{index:03d}.vertices.f64le"
        triangles_file = f"mesh-{index:03d}.triangles.u32le"
        vertices_bytes = canonical.vertices_m.tobytes("C")
        triangles_bytes = canonical.triangles.tobytes("C")
        (out_dir / vertices_file).write_bytes(vertices_bytes)
        (out_dir / triangles_file).write_bytes(triangles_bytes)
        vertices_sha = sha256_bytes((out_dir / vertices_file).read_bytes())
        triangles_sha = sha256_bytes((out_dir / triangles_file).read_bytes())
        if vertices_sha != sha256_bytes(vertices_bytes) or \
                triangles_sha != sha256_bytes(triangles_bytes):
            raise RuntimeError(
                f"payload write/read hash mismatch for mesh {label!r} in {out_dir}")
        descriptors.append(MeshPayloadDescriptor(
            label=label,
            vertex_count=int(canonical.vertices_m.shape[0]),
            triangle_count=int(canonical.triangles.shape[0]),
            vertices_file=vertices_file,
            triangles_file=triangles_file,
            vertices_sha256=vertices_sha,
            triangles_sha256=triangles_sha,
            source_sha256=canonical.source_sha256,
            source_to_grid_m=canonical.source_to_grid_m,
            payload_sha256=mesh_payload_hash(canonical),
        ))
    return tuple(descriptors)


def validate_adapter_request(meshes: Sequence[MeshArrayInput],
                             spec: SdfGridSpec) -> tuple[MeshArrayInput, ...]:
    """Reject every resource/contract violation BEFORE Blender is launched.

    Operation-specific arity (union needs >= 2, intersection needs exactly 2)
    stays with the public adapters; this helper is the shared gate.
    """
    count = len(meshes)
    if not 1 <= count <= MAX_MESHES:
        raise ValueError(
            f"mesh count {count} outside the allowed range 1..{MAX_MESHES}")
    canonical = tuple(canonicalize_mesh_array(m) for m in meshes)

    dims = tuple(int(n) for n in spec.dimensions)
    if len(dims) != 3 or min(dims) < 2:
        raise ValueError(f"dimensions {dims} must be >= 2 on every axis")
    lo = tuple(float(v) for v in spec.bounds_min_m)
    hi = tuple(float(v) for v in spec.bounds_max_m)
    if not all(math.isfinite(v) for v in lo + hi):
        raise ValueError(f"bounds not finite: {lo} .. {hi}")
    if any(b <= a for a, b in zip(lo, hi)):
        raise ValueError(f"bounds not strictly ordered: {lo} .. {hi}")

    voxels = int(dims[0]) * int(dims[1]) * int(dims[2])
    if voxels > MAX_DENSE_VOXELS:
        raise ValueError(
            f"dense voxel count {voxels} for dimensions {dims} exceeds limit "
            f"{MAX_DENSE_VOXELS}")

    want = float(spec.voxel_size_m)
    measured = tuple(float(v) for v in spec.voxel_measured())
    if any(abs(v - want) > 1e-9 + 1e-6 * abs(want) for v in measured):
        raise ValueError(
            f"declared voxel size {want} disagrees with measured {measured}")
    return canonical


def closed_box_mesh(minimum: Sequence[float], maximum: Sequence[float],
                    ) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.int64]]:
    """A closed, outward-wound axis-aligned box: 8 vertices, 12 triangles.

    Intersection support primitives MUST be closed, so this is the one shared
    generator for every support/continuation volume the adapters and the real
    source qualifier build.
    """
    lo = tuple(float(v) for v in minimum)
    hi = tuple(float(v) for v in maximum)
    if len(lo) != 3 or len(hi) != 3:
        raise ValueError(f"box bounds must be 3-vectors, got {lo} .. {hi}")
    if not all(math.isfinite(v) for v in lo + hi):
        raise ValueError(f"box bounds not finite: {lo} .. {hi}")
    if any(b <= a for a, b in zip(lo, hi)):
        raise ValueError(f"box bounds not strictly ordered: {lo} .. {hi}")
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    vertices = np.array([
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ], dtype=np.float64)
    faces = np.array([
        [0, 2, 1], [0, 3, 2],          # -z
        [4, 5, 6], [4, 6, 7],          # +z
        [0, 1, 5], [0, 5, 4],          # -y
        [3, 7, 6], [3, 6, 2],          # +y
        [0, 4, 7], [0, 7, 3],          # -x
        [1, 2, 6], [1, 6, 5],          # +x
    ], dtype=np.int64)
    return vertices, faces


def _resolve_payload_file(request_dir: Path, name: Any) -> Path:
    """Payload names are plain sibling file names -- never paths."""
    if not isinstance(name, str) or not name:
        raise ValueError(f"payload file name must be a non-empty string: {name!r}")
    if name != Path(name).name or name in (".", "..") or ".." in name \
            or "/" in name or "\\" in name or Path(name).is_absolute():
        raise ValueError(
            f"payload file {name!r} must be a plain name beside request.json")
    resolved = (Path(request_dir) / name).resolve()
    if resolved.parent != Path(request_dir).resolve():
        raise ValueError(f"payload file {name!r} escapes the request directory")
    if not resolved.is_file():
        raise ValueError(f"payload file {name!r} does not exist in {request_dir}")
    return resolved


def _read_payload_blob(request_dir: Path, name: Any, expect_bytes: int,
                       expect_sha: Any, what: str) -> bytes:
    path = _resolve_payload_file(request_dir, name)
    blob = path.read_bytes()
    if len(blob) != expect_bytes:
        raise ValueError(
            f"{what} payload size {len(blob)} != declared {expect_bytes} bytes "
            f"({name})")
    actual = sha256_bytes(blob)
    if actual != hex64(str(expect_sha), f"{what}Sha256"):
        raise ValueError(f"{what} payload hash mismatch for {name}: {actual}")
    return blob


def load_mesh_payload(request_dir: Path, entry: dict[str, Any]) -> MeshArrayInput:
    """Inner-side loader: verify bytes, revalidate, apply the transform ONCE.

    The returned mesh is already expressed in the common grid-local metre
    basis, so its transform is the identity: nothing downstream may apply
    `sourceToGridM` a second time.
    """
    if entry.get("kind") != "array-payload":
        raise ValueError(f"not an array payload entry: {entry.get('kind')!r}")
    vertex_count = int(entry["vertexCount"])
    triangle_count = int(entry["triangleCount"])
    if vertex_count <= 0 or triangle_count <= 0:
        raise ValueError(
            f"payload counts must be positive: {vertex_count}, {triangle_count}")
    vertices_blob = _read_payload_blob(
        request_dir, entry["verticesFile"], 8 * 3 * vertex_count,
        entry["verticesSha256"], "vertices")
    triangles_blob = _read_payload_blob(
        request_dir, entry["trianglesFile"], 4 * 3 * triangle_count,
        entry["trianglesSha256"], "triangles")
    vertices = np.frombuffer(vertices_blob, dtype="<f8").reshape(vertex_count, 3)
    triangles = np.frombuffer(triangles_blob, dtype="<u4").reshape(triangle_count, 3)
    canonical = canonicalize_mesh_array(MeshArrayInput(
        label=str(entry["label"]),
        vertices_m=vertices,
        triangles=triangles,
        source_sha256=str(entry["sourceSha256"]),
        source_to_grid_m=tuple(tuple(float(v) for v in row)
                               for row in entry["sourceToGridM"]),
    ))
    declared = hex64(str(entry["payloadSha256"]), "payloadSha256")
    actual = mesh_payload_hash(canonical)
    if actual != declared:
        raise ValueError(
            f"payload hash mismatch for {canonical.label!r}: {actual} != {declared}")
    matrix = np.asarray(canonical.source_to_grid_m, dtype=np.float64)
    placed = canonical.vertices_m @ matrix[:3, :3].T + matrix[:3, 3]
    return canonicalize_mesh_array(dataclasses.replace(
        canonical, vertices_m=placed, source_to_grid_m=IDENTITY_4X4))


def check_route_agreement(requested: str, payload: dict[str, Any]) -> str:
    """A route is always explicit: the inner result must be the one asked for."""
    route = SdfGridRoute.check(payload["dense"]["route"])
    if route != SdfGridRoute.check(requested):
        raise RuntimeError(
            f"route drift: requested {requested}, inner returned {route}")
    return route


def adapter_operation_hash(operation: str,
                           descriptors: Sequence[MeshPayloadDescriptor],
                           route: str, spec: SdfGridSpec) -> str:
    """Identity of one array-backed bake: operation, operands, route, lattice."""
    return sha256_text(canonical_json({
        "operation": operation,
        "route": SdfGridRoute.check(route),
        "payloadSha256": [d.payload_sha256 for d in descriptors],
        "grid": grid_to_json(spec),
    }))


# ===========================================================================
# Analytic fixtures (shared by outer requests and their reference distances)
# ===========================================================================

@dataclasses.dataclass(frozen=True)
class Fixture:
    meshes: tuple[MeshInput, ...]
    operation: str
    margin_m: float
    label: str


FIXTURES: dict[str, Fixture] = {
    "cube": Fixture((MeshInput("cube", 0.1),), "single", 0.07, "0.1 m cube"),
    "cube-large": Fixture((MeshInput("cube", 0.2),), "single", 0.04,
                          "0.2 m deep-interior topology probe"),
    "sphere": Fixture((MeshInput("sphere", 0.1),), "single", 0.07,
                      "0.1 m sphere"),
    "union-pair": Fixture(
        (MeshInput("cube", 0.1, (-0.03, 0.0, 0.0)),
         MeshInput("cube", 0.1, (0.03, 0.0, 0.0))), "union", 0.04,
        "overlapping pair union"),
    "body-support-intersect": Fixture(
        (MeshInput("cube", 0.1), MeshInput("sphere", 0.06, (0.0, 0.0, -0.015))),
        "intersection", 0.07, "body cube intersected by support sphere"),
    "rotated-cube": Fixture(
        (MeshInput("cube", 0.1, (0.0, 0.0, 0.0), (0.0, 0.0, math.radians(30.0))),),
        "single", 0.0493, "cube rotated 30 deg about Z"),
    "translated-cube": Fixture(
        (MeshInput("cube", 0.1, (0.02, -0.01, 0.03)),), "single", 0.05,
        "cube translated (0.02, -0.01, 0.03)"),
}


def mesh_aabb(mesh: MeshInput) -> tuple[tuple[float, float, float],
                                        tuple[float, float, float]]:
    half = mesh.size / 2.0
    if mesh.kind == "sphere":
        axis = (half, half, half)
    else:
        rz = _rot_z_aabb_half(mesh.rotation_euler[2], half)
        axis = (rz, rz, half)
    return ((mesh.location[0] - axis[0], mesh.location[1] - axis[1],
             mesh.location[2] - axis[2]),
            (mesh.location[0] + axis[0], mesh.location[1] + axis[1],
             mesh.location[2] + axis[2]))


def _rot_z_aabb_half(angle: float, half: float) -> float:
    c, s = abs(math.cos(angle)), abs(math.sin(angle))
    return half * (c + s)


def fixture_bounds(shape: str, voxel_size_m: float = DEFAULT_VOXEL_SIZE_M
                   ) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """AABB + margin, snapped OUTWARD-IN to the voxel-pitch grid.

    Snapping to pitch multiples keeps the dense lattice anchored on the same
    centimetre grid the analytic fixtures (and Blender's mesh-AABB-anchored
    level-set voxels) use, so aligned fixtures read exact stored values.
    """
    fix = FIXTURES[shape]
    if fix.operation == "intersection":
        lo, hi = mesh_aabb(fix.meshes[0])          # intersection lies in body AABB
    else:
        los, his = zip(*(mesh_aabb(m) for m in fix.meshes))
        lo = tuple(min(v) for v in zip(*los))
        hi = tuple(max(v) for v in zip(*his))
    m = fix.margin_m
    v = voxel_size_m
    # ceil/floor with a tiny epsilon so 12.000000000000002 snaps to 12, not 13
    lo2 = tuple(float(np.ceil((a - m) / v - 1e-9)) * v for a in lo)
    hi2 = tuple(float(np.floor((b + m) / v + 1e-9)) * v for b in hi)
    return lo2, hi2


def fixture_spec(shape: str, voxel_size_m: float = DEFAULT_VOXEL_SIZE_M,
                 band_width: int = DEFAULT_BAND_WIDTH) -> SdfGridSpec:
    lo, hi = fixture_bounds(shape, voxel_size_m)
    dims = []
    for a, b in zip(lo, hi):
        extent = (b - a)
        dims.append(int(np.ceil(extent / voxel_size_m - 1e-9)) + 1)
    return SdfGridSpec(
        voxel_size_m=voxel_size_m, band_width=band_width,
        bounds_min_m=(lo[0], lo[1], lo[2]), bounds_max_m=(hi[0], hi[1], hi[2]),
        dimensions=(dims[0], dims[1], dims[2]))


def analytic_reference(shape: str, p: Sequence[float], voxel_m: float
                       ) -> tuple[float, bool] | None:
    """Reference signed distance + exactness flag for a fixture point.

    single/union references are exact CSG distances. For intersection,
    max(d1, d2) is only exact where the point is safely inside one operand
    (near the dominant surface); those points carry exact=False otherwise.
    """
    x, y, z = float(p[0]), float(p[1]), float(p[2])
    fix = FIXTURES[shape]
    ds = []
    for m in fix.meshes:
        if m.kind == "sphere":
            cx, cy, cz = m.location
            r = m.size / 2.0
            ds.append(math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r)
        else:
            lx = _inverse_rot_z(x - m.location[0], y - m.location[1],
                                m.rotation_euler[2])
            lz = z - m.location[2]
            half = m.size / 2.0
            q = (abs(lx[0]) - half, abs(lx[1]) - half, abs(lz) - half)
            outside = math.sqrt(sum(max(c, 0.0) ** 2 for c in q))
            # inside depth = distance to the nearest face = max of the (all
            # negative) axis slacks; the exact box SDF is negative inside
            ds.append(outside if outside > 0.0 else max(q))
    if fix.operation == "single":
        return ds[0], True
    if fix.operation == "union":
        return min(ds), True
    exact = min(ds) < -voxel_m          # safely inside one operand
    return max(ds), exact


def _inverse_rot_z(x: float, y: float, a: float) -> tuple[float, float]:
    c, s = math.cos(a), math.sin(a)
    return (x * c + y * s, -x * s + y * c)


# ===========================================================================
# Outer -> inner process boundary
# ===========================================================================

def grid_to_json(spec: SdfGridSpec) -> dict[str, Any]:
    """The canonical grid block shared by analytic and array-backed requests."""
    return {
        "voxelSizeM": spec.voxel_size_m,
        "bandWidth": spec.band_width,
        "gridName": spec.grid_name,
        "threshold": spec.threshold,
        "adaptivity": spec.adaptivity,
        "interpolation": spec.interpolation,
        "boundsMinM": list(spec.bounds_min_m),
        "boundsMaxM": list(spec.bounds_max_m),
        "dimensions": list(spec.dimensions),
    }


def request_to_json(request: SdfGridRequest) -> dict[str, Any]:
    return {
        "mode": "bake",
        "operation": request.operation,
        "route": SdfGridRoute.check(request.route),
        "grid": grid_to_json(request.spec),
        "meshes": [{
            "kind": m.kind,
            "size": m.size,
            "location": list(m.location),
            "rotationEuler": list(m.rotation_euler),
        } for m in request.meshes],
    }


def _run_blender_pipeline(request_json: dict[str, Any], *,
                          tmp: Path,
                          route: str,
                          spec: SdfGridSpec,
                          source_sha: str,
                          blender_bin: str | None,
                          diagnostics: dict[str, Any] | None,
                          keep_tmp: bool) -> DenseSdfResult:
    """Write the canonical request, run headless Blender, convert the result.

    The single outer runner shared by analytic (`MeshInput`) and array-backed
    (`MeshArrayInput`) requests. It NEVER catches a Route A failure and retries
    Route B: callers ask for a route explicitly and get that route or an error.
    """
    blender = blender_executable(blender_bin)
    req_path = (tmp / "request.json").resolve()
    res_path = (tmp / "result.json").resolve()
    req_path.write_text(canonical_json(request_json))
    contract = build_node_contract(spec)
    contract_sha = sha256_text(canonical_json(contract))
    cmd = [blender, "--background", "--factory-startup",
           "--python", str(Path(__file__).resolve()), "--",
           "--blender-inner", str(req_path), str(res_path)]
    t0 = time.monotonic()
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          timeout=BLENDER_TIMEOUT_S)
    blender_s = time.monotonic() - t0
    if not res_path.exists():
        tail = (proc.stderr or proc.stdout or "")[-4000:]
        raise RuntimeError(
            f"inner Blender run produced no result.json (rc={proc.returncode})\n"
            f"tmp={tmp}\n{tail}")
    payload = json.loads(res_path.read_text())
    if not payload.get("ok"):
        raise RuntimeError(
            f"inner Blender run failed: {payload.get('error', '?')}\ntmp={tmp}")
    if diagnostics is not None:
        diagnostics.update({
            "blenderVersion": payload.get("blenderVersion"),
            "blenderCommand": cmd,
            "tmpDir": str(tmp),
            "keepTmp": keep_tmp,
            "timings": {"blenderS": round(blender_s, 3),
                        **payload.get("timings", {})},
            "nodes": payload.get("nodes", {}),
            "inner": payload,
        })
    resolved = check_route_agreement(route, payload)
    dims = tuple(int(v) for v in payload["dense"]["dimensions"])
    lo = tuple(float(v) for v in payload["dense"]["boundsMinM"])
    hi = tuple(float(v) for v in payload["dense"]["boundsMaxM"])
    voxel = tuple((b - a) / (n - 1) for a, b, n in zip(lo, hi, dims))
    if resolved == SdfGridRoute.DIRECT_VDB:
        values_path = Path(payload["dense"]["valuesPath"])
        blob = values_path.read_bytes()
        if len(blob) != 4 * int(np.prod(dims)):
            raise ValueError("dense float32 blob size mismatch")
        values = np.frombuffer(blob, dtype="<f4").astype(
            np.float32).reshape(dims[2], dims[1], dims[0])
        if diagnostics is not None:
            diagnostics["routeA"] = payload["routeA"]
    else:
        ply_path = Path(payload["routeB"]["plyPath"])
        verts, faces = read_ply_binary(ply_path)
        closed_info = closed_mesh_info(verts, faces)
        if not closed_info["closed"]:
            raise RuntimeError(f"Route B mesh is not closed: {closed_info}")
        if diagnostics is not None:
            diagnostics["routeB"] = {**payload["routeB"], **closed_info}
        values = resample_libigl(verts, faces, lo, hi, dims)
    if not keep_tmp:
        shutil.rmtree(tmp, ignore_errors=True)
        if diagnostics is not None:
            diagnostics["tmpDir"] = None
    return DenseSdfResult(
        route=resolved, dimensions=dims, bounds_min_m=lo, bounds_max_m=hi,
        voxel_size_m=voxel, values_f32=values,
        source_sha256=source_sha, node_contract_sha256=contract_sha)


def run_blender_sdf(request: SdfGridRequest, *,
                    diagnostics: dict[str, Any] | None = None,
                    keep_tmp: bool = True) -> DenseSdfResult:
    """Launch headless Blender on an analytic request and convert the result.

    Temporary .blend/.vdb/.bin/.ply intermediates live in a mkdtemp directory
    outside git. The inner process receives and produces canonical JSON only.
    """
    tmp = Path(tempfile.mkdtemp(prefix="blud-blender-sdf-"))
    request_json = request_to_json(request)
    source_sha = sha256_text(canonical_json(request_json))
    if diagnostics is not None:
        diagnostics.clear()
    return _run_blender_pipeline(
        request_json, tmp=tmp, route=request.route, spec=request.spec,
        source_sha=source_sha, blender_bin=request.blender_bin,
        diagnostics=diagnostics, keep_tmp=keep_tmp)


# ---------------------------------------------------------------------------
# Public array-mesh adapters (the only supported way to bake caller geometry)
# ---------------------------------------------------------------------------

_ADAPTER_ARITY = {
    "union": (2, MAX_MESHES, "union requires at least two meshes"),
    "intersection": (2, 2, "intersection requires exactly two meshes"),
}


def _bake_mesh_arrays(*, operation: str,
                      meshes: tuple[MeshArrayInput, ...],
                      spec: SdfGridSpec,
                      route: str,
                      blender_bin: str | None,
                      keep_tmp: bool,
                      diagnostics: dict[str, Any] | None) -> DenseSdfResult:
    """Canonicalize, freeze payload bytes, and fold OpenVDB level sets."""
    SdfGridRoute.check(route)
    canonical = validate_adapter_request(meshes, spec)
    low, high, message = _ADAPTER_ARITY[operation]
    if not low <= len(canonical) <= high:
        raise ValueError(f"{message}; got {len(canonical)}")

    topology = [closed_mesh_info(m.vertices_m, m.triangles.astype(np.int64))
                for m in canonical]
    tmp = Path(tempfile.mkdtemp(prefix="blud-blender-sdf-adapter-"))
    descriptors = write_mesh_payloads(tmp, canonical)
    request_json = {
        "mode": "bake",
        "operation": operation,
        "route": route,
        "grid": grid_to_json(spec),
        "meshes": [descriptor_to_json(d) for d in descriptors],
    }
    source_sha = adapter_operation_hash(operation, descriptors, route, spec)
    if diagnostics is not None:
        diagnostics.clear()
        diagnostics.update({
            "operation": operation,
            "selectedRoute": route,
            "operationSourceSha256": source_sha,
            "payloads": [descriptor_to_json(d) for d in descriptors],
            "topology": [{"label": m.label, **info}
                         for m, info in zip(canonical, topology)],
            "resources": {
                "meshCount": len(canonical),
                "vertexCounts": [int(m.vertices_m.shape[0]) for m in canonical],
                "triangleCounts": [int(m.triangles.shape[0]) for m in canonical],
                "denseVoxels": int(np.prod(spec.dimensions)),
                "limits": {
                    "maxMeshes": MAX_MESHES,
                    "maxVerticesPerMesh": MAX_VERTICES_PER_MESH,
                    "maxTrianglesPerMesh": MAX_TRIANGLES_PER_MESH,
                    "maxDenseVoxels": MAX_DENSE_VOXELS,
                    "blenderTimeoutS": BLENDER_TIMEOUT_S,
                },
            },
            "tmpDirPolicy": "tempfile.mkdtemp outside git",
        })
    return _run_blender_pipeline(
        request_json, tmp=tmp, route=route, spec=spec, source_sha=source_sha,
        blender_bin=blender_bin, diagnostics=diagnostics, keep_tmp=keep_tmp)


def bake_mesh_union_to_dense(
    meshes: Sequence[MeshArrayInput],
    spec: SdfGridSpec,
    *,
    route: str = SdfGridRoute.DIRECT_VDB,
    blender_bin: str | None = None,
    keep_tmp: bool = False,
    diagnostics: dict[str, Any] | None = None,
) -> DenseSdfResult:
    """Union 2..MAX_MESHES array meshes with an explicit OpenVDB min fold."""
    return _bake_mesh_arrays(
        operation="union", meshes=tuple(meshes), spec=spec, route=route,
        blender_bin=blender_bin, keep_tmp=keep_tmp, diagnostics=diagnostics,
    )


def bake_mesh_intersection_to_dense(
    source: MeshArrayInput,
    support: MeshArrayInput,
    spec: SdfGridSpec,
    *,
    route: str = SdfGridRoute.DIRECT_VDB,
    blender_bin: str | None = None,
    keep_tmp: bool = False,
    diagnostics: dict[str, Any] | None = None,
) -> DenseSdfResult:
    """Clip `source` by a CLOSED `support` volume with an OpenVDB max fold."""
    return _bake_mesh_arrays(
        operation="intersection", meshes=(source, support), spec=spec,
        route=route, blender_bin=blender_bin, keep_tmp=keep_tmp,
        diagnostics=diagnostics,
    )


def run_analytic_fixture(shape: str, *,
                         voxel_size_m: float = DEFAULT_VOXEL_SIZE_M,
                         route: str | None = None,
                         diagnostics: dict[str, Any] | None = None,
                         keep_tmp: bool = True) -> DenseSdfResult:
    """Bake one analytic fixture through the real headless pipeline."""
    if shape not in FIXTURES:
        raise ValueError(f"unknown fixture {shape!r}; have {sorted(FIXTURES)}")
    fix = FIXTURES[shape]
    spec = fixture_spec(shape, voxel_size_m)
    request = SdfGridRequest(spec=spec, meshes=fix.meshes,
                             operation=fix.operation,          # type: ignore[arg-type]
                             route=route or SdfGridRoute.selected_default())
    return run_blender_sdf(request, diagnostics=diagnostics, keep_tmp=keep_tmp)


# ===========================================================================
# Route B helpers: PLY I/O, closed-mesh analysis, existing libigl sampler
# ===========================================================================

def write_ply_binary(path: Path, verts: npt.NDArray[np.float64],
                     faces: npt.NDArray[np.int64]) -> None:
    """Triangulated binary-little-endian PLY (deterministic vertex order)."""
    n, m = len(verts), len(faces)
    header = (f"ply\nformat binary_little_endian 1.0\n"
              f"comment blud blender-sdf-grid route-b isosurface\n"
              f"element vertex {n}\nproperty float x\nproperty float y\n"
              f"property float z\nelement face {m}\n"
              f"property list uchar int vertex_indices\nend_header\n")
    with open(path, "wb") as fh:
        fh.write(header.encode("ascii"))
        fh.write(np.ascontiguousarray(verts, dtype="<f4").tobytes("C"))
        rec = np.zeros(m, dtype=[("c", "u1"), ("v", "<i4", 3)])
        rec["c"] = 3
        rec["v"] = faces
        fh.write(rec.tobytes("C"))


def read_ply_binary(path: Path) -> tuple[npt.NDArray[np.float64],
                                         npt.NDArray[np.int64]]:
    text = path.read_bytes()
    marker = b"end_header\n"
    idx = text.index(marker) + len(marker)
    header = text[:idx].decode("ascii")
    nv = int([l for l in header.splitlines() if l.startswith("element vertex")][0]
             .split()[-1])
    nf = int([l for l in header.splitlines() if l.startswith("element face")][0]
             .split()[-1])
    verts = np.frombuffer(text, dtype="<f4", count=3 * nv,
                          offset=idx).reshape(nv, 3).astype(np.float64)
    rec = np.frombuffer(text, dtype=[("c", "u1"), ("v", "<i4", 3)],
                        count=nf, offset=idx + 12 * nv)
    if not np.all(rec["c"] == 3):
        raise ValueError("PLY faces are not triangles")
    return verts, rec["v"].astype(np.int64)


def closed_mesh_info(verts: npt.NDArray[np.float64],
                     faces: npt.NDArray[np.int64]) -> dict[str, Any]:
    """Every undirected edge must bound exactly two triangles; count bodies."""
    edges: dict[tuple[int, int], int] = {}
    for a, b, c in faces:
        for u, v in ((a, b), (b, c), (c, a)):
            key = (u, v) if u < v else (v, u)
            edges[key] = edges.get(key, 0) + 1
    boundary = sum(1 for n in edges.values() if n != 2)
    parent = list(range(len(verts)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in faces:
        for u, v in ((a, b), (b, c), (c, a)):
            ru, rv = find(int(u)), find(int(v))
            if ru != rv:
                parent[ru] = rv
    used = {find(int(f[0])) for f in faces}
    return {
        "closed": boundary == 0 and len(used) == 1,
        "boundaryEdges": boundary,
        "components": len(used),
        "vertices": int(len(verts)),
        "triangles": int(len(faces)),
    }


_HAND_MODULE: Any = None


def _hand_module() -> Any:
    """Import scripts/bake_hand_sdf.py (import-safe; bpy stays lazy there)."""
    global _HAND_MODULE
    if _HAND_MODULE is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "bake_hand_sdf_for_sdf_grid", HAND_BAKE_SCRIPT)
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod
        spec.loader.exec_module(mod)
        _HAND_MODULE = mod
    return _HAND_MODULE


def _libigl_signed_distance_chunk(points: npt.NDArray[np.float64],
                                   vertices: npt.NDArray[np.float64],
                                   faces: npt.NDArray[np.int64]
                                   ) -> npt.NDArray[np.float64]:
    """The existing sampler: exact unsigned magnitude + FWN inside mask."""
    return _hand_module().bake_chunk(points, vertices, faces)


def _hand_reference_cube_mesh() -> tuple[npt.NDArray[np.float64],
                                         npt.NDArray[np.int64]]:
    return _hand_module().cube_mesh(1.0)


def resample_libigl(verts: npt.NDArray[np.float64], faces: npt.NDArray[np.int64],
                    bounds_min: Sequence[float], bounds_max: Sequence[float],
                    dimensions: Sequence[int]) -> npt.NDArray[np.float32]:
    """Fill the dense lattice through the existing winding-number path."""
    points = lattice_points(bounds_min, bounds_max, dimensions)
    field = _libigl_signed_distance_chunk(points, verts, faces)
    dims = tuple(int(n) for n in dimensions)
    return field.reshape(dims[2], dims[1], dims[0]).astype(np.float32)


# ===========================================================================
# Capability probe (outer role)
# ===========================================================================

_CAPS: dict[str, Any] | None = None


def probe_capabilities(blender_bin: str | None = None,
                       refresh: bool = False) -> dict[str, Any]:
    """One Blender launch: version, node registration, both route smokes."""
    global _CAPS
    if _CAPS is not None and not refresh:
        return _CAPS
    blender = blender_executable(blender_bin)
    tmp = Path(tempfile.mkdtemp(prefix="blud-blender-sdf-caps-"))
    req_path = (tmp / "request.json").resolve()
    res_path = (tmp / "result.json").resolve()
    req_path.write_text(canonical_json({"mode": "capabilities"}))
    cmd = [blender, "--background", "--factory-startup",
           "--python", str(Path(__file__).resolve()), "--",
           "--blender-inner", str(req_path), str(res_path)]
    t0 = time.monotonic()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    dt = time.monotonic() - t0
    if not res_path.exists():
        raise RuntimeError(
            f"capability probe produced no result.json (rc={proc.returncode})\n"
            f"{(proc.stderr or proc.stdout)[-3000:]}")
    payload = json.loads(res_path.read_text())
    if not payload.get("ok"):
        raise RuntimeError(f"capability probe failed: {payload.get('error')}")
    _CAPS = {
        "blenderFound": True,
        "blenderPath": blender,
        "blenderVersion": payload["blenderVersion"],
        "nodes": payload["nodes"],
        "routeA": payload["routeA"],
        "routeB": payload["routeB"],
        "sampleGridFieldEval": payload.get("sampleGridFieldEval"),
        "sdfGridBoolean": payload.get("sdfGridBoolean"),
        "timings": {"blenderS": round(dt, 3), **payload.get("timings", {})},
        "tmpDir": str(tmp),
    }
    return _CAPS


# ===========================================================================
# Inner role -- everything below imports bpy lazily, ONLY inside Blender
# ===========================================================================

def _inner_main(req_path: str, res_path: str) -> None:
    import traceback                                            # noqa: F401
    t_start = time.monotonic()
    payload: dict[str, Any] = {"ok": False}
    try:
        request = json.loads(Path(req_path).read_text())
        request["_outDir"] = str(Path(req_path).resolve().parent)
        payload = _inner_run(request, payload)
        payload.pop("_outDir", None)
        payload["ok"] = True
    except Exception:
        payload = {"ok": False, "error": traceback.format_exc(limit=40)}
    payload.setdefault("timings", {})
    payload["timings"]["totalS"] = round(time.monotonic() - t_start, 3)
    Path(res_path).write_text(canonical_json(payload))


def _bl_check_version() -> str:
    import bpy
    ver = bpy.app.version
    if not (BLENDER_MINIMUM <= ver[:2] < BLENDER_MAXIMUM_EXCLUSIVE):
        raise RuntimeError(
            f"Blender {ver[0]}.{ver[1]}.{ver[2]} outside required 5.2.x")
    return bpy.app.version_string


def _bl_check_nodes() -> dict[str, bool]:
    import bpy
    nodes = {}
    for name in REQUIRED_NODES:
        nodes[name] = getattr(bpy.types, name, None) is not None
    missing = [n for n, ok in nodes.items() if not ok]
    if missing:
        raise RuntimeError(f"required nodes not registered: {missing}")
    nodes["GeometryNodeBake"] = getattr(bpy.types, "GeometryNodeBake", None) is not None
    nodes["GeometryNodeObjectInfo"] = getattr(
        bpy.types, "GeometryNodeObjectInfo", None) is not None
    return nodes


def _bl_new_scene() -> None:
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _bl_determinize_mesh(obj) -> None:
    """Rebuild mesh data with canonically sorted faces.

    bpy.ops.mesh.primitive_uv_sphere_add emits identical vertices but a
    run-to-run PERMUTED polygon order (measured: three runs, three face-list
    hashes). A permuted triangle soup changes closest-triangle tie-breaking
    inside Mesh to SDF Grid, which shows up as ~1e-4 m voxel noise and breaks
    the byte-identical determinism contract. Rebuilding via from_pydata with a
    sorted face list pins the soup; within-face winding is preserved.
    """
    import bpy
    me = obj.data
    verts = [tuple(float(c) for c in v.co) for v in me.vertices]
    faces = sorted(tuple(int(i) for i in p.vertices) for p in me.polygons)
    new = bpy.data.meshes.new(me.name + ".det")
    new.from_pydata(verts, [], [list(f) for f in faces])
    if new.validate():
        raise RuntimeError(
            f"determinized mesh for {obj.name} needed corrections (validate)")
    obj.data = new
    bpy.data.meshes.remove(me)


def _bl_add_array_mesh(entry: dict[str, Any], index: int, out_dir: Path):
    """Rebuild one caller-supplied array mesh as a conventional Blender mesh.

    Every array source stays its OWN object (and therefore its own level set):
    joining overlapping soups keeps their internal faces, which is not a union.
    The transform has already been applied exactly once by load_mesh_payload,
    so the object is created at the identity and never moved again.
    """
    import bpy
    mesh = load_mesh_payload(out_dir, entry)
    name = f"blud_sdf_src_{index}"
    data = bpy.data.meshes.new(name + ".payload")
    data.from_pydata([tuple(float(c) for c in v) for v in mesh.vertices_m], [],
                     [[int(i) for i in f] for f in mesh.triangles])
    if data.validate():
        raise RuntimeError(
            f"array payload {mesh.label!r} needed Blender corrections (validate)")
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    _bl_determinize_mesh(obj)
    return obj


def _bl_add_mesh(mesh: dict[str, Any], index: int, out_dir: Path | None = None):
    """Analytic primitive or caller-supplied array payload, by tagged kind."""
    import bpy
    if mesh.get("kind") == "array-payload":
        if out_dir is None:
            raise RuntimeError("array payloads need the request directory")
        return _bl_add_array_mesh(mesh, index, out_dir)
    name = f"blud_sdf_src_{index}"
    loc = tuple(float(v) for v in mesh["location"])
    rot = tuple(float(v) for v in mesh["rotationEuler"])
    if mesh["kind"] == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=float(mesh["size"]) / 2.0,
                                             location=loc, rotation=rot,
                                             segments=64, ring_count=32)
    else:
        bpy.ops.mesh.primitive_cube_add(size=float(mesh["size"]),
                                        location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    _bl_determinize_mesh(obj)
    return obj


def _bl_consumer() -> Any:
    """The object that carries the GN modifier and is evaluated.

    Pinned at the WORLD ORIGIN: Object Info's RELATIVE transform space yields
    geometry relative to this object's transform, so an identity consumer
    gives world-space meshes (ORIGINAL returns local space -- measured).
    It must also NOT be one of the source objects: Object Info pulling the
    same object the modifier lives on is a self-reference and evaluates to
    empty geometry.
    """
    import bpy
    bpy.ops.mesh.primitive_cube_add(size=0.01, location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = "blud_sdf_consumer"
    return obj


def _bl_build_tree(request: dict[str, Any], objs: list):
    """Construct the pinned graph; every socket is assigned explicitly.

    Composition strategy (Blender 5.2.0, all captured in the qualification):
      single        ObjectInfo -> Mesh to SDF Grid.
      union         ObjectInfo x2 -> Mesh to SDF Grid x2; the two grids are
                    baked into one volume and composed with openvdb
                    combine(min). A Join Geometry + one Mesh to SDF Grid
                    shortcut is WRONG for overlapping inputs: OpenVDB
                    distances hit the internal faces of the joined soup
                    (measured: overlap centre reads -0.01 instead of -0.05).
      intersection  same bake, composed with combine(max).
    GeometryNodeSDFGridBoolean is REGISTERED but deliberately unused: it
    evaluates to its Grid 2 input regardless of operation in 5.2.0 headless
    (measured across four wirings; see qualification.json capabilities).
    """
    import bpy
    grid = request["grid"]
    ng = bpy.data.node_groups.new("blud_sdf_grid", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", socket_type="NodeSocketGeometry",
                            in_out="INPUT")
    ng.interface.new_socket("Geometry", socket_type="NodeSocketGeometry",
                            in_out="OUTPUT")
    n_in = ng.nodes.new("NodeGroupInput")
    n_out = ng.nodes.new("NodeGroupOutput")
    links = ng.links

    info_nodes = []
    for obj in objs:
        info = ng.nodes.new("GeometryNodeObjectInfo")
        info.inputs["Object"].default_value = obj
        info.inputs["As Instance"].default_value = False   # realized geometry
        # RELATIVE + a consumer pinned at the world origin == world space
        # (measured: ORIGINAL returns the object's LOCAL mesh, untransformed)
        info.transform_space = "RELATIVE"
        info_nodes.append(info)

    def m2s_from(sock):
        m2s = ng.nodes.new("GeometryNodeMeshToSDFGrid")
        m2s.inputs["Voxel Size"].default_value = float(grid["voxelSizeM"])
        m2s.inputs["Band Width"].default_value = int(grid["bandWidth"])
        links.new(sock, m2s.inputs["Mesh"])
        return m2s.outputs["SDF Grid"]

    operation = request["operation"]
    if operation == "single":
        grids = [m2s_from(info_nodes[0].outputs["Geometry"])]
        final = grids[0]
    elif operation in ("union", "intersection"):
        grids = [m2s_from(info.outputs["Geometry"]) for info in info_nodes]
        final = None                      # composed after the bake
    else:
        raise RuntimeError(f"unsupported operation {operation!r}")
    return ng, n_in, n_out, final, info_nodes, grids


def _bl_sample_grid_probe(final_grid) -> dict[str, Any]:
    """Evaluate the field directly through Sample Grid on explicit points."""
    ng = final_grid.id_data
    links = ng.links
    probes = [(0.0, 0.0, 0.0), (0.11, 0.0, 0.0), (0.05, 0.0, 0.0)]
    join = ng.nodes.new("GeometryNodeJoinGeometry")
    for p in probes:
        ln = ng.nodes.new("GeometryNodeMeshLine")
        ln.inputs["Count"].default_value = 1
        ln.inputs["Start Location"].default_value = p
        ln.inputs["Offset"].default_value = (0.0, 0.0, 0.0)
        # the join input is a multi-input socket: linking repeatedly accumulates
        links.new(ln.outputs[0], join.inputs[-1])
    pos = ng.nodes.new("GeometryNodeInputPosition")
    samp = ng.nodes.new("GeometryNodeSampleGrid")
    links.new(final_grid, samp.inputs["Grid"])
    links.new(pos.outputs["Position"], samp.inputs["Position"])
    attr = ng.nodes.new("GeometryNodeStoreNamedAttribute")
    attr.domain = "POINT"
    attr.inputs["Name"].default_value = "sdf_probe"
    links.new(join.outputs[0], attr.inputs["Geometry"])
    links.new(samp.outputs["Value"], attr.inputs["Value"])
    return {"out": attr.outputs["Geometry"], "probes": probes}


def _bl_bake_vdb(obj, mod, out_dir: Path, grid_name: str) -> Path:
    """Route A: bake the Store Named Grid volume to a real OpenVDB file."""
    import bpy
    import glob
    bpy.ops.wm.save_as_mainfile(filepath=str(out_dir / "scene.blend"))
    bpy.context.view_layer.update()
    bakes = list(mod.bakes)
    if not bakes:
        raise RuntimeError("no modifier bake entry appeared for the Bake node")
    entry = bakes[0]
    entry.use_custom_path = True
    entry.directory = str(out_dir)
    entry.bake_target = "DISK"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    result = bpy.ops.object.geometry_node_bake_single(
        session_uid=obj.session_uid, modifier_name=mod.name,
        bake_id=entry.bake_id)
    if result != {"FINISHED"}:
        raise RuntimeError(f"geometry_node_bake_single returned {result}")
    vdbs = sorted(glob.glob(str(out_dir / "**" / "*.vdb"), recursive=True))
    if len(vdbs) != 1:
        raise RuntimeError(f"expected exactly one .vdb under {out_dir}, got {vdbs}")
    return Path(vdbs[0])


def _bl_bake_grids(request, objs, out_dir: Path) -> tuple[Path, list]:
    """Union/intersection: bake each grid separately, then fold 1..N of them.

    Each mesh gets its OWN tree (Object Info -> Mesh to SDF Grid -> Store
    Named Grid -> Bake) because linking a grid socket across node trees is
    silently ignored, and chaining two Store Named Grid nodes into one
    volume stores EMPTY grids (both measured). Composition happens with the
    bundled openvdb module's combine() (exact elementwise min/max,
    deterministic) because the SDF Grid Boolean node is broken in 5.2.0.
    """
    import bpy
    import openvdb
    grid = request["grid"]
    operation = request["operation"]
    if operation == "union" and len(objs) < 2:
        raise RuntimeError(f"union needs at least two meshes, got {len(objs)}")
    if operation == "intersection" and len(objs) != 2:
        raise RuntimeError(f"intersection needs exactly two meshes, got {len(objs)}")
    if not 1 <= len(objs) <= MAX_MESHES:
        raise RuntimeError(f"mesh count {len(objs)} outside 1..{MAX_MESHES}")
    baked = []
    for i, obj in enumerate(objs):
        sub = out_dir / f"grid_{i}"
        sub.mkdir(parents=True, exist_ok=True)
        c = _bl_consumer()
        ng = bpy.data.node_groups.new(f"blud_sdf_two_{i}", "GeometryNodeTree")
        ng.interface.new_socket("Geometry", socket_type="NodeSocketGeometry",
                                in_out="INPUT")
        ng.interface.new_socket("Geometry", socket_type="NodeSocketGeometry",
                                in_out="OUTPUT")
        n_in = ng.nodes.new("NodeGroupInput")
        n_out = ng.nodes.new("NodeGroupOutput")
        links = ng.links
        oi = ng.nodes.new("GeometryNodeObjectInfo")
        oi.inputs["Object"].default_value = obj
        oi.inputs["As Instance"].default_value = False
        oi.transform_space = "RELATIVE"
        m2s = ng.nodes.new("GeometryNodeMeshToSDFGrid")
        m2s.inputs["Voxel Size"].default_value = float(grid["voxelSizeM"])
        m2s.inputs["Band Width"].default_value = int(grid["bandWidth"])
        links.new(oi.outputs["Geometry"], m2s.inputs["Mesh"])
        st = ng.nodes.new("GeometryNodeStoreNamedGrid")
        st.inputs["Name"].default_value = f"{grid['gridName']}_{i}"
        links.new(oi.outputs["Geometry"], st.inputs["Volume"])
        links.new(m2s.outputs["SDF Grid"], st.inputs["Grid"])
        bake = ng.nodes.new("GeometryNodeBake")
        item = bake.bake_items.new("GEOMETRY", name="Geometry")
        links.new(st.outputs["Volume"], bake.inputs[item.name])
        links.new(bake.outputs[item.name], n_out.inputs["Geometry"])
        mod_i = c.modifiers.new("GN", "NODES")
        mod_i.node_group = ng
        bpy.context.view_layer.update()
        vdb_path = _bl_bake_vdb(c, mod_i, sub, grid["gridName"])
        baked.append(openvdb.read(str(vdb_path), f"{grid['gridName']}_{i}"))
    # Component diagnostics are captured BEFORE the fold: combine() consumes
    # its operand, so a reordered or omitted grid must be visible here.
    components = [{"index": i, "gridName": f"{grid['gridName']}_{i}",
                   **_bl_grid_diagnostics(g)}
                  for i, g in enumerate(baked)]
    op = min if request["operation"] == "union" else max
    result = baked[0]
    for nxt in baked[1:]:
        result.combine(nxt, op)
    result.name = grid["gridName"]
    combined_path = out_dir / "combined.vdb"
    openvdb.write(str(combined_path), result)
    return combined_path, components


def _bl_grid_diagnostics(g, vdb_path: Path | None = None) -> dict[str, Any]:
    tr = g.transform
    acc = g.getAccessor()
    origin = tr.indexToWorld((0, 0, 0))
    basis = [tr.indexToWorld((1, 0, 0)), tr.indexToWorld((0, 1, 0)),
             tr.indexToWorld((0, 0, 1))]
    matrix = [[float(origin[a])] + [float(basis[j][a] - origin[a])
                                    for j in range(3)] for a in range(3)]

    def probe(world: tuple[float, float, float]) -> tuple[float, bool]:
        f = tr.worldToIndex(world)
        ijk = tuple(int(round(c)) for c in f)
        return float(acc.getValue(ijk)), bool(acc.isValueOn(ijk))

    deep_val, deep_on = probe((0.0, 0.0, 0.0))
    far_val, _far_on = probe((9.0, 9.0, 9.0))
    return {
        "vdbPath": str(vdb_path) if vdb_path else None,
        "gridName": g.name,
        "gridClass": str(g.gridClass),
        "valueTypeName": str(g.valueTypeName),
        "voxelSizeM": [float(v) for v in tr.voxelSize()],
        "transform": matrix,
        "backgroundM": float(far_val),
        "activeVoxelCount": int(g.activeVoxelCount()),
        "deepInteriorProbeM": deep_val,
        "interiorProbeInactive": not deep_on,
    }


def _bl_dense_from_grid(request: dict[str, Any], g
                        ) -> npt.NDArray[np.float32]:
    """Fixed-order trilinear evaluation of the level set on the dense lattice.

    The accessor returns the signed background outside the active band, which
    is exactly what keeps deep interior samples negative.
    """
    grid = request["grid"]
    tr = g.transform
    acc = g.getAccessor()
    lo = [float(v) for v in grid["boundsMinM"]]
    dims = [int(v) for v in grid["dimensions"]]
    voxel = [(float(grid["boundsMaxM"][a]) - lo[a]) / (dims[a] - 1)
             for a in range(3)]
    field = np.empty((dims[2], dims[1], dims[0]), dtype=np.float64)
    for k in range(dims[2]):
        pz = lo[2] + k * voxel[2]
        for j in range(dims[1]):
            py = lo[1] + j * voxel[1]
            for i in range(dims[0]):
                px = lo[0] + i * voxel[0]
                fx, fy, fz = tr.worldToIndex((px, py, pz))
                x0, y0, z0 = math.floor(fx), math.floor(fy), math.floor(fz)
                ax, ay, az = fx - x0, fy - y0, fz - z0
                c000 = acc.getValue((x0, y0, z0))
                c100 = acc.getValue((x0 + 1, y0, z0))
                c010 = acc.getValue((x0, y0 + 1, z0))
                c110 = acc.getValue((x0 + 1, y0 + 1, z0))
                c001 = acc.getValue((x0, y0, z0 + 1))
                c101 = acc.getValue((x0 + 1, y0, z0 + 1))
                c011 = acc.getValue((x0, y0 + 1, z0 + 1))
                c111 = acc.getValue((x0 + 1, y0 + 1, z0 + 1))
                field[k, j, i] = (
                    c000 * (1 - ax) * (1 - ay) * (1 - az)
                    + c100 * ax * (1 - ay) * (1 - az)
                    + c010 * (1 - ax) * ay * (1 - az)
                    + c110 * ax * ay * (1 - az)
                    + c001 * (1 - ax) * (1 - ay) * az
                    + c101 * ax * (1 - ay) * az
                    + c011 * (1 - ax) * ay * az
                    + c111 * ax * ay * az)
    return field.astype(np.float32)


def _bl_route_b(request: dict[str, Any], objs, out_dir: Path) -> dict[str, Any]:
    import bpy
    t0 = time.monotonic()
    if request["operation"] == "single":
        if len(objs) != 1:
            raise RuntimeError(f"single needs exactly one mesh, got {len(objs)}")
        consumer = _bl_consumer()
        ng, n_in, n_out, final, infos, grids = _bl_build_tree(request, objs)
        links = ng.links
        g2m = ng.nodes.new("GeometryNodeGridToMesh")
        g2m.inputs["Threshold"].default_value = float(request["grid"]["threshold"])
        g2m.inputs["Adaptivity"].default_value = float(request["grid"]["adaptivity"])
        links.new(final, g2m.inputs["Grid"])
        links.new(g2m.outputs["Mesh"], n_out.inputs["Geometry"])
        mod = consumer.modifiers.new("GN", "NODES")
        mod.node_group = ng
    else:
        # union/intersection: compose the two grids first (combine min/max),
        # then re-import the combined level set as a volume object and mesh
        # THAT through Get Named Grid -> Grid to Mesh in a fresh graph.
        combined_path, _components = _bl_bake_grids(request, objs, out_dir)
        bpy.ops.object.volume_import(filepath=str(combined_path))
        vol_obj = bpy.context.object
        vol_obj.name = "blud_sdf_combined_volume"
        consumer = _bl_consumer()
        ng = bpy.data.node_groups.new("blud_sdf_g2m", "GeometryNodeTree")
        ng.interface.new_socket("Geometry", socket_type="NodeSocketGeometry",
                                in_out="INPUT")
        ng.interface.new_socket("Geometry", socket_type="NodeSocketGeometry",
                                in_out="OUTPUT")
        n_in = ng.nodes.new("NodeGroupInput")
        n_out = ng.nodes.new("NodeGroupOutput")
        oi = ng.nodes.new("GeometryNodeObjectInfo")
        oi.inputs["Object"].default_value = vol_obj
        oi.inputs["As Instance"].default_value = False
        oi.transform_space = "RELATIVE"
        get = ng.nodes.new("GeometryNodeGetNamedGrid")
        get.inputs["Name"].default_value = request["grid"]["gridName"]
        ng.links.new(oi.outputs["Geometry"], get.inputs["Volume"])
        g2m = ng.nodes.new("GeometryNodeGridToMesh")
        g2m.inputs["Threshold"].default_value = float(request["grid"]["threshold"])
        g2m.inputs["Adaptivity"].default_value = float(request["grid"]["adaptivity"])
        ng.links.new(get.outputs["Grid"], g2m.inputs["Grid"])
        ng.links.new(g2m.outputs["Mesh"], n_out.inputs["Geometry"])
        mod = consumer.modifiers.new("GN", "NODES")
        mod.node_group = ng
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = consumer.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        # NOTE: Mesh.calc_loop_triangles() returns None on depsgraph-evaluated
        # Geometry-Nodes meshes in 5.2 (measured); fan-triangulate the convex
        # Grid-to-Mesh polygons instead.
        verts = np.array([list(v.co) for v in me.vertices], dtype=np.float64)
        tris = []
        for p in me.polygons:
            v = list(p.vertices)
            for k in range(1, len(v) - 1):
                tris.append((v[0], v[k], v[k + 1]))
        if not tris:
            raise RuntimeError("Grid to Mesh produced no triangles")
        faces = np.array(tris, dtype=np.int64)
    finally:
        ev.to_mesh_clear()
    ply_path = out_dir / "route_b_isosurface.ply"
    write_ply_binary(ply_path, verts, faces)
    info = closed_mesh_info(verts, faces)
    return {"plyPath": str(ply_path), **info,
            "threshold": float(request["grid"]["threshold"]),
            "adaptivity": float(request["grid"]["adaptivity"]),
            "timings": {"isosurfaceS": round(time.monotonic() - t0, 3)}}


def _bl_route_a(request: dict[str, Any], objs, out_dir: Path) -> dict[str, Any]:
    import bpy
    import openvdb
    grid = request["grid"]
    if request["operation"] == "single":
        consumer = _bl_consumer()
        ng, n_in, n_out, final, infos, grids = _bl_build_tree(request, objs)
        links = ng.links
        t0 = time.monotonic()
        st = ng.nodes.new("GeometryNodeStoreNamedGrid")
        st.inputs["Name"].default_value = grid["gridName"]
        links.new(infos[0].outputs["Geometry"], st.inputs["Volume"])
        links.new(final, st.inputs["Grid"])
        bake = ng.nodes.new("GeometryNodeBake")
        item = bake.bake_items.new("GEOMETRY", name="Geometry")
        links.new(st.outputs["Volume"], bake.inputs[item.name])
        links.new(bake.outputs[item.name], n_out.inputs["Geometry"])
        mod = consumer.modifiers.new("GN", "NODES")
        mod.node_group = ng
        bpy.context.view_layer.update()
        vdb_path = _bl_bake_vdb(consumer, mod, out_dir, grid["gridName"])
        g = openvdb.read(str(vdb_path), grid["gridName"])
        diag = {"vdb": _bl_grid_diagnostics(g, vdb_path)}
    else:
        # union/intersection: bake both named grids, compose with combine
        t0 = time.monotonic()
        combined_path, components = _bl_bake_grids(request, objs, out_dir)
        g = openvdb.read(str(combined_path), grid["gridName"])
        method = ("openvdb-combine-min" if request["operation"] == "union"
                  else "openvdb-combine-max")
        diag = {
            "vdb": _bl_grid_diagnostics(g, combined_path),
            "composition": {
                "method": method,
                "reason": "GeometryNodeSDFGridBoolean evaluates to its Grid 2 "
                          "input in Blender 5.2.0 (measured); Join Geometry "
                          "is not a substitute either (internal faces); see "
                          "the node contract and qualification capabilities.",
                "sourceGrids": [f"{grid['gridName']}_{i}"
                                for i in range(len(objs))],
                "foldOrder": "stable request order, left to right",
                "componentGrids": components,
            },
        }
    t_bake = time.monotonic() - t0
    t0 = time.monotonic()
    values = _bl_dense_from_grid(request, g)
    dense_path = out_dir / "dense_f32.bin"
    dense_path.write_bytes(values.astype("<f4").tobytes("C"))
    return {
        **diag,
        "valuesPath": str(dense_path),
        "timings": {"bakeS": round(t_bake, 3),
                    "denseConvertS": round(time.monotonic() - t0, 3)},
    }


def _inner_run(request: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    payload["blenderVersion"] = _bl_check_version()
    payload["nodes"] = _bl_check_nodes()
    out_dir = Path(request["_outDir"])
    _bl_new_scene()
    mode = request.get("mode", "bake")
    if mode == "capabilities":
        payload.update(_bl_capabilities(out_dir))
        return payload
    objs = [_bl_add_mesh(m, i, out_dir) for i, m in enumerate(request["meshes"])]
    route = SdfGridRoute.check(request["route"])
    if route == SdfGridRoute.DIRECT_VDB:
        payload["routeA"] = _bl_route_a(request, objs, out_dir)
        payload["dense"] = {
            "route": route,
            "dimensions": request["grid"]["dimensions"],
            "boundsMinM": request["grid"]["boundsMinM"],
            "boundsMaxM": request["grid"]["boundsMaxM"],
            "valuesPath": payload["routeA"]["valuesPath"],
        }
    else:
        payload["routeB"] = _bl_route_b(request, objs, out_dir)
        payload["dense"] = {
            "route": route,
            "dimensions": request["grid"]["dimensions"],
            "boundsMinM": request["grid"]["boundsMinM"],
            "boundsMaxM": request["grid"]["boundsMaxM"],
        }
    return payload


def _bl_read_probe_attributes(consumer, probe: dict[str, Any]
                             ) -> list[float]:
    """Read Sample Grid probe values KEYED BY VERTEX POSITION.

    Join Geometry permutes the vertex order, so zipping values by index
    scrambles them (measured); match each probe point to its vertex instead.
    """
    import bpy
    deps = bpy.context.evaluated_depsgraph_get()
    ev = consumer.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        attr = me.attributes["sdf_probe"]
        by_pos: dict[tuple[int, int, int], float] = {}
        for i, v in enumerate(me.vertices):
            key = (int(round(v.co.x * 1000)), int(round(v.co.y * 1000)),
                   int(round(v.co.z * 1000)))
            by_pos[key] = float(attr.data[i].value)
        vals = []
        for p in probe["probes"]:
            key = (int(round(p[0] * 1000)), int(round(p[1] * 1000)),
                   int(round(p[2] * 1000)))
            if key not in by_pos:
                raise RuntimeError(f"probe vertex {p} missing from evaluation")
            vals.append(by_pos[key])
        return vals
    finally:
        ev.to_mesh_clear()


def _bl_boolean_evidence() -> dict[str, Any]:
    """Capture the SDF Grid Boolean behaviour that forces our workarounds.

    Two disjoint 0.1 m cubes at x = -0.08 / +0.08 are unioned through the
    node; a correct union reads negative at BOTH cube centres. Blender
    5.2.0 returns the Grid 2 grid alone, so the Grid 1 centre reads the
    positive background. This probe records the measured values so the
    workaround is never mistaken for a preference.
    """
    import bpy
    _bl_new_scene()
    objs = [_bl_add_mesh({"kind": "cube", "size": 0.1,
                          "location": (-0.08, 0.0, 0.0),
                          "rotationEuler": (0.0, 0.0, 0.0)}, 0),
            _bl_add_mesh({"kind": "cube", "size": 0.1,
                          "location": (0.08, 0.0, 0.0),
                          "rotationEuler": (0.0, 0.0, 0.0)}, 1)]
    consumer = _bl_consumer()
    ng = bpy.data.node_groups.new("blud_sdf_boolprobe", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", socket_type="NodeSocketGeometry",
                            in_out="INPUT")
    ng.interface.new_socket("Geometry", socket_type="NodeSocketGeometry",
                            in_out="OUTPUT")
    n_in = ng.nodes.new("NodeGroupInput")
    n_out = ng.nodes.new("NodeGroupOutput")
    links = ng.links

    def m2s_for(obj):
        oi = ng.nodes.new("GeometryNodeObjectInfo")
        oi.inputs["Object"].default_value = obj
        oi.inputs["As Instance"].default_value = False
        oi.transform_space = "RELATIVE"
        m = ng.nodes.new("GeometryNodeMeshToSDFGrid")
        m.inputs["Voxel Size"].default_value = 0.01
        m.inputs["Band Width"].default_value = 6
        links.new(oi.outputs["Geometry"], m.inputs["Mesh"])
        return m

    m1, m2 = m2s_for(objs[0]), m2s_for(objs[1])
    b = ng.nodes.new("GeometryNodeSDFGridBoolean")
    b.operation = "UNION"
    links.new(m1.outputs["SDF Grid"], b.inputs[0])
    links.new(m2.outputs["SDF Grid"], b.inputs[-1])
    probes = [(-0.08, 0.0, 0.0), (0.08, 0.0, 0.0)]
    probe_join = ng.nodes.new("GeometryNodeJoinGeometry")
    for p in probes:
        ln = ng.nodes.new("GeometryNodeMeshLine")
        ln.inputs["Count"].default_value = 1
        ln.inputs["Start Location"].default_value = p
        ln.inputs["Offset"].default_value = (0.0, 0.0, 0.0)
        links.new(ln.outputs[0], probe_join.inputs[-1])
    pos = ng.nodes.new("GeometryNodeInputPosition")
    samp = ng.nodes.new("GeometryNodeSampleGrid")
    links.new(b.outputs[0], samp.inputs["Grid"])
    links.new(pos.outputs["Position"], samp.inputs["Position"])
    attr = ng.nodes.new("GeometryNodeStoreNamedAttribute")
    attr.domain = "POINT"
    attr.inputs["Name"].default_value = "sdf_probe"
    links.new(probe_join.outputs[0], attr.inputs["Geometry"])
    links.new(samp.outputs["Value"], attr.inputs["Value"])
    links.new(attr.outputs["Geometry"], n_out.inputs["Geometry"])
    mod = consumer.modifiers.new("GN", "NODES")
    mod.node_group = ng
    bpy.context.view_layer.update()
    vals = _bl_read_probe_attributes(consumer, {"probes": probes})
    expected = [-0.05, -0.05]
    return {
        "operation": "UNION",
        "probePointsM": probes,
        "measuredValuesM": vals,
        "expectedValuesM": expected,
        "grid1Ignored": vals[0] > 0.0,
        "verdict": ("GeometryNodeSDFGridBoolean evaluates to its Grid 2 "
                    "input regardless of operation in Blender 5.2.0; "
                    "union uses Join Geometry + one Mesh to SDF Grid and "
                    "intersection uses openvdb combine(max) on baked named "
                    "grids instead"),
    }


def _bl_capabilities(out_dir: Path) -> dict[str, Any]:
    """Version + nodes + both route smokes + field-eval + boolean evidence."""
    import bpy
    result: dict[str, Any] = {}
    # -- Route A smoke on a 0.2 m cube: deep interior must be an inactive
    #    signed tile (band 6 * 1 cm = 6 cm < 10 cm half-extent).
    spec = fixture_spec("cube-large")
    request = request_to_json(SdfGridRequest(
        spec=spec, meshes=FIXTURES["cube-large"].meshes, operation="single",
        route=SdfGridRoute.DIRECT_VDB))
    _bl_new_scene()
    objs = [_bl_add_mesh(m, i, out_dir) for i, m in enumerate(request["meshes"])]
    (out_dir / "route_a").mkdir(parents=True, exist_ok=True)
    route_a = _bl_route_a(request, objs, out_dir / "route_a")
    result["routeA"] = {
        "supported": True,
        "reason": "StoreNamedGrid -> Bake(DISK) -> openvdb.read succeeded",
        "vdb": route_a["vdb"],
    }
    # -- Sample Grid direct field evaluation (capability evidence).
    _bl_new_scene()
    objs = [_bl_add_mesh(m, i, out_dir) for i, m in enumerate(request["meshes"])]
    consumer = _bl_consumer()
    ng2, n_in2, n_out2, final2, infos2, _grids2 = _bl_build_tree(request, objs)
    probe = _bl_sample_grid_probe(final2)
    ng2.links.new(probe["out"], n_out2.inputs["Geometry"])
    mod2 = consumer.modifiers.new("GN", "NODES")
    mod2.node_group = ng2
    bpy.context.view_layer.update()
    vals = _bl_read_probe_attributes(consumer, probe)
    result["sampleGridFieldEval"] = {
        "probes": probe["probes"], "values": vals,
        "negativeInside": vals[0] < 0.0, "positiveOutside": vals[1] > 0.0,
    }
    # -- SDF Grid Boolean evidence (forces our composition workarounds).
    result["sdfGridBoolean"] = _bl_boolean_evidence()
    # -- Route B smoke on the same grid.
    _bl_new_scene()
    objs = [_bl_add_mesh(m, i, out_dir) for i, m in enumerate(request["meshes"])]
    request_b = dict(request, route=SdfGridRoute.GRID_TO_MESH_LIBIGL)
    (out_dir / "route_b").mkdir(parents=True, exist_ok=True)
    result["routeB"] = {
        "supported": True,
        "reason": "GridToMesh(threshold=0, adaptivity=0) evaluated headless",
        **{k: v for k, v in _bl_route_b(request_b, objs,
                                        out_dir / "route_b").items()
           if k != "plyPath"},
    }
    return result


# ===========================================================================
# Qualification report + deterministic preview PNG (outer role)
# ===========================================================================

def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png_rgb(path: Path, rgb: npt.NDArray[np.uint8]) -> None:
    h, w = rgb.shape[0], rgb.shape[1]
    raw = b"".join(b"\x00" + rgb[r].tobytes() for r in range(h))
    png = (b"\x89PNG\r\n\x1a\n"
           + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + _png_chunk(b"IDAT", zlib.compress(raw, 9))
           + _png_chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def _heatmap(field: npt.NDArray[np.float32]) -> npt.NDArray[np.uint8]:
    """Blue inside, white zero band, red outside; clamped at +/-5 cm."""
    v = np.clip(field.astype(np.float64), -0.05, 0.05)
    t = np.abs(v) / 0.05
    rgb = np.zeros(v.shape + (3,), dtype=np.uint8)
    neg = v < -2e-3
    pos = v > 2e-3
    band = ~(neg | pos)
    rgb[neg] = np.stack((40 * (1 - t[neg]), 60 * (1 - t[neg]),
                         255 - 175 * t[neg]), axis=-1).astype(np.uint8)
    rgb[pos] = np.stack((255 - 115 * t[pos], 90 * (1 - t[pos]),
                         40 * (1 - t[pos])), axis=-1).astype(np.uint8)
    rgb[band] = 245
    return rgb


def write_analytic_preview(path: Path, panels: list[tuple[str, DenseSdfResult]],
                           upscale: int = 5, gutter: int = 6) -> None:
    """Deterministic 2xN mid-plane heatmap preview (no fonts, no renderer)."""
    tiles = []
    for _label, res in panels:
        f = res.values_f32
        # slice through the plane with the most interior DEPTH: exact-surface
        # planes (values ~ -1e-7) must not win over deep interior planes
        z_mid = int(np.argmin(np.minimum(f, 0.0).sum(axis=(1, 2))))
        tiles.append(_heatmap(f[z_mid]))
    side = tiles[0].shape[0]
    rows = 2 if len(tiles) > 1 else 1
    cols = (len(tiles) + rows - 1) // rows
    w = cols * side * upscale + (cols + 1) * gutter
    h = rows * side * upscale + (rows + 1) * gutter
    canvas = np.full((h, w, 3), 24, dtype=np.uint8)
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        big = np.repeat(np.repeat(t, upscale, axis=0), upscale, axis=1)
        y0 = gutter + r * (side * upscale + gutter)
        x0 = gutter + c * (side * upscale + gutter)
        canvas[y0:y0 + big.shape[0], x0:x0 + big.shape[1]] = big
    write_png_rgb(path, canvas)


def max_surface_error(result: DenseSdfResult, shape: str,
                      band_m: float) -> tuple[float, int]:
    """Max |sample - analytic| over exact, in-band lattice points."""
    voxel = result.voxel_size_m
    worst = 0.0
    n = 0
    dims = result.dimensions
    for k in range(dims[2]):
        pz = result.bounds_min_m[2] + k * voxel[2]
        for j in range(dims[1]):
            py = result.bounds_min_m[1] + j * voxel[1]
            for i in range(dims[0]):
                px = result.bounds_min_m[0] + i * voxel[0]
                ref = analytic_reference(shape, (px, py, pz), max(voxel))
                if ref is None:
                    continue
                want, exact = ref
                if not exact or abs(want) > band_m - max(voxel):
                    continue
                got = float(result.values_f32[k, j, i])
                worst = max(worst, abs(got - want))
                n += 1
    return worst, n


QUALIFICATION_COMMANDS = [
    "uv run scripts/test_blender_sdf_grid.py -v",
    "uv run scripts/blender_sdf_grid.py --probe-capabilities",
    "uv run scripts/blender_sdf_grid.py --analytic-fixture",
]


def run_qualification(out_dir: Path = NOTES_DIR) -> dict[str, Any]:
    """Run every gate twice, write qualification.json + analytic-preview.png."""
    out_dir.mkdir(parents=True, exist_ok=True)
    caps = probe_capabilities()
    report: dict[str, Any] = {
        "generatedBy": "scripts/blender_sdf_grid.py --analytic-fixture",
        "commands": QUALIFICATION_COMMANDS,
        "blenderVersion": caps["blenderVersion"],
        "blenderPath": caps["blenderPath"],
        "availableNodes": caps["nodes"],
        "capabilities": {
            "routeA": caps["routeA"],
            "routeB": caps["routeB"],
            "sampleGridFieldEval": caps["sampleGridFieldEval"],
            "sdfGridBoolean": caps["sdfGridBoolean"],
        },
        "nodeContract": build_node_contract(SdfGridSpec.analytic_default()),
        "selectedRoute": SdfGridRoute.selected_default(),
        "fixtures": [],
        "determinism": {},
        "notes": [
            "Route A bakes Store Named Grid via GeometryNodeBake "
            "(bake_target=DISK) and reads the .vdb back with Blender's "
            "bundled openvdb module; the signed background keeps deep "
            "interior samples negative.",
            "Mesh to SDF Grid is narrow-band: samples deeper than "
            "band_width * voxel_size clamp at -/+band; band_width must cover "
            "the fixture's max |distance| / voxel_size.",
            "GeometryNodeSDFGridBoolean is BROKEN in Blender 5.2.0 headless: "
            "it evaluates to its Grid 2 input regardless of operation "
            "(capabilities.sdfGridBoolean carries the measured evidence). "
            "Union therefore uses Join Geometry + one Mesh to SDF Grid and "
            "intersection composes baked named grids with openvdb "
            "combine(max); Route B intersections re-import the composed grid "
            "as a volume object and mesh it through Get Named Grid.",
            "Route B resamples the Grid to Mesh (threshold=0, adaptivity=0) "
            "isosurface through bake_hand_sdf.py's existing libigl "
            "unsigned + fast-winding-number sampler.",
        ],
    }
    route_a_supported = bool(caps["routeA"].get("supported"))
    route_b_supported = bool(caps["routeB"].get("supported"))
    if not (route_a_supported or route_b_supported):
        raise RuntimeError("neither route is supported; qualification fails")
    shapes = [s for s in FIXTURES if s != "cube-large"]
    routes = [r for r, ok in (
        (SdfGridRoute.DIRECT_VDB, route_a_supported),
        (SdfGridRoute.GRID_TO_MESH_LIBIGL, route_b_supported)) if ok]
    first: dict[tuple[str, str], DenseSdfResult] = {}
    t0 = time.monotonic()
    for shape in shapes:
        for route in routes:
            diag: dict[str, Any] = {}
            res = run_analytic_fixture(shape, route=route, diagnostics=diag)
            stats = validate_dense_sdf(res)
            err, npts = max_surface_error(
                res, shape, band_m=res.voxel_size_m[0] * DEFAULT_BAND_WIDTH)
            entry = {
                "shape": shape, "label": FIXTURES[shape].label, "route": route,
                "dimensions": list(res.dimensions),
                "boundsMinM": list(res.bounds_min_m),
                "boundsMaxM": list(res.bounds_max_m),
                "voxelSizeM": list(res.voxel_size_m),
                "components": count_negative_components(res),
                "maxSurfaceErrorM": round(err, 6),
                "surfaceErrorPoints": npts,
                "metrics": result_metrics(res),
                "validate": {k: (round(v, 6) if isinstance(v, float) else v)
                             for k, v in stats.items()},
                "timings": {**diag.get("timings", {}),
                            **diag.get("inner", {}).get("routeA", {})
                            .get("timings", {}),
                            **diag.get("inner", {}).get("routeB", {})
                            .get("timings", {})},
            }
            report["fixtures"].append(entry)
            first[(shape, route)] = res
    report["timings"] = {"totalS": round(time.monotonic() - t0, 1)}
    # -- determinism: repeat the complete fixture on the selected route.
    same_json = True
    same_r16f = True
    for shape in shapes:
        a = first[(shape, SdfGridRoute.selected_default())]
        b = run_analytic_fixture(shape, route=SdfGridRoute.selected_default())
        same_json &= canonical_json(result_metrics(a)) == canonical_json(
            result_metrics(b))
        same_r16f &= encode_r16f_bytes(a) == encode_r16f_bytes(b)
        same_r16f &= bool(np.array_equal(a.values_f32, b.values_f32))
    report["determinism"] = {
        "route": SdfGridRoute.selected_default(),
        "canonicalJsonEqual": bool(same_json),
        "r16fBytesEqual": bool(same_r16f),
        "fixtures": shapes,
    }
    if not (same_json and same_r16f):
        raise RuntimeError("repeated runs are not identical; qualification fails")
    # -- deterministic preview from the selected route's first-pass results.
    preview_shapes = ["cube", "sphere", "union-pair", "body-support-intersect"]
    write_analytic_preview(
        out_dir / "analytic-preview.png",
        [(s, first[(s, SdfGridRoute.selected_default())]) for s in preview_shapes])
    report["previewPng"] = "docs/dev-notes/2026-08-18-blender-sdf-grid/analytic-preview.png"
    report["previewPanels"] = preview_shapes
    # The array-mesh adapter section is owned by the Task 3 real-source
    # qualifier; carry it forward so regenerating the analytic fixtures never
    # silently drops evidence this run did not produce.
    existing = out_dir / "qualification.json"
    if existing.exists():
        try:
            previous = json.loads(existing.read_text())
        except json.JSONDecodeError:
            previous = {}
        if "arrayMeshAdapters" in previous:
            report["arrayMeshAdapters"] = previous["arrayMeshAdapters"]
    existing.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return report


# ===========================================================================
# CLI
# ===========================================================================

def parse_args(argv: list[str]) -> Any:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--probe-capabilities", action="store_true",
                    help="one Blender launch: version, nodes, both routes")
    ap.add_argument("--analytic-fixture", action="store_true",
                    help="run all analytic gates twice; write the "
                         "qualification report + preview")
    ap.add_argument("--out-dir", type=Path, default=NOTES_DIR,
                    help="directory for qualification artifacts")
    ap.add_argument("--blender-inner", type=Path, nargs=2, metavar=("REQ", "RES"),
                    help=argparse.SUPPRESS)     # internal: re-entry in Blender
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--" in argv:                       # Blender re-entry splits at --
        argv = argv[argv.index("--") + 1:]
    args = parse_args(argv)
    if args.blender_inner is not None:
        _inner_main(str(args.blender_inner[0].resolve()),
                    str(args.blender_inner[1].resolve()))
        return 0
    if args.probe_capabilities:
        print(json.dumps(probe_capabilities(), indent=2, sort_keys=True))
        return 0
    if args.analytic_fixture:
        report = run_qualification(args.out_dir)
        print(json.dumps({k: report[k] for k in
                          ("blenderVersion", "selectedRoute", "determinism")},
                         indent=2))
        print(f"[qualification] fixtures={len(report['fixtures'])} "
              f"-> {args.out_dir / 'qualification.json'}")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
