#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12,<3.15"
# dependencies = ["libigl==2.6.2", "numpy==2.5.2"]
# ///
"""Bake the X1.27 six-frame right-hand grip clip as one depth-packed R16F atlas.

Dispatch Task B of the X1.27 plan
(docs/superpowers/plans/2026-08-17-sdf-dynamite-grip-release.md, design:
docs/superpowers/specs/2026-08-17-sdf-dynamite-grip-release-design.md).

Outer (this file, plain Python via PEP 723)
    re-runs Task A's `export_pose_soups` in a TemporaryDirectory, derives the
    UNION grid over all six posed soups, bakes each frame with X1.26's exact
    unsigned-distance + fast-winding field function on that ONE common grid,
    depth-packs the frames along Z into one atlas, writes the checked-in
    R16F + version-2 manifest, renders adjacent-midpoint diagnostics, and can
    re-validate everything from the checked-in bytes alone (`--validate-only`).

Inner (runs INSIDE Blender, re-entered with --blender-midpoints)
    renders the five adjacent-pair midpoint isosurfaces as one contact sheet.

No temporary soup, field, or pose is committed; only the atlas, the manifest,
the midpoint sheet, and notes are checked in. Provenance: DavidFischer's
CC-BY-4.0 rigged hand (source stays outside the repo) posed against the
derived DJMaesen CC-BY-4.0 dynamite GLB from Task A.

Usage:
    uv run scripts/bake_hand_sdf_clip.py                 # bake + previews
    uv run scripts/bake_hand_sdf_clip.py --validate-only # validate checked-in
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
LAB_DIR = REPO_ROOT / "public" / "assets" / "lab"
NOTE_DIR = REPO_ROOT / "docs" / "dev-notes" / "2026-08-17-sdf-dynamite-grip"

R16F_OUT = LAB_DIR / "hand-sdf-dynamite-grip-r.r16f"
JSON_OUT = LAB_DIR / "hand-sdf-dynamite-grip-r.json"
MIDPOINT_SHEET_OUT = NOTE_DIR / "clip-midpoints-sheet.png"
PROP_CONTRACT_PATH = LAB_DIR / "dynamite-bundle-grip.json"

DEFAULT_PITCH_M = 0.0015           # 1.5 mm target voxel pitch (spec)
DEFAULT_MARGIN_M = 0.012           # 12 mm margin around the UNION AABB
DEFAULT_CHUNK_POINTS = 262_144
MAX_ATLAS_BYTES = 35 * 1024 * 1024  # plan gate: stop, do not lower resolution

MANIFEST_VERSION = 2
ENCODING = "r16f-le"
ORDER = "x-fastest-y-z"
AXIS_NAMES = {"x": "thumbward", "y": "distal", "z": "dorsal"}
ISO_VALUE = 0
FIELD_DTYPE = "<f2"

LABELS = ("open", "approach", "first-contact", "wrap", "thumb-lock", "firm-grip")
FRAME_KEYS = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)
TIMING = {"closeSec": 0.22, "releaseSec": 0.12,
          "swingSec": 0.24, "releaseAtSec": 0.15}

_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def grip_pose_labels() -> tuple[str, ...]:
    """The six ordered clip labels (parity-checked against Task A at bake time)."""
    return LABELS


# ---------------------------------------------------------------------------
# Shared X1.26 helpers (imported, never copied)
# ---------------------------------------------------------------------------

def _load_bake_hand_sdf():
    spec = importlib.util.spec_from_file_location(
        "bake_hand_sdf", SCRIPTS_DIR / "bake_hand_sdf.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["bake_hand_sdf"] = module
    spec.loader.exec_module(module)
    return module


def _load_author_dynamite_grip():
    spec = importlib.util.spec_from_file_location(
        "author_dynamite_grip", SCRIPTS_DIR / "author_dynamite_grip.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["author_dynamite_grip"] = module
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Pure grid/pack helpers (no Blender, no libigl)
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class ClipGrid:
    """One common sample lattice shared by every frame of the clip.

    dimensions       per-frame (nx, ny, nz)
    atlas_dimensions (nx, ny, nz * frameCount)
    """

    dimensions: tuple[int, int, int]
    atlas_dimensions: tuple[int, int, int]
    bounds_min: tuple[float, float, float]
    bounds_max: tuple[float, float, float]
    voxel_size: tuple[float, float, float]

    def spec(self):
        """The same lattice as X1.26's GridSpec (dims/bounds/voxel)."""
        bake = _load_bake_hand_sdf()
        return bake.GridSpec(dims=self.dimensions, bounds_min=self.bounds_min,
                             bounds_max=self.bounds_max, voxel=self.voxel_size)


