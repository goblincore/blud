#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
"""Bake one relaxed right hand into an anisotropic R16F 3D signed-distance volume.

X1.26 dispatch task A (docs/superpowers/plans/2026-08-17-sdf-hand-bake-prototype.md,
design: docs/superpowers/specs/2026-08-17-sdf-hand-bake-design.md).

Two stages:

  outer (this file, plain Python + libigl via PEP 723)
      launches Blender on THIS SAME FILE with `--blender-export <mesh.npz>`,
      then queries the exported soup on a metric grid and writes the volume.

  inner (runs INSIDE Blender, no libigl available there)
      imports the verified pose helpers from pose_measure_hands.py, authors the
      relaxed pose, keeps whole non-nail right-hand face components, skins with
      the existing inverse-bind LBS, cuts 35 mm proximal to the wrist and caps
      ONLY the cut edges, renders the mesh preview, saves the soup to NPZ.

Sign strategy (deliberate, see design): the exact unsigned closest-triangle
distance provides magnitude, and abs(fast_winding_number) > 0.5 provides the
inside mask. libigl's combined SIGNED_DISTANCE_TYPE_FAST_WINDING_NUMBER mode
attenuates magnitude by the fractional sign on an open soup (cube with two
triangles removed: -0.667 at the center instead of the true -1.0), which is why
the two operations are queried separately.

NEVER commit the downloaded source model, its .bin, or any temporary mesh; the
checked-in derived volume/preview carry the DavidFischer CC-BY-4.0 attribution.

Usage:
    uv run scripts/bake_hand_sdf.py                 # full bake (needs Blender + source)
    uv run scripts/bake_hand_sdf.py --validate-only # validate checked-in asset
    uv run scripts/bake_hand_sdf.py --self-test     # sign/order/encoding proofs
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Sequence

import numpy as np
import numpy.typing as npt

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
R16F_PATH = REPO_ROOT / "public" / "assets" / "lab" / "hand-sdf-relaxed-r.r16f"
JSON_PATH = REPO_ROOT / "public" / "assets" / "lab" / "hand-sdf-relaxed-r.json"
PREVIEW_PATH = REPO_ROOT / "docs" / "dev-notes" / "2026-08-17-sdf-hand-bake" / "mesh-preview.png"

DEFAULT_PITCH_M = 0.0015          # 1.5 mm target voxel pitch
DEFAULT_MARGIN_M = 0.012          # 12 mm AABB margin around the posed hand
DEFAULT_CHUNK_POINTS = 262_144    # query points per libigl call
WRIST_CUT_M = 0.035               # cut plane this far proximal of the wrist pivot

MANIFEST_VERSION = 1
ENCODING = "r16f-le"              # IEEE-754 half float, little endian
ORDER = "x-fastest-y-z"           # memory order of the binary volume
AXIS_NAMES = {"x": "thumbward", "y": "distal", "z": "dorsal"}
ISO_VALUE = 0.0

FIELD_DTYPE = "<f2"               # little-endian float16


# ===========================================================================
# Grid specification and pure helpers (no Blender, no libigl, no source model)
# ===========================================================================

@dataclasses.dataclass(frozen=True)
class GridSpec:
    """Anisotropic endpoint-inclusive sample lattice over a metric AABB.

    dims         (nx, ny, nz) sample counts; the first/last samples sit exactly
                 on bounds_min/bounds_max, so voxel = extent / (dims - 1).
    bounds_min/max  metric AABB in the anatomical frame (metres).
    voxel        measured per-axis voxel size (<= requested pitch).
    """

    dims: tuple[int, int, int]
    bounds_min: tuple[float, float, float]
    bounds_max: tuple[float, float, float]
    voxel: tuple[float, float, float]


def grid_spec(
    bounds_min: Sequence[float],
    bounds_max: Sequence[float],
    pitch: float,
    margin: float,
) -> GridSpec:
    """Build the sample lattice: dims = ceil(extent / pitch) + 1 per axis.

    `bounds_*` are the posed mesh AABB; the margin pads it before dimensions
    are derived, so the AABB boundary samples are strictly outside the hand.
    """
    lo = tuple(float(v) for v in bounds_min)
    hi = tuple(float(v) for v in bounds_max)
    if len(lo) != 3 or len(hi) != 3:
        raise ValueError(f"bounds must be 3-vectors, got {lo!r} / {hi!r}")
    dims: list[int] = []
    vox: list[float] = []
    for a, b in zip(lo, hi):
        extent = (b - a) + 2.0 * margin
        if extent <= 0.0:
            raise ValueError(f"non-positive extent on axis: {a}..{b} + {margin}")
        # The -1e-9 snaps exact multiples back down: 0.07/0.005 is
        # 14.000000000000002 in float64 and a bare ceil would add a spurious
        # extra voxel row on cleanly-dividing extents.
        n = int(np.ceil(extent / pitch - 1e-9)) + 1
        dims.append(n)
        vox.append(extent / (n - 1))
    return GridSpec(
        dims=(dims[0], dims[1], dims[2]),
        bounds_min=(lo[0] - margin, lo[1] - margin, lo[2] - margin),
        bounds_max=(hi[0] + margin, hi[1] + margin, hi[2] + margin),
        voxel=(vox[0], vox[1], vox[2]),
    )


def grid_points(spec: GridSpec, z0: int, z1: int) -> npt.NDArray[np.float64]:
    """Query points for z-slab [z0, z1) as an (N, 3) float64 array.

    X-fastest, then Y, then Z -- exactly the order of the stored field, so the
    slab reshapes directly into field[z0:z1, :, :].
    """
    if not (0 <= z0 < z1 <= spec.dims[2]):
        raise ValueError(f"z-slab [{z0},{z1}) outside grid depth {spec.dims[2]}")
    x = np.linspace(spec.bounds_min[0], spec.bounds_max[0], spec.dims[0])
    y = np.linspace(spec.bounds_min[1], spec.bounds_max[1], spec.dims[1])
    z = np.linspace(spec.bounds_min[2], spec.bounds_max[2], spec.dims[2])
    zz, yy, xx = np.meshgrid(z[z0:z1], y, x, indexing="ij")
    return np.column_stack((xx.ravel(), yy.ravel(), zz.ravel()))


def validate_field(field: npt.NDArray[np.float32] | npt.NDArray[np.float64],
                   spec: GridSpec) -> dict:
    """Reject a baked field that cannot be a trustworthy signed distance.

    Returns stats on success; raises ValueError naming the violation otherwise.
    """
    expected = tuple(reversed(spec.dims))       # field[z, y, x]
    if tuple(field.shape) != expected:
        raise ValueError(f"field shape {field.shape} != z,y,x {expected}")
    if not np.isfinite(field).all():
        raise ValueError("field contains non-finite samples")
    negatives = int((field < 0.0).sum())
    positives = int((field > 0.0).sum())
    if negatives == 0:
        raise ValueError("field has no inside (negative) samples")
    if positives == 0:
        raise ValueError("field has no outside (positive) samples")
    faces = (
        field[0, :, :], field[-1, :, :],     # z boundary
        field[:, 0, :], field[:, -1, :],     # y boundary
        field[:, :, 0], field[:, :, -1],     # x boundary
    )
    worst = min(float(f.min()) for f in faces)
    if worst <= 0.0:
        raise ValueError(f"AABB boundary not wholly outside: min {worst:.6f}")
    return {
        "min": float(field.min()),
        "max": float(field.max()),
        "negatives": negatives,
        "positives": positives,
        "negativeFraction": negatives / field.size,
        "boundaryMin": worst,
    }


def write_r16f(path: Path, field: npt.NDArray[np.floating]) -> tuple[int, str]:
    """Write the field as little-endian half floats, X-fastest (C order)."""
    data = field.astype(FIELD_DTYPE, copy=False).tobytes(order="C")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return len(data), hashlib.sha256(data).hexdigest()


def write_manifest(
    path: Path,
    spec: GridSpec,
    *,
    binary_file: str,
    binary_sha256: str,
    source_sha256: str,
    attribution: str,
    stats: dict,
    pitch_m: float,
    margin_m: float,
    duration_s: float,
    extra: dict | None = None,
) -> None:
    manifest = {
        "version": MANIFEST_VERSION,
        "binary": binary_file,
        "encoding": ENCODING,
        "order": ORDER,
        "axes": dict(AXIS_NAMES),
        "dimensions": list(spec.dims),
        "boundsMin": list(spec.bounds_min),
        "boundsMax": list(spec.bounds_max),
        "voxelSize": list(spec.voxel),
        "isoValue": ISO_VALUE,
        "byteLength": 2 * int(np.prod(spec.dims)),
        "sha256": {"binary": binary_sha256, "source": source_sha256},
        "attribution": attribution,
        "bake": {
            "targetPitchM": pitch_m,
            "marginM": margin_m,
            "durationS": round(duration_s, 3),
            **stats,
            **(extra or {}),
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2) + "\n")


def validate_asset(json_path: Path, r16f_path: Path) -> dict:
    """Validate a checked-in volume against its manifest. No Blender, no model."""
    manifest = json.loads(json_path.read_text())
    if manifest.get("version") != MANIFEST_VERSION:
        raise ValueError(f"manifest version {manifest.get('version')!r} != {MANIFEST_VERSION}")
    for key, want in (("encoding", ENCODING), ("order", ORDER)):
        if manifest.get(key) != want:
            raise ValueError(f"manifest {key} {manifest.get(key)!r} != {want!r}")
    if manifest.get("axes") != AXIS_NAMES:
        raise ValueError(f"manifest axes {manifest.get('axes')!r} != {AXIS_NAMES!r}")
    dims = tuple(int(v) for v in manifest["dimensions"])
    if len(dims) != 3 or min(dims) < 2:
        raise ValueError(f"dimensions {dims} invalid")
    lo = tuple(float(v) for v in manifest["boundsMin"])
    hi = tuple(float(v) for v in manifest["boundsMax"])
    if any(b <= a for a, b in zip(lo, hi)):
        raise ValueError(f"bounds not strictly ordered: {lo} .. {hi}")
    if not all(np.isfinite(lo)) or not all(np.isfinite(hi)):
        raise ValueError("bounds not finite")
    voxel = tuple(float(v) for v in manifest["voxelSize"])
    want_voxel = tuple((b - a) / (n - 1) for a, b, n in zip(lo, hi, dims))
    if any(abs(v - w) > 1e-9 + 1e-6 * abs(w) for v, w in zip(voxel, want_voxel)):
        raise ValueError(f"voxel size {voxel} inconsistent with bounds/dims {want_voxel}")
    if manifest.get("isoValue") != ISO_VALUE:
        raise ValueError("isoValue must be 0.0")
    data = r16f_path.read_bytes()
    want_bytes = 2 * int(np.prod(dims))
    if len(data) != want_bytes:
        raise ValueError(f"byte length {len(data)} != {want_bytes} (2*nx*ny*nz)")
    digest = hashlib.sha256(data).hexdigest()
    if digest != manifest["sha256"]["binary"]:
        raise ValueError("binary sha256 mismatch")
    field = decode_r16f(data, dims)
    spec = GridSpec(dims=dims, bounds_min=lo, bounds_max=hi, voxel=voxel)
    stats = validate_field(field, spec)
    return {"manifest": manifest, "stats": stats}


def decode_r16f(data: bytes, dims: tuple[int, int, int]) -> npt.NDArray[np.float32]:
    """Decode little-endian half floats into field[z, y, x] (x fastest)."""
    flat = np.frombuffer(data, dtype=FIELD_DTYPE).astype(np.float32)
    if flat.size != int(np.prod(dims)):
        raise ValueError(f"sample count {flat.size} != {int(np.prod(dims))}")
    return flat.reshape(dims[2], dims[1], dims[0])


# ===========================================================================
# libigl field bake (outer stage)
# ===========================================================================

def cube_mesh(half: float = 1.0, remove_face: str | None = None
              ) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.int64]]:
    """Axis-aligned cube, outward-oriented triangles, optionally one face open.

    The reference geometry for the sign/order self-tests: a closed cube has
    winding exactly 1 at its center; removing one face's two triangles leaves
    winding 5/6 while the unsigned closest-triangle distance stays the exact
    metric distance (what libigl's combined FWN mode destroys). Triangle
    orientation is computed, not hand-authored: every face is flipped to point
    away from the cube center.
    """
    s = float(half)
    v = np.array([[a, b, c] for a in (-s, s) for b in (-s, s) for c in (-s, s)],
                 dtype=np.float64)
    quads = {"x-": (0, 2, 3, 1), "x+": (4, 5, 7, 6),
             "y-": (0, 1, 5, 4), "y+": (2, 6, 7, 3),
             "z-": (0, 4, 6, 2), "z+": (1, 3, 7, 5)}
    tris: list[tuple[int, int, int]] = []
    for name, (a, b, c, d) in quads.items():
        if name == remove_face:
            continue
        tris += [(a, b, c), (a, c, d)]
    f = np.array(tris, dtype=np.int64)
    normals = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    outward = np.einsum("ij,ij->i", normals, v[f].mean(axis=1))
    f[outward < 0] = f[outward < 0][:, [0, 2, 1]]
    return v, f


def bake_chunk(points: npt.NDArray[np.float64], vertices: npt.NDArray[np.float64],
               faces: npt.NDArray[np.int64]) -> npt.NDArray[np.float64]:
    """Signed distance for one chunk of query points: exact unsigned magnitude,
    fast-winding-number inside mask. `import igl` stays lazy so the Blender
    stage can run this same file without libigl."""
    import igl

    unsigned_kind = igl.SignedDistanceType.SIGNED_DISTANCE_TYPE_UNSIGNED
    unsigned, _, _, _ = igl.signed_distance(points, vertices, faces, unsigned_kind)
    winding = igl.fast_winding_number(vertices, faces, points)
    return np.where(np.abs(winding) > 0.5, -unsigned, unsigned)


def bake_field(
    vertices: npt.NDArray[np.float64],
    faces: npt.NDArray[np.int64],
    spec: GridSpec,
    chunk_points: int,
    log: bool = True,
) -> tuple[npt.NDArray[np.float64], dict]:
    """Fill the whole grid z-slab by z-slab. Returns (field[z,y,x], probe stats)."""
    import igl

    slab = max(1, int(np.ceil(chunk_points / (spec.dims[0] * spec.dims[1]))))
    field = np.empty((spec.dims[2], spec.dims[1], spec.dims[0]), dtype=np.float64)
    t0 = time.monotonic()
    z = 0
    while z < spec.dims[2]:
        z1 = min(z + slab, spec.dims[2])
        points = grid_points(spec, z, z1)
        field[z:z1, :, :] = bake_chunk(points, vertices, faces).reshape(
            z1 - z, spec.dims[1], spec.dims[0])
        if log:
            print(f"[bake] grid slab z[{z:4d},{z1:4d}) of {spec.dims[2]} "
                  f"({points.shape[0]} pts, {time.monotonic() - t0:6.1f}s)", flush=True)
        z = z1

    # Winding probes: diagnose orientation/threshold trouble, never silently fix.
    # Interior probes are FIXED offsets along the anatomical +Y axis (2 cm and
    # 4.5 cm distal of the wrist pivot = carpus / palm centre). The vertex
    # centroid is NOT usable: with splayed fingers it lands between the digits
    # where an open soup winds ~0 (measured -0.012 while the palm read +0.97).
    probes = {}
    interior = np.array([[0.0, 0.02, 0.0], [0.0, 0.045, 0.0]], dtype=np.float64)
    corner = np.array([spec.bounds_max], dtype=np.float64)
    for name, q in (("carpusInterior", interior[0:1]),
                    ("palmInterior", interior[1:2]),
                    ("farCorner", corner)):
        w = float(igl.fast_winding_number(vertices, faces, q)[0])
        probes[name] = {"point": [float(c) for c in q[0]], "winding": w}
    for name in ("carpusInterior", "palmInterior"):
        if abs(probes[name]["winding"]) <= 0.5:
            raise SystemExit(
                f"{name} winding {probes[name]['winding']:+.3f} is not "
                "inside: inconsistent triangle orientation or an invalid "
                "threshold. Do NOT negate the field blindly; inspect the soup "
                "orientation.")
    if abs(probes["farCorner"]["winding"]) > 0.5:
        raise SystemExit(
            f"far-corner winding {probes['farCorner']['winding']:+.3f} reads inside: "
            "the winding threshold or the soup is broken.")
    return field, probes


# ===========================================================================
# Self-test: sign, ordering, and dirty-soup behavior (no Blender, no model)
# ===========================================================================

def run_self_test() -> None:
    def check(name: str, fn) -> None:
        fn()
        print(f"[self-test] PASS {name}", flush=True)

    def closed_cube() -> None:
        import igl
        v, f = cube_mesh(1.0)
        q = np.array([[0.0, 0.0, 0.0], [1.25, 0.0, 0.0]], dtype=np.float64)
        d = bake_chunk(q, v, f)
        assert d[0] < 0.0 and abs(d[0] + 1.0) < 1e-9, f"center {d[0]}"
        assert d[1] > 0.0 and abs(d[1] - 0.25) < 1e-9, f"outside {d[1]}"
        w = igl.fast_winding_number(v, f, q)
        assert abs(w[0]) > 0.5 and abs(w[1]) <= 0.5, w
        # zero crossing within one pitch along a face-crossing ray
        pitch = 0.05
        ray = np.linspace(0.5, 1.5, 41, dtype=np.float64)[:, None] * np.array([[1, 0, 0]],
                                                                              dtype=np.float64)
        dd = bake_chunk(ray, v, f)
        assert float(np.abs(dd).min()) <= pitch, "no zero crossing near the surface"

    def dirty_cube() -> None:
        import igl
        v, f = cube_mesh(1.0, remove_face="x+")
        w = igl.fast_winding_number(v, f, np.array([[0.0, 0.0, 0.0]], dtype=np.float64))
        assert abs(float(w[0])) > 0.5, f"winding {w[0]} not inside"
        d = bake_chunk(np.array([[0.0, 0.0, 0.0]], dtype=np.float64), v, f)[0]
        assert abs(d + 1.0) < 1e-9, (
            f"dirty-cube center {d:+.6f} is not the exact unsigned magnitude "
            "(libigl combined-FWN parity/fractional regression)")

    def x_fastest() -> None:
        nx, ny, nz = 3, 2, 2
        spec = GridSpec(dims=(nx, ny, nz),
                        bounds_min=(0.0, 0.0, 0.0), bounds_max=(1.0, 1.0, 1.0),
                        voxel=(0.5, 1.0, 1.0))
        pts = grid_points(spec, 0, nz)
        # X changes across the first three samples, then Y, then Z.
        assert np.allclose(pts[:3, 0], (0.0, 0.5, 1.0)), pts[:3]
        assert np.allclose(pts[:3, 1:], pts[0, 1:]), "X-fastest: y,z constant first"
        assert np.allclose(pts[3], (0.0, 1.0, 0.0)), "Y advances after X exhausts"
        assert np.allclose(pts[6], (0.0, 0.0, 1.0)), "Z slowest"
        # The stored field agrees with the query order: decode half floats.
        field = np.arange(nx * ny * nz, dtype=np.float64).reshape(nz, ny, nx)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "f.r16f"
            n, _ = write_r16f(p, field)
            assert n == 2 * nx * ny * nz
            back = decode_r16f(p.read_bytes(), (nx, ny, nz))
            assert back.flat[0] == 0.0 and back.flat[1] == 1.0 and back.flat[2] == 2.0
            assert back.flat[3] == 3.0, "after X, Y must advance"

    def manifest_roundtrip() -> None:
        spec = grid_spec((0.0, 0.0, 0.0), (0.1, 0.05, 0.02), 0.005, 0.01)
        nz, ny, nx = spec.dims[2], spec.dims[1], spec.dims[0]
        # synthetic but structurally valid: negative core, positive shell
        cx, cy, cz = nx // 2, ny // 2, nz // 2
        field = np.ones((nz, ny, nx), dtype=np.float64)
        field[cz - 1:cz + 2, cy - 1:cy + 2, cx - 1:cx + 2] = -1.0
        field[cz, cy, cx] = -1.0
        with tempfile.TemporaryDirectory() as tmp:
            r16f, man = Path(tmp) / "v.r16f", Path(tmp) / "v.json"
            n, sha = write_r16f(r16f, field)
            assert n == 2 * nx * ny * nz
            write_manifest(man, spec, binary_file=r16f.name, binary_sha256=sha,
                           source_sha256="0" * 64, attribution="CC-BY test",
                           stats=validate_field(field, spec), pitch_m=0.005,
                           margin_m=0.01, duration_s=0.0)
            out = validate_asset(man, r16f)
            assert out["manifest"]["byteLength"] == 2 * nx * ny * nz
            assert out["stats"]["negatives"] == 27 and out["stats"]["positives"] > 0

    check("fast-winding sign: closed and dirty cube keep exact unsigned magnitude",
          closed_cube)
    check("dirty soup: winding 5/6 classifies inside, magnitude stays -1.0", dirty_cube)
    check("X-fastest R16F: encode/decode order x then y then z", x_fastest)
    check("manifest v1: version/encoding/order/axis/voxel/sha round-trip",
          manifest_roundtrip)
    print("[self-test] ALL PASS")


# ===========================================================================
# Blender inner stage: pose, component-extract, skin, cut, cap, preview, NPZ
# ===========================================================================

# The relaxed pose (design spec table): per digit, MCP splay degrees (abduction
# away from the middle column), then MCP/PIP/DIP flex degrees (palmward).
RELAXED_POSE: dict[str, tuple[float, tuple[float, float, float]]] = {
    "index": (9.0, (12.0, 18.0, 8.0)),
    "middle": (0.0, (15.0, 22.0, 10.0)),
    "ring": (5.0, (19.0, 27.0, 13.0)),
    "pinky": (11.0, (24.0, 32.0, 16.0)),
}


# ---- stable authoring stages, shared by the clip baker (X1.27) ------------
# Each helper is the exact code path the static v1 bake runs; factoring them
# out (instead of copying) is what guarantees the six grip poses and the
# checked-in X1.26 volume are built by ONE implementation. They need
# Blender's mathutils/bmesh and are only ever called from inside Blender.

def relaxed_rotations(hand) -> dict:
    """The X1.26 relaxed open pose (deterministic; thumb stays at rest)."""
    import math

    sys.path.insert(0, str(SCRIPTS_DIR))
    from pose_measure_hands import FINGERS, add_rot, flex_sign, splay_sign

    fsign = flex_sign(hand)
    rots: dict = {}
    for f in FINGERS:
        splay_deg, (mcp, pip, dip) = RELAXED_POSE[f]
        away = 0.0 if f == "middle" else -splay_sign(hand, f, "middle")
        add_rot(hand, rots, hand.ph[f][0], hand.B, math.radians(splay_deg) * away)
        for bone, deg in zip(hand.ph[f], (mcp, pip, dip)):
            add_rot(hand, rots, bone, hand.A, math.radians(deg) * fsign)
    return rots


def extract_right_hand_components(gltf) -> dict:
    """Whole-component right-hand extraction (no per-vertex thresholds).

    Connected face components of the concatenated soup; a component is kept
    when it is not a nail mesh AND its AGGREGATE right-hand skin weight beats
    its left-hand weight.
    """
    pos, wts, faces, nail = gltf.skinned_geometry()

    parent = list(range(len(pos)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for tri in faces:
        union(tri[0], tri[1])
        union(tri[0], tri[2])

    comps: dict[int, dict] = {}
    for i in range(len(pos)):
        comps.setdefault(find(i), {"verts": [], "nail": False,
                                   "w_right": 0.0, "w_left": 0.0})["verts"].append(i)
    for root, comp in comps.items():
        for i in comp["verts"]:
            if nail[i]:
                comp["nail"] = True
            for k, w in wts[i].items():
                if f".R" in k:
                    comp["w_right"] += w
                elif f".L" in k:
                    comp["w_left"] += w

    kept_roots = sorted(root for root, c in comps.items()
                        if not c["nail"] and c["w_right"] > c["w_left"])
    kept_verts = sorted(i for root in kept_roots for i in comps[root]["verts"])
    kept_set = set(kept_verts)
    remap = {old: new for new, old in enumerate(kept_verts)}
    kept_faces = [(remap[a], remap[b], remap[c]) for a, b, c in faces
                  if a in kept_set and b in kept_set and c in kept_set]
    print(f"[blender] soup: {len(pos)} verts / {len(faces)} tris / "
          f"{len(comps)} components -> kept {len(kept_roots)} right component(s): "
          + ", ".join(f"{len(comps[r]['verts'])}v "
                       f"R{comps[r]['w_right']:.1f}>L{comps[r]['w_left']:.1f}"
                       for r in kept_roots))
    if not kept_roots:
        raise SystemExit("no right-hand component found")
    return {"pos": pos, "wts": wts, "nail": nail,
            "kept_verts": kept_verts, "kept_faces": kept_faces,
            "components": {"total": len(comps), "kept": len(kept_roots),
                           "keptVerts": len(kept_verts),
                           "keptFaces": len(kept_faces)}}


def inverse_bind_skin(hand, world, extract: dict) -> list[tuple[float, float, float]]:
    """Inverse-bind LBS over EVERY retained vertex of the extraction.

    Same verified formula as Hand.skin(): chain-restricted weights, everything
    else (arm/other-side bindings) rides the identity `free` share.
    """
    from mathutils import Vector

    chain = set(hand.chain)
    posed: list[tuple[float, float, float]] = []
    for i in extract["kept_verts"]:
        w = {k: v for k, v in extract["wts"][i].items() if k in chain}
        free = 1.0 - sum(w.values())
        p = Vector(extract["pos"][i]) * hand.scale
        acc = p * free if free > 1e-6 else Vector((0.0, 0.0, 0.0))
        for name, weight in w.items():
            acc += (world[name] @ p) * weight
        posed.append((acc.x, acc.y, acc.z))
    return posed


def anatomical_frame(hand, world):
    """Right-handed anatomical frame from the posed skeleton.

    +X thumbward, +Y distal, +Z dorsal (Z := cross(X, Y)). Returns
    (x_axis, y_axis, z_axis, origin, dorsal_sign) where dorsal_sign says which
    local ±Z is the back of the hand for THIS mesh.
    """
    from mathutils import Vector

    sys.path.insert(0, str(SCRIPTS_DIR))
    from pose_measure_hands import FINGERS

    origin = hand.posed_pivot(world, hand.wrist)
    x_axis = Vector(hand.A)                       # pinky MCP -> index MCP
    if (hand.posed_tip(world, hand.thumb[2]) - origin).dot(x_axis) < 0.0:
        x_axis = x_axis * -1.0                    # flip X toward the thumb
    mcp_mid = sum((hand.posed_pivot(world, hand.ph[f][0]) for f in FINGERS),
                  Vector((0.0, 0.0, 0.0))) / 4.0
    y_axis = mcp_mid - origin
    y_axis = (y_axis - x_axis * y_axis.dot(x_axis)).normalized()
    z_axis = x_axis.cross(y_axis)
    frame = (x_axis, y_axis, z_axis)
    eps = 1e-6
    assert all(abs(ax.length - 1.0) < eps for ax in frame), "frame not unit"
    assert abs(x_axis.dot(y_axis)) < eps, "frame not orthogonal"
    assert (x_axis.cross(y_axis) - z_axis).length < eps, "frame not right-handed"
    dorsal_dot_b = z_axis.dot(hand.B)
    dorsal_sign = 1.0 if dorsal_dot_b >= 0.0 else -1.0
    return x_axis, y_axis, z_axis, origin, dorsal_sign


def wrist_cut_cap(local_verts, kept_faces, mesh_name: str = "HandRelaxedR") -> dict:
    """35 mm wrist cut: bisect, weld ONLY the cut ring, cap ONLY cut edges.

    Returns numpy arrays + boundary diagnostics. Hard-fails whenever the cap
    fills nothing (the X1.26 wrist-cap trap: an open cut ring silently leaves
    an uncapped wrist).
    """
    import bmesh
    import bpy
    import numpy as np
    from mathutils import Vector

    me = bpy.data.meshes.new(mesh_name)
    me.from_pydata([Vector(v) for v in local_verts], [], [tuple(f) for f in kept_faces])
    me.validate()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    def boundary_edges(bm_) -> int:
        return sum(1 for e in bm_.edges if e.is_boundary)

    before_boundary = boundary_edges(bm)
    result = bmesh.ops.bisect_plane(
        bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:],
        plane_co=(0.0, -WRIST_CUT_M, 0.0), plane_no=(0.0, -1.0, 0.0),
        clear_outer=True)                        # clears the proximal -Y side
    cut_edges = [e for e in result["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    if min(v.co.y for v in bm.verts) < -WRIST_CUT_M - 1e-6:
        raise SystemExit("bisect kept the wrong side (proximal geometry remains)")
    if not cut_edges:
        raise SystemExit("wrist cut produced no boundary edges -- plane missed the mesh?")
    after_cut_boundary = boundary_edges(bm)

    # The cut ring can be TOPOLOGICALLY open when the plane crosses a source
    # seam: two distinct but coincident vertices split the ring into a chain
    # and holes_fill refuses open chains (observed: degrees {2: 41, 1: 2}).
    # Weld ONLY coincident vertices of the cut ring itself, at sub-micron
    # distance -- source seams everywhere else are left exactly as they are.
    ring_verts = list({v.index: v for e in cut_edges for v in e.verts}.values())
    verts_before_weld = len(ring_verts)
    bmesh.ops.remove_doubles(bm, verts=ring_verts, dist=1e-6)
    cut_edges = [e for e in bm.edges if e.is_boundary
                 and abs(e.verts[0].co.y + WRIST_CUT_M) < 1e-4
                 and abs(e.verts[1].co.y + WRIST_CUT_M) < 1e-4]
    welded_pairs = verts_before_weld - len({v.index for e in cut_edges for v in e.verts})

    faces_before_fill = len(bm.faces)
    bmesh.ops.holes_fill(bm, edges=cut_edges, sides=512)
    capped = [f for f in bm.faces if len(f.verts) > 3]
    if capped:
        bmesh.ops.triangulate(bm, faces=capped)
    cap_faces = len(bm.faces) - faces_before_fill
    if cap_faces == 0:
        raise SystemExit(
            f"wrist-cut cap filled nothing ({len(cut_edges)} ring edges, "
            f"{welded_pairs} welded); refusing to bake an uncapped wrist")
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    after_cap_boundary = boundary_edges(bm)
    print(f"[blender] wrist cut at y={-WRIST_CUT_M * 1000:.0f} mm: "
          f"boundary edges {before_boundary} -> cut {after_cut_boundary} "
          f"(cut ring {len(cut_edges)}, welded {welded_pairs}) -> cap "
          f"{after_cap_boundary} (+{cap_faces} faces); "
          f"faces {len(kept_faces)} -> {len(bm.faces)}")

    bm.verts.index_update()
    bm.faces.index_update()
    verts_out = np.array([tuple(v.co) for v in bm.verts], dtype=np.float64)
    faces_out = np.array([[v.index for v in f.verts] for f in bm.faces],
                         dtype=np.int64)
    bm.free()
    bpy.data.meshes.remove(me)
    return {"vertices": verts_out, "faces": faces_out,
            "boundaryEdges": {"source": before_boundary,
                              "afterCut": after_cut_boundary,
                              "afterCap": after_cap_boundary,
                              "cutRing": len(cut_edges),
                              "weldedPairs": welded_pairs,
                              "capFaces": cap_faces}}


def blender_stage(npz_path: Path) -> None:
    """Runs INSIDE Blender (`--python bake_hand_sdf.py -- --blender-export X`).
    Only Blender's bundled modules + pose_measure_hands helpers; never libigl.
    Every stage runs through the shared helpers above so the X1.27 clip author
    and this static v1 bake cannot drift apart."""
    import numpy as np
    from mathutils import Vector

    sys.path.insert(0, str(SCRIPTS_DIR))
    from pose_measure_hands import (  # verified pose/skin helpers
        FINGERS, Gltf, Hand, SRC, ATTRIBUTION,
    )

    def sha256_file(path: Path) -> str:
        import hashlib
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for block in iter(lambda: fh.read(1 << 20), b""):
                h.update(block)
        return h.hexdigest()

    # ---- pose (deterministic; thumb stays at rest) -------------------------
    gltf = Gltf(SRC)
    hand = Hand(gltf, "R")
    rots = relaxed_rotations(hand)
    world = hand.globals(rots)

    # ---- whole-component right-hand extraction -----------------------------
    extract = extract_right_hand_components(gltf)
    kept_faces = extract["kept_faces"]

    # ---- inverse-bind LBS over EVERY retained vertex ------------------------
    posed = inverse_bind_skin(hand, world, extract)

    # ---- anatomical frame: +X thumbward, +Y distal, +Z dorsal ----------------
    # Construction per spec: flip X toward the thumb, then Z := cross(X, Y) so
    # the volume frame is right-handed BY CONSTRUCTION. The nail-measured back
    # normal hand.B is recorded as a diagnostic: on a true right hand
    # cross(thumbward, distal) points PALMAR, so dorsal_sign tells the preview
    # (and the dev note) which local ±Z is the back of the hand for THIS mesh
    # instead of assuming anatomy.
    x_axis, y_axis, z_axis, origin, dorsal_sign = anatomical_frame(hand, world)
    dorsal_dot_b = z_axis.dot(hand.B)
    print(f"[blender] frame: dorsal_sign={dorsal_sign:+.0f} "
          f"(cross(X,Y).B={dorsal_dot_b:+.3f}; "
          f"{'+Z is the nail/back side' if dorsal_sign > 0 else '+Z is the palm side for this mesh'})")

    local = [((Vector(p) - origin).dot(x_axis),
              (Vector(p) - origin).dot(y_axis),
              (Vector(p) - origin).dot(z_axis)) for p in posed]

    # ---- wrist cut: bisect, cap ONLY the new cut edges, no other repair ------
    cut = wrist_cut_cap(local, kept_faces, "HandRelaxedR")
    verts_out, faces_out = cut["vertices"], cut["faces"]

    # ---- neutral 768x768 preview of the exact soup (post cut+cap) ------------
    render_preview_png(verts_out, faces_out, PREVIEW_PATH, dorsal_sign=dorsal_sign)

    # ---- NPZ (temp, never committed) ----------------------------------------
    diagnostics = {
        "pose": {f: {"splayDeg": RELAXED_POSE[f][0],
                     "flexDeg": list(RELAXED_POSE[f][1])} for f in FINGERS},
        "thumb": "rest",
        "components": extract["components"],
        "boundaryEdges": cut["boundaryEdges"],
        "wristCutM": WRIST_CUT_M,
        "frame": {"x": tuple(x_axis), "y": tuple(y_axis), "z": tuple(z_axis),
                   "origin": tuple(origin), "dorsalDotB": dorsal_dot_b},
        "handScale": hand.scale,
        "attribution": ATTRIBUTION,
    }
    npz_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(npz_path,
             vertices=verts_out,
             faces=faces_out,
             frame=np.array([tuple(x_axis), tuple(y_axis), tuple(z_axis),
                             tuple(origin)], dtype=np.float64),
             diagnostics=json.dumps(diagnostics),
             source_sha256=sha256_file(SRC))
    print(f"[blender] exported {len(verts_out)} verts / {len(faces_out)} tris -> {npz_path}")


def render_preview_png(verts: "np.ndarray", faces: "np.ndarray", out_path: Path,
                       dorsal_sign: float = 1.0, res: int = 768) -> None:
    """Neutral lit clay render of the soup, from the thumb-dorsal-distal side
    so five digits and open web spaces are visible in one image. `dorsal_sign`
    flips the eye to the measured back-of-hand side (+/- local Z)."""
    import bpy
    from mathutils import Vector

    sys.path.insert(0, str(SCRIPTS_DIR))
    import pose_measure_hands as pm

    pm.reset_scene()
    obj = pm.make_mesh("HandRelaxedR", [tuple(map(float, v)) for v in verts],
                       [tuple(map(int, f)) for f in faces])
    pm.assign(obj, pm.make_pbr("Clay", (0.66, 0.46, 0.38), 0.6))

    scene = pm.configure_engine(transparent=False)
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.eevee.taa_render_samples = 32
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.05, 0.055, 0.065, 1.0)
    bg.inputs[1].default_value = 0.35
    scene.eevee.use_raytracing = False
    scene.eevee.use_shadow_jitter_viewport = False

    pts = [Vector(tuple(v)) for v in verts]
    target = Vector((0.0, 0.0, 0.0))
    for p in pts:
        target += p
    target /= len(pts)
    reach = max((p - target).length for p in pts)
    # local frame: +X thumbward, +Y distal; the dorsal side is dorsal_sign*+Z.
    # Slightly thumb-side, dorsal, tipped toward the fingertips: reads the
    # digits and the web spaces.
    eye = target + Vector((0.55, 0.35, 0.75 * dorsal_sign)).normalized() * reach * 3.2
    bpy.ops.object.camera_add(location=eye)
    cam = bpy.context.active_object
    cam.data.lens = 52
    pm.point_at(cam, target)
    scene.camera = cam

    def area(nm: str, offs: tuple[float, float, float], energy: float, size: float) -> None:
        loc = target + Vector(offs) * reach * 3.0
        bpy.ops.object.light_add(type="AREA", location=loc)
        light = bpy.context.active_object
        light.name = nm
        light.data.energy = energy
        light.data.size = size
        light.data.use_shadow_jitter = False
        pm.point_at(light, target)

    area("Key", (1.0, -0.5, 1.0), 2.2, 0.26)
    area("Fill", (0.5, -0.9, -1.0), 0.9, 0.40)
    area("Rim", (-0.3, 1.0, 0.4), 1.1, 0.26)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_path)
    bpy.ops.render.render(write_still=True)
    print(f"[blender] preview -> {out_path}")


# ===========================================================================
# Outer driver: Blender export -> grid bake -> R16F + manifest
# ===========================================================================

def run_blender_export(npz_path: Path) -> None:
    """Launch THIS SAME FILE under Blender. Argument list only, never a shell."""
    cmd = ["blender", "--background", "--python", str(Path(__file__).resolve()),
           "--", "--blender-export", str(npz_path)]
    print("[bake] " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def bake(r16f_path: Path, json_path: Path, *, pitch: float, margin: float,
         chunk: int) -> int:
    t0 = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="hand-sdf-") as tmp:
        npz_path = Path(tmp) / "mesh.npz"
        run_blender_export(npz_path)
        with np.load(npz_path) as data:
            vertices = np.asarray(data["vertices"], dtype=np.float64)
            faces_np = np.asarray(data["faces"], dtype=np.int64)
            diagnostics = json.loads(str(data["diagnostics"]))
            source_sha = str(data["source_sha256"])
        print(f"[bake] soup: {vertices.shape[0]} verts / {faces_np.shape[0]} tris "
              f"(boundary edges after cap: "
              f"{diagnostics['boundaryEdges']['afterCap']})")

        spec = grid_spec(vertices.min(axis=0), vertices.max(axis=0), pitch, margin)
        nx, ny, nz = spec.dims
        print(f"[bake] grid dims=({nx},{ny},{nz}) voxel="
              + ",".join(f"{v * 1000:.3f}mm" for v in spec.voxel)
              + f" bounds=({spec.bounds_min},{spec.bounds_max})")

        field, probes = bake_field(vertices, faces_np, spec, chunk)
        stats = validate_field(field, spec)
        print(f"[bake] probes: " + ", ".join(
            f"{k} winding={v['winding']:+.3f}" for k, v in probes.items()))

        n_bytes, binary_sha = write_r16f(r16f_path, field)
        duration = time.monotonic() - t0
        write_manifest(
            json_path, spec,
            binary_file=r16f_path.name,
            binary_sha256=binary_sha,
            source_sha256=source_sha,
            attribution=diagnostics["attribution"],
            stats=stats,
            pitch_m=pitch,
            margin_m=margin,
            duration_s=duration,
            extra={"probes": probes,
                   "mesh": diagnostics["components"],
                   "boundaryEdges": diagnostics["boundaryEdges"],
                   "wristCutM": diagnostics["wristCutM"]})

    mib = n_bytes / (1 << 20)
    print(f"[bake] {r16f_path.name}: {n_bytes} bytes ({mib:.2f} MiB), "
          f"{duration:.1f}s; inside {stats['negativeFraction'] * 100:.1f}%, "
          f"field [{stats['min']:+.4f}, {stats['max']:+.4f}] m")
    if not 1.0 <= mib <= 6.0:
        print(f"[bake] WARNING: {mib:.2f} MiB outside the expected 1-6 MiB band "
              "(expected ~2-3 MiB)", flush=True)
    return 0


# ===========================================================================
# CLI
# ===========================================================================

def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pitch", type=float, default=DEFAULT_PITCH_M,
                    help="target voxel pitch in metres (default 1.5 mm)")
    ap.add_argument("--margin", type=float, default=DEFAULT_MARGIN_M,
                    help="AABB margin in metres (default 12 mm)")
    ap.add_argument("--chunk", type=int, default=DEFAULT_CHUNK_POINTS,
                    help="query points per libigl call (default 262144)")
    ap.add_argument("--r16f", type=Path, default=R16F_PATH)
    ap.add_argument("--json", type=Path, default=JSON_PATH)
    ap.add_argument("--self-test", action="store_true",
                    help="prove sign/ordering/encoding; needs neither Blender nor the model")
    ap.add_argument("--validate-only", action="store_true",
                    help="validate the checked-in volume; needs neither Blender nor the model")
    ap.add_argument("--blender-export", type=Path, metavar="NPZ",
                    help=argparse.SUPPRESS)      # internal: re-entry inside Blender
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
        try:
            import bpy  # noqa: F401  -- presence == running INSIDE Blender
            # Blender executes this file with __main__ and prepends its own
            # flags; the script's arguments live after the "--" separator.
            argv = argv[argv.index("--") + 1:] if "--" in argv else []
        except ImportError:
            pass
    args = parse_args(argv)
    if args.self_test:
        run_self_test()
        return 0
    if args.validate_only:
        out = validate_asset(args.json, args.r16f)
        m, s = out["manifest"], out["stats"]
        print(f"[validate] {args.r16f.name} dims={m['dimensions']} "
              f"voxel={[round(v, 6) for v in m['voxelSize']]} bytes={m['byteLength']}")
        print(f"[validate] field min={s['min']:+.4f} max={s['max']:+.4f} "
              f"inside={s['negativeFraction'] * 100:.1f}% boundaryMin={s['boundaryMin']:+.4f}")
        print("[validate] PASS")
        return 0
    if args.blender_export is not None:
        blender_stage(args.blender_export)       # inner stage (Blender re-entry)
        return 0
    return bake(args.r16f, args.json, pitch=args.pitch, margin=args.margin,
                chunk=args.chunk)


if __name__ == "__main__":
    sys.exit(main())