def clip_grid(meshes, pitch: float, margin: float) -> ClipGrid:
    """Union AABB over every posed mesh + margin, one 1.5 mm-class lattice.

    Same endpoint-inclusive dims rule as X1.26's `grid_spec`
    (ceil(extent / pitch) + 1), applied to the UNION bounds so every frame is
    baked on ONE grid. Per-frame bounds are never derived.
    """
    if not meshes:
        raise ValueError("clip_grid needs at least one mesh")
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for i, mesh in enumerate(meshes):
        verts = np.asarray(mesh[0], dtype=np.float64)
        if verts.ndim != 2 or verts.shape[1] != 3:
            raise ValueError(f"mesh {i}: vertices must be (N, 3)")
        if not np.isfinite(verts).all():
            raise ValueError(f"mesh {i}: non-finite vertices")
        lo = np.minimum(lo, verts.min(axis=0))
        hi = np.maximum(hi, verts.max(axis=0))
    dims: list[int] = []
    voxel: list[float] = []
    for a, b in zip(lo, hi):
        extent = (b - a) + 2.0 * margin
        if extent <= 0.0:
            raise ValueError(f"non-positive extent on axis: {a}..{b} + {margin}")
        n = int(np.ceil(extent / pitch - 1e-9)) + 1
        dims.append(n)
        voxel.append(extent / (n - 1))
    nx, ny, nz = dims
    return ClipGrid(
        dimensions=(nx, ny, nz),
        atlas_dimensions=(nx, ny, nz * len(LABELS)),
        bounds_min=(float(lo[0] - margin), float(lo[1] - margin),
                    float(lo[2] - margin)),
        bounds_max=(float(hi[0] + margin), float(hi[1] + margin),
                    float(hi[2] + margin)),
        voxel_size=(float(voxel[0]), float(voxel[1]), float(voxel[2])))


def pack_depth(frames) -> np.ndarray:
    """Depth-pack per-frame fields [z, y, x] into an atlas [nz*6, y, x].

    Frame-major along Z; X stays fastest inside every slab, so the atlas
    serialises X-fastest-Y-Z overall (plain C order of the concatenated
    array), exactly like the v1 volume.
    """
    frames = [np.asarray(f) for f in frames]
    if not frames:
        raise ValueError("pack_depth needs frames")
    shape = frames[0].shape
    if len(shape) != 3:
        raise ValueError(f"frame must be [z, y, x], got {shape}")
    for i, f in enumerate(frames):
        if f.shape != shape:
            raise ValueError(f"frame {i} shape {f.shape} != {shape}")
    return np.concatenate(frames, axis=0)


# ---------------------------------------------------------------------------
# Version-2 manifest validation (no Blender, no libigl)
# ---------------------------------------------------------------------------

def _require(cond: bool, message: str) -> None:
    if not cond:
        raise ValueError(message)


def _float3(value, what: str) -> np.ndarray:
    _require(isinstance(value, (list, tuple)) and len(value) == 3,
             f"{what} must be a 3-vector")
    out = np.array([float(v) for v in value], dtype=np.float64)
    _require(np.isfinite(out).all(), f"{what} must be finite")
    return out


def _safe_relative(name, what: str) -> None:
    _require(isinstance(name, str) and name != "", f"{what} missing")
    _require("\\" not in name, f"{what} {name!r} must use forward slashes")
    _require(not re.match(r"^[A-Za-z]:", name), f"{what} {name!r} has a drive")
    _require("://" not in name, f"{what} {name!r} has a URL scheme")
    parts = name.split("/")
    _require(not any(p in ("", ".", "..") for p in parts),
             f"{what} {name!r} is not a plain relative path")


def load_prop_contract_dict() -> dict:
    return json.loads(PROP_CONTRACT_PATH.read_text())


def validate_manifest(manifest: dict, prop_contract: dict | None = None) -> None:
    """Strictly validate a version-2 clip manifest; raise ValueError naming it."""
    if prop_contract is None:
        prop_contract = load_prop_contract_dict()

    _require(isinstance(manifest, dict), "manifest must be an object")
    _require(manifest.get("version") == MANIFEST_VERSION,
             f"manifest version {manifest.get('version')!r} != {MANIFEST_VERSION}")
    _require(manifest.get("kind") == "hand-sdf-clip",
             f"manifest kind {manifest.get('kind')!r} != 'hand-sdf-clip'")
    _require(manifest.get("encoding") == ENCODING,
             f"encoding {manifest.get('encoding')!r} != {ENCODING!r}")
    _require(manifest.get("order") == ORDER,
             f"order {manifest.get('order')!r} != {ORDER!r}")
    _require(manifest.get("axes") == AXIS_NAMES,
             f"axes {manifest.get('axes')!r} != {AXIS_NAMES!r}")
    _require(manifest.get("isoValue") == ISO_VALUE, "isoValue must be 0")
    _safe_relative(manifest.get("binary"), "binary")

    dims = manifest.get("dimensions")
    _require(isinstance(dims, list) and len(dims) == 3
             and all(isinstance(v, int) and v >= 2 for v in dims),
             f"dimensions {dims!r} must be three ints >= 2")
    nx, ny, nz = dims
    frame_count = manifest.get("frameCount")
    _require(frame_count == len(LABELS),
             f"frameCount {frame_count!r} != {len(LABELS)}")
    atlas = manifest.get("atlasDimensions")
    _require(isinstance(atlas, list) and len(atlas) == 3
             and tuple(atlas) == (nx, ny, nz * frame_count),
             f"atlasDimensions {atlas!r} != [nx, ny, nz*frameCount] "
             f"= {[nx, ny, nz * frame_count]}")
    _require(manifest.get("frameDepth") == nz,
             f"frameDepth {manifest.get('frameDepth')!r} != per-frame nz {nz}")

    frames = manifest.get("frames")
    _require(isinstance(frames, list) and len(frames) == len(LABELS),
             f"frames must list exactly {len(LABELS)} entries")
    labels = [f.get("label") for f in frames]
    _require(tuple(labels) == LABELS,
             f"frame labels {labels!r} must be exactly {LABELS!r} in order "
             "(no duplicates, no reordering)")
    keys = []
    for entry in frames:
        key = entry.get("key")
        _require(isinstance(key, (int, float)) and np.isfinite(float(key)),
                 f"frame key {key!r} must be a finite number")
        keys.append(float(key))
    _require(all(b > a for a, b in zip(keys, keys[1:])),
             f"frame keys {keys!r} must be strictly increasing")
    _require(keys[0] == 0.0, f"first frame key {keys[0]!r} != 0.0")
    _require(keys[-1] == 1.0, f"last frame key {keys[-1]!r} != 1.0")

    timing = manifest.get("timing")
    _require(isinstance(timing, dict), "timing missing")
    for k in ("closeSec", "releaseSec", "swingSec", "releaseAtSec"):
        _require(k in timing, f"timing.{k} missing")
        v = timing[k]
        _require(isinstance(v, (int, float)) and np.isfinite(float(v))
                 and float(v) > 0.0, f"timing.{k} {v!r} must be > 0")
    _require(float(timing["releaseAtSec"]) < float(timing["swingSec"]),
             "timing.releaseAtSec must fall inside the swing")

    lo = _float3(manifest.get("boundsMin"), "boundsMin")
    hi = _float3(manifest.get("boundsMax"), "boundsMax")
    _require(bool(np.all(hi > lo)), f"bounds not strictly ordered: {lo} .. {hi}")
    voxel = _float3(manifest.get("voxelSize"), "voxelSize")
    want_voxel = (hi - lo) / (np.array(dims, dtype=np.float64) - 1.0)
    _require(bool(np.all(np.abs(voxel - want_voxel)
                         <= 1e-9 + 1e-6 * np.abs(want_voxel))),
             f"voxelSize {voxel!r} inconsistent with bounds/dims {want_voxel!r}")

    byte_length = manifest.get("byteLength")
    expected_bytes = 2 * nx * ny * nz * frame_count
    _require(isinstance(byte_length, int) and byte_length == expected_bytes,
             f"byteLength {byte_length!r} != {expected_bytes} "
             "(2 * nx * ny * nz * frameCount)")

    sha = manifest.get("sha256")
    _require(isinstance(sha, dict), "sha256 missing")
    for k in ("binary", "source"):
        v = sha.get(k)
        _require(isinstance(v, str) and _HEX64.match(v) is not None,
                 f"sha256.{k} must be 64 lowercase hex chars")

    attribution = manifest.get("attribution")
    _require(isinstance(attribution, str) and attribution.strip() != "",
             "attribution missing")

    prop = manifest.get("prop")
    _require(isinstance(prop, dict), "prop contract missing")
    _safe_relative(prop.get("url"), "prop.url")
    _require(prop.get("sha256") == prop_contract["sha256"],
             "prop sha256 does not match the checked-in derived GLB contract")
    _float3(prop.get("gripLocal"), "prop.gripLocal")
    axis = _float3(prop.get("axisLocal"), "prop.axisLocal")
    _require(abs(float(np.linalg.norm(axis)) - 1.0) <= 1e-6,
             f"prop.axisLocal {axis!r} is not unit length")
    quat = prop.get("modelRotationLocal")
    _require(isinstance(quat, list) and len(quat) == 4,
             "prop.modelRotationLocal must be a 4-vector (w, x, y, z)")
    q = np.array([float(v) for v in quat], dtype=np.float64)
    _require(np.isfinite(q).all(), "prop.modelRotationLocal must be finite")
    _require(abs(float(np.linalg.norm(q)) - 1.0) <= 1e-6,
             f"prop.modelRotationLocal {q!r} is not unit length")
    # integrity check: the quaternion must rotate model +Y onto axisLocal
    w, x, y, z = q
    model_y = np.array([0.0, 1.0, 0.0])
    rotated = np.array([
        (1 - 2 * (y * y + z * z)) * model_y[0]
        + 2 * (x * y - w * z) * model_y[1]
        + 2 * (x * z + w * y) * model_y[2],
        2 * (x * y + w * z) * model_y[0]
        + (1 - 2 * (x * x + z * z)) * model_y[1]
        + 2 * (y * z - w * x) * model_y[2],
        2 * (x * z - w * y) * model_y[0]
        + 2 * (y * z + w * x) * model_y[1]
        + (1 - 2 * (x * x + y * y)) * model_y[2],
    ])
    _require(float(np.linalg.norm(rotated - axis)) <= 1e-6,
             "prop.modelRotationLocal does not rotate model +Y onto axisLocal")
    for k in ("modelGripOffsetM", "contactRadiusM", "contactBelowM",
              "contactAboveM"):
        v = prop.get(k)
        _require(isinstance(v, (int, float)) and np.isfinite(float(v)),
                 f"prop.{k} must be a finite number")
    _require(prop.get("fuseTipNode") == "FuseTip",
             "prop.fuseTipNode must be 'FuseTip'")
    _require(prop.get("flightPivotNode") == "FlightPivot",
             "prop.flightPivotNode must be 'FlightPivot'")


# ---------------------------------------------------------------------------
# Atlas decoding / per-slab validation
# ---------------------------------------------------------------------------

def validate_atlas(atlas: np.ndarray, manifest: dict) -> list[dict]:
    """Slice the atlas into its six slabs and validate each on the common grid."""
    bake = _load_bake_hand_sdf()
    nx, ny, nz = manifest["dimensions"]
    count = manifest["frameCount"]
    expected = (nz * count, ny, nx)
    atlas = np.asarray(atlas)
    if atlas.shape != expected:
        raise ValueError(f"atlas shape {atlas.shape} != {expected} "
                         "[nz*frameCount, ny, nx]")
    lo = tuple(manifest["boundsMin"])
    hi = tuple(manifest["boundsMax"])
    voxel = tuple(manifest["voxelSize"])
    spec = bake.GridSpec(dims=(nx, ny, nz), bounds_min=lo, bounds_max=hi,
                         voxel=voxel)
    stats = []
    for i in range(count):
        slab = np.ascontiguousarray(atlas[i * nz:(i + 1) * nz]).astype(np.float32)
        stats.append(bake.validate_field(slab, spec))
    return stats


def validate_checked_in(json_path: Path = JSON_OUT,
                        r16f_path: Path = R16F_OUT) -> dict:
    """Validate the checked-in clip from bytes alone (no Blender, no source)."""
    manifest = json.loads(json_path.read_text())
    validate_manifest(manifest)
    data = r16f_path.read_bytes()
    if len(data) != manifest["byteLength"]:
        raise ValueError(f"binary length {len(data)} != manifest byteLength "
                         f"{manifest['byteLength']}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != manifest["sha256"]["binary"]:
        raise ValueError("binary sha256 mismatch")
    glb = LAB_DIR / manifest["prop"]["url"]
    if not glb.exists():
        raise ValueError(f"prop GLB missing: {glb}")
    glb_digest = hashlib.sha256(glb.read_bytes()).hexdigest()
    if glb_digest != manifest["prop"]["sha256"]:
        raise ValueError("derived GLB sha256 mismatch against the clip manifest")
    flat = np.frombuffer(data, dtype=FIELD_DTYPE)
    nx, ny, nz = manifest["dimensions"]
    atlas = flat.reshape(nz * manifest["frameCount"], ny, nx)
    slabs = validate_atlas(atlas, manifest)
    return {"manifest": manifest, "slabs": slabs}


# ---------------------------------------------------------------------------
# Bake driver (outer stage)
# ---------------------------------------------------------------------------

def build_manifest_dict(*, grid: ClipGrid, atlas_bytes: int, binary_sha256: str,
                        source_sha256: str, attribution: str,
                        authoring: dict, prop_contract: dict) -> dict:
    return {
        "version": MANIFEST_VERSION,
        "kind": "hand-sdf-clip",
        "binary": R16F_OUT.name,
        "encoding": ENCODING,
        "order": ORDER,
        "axes": dict(AXIS_NAMES),
        "dimensions": list(grid.dimensions),
        "atlasDimensions": list(grid.atlas_dimensions),
        "frameDepth": grid.dimensions[2],
        "frameCount": len(LABELS),
        "frames": [{"label": label, "key": key}
                   for label, key in zip(LABELS, FRAME_KEYS)],
        "timing": dict(TIMING),
        "boundsMin": list(grid.bounds_min),
        "boundsMax": list(grid.bounds_max),
        "voxelSize": list(grid.voxel_size),
        "isoValue": ISO_VALUE,
        "byteLength": atlas_bytes,
        "sha256": {"binary": binary_sha256, "source": source_sha256},
        "attribution": attribution,
        "prop": {
            "url": prop_contract["glb"],
            "sha256": prop_contract["sha256"],
            "gripLocal": authoring["gripLocal"],
            "axisLocal": authoring["axisLocal"],
            "modelGripOffsetM": prop_contract["modelGripOffsetM"],
            "modelRotationLocal": authoring["modelRotationLocal"],
            "contactRadiusM": prop_contract["contactRadiusM"],
            "contactBelowM": prop_contract["contactBelowM"],
            "contactAboveM": prop_contract["contactAboveM"],
            "fuseTipNode": prop_contract["fuseTipNode"],
            "flightPivotNode": prop_contract["flightPivotNode"],
        },
    }


def _load_soup_meshes(soups_dir: Path) -> tuple[list, list, dict]:
    authoring = json.loads((soups_dir / "authoring.json").read_text())
    if authoring["labels"] != list(LABELS):
        raise SystemExit(f"authoring labels {authoring['labels']!r} != {LABELS!r}")
    meshes: list[tuple[np.ndarray, np.ndarray]] = []
    labels: list[str] = []
    for i, label in enumerate(LABELS):
        with np.load(soups_dir / f"pose-{i:02d}-{label}.npz") as data:
            verts = np.asarray(data["vertices"], dtype=np.float64)
            faces = np.asarray(data["faces"], dtype=np.int64)
            labels.append(str(data["label"]))
        meshes.append((verts, faces))
    if tuple(labels) != LABELS:
        raise SystemExit(f"soup labels {labels!r} != {LABELS!r}")
    face_counts = {m[1].shape[0] for m in meshes}
    if len(face_counts) != 1:
        raise SystemExit(f"topology differs across frames: {face_counts}")
    return meshes, labels, authoring


def _midpoint_meshes(fields: list[np.ndarray], grid: ClipGrid,
                     workdir: Path) -> Path:
    """Isosurfaces (zero level) of the alpha-0.5 blend of each adjacent pair."""
    import igl

    bake = _load_bake_hand_sdf()
    spec = grid.spec()
    nx, ny, nz = grid.dimensions
    points = bake.grid_points(spec, 0, nz)      # (N, 3), x-fastest order
    out: dict[str, np.ndarray] = {}
    for i in range(len(fields) - 1):
        blend = 0.5 * (fields[i].astype(np.float64)
                       + fields[i + 1].astype(np.float64))
        verts, faces, _ = igl.marching_cubes(
            blend.ravel().astype(np.float64, copy=False), points, nx, ny, nz, 0.0)
        out[f"mid{i}_verts"] = verts
        out[f"mid{i}_faces"] = faces.astype(np.int64)
        print(f"[midpoints] {LABELS[i]}+{LABELS[i + 1]}: "
              f"{verts.shape[0]} verts / {faces.shape[0]} tris", flush=True)
    npz = workdir / "midpoints.npz"
    np.savez(npz, **out)
    return npz


def _run_blender_midpoints(midpoints_npz: Path, out_png: Path) -> None:
    cmd = ["blender", "--background", "--python", str(Path(__file__).resolve()),
           "--", "--blender-midpoints", str(midpoints_npz),
           "--midpoints-png", str(out_png)]
    print("[midpoints] " + " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def blender_midpoint_stage(midpoints_npz: Path, out_png: Path) -> None:
    """Runs INSIDE Blender (`--blender-midpoints NPZ PNG`): five clay midpoints
    laid out in frame order, one fixed camera, one contact sheet."""
    import bpy
    from mathutils import Vector

    sys.path.insert(0, str(SCRIPTS_DIR))
    import pose_measure_hands as pm

    pm.reset_scene()
    clay = pm.make_pbr("Clay", (0.66, 0.46, 0.38), 0.6)

    def clay_mesh(name, verts, faces):
        me = bpy.data.meshes.new(name)
        me.from_pydata([Vector(tuple(map(float, v))) for v in verts],
                       [], [tuple(map(int, f)) for f in faces])
        me.validate()
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.update()
        obj = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(obj)
        pm.assign(obj, clay)
        return obj

    with np.load(midpoints_npz) as data:
        cells = []
        cell_w = 0.24
        for i in range(len(LABELS) - 1):
            obj = clay_mesh(f"Mid{i}", data[f"mid{i}_verts"],
                            data[f"mid{i}_faces"])
            obj.location = Vector(((i - 2) * cell_w, 0.0, 0.0))
            cells.append(obj)
    bpy.context.view_layer.update()

    scene = pm.configure_engine(transparent=False)
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 460
    scene.eevee.taa_render_samples = 32
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.05, 0.055, 0.065, 1.0)
    bg.inputs[1].default_value = 0.35
    scene.eevee.use_raytracing = False

    target = Vector((0.0, 0.0, 0.0))
    reach = 0.14
    eye = target + Vector((0.5, -0.75, 0.62)).normalized() * reach * 4.4
    bpy.ops.object.camera_add(location=eye)
    cam = bpy.context.active_object
    cam.data.lens = 60
    pm.point_at(cam, target)
    scene.camera = cam

    def area(nm, offs, energy, size):
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

    out_png.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_png)
    bpy.ops.render.render(write_still=True)
    print(f"[midpoints] sheet -> {out_png}")


def bake_clip(pitch: float, margin: float, chunk: int,
              skip_previews: bool = False) -> int:
    t0 = time.monotonic()
    bake = _load_bake_hand_sdf()
    ag = _load_author_dynamite_grip()
    if ag.grip_pose_labels() != LABELS:
        raise SystemExit("author_dynamite_grip.LABELS drifted from the clip baker")

    with tempfile.TemporaryDirectory(prefix="hand-clip-") as tmp:
        soups_dir = Path(tmp)
        print("[clip] solving the six poses (Task A export_pose_soups)...",
              flush=True)
        soups_dir = ag.export_pose_soups(soups_dir)
        meshes, labels, authoring = _load_soup_meshes(soups_dir)

        grid = clip_grid(meshes, pitch, margin)
        nx, ny, nz = grid.dimensions
        atlas_bytes = 2 * nx * ny * nz * len(LABELS)
        mib = atlas_bytes / (1 << 20)
        print(f"[clip] union grid dims=({nx},{ny},{nz}) atlas="
              f"{grid.atlas_dimensions} voxel="
              + ",".join(f"{v * 1000:.3f}mm" for v in grid.voxel_size)
              + f" -> {mib:.2f} MiB", flush=True)
        if atlas_bytes > MAX_ATLAS_BYTES:
            raise SystemExit(
                f"atlas {mib:.1f} MiB exceeds the {MAX_ATLAS_BYTES >> 20} MiB "
                f"gate at dims {grid.dimensions} / pitch {pitch}: STOP and "
                "report dimensions/pitch; do not silently lower resolution")

        spec = grid.spec()
        fields: list[np.ndarray] = []
        all_stats = []
        for i, (verts, faces) in enumerate(meshes):
            print(f"[clip] baking frame {i} {labels[i]} "
                  f"({verts.shape[0]} verts / {faces.shape[0]} tris)...", flush=True)
            field, _probes = bake.bake_field(verts, faces, spec, chunk)
            stats = bake.validate_field(field, spec)
            print(f"[clip] frame {i} {labels[i]}: inside "
                  f"{stats['negativeFraction'] * 100:.1f}% field "
                  f"[{stats['min']:+.4f}, {stats['max']:+.4f}] m", flush=True)
            fields.append(field)
            all_stats.append(stats)

        atlas = pack_depth(fields)
        raw = atlas.astype(FIELD_DTYPE, copy=False).tobytes(order="C")
        if len(raw) != atlas_bytes:
            raise SystemExit(f"packed bytes {len(raw)} != expected {atlas_bytes}")
        binary_sha = hashlib.sha256(raw).hexdigest()
        R16F_OUT.parent.mkdir(parents=True, exist_ok=True)
        R16F_OUT.write_bytes(raw)

        prop_contract = json.loads(PROP_CONTRACT_PATH.read_text())
        manifest = build_manifest_dict(
            grid=grid, atlas_bytes=len(raw), binary_sha256=binary_sha,
            source_sha256=authoring["handSourceSha256"],
            attribution=authoring["attribution"], authoring=authoring,
            prop_contract=prop_contract)
        validate_manifest(manifest, prop_contract)
        JSON_OUT.write_text(json.dumps(manifest, indent=2) + "\n")

        if not skip_previews:
            mid_npz = _midpoint_meshes(fields, grid, soups_dir)
            _run_blender_midpoints(mid_npz, MIDPOINT_SHEET_OUT)

    result = validate_checked_in()
    duration = time.monotonic() - t0
    print(f"[clip] {R16F_OUT.name}: {len(raw)} bytes ({mib:.2f} MiB) in "
          f"{duration:.1f}s; all {len(result['slabs'])} slabs validate")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--blender-midpoints", metavar="NPZ", default=None,
                    help=argparse.SUPPRESS)  # inner stage re-entry
    ap.add_argument("--midpoints-png", metavar="PNG", default=None,
                    help=argparse.SUPPRESS)  # inner stage re-entry
    ap.add_argument("--pitch", type=float, default=DEFAULT_PITCH_M,
                    help="target voxel pitch in metres (default 1.5 mm)")
    ap.add_argument("--margin", type=float, default=DEFAULT_MARGIN_M,
                    help="union-AABB margin in metres (default 12 mm)")
    ap.add_argument("--chunk", type=int, default=DEFAULT_CHUNK_POINTS,
                    help="query points per libigl call")
    ap.add_argument("--validate-only", action="store_true",
                    help="validate the checked-in clip; no Blender, no bake")
    ap.add_argument("--skip-previews", action="store_true",
                    help="bake without the Blender midpoint sheet")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    # Re-entered inside Blender (`--python THIS_FILE -- <args>`): Blender 5.2
    # passes the FULL argv, so slice at the "--" separator (Task A idiom).
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    args = parse_args(argv)
    if args.blender_midpoints:
        if not args.midpoints_png:
            raise SystemExit("--blender-midpoints needs a PNG path")
        blender_midpoint_stage(Path(args.blender_midpoints),
                               Path(args.midpoints_png))
        return 0
    if args.validate_only:
        result = validate_checked_in()
        m = result["manifest"]
        print(f"[validate] clip v{m['version']} frames={m['frameCount']} "
              f"atlas={m['atlasDimensions']} "
              f"{m['byteLength'] / (1 << 20):.2f} MiB: "
              f"{len(result['slabs'])} slabs valid, hashes match")
        return 0
    return bake_clip(args.pitch, args.margin, args.chunk,
                     skip_previews=args.skip_previews)


if __name__ == "__main__":
    raise SystemExit(main())
